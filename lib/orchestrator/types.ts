export type ComplexityHint = "low" | "medium" | "high" | "extreme";

/** One unit of work; role name is free-form (decided by orchestrator). */
export type OrchestratorSubtask = {
  id: string;
  role: string;
  instruction: string;
  /** Keys this agent may read — see buildContextMarkdown in lib/context/bundle.ts */
  allowed_context_keys: string[];
};

/**
 * Phases run in order; all subtasks inside one phase run in parallel.
 */
export type OrchestratorPlan = {
  reasoning: string;
  complexity: ComplexityHint;
  phases: OrchestratorSubtask[][];
  /** Describes desired final shape (markdown, json, plain text, bullet list, etc.) — not enforced by code. */
  output_format: string;
  merger_instruction: string;
};

/** Per-subtask LLM output before merge. */
export type WorkerArtifact = {
  summary: string;
  artifact: unknown;
  notes: string | null;
  /** When true, UI should explain approval_reason before the user acts on this output. */
  needs_approval?: boolean;
  approval_reason?: string | null;
};
