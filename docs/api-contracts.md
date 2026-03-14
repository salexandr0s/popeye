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
| GET | `/v1/runs/:id/receipt` | `ReceiptRecordSchema` |
| GET | `/v1/runs/:id/events` | `RunEventRecordSchema[]` |
| POST | `/v1/runs/:id/retry` | `JobRecordSchema` |
| POST | `/v1/runs/:id/cancel` | `RunRecordSchema` |
| GET | `/v1/receipts/:id` | `ReceiptRecordSchema` |
| GET | `/v1/instruction-previews/:scope` | `CompiledInstructionBundleSchema` (`projectId` query optional; `400 { error: "invalid_context" }` on cross-workspace mismatch) |
| GET | `/v1/interventions` | `InterventionRecordSchema[]` |
| POST | `/v1/interventions/:id/resolve` | `InterventionRecordSchema` |
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
- `POST /v1/memory/:id/promote/propose` returns a review payload with `diff`, `approved: false`, and `promoted: false`.
- `POST /v1/memory/:id/promote/execute` requires an approved proposal payload and writes the promoted markdown file inside the runtime memory directory.
- `POST /v1/messages/ingest` enforces Telegram policy in the runtime:
  - private-DM-only
  - allowlist-only
  - durable rate limiting
  - prompt-injection screening
  - duplicate delivery replay keyed by `(source, chatId, telegramMessageId)`
- Current in-repo Telegram support includes long-poll receive/send transport in `@popeye/telegram`, using standard control-plane routes rather than a Telegram-specific reply endpoint.
- Telegram ingress status mapping:
  - `403`: disabled / non-private chat / not allowlisted
  - `400`: invalid payload / prompt injection
  - `429`: rate limited

Security:
- bearer auth required for CLI/API routes; browser clients use the bootstrap nonce + `popeye_auth` browser-session cookie
- mutating routes also require `X-Popeye-CSRF`
- browser mutations must satisfy `Sec-Fetch-Site` validation


Heartbeat configuration:
- workspaces are seeded from `config.workspaces`
- each workspace may enable/disable heartbeat independently
- each workspace may set its own `heartbeatIntervalSeconds`
