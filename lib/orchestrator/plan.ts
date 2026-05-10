import { aiClient, AI_MODEL } from "@/lib/ai/client";
import { orchestratorPlanMaxTokens } from "@/lib/ai/latency";
import { tryParseJsonObject } from "@/lib/parsing/json-llm";
import type { ComplexityHint, OrchestratorPlan, OrchestratorSubtask } from "@/lib/orchestrator/types";

const SCHEMA = `{
  "reasoning": "why this decomposition fits the task",
  "complexity": "low|medium|high|extreme",
  "phases": [
    [
      {
        "id": "unique_snake_id",
        "role": "free-form role title — any string",
        "instruction": "what this agent must produce",
        "allowed_context_keys": ["task", "urls_fetched", "artifact:other_id"]
      }
    ]
  ],
  "output_format": "describe target shape: markdown report | JSON object | bullet list | plain text | etc.",
  "merger_instruction": "how to combine phase outputs into the final deliverable"
}`;

function inferComplexity(task: string): ComplexityHint {
  const len = task.length;
  if (len < 400) return "low";
  if (len < 1200) return "medium";
  if (len < 2400) return "high";
  return "extreme";
}

function fallbackPlan(task: string): OrchestratorPlan {
  const c = inferComplexity(task || " ");
  return {
    reasoning:
      "Default plan (offline / parse failure): two phases — analyze then synthesize — with minimal shared context.",
    complexity: c,
    phases: [
      [
        {
          id: "discover",
          role: "Task analyst",
          instruction:
            "Extract goals, constraints, and deliverable expectations from the task. Summarize unknowns.",
          allowed_context_keys: ["task", "urls_fetched"]
        }
      ],
      [
        {
          id: "produce",
          role: "Executor",
          instruction: "Produce the final answer the user asked for, using prior analysis when helpful.",
          allowed_context_keys: ["task", "urls_fetched", "artifact:discover"]
        }
      ]
    ],
    output_format: "markdown",
    merger_instruction: "Produce one cohesive answer in the chosen format using subtask outputs."
  };
}

function coerceComplexity(v: unknown, task: string): ComplexityHint {
  if (v === "low" || v === "medium" || v === "high" || v === "extreme") return v;
  if (typeof v === "string") {
    const x = v.toLowerCase().trim();
    if (x === "low" || x === "medium" || x === "high" || x === "extreme") return x;
  }
  return inferComplexity(task);
}

function coerceSubtasks(raw: unknown, task: string): OrchestratorSubtask[][] {
  if (!Array.isArray(raw) || raw.length === 0) return fallbackPlan(task).phases;
  const phases: OrchestratorSubtask[][] = [];
  for (let pi = 0; pi < raw.length; pi += 1) {
    const phaseRaw = raw[pi];
    if (!Array.isArray(phaseRaw)) continue;
    const phase: OrchestratorSubtask[] = [];
    for (let si = 0; si < phaseRaw.length; si += 1) {
      const item = phaseRaw[si];
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const id =
        typeof o.id === "string" && o.id.trim()
          ? o.id.trim()
          : `step_${pi + 1}_${si + 1}`;
      const role =
        typeof o.role === "string" && o.role.trim()
          ? o.role.trim()
          : typeof o.title === "string" && o.title.trim()
            ? o.title.trim()
            : `Agent ${pi + 1}.${si + 1}`;
      const instruction =
        typeof o.instruction === "string" && o.instruction.trim()
          ? o.instruction.trim()
          : typeof o.task === "string" && o.task.trim()
            ? o.task.trim()
            : "Complete your part of the task.";
      let allowed_context_keys: string[] = ["task"];
      if (Array.isArray(o.allowed_context_keys)) {
        allowed_context_keys = o.allowed_context_keys.map((x) => String(x).trim()).filter(Boolean);
      }
      if (allowed_context_keys.length === 0) allowed_context_keys = ["task"];
      phase.push({ id, role, instruction, allowed_context_keys });
    }
    if (phase.length > 0) phases.push(phase);
  }
  return phases.length > 0 ? phases : fallbackPlan(task).phases;
}

export function coerceOrchestratorPlan(parsed: unknown, task: string): OrchestratorPlan {
  if (!parsed || typeof parsed !== "object") return fallbackPlan(task);
  const o = parsed as Record<string, unknown>;
  const reasoning =
    typeof o.reasoning === "string" && o.reasoning.trim()
      ? o.reasoning.trim()
      : "Orchestrator produced a phased plan.";
  const phases = coerceSubtasks(o.phases, task);
  const output_format =
    typeof o.output_format === "string" && o.output_format.trim()
      ? o.output_format.trim()
      : typeof o.format === "string" && o.format.trim()
        ? o.format.trim()
        : "markdown";
  const merger_instruction =
    typeof o.merger_instruction === "string" && o.merger_instruction.trim()
      ? o.merger_instruction.trim()
      : typeof o.merge === "string" && o.merge.trim()
        ? o.merge.trim()
        : "Merge subtask outputs into one deliverable matching output_format.";
  return {
    reasoning,
    complexity: coerceComplexity(o.complexity ?? o.complexity_level, task),
    phases,
    output_format,
    merger_instruction
  };
}

export async function buildOrchestratorPlan(task: string): Promise<{ plan: OrchestratorPlan; degraded: boolean }> {
  const userTask = task.trim();
  const apiKey = process.env.CLOD_API_KEY;
  const baseUrl = process.env.CLOD_BASE_URL;
  const model = process.env.CLOD_MODEL;
  if (!apiKey || !baseUrl || !model) {
    return { plan: fallbackPlan(userTask || " "), degraded: true };
  }

  const system = [
    "You are the orchestrator for a multi-agent system.",
    "The user may paste any task: coding, research, summarization, creative work, data extraction, etc.",
    "You decide subtasks, how many agents, free-form role names, parallel vs sequential execution, and output shape.",
    "Execution model: `phases` is an array of phases run in order. Inside each phase, ALL subtasks run IN PARALLEL.",
    "Later phases may reference prior outputs using allowed_context_keys entries like artifact:<subtask_id>.",
    "Include the key `task` when the agent should see the original request.",
    "Include `urls_fetched` only when the task implies URLs will be prefetched server-side (pages as plain text).",
    "Do NOT hardcode fixed agent personas — invent roles appropriate to this task.",
    "For every subtask, `role` MUST be a short human job title YOU assign as orchestrator admin (how this worker appears in the UI), e.g. \"Literature reviewer\", \"API draft\", \"Risk checker\" — not generic labels like \"Agent 1\".",
    "Reply with a single JSON object only. No markdown fences.",
    "Keys: reasoning, complexity, phases, output_format, merger_instruction.",
    "Example shape:",
    SCHEMA
  ].join("\n");

  const user = `Task:\n\n${userTask || "(empty)"}`;

  const completion = await aiClient.chat.completions.create({
    model: AI_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    max_tokens: orchestratorPlanMaxTokens(),
    temperature: 0.25
  });

  const text = completion.choices[0]?.message?.content ?? "";
  const parsed = tryParseJsonObject(text);
  const plan = coerceOrchestratorPlan(parsed, userTask);
  return { plan, degraded: !parsed };
}
