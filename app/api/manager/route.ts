import { NextResponse } from "next/server";

type ComplexityLevel = "low" | "medium" | "high" | "extreme";

type ManagerResponse = {
  complexity_level: ComplexityLevel;
  spawn_plan: Array<{ step: number; agent: string; label: string }>;
  reasoning: string;
  required_breakpoints: Array<{ id: string; title: string; reason: string; after_step: number }>;
  context_access: Record<string, { allowed_context: string[]; denied_context: string[] }>;
};

const RESPONSE_SCHEMA = `{
  "complexity_level": "low|medium|high|extreme",
  "spawn_plan": [
    { "step": 1, "agent": "manager|parser-1|parser-2|parser-3|analyzer-1|analyzer-2|ref-tracker|doc-writer|...", "label": "..." }
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
      { step: 1, agent: "manager", label: "Interpret input and plan runtime execution" },
      { step: 2, agent: "parser-1", label: "Parse URLs and document sections" },
      { step: 3, agent: "parser-2", label: "Normalize entities and metadata" },
      { step: 4, agent: "analyzer-1", label: "Generate findings and unresolved questions" },
      { step: 5, agent: "ref-tracker", label: "Map claims to source chunks and flag conflicts" },
      { step: 6, agent: "doc-writer", label: "Produce final report and rationale" }
    ],
    reasoning:
      complexity === "low"
        ? "Input is compact and focused; a linear pipeline with one review gate is sufficient."
        : "Input likely contains multiple claims and entities; run full parse-analyze-reference pipeline with a human checkpoint.",
    required_breakpoints: [
      {
        id: "bp-approve-plan",
        title: "Approve spawn plan",
        reason: "Human sign-off before downstream execution.",
        after_step: 1
      }
    ],
    context_access: {
      manager: { allowed_context: ["input_buffer", "runtime_state", "spawn_plan"], denied_context: ["external_network"] },
      "parser-1": { allowed_context: ["input_buffer", "chunk_cache"], denied_context: ["external_network"] },
      "parser-2": { allowed_context: ["input_buffer", "chunk_cache"], denied_context: ["external_network"] },
      "analyzer-1": { allowed_context: ["chunk_cache", "analysis_scratchpad"], denied_context: ["external_network"] },
      "ref-tracker": { allowed_context: ["analysis_scratchpad", "provenance_graph"], denied_context: ["external_network"] },
      "doc-writer": { allowed_context: ["analysis_scratchpad", "provenance_graph", "report_draft"], denied_context: ["external_network"] }
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
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ ok: true, data: fallbackPlan(userInput || "No input provided.") });
    }

    const system = [
      "You are Manager agent for a multi-agent runtime.",
      "Return JSON only. No markdown. No prose outside JSON.",
      "Use this exact schema shape:",
      RESPONSE_SCHEMA
    ].join("\n");

    const user = [
      "Analyze complexity of this input and produce manager plan:",
      userInput || "No input provided.",
      "Ensure every agent includes allowed_context and denied_context arrays.",
      "Use dynamic spawning if helpful (parser-1..parser-N, analyzer-1..analyzer-N).",
      "Include required_breakpoints needed to safely resume with human approval."
    ].join("\n\n");

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-latest",
        max_tokens: 1400,
        system,
        messages: [{ role: "user", content: user }]
      })
    });

    if (!anthropicRes.ok) {
      const errorText = await anthropicRes.text();
      return NextResponse.json({ ok: false, error: `Anthropic API error: ${errorText}` }, { status: 502 });
    }

    const payload = (await anthropicRes.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = payload.content?.find((c) => c.type === "text")?.text ?? "";
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

