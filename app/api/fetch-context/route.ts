import { NextResponse } from "next/server";
import { extractUrls } from "@/lib/extract-urls";
import { htmlToPlainText } from "@/lib/html-to-text";
import { assertPublicHttpUrl } from "@/lib/ssrf-guard";

export type FetchedPage = {
  url: string;
  ok: boolean;
  status?: number;
  title?: string;
  text?: string;
  error?: string;
};

/** Many CDNs / anti-bot stacks behave better with a browser UA than a generic scraper string. */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 ContextOS/1.0";

const MAX_REDIRECTS = 8;

/** Upper bound on URLs per request (after SSRF checks each is still expensive). */
function maxUrlsPerRequest(): number {
  const raw = process.env.FETCH_MAX_URLS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 50 ? n : 12;
}

/**
 * Total wall-clock budget for this POST handler (all URLs, all retries, all redirect hops).
 * Set low on Vercel (e.g. FETCH_CONTEXT_BUDGET_MS=9500 on Hobby 10s functions).
 */
function fetchContextBudgetMs(): number {
  const raw = process.env.FETCH_CONTEXT_BUDGET_MS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(n) && n >= 3_000) return n;
  return 120_000;
}

function timeoutMs(): number {
  const raw = process.env.FETCH_TIMEOUT_MS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 3_000 ? n : 55_000;
}

function maxRetries(): number {
  const raw = process.env.FETCH_MAX_RETRIES;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 5 ? n : 2;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * One outer "attempt" (including all redirect hops) shares a single AbortSignal so
 * cumulative time cannot exceed `attemptMs`.
 */
async function fetchOneAttempt(originalUrl: string, attemptMs: number): Promise<FetchedPage> {
  if (attemptMs < 500) {
    return { url: originalUrl, ok: false, error: "FETCH_CONTEXT_BUDGET_EXHAUSTED" };
  }

  const outerSignal = AbortSignal.timeout(attemptMs);
  let current = originalUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    try {
      await assertPublicHttpUrl(current);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "URL blocked";
      return { url: originalUrl, ok: false, error: `SSRF blocked: ${msg}` };
    }

    try {
      const res = await fetch(current, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache"
        },
        signal: outerSignal,
        redirect: "manual",
        cache: "no-store"
      });

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) {
          return { url: originalUrl, ok: false, error: `Redirect ${res.status} without Location header` };
        }
        current = new URL(loc, current).href;
        continue;
      }

      const raw = await res.text();
      const titleMatch = raw.match(/<title[^>]*>([^<]*)<\/title>/i);
      const title = titleMatch?.[1]?.trim();
      const maxChars = 100_000;
      const text = htmlToPlainText(raw).slice(0, maxChars);
      return { url: originalUrl, ok: res.ok, status: res.status, title, text };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/abort|timeout/i.test(msg)) {
        return { url: originalUrl, ok: false, error: msg.includes("timeout") ? msg : `Aborted: ${msg}` };
      }
      return { url: originalUrl, ok: false, error: msg };
    }
  }

  return { url: originalUrl, ok: false, error: `Too many redirects (>${MAX_REDIRECTS})` };
}

function isRetryable(last: FetchedPage): boolean {
  if (last.ok && (last.text?.length ?? 0) > 0) return false;
  const msg = `${last.error ?? ""} ${last.status ?? ""}`;
  if (/SSRF blocked|FETCH_CONTEXT_BUDGET_EXHAUSTED/i.test(msg)) return false;
  return (
    /abort|timeout|ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket|network|fetch failed/i.test(msg) ||
    last.status === 429 ||
    last.status === 503 ||
    last.status === 502
  );
}

async function fetchOne(
  url: string,
  opts: { deadline: number; attemptBudgetMs: number }
): Promise<FetchedPage> {
  const retries = maxRetries();
  let last: FetchedPage = { url, ok: false, error: "fetch never attempted" };

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const remaining = opts.deadline - Date.now();
    if (remaining < 800) {
      return { url, ok: false, error: "FETCH_CONTEXT_BUDGET_EXHAUSTED" };
    }

    const attemptMs = Math.min(opts.attemptBudgetMs, remaining);
    if (attemptMs < 800) {
      return { url, ok: false, error: "FETCH_CONTEXT_BUDGET_EXHAUSTED" };
    }

    /** Keep small; retry backoff is not included in fairShare budget math. */
    if (attempt > 0 && remaining > attemptMs + 800) {
      await delay(Math.min(250 * attempt, 800));
    }

    last = await fetchOneAttempt(url, attemptMs);
    if (last.ok && (last.text?.length ?? 0) > 0) return last;
    if (last.ok && !(last.text?.length ?? 0)) {
      last = { ...last, ok: false, error: "HTTP OK but no text after HTML strip" };
    }
    if (attempt >= retries) break;
    if (!isRetryable(last)) break;
  }

  return last;
}

export async function POST(req: Request) {
  const budgetMs = fetchContextBudgetMs();
  const deadline = Date.now() + budgetMs;

  try {
    const { input } = (await req.json()) as { input?: string };
    const text = (input ?? "").trim();
    let urls = extractUrls(text);
    const maxU = maxUrlsPerRequest();
    let urlsTruncated = false;
    if (urls.length > maxU) {
      urls = urls.slice(0, maxU);
      urlsTruncated = true;
    }

    if (urls.length === 0) {
      return NextResponse.json({ ok: true, data: { urls: [], pages: [] as FetchedPage[], budget_ms: budgetMs } });
    }

    const urlCount = urls.length;
    const attemptsPerUrl = maxRetries() + 1;
    /** Worst-case if every attempt runs full duration: split total budget across all attempts. */
    const fairShare = Math.floor(budgetMs / (urlCount * attemptsPerUrl));
    const attemptBudgetMs = Math.min(timeoutMs(), Math.max(500, fairShare));

    /** Parallel URL fetches — wall time ~ max(url) instead of sum(url) within the same budget caps. */
    const pages: FetchedPage[] = await Promise.all(
      urls.map((u) =>
        Date.now() >= deadline
          ? Promise.resolve({ url: u, ok: false, error: "FETCH_CONTEXT_BUDGET_EXHAUSTED" })
          : fetchOne(u, { deadline, attemptBudgetMs })
      )
    );

    return NextResponse.json({
      ok: true,
      data: {
        urls,
        pages,
        budget_ms: budgetMs,
        attempt_budget_ms_cap: attemptBudgetMs,
        urls_truncated: urlsTruncated
      }
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "fetch-context failed." },
      { status: 500 }
    );
  }
}
