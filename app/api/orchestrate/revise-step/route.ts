import { NextResponse } from "next/server";
import { buildContextMarkdown } from "@/lib/context/bundle";
import { mergeOrchestratorOutputs } from "@/lib/orchestrator/merge";
import type { OrchestratorPlan, OrchestratorSubtask, WorkerArtifact } from "@/lib/orchestrator/types";
import { parseArtifactsJson, parseOrchestratorPlanJson } from "@/lib/orchestrator/plan-json";
import { runSubtaskWorkerRevision } from "@/lib/orchestrator/worker-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function findSubtask(plan: OrchestratorPlan, id: string): OrchestratorSubtask | null {
  for (const phase of plan.phases) {
    const s = phase.find((x) => x.id === id);
    if (s) return s;
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const task = String(body.task ?? "").trim();
    const subtaskId = String(body.subtaskId ?? "").trim();
    const feedback = String(body.feedback ?? "").trim();
    const plan = parseOrchestratorPlanJson(body.plan);
    const artifacts = parseArtifactsJson(body.artifacts);

    if (!task) {
      return NextResponse.json({ ok: false, error: "Missing task." }, { status: 400 });
    }
    if (!subtaskId) {
      return NextResponse.json({ ok: false, error: "Missing subtask id." }, { status: 400 });
    }
    if (feedback.length < 2) {
      return NextResponse.json({ ok: false, error: "Add a short explanation (at least a few characters)." }, { status: 400 });
    }
    if (feedback.length > 8000) {
      return NextResponse.json({ ok: false, error: "Feedback is too long." }, { status: 400 });
    }
    if (!plan) {
      return NextResponse.json({ ok: false, error: "Invalid or missing plan." }, { status: 400 });
    }
    if (!artifacts || !artifacts[subtaskId]) {
      return NextResponse.json(
        { ok: false, error: "No saved output for this step — run the full task first." },
        { status: 400 }
      );
    }

    const sub = findSubtask(plan, subtaskId);
    if (!sub) {
      return NextResponse.json({ ok: false, error: "That step is not in the plan." }, { status: 400 });
    }

    const priorArtifact = artifacts[subtaskId] as WorkerArtifact;
    const contextMarkdown = buildContextMarkdown(sub.allowed_context_keys, task, artifacts);

    const out = await runSubtaskWorkerRevision({
      task,
      subtask: sub,
      contextMarkdown,
      orchestratorReasoning: plan.reasoning,
      complexity: plan.complexity,
      feedback,
      priorArtifact
    });

    const nextArtifacts: Record<string, WorkerArtifact> = { ...artifacts, [subtaskId]: out };
    const merged = await mergeOrchestratorOutputs({
      task,
      plan,
      artifacts: nextArtifacts
    });

    return NextResponse.json({
      ok: true,
      subtaskId,
      step: out,
      artifacts: nextArtifacts,
      merge: merged
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
