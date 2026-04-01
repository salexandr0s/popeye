# @popeye/control-api

Fastify HTTP control API for the Popeye runtime. The single network surface
through which all clients (CLI, web inspector, Telegram adapter, macOS app)
interact with the runtime.

## Purpose

Mounts versioned REST endpoints on a Fastify server, enforcing bearer token
authentication on API requests and CSRF protection (token + Sec-Fetch-Site
validation) on all state-changing mutations. Bearer auth is role-scoped
(`operator`, `service`, `readonly`), and routes default to operator-only unless
explicitly downgraded. Browser clients can bootstrap a same-origin HttpOnly
browser-session cookie through a one-time `/v1/auth/exchange` nonce exchange
that also requires a valid operator bearer token;
browser sessions are operator-only. Provides SSE streaming for real-time event
delivery. Contains no business logic -- all operations delegate to
`PopeyeRuntimeService`.

## Layer

Interface. HTTP surface over the runtime; no business logic of its own.

## Provenance

New platform implementation.

## Key exports

| Export                | Description                                        |
| --------------------- | -------------------------------------------------- |
| `createControlApi()`  | Build and configure the Fastify server instance    |
| `ControlApiDependencies` | Input type requiring a `PopeyeRuntimeService`   |

## Endpoints (~82 routes)

| Area           | Routes                                                       |
| -------------- | ------------------------------------------------------------ |
| Auth           | `POST /v1/auth/exchange`                                     |
| Health         | `GET /v1/health`, `GET /v1/status`                           |
| Daemon         | `GET /v1/engine/capabilities`, `GET /v1/daemon/state`, `GET /v1/daemon/scheduler` |
| Resources      | `GET /v1/workspaces`, `GET /v1/projects`, `GET /v1/agent-profiles`, `GET /v1/profiles`, `GET /v1/profiles/:id` |
| Tasks          | `GET /v1/tasks`, `GET /v1/tasks/:id`, `POST /v1/tasks`      |
| Jobs           | `GET /v1/jobs`, `POST /v1/jobs/:id/pause|resume|enqueue`     |
| Runs           | `GET /v1/runs`, `GET /v1/runs/:id`, `GET /v1/runs/:id/envelope`, `POST /v1/runs/:id/retry|cancel` |
| Receipts       | `GET /v1/receipts`, `GET /v1/receipts/:id`                   |
| Recall         | `GET /v1/recall/search`, `GET /v1/recall/:kind/:id`          |
| Instructions   | `GET /v1/instruction-previews/:scope`                        |
| Interventions  | `GET /v1/interventions`, `POST /v1/interventions/:id/resolve`|
| Connections    | `GET /v1/connections`, `POST /v1/connections/oauth/start`, `GET /v1/connections/oauth/sessions/:id`, `GET /v1/connections/oauth/callback`, `POST /v1/connections`, `PATCH /v1/connections/:id`, `DELETE /v1/connections/:id` |
| Email          | `GET /v1/email/accounts`, `GET /v1/email/threads`, `GET /v1/email/threads/:id`, `GET /v1/email/messages/:id`, `GET /v1/email/digest`, `GET /v1/email/search`, `POST /v1/email/accounts`, `POST /v1/email/sync`, `POST /v1/email/digest`, `GET /v1/email/providers`, `POST /v1/email/drafts`, `PATCH /v1/email/drafts/:id` |
| Calendar       | `GET /v1/calendar/accounts`, `GET /v1/calendar/events`, `GET /v1/calendar/events/:id`, `GET /v1/calendar/search`, `GET /v1/calendar/digest`, `GET /v1/calendar/availability`, `POST /v1/calendar/accounts`, `POST /v1/calendar/sync`, `POST /v1/calendar/events`, `PATCH /v1/calendar/events/:id` |
| GitHub         | `GET /v1/github/accounts`, `GET /v1/github/repos`, `GET /v1/github/prs`, `GET /v1/github/prs/:id`, `GET /v1/github/issues`, `GET /v1/github/issues/:id`, `GET /v1/github/notifications`, `GET /v1/github/digest`, `GET /v1/github/search`, `POST /v1/github/sync`, `POST /v1/github/comments`, `POST /v1/github/notifications/mark-read` |
| Todos          | `GET /v1/todos/accounts`, `GET /v1/todos/items`, `GET /v1/todos/items/:id`, `GET /v1/todos/search`, `GET /v1/todos/digest`, `POST /v1/todos/accounts`, `POST /v1/todos/items`, `POST /v1/todos/items/:id/complete`, `POST /v1/todos/sync` |
| People         | `GET /v1/people`, `GET /v1/people/search`, `GET /v1/people/:id`, `PATCH /v1/people/:id`, `POST /v1/people/merge`, `POST /v1/people/:id/split`, `POST /v1/people/identities/attach`, `POST /v1/people/identities/:id/detach` |
| File roots     | `GET /v1/files/roots`, `POST /v1/files/roots`, `GET /v1/files/roots/:id`, `PATCH /v1/files/roots/:id`, `DELETE /v1/files/roots/:id`, `GET /v1/files/search`, `GET /v1/files/documents/:id`, `POST /v1/files/roots/:id/reindex` |
| Memory         | `GET /v1/memory/search`, `GET /v1/memory`, `GET /v1/memory/:id`, `GET /v1/memory/audit`, `POST /v1/memory/maintenance`, `POST /v1/memory/:id/promote/propose`, `POST /v1/memory/:id/promote/execute` |
| Messages       | `POST /v1/messages/ingest`, `GET /v1/messages/:id`           |
| Secrets        | `POST /v1/secrets`                                           |
| Security       | `GET /v1/security/audit`, `GET /v1/security/csrf-token`      |
| Usage          | `GET /v1/usage/summary`                                      |
| Events         | `GET /v1/events/stream` (SSE)                                |

## Dependencies

- `@popeye/contracts` -- Zod schemas for request/response validation
- `@popeye/runtime-core` -- `PopeyeRuntimeService` and auth utilities
- `fastify` -- HTTP framework
- `@fastify/sensible` -- error handling utilities

## Usage

```ts
import { createControlApi } from '@popeye/control-api';

const app = await createControlApi({ runtime });
await app.listen({ host: '127.0.0.1', port: 18789 });
```

See `src/index.test.ts`, `src/contract.test.ts`, `src/csrf.test.ts`,
`src/sec-fetch.test.ts`, and `src/sse.test.ts` for API contract and
security enforcement tests.

### Browser bootstrap

The web inspector does not receive the long-lived bearer token in HTML. Instead:

1. the daemon serves HTML with a one-time bootstrap nonce
2. the inspector presents an unlock modal only when a browser session is needed
3. the browser posts the nonce to `POST /v1/auth/exchange` with `Authorization: Bearer <operator-token>`
4. the control API sets an HttpOnly `popeye_auth` browser-session cookie
5. subsequent same-origin requests rely on the cookie plus CSRF token

The bearer token is used only for the exchange request, stays in memory only,
and is not persisted in browser cookies or browser storage by the control API.

### Role model

- `readonly`: non-mutating observability routes and SSE
- `service`: readonly + local automation mutations (task/job/run/message relay)
- `operator`: full access, including browser-session minting, profiles, unified
  recall, memory maintenance, and security surfaces

Legacy auth files with a single rotating token are still accepted and treated
as `operator`.

### Memory promotion

The memory API includes a two-step promotion flow:

1. `POST /v1/memory/:id/promote/propose` with `{ targetPath }`
2. Review the returned `{ memoryId, targetPath, diff, approved, promoted }`
3. `POST /v1/memory/:id/promote/execute` with the approved payload

Promotion routes are covered by contract and behavior tests in
`src/contract.test.ts` and `src/index.test.ts`.

### Connection and file-root policy surfaces

- Connection reads include an additive `policy` summary with readiness,
  secret status, approval posture, and non-sensitive diagnostics.
- Connection reads also include additive `health` and `sync` rollups so the
  inspector and CLI can show stale credentials, provider failures, cursor
  presence, and last-success information without reading capability stores
  directly.
- Connection reads also include typed `resourceRules` and operator-visible
  `health.remediation` guidance so reconnect posture and write-target policy do
  not depend on legacy allowlist strings.
- Browser OAuth is the blessed connect path for Gmail, Google Calendar, and
  GitHub. The callback route remains loopback-only and does not require the
  long-lived bearer token, but it still completes through the runtime and
  never persists provider secrets in logs or receipts.
- The same OAuth start route also handles reconnect and reauthorize flows when
  an existing `connectionId` is supplied.
- Invalid provider/domain combinations fail closed with
  `400 { error: "invalid_connection" }`.
- File-root registration rejects runtime-managed directories with
  `400 { error: "invalid_file_root" }` and emits `security_audit` evidence.
- File-root search/reindex operations fail closed with
  `400 { error: "invalid_file_root" }` when the target root is missing,
  disabled, or outside the requested workspace. These denials emit
  `security_audit.code === "file_root_policy_denied"`.
- Account-scoped capability reads/searches/digests route through centralized
  connection guards and fail closed with domain-specific `400` errors when the
  backing connection policy is invalid.
- Provider mutations now route through the same evaluator-backed approval path:
  Gmail drafts, Google Calendar event create/update, GitHub comments, and
  GitHub notification mark-read all enforce allowlists plus approval/grant
  policy before the provider call runs.
- Google Tasks now uses the shared browser OAuth routes for the blessed todo
  connect flow; the runtime stores the OAuth secret in the secret store,
  auto-registers the matching account, and keeps todo provider wiring inside
  the runtime/connection boundary.
- People now has first-class list/search/detail/edit/merge/split/attach/detach
  routes backed by the local derived-first identity graph built from Gmail,
  Calendar, and GitHub sync data.

### Receipt observability

Receipt reads now include an additive `runtime` section when available:

- `projectId`
- `profileId`
- `execution` summary (mode, memory/recall scope, filesystem/context-release
  policy, session policy, warnings)
- `contextReleases` summary for recorded context-release events
- `timeline` entries with normalized `kind`, `severity`, `code`, `title`,
  `detail`, `source`, and operator-safe `metadata`

The timeline is the canonical per-run policy/forensics view in the inspector
receipt detail page.

### Instruction preview validation

`GET /v1/instruction-previews/:scope?projectId=...` validates that the project
belongs to the requested workspace. Unknown workspace/project IDs return `404`,
while a cross-workspace mismatch returns `400 { error: "invalid_context" }`.

### Profile-aware task creation

`POST /v1/tasks` validates profile/workspace/project compatibility before the
task is accepted. Unknown profiles and invalid profile/context combinations
return `400` errors rather than creating partially runnable tasks.

### Memory location filters

`GET /v1/memory/search` and `GET /v1/memory` accept explicit `workspaceId`,
`projectId`, and `includeGlobal` filters in addition to the legacy `scope`
string. Responses include `workspaceId` and `projectId` so callers can enforce
project-aware retrieval without inferring location solely from `scope`.

### Unified recall

`GET /v1/recall/search` and `GET /v1/recall/:kind/:id` expose a normalized
historical retrieval surface over runtime artifacts:

- receipts
- run events
- accepted messages
- ingress decisions
- interventions
- durable memory references

The routes are intentionally operator-only in this slice because recall can
surface durable memory references and full artifact content. Agent-facing recall
stays scoped through the runtime-owned `popeye_recall_search` tool instead of
direct interface bypasses.
