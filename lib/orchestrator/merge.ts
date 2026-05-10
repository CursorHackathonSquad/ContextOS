import { aiClient, AI_MODEL } from "@/lib/ai/client";
import { orchestratorMergeMaxTokens } from "@/lib/ai/latency";
import type { OrchestratorPlan, WorkerArtifact } from "@/lib/orchestrator/types";
import { tryParseJsonObject } from "@/lib/parsing/json-llm";

export type MergeOutput = {
  result: unknown;
  format: string;
};

function coerceMerge(parsed: unknown, raw: string, formatFallback: string): MergeOutput {
  if (!parsed || typeof parsed !== "object") {
    return { result: raw.trim() || "Empty merge response.", format: formatFallback };
  }
  const o = parsed as Record<string, unknown>;
  if ("result" in o) {
    return {
      result: o.result,
      format:
        typeof o.format === "string" && o.format.trim()
          ? o.format.trim()
          : formatFallback
    };
  }
  return { result: parsed, format: formatFallback };
}

export async function mergeOrchestratorOutputs(params: {
  task: string;
  plan: OrchestratorPlan;
  artifacts: Record<string, WorkerArtifact>;
}): Promise<MergeOutput> {
  const apiKey = process.env.CLOD_API_KEY;
  const baseUrl = process.env.CLOD_BASE_URL;
  const model = process.env.CLOD_MODEL;
  const formatFallback = params.plan.output_format || "markdown";

  const bundle = Object.entries(params.artifacts)
    .map(([id, w]) => {
      const art =
        w.artifact !== undefined && w.artifact !== null
          ? JSON.stringify(w.artifact, null, 2)
          : "";
      return `### ${id}\n${w.summary}\n${art ? `\n${art}\n` : ""}${w.notes ? `\n_notes: ${w.notes}` : ""}`;
    })
    .join("\n\n");

  if (!apiKey || !baseUrl || !model) {
    return {
      result: bundle || "(no worker output)",
      format: formatFallback
    };
  }

  const system = [
    "You merge parallel/sequential agent outputs into ONE final deliverable.",
    "Target shape is described by output_format (free-form instruction from the orchestrator).",
    "Reply with a single JSON object ONLY:",
    '{"result": <any JSON value — string, object, array as appropriate>, "format": "<short label echoing the actual shape>"}',
    "The `result` must match what output_format asked for when possible (markdown string, JSON object, list, etc.).",
    "No markdown fences around the JSON."
  ].join("\n");

  const user = [
    `Original task:\n${params.task}`,
    "",
    `Orchestrator merger_instruction:\n${params.plan.merger_instruction}`,
    "",
    `Desired output_format:\n${params.plan.output_format}`,
    "",
    "--- Subtask outputs ---",
    bundle || "(none)"
  ].join("\n\n");

  const completion = await aiClient.chat.completions.create({
    model: AI_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    max_tokens: orchestratorMergeMaxTokens(),
    temperature: 0.2
  });

  const text = completion.choices[0]?.message?.content ?? "";
  const parsed = tryParseJsonObject(text);
  return coerceMerge(parsed, text, formatFallback);
}
