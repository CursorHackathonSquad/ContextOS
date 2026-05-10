/**
 * Tunable limits to reduce LLM latency (smaller completions = faster round-trips).
 * Override via env without code changes.
 */

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function readEnvInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return clampInt(n, min, max);
}

/** Manager plan JSON — keep modest; spawn_plan rarely needs huge prose. */
export function managerMaxTokens(): number {
  return readEnvInt("MANAGER_MAX_TOKENS", 1600, 256, 8192);
}

function isHeavyAgent(agentId: string): boolean {
  const id = agentId.toLowerCase();
  return id === "json-structurer" || id.includes("summarizer") || id.includes("doc-writer");
}

/** Parsers/analyzers: shorter JSON; structurer/summary: room for structured output. */
export function agentMaxTokens(agentId: string): number {
  const heavyDefault = readEnvInt("AGENT_MAX_TOKENS_HEAVY", 2800, 512, 8192);
  const lightDefault = readEnvInt("AGENT_MAX_TOKENS_LIGHT", 1600, 256, 8192);
  return isHeavyAgent(agentId) ? heavyDefault : lightDefault;
}

/** Cap prefetched HTML text injected into agent prompts (large context = slow + costly). */
export function agentPageContextMaxChars(): number {
  return readEnvInt("AGENT_PAGE_CONTEXT_MAX_CHARS", 48_000, 4_000, 200_000);
}
