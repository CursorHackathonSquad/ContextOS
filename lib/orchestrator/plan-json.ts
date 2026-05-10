import type { ComplexityHint, OrchestratorPlan, OrchestratorSubtask, WorkerArtifact } from "@/lib/orchestrator/types";

/** Parse a plan object from orchestrator SSE or revise API (minimal validation). */
export function parseOrchestratorPlanJson(raw: unknown): OrchestratorPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const phasesRaw = o.phases;
  if (!Array.isArray(phasesRaw)) return null;
  const phases: OrchestratorSubtask[][] = [];
  for (const phaseRaw of phasesRaw) {
    if (!Array.isArray(phaseRaw)) continue;
    const phase: OrchestratorSubtask[] = [];
    for (const item of phaseRaw) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id.trim() : "";
      if (!id) continue;
      const keys = Array.isArray(row.allowed_context_keys)
        ? row.allowed_context_keys.map((x) => String(x).trim()).filter(Boolean)
        : ["task"];
      phase.push({
        id,
        role: typeof row.role === "string" ? row.role : "",
        instruction: typeof row.instruction === "string" ? row.instruction : "",
        allowed_context_keys: keys.length ? keys : ["task"]
      });
    }
    if (phase.length) phases.push(phase);
  }
  if (phases.length === 0) return null;
  const cx = o.complexity;
  const complexity: ComplexityHint =
    cx === "low" || cx === "medium" || cx === "high" || cx === "extreme" ? cx : "medium";
  return {
    reasoning: typeof o.reasoning === "string" ? o.reasoning : "",
    complexity,
    phases,
    output_format: typeof o.output_format === "string" ? o.output_format : "markdown",
    merger_instruction: typeof o.merger_instruction === "string" ? o.merger_instruction : ""
  };
}

export function parseArtifactsJson(raw: unknown): Record<string, WorkerArtifact> | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, WorkerArtifact> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const w = v as Record<string, unknown>;
    out[k] = {
      summary: typeof w.summary === "string" ? w.summary : "",
      artifact: "artifact" in w ? w.artifact : null,
      notes: typeof w.notes === "string" ? w.notes : null,
      needs_approval: w.needs_approval === true,
      approval_reason: typeof w.approval_reason === "string" ? w.approval_reason : null
    };
  }
  return Object.keys(out).length ? out : null;
}
