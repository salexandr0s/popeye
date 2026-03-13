# API contracts

Current control API routes:
- `GET /v1/health`
- `GET /v1/status`
- `GET /v1/daemon/state`
- `GET /v1/daemon/scheduler`
- `GET /v1/workspaces`
- `GET /v1/projects`
- `GET /v1/agent-profiles`
- `GET /v1/tasks`
- `POST /v1/tasks`
- `GET /v1/jobs`
- `GET /v1/jobs/:id/lease`
- `POST /v1/jobs/:id/pause`
- `POST /v1/jobs/:id/resume`
- `POST /v1/jobs/:id/enqueue`
- `GET /v1/runs`
- `GET /v1/runs/:id`
- `GET /v1/runs/:id/events`
- `POST /v1/runs/:id/retry`
- `POST /v1/runs/:id/cancel`
- `GET /v1/receipts/:id`
- `GET /v1/instruction-previews/:scope`
- `GET /v1/interventions`
- `POST /v1/interventions/:id/resolve`
- `GET /v1/events/stream`
- `POST /v1/messages/ingest`
- `GET /v1/messages/:id`
- `GET /v1/usage/summary`
- `GET /v1/security/audit`
- `GET /v1/security/csrf-token`

Behavior notes:
- `POST /v1/tasks` creates the task and may enqueue a job, but does not directly execute the run.
- `POST /v1/jobs/:id/enqueue` re-queues work for scheduler pickup.
- execution ownership lives with the daemon scheduler loop, not the API caller.
- `GET /v1/jobs/:id/lease` exposes the active lease record when present.
- `GET /v1/daemon/state` and `GET /v1/daemon/scheduler` expose runtime-owned scheduler state only.
- `POST /v1/messages/ingest` enforces Telegram policy in the runtime:
  - private-DM-only
  - allowlist-only
  - durable rate limiting
  - prompt-injection screening
  - duplicate delivery replay keyed by `(source, chatId, telegramMessageId)`
- Telegram ingress status mapping:
  - `403`: disabled / non-private chat / not allowlisted
  - `400`: invalid payload / prompt injection
  - `429`: rate limited

Security:
- bearer auth required on every route
- mutating routes also require `X-Popeye-CSRF`
- browser mutations must satisfy `Sec-Fetch-Site` validation


Heartbeat configuration:
- workspaces are seeded from `config.workspaces`
- each workspace may enable/disable heartbeat independently
- each workspace may set its own `heartbeatIntervalSeconds`
