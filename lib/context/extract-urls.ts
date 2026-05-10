const URL_RE = /\bhttps?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

export function extractUrls(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(URL_RE.source, "gi");
  while ((m = re.exec(text)) !== null) {
    const u = m[0].replace(/[),.]+$/g, "");
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}
