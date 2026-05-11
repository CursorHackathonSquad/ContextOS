import { aiClient, AI_MODEL } from "@/lib/ai/client";
import { orchestratorRefineMaxTokens } from "@/lib/ai/latency";
import { tryParseJsonObject } from "@/lib/parsing/json-llm";

export type RefineResult = {
  refined: string;
  /** True when LLM env missing or parse failed — `refined` equals normalized raw input. */
  degraded: boolean;
};

function normalizeRaw(raw: string): string {
  return raw.trim() || "(empty task)";
}

function coerceRefined(parsed: unknown, rawFallback: string): string {
  if (!parsed || typeof parsed !== "object") return rawFallback;
  const o = parsed as Record<string, unknown>;
  const r = typeof o.refined === "string" ? o.refined.trim() : "";
  if (r.length > 0) return r;
  return rawFallback;
}

/**
 * Expands messy user input into a concrete task the orchestrator can plan against.
 * Output must stay one string; embed expected format and scope inside `refined`.
 */
export async function refineUserTask(rawInput: string): Promise<RefineResult> {
  const raw = rawInput.trim();
  const fallback: RefineResult = { refined: normalizeRaw(rawInput), degraded: true };

  const apiKey = process.env.CLOD_API_KEY;
  const baseUrl = process.env.CLOD_BASE_URL;
  const model = process.env.CLOD_MODEL;
  if (!apiKey || !baseUrl || !model) {
    return fallback;
  }

  const system = [
    "You are a task refiner for a multi-agent execution system.",
    "Take the user's raw message and rewrite it into ONE clear, specific, actionable task description.",
    "Inside `refined`, you MUST explicitly cover:",
    "- What to deliver (concrete outcome)",
    "- Expected output format (e.g. markdown report, JSON schema, bullet list, email draft)",
    "- Scope and boundaries (what is in / out of scope, assumptions, constraints)",
    "Preserve every URL or identifier the user gave; do not drop links.",
    "If the input is already precise, polish minimally without changing intent.",
    "Reply with a single JSON object only. No markdown fences.",
    '{"refined": "<full refined task text — can use short markdown sections>"}'
  ].join("\n");

  const user = `Raw user input:\n\n${raw || "(empty)"}`;

  try {
    const completion = await aiClient.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      max_tokens: orchestratorRefineMaxTokens(),
      temperature: 0.2
    });

    const text = completion.choices[0]?.message?.content ?? "";
    const parsed = tryParseJsonObject(text);
    const refined = coerceRefined(parsed, normalizeRaw(rawInput));
    return { refined, degraded: !parsed };
  } catch {
    return fallback;
  }
}
