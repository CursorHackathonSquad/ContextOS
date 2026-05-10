import { NextResponse } from "next/server";
import { aiClient, AI_MODEL } from "@/lib/ai/client";

type ComplexityLevel = "low" | "medium" | "high" | "extreme";

export type ManagerResponse = {
  complexity_level: ComplexityLevel;
  spawn_plan: Array<{ step: number; agent: string; label: string }>;
  reasoning: string;
  required_breakpoints: Array<{ id: string; title: string; reason: string; after_step: number }>;
  context_access: Record<string, { allowed_context: string[]; denied_context: string[] }>;
};

const RESPONSE_SCHEMA = `{
  "complexity_level": "low|medium|high|extreme",
  "spawn_plan": [
    { "step": 1, "agent": "manager|parser-1|parser-2|json-structurer|analyzer-1|ref-tracker|summarizer|doc-writer", "label": "short task description" }
  ],
  "reasoning": "one paragraph string",
  "required_breakpoints": [],
  "context_access": { "parser-1": { "allowed_context": ["fetched_pages"], "denied_context": [] } }
}`;

function inferComplexity(input: string): ComplexityLevel {
  const len = input.length;
  if (len < 400) return "low";
  if (len < 1200) return "medium";
  if (len < 2400) return "high";
  return "extreme";
}

function stripCodeFences(s: string): string {
  let t = s.trim();
  const m = /^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```$/im.exec(t);
  if (m) t = m[1].trim();
  return t;
}

function tryParseJsonObject(raw: string): unknown {
  const cleaned = stripCodeFences(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through */
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function fallbackPlan(input: string): ManagerResponse {
  const complexity = inferComplexity(input || " ");
  return {
    complexity_level: complexity,
    spawn_plan: [
      { step: 1, agent: "manager", label: "Plan URL ingestion and JSON extraction" },
      { step: 2, agent: "parser-1", label: "Segment fetched page text into logical blocks" },
      { step: 3, agent: "parser-2", label: "Normalize headings, links, metadata, and entities" },
      { step: 4, agent: "json-structurer", label: "Convert content into AI-readable hierarchical JSON" },
      { step: 5, agent: "analyzer-1", label: "Check coverage, contradictions, and extraction gaps" },
      { step: 6, agent: "summarizer", label: "Produce executive info summary from structured JSON" }
    ],
    reasoning:
      "Default pipeline (model output unusable or offline): fetch → parse → structured JSON → analyze → summarize.",
    required_breakpoints: [],
    context_access: {
      manager: { allowed_context: ["input_buffer", "runtime_state", "spawn_plan"], denied_context: [] },
      "parser-1": { allowed_context: ["input_buffer", "fetched_pages"], denied_context: [] },
      "parser-2": { allowed_context: ["fetched_pages", "chunk_cache"], denied_context: [] },
      "json-structurer": { allowed_context: ["chunk_cache", "parsed_json"], denied_context: [] },
      "analyzer-1": { allowed_context: ["parsed_json", "analysis_scratchpad"], denied_context: [] },
      summarizer: { allowed_context: ["parsed_json", "analysis_scratchpad", "report_draft"], denied_context: [] }
    }
  };
}

function defaultAcl(agent: string): { allowed_context: string[]; denied_context: string[] } {
  return {
    allowed_context: ["user_request", "fetched_pages", "prior_worker_outputs"],
    denied_context: []
  };
}

function coerceComplexity(v: unknown, userInput: string): ComplexityLevel {
  if (v === "low" || v === "medium" || v === "high" || v === "extreme") return v;
  if (typeof v === "string") {
    const x = v.toLowerCase().trim();
    if (x === "low" || x === "medium" || x === "high" || x === "extreme") return x;
  }
  return inferComplexity(userInput);
}

function coerceSpawnPlan(v: unknown, userInput: string): ManagerResponse["spawn_plan"] {
  if (!Array.isArray(v) || v.length === 0) return fallbackPlan(userInput).spawn_plan;
  const out: ManagerResponse["spawn_plan"] = [];
  for (let i = 0; i < v.length; i += 1) {
    const item = v[i];
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const step = typeof o.step === "number" && Number.isFinite(o.step) ? Math.floor(o.step) : i + 1;
    const agent =
      typeof o.agent === "string" && o.agent.trim()
        ? o.agent.trim()
        : typeof o.name === "string" && o.name.trim()
          ? o.name.trim()
          : `worker-${i + 1}`;
    const label =
      typeof o.label === "string" && o.label.trim()
        ? o.label.trim()
        : typeof o.task === "string" && o.task.trim()
          ? o.task.trim()
          : `Step ${i + 1}`;
    out.push({ step, agent, label });
  }
  return out.length > 0 ? out : fallbackPlan(userInput).spawn_plan;
}

function coerceContextAccess(
  v: unknown,
  spawn_plan: ManagerResponse["spawn_plan"]
): ManagerResponse["context_access"] {
  const raw = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const out: ManagerResponse["context_access"] = {};

  for (const s of spawn_plan) {
    const cur = raw[s.agent];
    if (
      cur &&
      typeof cur === "object" &&
      Array.isArray((cur as { allowed_context?: unknown }).allowed_context) &&
      Array.isArray((cur as { denied_context?: unknown }).denied_context)
    ) {
      const c = cur as { allowed_context: string[]; denied_context: string[] };
      out[s.agent] = {
        allowed_context: c.allowed_context.map(String),
        denied_context: c.denied_context.map(String)
      };
    } else {
      out[s.agent] = defaultAcl(s.agent);
    }
  }
  return out;
}

function coerceManagerResponse(parsed: unknown, userInput: string): ManagerResponse {
  if (!parsed || typeof parsed !== "object") return fallbackPlan(userInput);
  const o = parsed as Record<string, unknown>;

  const reasoning =
    typeof o.reasoning === "string"
      ? o.reasoning
      : typeof o.rationale === "string"
        ? o.rationale
        : typeof o.plan === "string"
          ? o.plan
          : "Manager produced a structured spawn plan for URL ingestion.";

  const spawn_plan = coerceSpawnPlan(o.spawn_plan, userInput);
  const complexity = coerceComplexity(o.complexity_level ?? o.complexity, userInput);

  return {
    complexity_level: complexity,
    spawn_plan,
    reasoning,
    /** Human breakpoints disabled so Run Manager immediately continues workers without extra clicks. */
    required_breakpoints: [],
    context_access: coerceContextAccess(o.context_access, spawn_plan)
  };
}

export async function POST(req: Request) {
  try {
    const { input } = (await req.json()) as { input?: string };
    const userInput = (input ?? "").trim();
    const apiKey = process.env.CLOD_API_KEY;
    const baseUrl = process.env.CLOD_BASE_URL;
    const model = process.env.CLOD_MODEL;
    if (!apiKey || !baseUrl || !model) {
      return NextResponse.json({ ok: true, data: fallbackPlan(userInput || "No input provided."), degraded: true });
    }

    const system = [
      "You are the Manager agent for a multi-agent pipeline focused on web URLs.",
      "The user pastes one or more URLs (and optional notes). Workers receive server-fetched page text and produce structured JSON plus a summary.",
      "Reply with a single JSON object only. No markdown fences. No commentary before or after the JSON.",
      "Required keys: complexity_level, spawn_plan, reasoning, required_breakpoints, context_access.",
      "complexity_level must be exactly one of: low, medium, high, extreme.",
      "spawn_plan is an array of objects with integer step, string agent (use ids like parser-1, json-structurer, summarizer), and string label.",
      "context_access must include every agent id from spawn_plan; each value has allowed_context and denied_context string arrays.",
      "Example shape:",
      RESPONSE_SCHEMA
    ].join("\n");

    const user = [
      "Produce the manager plan JSON for:",
      userInput || "No input provided.",
      "Assume fetched plain text for each URL will be injected into worker prompts.",
      "Keep required_breakpoints empty unless a human gate is truly necessary."
    ].join("\n\n");

    const completion = await aiClient.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      max_tokens: 2200,
      temperature: 0.2
    });

    const text = completion.choices[0]?.message?.content ?? "";
    const parsed = tryParseJsonObject(text);
    const data = parsed ? coerceManagerResponse(parsed, userInput) : fallbackPlan(userInput);
    const degraded = !parsed;

    return NextResponse.json({ ok: true, data, degraded });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unexpected manager route error." },
      { status: 500 }
    );
  }
}
