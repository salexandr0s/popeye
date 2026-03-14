# Web Inspector — UI Surface

Popeye's first non-CLI client. A Vite + React SPA served by the daemon on loopback.

## Architecture

- **Stack:** Vite + React + TailwindCSS v4
- **Serving:** Static files served by `popeyed` via `@fastify/static`
- **Auth:** Token injected into `index.html` at serve time (`__POPEYE_AUTH_TOKEN__` placeholder replaced by daemon)
- **Location:** `apps/web-inspector/`
- **Build output:** `apps/web-inspector/dist/`

## Auth Token Delivery

The daemon reads `index.html` from the web inspector dist directory, replaces the `__POPEYE_AUTH_TOKEN__` placeholder with the real auth token, and serves the modified HTML. The token is available as `window.__POPEYE_AUTH_TOKEN__` in the SPA. Safe because loopback-only + same-process serving.

## Views and API Dependencies

| View | Route | API Endpoints |
|------|-------|---------------|
| Dashboard | `/` | `GET /v1/health`, `GET /v1/status`, `GET /v1/daemon/scheduler`, `GET /v1/usage/summary` |
| Command Center | `/command-center` | `GET /v1/status`, `GET /v1/daemon/scheduler`, `GET /v1/runs`, `GET /v1/runs/:id/events`, `GET /v1/jobs`, `GET /v1/interventions`, `GET /v1/receipts`, `GET /v1/tasks`, `GET /v1/usage/summary`, `GET /v1/events/stream` |
| Runs | `/runs`, `/runs/:id` | `GET /v1/runs`, `GET /v1/runs/:id`, `GET /v1/runs/:id/events`, `POST /v1/runs/:id/cancel`, `POST /v1/runs/:id/retry` |
| Jobs | `/jobs` | `GET /v1/jobs`, `POST /v1/jobs/:id/pause`, `POST /v1/jobs/:id/resume`, `POST /v1/jobs/:id/enqueue` |
| Receipts | `/receipts`, `/receipts/:id` | `GET /v1/receipts`, `GET /v1/receipts/:id` |
| Instructions | `/instructions` | `GET /v1/workspaces`, `GET /v1/instruction-previews/:scope` |
| Interventions | `/interventions` | `GET /v1/interventions`, `POST /v1/interventions/:id/resolve` |
| Memory | `/memory` | `GET /v1/memory/search?q=` |
| Usage & Security | `/usage` | `GET /v1/usage/summary`, `GET /v1/security/audit` |

## Design Token Usage

All visual values come from `~/.claude/uiux-contract/design_tokens.json`, mapped to CSS variables in `globals.css`. No hardcoded colors, spacing, or radii.

## Command Center surface notes

- The command center now keeps overview and inline detail panes on the same screen for run, job, and intervention drill-downs.
- Idle and stuck-risk badges are **operator heuristics** derived from observed run activity (`/v1/runs/:id/events` + SSE `run_started` / `run_event` / `run_completed`) and fall back to `startedAt` when no prior events are loaded.
- Related tools stay within Popeye boundaries: quick-open links to existing views plus copyable `pop` command snippets. The web inspector does not launch terminals directly.
- Layout, panel visibility, dense mode, detail width, and current inline selection persist locally in browser storage only.

## How to Add New Views

1. Create `src/views/my-view.tsx`
2. Add route in `src/app.tsx`
3. Add nav link in `src/layout/sidebar.tsx`
4. Add API hooks in `src/api/hooks.ts` if needed
5. Use shared components from `src/components/`

## Development

```bash
# Dev mode with proxy to daemon
cd apps/web-inspector && pnpm dev

# Production build
pnpm --filter @popeye/web-inspector build

# Served by daemon at http://127.0.0.1:3210/
```
