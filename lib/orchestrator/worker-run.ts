import { aiClient, AI_MODEL } from "@/lib/ai/client";
import { orchestratorWorkerMaxTokens } from "@/lib/ai/latency";
import type { OrchestratorSubtask, WorkerArtifact } from "@/lib/orchestrator/types";
import { tryParseJsonObject } from "@/lib/parsing/json-llm";

const SCHEMA = `{"summary":"string","artifact":null or object or string,"notes":null or string,"needs_approval":false,"approval_reason":null or string}`;

function workerSystemPrompt(): string {
  return [
    "You are one specialist agent in a dynamic multi-agent system.",
    "Complete the instruction using ONLY the context sections provided below. Do not assume hidden memory or external tools.",
    "Reply with a single JSON object only. No markdown fences. No commentary outside JSON.",
    "Schema:",
    SCHEMA,
    "Put narrative detail in summary; put structured payloads in artifact when useful; notes for caveats only.",
    "Set needs_approval to true only when a human must confirm before relying on or acting on this output (legal/medical/financial risk, policy uncertainty, destructive or irreversible actions, high-stakes commitments, or confidence too low).",
    "When needs_approval is true, approval_reason must be one or two clear sentences: what is uncertain or risky, and what the user should verify or decide."
  ].join("\n");
}

async function runWorkerCompletion(system: string, user: string): Promise<WorkerArtifact> {
  const apiKey = process.env.CLOD_API_KEY;
  const baseUrl = process.env.CLOD_BASE_URL;
  const model = process.env.CLOD_MODEL;
  if (!apiKey || !baseUrl || !model) {
    return {
      summary: "CLOD_API_KEY / CLOD_BASE_URL / CLOD_MODEL not configured.",
      artifact: null,
      notes: "degraded",
      needs_approval: false,
      approval_reason: null
    };
  }

  const completion = await aiClient.chat.completions.create({
    model: AI_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    max_tokens: orchestratorWorkerMaxTokens(),
    temperature: 0.15
  });

  const text = completion.choices[0]?.message?.content ?? "";
  const parsed = tryParseJsonObject(text);
  return coerceWorker(parsed, text);
}

export async function runSubtaskWorker(params: {
  task: string;
  subtask: OrchestratorSubtask;
  contextMarkdown: string;
  orchestratorReasoning: string;
  complexity: string;
}): Promise<WorkerArtifact> {
  const system = [
    workerSystemPrompt(),
    `Your role name is: "${params.subtask.role}".`
  ].join("\n");

  const user = [
    `Subtask id: ${params.subtask.id}`,
    `Instruction:\n${params.subtask.instruction}`,
    "",
    "--- Orchestrator reasoning (high-level plan) ---",
    params.orchestratorReasoning || "(none)",
    "",
    `Declared complexity: ${params.complexity}`,
    "",
    "--- Scoped context (only sections below exist for you) ---",
    params.contextMarkdown || "(no context keys — task section should still appear if allowed)"
  ].join("\n");

  return runWorkerCompletion(system, user);
}

export async function runSubtaskWorkerRevision(params: {
  task: string;
  subtask: OrchestratorSubtask;
  contextMarkdown: string;
  orchestratorReasoning: string;
  complexity: string;
  feedback: string;
  priorArtifact: WorkerArtifact;
}): Promise<WorkerArtifact> {
  const system = [
    workerSystemPrompt(),
    `Your role name is: "${params.subtask.role}".`,
    "The user rejected your previous output. You must produce a REVISED response in the same JSON schema.",
    "Treat the feedback as authoritative for what to fix; keep anything that still satisfies the instruction and feedback."
  ].join("\n");

  const priorArtStr =
    params.priorArtifact.artifact !== undefined && params.priorArtifact.artifact !== null
      ? typeof params.priorArtifact.artifact === "object"
        ? JSON.stringify(params.priorArtifact.artifact, null, 2)
        : String(params.priorArtifact.artifact)
      : "";

  const user = [
    `Subtask id: ${params.subtask.id}`,
    `Instruction:\n${params.subtask.instruction}`,
    "",
    "--- Orchestrator reasoning (high-level plan) ---",
    params.orchestratorReasoning || "(none)",
    "",
    `Declared complexity: ${params.complexity}`,
    "",
    "--- Scoped context (only sections below exist for you) ---",
    params.contextMarkdown || "(no context keys — task section should still appear if allowed)",
    "",
    "--- Your previous attempt (user did not accept it) ---",
    `Summary:\n${params.priorArtifact.summary}`,
    priorArtStr ? `Structured artifact:\n${priorArtStr}` : "",
    params.priorArtifact.notes ? `Notes: ${params.priorArtifact.notes}` : "",
    "",
    "--- User feedback (revise to address this) ---",
    params.feedback.trim() || "(No specific text — improve quality and alignment with the instruction.)",
    "",
    "Output one revised JSON object matching the schema. Explain substantive changes in summary; adjust artifact if applicable."
  ]
    .filter(Boolean)
    .join("\n");

  return runWorkerCompletion(system, user);
}

function coerceWorker(parsed: unknown, raw: string): WorkerArtifact {
  const fallback = raw.trim().slice(0, 24_000) || "Empty model response.";
  if (!parsed || typeof parsed !== "object") {
    return { summary: fallback, artifact: null, notes: "non-json", needs_approval: false, approval_reason: null };
  }
  const o = parsed as Record<string, unknown>;
  const summary =
    typeof o.summary === "string" && o.summary.trim() ? o.summary : fallback;
  const needsApproval = o.needs_approval === true;
  const approvalReason =
    typeof o.approval_reason === "string" && o.approval_reason.trim() ? o.approval_reason.trim() : null;
  return {
    summary,
    artifact: "artifact" in o ? o.artifact : null,
    notes: typeof o.notes === "string" ? o.notes : null,
    needs_approval: needsApproval,
    approval_reason: needsApproval ? approvalReason ?? "Human review recommended before using this output." : approvalReason
  };
}
