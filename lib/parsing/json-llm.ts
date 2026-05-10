/** Strip ```json fences from common LLM responses. */
export function stripCodeFences(s: string): string {
  let t = s.trim();
  const m = /^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```$/im.exec(t);
  if (m) t = m[1].trim();
  return t;
}

/** Fix common LLM JSON mistakes (trailing commas before ] or }). */
export function loosenTrailingCommas(json: string): string {
  let out = json;
  for (let i = 0; i < 8; i += 1) {
    const next = out.replace(/,\s*([\]}])/g, "$1");
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * Parse a JSON object from LLM output: fences, trailing commas, optional prose around `{...}`.
 */
export function tryParseJsonObject(raw: string): unknown {
  const cleaned = loosenTrailingCommas(stripCodeFences(raw));
  try {
    return JSON.parse(cleaned);
  } catch {
    /* continue */
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) return null;
  const slice = loosenTrailingCommas(cleaned.slice(start, end + 1));
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}
