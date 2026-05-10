# ContextOS

Futuristic dark dashboard for a **debuggable multi-agent runtime** (Next.js + TypeScript + Tailwind): real **Claude Manager** API, mocked downstream agents, context vault, conflicts, and breakpoints.

## Open as a project

1. In **Cursor** or **VS Code**: **File → Open Folder…** and choose the `ContextOS` directory (this repo root).
2. Install dependencies and run the dev server (see below).
3. Optional: turn it into a Git repo on your machine:

   ```bash
   cd ContextOS
   git init
   git add .
   git commit -m "Initial commit: ContextOS"
   ```

## Project layout

| Path | Purpose |
|------|---------|
| `app/page.tsx` | App entry; renders the dashboard |
| `components/Dashboard.tsx` | Main runtime UI, mock execution, vault, timeline |
| `app/api/manager/route.ts` | Manager agent: Claude JSON + fallback |
| `components/ui.tsx` | Shared UI primitives |
| `.env.example` | Copy to `.env.local`; set `ANTHROPIC_API_KEY` |

## What’s included

- Top input buffer for URLs / documents
- Left: Agent Runtime (Manager, Parsers, Analyzer, Reference Tracker, Documentation Writer)
- Center: Live Execution Trace (actions, context grants/denials, breakpoints)
- Right: Long-Term Memory (decisions, conflicts, technical debt, interventions, rationale)
- Bottom: Final output report card

## Demo controls

- Run Manager
- Approve Breakpoint
- Edit Spawn Plan
- Continue Execution
- Reset Demo

## Manager API

Manager is now a real API-backed agent via Claude.

Create `.env.local`:

```bash
ANTHROPIC_API_KEY=your_key_here
```

If no key is set, the app falls back to a deterministic local JSON manager response so the demo still works.

## Run locally

This repo is a standard Next.js (App Router) + TypeScript + Tailwind app.

1. Install Node dependencies with your preferred package manager (`npm`, `pnpm`, or `yarn`).
2. Start dev server:

```bash
npm install
npm run dev
```

Then open the local URL printed by the dev server (typically `http://localhost:3000`).

