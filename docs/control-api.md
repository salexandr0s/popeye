# Control API

The Popeye control API is a Fastify HTTP server bound to `127.0.0.1` only. All endpoints are versioned under `/v1/`. The runtime service (`PopeyeRuntimeService`) backs every endpoint.

## Authentication

Popeye supports two authenticated client modes:

1. **Bearer auth** for CLI/API clients. The token is validated against the auth store file specified by `config.authFile`. Token rotation is supported: during the overlap window, both the current and next tokens are accepted.
2. **Browser session auth** for the web inspector. A one-time bootstrap nonce is exchanged at `POST /v1/auth/exchange` for an HttpOnly `popeye_auth` browser-session cookie. This cookie is **not** the long-lived bearer token.

Unauthenticated requests receive `401 { error: "unauthorized" }`.

## CSRF Protection

All mutating methods (`POST`, `PUT`, `PATCH`, `DELETE`) require two additional checks:

1. **CSRF token** -- the `x-popeye-csrf` header must contain a valid token obtained from `GET /v1/security/csrf-token`.
2. **Sec-Fetch-Site** -- if present, must be `same-origin` or `none`. Cross-site requests are blocked with `403 { error: "csrf_cross_site_blocked" }`.

Invalid CSRF tokens return `403 { error: "csrf_invalid" }`.

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
| GET | `/v1/runs/:id/receipt` | Get the latest receipt for a run. Returns 404 if none exists yet. |
| GET | `/v1/runs/:id/events` | List engine events for a run |
| POST | `/v1/runs/:id/retry` | Retry a run by creating a new job |
| POST | `/v1/runs/:id/cancel` | Cancel an active or queued run |

### Receipts

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/receipts/:id` | Get a receipt by ID. Returns 404 if not found. |

### Instructions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/instruction-previews/:scope` | Preview compiled instructions for a workspace scope. Optional query: `projectId` to include project context. Returns `400 { error: "invalid_context" }` if the project belongs to a different workspace, and `404` for unknown workspace/project IDs. |

### Interventions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/interventions` | List all interventions |
| POST | `/v1/interventions/:id/resolve` | Resolve an open intervention |

### Messages

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/messages/ingest` | Ingest a message (Telegram, manual, or API). Body validated against `IngestMessageInputSchema`. This is the current Telegram ingress boundary. |
| GET | `/v1/messages/:id` | Get a message by ID. Returns 404 if not found. |

### Memory

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/memory/search` | Hybrid memory search. Query params: `q` or `query`, optional `scope`, `types`, `limit`, `full=true`. |
| GET | `/v1/memory/audit` | Memory subsystem audit summary. |
| GET | `/v1/memory/:id` | Get a single memory record. Returns 404 if not found. |
| GET | `/v1/memory` | List memories. Query params: `type`, `scope`, `limit`. |
| POST | `/v1/memory/maintenance` | Trigger confidence decay + consolidation maintenance. |
| POST | `/v1/memory/:id/promote/propose` | Propose promotion of a memory into a curated markdown file. Body: `{ targetPath }`. Returns `{ memoryId, targetPath, diff, approved, promoted }`. |
| POST | `/v1/memory/:id/promote/execute` | Execute a previously reviewed promotion. Body: `{ targetPath, diff, approved, promoted }`. Returns `{ memoryId, targetPath, diff, approved, promoted }`. |

### Events (SSE)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/events/stream` | Server-Sent Events stream. Emits runtime events (`task_created`, `job_queued`, `run_started`, `run_event`, `run_completed`, `intervention_created`, `security_audit`). |

### Usage and security

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/usage/summary` | Aggregated usage: `{ runs, tokensIn, tokensOut, estimatedCostUsd }` |
| GET | `/v1/security/audit` | Security audit findings: `{ findings: [...] }` |
| GET | `/v1/security/csrf-token` | Issue a CSRF token. Sets `popeye_csrf` HttpOnly cookie. Returns `{ token }`. |

## Message ingress flow

The `/v1/messages/ingest` endpoint accepts messages from three sources: `telegram`, `manual`, and `api`.

For Telegram messages, the following checks are applied in order:

1. Telegram must be enabled in config
2. Chat type must be `private`
3. Sender must match `config.telegram.allowedUserId`
4. Rate limit check against `maxMessagesPerMinute`
5. Prompt injection scan (quarantine or sanitize)
6. Secret redaction

Accepted messages create a Task with `autoEnqueue: true`, which immediately creates a Job and schedules execution. When the run starts, the runtime links the accepted message ingress row and message row to the concrete `runId`.

Duplicate Telegram messages (same `source + chatId + telegramMessageId`) are detected via idempotency keys and replayed without re-processing.

The control API does **not** expose a Telegram-specific reply endpoint. Instead, the in-repo Telegram relay uses normal control-plane routes (`/v1/messages/ingest`, `/v1/jobs/:id`, `/v1/runs/:id/events`, `/v1/runs/:id/receipt`) to wait for completion and send the reply itself.

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

## Versioning

All routes are prefixed with `/v1/`. Additive changes (new fields, new endpoints) are backward-compatible and do not require a version bump. Breaking changes (removed fields, changed semantics) require a new version prefix (`/v2/`).

## Generated clients

- **TypeScript:** `@popeye/api-client` — `PopeyeApiClient` class with typed methods for every endpoint, CSRF handling, and SSE subscription. Uses Zod schemas for response validation.
- **Swift:** `generated/swift/PopeyeModels.swift` — Codable structs and enums generated from `@popeye/contracts` Zod schemas via `pnpm generate:swift`.
