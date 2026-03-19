# API contracts

Current control API routes with response schema references (all schemas from `@popeye/contracts`):

| Method | Path | Response Schema |
|--------|------|----------------|
| GET | `/v1/health` | `HealthResponseSchema` |
| GET | `/v1/status` | `DaemonStatusResponseSchema` |
| GET | `/v1/daemon/state` | `DaemonStateRecordSchema` |
| GET | `/v1/daemon/scheduler` | `SchedulerStatusResponseSchema` |
| GET | `/v1/workspaces` | `Array<{ id, name, createdAt }>` |
| GET | `/v1/projects` | `Array<{ id, workspaceId, name, createdAt }>` |
| GET | `/v1/agent-profiles` | `Array<{ id, name, createdAt }>` |
| GET | `/v1/profiles` | `ExecutionProfileSchema[]` |
| GET | `/v1/profiles/:id` | `ExecutionProfileSchema` |
| GET | `/v1/tasks` | `TaskRecordSchema[]` |
| POST | `/v1/tasks` | `TaskCreateResponseSchema` (req: `TaskCreateInputSchema`) |
| GET | `/v1/jobs` | `JobRecordSchema[]` |
| GET | `/v1/jobs/:id` | `JobRecordSchema` |
| GET | `/v1/jobs/:id/lease` | `JobLeaseRecordSchema` |
| POST | `/v1/jobs/:id/pause` | `JobRecordSchema` |
| POST | `/v1/jobs/:id/resume` | `JobRecordSchema` |
| POST | `/v1/jobs/:id/enqueue` | `JobRecordSchema` |
| GET | `/v1/sessions` | `SessionRootRecord[]` |
| GET | `/v1/runs` | `RunRecordSchema[]` |
| GET | `/v1/runs/:id` | `RunRecordSchema` |
| GET | `/v1/runs/:id/envelope` | `ExecutionEnvelopeSchema` |
| GET | `/v1/runs/:id/receipt` | `ReceiptRecordSchema` |
| GET | `/v1/runs/:id/reply` | `RunReplySchema` |
| GET | `/v1/runs/:id/events` | `RunEventRecordSchema[]` |
| POST | `/v1/runs/:id/retry` | `JobRecordSchema` |
| POST | `/v1/runs/:id/cancel` | `RunRecordSchema` |
| GET | `/v1/receipts/:id` | `ReceiptRecordSchema` |
| GET | `/v1/instruction-previews/:scope` | `CompiledInstructionBundleSchema` (`projectId` query optional; `400 { error: "invalid_context" }` on cross-workspace mismatch) |
| GET | `/v1/interventions` | `InterventionRecordSchema[]` |
| POST | `/v1/interventions/:id/resolve` | `InterventionRecordSchema` |
| GET | `/v1/connections` | `ConnectionListResponseSchema` |
| POST | `/v1/connections` | `ConnectionRecordSchema` (req: `ConnectionCreateInputSchema`) |
| PATCH | `/v1/connections/:id` | `ConnectionRecordSchema` (req: `ConnectionUpdateInputSchema`) |
| GET | `/v1/files/roots` | `FileRootListResponseSchema` |
| POST | `/v1/files/roots` | `FileRootResponseSchema` (req: `FileRootRegistrationInputSchema`) |
| GET | `/v1/files/roots/:id` | `FileRootResponseSchema` |
| PATCH | `/v1/files/roots/:id` | `FileRootResponseSchema` (req: `FileRootUpdateInputSchema`) |
| GET | `/v1/files/search?query=...` | `FileSearchResponseSchema` |
| GET | `/v1/files/documents/:id` | `FileDocumentRecordSchema` |
| POST | `/v1/files/roots/:id/reindex` | `FileIndexResultSchema` |
| GET | `/v1/events/stream` | SSE `text/event-stream` |
| POST | `/v1/messages/ingest` | `MessageIngressResponseSchema` (req: `IngestMessageInputSchema`) |
| GET | `/v1/messages/:id` | `MessageRecordSchema` |
| GET | `/v1/usage/summary` | `UsageSummarySchema` |
| GET | `/v1/security/audit` | `SecurityAuditResponseSchema` |
| GET | `/v1/security/csrf-token` | `CsrfTokenResponseSchema` |
| GET | `/v1/memory/search?query=...` | `MemorySearchResponseSchema` |
| GET | `/v1/memory/audit` | `MemoryAuditResponseSchema` |
| GET | `/v1/memory/:id` | `MemoryRecordSchema` |
| GET | `/v1/memory` | `MemoryRecordSchema[]` |
| POST | `/v1/memory/maintenance` | `{ decayed, archived, merged, deduped }` |
| POST | `/v1/memory/:id/promote/propose` | `MemoryPromotionResponseSchema` (req: `MemoryPromotionProposalRequestSchema`) |
| POST | `/v1/memory/:id/promote/execute` | `MemoryPromotionResponseSchema` (req: `MemoryPromotionExecuteRequestSchema`) |

Generated clients: `@popeye/api-client` (TypeScript, Zod-validated) and `generated/swift/PopeyeModels.swift` (Codable structs).

Behavior notes:
- `POST /v1/tasks` creates the task and may enqueue a job, but does not directly execute the run.
- `POST /v1/jobs/:id/enqueue` re-queues work for scheduler pickup.
- execution ownership lives with the daemon scheduler loop, not the API caller.
- `GET /v1/jobs/:id/lease` exposes the active lease record when present.
- `GET /v1/daemon/state` and `GET /v1/daemon/scheduler` expose runtime-owned scheduler state only.
- `GET /v1/runs/:id/envelope` exposes the persisted per-run execution envelope snapshot.
- `GET /v1/runs/:id/receipt` and `GET /v1/receipts/:id` may include an additive
  `runtime` section with execution-policy, context-release summaries, and a
  chronological `timeline` of run events, policy denials, approvals, context
  releases, and terminal receipt outcomes.
- `POST /v1/memory/:id/promote/propose` returns a review payload with `diff`, `approved: false`, and `promoted: false`.
- `POST /v1/memory/:id/promote/execute` requires an approved proposal payload and writes the promoted markdown file inside the runtime memory directory.
- Memory list/search/read responses include explicit `workspaceId` and `projectId`
  fields; the legacy `scope` string remains for compatibility/display.
- Per-item memory read and promotion routes (`GET /v1/memory/:id`,
  `GET /v1/memory/:id/describe`, `GET /v1/memory/:id/expand`,
  `POST /v1/memory/:id/promote/*`) apply the same location filters as list/search
  routes; explicit `workspaceId` / `projectId` remain authoritative over `scope`.
- Recall explanations also include the effective location filters
  (`workspaceId`, `projectId`, `includeGlobal`) so operator tooling can inspect
  the exact recall gate that was applied.
- Connection reads include an additive `policy` summary with readiness,
  secret status, approval posture, and diagnostics.
- `POST /v1/connections` fails closed with `400 { error: "invalid_connection" }`
  for provider/domain mismatches or missing secret references.
- `POST /v1/files/roots` fails closed with `400 { error: "invalid_file_root" }`
  for runtime-managed directories or duplicate enabled roots.
- `GET /v1/files/search` and `POST /v1/files/roots/:id/reindex` fail closed with
  `400 { error: "invalid_file_root" }` when the target root is disabled,
  unknown, or outside the requested workspace. Denials emit
  `security_audit.code === "file_root_policy_denied"`.
- `POST /v1/messages/ingest` enforces Telegram policy in the runtime:
  - private-DM-only
  - allowlist-only
  - durable rate limiting
  - prompt-injection screening
  - duplicate delivery replay keyed by `(source, chatId, telegramMessageId)`
- Current in-repo Telegram support includes long-poll receive/send transport in `@popeye/telegram`, using standard control-plane routes plus narrow relay-state endpoints.
- Control-plane reply packaging is exposed at `GET /v1/runs/:id/reply` with precedence:
  - `completed.output`
  - last assistant `message` event text
  - receipt-derived fallback text
- Telegram relay-state routes are:
  - `GET /v1/telegram/relay/checkpoint?workspaceId=...`
  - `POST /v1/telegram/relay/checkpoint`
  - `POST /v1/telegram/replies/:chatId/:telegramMessageId/mark-sent`
- Relay behavior is intentionally thin:
  - duplicate replayed Telegram ingress responses with `telegramDelivery.status === "sent"` do not trigger a second reply
  - denied ingress responses do not trigger a Telegram reply
  - long-poll replay safety relies on durable checkpoints plus runtime idempotency
- Telegram ingress status mapping:
  - `403`: disabled / non-private chat / not allowlisted
  - `400`: invalid payload / prompt injection
  - `429`: rate limited

Security:
- bearer auth required for CLI/API routes; bearer principals are role-scoped
  (`operator`, `service`, `readonly`)
- browser clients use the bootstrap nonce plus a one-time operator bearer-authenticated
  `POST /v1/auth/exchange` to mint a `popeye_auth` browser-session cookie and
  always authenticate as `operator`
- mutating routes also require `X-Popeye-CSRF`
- browser mutations must satisfy `Sec-Fetch-Site` validation
- account-scoped capability reads/searches/digests fail closed with domain
  specific `400` errors when their backing connection policy is disabled or
  invalid (`invalid_email_account`, `invalid_github_account`,
  `invalid_calendar_account`, `invalid_todo_account`)


Heartbeat configuration:
- workspaces are seeded from `config.workspaces`
- each workspace may enable/disable heartbeat independently
- each workspace may set its own `heartbeatIntervalSeconds`
