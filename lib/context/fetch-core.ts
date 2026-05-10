/**
 * URL fetch pipeline for orchestrator URL prefetch (bounded parallelism, SSRF guard, HTML → text).
 */

import { fetchPinnedHttpGet } from "@/lib/context/fetch-pinned";
import { htmlToPlainText } from "@/lib/parsing/html-to-text";
import { resolvePublicHttpTarget } from "@/lib/net/ssrf-guard";

export type FetchedPage = {
  url: string;
  ok: boolean;
  status?: number;
  title?: string;
  text?: string;
  error?: string;
};

export const FETCH_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 OsanoAI/1.0";

const MAX_REDIRECTS = 8;

export function maxUrlsPerRequest(): number {
  const raw = process.env.FETCH_MAX_URLS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 50 ? n : 12;
}

export function fetchContextBudgetMs(): number {
  const raw = process.env.FETCH_CONTEXT_BUDGET_MS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(n) && n >= 3_000) return n;
  return 120_000;
}

export function fetchTimeoutMs(): number {
  const raw = process.env.FETCH_TIMEOUT_MS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 3_000 ? n : 55_000;
}

export function fetchMaxRetries(): number {
  const raw = process.env.FETCH_MAX_RETRIES;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 5 ? n : 2;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchOneAttempt(originalUrl: string, attemptMs: number): Promise<FetchedPage> {
  if (attemptMs < 500) {
    return { url: originalUrl, ok: false, error: "FETCH_CONTEXT_BUDGET_EXHAUSTED" };
  }

  const outerSignal = AbortSignal.timeout(attemptMs);
  let current = originalUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let resolved;
    try {
      resolved = await resolvePublicHttpTarget(current);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "URL blocked";
      return { url: originalUrl, ok: false, error: `SSRF blocked: ${msg}` };
    }

    try {
      const res = await fetchPinnedHttpGet(resolved, outerSignal, {
        "User-Agent": FETCH_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache"
      });

      if (res.statusCode >= 300 && res.statusCode < 400) {
        const locRaw = res.headers.location;
        const loc = Array.isArray(locRaw) ? locRaw[0] : locRaw;
        if (!loc) {
          return {
            url: originalUrl,
            ok: false,
            error: `Redirect ${res.statusCode} without Location header`
          };
        }
        current = new URL(loc, current).href;
        continue;
      }

      const raw = res.body;
      const titleMatch = raw.match(/<title[^>]*>([^<]*)<\/title>/i);
      const title = titleMatch?.[1]?.trim();
      const maxChars = 100_000;
      const text = htmlToPlainText(raw).slice(0, maxChars);
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      return { url: originalUrl, ok, status: res.statusCode, title, text };
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
  const retries = fetchMaxRetries();
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

/** Parallel fetch of URLs extracted from task text (orchestrator prefetch). */
export async function fetchPagesFromInput(input: string): Promise<{
  urls: string[];
  pages: FetchedPage[];
  budget_ms: number;
  attempt_budget_ms_cap: number;
  urls_truncated: boolean;
}> {
  const { extractUrls } = await import("@/lib/context/extract-urls");
  const budgetMs = fetchContextBudgetMs();
  const deadline = Date.now() + budgetMs;

  let urls = extractUrls(input);
  const maxU = maxUrlsPerRequest();
  let urlsTruncated = false;
  if (urls.length > maxU) {
    urls = urls.slice(0, maxU);
    urlsTruncated = true;
  }

  if (urls.length === 0) {
    return { urls: [], pages: [], budget_ms: budgetMs, attempt_budget_ms_cap: 0, urls_truncated: false };
  }

  const attemptsPerUrl = fetchMaxRetries() + 1;
  const fairShare = Math.floor(budgetMs / attemptsPerUrl);
  const attemptBudgetMs = Math.min(fetchTimeoutMs(), Math.max(500, fairShare));

  const pages: FetchedPage[] = await Promise.all(
    urls.map((u) =>
      Date.now() >= deadline
        ? Promise.resolve({ url: u, ok: false, error: "FETCH_CONTEXT_BUDGET_EXHAUSTED" })
        : fetchOne(u, { deadline, attemptBudgetMs })
    )
  );

  return {
    urls,
    pages,
    budget_ms: budgetMs,
    attempt_budget_ms_cap: attemptBudgetMs,
    urls_truncated: urlsTruncated
  };
}

/** Plaintext blob for orchestrator context key `urls_fetched`. */
export function pagesToContextText(pages: FetchedPage[]): string {
  if (!pages.length) return "";
  return pages
    .map((p) => {
      const head = p.ok ? `${p.url}${p.title ? ` — ${p.title}` : ""}` : `${p.url} (fetch failed)`;
      const body = p.ok ? p.text ?? "" : p.error ?? "";
      return `=== ${head} ===\n${body}`;
    })
    .join("\n\n");
}
