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
    { "step": 1, "agent": "manager|parser-1|parser-2|json-structurer|analyzer-1|ref-tracker|summarizer|doc-writer|...", "label": "..." }
  ],
  "reasoning": "...",
  "required_breakpoints": [
    { "id": "bp-id", "title": "...", "reason": "...", "after_step": 1 }
  ],
  "context_access": { "<agent-id>": { "allowed_context": ["..."], "denied_context": ["..."] } }
}`;

function fallbackPlan(input: string): ManagerResponse {
  const complexity: ComplexityLevel =
    input.length < 400 ? "low" : input.length < 1200 ? "medium" : input.length < 2400 ? "high" : "extreme";
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
      "Offline fallback: linear pipeline from raw fetch → structured JSON → summary. Enable CLOD_* env for live manager planning.",
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

function tryParseJsonObject(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) return null;
  return JSON.parse(raw.slice(start, end + 1));
}

function isManagerResponse(value: unknown): value is ManagerResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<ManagerResponse>;
  return Boolean(v.complexity_level && typeof v.reasoning === "string" && Array.isArray(v.spawn_plan) && v.context_access);
}

export async function POST(req: Request) {
  try {
    const { input } = (await req.json()) as { input?: string };
    const userInput = (input ?? "").trim();
    const apiKey = process.env.CLOD_API_KEY;
    const baseUrl = process.env.CLOD_BASE_URL;
    const model = process.env.CLOD_MODEL;
    if (!apiKey || !baseUrl || !model) {
      return NextResponse.json({ ok: true, data: fallbackPlan(userInput || "No input provided.") });
    }

    const system = [
      "You are the Manager agent for a multi-agent pipeline focused on web URLs.",
      "The user pastes one or more URLs (and optional notes). Downstream workers will receive server-fetched page text and must produce AI-readable structured JSON plus an info summary.",
      "Return JSON only. No markdown. No prose outside JSON.",
      "Schema:",
      RESPONSE_SCHEMA,
      "spawn_plan must reflect delegation for URL ingestion: parsing, structuring JSON (agent id json-structurer recommended), analysis, and summarization.",
      "Include human breakpoints only when necessary (e.g. before costly steps)."
    ].join("\n");

    const user = [
      "Analyze this input and produce the manager plan:",
      userInput || "No input provided.",
      "Assume fetched HTML text for each URL will be supplied to workers separately.",
      "Ensure every agent in spawn_plan has context_access with allowed_context and denied_context arrays."
    ].join("\n\n");

    const completion = await aiClient.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      max_tokens: 1800
    });

    const text = completion.choices[0]?.message?.content ?? "";
    const parsed = tryParseJsonObject(text);
    if (!isManagerResponse(parsed)) {
      return NextResponse.json({ ok: false, error: "Manager JSON schema validation failed." }, { status: 422 });
    }
    return NextResponse.json({ ok: true, data: parsed });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unexpected manager route error." },
      { status: 500 }
    );
  }
}
