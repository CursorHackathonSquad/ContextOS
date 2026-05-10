import { buildContextMarkdown } from "@/lib/context/bundle";
import { fetchPagesFromInput, pagesToContextText } from "@/lib/context/fetch-core";
import { extractUrls } from "@/lib/context/extract-urls";
import { mergeOrchestratorOutputs } from "@/lib/orchestrator/merge";
import { buildOrchestratorPlan } from "@/lib/orchestrator/plan";
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

export async function POST(req: Request) {
  let task = "";
  try {
    const body = (await req.json()) as { task?: string };
    task = (body.task ?? "").trim();
  } catch {
    task = "";
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(sseEncode(event, data));
      };

      try {
        send("meta", { ok: true, message: "orchestrator_start" });

        const { plan, degraded } = await buildOrchestratorPlan(task);
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

        let urlsFetched = "";
        const urls = extractUrls(task);
        if (urls.length > 0) {
          send("prefetch", { status: "started", url_count: urls.length });
          const batch = await fetchPagesFromInput(task);
          urlsFetched = pagesToContextText(batch.pages);
          send("prefetch", {
            status: "done",
            urls: batch.urls,
            urls_truncated: batch.urls_truncated,
            budget_ms: batch.budget_ms
          });
        }

        const artifacts: Record<string, WorkerArtifact> = {};

        for (let pi = 0; pi < plan.phases.length; pi += 1) {
          const phase = plan.phases[pi];
          send("phase_start", { phase_index: pi, subtask_ids: phase.map((s) => s.id) });

          await Promise.all(
            phase.map(async (sub) => {
              send("agent_start", {
                id: sub.id,
                role: sub.role,
                instruction: sub.instruction,
                allowed_context_keys: sub.allowed_context_keys
              });
              const contextMarkdown = buildContextMarkdown(
                sub.allowed_context_keys,
                task,
                artifacts,
                urlsFetched
              );
              const out = await runSubtaskWorker({
                task,
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

        send("merge_start", {});
        const merged = await mergeOrchestratorOutputs({
          task,
          plan,
          artifacts
        });
        send("final", { result: merged.result, format: merged.format });
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
