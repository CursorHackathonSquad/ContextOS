"use client";

import * as React from "react";
import { Badge, PanelRow, type BadgeTone } from "@/components/ui";
import type { OrchestratorPlan, OrchestratorSubtask } from "@/lib/orchestrator/types";
import {
  INNER_PAD_X,
  SECTION_PAD,
  SURFACE_ACTIVITY_AGENT,
  SURFACE_ACTIVITY_NEUTRAL
} from "@/lib/ui-surfaces";
import { cx } from "@/lib/utils";

type AgentStatus = "idle" | "running" | "blocked" | "ok" | "warn" | "err";

const statusTone: Record<AgentStatus, BadgeTone> = {
  idle: "info",
  running: "warn",
  blocked: "neutral",
  ok: "ok",
  warn: "review",
  err: "err"
};

const statusLabel: Record<AgentStatus, string> = {
  idle: "Queued",
  running: "Running",
  blocked: "Waiting",
  ok: "Done",
  warn: "Check",
  err: "Error"
};

function humanizeId(id: string): string {
  const cleaned = id.replace(/[_-]+/g, " ").trim();
  if (!cleaned) return id;
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function truncateTitle(s: string, max = 40): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

function roleForSubtaskId(plan: OrchestratorPlan, id: string): string {
  for (const phase of plan.phases) {
    const s = phase.find((x) => x.id === id);
    if (s) return s.role.trim() || humanizeId(s.id);
  }
  return humanizeId(id);
}

function collectSubtasks(plan: OrchestratorPlan): OrchestratorSubtask[] {
  const out: OrchestratorSubtask[] = [];
  for (const phase of plan.phases) {
    out.push(...phase);
  }
  return out;
}

type Handoff = { fromId: string; fromRole: string; toId: string; toRole: string };

function collectArtifactHandoffs(plan: OrchestratorPlan): Handoff[] {
  const seen = new Set<string>();
  const rows: Handoff[] = [];
  for (const phase of plan.phases) {
    for (const st of phase) {
      for (const key of st.allowed_context_keys) {
        const prefix = "artifact:";
        if (!key.startsWith(prefix)) continue;
        const depId = key.slice(prefix.length).trim();
        if (!depId || depId === st.id) continue;
        const sig = `${depId}>${st.id}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        rows.push({
          fromId: depId,
          fromRole: roleForSubtaskId(plan, depId),
          toId: st.id,
          toRole: roleForSubtaskId(plan, st.id)
        });
      }
    }
  }
  return rows;
}

function AgentTile({
  subtask,
  status
}: {
  subtask: OrchestratorSubtask;
  status?: AgentStatus;
}) {
  const displayRole = subtask.role.trim() || humanizeId(subtask.id);

  return (
    <div
      className={cx(
        "min-w-[210px] max-w-[min(100%,320px)] flex-1",
        SECTION_PAD,
        SURFACE_ACTIVITY_NEUTRAL
      )}
      title={`${displayRole} · ${subtask.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="line-clamp-2 font-semibold leading-snug text-zinc-100">{truncateTitle(displayRole, 44)}</div>
        </div>
        {status ? (
          <Badge tone={statusTone[status]} size="compact">
            {statusLabel[status]}
          </Badge>
        ) : null}
      </div>
      <div className="hide-scrollbar mt-2 max-h-48 min-h-0 overflow-y-auto rounded-md border border-white/[0.05] bg-black/20 px-2.5 pb-2 pt-1 text-[11px] leading-relaxed text-zinc-400">
        <p className="whitespace-pre-wrap">{subtask.instruction}</p>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {subtask.allowed_context_keys.slice(0, 6).map((k) => (
          <Badge key={k} tone="neutral" size="compact" className="font-mono font-normal">
            {k}
          </Badge>
        ))}
        {subtask.allowed_context_keys.length > 6 ? (
          <span className="text-[10px] text-zinc-600">+{subtask.allowed_context_keys.length - 6} keys</span>
        ) : null}
      </div>
    </div>
  );
}

export function AgentMap({
  plan,
  agentStatus = {}
}: {
  plan: OrchestratorPlan | null;
  agentStatus?: Partial<Record<string, AgentStatus>>;
}) {
  const [assignOpen, setAssignOpen] = React.useState(false);

  if (!plan?.phases?.length) return null;

  const all = collectSubtasks(plan);
  const handoffs = collectArtifactHandoffs(plan);

  return (
    <div className={cx(INNER_PAD_X, "pb-3 pt-1.5", SURFACE_ACTIVITY_NEUTRAL)}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Agent map</div>
      <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
        Only the <span className="text-zinc-400">Orchestrator (Admin)</span> creates workers — it assigns each{" "}
        <span className="text-zinc-400">role</span> name and instruction. Other agents don&apos;t spawn agents; links below are{" "}
        <span className="text-zinc-400">data handoffs</span> when one worker reads another&apos;s <span className="font-mono text-zinc-500">artifact:</span>{" "}
        output.
      </p>

      <div className={cx("mt-4", SECTION_PAD, SURFACE_ACTIVITY_AGENT)}>
        <div className="font-semibold text-indigo-100">Orchestrator (Admin)</div>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
          Assigns {all.length} worker role{all.length === 1 ? "" : "s"}, orders batches, and sets context keys so agents are not overloaded.
        </p>
        <button
          type="button"
          onClick={() => setAssignOpen((o) => !o)}
          className="mt-2 text-[11px] font-medium text-indigo-300/90 underline-offset-2 hover:text-indigo-200 hover:underline"
        >
          {assignOpen ? "Hide" : "Show"} full role assignment list
        </button>
        {assignOpen ? (
          <ul className="hide-scrollbar mt-2 max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-[11px] text-zinc-400">
            {all.map((st) => (
              <li key={st.id}>
                <span className="font-medium text-zinc-200">{st.role.trim() || humanizeId(st.id)}</span>
                <span className="font-mono text-zinc-600"> · {st.id}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="relative py-2">
        <div className="pointer-events-none absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-gradient-to-b from-indigo-950/50 via-zinc-800/40 to-transparent" aria-hidden />
      </div>

      <div className="space-y-6">
        {plan.phases.map((phase, pi) => (
          <div key={pi}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge tone="info" size="md">
                Batch {pi + 1}
              </Badge>
              <Badge tone="info" size="compact">
                Parallel
              </Badge>
              <Badge tone="neutral" size="compact">
                {pi === 0 ? "Runs first" : `After batch ${pi}`}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-3">
              {phase.map((st) => (
                <AgentTile key={st.id} subtask={st} status={agentStatus[st.id]} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 border-t border-zinc-800/80 pt-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Who feeds whom</div>
        <p className="mt-1 text-[11px] text-zinc-500">
          When a worker&apos;s bundle includes <span className="font-mono text-zinc-400">artifact:&lt;id&gt;</span>, it reads the other
          worker&apos;s output — shown as a directed handoff.
        </p>
        {handoffs.length === 0 ? (
          <p className="mt-3 text-[11px] text-zinc-500">
            No artifact handoffs in this plan (workers may still share task text or fetched URLs only).
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {handoffs.map((h, i) => (
              <li key={`${h.fromId}-${h.toId}-${i}`}>
                <PanelRow>
                  <span className="font-semibold text-emerald-200/90">{h.fromRole}</span>
                  <span className="text-zinc-600">→</span>
                  <span className="font-semibold text-sky-200/90">{h.toRole}</span>
                  <span className={cx("font-mono text-[10px]", "text-zinc-600")}>
                    {h.fromId} → {h.toId}
                  </span>
                </PanelRow>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
