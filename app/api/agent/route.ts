import { NextResponse } from "next/server";
import { aiClient, AI_MODEL } from "@/lib/ai/client";
import { agentMaxTokens, agentPageContextMaxChars } from "@/lib/ai-latency";
import { tryParseJsonObject } from "@/lib/json-parse-llm";

export type AgentStepRequest = {
  agent: string;
  label: string;
  userInput: string;
  managerReasoning: string;
  complexityLevel: string;
  stepIndex: number;
  stepCount: number;
  pageContext?: string;
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
  '  "extracted_json": null or compact object — avoid huge strings; put long prose in output_summary only",',
  '  "info_summary": null or very short headline when useful",',
  '  "conflict": null or short extraction/content warning",',
  '  "requires_breakpoint": false,',
  '  "breakpoint_title": null,',
  '  "breakpoint_reason": null',
  "}"
].join("\n");

function coerceAgentResponse(parsed: unknown, rawModelText: string): AgentStepResponse {
  const fallbackSummary =
    rawModelText.trim().slice(0, 14_000) || "Empty model response.";
  if (!parsed || typeof parsed !== "object") {
    return {
      output_summary: fallbackSummary,
      extracted_json: null,
      info_summary: null,
      conflict: null,
      requires_breakpoint: false,
      breakpoint_title: null,
      breakpoint_reason: null
    };
  }
  const o = parsed as Record<string, unknown>;
  const output_summary =
    typeof o.output_summary === "string" && o.output_summary.trim()
      ? o.output_summary
      : fallbackSummary;
  return {
    output_summary,
    extracted_json: "extracted_json" in o ? o.extracted_json : null,
    info_summary: typeof o.info_summary === "string" ? o.info_summary : null,
    conflict: typeof o.conflict === "string" ? o.conflict : null,
    requires_breakpoint: Boolean(o.requires_breakpoint),
    breakpoint_title: typeof o.breakpoint_title === "string" ? o.breakpoint_title : null,
    breakpoint_reason: typeof o.breakpoint_reason === "string" ? o.breakpoint_reason : null
  };
}

function roleSystemPrompt(agent: string): string {
  const base =
    "You are one specialist agent in a URL → structured JSON → summary pipeline. Output a single JSON object only. No markdown fences. No text before or after the JSON. Valid JSON only: escape inner double-quotes in strings with backslash. Put long narrative text only in output_summary, not inside extracted_json strings.";
  if (agent.includes("parser")) {
    return `${base}\nTurn noisy page text into clean sections and candidate fields; keep extracted_json small.`;
  }
  if (agent === "json-structurer") {
    return `${base}\nextracted_json is the canonical tree (sections, links, facts). Prefer short leaf text or omit huge blobs.`;
  }
  if (agent.includes("analyzer")) {
    return `${base}\nCompare segments and flag gaps; keep extracted_json null unless adding a small checklist object.`;
  }
  if (agent === "ref-tracker") {
    return `${base}\nTrack claims vs sources; keep JSON compact.`;
  }
  if (agent === "summarizer" || agent === "doc-writer") {
    return `${base}\nProduce info_summary and output_summary for humans.`;
  }
  return `${base}\nExecute the step described in the label. If prefetch failed or body is empty, explain once in output_summary; use conflict only on the first agent step that detects it—later steps set conflict to null.`;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<AgentStepRequest>;
    const agent = (body.agent ?? "").trim();
    const label = (body.label ?? "").trim();
    const userInput = (body.userInput ?? "").trim();
    const managerReasoning = (body.managerReasoning ?? "").trim();
    const complexityLevel = (body.complexityLevel ?? "medium").trim();
    let pageContext = (body.pageContext ?? "").trim();
    const pcMax = agentPageContextMaxChars();
    if (pageContext.length > pcMax) {
      pageContext = `${pageContext.slice(0, pcMax)}\n…[page context truncated for latency — raise AGENT_PAGE_CONTEXT_MAX_CHARS if needed]`;
    }
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
    const noPrefetch = !pageContext && /https?:\/\//i.test(userInput);
    const user = [
      `Agent id: ${agent}`,
      `Step (${stepIndex + 1} / ${stepCount}): ${label}`,
      `Complexity: ${complexityLevel}`,
      noPrefetch
        ? "Note: There is no prefetched page text. If prior agent outputs already state a fetch failure, set conflict to null."
        : "",
      "",
      "--- Original input (URLs + notes) ---",
      userInput || "(empty)",
      "",
      "--- Manager JSON plan / reasoning ---",
      managerReasoning || "(none)",
      pageContext
        ? `\n--- Prefetched page text (plain) ---\n${pageContext}`
        : "\n--- Prefetched page text ---\n(none — no URLs, or fetch failed / empty.)",
      priorOutputs ? `\n--- Prior agent outputs ---\n${priorOutputs}` : ""
    ]
      .filter(Boolean)
      .join("\n");

    const response = await aiClient.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      max_tokens: agentMaxTokens(agent),
      temperature: 0.15
    });

    const text = response.choices[0]?.message?.content ?? "";
    const parsed = tryParseJsonObject(text);
    const data = coerceAgentResponse(parsed, text);
    const degraded = parsed === null || parsed === undefined;

    return NextResponse.json({ ok: true, data, degraded });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unexpected agent route error." },
      { status: 500 }
    );
  }
}
