# Web Inspector — UI Surface

Popeye's first non-CLI client. A Vite + React SPA served by the daemon on loopback.

## Architecture

- **Stack:** Vite + React + TailwindCSS v4
- **Serving:** Static files served by `popeyed` via `@fastify/static`
- **Auth:** One-time bootstrap nonce injected into `index.html`, then exchanged via `POST /v1/auth/exchange` using an operator bearer token for an HttpOnly browser-session cookie; mutations then fetch a CSRF token from `GET /v1/security/csrf-token`
- **Location:** `apps/web-inspector/`
- **Build output:** `apps/web-inspector/dist/`

## Browser auth bootstrap

The daemon injects `window.__POPEYE_BOOTSTRAP_NONCE__` into the served HTML. On first use, the SPA:

1. opens a dedicated unlock modal if no valid browser session is already present
2. POSTs the nonce to `/v1/auth/exchange` with `Authorization: Bearer <operator-token>`
3. receives an HttpOnly `popeye_auth` browser-session cookie
4. performs same-origin GET requests with the cookie
5. fetches a CSRF token from `/v1/security/csrf-token` before POST mutations

The bearer token is used only to mint the browser session and is not stored in
browser cookies or browser storage by Popeye. The unlock modal keeps the token
in memory only long enough to complete the exchange and surfaces inline retry
errors for invalid tokens, expired nonces, or daemon unavailability.

## Views and API Dependencies

| View | Route | API Endpoints |
|------|-------|---------------|
| Dashboard | `/` | `GET /v1/health`, `GET /v1/status`, `GET /v1/daemon/scheduler`, `GET /v1/usage/summary` |
| Command Center | `/command-center` | `GET /v1/status`, `GET /v1/daemon/scheduler`, `GET /v1/runs`, `GET /v1/runs/:id/events`, `GET /v1/jobs`, `GET /v1/interventions`, `GET /v1/receipts`, `GET /v1/tasks`, `GET /v1/usage/summary`, `GET /v1/events/stream` |
| Runs | `/runs`, `/runs/:id` | `GET /v1/runs`, `GET /v1/runs/:id`, `GET /v1/runs/:id/events`, `POST /v1/runs/:id/cancel`, `POST /v1/runs/:id/retry` |
| Jobs | `/jobs` | `GET /v1/jobs`, `POST /v1/jobs/:id/pause`, `POST /v1/jobs/:id/resume`, `POST /v1/jobs/:id/enqueue` |
| Receipts | `/receipts`, `/receipts/:id` | `GET /v1/receipts`, `GET /v1/receipts/:id` |
| Instructions | `/instructions` | `GET /v1/workspaces`, `GET /v1/instruction-previews/:scope`, optional `?projectId=` |
| Interventions | `/interventions` | `GET /v1/interventions`, `POST /v1/interventions/:id/resolve` |
| Memory | `/memory` | `GET /v1/memory/search?q=...&full=true&limit=20` |
| Usage & Security | `/usage` | `GET /v1/usage/summary`, `GET /v1/security/audit` |

## Design Token Usage

All visual values come from `~/.claude/uiux-contract/design_tokens.json`, mapped to CSS variables in `globals.css`. No hardcoded colors, spacing, or radii.

## Command Center surface notes

- The command center now keeps overview and inline detail panes on the same screen for run, job, and intervention drill-downs.
- Idle and stuck-risk badges are **operator heuristics** derived from observed run activity (`/v1/runs/:id/events` + SSE `run_started` / `run_event` / `run_completed`) and fall back to `startedAt` when no prior events are loaded.
- Related tools stay within Popeye boundaries: quick-open links to existing views plus copyable `pop` command snippets. The web inspector does not launch terminals directly.
- Layout, panel visibility, dense mode, detail width, and current inline selection persist locally in browser storage only.

## Receipt detail surface notes

- Receipt detail renders the additive `receipt.runtime.timeline` as a **Policy Timeline**.
- The timeline is snapshot-based, ordered chronologically, and combines run
  events, policy denials, approvals, context releases, and the terminal receipt
  outcome into one operator-readable view.
- Timeline metadata is intentionally operator-safe and does not expose secret
  values.

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
