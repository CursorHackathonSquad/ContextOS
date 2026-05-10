import { NextResponse } from "next/server";
import { extractUrls } from "@/lib/extract-urls";
import { htmlToPlainText } from "@/lib/html-to-text";

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

function timeoutMs(): number {
  const raw = process.env.FETCH_TIMEOUT_MS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 5_000 ? n : 55_000;
}

function maxRetries(): number {
  const raw = process.env.FETCH_MAX_RETRIES;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 5 ? n : 2;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchOneAttempt(url: string, timeout: number): Promise<FetchedPage> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache"
      },
      signal: AbortSignal.timeout(timeout),
      redirect: "follow",
      cache: "no-store"
    });
    const raw = await res.text();
    const titleMatch = raw.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch?.[1]?.trim();
    const maxChars = 100_000;
    const text = htmlToPlainText(raw).slice(0, maxChars);
    return { url, ok: res.ok, status: res.status, title, text };
  } catch (e) {
    return { url, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function isRetryable(last: FetchedPage): boolean {
  if (last.ok && (last.text?.length ?? 0) > 0) return false;
  const msg = `${last.error ?? ""} ${last.status ?? ""}`;
  return (
    /abort|timeout|ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket|network|fetch failed/i.test(msg) ||
    last.status === 429 ||
    last.status === 503 ||
    last.status === 502
  );
}

async function fetchOne(url: string): Promise<FetchedPage> {
  const timeout = timeoutMs();
  const retries = maxRetries();
  let last: FetchedPage = { url, ok: false, error: "fetch never attempted" };

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await delay(600 * attempt);
    last = await fetchOneAttempt(url, timeout);
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
  try {
    const { input } = (await req.json()) as { input?: string };
    const text = (input ?? "").trim();
    const urls = extractUrls(text);
    if (urls.length === 0) {
      return NextResponse.json({ ok: true, data: { urls: [], pages: [] as FetchedPage[] } });
    }
    /** Sequential fetches reduce simultaneous timeouts on slow hosts / rate limits. */
    const pages: FetchedPage[] = [];
    for (const u of urls) {
      pages.push(await fetchOne(u));
    }
    return NextResponse.json({ ok: true, data: { urls, pages } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "fetch-context failed." },
      { status: 500 }
    );
  }
}
