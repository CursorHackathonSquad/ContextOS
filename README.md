# OsanoAI

Next.js app: landing task input → **`/run`** dashboard with orchestrator plan, worker agents, activity trace, and merged results (SSE from **`/api/orchestrate`**).

## Layout

| Path | Role |
|------|------|
| `app/page.tsx` | Landing |
| `app/run/page.tsx` | Dashboard |
| `components/landing/` | Landing UI |
| `components/run/` | Dashboard, agent map |
| `components/ui/` | Shared UI primitives |
| `app/api/orchestrate/` | Plan + workers + merge (SSE) |
| `app/api/orchestrate/revise-step/` | Rerun one step with feedback |
| `lib/orchestrator/` | Plan, merge, workers, types |
| `lib/context/` | Context bundle, URL fetch (used by orchestrator) |
| `lib/net/` | SSE client, SSRF guard |
| `lib/ai/` | OpenAI-compatible client + token budgets |

## Environment

Configure an OpenAI-compatible endpoint (see `lib/ai/client.ts`):

- `CLOD_API_KEY`
- `CLOD_BASE_URL`
- `CLOD_MODEL`

Optional token overrides are documented in `lib/ai/latency.ts`.

## Run locally

```bash
npm install
npm run dev
```

Open the URL shown in the terminal (usually `http://localhost:3000`).
