import { buildContextMarkdown } from "@/lib/context/bundle";
import { mergeOrchestratorOutputs } from "@/lib/orchestrator/merge";
import { buildOrchestratorPlan } from "@/lib/orchestrator/plan";
import {
  deletePausedRun,
  getPausedRun,
  putPausedRun,
  type PausedOrchestratorState
} from "@/lib/orchestrator/paused-run-store";
import { refineUserTask } from "@/lib/orchestrator/refine";
import type { OrchestratorPlan, WorkerArtifact } from "@/lib/orchestrator/types";
import { runSubtaskWorker } from "@/lib/orchestrator/worker-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function roleForSubtaskId(plan: OrchestratorPlan, id: string): string {
  for (const phase of plan.phases) {
    const s = phase.find((x) => x.id === id);
    if (s) return s.role;
  }
  return id;
}

function sseEncode(event: string, data: unknown): Uint8Array {
  const payload =
    typeof data === "string"
      ? data
      : JSON.stringify(data)
          .replace(/\r\n/g, "\n")
          .replace(/\n/g, "\\n");
  const encoder = new TextEncoder();
  return encoder.encode(`event: ${event}\ndata: ${payload}\n\n`);
}

function sendApprovalItemsIfAny(
  send: (e: string, d: unknown) => void,
  plan: OrchestratorPlan,
  artifacts: Record<string, WorkerArtifact>
) {
  const approvalItems: Array<{ id: string; role: string; reason: string }> = [];
  for (const [aid, art] of Object.entries(artifacts)) {
    if (art.needs_approval) {
      approvalItems.push({
        id: aid,
        role: roleForSubtaskId(plan, aid),
        reason:
          art.approval_reason?.trim() ||
          "This step requested human confirmation before you rely on or act on its output."
      });
    }
  }
  if (approvalItems.length > 0) {
    send("approval_required", { items: approvalItems });
  }
}

async function runSinglePhase(
  send: (e: string, d: unknown) => void,
  workTask: string,
  plan: OrchestratorPlan,
  artifacts: Record<string, WorkerArtifact>,
  phaseIndex: number
) {
  const phase = plan.phases[phaseIndex];
  send("phase_start", { phase_index: phaseIndex, subtask_ids: phase.map((s) => s.id) });

  await Promise.all(
    phase.map(async (sub) => {
      send("agent_start", {
        id: sub.id,
        role: sub.role,
        instruction: sub.instruction,
        allowed_context_keys: sub.allowed_context_keys
      });
      const contextMarkdown = buildContextMarkdown(sub.allowed_context_keys, workTask, artifacts);
      const out = await runSubtaskWorker({
        task: workTask,
        subtask: sub,
        contextMarkdown,
        orchestratorReasoning: plan.reasoning,
        complexity: plan.complexity
      });
      artifacts[sub.id] = out;
      send("agent_done", {
        id: sub.id,
        summary: out.summary,
        artifact: out.artifact,
        notes: out.notes,
        needs_approval: Boolean(out.needs_approval),
        approval_reason: out.approval_reason ?? null
      });
    })
  );
}

async function finalizeMerge(
  send: (e: string, d: unknown) => void,
  workTask: string,
  plan: OrchestratorPlan,
  artifacts: Record<string, WorkerArtifact>
) {
  sendApprovalItemsIfAny(send, plan, artifacts);
  send("merge_start", {});
  const merged = await mergeOrchestratorOutputs({
    task: workTask,
    plan,
    artifacts
  });
  send("final", { result: merged.result, format: merged.format });
}

export async function POST(req: Request) {
  let task = "";
  let refineEnabled = true;
  let runIdContinue: string | null = null;
  let isContinue = false;
  try {
    const body = (await req.json()) as {
      task?: string;
      refine?: boolean;
      run_id?: string;
      continue?: boolean;
    };
    task = (body.task ?? "").trim();
    refineEnabled = body.refine !== false;
    if (body.continue === true && typeof body.run_id === "string" && body.run_id.trim()) {
      isContinue = true;
      runIdContinue = body.run_id.trim();
    }
  } catch {
    task = "";
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(sseEncode(event, data));
      };

      try {
        if (isContinue && runIdContinue) {
          const st = getPausedRun(runIdContinue);
          if (!st) {
            send("error", {
              message: "This run expired or was already completed. Start a new task."
            });
            return;
          }

          send("meta", { ok: true, message: "orchestrator_resume", run_id: st.runId });

          if (st.nextPhaseIndex >= st.plan.phases.length) {
            await finalizeMerge(send, st.workTask, st.plan, st.artifacts);
            deletePausedRun(st.runId);
            return;
          }

          await runSinglePhase(send, st.workTask, st.plan, st.artifacts, st.nextPhaseIndex);

          const completedPi = st.nextPhaseIndex;
          const nextIdx = completedPi + 1;
          const updated: PausedOrchestratorState = {
            ...st,
            artifacts: st.artifacts,
            nextPhaseIndex: nextIdx,
            createdAt: Date.now()
          };
          putPausedRun(updated);

          send("phase_paused", {
            run_id: st.runId,
            completed_phase_index: completedPi,
            total_phases: st.plan.phases.length,
            next_step: nextIdx >= st.plan.phases.length ? "merge" : "phase"
          });
          return;
        }

        /* Fresh run */
        let workTask = task.trim();
        if (!workTask) {
          send("error", { message: "Missing task text." });
          return;
        }

        if (refineEnabled) {
          const { refined: refinedTask } = await refineUserTask(task);
          workTask = refinedTask.trim() || task.trim();
        }
        send("refined", {
          type: "refined",
          original: task,
          refined: workTask,
          skipped: !refineEnabled
        });

        send("meta", { ok: true, message: "orchestrator_start" });

        const { plan, degraded } = await buildOrchestratorPlan(workTask);
        send("plan", {
          reasoning: plan.reasoning,
          complexity: plan.complexity,
          phases: plan.phases.map((phase) =>
            phase.map((s) => ({
              id: s.id,
              role: s.role,
              instruction: s.instruction,
              allowed_context_keys: s.allowed_context_keys
            }))
          ),
          output_format: plan.output_format,
          merger_instruction: plan.merger_instruction,
          degraded
        });

        if (plan.phases.length === 0) {
          send("error", { message: "Orchestrator returned no phases." });
          return;
        }

        const runId = crypto.randomUUID();
        const artifacts: Record<string, WorkerArtifact> = {};

        await runSinglePhase(send, workTask, plan, artifacts, 0);

        const nextIdx = 1;
        putPausedRun({
          runId,
          plan,
          workTask,
          originalTask: task,
          artifacts,
          nextPhaseIndex: nextIdx,
          degraded,
          createdAt: Date.now()
        });

        send("phase_paused", {
          run_id: runId,
          completed_phase_index: 0,
          total_phases: plan.phases.length,
          next_step: nextIdx >= plan.phases.length ? "merge" : "phase"
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        controller.enqueue(sseEncode("error", { message: msg }));
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
