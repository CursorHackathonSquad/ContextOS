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

/** Orchestrator JSON plan (phases, roles, context keys). */
export function orchestratorPlanMaxTokens(): number {
  return readEnvInt("ORCHESTRATOR_PLAN_MAX_TOKENS", 2800, 512, 8192);
}

/** Dynamic worker steps (generic roles). */
export function orchestratorWorkerMaxTokens(): number {
  return readEnvInt("ORCHESTRATOR_WORKER_MAX_TOKENS", 2800, 256, 8192);
}

/** Final merge into user-facing result. */
export function orchestratorMergeMaxTokens(): number {
  return readEnvInt("ORCHESTRATOR_MERGE_MAX_TOKENS", 3600, 512, 8192);
}
