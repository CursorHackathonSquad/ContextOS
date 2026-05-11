"use client";

import * as React from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Chip,
  EmptyWell,
  InsetPanel,
  Select,
  type BadgeTone
} from "@/components/ui";
import { LockIcon, PlayIcon, ResetIcon, SparkIcon, XIcon } from "@/components/ui/icons";
import { AgentMap } from "./AgentMap";
import { CONTEXTOS_INPUT_KEY, TASK_INPUT_PLACEHOLDER } from "@/lib/session-input";
import { parseOrchestratorPlanJson } from "@/lib/orchestrator/plan-json";
import { consumeSseJson } from "@/lib/net/sse-client";
import type { OrchestratorPlan, WorkerArtifact } from "@/lib/orchestrator/types";
import {
  INNER_PAD_X,
  SECTION_PAD,
  SURFACE_ACTIVITY_TRACE_AGENT,
  SURFACE_ACTIVITY_TRACE_NEUTRAL,
  SURFACE_CARD_INNER,
  SURFACE_RESULTS_BLOCK
} from "@/lib/ui-surfaces";
import { cx, formatTime } from "@/lib/utils";

type AgentStatus = "idle" | "running" | "blocked" | "ok" | "warn" | "err";
type TraceKind = "action" | "context-grant" | "context-deny" | "breakpoint" | "conflict";
type ComplexityLevel = "low" | "medium" | "high" | "extreme";
type AgentKey = string;

type TraceEvent = { id: string; ts: number; actor: AgentKey | "system" | "human"; kind: TraceKind; title: string; detail?: string };
type SpawnStep = {
  step: number;
  /** Phase index in the orchestrator plan (0-based). Same phase = parallel; higher = later sequence. */
  phaseIndex: number;
  agent: string;
  roleTitle: string;
  /** Full orchestrator instruction for this worker (never truncated). */
  instruction: string;
  allowedContextKeys: string[];
};

type ApprovalItem = { id: string; role: string; reason: string };

/** Seed trace row — must not use Date.now() / random so SSR and client HTML match (hydration). */
const INITIAL_TRACE_ID = "trace_seed_ready";
const INITIAL_TRACE_TS = 1704067200000;

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
  /** Model asked for human review of this step — not the same as pausing the whole pipeline. */
  warn: "Review",
  err: "Error"
};

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function titleCaseDifficulty(s: string) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function now() {
  return Date.now();
}

/** Turn slug-like ids (subtask-a, worker_2) into readable labels when the orchestrator role is missing. */
function humanizeAgentId(id: string): string {
  const cleaned = id.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "Agent";
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function formatAgentLabel(id: string, steps: SpawnStep[]): string {
  const row = steps.find((s) => s.agent === id);
  const title = row?.roleTitle?.trim();
  if (title) return title;
  return humanizeAgentId(id);
}

/** Short friendly label for maps and chips (role only; no internal ids). */
function shortAgentTitle(step: SpawnStep, maxLen = 34): string {
  const t = step.roleTitle.trim();
  if (!t) return `Step ${step.step}`;
  if (t.length <= maxLen) return t;
  return `${t.slice(0, Math.max(0, maxLen - 1))}…`;
}

function shortLabelForActor(actor: string, steps: SpawnStep[]): string {
  const row = steps.find((s) => s.agent === actor);
  return row ? shortAgentTitle(row) : humanizeAgentId(actor);
}

function isTerminalAgentStatus(status: AgentStatus): boolean {
  return status === "ok" || status === "warn" || status === "err";
}

/**
 * Orchestrator runs each phase in order; workers within a phase run in parallel.
 * Derives "blocked" when this step is still waiting on upstream phases or same-batch artifact deps.
 */
function deriveAgentDisplay(
  step: SpawnStep,
  raw: AgentStatus | undefined,
  allSteps: SpawnStep[],
  agents: Record<string, AgentStatus>
): { status: AgentStatus; waitHint?: string } {
  const r = raw ?? "idle";
  if (r === "running") return { status: "running" };
  if (isTerminalAgentStatus(r)) return { status: r };

  const upstreamIncomplete = allSteps.filter(
    (o) => o.phaseIndex < step.phaseIndex && !isTerminalAgentStatus(agents[o.agent] ?? "idle")
  );

  if (upstreamIncomplete.length > 0) {
    const names = upstreamIncomplete.map((o) => shortAgentTitle(o));
    const batchNums = [...new Set(upstreamIncomplete.map((o) => o.phaseIndex + 1))].sort((a, b) => a - b);
    const batchPhrase =
      batchNums.length === 1 ? `batch ${batchNums[0]}` : `batches ${batchNums.join(", ")}`;
    return {
      status: "blocked",
      waitHint: `Earlier ${batchPhrase} still running: ${names.join(", ")}`
    };
  }

  const depIds = step.allowedContextKeys
    .filter((k) => k.startsWith("artifact:"))
    .map((k) => k.slice("artifact:".length).trim())
    .filter(Boolean);

  const sameBatchBlockers: SpawnStep[] = [];
  for (const depId of depIds) {
    const other = allSteps.find((s) => s.agent === depId);
    if (!other || other.phaseIndex !== step.phaseIndex) continue;
    if (!isTerminalAgentStatus(agents[depId] ?? "idle")) {
      sameBatchBlockers.push(other);
    }
  }

  if (sameBatchBlockers.length > 0) {
    const names = sameBatchBlockers.map((s) => shortAgentTitle(s));
    return {
      status: "blocked",
      waitHint: `Needs output from ${names.join(", ")} in the same batch`
    };
  }

  return { status: r };
}

function describeContextKey(key: string): string {
  const k = key.trim();
  if (k === "task") return "Original task text";
  if (k.startsWith("artifact:")) {
    const id = k.slice("artifact:".length).trim();
    return id ? `Prior step output (${id})` : k;
  }
  return k;
}

function collectApprovalItems(plan: OrchestratorPlan, artifacts: Record<string, WorkerArtifact>): ApprovalItem[] | null {
  const items: ApprovalItem[] = [];
  for (const [id, art] of Object.entries(artifacts)) {
    if (!art.needs_approval) continue;
    let role = id;
    outer: for (const phase of plan.phases) {
      for (const st of phase) {
        if (st.id === id) {
          role = st.role.trim() || id;
          break outer;
        }
      }
    }
    items.push({
      id,
      role,
      reason: art.approval_reason?.trim() || "Confirm before using this output."
    });
  }
  return items.length ? items : null;
}

function complexityTone(level: ComplexityLevel | null): BadgeTone {
  if (level === null) return "neutral";
  if (level === "low") return "ok";
  if (level === "medium") return "info";
  if (level === "high") return "warn";
  return "err";
}

function complexityBadgeLabel(level: ComplexityLevel | null): string {
  if (level === null) return "—";
  return titleCaseDifficulty(level);
}

/** Orchestrator may emit its own complexity; we surface difficulty from batch count for demos. */
function complexityFromBatchCount(batchCount: number): ComplexityLevel | null {
  if (batchCount < 1) return null;
  if (batchCount === 1) return "low";
  if (batchCount === 2) return "medium";
  if (batchCount === 3) return "high";
  return "extreme";
}

function traceKindTone(kind: TraceKind): BadgeTone {
  if (kind === "breakpoint") return "warn";
  if (kind === "conflict" || kind === "context-deny") return "err";
  if (kind === "context-grant") return "ok";
  return "neutral";
}

function isAgentTraceActor(actor: TraceEvent["actor"]): boolean {
  return actor !== "system" && actor !== "human";
}

/** Card surface per activity row — neutral vs indigo-tinted agent lines. */
function traceRowClasses(actor: TraceEvent["actor"]): string {
  const agent = isAgentTraceActor(actor);
  return cx(
    SECTION_PAD,
    "text-xs leading-snug",
    agent ? SURFACE_ACTIVITY_TRACE_AGENT : SURFACE_ACTIVITY_TRACE_NEUTRAL
  );
}

function actorBadge(actor: TraceEvent["actor"], steps: SpawnStep[]) {
  if (actor === "system") {
    return (
      <Badge tone="neutral" size="compact">
        System
      </Badge>
    );
  }
  if (actor === "human") {
    return (
      <Badge tone="info" size="compact">
        You
      </Badge>
    );
  }
  return (
    <Badge tone="info" size="compact" className="max-w-[12rem] truncate">
      {shortLabelForActor(actor, steps)}
    </Badge>
  );
}

function createInitialState() {
  return {
    inputText: "",
    complexityLevel: null as ComplexityLevel | null,
    managerReasoning: "",
    agents: {} as Record<string, AgentStatus>,
    spawnPlan: [] as SpawnStep[],
    isRunning: false,
    isManagerLoading: false,
    selectedAgent: "" as string,
    trace: [
      {
        id: INITIAL_TRACE_ID,
        ts: INITIAL_TRACE_TS,
        actor: "system",
        kind: "action",
        title: "Ready",
        detail: "Enter a task and run. The orchestrator splits work into steps and combines the outcome."
      }
    ] as TraceEvent[],
    output: {
      title: "",
      summary: "",
      sections: [{ h: "Status", p: "Nothing run yet." }]
    },
    artifacts: {} as Record<string, WorkerArtifact>,
    orchestratorPlan: null as OrchestratorPlan | null,
    loadedContext: {} as Record<string, string[]>,
    /** When false, POST /api/orchestrate skips refine LLM (faster demos). */
    refineBeforeRun: true
  };
}

type State = ReturnType<typeof createInitialState>;

export function Dashboard() {
  const [state, setState] = React.useState<State>(() => createInitialState());
  const [approvalNotice, setApprovalNotice] = React.useState<ApprovalItem[] | null>(null);
  /** Server handed off after each batch; approve to run the next batch or merge. */
  const [pauseGate, setPauseGate] = React.useState<{
    runId: string;
    completedPhaseIndex: number;
    totalPhases: number;
    nextStep: "phase" | "merge";
  } | null>(null);
  const [revisionFeedback, setRevisionFeedback] = React.useState<Record<string, string>>({});
  const [revisePendingId, setRevisePendingId] = React.useState<string | null>(null);
  const [vaultModalOpen, setVaultModalOpen] = React.useState(false);
  const [vaultModalAgent, setVaultModalAgent] = React.useState("");
  /** Expanded agent detail under the roster (click). */
  const [agentDetailId, setAgentDetailId] = React.useState<string | null>(null);
  const planStepsRef = React.useRef<SpawnStep[]>([]);
  const activityLogRef = React.useRef<HTMLDivElement>(null);
  const resultsPanelRef = React.useRef<HTMLDivElement>(null);
  /** If true, new Results content scrolls the panel to the bottom; scrolling up disables until user returns near the bottom. */
  const resultsStickBottomRef = React.useRef(true);

  /**
   * One-shot handoff from landing → /run only. Session keys are removed immediately so refresh / HMR /
   * server restart never restores task text (only in-memory state until you navigate away).
   */
  React.useEffect(() => {
    let raw = "";
    let autorun = false;
    try {
      raw = sessionStorage.getItem(CONTEXTOS_INPUT_KEY) ?? "";
      autorun = sessionStorage.getItem("contextos_autorun") === "1";
      sessionStorage.removeItem(CONTEXTOS_INPUT_KEY);
      sessionStorage.removeItem("contextos_autorun");
    } catch {
      /* ignore */
    }
    const task = raw.trim();
    if (raw.length > 0) {
      setState((s) => ({ ...s, inputText: raw }));
    }
    if (autorun && task) {
      void runOrchestrate(task);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Seed “Ready” row uses a fixed ts for hydration; refresh to wall-clock once mounted. */
  React.useEffect(() => {
    setState((s) => ({
      ...s,
      trace: s.trace.map((e) => (e.id === INITIAL_TRACE_ID ? { ...e, ts: Date.now() } : e))
    }));
  }, []);

  React.useEffect(() => {
    if (!vaultModalOpen) return;
    if (!vaultModalAgent || !Object.prototype.hasOwnProperty.call(state.agents, vaultModalAgent)) {
      const first = Object.keys(state.agents)[0];
      if (first) setVaultModalAgent(first);
    }
  }, [vaultModalOpen, vaultModalAgent, state.agents]);

  function pushTrace(event: Omit<TraceEvent, "id" | "ts"> & { ts?: number }) {
    setState((s) => ({
      ...s,
      trace: [...s.trace, { id: uid("tr"), ts: event.ts ?? now(), actor: event.actor, kind: event.kind, title: event.title, detail: event.detail }]
    }));
  }

  function handleOrchestrateSse(event: string, data: unknown) {
    if (event === "refined" && data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      const refined = typeof d.refined === "string" ? d.refined : "";
      const skipped = d.skipped === true;
      if (refined) {
        setState((s) => ({ ...s, inputText: refined }));
      }
      pushTrace({
        actor: "system",
        kind: "action",
        title: skipped ? "Refine skipped" : "Task refined",
        detail: skipped
          ? "Using your text as-is (no refinement LLM)."
          : refined.length > 0
            ? refined.length > 2200
              ? `${refined.slice(0, 2200)}…`
              : refined
            : "Using your input as-is."
      });
    }
    if (event === "plan" && data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      const phases =
        (d.phases as
          | Array<
              Array<{
                id: string;
                role: string;
                instruction: string;
                allowed_context_keys?: string[];
              }>
            >
          | undefined) ?? [];
      let stepNum = 0;
      const spawnPlan: SpawnStep[] = [];
      const nextAgents: Record<string, AgentStatus> = {};
      for (let pi = 0; pi < phases.length; pi += 1) {
        const phase = phases[pi];
        for (const row of phase) {
          stepNum += 1;
          const roleTitle = row.role.trim() || humanizeAgentId(row.id);
          const instruction =
            typeof row.instruction === "string" ? row.instruction.trim() : "";
          const keys = Array.isArray(row.allowed_context_keys)
            ? row.allowed_context_keys.map(String).filter(Boolean)
            : [];
          spawnPlan.push({
            step: stepNum,
            phaseIndex: pi,
            agent: row.id,
            roleTitle,
            instruction,
            allowedContextKeys: keys.length > 0 ? keys : ["task"]
          });
          nextAgents[row.id] = "idle";
        }
      }
      planStepsRef.current = spawnPlan;
      const batchCount = phases.length;
      const complexityLevel = complexityFromBatchCount(batchCount);
      const orchPlan = parseOrchestratorPlanJson(data);
      setState((s) => ({
        ...s,
        complexityLevel,
        managerReasoning: typeof d.reasoning === "string" ? d.reasoning : s.managerReasoning,
        spawnPlan,
        agents: nextAgents,
        selectedAgent: spawnPlan[0]?.agent ?? s.selectedAgent,
        isManagerLoading: false,
        orchestratorPlan: orchPlan ?? s.orchestratorPlan
      }));
      pushTrace({
        actor: "system",
        kind: "action",
        title: "Plan ready",
        detail: `${spawnPlan.length} step${spawnPlan.length === 1 ? "" : "s"} · ${batchCount} batch${
          batchCount === 1 ? "" : "es"
        }${complexityLevel ? ` → ${titleCaseDifficulty(complexityLevel)} complexity (by batches)` : ""}`
      });
    }
    if (event === "meta" && data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      if (d.message === "orchestrator_resume") {
        pushTrace({
          actor: "system",
          kind: "action",
          title: "Continuing run",
          detail: "Resuming after your approval."
        });
      }
    }
    if (event === "phase_start" && data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      const ids = Array.isArray(d.subtask_ids) ? (d.subtask_ids as string[]).join(", ") : "";
      pushTrace({
        actor: "system",
        kind: "action",
        title: `Batch ${Number(d.phase_index) + 1}`,
        detail: ids ? `Running together: ${ids}` : "Starting parallel work in this batch."
      });
    }
    if (event === "agent_start" && data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      const id = String(d.id ?? "");
      const keys = Array.isArray(d.allowed_context_keys) ? d.allowed_context_keys.map(String) : [];
      if (id) {
        setState((s) => ({
          ...s,
          agents: { ...s.agents, [id]: "running" },
          loadedContext: { ...s.loadedContext, [id]: keys }
        }));
      }
      const label = String(d.role ?? "").trim() || formatAgentLabel(id, planStepsRef.current);
      pushTrace({
        actor: id || "system",
        kind: "action",
        title: `${label} started`,
        detail: keys.length ? `Using only: ${keys.join(", ")}` : String(d.instruction ?? "").slice(0, 400)
      });
    }
    if (event === "agent_done" && data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      const id = String(d.id ?? "");
      const needsAp = Boolean(d.needs_approval);
      const apprReason = typeof d.approval_reason === "string" ? d.approval_reason.trim() : "";
      const summary = String(d.summary ?? "");
      const artifactPayload: WorkerArtifact = {
        summary,
        artifact: "artifact" in d ? d.artifact : null,
        notes: typeof d.notes === "string" ? d.notes : null,
        needs_approval: needsAp,
        approval_reason: apprReason || null
      };
      if (id) {
        setState((s) => ({
          ...s,
          agents: { ...s.agents, [id]: needsAp ? "warn" : "ok" },
          artifacts: { ...s.artifacts, [id]: artifactPayload }
        }));
      }
      const label = id ? formatAgentLabel(id, planStepsRef.current) : "Agent";
      if (needsAp) {
        const why = apprReason || "Review this step before you rely on it or take action based on it.";
        const body = summary ? (summary.length > 900 ? `${summary.slice(0, 900)}…` : summary) : "";
        pushTrace({
          actor: id || "system",
          kind: "breakpoint",
          title: `${label} needs your review`,
          detail: body ? `${why}\n\n—\n${body}` : why
        });
      } else {
        pushTrace({
          actor: id || "system",
          kind: "action",
          title: `${label} finished`,
          detail: summary.length > 1200 ? `${summary.slice(0, 1200)}…` : summary
        });
      }
    }
    if (event === "approval_required" && data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      const raw = d.items;
      const items: ApprovalItem[] = Array.isArray(raw)
        ? raw
            .filter((x): x is Record<string, unknown> => x != null && typeof x === "object")
            .map((x) => ({
              id: String(x.id ?? ""),
              role: String(x.role ?? "").trim() || "Step",
              reason: String(x.reason ?? "").trim() || "Confirm this output before using it."
            }))
            .filter((x) => x.reason.length > 0)
        : [];
      setApprovalNotice(items.length > 0 ? items : null);
    }
    if (event === "merge_start") {
      pushTrace({ actor: "system", kind: "action", title: "Combining results", detail: "Turning step outputs into one answer." });
    }
    if (event === "phase_paused" && data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      const runId = String(d.run_id ?? (d as { runId?: unknown }).runId ?? "").trim();
      const completed = Number(d.completed_phase_index ?? d.completedPhaseIndex);
      const total = Number(d.total_phases ?? d.totalPhases);
      const nextStep = d.next_step === "merge" || d.nextStep === "merge" ? "merge" : "phase";
      if (runId.length > 0 && Number.isFinite(completed) && Number.isFinite(total) && total >= 1) {
        setPauseGate({
          runId,
          completedPhaseIndex: Math.max(0, completed),
          totalPhases: total,
          nextStep
        });
      }
      setState((s) => ({ ...s, isRunning: false, isManagerLoading: false }));
      pushTrace({
        actor: "system",
        kind: "breakpoint",
        title: `Batch ${completed + 1} of ${total} complete`,
        detail:
          nextStep === "merge"
            ? "Approve below to merge all step outputs into the final answer."
            : "Approve below to run the next batch of agents."
      });
    }
    if (event === "final" && data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      const result = d.result;
      const resultStr = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      setPauseGate(null);
      setState((s) => ({
        ...s,
        isRunning: false,
        isManagerLoading: false,
        output: {
          title: "",
          summary: "",
          sections: [
            {
              h: "Output",
              p: resultStr.slice(0, 14_000) + (resultStr.length > 14_000 ? "\n…[truncated]" : "")
            },
            ...(s.managerReasoning.trim()
              ? [
                  {
                    h: "Explanation",
                    p: s.managerReasoning.slice(0, 2500) + (s.managerReasoning.length > 2500 ? "…" : "")
                  }
                ]
              : [])
          ]
        }
      }));
      pushTrace({ actor: "system", kind: "action", title: "Done", detail: "Merge finished." });
    }
    if (event === "error") {
      const msg =
        data && typeof data === "object" && data !== null && "message" in data
          ? String((data as { message?: unknown }).message)
          : String(data ?? "Unknown error");
      setPauseGate(null);
      setState((s) => ({ ...s, isRunning: false, isManagerLoading: false }));
      pushTrace({ actor: "system", kind: "action", title: "Run failed", detail: msg });
    }
  }

  async function continueOrchestrate() {
    const runId = pauseGate?.runId;
    if (!runId || state.isRunning) return;
    setState((s) => ({ ...s, isRunning: true }));
    pushTrace({
      actor: "human",
      kind: "action",
      title: "Approved",
      detail:
        pauseGate?.nextStep === "merge"
          ? "Continuing to merge step outputs."
          : "Continuing with the next batch."
    });
    try {
      const res = await fetch("/api/orchestrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: runId, continue: true })
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText.slice(0, 500) || `HTTP ${res.status}`);
      }
      await consumeSseJson(res, handleOrchestrateSse);
      setState((s) => (s.isRunning ? { ...s, isRunning: false, isManagerLoading: false } : s));
    } catch (error) {
      setState((s) => ({ ...s, isRunning: false, isManagerLoading: false }));
      pushTrace({
        actor: "system",
        kind: "action",
        title: "Continue failed",
        detail: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }

  async function runOrchestrate(overrideTask?: string) {
    const task = (overrideTask ?? state.inputText).trim();
    if (!task) {
      pushTrace({
        actor: "system",
        kind: "action",
        title: "Empty task",
        detail: "Enter a task description before running."
      });
      return;
    }

    if (state.isRunning || state.isManagerLoading) {
      return;
    }

    const refine = state.refineBeforeRun;

    setState((s) => ({
      ...s,
      inputText: overrideTask !== undefined ? overrideTask : s.inputText,
      isRunning: true,
      isManagerLoading: true,
      complexityLevel: null,
      agents: {},
      spawnPlan: [],
      managerReasoning: "",
      selectedAgent: "",
      artifacts: {},
      orchestratorPlan: null,
      loadedContext: {},
      output: {
        title: "Working…",
        summary: "Orchestrator is planning and running steps.",
        sections: [{ h: "Status", p: "Waiting for a plan…" }]
      }
    }));
    setAgentDetailId(null);
    planStepsRef.current = [];
    setApprovalNotice(null);
    setPauseGate(null);
    setRevisionFeedback({});
    setRevisePendingId(null);
    pushTrace({ actor: "system", kind: "action", title: "Started", detail: "Sending your task to the orchestrator." });

    try {
      const res = await fetch("/api/orchestrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, refine })
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText.slice(0, 500) || `HTTP ${res.status}`);
      }

      await consumeSseJson(res, handleOrchestrateSse);

      setState((s) => (s.isRunning ? { ...s, isRunning: false, isManagerLoading: false } : s));
    } catch (error) {
      setPauseGate(null);
      setState((s) => ({ ...s, isRunning: false, isManagerLoading: false }));
      pushTrace({
        actor: "system",
        kind: "action",
        title: "Run failed",
        detail: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }

  function resetDemo() {
    const t = Date.now();
    setState(() => {
      const s = createInitialState();
      return {
        ...s,
        trace: s.trace.map((e) =>
          e.id === INITIAL_TRACE_ID ? { ...e, ts: t } : e
        )
      };
    });
    planStepsRef.current = [];
    setApprovalNotice(null);
    setPauseGate(null);
    setRevisionFeedback({});
    setRevisePendingId(null);
    setVaultModalOpen(false);
    setVaultModalAgent("");
    setAgentDetailId(null);
    try {
      sessionStorage.removeItem(CONTEXTOS_INPUT_KEY);
      sessionStorage.removeItem("contextos_autorun");
    } catch {
      /* ignore */
    }
  }

  function dismissApprovalItem(stepId: string) {
    setApprovalNotice((prev) => {
      if (!prev) return null;
      const next = prev.filter((x) => x.id !== stepId);
      return next.length ? next : null;
    });
  }

  async function reviseStepWithFeedback(stepId: string) {
    const feedback = (revisionFeedback[stepId] ?? "").trim();
    if (feedback.length < 2) {
      pushTrace({
        actor: "system",
        kind: "action",
        title: "Add feedback",
        detail: "Briefly explain what was wrong or what should change."
      });
      return;
    }
    const orch = state.orchestratorPlan;
    const arts = state.artifacts;
    const taskText = state.inputText.trim();
    if (!taskText) {
      pushTrace({ actor: "system", kind: "action", title: "Cannot revise", detail: "Your task text is empty." });
      return;
    }
    if (!orch || !arts[stepId]) {
      pushTrace({
        actor: "system",
        kind: "action",
        title: "Cannot revise",
        detail: "Run the task once first so this step has saved output."
      });
      return;
    }

    setRevisePendingId(stepId);
    try {
      const res = await fetch("/api/orchestrate/revise-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: taskText,
          subtaskId: stepId,
          feedback,
          plan: orch,
          artifacts: arts
        })
      });
      const payload = (await res.json()) as {
        ok?: boolean;
        error?: string;
        artifacts?: Record<string, WorkerArtifact>;
        merge?: { result: unknown; format: string };
        step?: WorkerArtifact;
      };
      if (!res.ok || !payload.ok || !payload.merge || !payload.artifacts || !payload.step) {
        throw new Error(payload.error ?? "Revision failed.");
      }
      const merge = payload.merge;
      const resultStr =
        typeof merge.result === "string" ? merge.result : JSON.stringify(merge.result, null, 2);
      const nextArtifacts = payload.artifacts;
      const step = payload.step;

      setState((s) => ({
        ...s,
        artifacts: nextArtifacts,
        agents: { ...s.agents, [stepId]: step.needs_approval ? "warn" : "ok" },
        output: {
          title: "",
          summary: "",
          sections: [
            {
              h: "Output",
              p: resultStr.slice(0, 14_000) + (resultStr.length > 14_000 ? "\n…[truncated]" : "")
            },
            ...(s.managerReasoning.trim()
              ? [
                  {
                    h: "Explanation",
                    p: s.managerReasoning.slice(0, 2500) + (s.managerReasoning.length > 2500 ? "…" : "")
                  }
                ]
              : [])
          ]
        }
      }));

      setApprovalNotice(collectApprovalItems(orch, nextArtifacts));
      setRevisionFeedback((r) => ({ ...r, [stepId]: "" }));

      pushTrace({
        actor: "human",
        kind: "action",
        title: "Feedback sent — step rerun",
        detail: `You asked to revise ${formatAgentLabel(stepId, planStepsRef.current)}.`
      });
      const lbl = formatAgentLabel(stepId, planStepsRef.current);
      if (step.needs_approval) {
        pushTrace({
          actor: stepId,
          kind: "breakpoint",
          title: `${lbl} still suggests review`,
          detail:
            (step.approval_reason?.trim() || "Confirm before relying on this revised output.") +
            (step.summary
              ? `\n\n—\n${step.summary.slice(0, 900)}${step.summary.length > 900 ? "…" : ""}`
              : "")
        });
      } else {
        pushTrace({
          actor: stepId,
          kind: "action",
          title: `${lbl} revised`,
          detail: step.summary.length > 1200 ? `${step.summary.slice(0, 1200)}…` : step.summary
        });
      }
    } catch (e) {
      pushTrace({
        actor: "system",
        kind: "action",
        title: "Revision failed",
        detail: e instanceof Error ? e.message : "Unknown error"
      });
    } finally {
      setRevisePendingId(null);
    }
  }

  function openVaultModal(agentId?: string) {
    const ids = Object.keys(state.agents);
    const id = (agentId ?? state.selectedAgent) || ids[0] || "";
    if (id) {
      setVaultModalAgent(id);
      setState((s) => ({ ...s, selectedAgent: id }));
    }
    setVaultModalOpen(true);
  }

  const vaultStep = state.spawnPlan.find((s) => s.agent === vaultModalAgent);
  const vaultAllowed = vaultStep?.allowedContextKeys ?? [];
  const vaultInjected = state.loadedContext[vaultModalAgent] ?? [];
  const vaultArtifact = state.artifacts[vaultModalAgent];
  const vaultFootprint = vaultArtifact
    ? `~${(
        (vaultArtifact.summary?.length ?? 0) +
        (typeof vaultArtifact.artifact === "string"
          ? vaultArtifact.artifact.length
          : JSON.stringify(vaultArtifact.artifact ?? "").length)
      ).toLocaleString()} chars (summary + structured output)`
    : "No output stored for this step yet.";

  const { agentQueueRows, derivedAgentStatusMap } = React.useMemo(() => {
    const spawnPlan = state.spawnPlan;
    const agents = state.agents;
    if (spawnPlan.length === 0) {
      return {
        agentQueueRows: [] as Array<{ step: SpawnStep; status: AgentStatus; waitHint?: string }>,
        derivedAgentStatusMap: {} as Record<string, AgentStatus>
      };
    }
    const rows = spawnPlan.map((step) => {
      const raw = agents[step.agent];
      const d = deriveAgentDisplay(step, raw, spawnPlan, agents);
      return { step, ...d };
    });
    const derivedAgentStatusMap: Record<string, AgentStatus> = {};
    for (const r of rows) {
      derivedAgentStatusMap[r.step.agent] = r.status;
    }
    return { agentQueueRows: rows, derivedAgentStatusMap };
  }, [state.spawnPlan, state.agents]);

  const agentDetailRow = agentDetailId ? agentQueueRows.find((r) => r.step.agent === agentDetailId) : undefined;

  React.useLayoutEffect(() => {
    const el = activityLogRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [state.trace]);

  React.useEffect(() => {
    const el = resultsPanelRef.current;
    if (!el) return;
    const thresholdPx = 72;
    const updateStick = () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      resultsStickBottomRef.current = gap <= thresholdPx;
    };
    updateStick();
    el.addEventListener("scroll", updateStick, { passive: true });
    return () => el.removeEventListener("scroll", updateStick);
  }, []);

  React.useLayoutEffect(() => {
    const el = resultsPanelRef.current;
    if (!el || !resultsStickBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [state.output, approvalNotice, state.orchestratorPlan, state.spawnPlan]);

  return (
    <div className="flex min-h-dvh flex-col bg-zinc-950 text-zinc-100">
      <header className="shrink-0 border-b border-white/10 p-4">
        <div className="mx-auto flex w-full max-w-[min(1600px,100%)] flex-row flex-wrap items-center justify-between gap-3">
          <Link
            href="/"
            aria-label="OsanoAI home"
            className="flex items-center gap-2 rounded-lg pl-2 text-zinc-100 outline-none transition-opacity hover:opacity-90 focus-visible:rounded-lg focus-visible:ring-2 focus-visible:ring-indigo-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          >
            <span className="flex shrink-0 items-center justify-center">
              <SparkIcon className="h-5 w-5 text-indigo-200" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">OsanoAI</span>
          </Link>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => openVaultModal()} title="Context scope per agent">
              <LockIcon className="h-4 w-4" />
              Context
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void runOrchestrate()}
              disabled={state.isManagerLoading || state.isRunning}
            >
              <PlayIcon className="h-4 w-4" />
              {state.isManagerLoading ? "Running…" : "Run"}
            </Button>
            <Button variant="danger" size="sm" onClick={resetDemo}>
              <ResetIcon className="h-4 w-4" />
              Reset
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[min(1600px,100%)] flex-1 flex-col gap-4 p-4 min-h-0">
        <div className="flex shrink-0 flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pl-1">
            <span className="text-sm font-semibold tracking-tight text-zinc-100">Task</span>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-3">
              <label
                className={cx(
                  "inline-flex h-7 min-h-7 cursor-pointer select-none items-center gap-2 rounded-xl border px-3 text-xs font-medium transition focus-within:outline-none focus-within:ring-2 focus-within:ring-indigo-500/35",
                  state.refineBeforeRun
                    ? "border-indigo-400/30 bg-indigo-500/15 text-indigo-50 shadow-[0_0_0_1px_rgba(99,102,241,0.12)]"
                    : "border-white/10 bg-white/[0.04] text-zinc-200 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] hover:bg-white/[0.06]",
                  (state.isRunning || state.isManagerLoading) && "pointer-events-none cursor-not-allowed opacity-40"
                )}
              >
                <input
                  type="checkbox"
                  checked={state.refineBeforeRun}
                  disabled={state.isRunning || state.isManagerLoading}
                  onChange={(e) => setState((s) => ({ ...s, refineBeforeRun: e.target.checked }))}
                  className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-white/25 bg-black/35 text-indigo-500 accent-indigo-500 focus:ring-0 focus:ring-offset-0 disabled:cursor-not-allowed"
                />
                <span className="whitespace-nowrap">Refine task</span>
              </label>
              <span
                title={
                  state.spawnPlan.length > 0
                    ? `Derived from batch count (${Math.max(...state.spawnPlan.map((s) => s.phaseIndex)) + 1} batches)`
                    : "Derived from planned batches after Run"
                }
                className="inline-flex shrink-0"
              >
                <Badge
                  tone={complexityTone(state.complexityLevel)}
                  size="md"
                  className="h-7 min-h-7 !rounded-xl !px-3 !py-0 text-xs font-semibold tabular-nums leading-none gap-1.5"
                >
                  <span className="font-normal opacity-80">Complexity</span>
                  <span className="opacity-60">·</span>
                  <span>{complexityBadgeLabel(state.complexityLevel)}</span>
                </Badge>
              </span>
            </div>
          </div>
          <textarea
            value={state.inputText}
            onChange={(e) => {
              const v = e.target.value;
              setState((s) => ({ ...s, inputText: v }));
            }}
            rows={4}
            className={cx(
              "hide-scrollbar min-h-[88px] max-h-40 w-full resize-y rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-sm leading-relaxed text-zinc-100",
              "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] placeholder:text-zinc-300 placeholder:opacity-100 placeholder:leading-snug",
              "focus:border-indigo-400/35 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
            )}
            placeholder={TASK_INPUT_PLACEHOLDER}
          />
        </div>

        {pauseGate ? (
          <Callout tone="warn" className="flex shrink-0 flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-100">
                {pauseGate.nextStep === "merge"
                  ? `All ${pauseGate.totalPhases} batch${pauseGate.totalPhases === 1 ? "" : "es"} finished`
                  : `Batch ${pauseGate.completedPhaseIndex + 1} of ${pauseGate.totalPhases} finished`}
              </p>
              <p className="mt-1 text-xs leading-snug text-zinc-400">
                {pauseGate.nextStep === "merge"
                  ? "Use Continue / Approve merge in this banner to combine step outputs into the final answer."
                  : "Use Continue in this banner to run the next parallel batch. “Review” on a chip is optional step-level flagging, not this gate."}
              </p>
            </div>
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="shrink-0"
              disabled={state.isRunning}
              onClick={() => void continueOrchestrate()}
            >
              {pauseGate.nextStep === "merge" ? "Approve merge" : "Continue"}
            </Button>
          </Callout>
        ) : null}

        <div className="relative z-40 shrink-0 isolate">
          <Card className="overflow-visible">
              <CardHeader className="shrink-0">
                <CardTitle className="flex-col items-stretch gap-1 !pb-0">
                <div className="flex flex-wrap items-center gap-2 pl-1">
                  <span>Agents</span>
                  <span
                    className={cx(
                      "inline-flex h-6 min-w-[1.5rem] shrink-0 items-center justify-center rounded-lg",
                      "bg-white/[0.06] px-2 text-xs font-semibold tabular-nums text-zinc-200"
                    )}
                    aria-label={`${agentQueueRows.length} workers`}
                  >
                    {agentQueueRows.length}
                  </span>
                </div>
                {pauseGate ? (
                  <p className="text-[11px] font-normal leading-snug text-amber-200/85">
                    Pipeline paused — use{" "}
                    <span className="font-semibold text-amber-100">Continue</span> in the banner above to{" "}
                    {pauseGate.nextStep === "merge" ? "merge the final answer" : "start the next batch"}.
                  </p>
                ) : null}
              </CardTitle>
              </CardHeader>
              <CardBody className="overflow-visible pt-0">
                {agentQueueRows.length > 0 ? (
                <div className="flex flex-wrap items-stretch gap-2">
                  {agentQueueRows.map(({ step, status }) => {
                    const nativeTitle = `${shortAgentTitle(step)} · ${statusLabel[status]}`.slice(0, 380).trim();
                    const selected = state.selectedAgent === step.agent || agentDetailId === step.agent;
                    return (
                      <div key={step.agent} className="relative min-w-0">
                        <Chip
                          title={nativeTitle}
                          selected={selected}
                          onClick={() => {
                            setAgentDetailId((id) => (id === step.agent ? null : step.agent));
                            setState((s) => ({ ...s, selectedAgent: step.agent }));
                          }}
                          onDoubleClick={() => openVaultModal(step.agent)}
                        >
                          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-none text-zinc-100">
                            {shortAgentTitle(step, 120)}
                          </span>
                          <Badge tone={statusTone[status]} size="compact" className="shrink-0">
                            {statusLabel[status]}
                          </Badge>
                        </Chip>
                      </div>
                    );
                  })}
                </div>
                ) : (
                  <EmptyWell>
                    <p className="text-sm font-medium text-zinc-300">No agents deployed</p>
                    <p className="mx-auto mt-2 max-w-md text-sm leading-snug text-zinc-400">
                      Start a task to track agent activities.
                    </p>
                  </EmptyWell>
                )}

                {agentDetailRow ? (
                <InsetPanel className="mt-4">
                  <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Pinned detail</div>
                      <div className="mt-1 text-[15px] font-semibold leading-snug text-zinc-50">{agentDetailRow.step.roleTitle}</div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 shrink-0 rounded-lg p-0 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
                      aria-label="Close pinned detail"
                      onClick={() => setAgentDetailId(null)}
                    >
                      <XIcon className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="mt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="info" size="compact">
                        Batch {agentDetailRow.step.phaseIndex + 1}
                      </Badge>
                      <Badge tone={statusTone[agentDetailRow.status]} size="compact">
                        {statusLabel[agentDetailRow.status]}
                      </Badge>
                    </div>
                    <div
                      className={cx(
                        INNER_PAD_X,
                        "pb-3 pt-1.5",
                        "hide-scrollbar mt-3 max-h-64 overflow-y-auto rounded-lg border border-white/[0.06] bg-black/25 text-sm leading-relaxed text-zinc-300"
                      )}
                    >
                      <p className="whitespace-pre-wrap">{agentDetailRow.step.instruction}</p>
                    </div>
                    {agentDetailRow.waitHint ? (
                      <Callout tone="warn" className="mt-2">
                        {agentDetailRow.waitHint}
                      </Callout>
                    ) : null}
                    <p className="mt-3 font-mono text-[10px] text-zinc-600">
                      Internal id · <span className="text-zinc-500">{agentDetailRow.step.agent}</span>
                    </p>
                  </div>
                  <div className="mt-4 flex items-center justify-end border-t border-white/10 pt-3">
                    <Button type="button" variant="secondary" size="sm" onClick={() => openVaultModal(agentDetailRow.step.agent)}>
                      <LockIcon className="h-4 w-4" />
                      Context
                    </Button>
                  </div>
                </InsetPanel>
              ) : null}
            </CardBody>
          </Card>
        </div>

        <div className="relative z-10 grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
          <Card
            className={cx(
              "flex min-h-0 flex-col overflow-hidden max-lg:min-h-[400px] lg:min-h-[min(70vh,640px)] lg:max-h-[min(70vh,720px)]"
            )}
          >
            <CardHeader className="shrink-0">
              <CardTitle className="min-h-[2rem] flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <span className="leading-none">Activity</span>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {state.isManagerLoading && state.isRunning ? (
                    <Badge tone="warn" size="compact">
                      Planning
                    </Badge>
                  ) : state.isRunning ? (
                    <Badge tone="info" size="compact">
                      In progress
                    </Badge>
                  ) : pauseGate ? (
                    <Badge tone="warn" size="compact">
                      Awaiting approval
                    </Badge>
                  ) : (
                    <Badge tone="neutral" size="compact">
                      Idle
                    </Badge>
                  )}
                </div>
              </CardTitle>
            </CardHeader>
            <CardBody className="flex min-h-0 flex-1 flex-col gap-3 !px-4 sm:!px-5">
              <div
                ref={activityLogRef}
                className="hide-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain"
              >
                <div className={cx(SURFACE_CARD_INNER, "flex min-h-full min-w-0 flex-col gap-3")}>
                  {state.trace.map((e) => (
                    <div key={e.id} className={traceRowClasses(e.actor)}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                          {actorBadge(e.actor, state.spawnPlan)}
                          <Badge tone={traceKindTone(e.kind)} size="compact">
                            {e.kind}
                          </Badge>
                        </div>
                        <span
                          suppressHydrationWarning
                          className="shrink-0 pt-0.5 text-[10px] tabular-nums text-zinc-500"
                        >
                          {formatTime(e.ts)}
                        </span>
                      </div>
                      <div className="mt-3 pl-1">
                        <div className="font-medium leading-snug text-zinc-100">{e.title}</div>
                        {e.detail ? (
                          <div className="mt-1.5 whitespace-pre-wrap text-zinc-400">{e.detail}</div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardBody>
          </Card>

          <Card
            className={cx(
              "flex min-h-0 flex-col overflow-hidden max-lg:min-h-[400px] lg:min-h-[min(70vh,640px)] lg:max-h-[min(70vh,720px)]"
            )}
          >
            <CardHeader className="shrink-0">
              <CardTitle className="min-h-[2rem] items-center">Results</CardTitle>
            </CardHeader>
            <CardBody className="flex min-h-0 flex-1 flex-col overflow-hidden ! sm:!px-5">
              <div
                ref={resultsPanelRef}
                className="hide-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain"
              >
                <div className={cx(SURFACE_CARD_INNER, "flex min-h-full min-w-0 flex-1 flex-col gap-3")}>
              {approvalNotice && approvalNotice.length > 0 ? (
                <div className={cx("shrink-0 rounded-xl border-0 bg-amber-500/[0.08] text-sm", INNER_PAD_X, "pb-3 pt-1.5")}>
                  <div className="font-semibold text-amber-100">Human review suggested</div>
                  <p className="mt-1 text-[13px] leading-relaxed text-amber-100/85">
                    At least one step is not safe to apply blindly. Below is what needs your judgment and why.
                  </p>
                  <ul className="mt-3 list-none space-y-4 pl-0">
                    {approvalNotice.map((item) => (
                      <li key={item.id} className="border-t border-amber-950/25 pt-4 first:border-t-0 first:pt-0">
                        <div className="font-medium text-zinc-100">{item.role}</div>
                        <p className="mt-1 text-[13px] leading-relaxed text-zinc-300">{item.reason}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={Boolean(revisePendingId)}
                            onClick={() => dismissApprovalItem(item.id)}
                          >
                            Accept as-is
                          </Button>
                        </div>
                        <div className={cx("mt-3", SURFACE_RESULTS_BLOCK)}>
                          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                            Disapprove — tell the model what to fix
                          </label>
                          <textarea
                            value={revisionFeedback[item.id] ?? ""}
                            onChange={(e) =>
                              setRevisionFeedback((r) => ({ ...r, [item.id]: e.target.value }))
                            }
                            rows={3}
                            placeholder="e.g. Use fewer assumptions; cite only the first source; don’t recommend medication."
                            disabled={revisePendingId !== null}
                            className={cx(
                              "hide-scrollbar w-full resize-y rounded-lg border-0 bg-black/40 px-2.5 py-2.5 text-[13px] leading-relaxed text-zinc-100",
                              "placeholder:text-zinc-600 focus:border-amber-400/35 focus:outline-none focus:ring-2 focus:ring-amber-500/25"
                            )}
                          />
                          <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            className="mt-2"
                            disabled={
                              revisePendingId !== null ||
                              !(revisionFeedback[item.id] ?? "").trim() ||
                              state.isRunning
                            }
                            onClick={() => void reviseStepWithFeedback(item.id)}
                          >
                            {revisePendingId === item.id ? "Revising…" : "Rerun this step with feedback"}
                          </Button>
                          <p className="mt-2 text-[11px] text-zinc-500">
                            The step’s worker receives your note, replaces its answer, and the final result is merged again.
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {state.orchestratorPlan ? (
                <AgentMap plan={state.orchestratorPlan} agentStatus={derivedAgentStatusMap} />
              ) : null}
              {state.spawnPlan.length > 0 ? (
                <div className={cx("shrink-0", SURFACE_RESULTS_BLOCK)}>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Plan</div>
                  <ol className="mt-2 list-decimal space-y-2 pl-5 text-xs text-zinc-300">
                    {state.spawnPlan.map((step) => (
                      <li key={`${step.step}-${step.agent}`} className="leading-relaxed">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-zinc-100">
                            #{step.step} · {shortAgentTitle(step, 48)}
                          </span>
                          <Badge tone="info" size="compact">
                            Batch {step.phaseIndex + 1}
                          </Badge>
                        </span>
                        <div
                          className={cx(
                            INNER_PAD_X,
                            "pb-2 pt-1",
                            "hide-scrollbar mt-1.5 max-h-52 overflow-y-auto rounded-md border border-white/[0.05] bg-black/20 text-[11px] leading-relaxed text-zinc-400"
                          )}
                        >
                          <span className="block whitespace-pre-wrap">{step.instruction}</span>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
              {(state.output.title || state.output.summary) ? (
                <div className={cx("shrink-0", SURFACE_RESULTS_BLOCK)}>
                  {state.output.title ? (
                    <div className="text-sm font-semibold text-zinc-100">{state.output.title}</div>
                  ) : null}
                  <p className={cx("text-sm text-zinc-400", state.output.title && "mt-1")}>{state.output.summary}</p>
                </div>
              ) : null}
              <div className="space-y-3">
                <div className="flex flex-col gap-4">
                  {state.output.sections.map((s, i) => (
                    <div key={`out-sec-${i}-${s.h}`} className={SURFACE_RESULTS_BLOCK}>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{s.h}</div>
                      <div className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-zinc-400">{s.p}</div>
                    </div>
                  ))}
                </div>
              </div>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      </main>

      {vaultModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/45 p-3 backdrop-blur-[2px] sm:items-center"
          role="presentation"
          onClick={() => setVaultModalOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Context"
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 p-4">
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-zinc-100">Context</h2>
                <p className="text-[11px] text-zinc-500">What each step may read and what was passed at run time</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-10 w-10 shrink-0 rounded-lg p-0 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
                aria-label="Close"
                onClick={() => setVaultModalOpen(false)}
              >
                <XIcon className="h-6 w-6" />
              </Button>
            </div>
            <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto p-4 space-y-4 text-xs">
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">Step</label>
                <Select
                  value={Object.keys(state.agents).includes(vaultModalAgent) ? vaultModalAgent : Object.keys(state.agents)[0] ?? ""}
                  onChange={(e) => {
                    const id = e.target.value;
                    setVaultModalAgent(id);
                    setState((s) => ({ ...s, selectedAgent: id }));
                  }}
                >
                  {Object.keys(state.agents).length === 0 ? (
                    <option value="">No steps yet</option>
                  ) : (
                    Object.keys(state.agents).map((id) => (
                      <option key={id} value={id}>
                        {(() => {
                          const st = state.spawnPlan.find((s) => s.agent === id);
                          return st ? `#${st.step} ${shortAgentTitle(st)}` : formatAgentLabel(id, state.spawnPlan);
                        })()}
                      </option>
                    ))
                  )}
                </Select>
              </div>

              {Object.keys(state.agents).length === 0 ? (
                <p className="text-zinc-500">Run a task first — agents appear here with their context budgets.</p>
              ) : (
                <>
                  <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                    <div className="font-medium text-zinc-200">Orchestrator bundle</div>
                    <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                      Keys this worker is allowed to read (narrow context = less noise, safer scope).
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-zinc-300">
                      {vaultAllowed.length ? (
                        vaultAllowed.map((key) => (
                          <li key={key}>
                            <span className="font-mono text-[11px] text-indigo-200/90">{key}</span>
                            <span className="text-zinc-500"> — {describeContextKey(key)}</span>
                          </li>
                        ))
                      ) : (
                        <li className="text-zinc-500">No keys listed for this step.</li>
                      )}
                    </ul>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                    <div className="font-medium text-zinc-200">Injected at run time</div>
                    <p className="mt-1 text-[11px] text-zinc-500">Same keys as above, as attached when this step started.</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {vaultInjected.length ? (
                        vaultInjected.map((key) => (
                          <Badge key={key} tone="info" size="md">
                            {key}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-zinc-500">Not started yet or keys not recorded.</span>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                    <div className="font-medium text-zinc-200">Referenced outputs</div>
                    <p className="mt-1 text-[11px] text-zinc-500">
                      Prior steps whose artifacts were eligible for this bundle (availability after run).
                    </p>
                    <ul className="mt-2 space-y-1.5 text-zinc-300">
                      {vaultAllowed
                        .filter((k) => k.startsWith("artifact:"))
                        .map((k) => {
                          const rid = k.slice("artifact:".length).trim();
                          const ok = rid && Object.prototype.hasOwnProperty.call(state.artifacts, rid);
                          return (
                            <li key={k} className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-[11px]">{rid}</span>
                              <Badge tone={ok ? "ok" : "neutral"} size="md">
                                {ok ? "Available" : "Pending / missing"}
                              </Badge>
                            </li>
                          );
                        })}
                      {!vaultAllowed.some((k) => k.startsWith("artifact:")) ? (
                        <li className="text-zinc-500">No cross-step artifact references in this bundle.</li>
                      ) : null}
                    </ul>
                  </div>

                  <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/5 p-3">
                    <div className="font-medium text-emerald-100/90">Output footprint</div>
                    <p className="mt-1 text-zinc-500">{vaultFootprint}</p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

