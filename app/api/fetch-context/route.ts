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

const UA = "ContextOS/1.0 (URL prefetch for ingest pipeline)";
const TIMEOUT_MS = 18_000;
const MAX_CHARS = 100_000;

async function fetchOne(url: string): Promise<FetchedPage> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow"
    });
    const raw = await res.text();
    const titleMatch = raw.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch?.[1]?.trim();
    const text = htmlToPlainText(raw).slice(0, MAX_CHARS);
    return { url, ok: res.ok, status: res.status, title, text };
  } catch (e) {
    return { url, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function POST(req: Request) {
  try {
    const { input } = (await req.json()) as { input?: string };
    const text = (input ?? "").trim();
    const urls = extractUrls(text);
    if (urls.length === 0) {
      return NextResponse.json({ ok: true, data: { urls: [], pages: [] as FetchedPage[] } });
    }
    const pages = await Promise.all(urls.map((u) => fetchOne(u)));
    return NextResponse.json({ ok: true, data: { urls, pages } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "fetch-context failed." },
      { status: 500 }
    );
  }
}
