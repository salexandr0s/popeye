# Control API

The Popeye control API is a Fastify HTTP server bound to `127.0.0.1` only. All endpoints are versioned under `/v1/`. The runtime service (`PopeyeRuntimeService`) backs every endpoint.

## Authentication

Popeye supports two authenticated client modes:

1. **Bearer auth** for CLI/API clients. The token is validated against the auth
   store file specified by `config.authFile`. The store is role-scoped:
   `operator`, `service`, and `readonly`. Token rotation is supported per role:
   during the overlap window, both the current and next tokens are accepted.
   Legacy single-token auth files still load as `operator`.
2. **Browser session auth** for the web inspector. A one-time bootstrap nonce
   is exchanged at `POST /v1/auth/exchange` for an HttpOnly `popeye_auth`
   browser-session cookie, but the exchange itself now requires a valid
   `Authorization: Bearer <operator-token>` header. This cookie is **not** the
   long-lived bearer token and always carries `operator` authority.

Unauthenticated requests receive `401 { error: "unauthorized" }`.

## Route authorization

Routes are role-gated in addition to authentication:

- `readonly` — health, status, scheduler/daemon state, event stream, usage,
  receipt/run/job/task reads, session reads, instruction previews, and other
  non-mutating observability reads
- `service` — everything `readonly` can do, plus local automation mutations
  such as task creation, job enqueue/pause/resume, run retry/cancel, message
  ingest, and Telegram relay state updates
- `operator` — everything, including browser-session minting, profiles, security
  audit, memory maintenance/promotion, and other operator-only control surfaces

Routes default to `operator` unless explicitly downgraded.

Memory routes are explicitly operator-only in this phase, including
search/read/maintenance/promotion surfaces. Browser sessions remain
operator-authority only, and legacy single-token auth files still normalize to
`operator`.

## CSRF Protection

All mutating methods (`POST`, `PUT`, `PATCH`, `DELETE`) require two additional checks:

1. **CSRF token** -- the `x-popeye-csrf` header must contain a valid token obtained from `GET /v1/security/csrf-token`.
2. **Sec-Fetch-Site** -- if present, must be `same-origin` or `none`. Cross-site requests are blocked with `403 { error: "csrf_cross_site_blocked" }`.

Invalid CSRF tokens return `403 { error: "csrf_invalid" }`.

`POST /v1/auth/exchange` is the single mutation exempt from CSRF because it
requires operator bearer auth and a valid daemon-issued nonce.

## Endpoints

### Health and status

| Method | Path | Description | Response shape |
|--------|------|-------------|----------------|
| GET | `/v1/health` | Liveness check | `{ ok: boolean, startedAt: string }` |
| GET | `/v1/status` | Daemon status summary | `DaemonStatusResponse` |
| GET | `/v1/daemon/state` | Internal daemon state | `DaemonStateRecord` |
| GET | `/v1/daemon/scheduler` | Scheduler status | `SchedulerStatusResponse` |

### Workspaces and projects

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/workspaces` | List all workspaces |
| GET | `/v1/projects` | List all projects |
| GET | `/v1/agent-profiles` | List agent profiles |
| GET | `/v1/profiles` | List execution profiles |
| GET | `/v1/profiles/:id` | Get one execution profile |

### Tasks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/tasks` | List all tasks |
| POST | `/v1/tasks` | Create a task. Body validated against `TaskCreateInputSchema`. Fields: `workspaceId` (default `"default"`), `projectId`, `title`, `prompt`, `source`, `autoEnqueue` (default `true`). Returns `{ task, job, run }`. |

### Jobs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/jobs` | List all jobs |
| GET | `/v1/jobs/:id` | Get a single job. Returns 404 if not found. |
| GET | `/v1/jobs/:id/lease` | Get the lease for a job. Returns 404 if no lease. |
| POST | `/v1/jobs/:id/pause` | Pause a job |
| POST | `/v1/jobs/:id/resume` | Resume a paused job |
| POST | `/v1/jobs/:id/enqueue` | Re-enqueue a job |

### Runs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/runs` | List all runs |
| GET | `/v1/runs/:id` | Get a single run. Returns 404 if not found. |
| GET | `/v1/runs/:id/envelope` | Get the persisted execution envelope for a run. Returns 404 if not found. |
| GET | `/v1/runs/:id/receipt` | Get the latest receipt for a run. Returns 404 if none exists yet. Receipts may include additive runtime execution/context-release summaries plus a chronological policy timeline. |
| GET | `/v1/runs/:id/reply` | Get the packaged terminal reply for a run. Returns 404 if the run does not exist and `409 { error: "run_not_terminal" }` if no terminal receipt exists yet. |
| GET | `/v1/runs/:id/events` | List engine events for a run |
| POST | `/v1/runs/:id/retry` | Retry a run by creating a new job |
| POST | `/v1/runs/:id/cancel` | Cancel an active or queued run |

### Receipts

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/receipts/:id` | Get a receipt by ID. Returns 404 if not found. When present, `receipt.runtime.timeline` is the canonical per-run policy/forensics summary. |

Receipt reads may include an additive `runtime` section with:

- `projectId`
- `profileId`
- `execution` summary
- `contextReleases` summary
- `timeline` entries with normalized `kind`, `severity`, `code`, `title`,
  `detail`, `source`, and operator-safe `metadata`

### Instructions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/instruction-previews/:scope` | Preview compiled instructions for a workspace scope. Optional query: `projectId` to include project context. Returns `400 { error: "invalid_context" }` if the project belongs to a different workspace, and `404` for unknown workspace/project IDs. |

### Interventions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/interventions` | List all interventions |
| POST | `/v1/interventions/:id/resolve` | Resolve an open intervention |

### Connections

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/connections` | List connections. Optional query: `domain`. Returned records include an additive `policy` summary (`status`, `secretStatus`, `mutatingRequiresApproval`, `diagnostics`). |
| POST | `/v1/connections` | Create a connection. Invalid provider/domain combinations or missing secret refs fail closed with `400 { error: "invalid_connection" }`. |
| PATCH | `/v1/connections/:id` | Update a connection. Returns 404 if not found and `400 { error: "invalid_connection" }` for policy validation failures. |
| DELETE | `/v1/connections/:id` | Delete a connection. Returns 404 if not found. |

### File roots

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/files/roots` | List file roots. Optional query: `workspaceId`. |
| POST | `/v1/files/roots` | Register a file root. Runtime-managed directories and duplicate enabled roots fail closed with `400 { error: "invalid_file_root" }`. |
| GET | `/v1/files/roots/:id` | Get a file root by ID. Returns 404 if not found. |
| PATCH | `/v1/files/roots/:id` | Update a file root. Returns 404 if not found. |
| DELETE | `/v1/files/roots/:id` | Disable a file root. Returns 404 if not found. |
| GET | `/v1/files/search` | Search indexed files within registered roots. Disabled, unknown, or workspace-mismatched roots fail closed with `400 { error: "invalid_file_root" }` and emit `file_root_policy_denied`. |
| GET | `/v1/files/documents/:id` | Read an indexed document. Returns 404 if the document is missing or its file root is no longer policy-allowed. |
| POST | `/v1/files/roots/:id/reindex` | Reindex one file root. Disabled or unknown roots fail closed with `400 { error: "invalid_file_root" }` and emit `file_root_policy_denied`. |

### Messages

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/messages/ingest` | Ingest a message (Telegram, manual, or API). Body validated against `IngestMessageInputSchema`. This is the current Telegram ingress boundary. |
| GET | `/v1/messages/:id` | Get a message by ID. Returns 404 if not found. |
| GET | `/v1/telegram/relay/checkpoint?workspaceId=...` | Read the durable Telegram long-poll checkpoint for a workspace. |
| POST | `/v1/telegram/relay/checkpoint` | Persist the durable Telegram long-poll checkpoint. |
| POST | `/v1/telegram/replies/:chatId/:telegramMessageId/mark-sending` | Durably claim a Telegram reply delivery attempt before calling `sendMessage`. |
| POST | `/v1/telegram/replies/:chatId/:telegramMessageId/mark-pending` | Reset a Telegram reply delivery back to `pending` after a definitive retryable Bot API failure. |
| POST | `/v1/telegram/replies/:chatId/:telegramMessageId/mark-uncertain` | Mark a Telegram reply delivery `uncertain` and open operator follow-up when delivery outcome is ambiguous or permanently blocked. |
| POST | `/v1/telegram/replies/:chatId/:telegramMessageId/mark-sent` | Mark a Telegram reply delivery as sent. Body accepts `workspaceId`, optional `runId`, and optional `sentTelegramMessageId` for Bot API delivery observability. |

### Telegram delivery resolution and send-attempt audit

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/telegram/deliveries/uncertain` | List deliveries in `uncertain` status. Optional query: `workspaceId`. |
| GET | `/v1/telegram/deliveries/:id` | Get a single delivery record. Returns 404 if not found. |
| POST | `/v1/telegram/deliveries/:id/resolve` | Resolve an uncertain delivery. Body: `{ workspaceId, action, operatorNote?, sentTelegramMessageId? }`. Actions: `confirm_sent`, `resend`, `abandon`. Returns resolution record. 404 if not found, 409 if not `uncertain`. |
| GET | `/v1/telegram/deliveries/:id/resolutions` | List resolution audit trail for a delivery (chronological). |
| GET | `/v1/telegram/deliveries/:id/attempts` | List send attempts for a delivery (chronological). |
| POST | `/v1/telegram/send-attempts` | Record a send attempt. Body: `{ deliveryId?, chatId?, telegramMessageId?, workspaceId, startedAt, contentHash, outcome, ... }`. |

### Memory

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/memory/search` | Hybrid memory search. Query params: `q` or `query`, optional `scope`, `workspaceId`, `projectId`, `includeGlobal`, `types`, `limit`, `full=true`. Operator-only. Explicit `workspaceId` / `projectId` are authoritative; `scope` remains a compatibility alias. |
| GET | `/v1/memory/audit` | Memory subsystem audit summary. Operator-only. |
| GET | `/v1/memory/:id` | Get a single memory record. Returns 404 if not found. Operator-only. Explicit `workspaceId` / `projectId` filters are authoritative; `scope` remains a compatibility alias. |
| GET | `/v1/memory` | List memories. Query params: `type`, `scope`, `workspaceId`, `projectId`, `includeGlobal`, `limit`. Operator-only. |
| POST | `/v1/memory/maintenance` | Trigger confidence decay + consolidation maintenance. Operator-only. |
| POST | `/v1/memory/:id/promote/propose` | Propose promotion of a memory into a curated markdown file. Body: `{ targetPath }`. Returns `{ memoryId, targetPath, diff, approved, promoted }`. Operator-only. Per-item location filters match memory read routes. |
| POST | `/v1/memory/:id/promote/execute` | Execute a previously reviewed promotion. Body: `{ targetPath, diff, approved, promoted }`. Returns `{ memoryId, targetPath, diff, approved, promoted }`. Operator-only. Per-item location filters match memory read routes. |

### Events (SSE)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/events/stream` | Server-Sent Events stream. Emits runtime events (`task_created`, `job_queued`, `run_started`, `run_event`, `run_completed`, `intervention_created`, `security_audit`). |

### Usage and security

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/usage/summary` | Aggregated usage: `{ runs, tokensIn, tokensOut, estimatedCostUsd }` |
| POST | `/v1/secrets` | Create a secret reference. Body: `{ key, value, connectionId?, description? }`. Returns secret metadata only; the secret value is never echoed back. |
| GET | `/v1/security/audit` | Security audit findings: `{ findings: [...] }` |
| GET | `/v1/security/csrf-token` | Issue a CSRF token. Sets `popeye_csrf` HttpOnly cookie. Returns `{ token }`. |

## Message ingress flow

The `/v1/messages/ingest` endpoint accepts messages from three sources: `telegram`, `manual`, and `api`.

For Telegram messages, the following checks are applied in order:

1. Telegram must be enabled in config
2. Chat type must be `private`
3. Sender must match `config.telegram.allowedUserId`
4. Global rate limit check against `globalMaxMessagesPerMinute` (all senders)
5. Per-user rate limit check against `maxMessagesPerMinute`
6. Prompt injection scan (quarantine or sanitize; custom patterns validated for ReDoS safety)
7. Secret redaction

Accepted messages create a Task with `autoEnqueue: true`, which immediately creates a Job and schedules execution. When the run starts, the runtime links the accepted message ingress row and message row to the concrete `runId`.

Duplicate Telegram messages are detected via workspace-scoped idempotency keys (`source + workspaceId + chatId + telegramMessageId`) and replayed without re-processing.

The control API now exposes a packaged reply surface and narrow Telegram relay-state routes. The in-repo Telegram relay stays thin and uses: `/v1/messages/ingest`, `/v1/jobs/:id`, `/v1/runs/:id/reply`, `/v1/telegram/relay/checkpoint`, and the `/v1/telegram/replies/:chatId/:telegramMessageId/*` delivery-state routes.

Current packaged reply precedence is:

1. `completed.output` from the terminal run events
2. the last assistant `message` event text
3. a receipt-derived fallback

Current relay delivery behavior is also explicit:

- duplicate replayed ingress responses with `telegramDelivery.status === "sent"` do not send a second Telegram reply
- duplicate replayed ingress responses with `telegramDelivery.status === "uncertain"` stay silent at the relay and rely on operator follow-up
- denied ingress responses do not send a Telegram reply
- relay claims delivery as `sending` before calling Telegram `sendMessage`
- if replay finds a delivery still `sending`, the relay marks it `uncertain`, opens `needs_operator_input`, and does not auto-send a duplicate reply
- retryable definitive Bot API failures reset delivery back to `pending` and leave the update unacked for replay
- ambiguous transport failures and non-retryable Bot API failures are marked `uncertain` and acknowledged exactly once at the relay
- long-poll progress is durably checkpointed only after an update is fully handled
- relay checkpoint commits are monotonic per workspace; lower `lastAcknowledgedUpdateId` values do not move the checkpoint backward
- reply preparation is bounded-concurrent, but reply send + checkpoint acknowledgement stay ordered
- only retryable definitive Bot API failures are retried in the relay; ambiguous transport failures are not blindly retried

Denied ingress responses and duplicate replay responses are intentionally **silent** at the relay layer. They remain visible through `message_ingress`, jobs/runs, receipts, and `run_completed`/audit events rather than via Telegram-side error messages.

## Memory promotion flow

Memory promotion is a two-step mutation flow:

1. Call `POST /v1/memory/:id/promote/propose` with a target markdown path inside the runtime memory directory.
2. Review the returned `diff`.
3. Call `POST /v1/memory/:id/promote/execute` with the reviewed payload and `approved: true`.

If approved, the runtime writes the memory content to the target file, records a `promoted` memory event, and returns the final promotion result.

## Error responses

| Status | Code | Trigger |
|--------|------|---------|
| 401 | `unauthorized` | Missing or invalid Bearer token |
| 403 | `forbidden` | Valid auth principal lacks the required role for the route |
| 403 | `csrf_invalid` | Missing or wrong CSRF token on mutation |
| 403 | `csrf_cross_site_blocked` | `Sec-Fetch-Site` is `cross-site` or `same-site` |
| 404 | `not_found` | Resource does not exist |
| 400 | `validation_error` | Zod schema validation failure |
| 400 | `prompt_injection` | Prompt injection detected in inbound message |
| 429 | `rate_limited` | Telegram rate limit exceeded |

Denied ingress attempts throw `MessageIngressError` with an HTTP status code and a `MessageIngressResponse` body containing `decisionCode` and `decisionReason`.

## SSE events

Connect to `GET /v1/events/stream` with either a valid `Authorization: Bearer <token>` header or a valid same-origin browser session cookie. The connection returns `text/event-stream` and emits frames in standard SSE format:

```
event: <event_type>
data: <json_payload>

```

Event types: `task_created`, `job_queued`, `run_started`, `run_event`, `run_completed`, `intervention_created`, `security_audit`.

## Security configuration

The following config fields control security behavior:

| Field | Schema location | Default | Purpose |
|-------|----------------|---------|---------|
| `security.useSecureCookies` | `SecurityConfigSchema` | `false` | Adds `; Secure` flag to auth and CSRF cookies. Enable when serving over TLS. |
| `security.tokenRotationDays` | `SecurityConfigSchema` | `30` | Auto-rotates auth tokens after this many days. Checked daily on daemon startup. |
| `telegram.globalMaxMessagesPerMinute` | `TelegramConfigSchema` | `30` | Global rate limit across all Telegram senders within the rate limit window. |

SSE connections are limited to 10 concurrent (configurable via `maxSseConnections` in `ControlApiDependencies`). Excess connections receive `429 { error: "too_many_sse_connections" }`.

Custom prompt scan patterns (`security.promptScanQuarantinePatterns`, `security.promptScanSanitizePatterns`) are validated for ReDoS safety at scan time. Unsafe patterns are skipped with a `[skipped:redos]` marker in the scan result.

Unhandled exceptions and rejections are routed through `redactText()` before logging, preventing accidental secret exposure in crash output.

Stale Pi engine temp directories (`popeye-pi-extension-*` in the system temp dir) are cleaned on daemon startup.

## Versioning

All routes are prefixed with `/v1/`. Additive changes (new fields, new endpoints) are backward-compatible and do not require a version bump. Breaking changes (removed fields, changed semantics) require a new version prefix (`/v2/`).

## Generated clients

- **TypeScript:** `@popeye/api-client` — `PopeyeApiClient` class with typed methods for every endpoint, CSRF handling, and SSE subscription. Uses Zod schemas for response validation.
- **Swift:** `generated/swift/PopeyeModels.swift` — Codable structs and enums generated from `@popeye/contracts` Zod schemas via `pnpm generate:swift`.
