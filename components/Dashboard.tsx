"use client";

import * as React from "react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Kbd } from "@/components/ui";
import { BoltIcon, LockIcon, PlayIcon, ResetIcon, SparkIcon } from "@/components/icons";
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

function escapeHtml(v: string) {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function prettyJsonHtml(value: unknown) {
  const raw = escapeHtml(JSON.stringify(value, null, 2));
  return raw
    .replace(/(&quot;)?(".*?")(\s*:)?/g, (_m, _q, key, colon) => {
      if (colon) return `<span class="text-sky-300">${key}</span><span class="text-zinc-500">:</span>`;
      return `<span class="text-emerald-300">${key}</span>`;
    })
    .replace(/\b(true|false)\b/g, `<span class="text-fuchsia-300">$1</span>`)
    .replace(/\b(null)\b/g, `<span class="text-zinc-500">$1</span>`)
    .replace(/\b(\d+)\b/g, `<span class="text-amber-300">$1</span>`);
}

function createInitialState() {
  const t0 = now();
  return {
    inputText: "",
    complexityLevel: "medium" as ComplexityLevel,
    managerReasoning: "Manager waiting for input.",
    managerRawJson: null as ManagerResponse | null,
    agents: { manager: "idle" as AgentStatus },
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
  const [state, setState] = React.useState<State>(() => createInitialState());
  const [isSpawnPlanOpen, setIsSpawnPlanOpen] = React.useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = React.useState(true);

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

  function ensureAgentsFromPlan(plan: SpawnStep[], contextAccess: Record<string, ContextAccess>) {
    const nextAgents: Record<string, AgentStatus> = { manager: "running" };
    const born: Record<string, number> = { ...state.bornAgents };
    const access: Record<string, ContextAccess> = { ...state.contextAccess, ...contextAccess };
    const loaded: Record<string, string[]> = { ...state.loadedContext };

    for (const step of plan) {
      if (!nextAgents[step.agent]) nextAgents[step.agent] = "idle";
      if (!born[step.agent]) born[step.agent] = now();
      if (!access[step.agent]) access[step.agent] = { allowed_context: [], denied_context: [] };
      if (!loaded[step.agent]) loaded[step.agent] = [];
    }

    setState((s) => ({ ...s, agents: { ...s.agents, ...nextAgents }, bornAgents: born, contextAccess: access, loadedContext: loaded }));
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
      ensureAgentsFromPlan(manager.spawn_plan, manager.context_access);
      applyContextEvents(manager.context_access);
      const bp = manager.required_breakpoints[0] ?? null;

      setState((s) => ({
        ...s,
        managerRawJson: manager,
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
        pageContext = fcPayload.data.pages
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
    setIsInspectorOpen(true);
    setIsSpawnPlanOpen(false);
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
    ensureAgentsFromPlan(plan, access);
    setState((s) => ({ ...s, spawnPlan: plan }));
    pushMemory({ kind: "decision", title: `Spawn plan preset ${preset}`, detail: `Preset applied with ${plan.length} steps.` });
  }

  const inputMeta = state.inputText.trim() ? `${state.inputText.trim().split(/\s+/).length} tokens` : "empty";
  const selectedAccess = state.contextAccess[state.selectedAgent] ?? { allowed_context: [], denied_context: [] };
  const selectedLoaded = state.loadedContext[state.selectedAgent] ?? [];

  return (
    <div className="min-h-dvh">
      <header className="mx-auto max-w-[1650px] px-5 pt-6 pb-4">
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl border border-indigo-400/20 bg-indigo-500/15 shadow-[0_0_0_1px_rgba(99,102,241,0.18)]">
              <SparkIcon className="h-5 w-5 text-indigo-200" />
            </div>
            <div>
              <div className="text-lg font-semibold tracking-tight">ContextOS</div>
              <div className="text-xs text-zinc-400">URL → fetched text → multi-agent JSON → summary · <Kbd>⌘</Kbd> + <Kbd>K</Kbd></div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="primary" onClick={() => void runManager()} disabled={state.isManagerLoading || state.isRunning}>
              <PlayIcon className="h-4 w-4" />
              {state.isManagerLoading ? "Running..." : "Run Manager"}
            </Button>
            <Button variant="secondary" onClick={() => void approveBreakpoint()} disabled={!canApprove}>
              <LockIcon className="h-4 w-4" />
              Approve Breakpoint
            </Button>
            <Button variant="ghost" onClick={() => setIsSpawnPlanOpen((v) => !v)}>
              <BoltIcon className="h-4 w-4" />
              Edit Spawn Plan
            </Button>
            <Button variant="secondary" onClick={() => void continueExecution()} disabled={!canContinue}>
              Continue Execution
            </Button>
            <Button variant="danger" onClick={resetDemo}>
              <ResetIcon className="h-4 w-4" />
              Reset Demo
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1650px] px-5 pb-10">
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12">
            <Card>
              <CardHeader>
                <CardTitle>
                  <div className="flex items-center gap-2">
                    <span>Input Buffer</span>
                    <Badge tone={state.inputText ? "ok" : "neutral"}>{inputMeta}</Badge>
                  </div>
                  <Badge tone="info">complexity: {state.complexityLevel.toUpperCase()}</Badge>
                </CardTitle>
              </CardHeader>
              <CardBody>
                <textarea
                  value={state.inputText}
                  onChange={(e) => setState((s) => ({ ...s, inputText: e.target.value }))}
                  className={cx("min-h-24 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm", "placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30")}
                  placeholder="Paste one or more https:// URLs (and optional notes). Manager delegates fetch → structured JSON → summary."
                />
              </CardBody>
            </Card>
          </div>

          <div className="col-span-12">
            <Card>
              <CardHeader>
                <CardTitle>
                  <span>Runtime Replay Timeline</span>
                  <Badge tone="neutral">{timeline.filter((t) => t.done).length}/{timeline.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardBody>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {timeline.map((item) => (
                    <div key={item.label} className={cx("rounded-xl border px-3 py-2 text-xs transition", item.done ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : "border-white/10 bg-white/[0.02] text-zinc-400")}>
                      {item.label}
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          </div>

          <div className="col-span-12 lg:col-span-3">
            <Card className="h-full">
              <CardHeader><CardTitle><span>Agent Runtime</span><Badge tone="neutral">{Object.keys(state.agents).length} agents</Badge></CardTitle></CardHeader>
              <CardBody className="space-y-2">
                {Object.entries(state.agents).map(([agent, status]) => (
                  <button
                    key={agent}
                    onClick={() => setState((s) => ({ ...s, selectedAgent: agent }))}
                    className={cx("w-full rounded-xl border px-3 py-2 text-left transition", "agent-enter", state.selectedAgent === agent ? "border-indigo-400/40 bg-indigo-500/10" : "border-white/10 bg-white/[0.02] hover:border-white/20")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-sm text-zinc-100">{displayAgentName(agent)}</div>
                        <div className="text-xs text-zinc-500">{agent}</div>
                      </div>
                      <Badge tone={statusTone[status]}>{status.toUpperCase()}</Badge>
                    </div>
                  </button>
                ))}
              </CardBody>
            </Card>
          </div>

          <div className="col-span-12 lg:col-span-6">
            <Card className="h-full">
              <CardHeader><CardTitle><span>Live Execution Trace</span><Badge tone={state.isBreakpointPending ? "warn" : "info"}>{state.isBreakpointPending ? "BREAKPOINT" : "FLOWING"}</Badge></CardTitle></CardHeader>
              <CardBody>
                <div className="max-h-[520px] space-y-2 overflow-auto">
                  {state.trace.map((e) => (
                    <div key={e.id} className={cx("rounded-xl border px-3 py-2", e.kind === "context-grant" && "border-emerald-400/30 bg-emerald-500/10", e.kind === "context-deny" && "border-rose-400/30 bg-rose-500/10", e.kind === "breakpoint" && "border-amber-400/30 bg-amber-500/10", e.kind === "conflict" && "border-fuchsia-400/30 bg-fuchsia-500/10", e.kind === "action" && "border-white/10 bg-black/20")}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {actorBadge(e.actor)}
                          <Badge tone={toneForTrace(e.kind)}>{e.kind.toUpperCase()}</Badge>
                        </div>
                        <div className="text-[11px] text-zinc-500">{formatTime(e.ts)}</div>
                      </div>
                      <div className="mt-1 text-sm text-zinc-100">{e.title}</div>
                      {e.detail ? <div className="mt-1 text-xs text-zinc-300">{e.detail}</div> : null}
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          </div>

          <div className="col-span-12 lg:col-span-3">
            <Card className="h-full">
              <CardHeader><CardTitle><span>Long-Term Memory</span><Badge tone="neutral">{state.memory.length} items</Badge></CardTitle></CardHeader>
              <CardBody className="space-y-2">
                <div className="max-h-[340px] space-y-2 overflow-auto">
                  {state.memory.map((m) => (
                    <div key={m.id} className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
                      <div className="flex items-center justify-between"><Badge tone={toneForMemory(m.kind)}>{m.kind.toUpperCase()}</Badge><span className="text-[11px] text-zinc-500">{formatTime(m.ts)}</span></div>
                      <div className="mt-1 text-sm text-zinc-100">{m.title}</div>
                      <div className="text-xs text-zinc-400">{m.detail}</div>
                    </div>
                  ))}
                </div>
                <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs">
                  <div className="font-medium text-amber-200">Breakpoint Console</div>
                  <div className="mt-1 text-amber-100">{state.pendingBreakpoint ? `${state.pendingBreakpoint.title}: ${state.pendingBreakpoint.reason}` : "No pending breakpoint."}</div>
                  <div className="mt-2 text-zinc-300">Conflicts: {state.conflicts.join(" | ") || "none"}</div>
                </div>
              </CardBody>
            </Card>
          </div>

          <div className="col-span-12 lg:col-span-4">
            <Card className="h-full">
              <CardHeader><CardTitle><span>Context Vault</span><Badge tone="info">{state.selectedAgent}</Badge></CardTitle></CardHeader>
              <CardBody className="space-y-3">
                <div className="grid grid-cols-1 gap-2">
                  {VAULT_KEYS.map((k) => (
                    <div key={k} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-xs">
                      <span className="text-zinc-300">{k}</span>
                      <Badge tone={toneForVault(state.vault[k])}>{state.vault[k].toUpperCase()}</Badge>
                    </div>
                  ))}
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs">
                  <div className="font-medium text-zinc-200">{displayAgentName(state.selectedAgent)} context</div>
                  <div className="mt-2 text-emerald-300">allowed: {selectedAccess.allowed_context.join(", ") || "none"}</div>
                  <div className="mt-1 text-rose-300">denied: {selectedAccess.denied_context.join(", ") || "none"}</div>
                  <div className="mt-1 text-sky-300">loaded: {selectedLoaded.join(", ") || "none"}</div>
                </div>
              </CardBody>
            </Card>
          </div>

          <div className="col-span-12 lg:col-span-8">
            <Card className="h-full">
              <CardHeader>
                <CardTitle>
                  <span>Final Output</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => applySpawnPlanPreset("fast")}>Fast preset</Button>
                    <Button size="sm" variant="secondary" onClick={() => applySpawnPlanPreset("deep")}>Deep preset</Button>
                    <Button size="sm" variant="ghost" onClick={() => setIsSpawnPlanOpen((v) => !v)}>{isSpawnPlanOpen ? "Hide" : "Show"} spawn plan</Button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardBody>
                <div className="text-base font-semibold text-zinc-100">{state.output.title}</div>
                <div className="mt-1 text-sm text-zinc-300">{state.output.summary}</div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {state.output.sections.map((s) => (
                    <div key={s.h} className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <div className="text-xs font-semibold text-zinc-200">{s.h}</div>
                      <div className="text-xs text-zinc-400">{s.p}</div>
                    </div>
                  ))}
                </div>
                {isSpawnPlanOpen ? (
                  <div className="mt-3 space-y-2">
                    {state.spawnPlan.map((step) => (
                      <div key={`${step.step}-${step.agent}`} className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-zinc-300">
                        #{step.step} {displayAgentName(step.agent)} - {step.label}
                      </div>
                    ))}
                  </div>
                ) : null}
              </CardBody>
            </Card>
          </div>

          <div className="col-span-12">
            <Card>
              <CardHeader>
                <CardTitle>
                  <span>Runtime JSON Inspector</span>
                  <Button size="sm" variant="ghost" onClick={() => setIsInspectorOpen((v) => !v)}>
                    {isInspectorOpen ? "Collapse" : "Expand"}
                  </Button>
                </CardTitle>
              </CardHeader>
              {isInspectorOpen ? (
                <CardBody>
                  <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                    <pre className="overflow-auto text-xs leading-relaxed" dangerouslySetInnerHTML={{ __html: prettyJsonHtml(state.managerRawJson ?? {
                      complexity_level: state.complexityLevel,
                      spawn_plan: state.spawnPlan,
                      reasoning: state.managerReasoning,
                      required_breakpoints: state.breakpoints,
                      context_access: state.contextAccess,
                      latest_structured_json: state.structuredJson
                    }) }} />
                  </div>
                </CardBody>
              ) : null}
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}

