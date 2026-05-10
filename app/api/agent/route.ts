import { NextResponse } from "next/server";
import { aiClient, AI_MODEL } from "@/lib/ai/client";

export type AgentStepRequest = {
  agent: string;
  label: string;
  userInput: string;
  managerReasoning: string;
  complexityLevel: string;
  stepIndex: number;
  stepCount: number;
  /** Server-fetched page text (plain), when URLs were present */
  pageContext?: string;
  /** Prior steps' condensed outputs */
  priorOutputs?: string;
};

type AgentStepResponse = {
  output_summary: string;
  extracted_json: unknown | null;
  info_summary: string | null;
  conflict: string | null;
  requires_breakpoint: boolean;
  breakpoint_title: string | null;
  breakpoint_reason: string | null;
};

const RESPONSE_SCHEMA = [
  "{",
  '  "output_summary": "concise description of what this step produced",',
  '  "extracted_json": null or object (use keys like source_url, title, sections[], links[], key_facts[])",',
  '  "info_summary": null or very short headline when useful",',
  '  "conflict": null or short extraction/content warning",',
  '  "requires_breakpoint": false,',
  '  "breakpoint_title": null,',
  '  "breakpoint_reason": null',
  "}"
].join("\n");

function tryParseJsonObject(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) return null;
  return JSON.parse(raw.slice(start, end + 1));
}

function isAgentStepResponse(value: unknown): value is AgentStepResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<AgentStepResponse>;
  return typeof v.output_summary === "string" && typeof v.requires_breakpoint === "boolean";
}

function roleSystemPrompt(agent: string): string {
  const base =
    "You are one specialist agent in a URL → structured JSON → summary pipeline. Return JSON only matching the schema. No markdown fences.";
  if (agent.includes("parser")) {
    return `${base}\nFocus on turning noisy page text into clean sections, metadata, and candidate fields for downstream JSON.`;
  }
  if (agent === "json-structurer") {
    return `${base}\nYour extracted_json must be the canonical AI-readable representation: hierarchical sections, links, facts, and provenance per URL if multiple.`;
  }
  if (agent.includes("analyzer")) {
    return `${base}\nCompare segments, flag gaps, duplicates, or inconsistent facts in extracted_json vs prior steps.`;
  }
  if (agent === "ref-tracker") {
    return `${base}\nTrack claims vs sources; note mismatches in conflict when relevant.`;
  }
  if (agent === "summarizer" || agent === "doc-writer") {
    return `${base}\nProduce a clear info_summary and tight output_summary for humans from structured JSON.`;
  }
  return `${base}\nExecute the step described in the label using page context and prior outputs.`;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<AgentStepRequest>;
    const agent = (body.agent ?? "").trim();
    const label = (body.label ?? "").trim();
    const userInput = (body.userInput ?? "").trim();
    const managerReasoning = (body.managerReasoning ?? "").trim();
    const complexityLevel = (body.complexityLevel ?? "medium").trim();
    const pageContext = (body.pageContext ?? "").trim();
    const priorOutputs = (body.priorOutputs ?? "").trim();
    const stepIndex = typeof body.stepIndex === "number" ? body.stepIndex : 0;
    const stepCount = typeof body.stepCount === "number" ? body.stepCount : 1;

    const apiKey = process.env.CLOD_API_KEY;
    const baseUrl = process.env.CLOD_BASE_URL;
    const model = process.env.CLOD_MODEL;
    if (!apiKey || !baseUrl || !model) {
      return NextResponse.json(
        { ok: false, error: "Missing CLOD_API_KEY, CLOD_BASE_URL, or CLOD_MODEL." },
        { status: 503 }
      );
    }

    if (!agent || !label) {
      return NextResponse.json({ ok: false, error: "agent and label are required." }, { status: 400 });
    }

    const system = [roleSystemPrompt(agent), "Schema:", RESPONSE_SCHEMA].join("\n");
    const user = [
      `Agent id: ${agent}`,
      `Step (${stepIndex + 1} / ${stepCount}): ${label}`,
      `Complexity: ${complexityLevel}`,
      "",
      "--- Original input (URLs + notes) ---",
      userInput || "(empty)",
      "",
      "--- Manager JSON plan / reasoning ---",
      managerReasoning || "(none)",
      pageContext
        ? `\n--- Prefetched page text (plain) ---\n${pageContext}`
        : "\n--- Prefetched page text ---\n(none — user input had no URLs or fetch failed.)",
      priorOutputs ? `\n--- Prior agent outputs ---\n${priorOutputs}` : ""
    ].join("\n");

    const response = await aiClient.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      max_tokens: 4096
    });

    const text = response.choices[0]?.message?.content ?? "";
    const parsed = tryParseJsonObject(text);
    if (!isAgentStepResponse(parsed)) {
      return NextResponse.json({ ok: false, error: "Agent step JSON schema validation failed." }, { status: 422 });
    }

    return NextResponse.json({ ok: true, data: parsed });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unexpected agent route error." },
      { status: 500 }
    );
  }
}
