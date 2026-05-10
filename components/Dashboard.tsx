"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { BoltIcon, ChevronDownIcon, LockIcon, PlayIcon, ResetIcon, SparkIcon } from "@/components/icons";
import { CONTEXTOS_INPUT_KEY } from "@/lib/session-input";
import { cx, formatTime } from "@/lib/utils";

type AgentStatus = "idle" | "running" | "blocked" | "ok" | "warn" | "err";
type TraceKind = "action" | "context-grant" | "context-deny" | "breakpoint" | "conflict";
type MemoryKind = "decision" | "conflict" | "debt" | "intervention" | "rationale";
type ComplexityLevel = "low" | "medium" | "high" | "extreme";
type VaultStatus = "empty" | "created" | "locked" | "granted" | "denied";
type AgentKey = string;

type TraceEvent = { id: string; ts: number; actor: AgentKey | "system" | "human"; kind: TraceKind; title: string; detail?: string };
type MemoryItem = { id: string; ts: number; kind: MemoryKind; title: string; detail: string };
type SpawnStep = { step: number; agent: string; label: string };
type Breakpoint = { id: string; title: string; reason: string; after_step: number };
type ContextAccess = { allowed_context: string[]; denied_context: string[] };
type ManagerResponse = {
  complexity_level: ComplexityLevel;
  spawn_plan: SpawnStep[];
  reasoning: string;
  required_breakpoints: Breakpoint[];
  context_access: Record<string, ContextAccess>;
};

type VaultObject = "raw_input" | "parsed_json" | "metadata" | "analysis_scratchpad" | "provenance_graph" | "report_draft" | "final_report";

const VAULT_KEYS: VaultObject[] = [
  "raw_input",
  "parsed_json",
  "metadata",
  "analysis_scratchpad",
  "provenance_graph",
  "report_draft",
  "final_report"
];

const statusTone: Record<AgentStatus, Parameters<typeof Badge>[0]["tone"]> = {
  idle: "neutral",
  running: "info",
  blocked: "warn",
  ok: "ok",
  warn: "warn",
  err: "err"
};

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function now() {
  return Date.now();
}

function greek(index: number) {
  const chars = ["α", "β", "γ", "δ", "ε", "ζ", "η", "θ"];
  return chars[index] ?? `${index + 1}`;
}

function displayAgentName(id: string) {
  if (id === "manager") return "Manager";
  if (id === "json-structurer") return "JSON structurer";
  if (id === "summarizer") return "Summarizer";
  if (id.startsWith("worker-")) {
    const n = Number(id.split("-")[1] ?? "1");
    const idx = Math.max(n - 1, 0);
    return `Worker ${greek(idx)}`;
  }
  if (id === "ref-tracker") return "Reference Tracker";
  if (id === "doc-writer") return "Documentation Writer";
  if (id.startsWith("parser-")) {
    const idx = Math.max(Number(id.split("-")[1] ?? "1") - 1, 0);
    return `Parser ${greek(idx)}`;
  }
  if (id === "parser") return "Parser α";
  if (id.startsWith("analyzer-")) {
    const idx = Math.max(Number(id.split("-")[1] ?? "1") - 1, 0);
    return `Analyzer ${greek(idx)}`;
  }
  if (id === "analyzer") return "Analyzer α";
  return id;
}

function toneForVault(status: VaultStatus): Parameters<typeof Badge>[0]["tone"] {
  if (status === "granted") return "ok";
  if (status === "denied") return "err";
  if (status === "locked") return "warn";
  if (status === "created") return "info";
  return "neutral";
}

function toneForTrace(kind: TraceKind): Parameters<typeof Badge>[0]["tone"] {
  if (kind === "context-grant") return "ok";
  if (kind === "context-deny") return "err";
  if (kind === "breakpoint") return "warn";
  if (kind === "conflict") return "err";
  return "neutral";
}

function toneForMemory(kind: MemoryKind): Parameters<typeof Badge>[0]["tone"] {
  if (kind === "decision") return "info";
  if (kind === "conflict") return "warn";
  if (kind === "debt") return "err";
  if (kind === "intervention") return "ok";
  return "neutral";
}

function actorBadge(actor: TraceEvent["actor"]) {
  if (actor === "system") return <Badge tone="neutral">SYSTEM</Badge>;
  if (actor === "human") return <Badge tone="info">HUMAN</Badge>;
  return <Badge tone="info">{displayAgentName(actor)}</Badge>;
}

type ModalSize = "md" | "lg" | "xl";

function VaultAgentSelect({
  value,
  onChange,
  agents
}: {
  value: string;
  onChange: (id: string) => void;
  agents: Record<string, AgentStatus>;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const ids = Object.keys(agents);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  const triggerClasses = cx(
    "flex w-full items-center justify-between gap-2 rounded-xl border border-indigo-500/25 bg-zinc-950/90 px-3 py-2.5 text-left text-sm",
    "shadow-[inset_0_0_0_1px_rgba(99,102,241,0.1)]",
    "transition hover:border-indigo-400/40 hover:bg-zinc-900/95",
    "focus:outline-none focus:ring-2 focus:ring-indigo-500/45",
    open && "border-indigo-400/45 ring-1 ring-indigo-500/25"
  );

  const listId = React.useId();

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className={triggerClasses}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="min-w-0 truncate">
            <span className="font-medium text-zinc-100">{displayAgentName(value)}</span>
            <span className="ml-1.5 font-mono text-[11px] text-zinc-500">({value})</span>
          </span>
          {agents[value] ? <Badge tone={statusTone[agents[value]!]}>{agents[value]}</Badge> : null}
        </span>
        <ChevronDownIcon className={cx("h-4 w-4 shrink-0 text-indigo-300/70 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-activedescendant={`vault-agent-opt-${value}`}
          className={cx(
            "absolute left-0 right-0 top-[calc(100%+6px)] z-[60] m-0 max-h-56 list-none overflow-x-hidden overflow-y-auto rounded-xl",
            "border border-white/12 bg-zinc-900 p-0 shadow-2xl shadow-black/60 ring-1 ring-indigo-500/25"
          )}
        >
          {ids.map((id) => {
            const selected = id === value;
            return (
              <li key={id} className="m-0 w-full p-0" role="presentation">
                <button
                  id={`vault-agent-opt-${id}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={cx(
                    "flex min-h-[2.75rem] w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition",
                    selected
                      ? "bg-indigo-500/20 text-zinc-50"
                      : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800/95 hover:text-zinc-100"
                  )}
                  onClick={() => {
                    onChange(id);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{displayAgentName(id)}</span>
                    <span className="ml-1.5 font-mono text-[11px] text-zinc-500">({id})</span>
                  </span>
                  {agents[id] ? <Badge tone={statusTone[agents[id]!]}>{agents[id]}</Badge> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function ModalFrame({
  open,
  onClose,
  title,
  subtitle,
  children,
  size = "md"
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  size?: ModalSize;
}) {
  const titleId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const width = size === "xl" ? "max-w-5xl" : size === "lg" ? "max-w-3xl" : "max-w-lg";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-3 backdrop-blur-md sm:items-center sm:p-6"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx(
          width,
          "flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl border border-white/12 bg-zinc-900/95 shadow-2xl shadow-black/50 ring-1 ring-indigo-500/15"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 bg-gradient-to-r from-indigo-500/10 to-transparent px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-semibold tracking-wide text-zinc-50">
              {title}
            </h2>
            {subtitle ? <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{subtitle}</p> : null}
          </div>
          <Button variant="ghost" size="sm" className="shrink-0 text-zinc-400 hover:text-zinc-100" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function createInitialState() {
  const t0 = now();
  return {
    inputText: "",
    complexityLevel: "medium" as ComplexityLevel,
    managerReasoning: "Manager waiting for input.",
    agents: { manager: "idle" as AgentStatus } as Record<string, AgentStatus>,
    spawnPlan: [{ step: 1, agent: "manager", label: "Analyze input and build plan" }] as SpawnStep[],
    breakpoints: [] as Breakpoint[],
    pendingBreakpoint: null as Breakpoint | null,
    isRunning: false,
    isManagerLoading: false,
    isBreakpointPending: false,
    nextStepIndex: 0,
    selectedAgent: "manager",
    bornAgents: { manager: t0 } as Record<AgentKey, number>,
    contextAccess: {
      manager: { allowed_context: ["input_buffer", "runtime_state"], denied_context: ["external_network"] }
    } as Record<AgentKey, ContextAccess>,
    loadedContext: { manager: ["input_buffer"] } as Record<AgentKey, string[]>,
    vault: {
      raw_input: "empty",
      parsed_json: "empty",
      metadata: "empty",
      analysis_scratchpad: "empty",
      provenance_graph: "empty",
      report_draft: "empty",
      final_report: "empty"
    } as Record<VaultObject, VaultStatus>,
    conflicts: [] as string[],
    structuredJson: null as unknown | null,
    lastInfoSummary: "",
    trace: [
      {
        id: uid("tr"),
        ts: t0 - 1000,
        actor: "system",
        kind: "action",
        title: "Runtime initialized",
        detail: "Paste URLs → Manager plans agents → pages are fetched server-side → structured JSON + summary."
      }
    ] as TraceEvent[],
    memory: [] as MemoryItem[],
    output: {
      title: "ContextOS Runtime Report",
      summary: "Run Manager to generate a dynamic multi-agent plan.",
      sections: [{ h: "Status", p: "Runtime idle." }]
    }
  };
}

type State = ReturnType<typeof createInitialState>;

export function Dashboard() {
  const router = useRouter();
  const [state, setState] = React.useState<State>(() => createInitialState());
  const [vaultModalOpen, setVaultModalOpen] = React.useState(false);
  const [vaultModalAgent, setVaultModalAgent] = React.useState("manager");
  const [memoryModalOpen, setMemoryModalOpen] = React.useState(false);
  const [planModalOpen, setPlanModalOpen] = React.useState(false);

  React.useEffect(() => {
    try {
      const raw = sessionStorage.getItem(CONTEXTOS_INPUT_KEY);
      if (raw != null && raw.length > 0) {
        setState((s) => ({ ...s, inputText: raw }));
      }
    } catch {
      /* ignore */
    }
  }, []);

  React.useEffect(() => {
    if (!Object.prototype.hasOwnProperty.call(state.agents, vaultModalAgent)) {
      setVaultModalAgent(state.selectedAgent);
    }
  }, [state.agents, state.selectedAgent, vaultModalAgent]);

  const canApprove = state.isRunning && state.isBreakpointPending;
  const canContinue = state.isRunning && !state.isBreakpointPending;

  const timeline = React.useMemo(() => {
    const pick: Array<[string, (t: TraceEvent) => boolean]> = [
      ["Manager initialized", (t) => t.title.toLowerCase().includes("manager started")],
      ["Spawn plan generated", (t) => t.title.toLowerCase().includes("spawn plan generated")],
      ["Context granted", (t) => t.kind === "context-grant"],
      ["Context denied", (t) => t.kind === "context-deny"],
      ["Conflict detected", (t) => t.kind === "conflict"],
      ["Breakpoint triggered", (t) => t.kind === "breakpoint" && t.actor !== "human"],
      ["Human approved", (t) => t.actor === "human" && t.kind === "breakpoint"],
      ["Final report generated", (t) => t.title.toLowerCase().includes("execution complete")]
    ];
    return pick.map(([label, fn]) => ({ label, done: state.trace.some(fn) }));
  }, [state.trace]);

  function pushTrace(event: Omit<TraceEvent, "id" | "ts"> & { ts?: number }) {
    setState((s) => ({
      ...s,
      trace: [...s.trace, { id: uid("tr"), ts: event.ts ?? now(), actor: event.actor, kind: event.kind, title: event.title, detail: event.detail }]
    }));
  }

  function pushMemory(item: Omit<MemoryItem, "id" | "ts"> & { ts?: number }) {
    setState((s) => ({
      ...s,
      memory: [{ id: uid("mem"), ts: item.ts ?? now(), kind: item.kind, title: item.title, detail: item.detail }, ...s.memory]
    }));
  }

  function setAgentStatus(agent: AgentKey, status: AgentStatus) {
    setState((s) => ({ ...s, agents: { ...s.agents, [agent]: status } }));
  }

  function setVault(key: VaultObject, status: VaultStatus) {
    setState((s) => ({ ...s, vault: { ...s.vault, [key]: status } }));
  }

  function syncAgentsWithPlan(
    s: State,
    plan: SpawnStep[],
    contextAccess: Record<string, ContextAccess>,
    mode: "managerRun" | "preset"
  ): Pick<State, "agents" | "bornAgents" | "contextAccess" | "loadedContext" | "selectedAgent"> {
    const planAgents = new Set(plan.map((p) => p.agent));
    const nextAgents: Record<string, AgentStatus> = {};
    for (const step of plan) {
      if (nextAgents[step.agent] !== undefined) continue;
      nextAgents[step.agent] =
        step.agent === "manager" ? (mode === "managerRun" ? "running" : "idle") : "idle";
    }

    const nextBorn: Record<string, number> = {};
    for (const a of planAgents) {
      nextBorn[a] = s.bornAgents[a] ?? now();
    }

    const nextAccess: Record<string, ContextAccess> = {};
    const nextLoaded: Record<string, string[]> = {};
    for (const a of planAgents) {
      nextAccess[a] =
        contextAccess[a] ??
        s.contextAccess[a] ?? {
          allowed_context: [],
          denied_context: []
        };
      nextLoaded[a] = s.loadedContext[a] ?? [];
    }
    for (const step of plan) {
      if (contextAccess[step.agent]) {
        nextAccess[step.agent] = contextAccess[step.agent];
      }
    }

    const selectedAgent = planAgents.has(s.selectedAgent) ? s.selectedAgent : plan[0]?.agent ?? "manager";

    return {
      agents: nextAgents,
      bornAgents: nextBorn,
      contextAccess: nextAccess,
      loadedContext: nextLoaded,
      selectedAgent
    };
  }

  function ensureAgentsFromPlan(
    plan: SpawnStep[],
    contextAccess: Record<string, ContextAccess>,
    mode: "managerRun" | "preset"
  ) {
    setState((s) => ({ ...s, ...syncAgentsWithPlan(s, plan, contextAccess, mode) }));
  }

  function applyContextEvents(context: Record<string, ContextAccess>) {
    Object.entries(context).forEach(([agent, c]) => {
      pushTrace({ actor: agent, kind: "context-grant", title: `${displayAgentName(agent)} CONTEXT GRANT`, detail: c.allowed_context.join(", ") || "none" });
      pushTrace({ actor: agent, kind: "context-deny", title: `${displayAgentName(agent)} CONTEXT DENY`, detail: c.denied_context.join(", ") || "none" });
    });
    setVault("raw_input", "granted");
    setVault("parsed_json", "created");
    setVault("metadata", "created");
  }

  async function runManager() {
    setState((s) => ({
      ...s,
      isRunning: true,
      isManagerLoading: true,
      isBreakpointPending: false,
      pendingBreakpoint: null,
      nextStepIndex: 0,
      conflicts: [],
      structuredJson: null,
      lastInfoSummary: ""
    }));
    setAgentStatus("manager", "running");
    setVault("raw_input", "created");
    pushTrace({ actor: "manager", kind: "action", title: "Manager started", detail: "Input sent to Manager API." });

    try {
      const res = await fetch("/api/manager", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: state.inputText })
      });
      const payload = (await res.json()) as { ok: boolean; data?: ManagerResponse; error?: string };
      if (!res.ok || !payload.ok || !payload.data) throw new Error(payload.error ?? "Invalid manager response.");

      const manager = payload.data;
      ensureAgentsFromPlan(manager.spawn_plan, manager.context_access, "managerRun");
      applyContextEvents(manager.context_access);
      const bp = manager.required_breakpoints[0] ?? null;

      setState((s) => ({
        ...s,
        complexityLevel: manager.complexity_level,
        managerReasoning: manager.reasoning,
        spawnPlan: manager.spawn_plan,
        breakpoints: manager.required_breakpoints,
        pendingBreakpoint: bp,
        isBreakpointPending: Boolean(bp),
        isManagerLoading: false,
        selectedAgent: manager.spawn_plan[0]?.agent ?? "manager"
      }));

      pushTrace({
        actor: "manager",
        kind: "action",
        title: "Spawn plan generated",
        detail: `${manager.spawn_plan.length} steps, complexity ${manager.complexity_level}.`
      });
      pushMemory({ kind: "rationale", title: "Manager reasoning", detail: manager.reasoning });
      setAgentStatus("manager", bp ? "blocked" : "ok");

      if (bp) {
        pushTrace({ actor: "system", kind: "breakpoint", title: `BREAKPOINT: ${bp.title}`, detail: bp.reason });
        pushMemory({ kind: "intervention", title: "Breakpoint triggered", detail: `${bp.title} - ${bp.reason}` });
      } else {
        await continueExecution(0);
      }
    } catch (error) {
      setAgentStatus("manager", "err");
      setState((s) => ({ ...s, isRunning: false, isManagerLoading: false }));
      pushTrace({ actor: "system", kind: "action", title: "Manager failed", detail: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  async function continueExecution(fromIndex = state.nextStepIndex) {
    const steps = state.spawnPlan.filter((step) => step.agent !== "manager");
    if (!state.isRunning) return;

    const inputText = state.inputText;
    const managerReasoning = state.managerReasoning;
    const complexityLevel = state.complexityLevel;
    let priorOutputs = "";

    let pageContext = "";
    try {
      const fc = await fetch("/api/fetch-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: inputText })
      });
      const fcPayload = (await fc.json()) as {
        ok: boolean;
        data?: { pages: Array<{ url: string; ok: boolean; title?: string; text?: string; error?: string }> };
      };
      if (fc.ok && fcPayload.ok && fcPayload.data?.pages?.length) {
        const pages = fcPayload.data.pages;
        const allFailed = pages.every((p) => !p.ok || !(p.text?.length ?? 0));
        if (allFailed) {
          pushTrace({
            actor: "system",
            kind: "action",
            title: "URL prefetch failed",
            detail:
              "Servers timed out or blocked the scrape. Try again, paste excerpt/HTML below the URL, or set FETCH_TIMEOUT_MS / FETCH_MAX_RETRIES on the server."
          });
        }
        pageContext = pages
          .map((p) => {
            const head = p.ok ? `${p.url}${p.title ? ` — ${p.title}` : ""}` : `${p.url} (fetch failed)`;
            const body = p.ok ? p.text ?? "" : p.error ?? "";
            return `=== ${head} ===\n${body}`;
          })
          .join("\n\n");
        if (pageContext.length > 120_000) pageContext = `${pageContext.slice(0, 120_000)}\n…[truncated]`;
      }
    } catch {
      pageContext = "";
    }

    for (let i = fromIndex; i < steps.length; i += 1) {
      const step = steps[i];
      setState((s) => ({ ...s, nextStepIndex: i }));
      setAgentStatus(step.agent, "running");
      pushTrace({ actor: step.agent, kind: "action", title: `${displayAgentName(step.agent)} running`, detail: step.label });

      const allowed = state.contextAccess[step.agent]?.allowed_context ?? [];
      setState((s) => ({ ...s, loadedContext: { ...s.loadedContext, [step.agent]: allowed.slice(0, 2) } }));
      if (step.agent.includes("parser")) {
        setVault("parsed_json", "granted");
        setVault("metadata", "granted");
      }
      if (step.agent === "json-structurer") {
        setVault("parsed_json", "granted");
      }
      if (step.agent.includes("analyzer")) {
        setVault("analysis_scratchpad", "granted");
      }
      if (step.agent === "ref-tracker") {
        setVault("provenance_graph", "granted");
      }
      if (step.agent === "summarizer" || step.agent === "doc-writer") {
        setVault("report_draft", "granted");
      }

      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agent: step.agent,
            label: step.label,
            userInput: inputText,
            managerReasoning,
            complexityLevel,
            pageContext,
            priorOutputs,
            stepIndex: i,
            stepCount: steps.length
          })
        });
        const payload = (await res.json()) as {
          ok: boolean;
          data?: {
            output_summary: string;
            extracted_json: unknown | null;
            info_summary: string | null;
            conflict: string | null;
            requires_breakpoint: boolean;
            breakpoint_title: string | null;
            breakpoint_reason: string | null;
          };
          error?: string;
        };
        if (!res.ok || !payload.ok || !payload.data) {
          throw new Error(payload.error ?? "Agent step failed.");
        }
        const data = payload.data;
        const jsonSnip =
          data.extracted_json != null
            ? `\nextracted_json: ${JSON.stringify(data.extracted_json).slice(0, 4000)}${JSON.stringify(data.extracted_json).length > 4000 ? "…" : ""}`
            : "";
        priorOutputs += `\n\n### ${step.agent}\n${data.output_summary}${jsonSnip}`;
        pushTrace({
          actor: step.agent,
          kind: "action",
          title: `${displayAgentName(step.agent)} completed`,
          detail:
            data.output_summary.length > 1200 ? `${data.output_summary.slice(0, 1200)}…` : data.output_summary
        });
        setState((s) => ({
          ...s,
          structuredJson: data.extracted_json != null ? data.extracted_json : s.structuredJson,
          lastInfoSummary: data.info_summary?.trim() ? data.info_summary.trim() : s.lastInfoSummary
        }));
        if (data.conflict) {
          pushTrace({
            actor: step.agent,
            kind: "conflict",
            title: `CONFLICT: ${data.conflict}`,
            detail: data.output_summary
          });
          pushMemory({
            kind: "conflict",
            title: data.conflict,
            detail: `${displayAgentName(step.agent)} reported an extraction or content issue.`
          });
          setState((s) => ({ ...s, conflicts: [...s.conflicts, data.conflict!] }));
        }
        if (data.requires_breakpoint) {
          const title = data.breakpoint_title ?? "Human review required";
          const reason = data.breakpoint_reason ?? "Agent requested a checkpoint.";
          pushTrace({ actor: "system", kind: "breakpoint", title: `BREAKPOINT: ${title}`, detail: reason });
          pushMemory({ kind: "intervention", title: "Breakpoint triggered", detail: `${title} — ${reason}` });
          setState((s) => ({
            ...s,
            isBreakpointPending: true,
            pendingBreakpoint: { id: uid("bp"), title, reason, after_step: i + 1 },
            nextStepIndex: i + 1
          }));
          setAgentStatus(step.agent, "blocked");
          return;
        }
      } catch (error) {
        setAgentStatus(step.agent, "err");
        pushTrace({
          actor: step.agent,
          kind: "action",
          title: `${displayAgentName(step.agent)} failed`,
          detail: error instanceof Error ? error.message : "Unknown error"
        });
        setState((s) => ({ ...s, isRunning: false }));
        return;
      }

      setAgentStatus(step.agent, "ok");
      setState((s) => ({ ...s, nextStepIndex: i + 1 }));
    }

    setAgentStatus("manager", "ok");
    setVault("final_report", "created");
    setVault("final_report", "granted");
    setState((s) => ({
      ...s,
      isRunning: false,
      output: {
        title: "Structured ingest complete",
        summary: `${s.lastInfoSummary || `Complexity ${s.complexityLevel.toUpperCase()} — pipeline finished.`}`,
        sections: [
          { h: "Info summary", p: s.lastInfoSummary || "See trace and JSON artifact below." },
          {
            h: "AI-readable JSON (latest structurer output)",
            p:
              s.structuredJson != null
                ? JSON.stringify(s.structuredJson, null, 2).slice(0, 3500) +
                  (JSON.stringify(s.structuredJson).length > 3500 ? "…" : "")
                : "No extracted_json returned — check agent responses in the trace."
          },
          { h: "Manager reasoning", p: s.managerReasoning.slice(0, 1800) + (s.managerReasoning.length > 1800 ? "…" : "") },
          { h: "Conflicts", p: s.conflicts.join(" | ") || "None" }
        ]
      }
    }));
    pushTrace({ actor: "system", kind: "action", title: "Execution complete", detail: "Final structured JSON + summary ready." });
    pushMemory({ kind: "decision", title: "Ingest finished", detail: "URL text fetched server-side; agents produced JSON + summary." });
  }

  async function approveBreakpoint() {
    if (!state.pendingBreakpoint) return;
    pushTrace({ actor: "human", kind: "breakpoint", title: "Human approved breakpoint", detail: state.pendingBreakpoint.title });
    pushMemory({ kind: "intervention", title: "Human approval", detail: state.pendingBreakpoint.reason });
    setState((s) => ({ ...s, isBreakpointPending: false, pendingBreakpoint: null }));
    setAgentStatus("manager", "running");
    await continueExecution(state.nextStepIndex);
  }

  function resetDemo() {
    setState(createInitialState());
    setVaultModalOpen(false);
    setMemoryModalOpen(false);
    setPlanModalOpen(false);
    setVaultModalAgent("manager");
    try {
      sessionStorage.removeItem(CONTEXTOS_INPUT_KEY);
    } catch {
      /* ignore */
    }
  }

  function applySpawnPlanPreset(preset: "fast" | "deep") {
    const plan: SpawnStep[] =
      preset === "fast"
        ? [
            { step: 1, agent: "manager", label: "Plan URL ingest" },
            { step: 2, agent: "parser-1", label: "Segment fetched page text" },
            { step: 3, agent: "json-structurer", label: "Emit AI-readable JSON" },
            { step: 4, agent: "summarizer", label: "Info summary" }
          ]
        : [
            { step: 1, agent: "manager", label: "Plan URL ingest" },
            { step: 2, agent: "parser-1", label: "Segment page text" },
            { step: 3, agent: "parser-2", label: "Normalize metadata & links" },
            { step: 4, agent: "json-structurer", label: "Canonical structured JSON" },
            { step: 5, agent: "analyzer-1", label: "Validate extraction" },
            { step: 6, agent: "ref-tracker", label: "Source alignment check" },
            { step: 7, agent: "summarizer", label: "Executive info summary" },
            { step: 8, agent: "doc-writer", label: "Final narrative report" }
          ];
    const access: Record<string, ContextAccess> = {};
    for (const step of plan) {
      access[step.agent] = access[step.agent] ?? { allowed_context: ["parsed_json"], denied_context: ["external_network"] };
    }
    setState((s) => ({
      ...s,
      spawnPlan: plan,
      ...syncAgentsWithPlan(s, plan, access, "preset")
    }));
    pushMemory({ kind: "decision", title: `Spawn plan preset ${preset}`, detail: `Preset applied with ${plan.length} steps.` });
  }

  const inputMeta = state.inputText.trim() ? `${state.inputText.trim().split(/\s+/).length} words` : "empty";
  const modalAccess = state.contextAccess[vaultModalAgent] ?? { allowed_context: [], denied_context: [] };
  const modalLoaded = state.loadedContext[vaultModalAgent] ?? [];

  const openVaultModal = (agentId?: string) => {
    const id = agentId ?? state.selectedAgent;
    setVaultModalAgent(id);
    setState((s) => ({ ...s, selectedAgent: id }));
    setVaultModalOpen(true);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-zinc-950 text-zinc-100">
      <header className="shrink-0 border-b border-white/10 px-4 py-4">
        <div className="mx-auto flex w-full max-w-[min(1600px,100%)] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl border border-indigo-400/20 bg-indigo-500/15">
              <SparkIcon className="h-5 w-5 text-indigo-200" />
            </div>
            <div className="min-w-0">
              <div className="text-base font-semibold tracking-tight">ContextOS</div>
              <div className="text-[11px] text-zinc-500">URLs → fetch → agents → JSON & summary</div>
            </div>
            <Link
              href="/"
              className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs font-medium text-indigo-200/90 hover:border-indigo-400/25 hover:bg-indigo-500/10"
            >
              ← Landing
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => openVaultModal()} title="View vault & per-agent access">
              <LockIcon className="h-4 w-4" />
              Vault
            </Button>
            <Button variant="primary" size="sm" onClick={() => void runManager()} disabled={state.isManagerLoading || state.isRunning}>
              <PlayIcon className="h-4 w-4" />
              {state.isManagerLoading ? "Running…" : "Run"}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void approveBreakpoint()} disabled={!canApprove}>
              Approve
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void continueExecution()} disabled={!canContinue}>
              Continue
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPlanModalOpen(true)}>
              <BoltIcon className="h-4 w-4" />
              Plan
            </Button>
            <Button variant="danger" size="sm" onClick={resetDemo}>
              <ResetIcon className="h-4 w-4" />
              Reset
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[min(1600px,100%)] flex-1 flex-col gap-4 px-4 py-4 min-h-0">
        <div className="flex shrink-0 flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.02] px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2">
              <span className="pl-2 text-sm font-semibold tracking-tight text-zinc-100">Input</span>
              <Badge tone="info" size="md">
                {state.complexityLevel}
              </Badge>
              <Badge tone={state.inputText ? "ok" : "neutral"} size="md">
                {inputMeta}
              </Badge>
            </div>
            <Button variant="secondary" size="sm" type="button" className="shrink-0" onClick={() => router.push("/")}>
              Edit on landing
            </Button>
          </div>
          <textarea
            value={state.inputText}
            onChange={(e) => {
              const v = e.target.value;
              setState((s) => ({ ...s, inputText: v }));
              try {
                sessionStorage.setItem(CONTEXTOS_INPUT_KEY, v);
              } catch {
                /* ignore */
              }
            }}
            rows={4}
            className={cx(
              "min-h-[88px] max-h-40 w-full resize-y rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-sm leading-relaxed text-zinc-100",
              "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] placeholder:text-zinc-500",
              "focus:border-indigo-400/35 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
            )}
            placeholder="https://…"
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:items-stretch">
          {/* Timeline */}
          <Card className="flex max-h-[min(42vh,420px)] shrink-0 flex-col lg:h-auto lg:max-h-[min(70vh,720px)] lg:w-72 lg:max-w-[min(100%,20rem)] xl:w-80">
            <CardHeader className="shrink-0 pb-2">
              <CardTitle className="text-xs uppercase tracking-wide text-zinc-400">Timeline</CardTitle>
            </CardHeader>
            <CardBody className="min-h-0 flex-1 space-y-2 overflow-y-auto pt-0">
              <div className="text-[11px] text-zinc-500">
                {timeline.filter((t) => t.done).length}/{timeline.length} milestones
              </div>
              <div className="grid gap-1.5">
                {timeline.map((item) => (
                  <div
                    key={item.label}
                    className={cx(
                      "rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug",
                      item.done ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200/90" : "border-white/10 bg-black/25 text-zinc-500"
                    )}
                  >
                    {item.label}
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
          {/* Activity */}
          <Card className="flex min-h-[320px] flex-col lg:min-h-[min(70vh,640px)] lg:max-h-[min(70vh,720px)]">
            <CardHeader className="shrink-0 pb-2">
              <CardTitle className="flex-wrap">
                <div className="flex flex-wrap items-center gap-2">
                  <span>Activity</span>
                  <Badge tone={state.isBreakpointPending ? "warn" : "info"}>{state.isBreakpointPending ? "breakpoint" : "running"}</Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setMemoryModalOpen(true)}>
                    Memory
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardBody className="flex min-h-0 flex-1 flex-col gap-3 pt-0">
              <div className="flex shrink-0 gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:thin]">
                {Object.entries(state.agents).map(([agent, status]) => (
                  <button
                    key={agent}
                    type="button"
                    onClick={() => setState((s) => ({ ...s, selectedAgent: agent }))}
                    onDoubleClick={() => openVaultModal(agent)}
                    title="Double-click for vault"
                    className={cx(
                      "flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-left text-xs transition",
                      state.selectedAgent === agent ? "border-indigo-400/50 bg-indigo-500/15" : "border-white/10 bg-white/[0.03] hover:border-white/20"
                    )}
                  >
                    <span className="font-medium text-zinc-100">{displayAgentName(agent)}</span>
                    <Badge tone={statusTone[status]}>{status}</Badge>
                  </button>
                ))}
              </div>

              <div className="min-h-[180px] flex-1 space-y-2 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-2">
                {state.trace.map((e) => (
                  <div
                    key={e.id}
                    className={cx(
                      "rounded-lg border px-2.5 py-2 text-xs",
                      e.kind === "context-grant" && "border-emerald-400/25 bg-emerald-500/10",
                      e.kind === "context-deny" && "border-rose-400/25 bg-rose-500/10",
                      e.kind === "breakpoint" && "border-amber-400/25 bg-amber-500/10",
                      e.kind === "conflict" && "border-fuchsia-400/25 bg-fuchsia-500/10",
                      e.kind === "action" && "border-white/10 bg-black/30"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {actorBadge(e.actor)}
                        <Badge tone={toneForTrace(e.kind)}>{e.kind}</Badge>
                      </div>
                      <span className="shrink-0 text-[10px] text-zinc-500">{formatTime(e.ts)}</span>
                    </div>
                    <div className="mt-1 font-medium text-zinc-100">{e.title}</div>
                    {e.detail ? <div className="mt-0.5 text-zinc-400">{e.detail}</div> : null}
                  </div>
                ))}
              </div>

            </CardBody>
          </Card>

          {/* Results */}
          <Card className="flex min-h-[320px] flex-col lg:min-h-[min(70vh,640px)] lg:max-h-[min(70vh,720px)]">
            <CardHeader className="shrink-0 pb-2">
              <CardTitle className="flex-wrap">
                <span>Results</span>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => applySpawnPlanPreset("fast")}>
                    Fast preset
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => applySpawnPlanPreset("deep")}>
                    Deep preset
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setPlanModalOpen(true)}>
                    Spawn plan ({state.spawnPlan.length})
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardBody className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden pt-0">
              <div className="shrink-0">
                <div className="text-sm font-semibold text-zinc-100">{state.output.title}</div>
                <p className="mt-1 text-sm text-zinc-400">{state.output.summary}</p>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                <div className="grid gap-2 sm:grid-cols-2">
                  {state.output.sections.map((s) => (
                    <div key={s.h} className="rounded-xl border border-white/10 bg-black/25 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{s.h}</div>
                      <div className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-zinc-400">{s.p}</div>
                    </div>
                  ))}
                </div>
              </div>
            </CardBody>
          </Card>
          </div>
        </div>
      </main>

      <ModalFrame
        open={vaultModalOpen}
        onClose={() => setVaultModalOpen(false)}
        title="Context vault"
        subtitle="Per-agent access and vault slot states."
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">Agent</label>
            <VaultAgentSelect
              value={vaultModalAgent}
              agents={state.agents}
              onChange={(id) => {
                setVaultModalAgent(id);
                setState((s) => ({ ...s, selectedAgent: id }));
              }}
            />
          </div>
          <div>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">Vault slots</div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {VAULT_KEYS.map((k) => (
                <div key={k} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
                  <span className="text-zinc-400">{k}</span>
                  <Badge tone={toneForVault(state.vault[k])}>{state.vault[k]}</Badge>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-xs">
            <div className="font-medium text-zinc-200">{displayAgentName(vaultModalAgent)}</div>
            <div className="mt-2 text-emerald-300/90">
              <span className="text-zinc-500">Allowed — </span>
              {modalAccess.allowed_context.join(", ") || "none"}
            </div>
            <div className="mt-1 text-rose-300/90">
              <span className="text-zinc-500">Denied — </span>
              {modalAccess.denied_context.join(", ") || "none"}
            </div>
            <div className="mt-1 text-sky-300/90">
              <span className="text-zinc-500">Loaded — </span>
              {modalLoaded.join(", ") || "none"}
            </div>
          </div>
          <p className="text-[11px] text-zinc-500">Tip: double-click an agent chip in Activity to open the vault for that agent.</p>
        </div>
      </ModalFrame>

      <ModalFrame
        open={memoryModalOpen}
        onClose={() => setMemoryModalOpen(false)}
        title="Memory & breakpoints"
        subtitle={`${state.memory.length} entries · conflicts and breakpoint state`}
        size="xl"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            {state.memory.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-6 text-center text-[11px] text-zinc-500">
                No memory entries yet.
              </div>
            ) : (
              state.memory.map((m) => (
                <div key={m.id} className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone={toneForMemory(m.kind)}>{m.kind}</Badge>
                    <span className="text-[10px] text-zinc-500">{formatTime(m.ts)}</span>
                  </div>
                  <div className="mt-1 font-medium text-zinc-200">{m.title}</div>
                  <div className="text-zinc-500">{m.detail}</div>
                </div>
              ))
            )}
          </div>
          <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-[11px]">
            <span className="font-medium text-amber-200/90">Breakpoint</span>
            <div className="mt-1 text-amber-100/90">{state.pendingBreakpoint ? `${state.pendingBreakpoint.title}` : "None"}</div>
            <div className="mt-2 border-t border-amber-400/15 pt-2 text-zinc-400">
              Conflicts: {state.conflicts.join(" · ") || "none"}
            </div>
          </div>
        </div>
      </ModalFrame>

      <ModalFrame
        open={planModalOpen}
        onClose={() => setPlanModalOpen(false)}
        title="Spawn plan"
        subtitle={`${state.spawnPlan.length} steps · edit with Fast / Deep presets in Results`}
        size="lg"
      >
        <div className="space-y-2">
          {state.spawnPlan.map((step) => (
            <div
              key={`${step.step}-${step.agent}`}
              className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-[11px] text-zinc-300"
            >
              <span className="font-mono text-zinc-500">#{step.step}</span>{" "}
              <span className="font-medium text-zinc-100">{displayAgentName(step.agent)}</span>
              <span className="text-zinc-500"> — {step.label}</span>
            </div>
          ))}
        </div>
      </ModalFrame>
    </div>
  );
}

