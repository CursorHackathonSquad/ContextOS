import type { OrchestratorPlan, WorkerArtifact } from "@/lib/orchestrator/types";

export type PausedOrchestratorState = {
  runId: string;
  plan: OrchestratorPlan;
  workTask: string;
  originalTask: string;
  artifacts: Record<string, WorkerArtifact>;
  /** Index of the next phase to run (0-based). When >= plan.phases.length, only merge remains. */
  nextPhaseIndex: number;
  degraded: boolean;
  createdAt: number;
};

const TTL_MS = 60 * 60 * 1000;
const store = new Map<string, PausedOrchestratorState>();

function prune() {
  const now = Date.now();
  for (const [id, s] of store) {
    if (now - s.createdAt > TTL_MS) store.delete(id);
  }
}

export function putPausedRun(state: PausedOrchestratorState): void {
  prune();
  store.set(state.runId, state);
}

export function getPausedRun(runId: string): PausedOrchestratorState | undefined {
  prune();
  const s = store.get(runId);
  if (!s) return undefined;
  if (Date.now() - s.createdAt > TTL_MS) {
    store.delete(runId);
    return undefined;
  }
  return s;
}

export function deletePausedRun(runId: string): void {
  store.delete(runId);
}
