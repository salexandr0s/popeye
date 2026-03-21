# API contracts

Current control API routes with response schema references (all schemas from `@popeye/contracts`):

| Method | Path | Response Schema |
|--------|------|----------------|
| POST | `/v1/auth/exchange` | `{ token: string }` (req: bearer auth; mints browser-session cookie) |
| GET | `/v1/health` | `HealthResponseSchema` |
| GET | `/v1/status` | `DaemonStatusResponseSchema` |
| GET | `/v1/engine/capabilities` | engine capability listing |
| GET | `/v1/daemon/state` | `DaemonStateRecordSchema` |
| GET | `/v1/daemon/scheduler` | `SchedulerStatusResponseSchema` |
| GET | `/v1/workspaces` | `Array<{ id, name, createdAt }>` |
| GET | `/v1/workspaces/:id` | workspace record |
| POST | `/v1/workspaces` | workspace record (req: `{ id, name }`) |
| GET | `/v1/projects` | `Array<{ id, workspaceId, name, createdAt }>` |
| GET | `/v1/projects/:id` | project record |
| POST | `/v1/projects` | project record (req: `{ id, name, workspaceId? }`) |
| GET | `/v1/agent-profiles` | `Array<{ id, name, createdAt }>` |
| GET | `/v1/profiles` | `ExecutionProfileSchema[]` |
| GET | `/v1/profiles/:id` | `ExecutionProfileSchema` |
| GET | `/v1/tasks` | `TaskRecordSchema[]` |
| GET | `/v1/tasks/:id` | `TaskRecordSchema` |
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
| GET | `/v1/receipts` | `ReceiptRecordSchema[]` |
| GET | `/v1/receipts/:id` | `ReceiptRecordSchema` |
| GET | `/v1/instruction-previews/:scope` | `CompiledInstructionBundleSchema` (`projectId` query optional; `400 { error: "invalid_context" }` on cross-workspace mismatch) |
| GET | `/v1/interventions` | `InterventionRecordSchema[]` |
| POST | `/v1/interventions/:id/resolve` | `InterventionRecordSchema` |
| GET | `/v1/approvals` | `ApprovalListResponseSchema` |
| POST | `/v1/approvals` | `ApprovalRecordSchema` (req: `ApprovalRequestSchema`) |
| GET | `/v1/approvals/:id` | `ApprovalRecordSchema` |
| POST | `/v1/approvals/:id/resolve` | `ApprovalRecordSchema` |
| GET | `/v1/policies/standing-approvals` | `StandingApprovalListResponseSchema` |
| POST | `/v1/policies/standing-approvals` | `StandingApprovalRecordSchema` (req: `StandingApprovalCreateRequestSchema`) |
| POST | `/v1/policies/standing-approvals/:id/revoke` | `StandingApprovalRecordSchema` (req: `PolicyGrantRevokeRequestSchema`) |
| GET | `/v1/policies/automation-grants` | `AutomationGrantListResponseSchema` |
| POST | `/v1/policies/automation-grants` | `AutomationGrantRecordSchema` (req: `AutomationGrantCreateRequestSchema`) |
| POST | `/v1/policies/automation-grants/:id/revoke` | `AutomationGrantRecordSchema` (req: `PolicyGrantRevokeRequestSchema`) |
| GET | `/v1/security/policy` | `SecurityPolicyResponseSchema` |
| GET | `/v1/connections` | `ConnectionListResponseSchema` |
| POST | `/v1/connections/oauth/start` | `OAuthSessionResponseSchema` (req: `OAuthConnectStartRequestSchema`) |
| GET | `/v1/connections/oauth/sessions/:id` | `OAuthSessionResponseSchema` |
| GET | `/v1/connections/oauth/callback` | HTML success/failure page |
| POST | `/v1/connections` | `ConnectionRecordSchema` (req: `ConnectionCreateInputSchema`) |
| PATCH | `/v1/connections/:id` | `ConnectionRecordSchema` (req: `ConnectionUpdateInputSchema`) |
| DELETE | `/v1/connections/:id` | `ConnectionRecordSchema` |
| GET | `/v1/connections/:id/resource-rules` | `ConnectionResourceRuleSchema[]` |
| POST | `/v1/connections/:id/resource-rules` | `ConnectionRecordSchema` (req: `ConnectionResourceRuleCreateInputSchema`) |
| DELETE | `/v1/connections/:id/resource-rules` | `ConnectionRecordSchema` (req: `ConnectionResourceRuleDeleteInputSchema`) |
| GET | `/v1/connections/:id/diagnostics` | `ConnectionDiagnosticsResponseSchema` |
| POST | `/v1/connections/:id/reconnect` | `ConnectionRecordSchema` (req: `ConnectionReconnectRequestSchema`) |
| GET | `/v1/email/accounts` | `EmailAccountRecordSchema[]` |
| GET | `/v1/email/threads` | `EmailThreadRecordSchema[]` |
| GET | `/v1/email/threads/:id` | `EmailThreadRecordSchema` |
| GET | `/v1/email/messages/:id` | `EmailMessageRecordSchema` |
| GET | `/v1/email/digest` | `EmailDigestRecordSchema \| null` |
| GET | `/v1/email/search?query=...` | `EmailSearchResultSchema[]` |
| POST | `/v1/email/accounts` | `EmailAccountRecordSchema` (req: `EmailAccountRegistrationInputSchema`) |
| POST | `/v1/email/sync` | `EmailSyncResultSchema` |
| POST | `/v1/email/digest` | `EmailDigestRecordSchema` |
| GET | `/v1/email/providers` | provider availability payload |
| POST | `/v1/email/drafts` | `EmailDraftRecordSchema` (req: `EmailDraftCreateInputSchema`) |
| PATCH | `/v1/email/drafts/:id` | `EmailDraftRecordSchema` (req: `EmailDraftUpdateInputSchema`) |
| GET | `/v1/github/accounts` | `GithubAccountRecordSchema[]` |
| GET | `/v1/github/repos` | `GithubRepoRecordSchema[]` |
| GET | `/v1/github/prs` | `GithubPullRequestRecordSchema[]` |
| GET | `/v1/github/prs/:id` | `GithubPullRequestRecordSchema` |
| GET | `/v1/github/issues` | `GithubIssueRecordSchema[]` |
| GET | `/v1/github/issues/:id` | `GithubIssueRecordSchema` |
| GET | `/v1/github/notifications` | `GithubNotificationRecordSchema[]` |
| GET | `/v1/github/digest` | `GithubDigestRecordSchema \| null` |
| GET | `/v1/github/search?query=...` | `GithubSearchResultSchema[]` |
| POST | `/v1/github/sync` | `GithubSyncResultSchema` |
| POST | `/v1/github/comments` | `GithubCommentRecordSchema` (req: `GithubCommentCreateInputSchema`) |
| POST | `/v1/github/notifications/mark-read` | `GithubNotificationRecordSchema` (req: `GithubNotificationMarkReadInputSchema`) |
| GET | `/v1/calendar/accounts` | `CalendarAccountRecordSchema[]` |
| GET | `/v1/calendar/events` | `CalendarEventRecordSchema[]` |
| GET | `/v1/calendar/events/:id` | `CalendarEventRecordSchema` |
| GET | `/v1/calendar/search?query=...` | `CalendarSearchResultSchema[]` |
| GET | `/v1/calendar/digest` | `CalendarDigestRecordSchema \| null` |
| GET | `/v1/calendar/availability` | `CalendarAvailabilitySlotSchema[]` |
| POST | `/v1/calendar/accounts` | `CalendarAccountRecordSchema` (req: `CalendarAccountRegistrationInputSchema`) |
| POST | `/v1/calendar/sync` | `CalendarSyncResultSchema` |
| POST | `/v1/calendar/events` | `CalendarEventRecordSchema` (req: `CalendarEventCreateInputSchema`) |
| PATCH | `/v1/calendar/events/:id` | `CalendarEventRecordSchema` (req: `CalendarEventUpdateInputSchema`) |
| GET | `/v1/todos/accounts` | `TodoAccountRecordSchema[]` |
| GET | `/v1/todos/items` | `TodoItemRecordSchema[]` |
| GET | `/v1/todos/items/:id` | `TodoItemRecordSchema` |
| GET | `/v1/todos/search?query=...` | `{ query, results: TodoSearchResultSchema[] }` |
| GET | `/v1/todos/digest` | `TodoDigestRecordSchema \| null` |
| POST | `/v1/todos/accounts` | `TodoAccountRecordSchema` (req: `TodoAccountRegistrationInputSchema`) |
| POST | `/v1/todos/connect` | `TodoistConnectResponseSchema` (req: `TodoistConnectRequestSchema`) |
| POST | `/v1/todos/items` | `TodoItemRecordSchema` (req: `TodoCreateInputSchema`) |
| POST | `/v1/todos/sync` | `TodoSyncResponseSchema` |
| POST | `/v1/todos/items/:id/complete` | `TodoItemRecordSchema` |
| POST | `/v1/todos/items/:id/reprioritize` | `TodoItemRecordSchema` (req: `{ priority }`) |
| POST | `/v1/todos/items/:id/reschedule` | `TodoItemRecordSchema` (req: `{ dueDate, dueTime? }`) |
| POST | `/v1/todos/items/:id/move` | `TodoItemRecordSchema` (req: `{ projectName }`) |
| POST | `/v1/todos/reconcile` | `TodoReconcileResultSchema` (req: `{ accountId }`) |
| GET | `/v1/todos/projects?accountId=...` | `TodoProjectRecordSchema[]` |
| GET | `/v1/people` | `PersonListResponseSchema` |
| GET | `/v1/people/search?query=...` | `PersonSearchApiResponseSchema` |
| GET | `/v1/people/:id` | `PersonResponseSchema` |
| PATCH | `/v1/people/:id` | `PersonResponseSchema` (req: `PersonUpdateRequestSchema`) |
| POST | `/v1/people/merge` | `PersonResponseSchema` (req: `PersonMergeRequestSchema`) |
| POST | `/v1/people/:id/split` | `PersonResponseSchema` (req: `PersonSplitRequestSchema`) |
| POST | `/v1/people/identities/attach` | `PersonResponseSchema` (req: `PersonIdentityAttachRequestSchema`) |
| POST | `/v1/people/identities/:id/detach` | `PersonResponseSchema` (req: `PersonIdentityDetachRequestSchema`) |
| GET | `/v1/people/:id/merge-events` | `PersonMergeEventRecordSchema[]` |
| GET | `/v1/people/merge-suggestions` | `PersonMergeSuggestionSchema[]` |
| GET | `/v1/people/:id/activity` | `PersonActivityRollupSchema[]` |
| GET | `/v1/vaults` | `VaultListResponseSchema` |
| POST | `/v1/vaults` | `VaultResponseSchema` (req: `VaultCreateRequestSchema`) |
| GET | `/v1/vaults/:id` | `VaultResponseSchema` |
| POST | `/v1/vaults/:id/open` | `VaultResponseSchema` (req: `VaultOpenRequestSchema`) |
| POST | `/v1/vaults/:id/close` | `VaultResponseSchema` |
| POST | `/v1/vaults/:id/seal` | `VaultResponseSchema` |
| GET | `/v1/files/roots` | `FileRootListResponseSchema` |
| POST | `/v1/files/roots` | `FileRootResponseSchema` (req: `FileRootRegistrationInputSchema`) |
| GET | `/v1/files/roots/:id` | `FileRootResponseSchema` |
| PATCH | `/v1/files/roots/:id` | `FileRootResponseSchema` (req: `FileRootUpdateInputSchema`) |
| GET | `/v1/files/search?query=...` | `FileSearchResponseSchema` |
| GET | `/v1/files/documents/:id` | `FileDocumentRecordSchema` |
| POST | `/v1/files/roots/:id/reindex` | `FileIndexResultSchema` |
| POST | `/v1/files/write-intents` | `FileWriteIntentRecordSchema` (req: `FileWriteIntentCreateInputSchema`) |
| GET | `/v1/files/write-intents` | `FileWriteIntentRecordSchema[]` |
| GET | `/v1/files/write-intents/:id` | `FileWriteIntentRecordSchema` |
| POST | `/v1/files/write-intents/:id/review` | `FileWriteIntentRecordSchema` (req: `FileWriteIntentReviewInputSchema`) |
| GET | `/v1/finance/imports` | `FinanceImportRecordSchema[]` |
| GET | `/v1/finance/imports/:id` | `FinanceImportRecordSchema` |
| GET | `/v1/finance/transactions` | `FinanceTransactionRecordSchema[]` |
| GET | `/v1/finance/documents` | `FinanceDocumentRecordSchema[]` |
| GET | `/v1/finance/search?query=...` | `{ query, results: FinanceSearchResultSchema[] }` |
| GET | `/v1/finance/digest` | `FinanceDigestRecordSchema \| null` |
| POST | `/v1/finance/imports` | `FinanceImportRecordSchema` (req: `{ vaultId, importType?, fileName }`) |
| POST | `/v1/finance/transactions` | `FinanceTransactionRecordSchema` (req: `{ importId, date, description, amount, ... }`) |
| POST | `/v1/finance/transactions/batch` | `FinanceTransactionRecordSchema[]` (req: `{ importId, transactions: [{ date, description, amount, ... }] }`) |
| POST | `/v1/finance/imports/:id/status` | `{ ok: true }` (req: `{ status, recordCount? }`) |
| GET | `/v1/medical/imports` | `MedicalImportRecordSchema[]` |
| GET | `/v1/medical/imports/:id` | `MedicalImportRecordSchema` |
| GET | `/v1/medical/appointments` | `MedicalAppointmentRecordSchema[]` |
| GET | `/v1/medical/medications` | `MedicalMedicationRecordSchema[]` |
| GET | `/v1/medical/documents` | `MedicalDocumentRecordSchema[]` |
| GET | `/v1/medical/search?query=...` | `{ query, results: MedicalSearchResultSchema[] }` |
| GET | `/v1/medical/digest` | `MedicalDigestRecordSchema \| null` |
| POST | `/v1/medical/imports` | `MedicalImportRecordSchema` (req: `{ vaultId, importType?, fileName }`) |
| POST | `/v1/medical/appointments` | `MedicalAppointmentRecordSchema` (req: `{ importId, date, provider, ... }`) |
| POST | `/v1/medical/medications` | `MedicalMedicationRecordSchema` (req: `{ importId, name, dosage?, ... }`) |
| POST | `/v1/medical/imports/:id/status` | `{ ok: true }` (req: `{ status }`) |
| POST | `/v1/vaults/:id/backup` | `VaultBackupResultSchema` (req: `{ destinationDir? }`) |
| POST | `/v1/vaults/:id/restore` | `VaultBackupResultSchema` (req: `{ backupPath }`) |
| GET | `/v1/vaults/:id/backup/verify` | `VaultVerifyResultSchema` |
| POST | `/v1/context-release/preview` | context release preview result |
| POST | `/v1/secrets` | secret storage result |
| DELETE | `/v1/files/roots/:id` | `FileRootResponseSchema` |
| GET | `/v1/events/stream` | SSE `text/event-stream` |
| POST | `/v1/messages/ingest` | `MessageIngressResponseSchema` (req: `IngestMessageInputSchema`) |
| GET | `/v1/messages/:id` | `MessageRecordSchema` |
| GET | `/v1/usage/summary` | `UsageSummarySchema` |
| GET | `/v1/security/audit` | `SecurityAuditResponseSchema` |
| GET | `/v1/security/csrf-token` | `CsrfTokenResponseSchema` |
| GET | `/v1/memory/search?query=...&domains=...&consumerProfile=...` | `MemorySearchResponseSchema` |
| GET | `/v1/memory/audit` | `MemoryAuditResponseSchema` |
| GET | `/v1/memory/integrity` | memory integrity check result |
| GET | `/v1/memory/budget-fit` | memory budget allocation fit |
| GET | `/v1/memory/:id` | `MemoryRecordSchema` |
| GET | `/v1/memory/:id/describe` | memory description (progressive disclosure) |
| GET | `/v1/memory/:id/expand` | full memory content |
| GET | `/v1/memory` | `MemoryRecordSchema[]` |
| POST | `/v1/memory/maintenance` | `{ decayed, archived, merged, deduped }` |
| POST | `/v1/memory/import` | memory import result |
| POST | `/v1/memory/:id/promote/propose` | `MemoryPromotionResponseSchema` (req: `MemoryPromotionProposalRequestSchema`) |
| POST | `/v1/memory/:id/promote/execute` | `MemoryPromotionResponseSchema` (req: `MemoryPromotionExecuteRequestSchema`) |

Generated contract artifacts:

- `generated/typescript/PopeyeModels.ts`
- `generated/swift/PopeyeModels.swift`
- `generated/json-schema/popeye-contracts.json`

These are verified by `pnpm verify:generated-artifacts`.

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
- `GET /v1/memory/search` accepts `domains` (comma-separated domain filter) and `consumerProfile` (`assistant` or `coding`) query params, plus `X-Consumer-Profile` header as a fallback. Consumer profiles set sensible default domain/namespace filters for different agent types.
- `POST /v1/memory/import` accepts `domain`, `tags`, `durable`, `dedupKey`, `sourceRunId`, `sourceTimestamp` fields for coding agent ingestion. New source types: `coding_session`, `code_review`, `debug_session`.
- Approval and vault routes are shared operator surfaces consumed by both CLI and
  web inspector.
- Approval records now carry structured action metadata (`actionKind`,
  `resourceScope`, `runId`, standing/automation eligibility, and grant-backed
  resolution IDs) so receipt timelines and operator UIs can explain why a
  mutation ran unattended.
- Runtime-owned capability integrations now use an evaluator-backed action
  approval request contract internally. Capabilities provide action metadata,
  while the runtime policy evaluator decides `riskClass`,
  `standingApprovalEligible`, and `automationGrantEligible`.
- `GET /v1/approvals` supports additive filters: `actionKind`, `runId`, and
  `resolvedBy`.
- `GET /v1/security/policy` is the canonical read model for domain-level
  sensitivity plus effective approval posture. The response now includes:
  - `defaultRiskClass` for the config fallback
  - `actionDefaults` for the built-in evaluator matrix
  - `approvalRules` for explicit config overrides in evaluation order
- Policy evaluation precedence is:
  - first matching `approvalRules` entry in config order
  - then the built-in `actionDefaults` matrix
  - then `defaultRiskClass`
- `GET /v1/policies/standing-approvals` and
  `GET /v1/policies/automation-grants` are the operator-facing autonomy policy
  surfaces for policy-driven unattended writes.
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
- Connection reads also include additive `health` and `sync` rollups so
  operators can inspect auth state, last provider error, cursor kind/presence,
  and sync lag without reading capability stores directly.
- Connection reads also include additive `resourceRules` and `health.remediation`
  data so calendar and GitHub write targets, reconnect posture, and stale
  credential recovery are operator-visible without inferring policy from legacy
  allowlist strings.
- `POST /v1/connections/oauth/start`, `GET /v1/connections/oauth/sessions/:id`,
  and `GET /v1/connections/oauth/callback` are the blessed browser-OAuth
  surfaces for Gmail, Google Calendar, and GitHub.
- The callback route returns HTML rather than JSON because it is intended for
  the browser popup/tab flow.
- `POST /v1/connections/oauth/start` also accepts an existing `connectionId` for
  reconnect / reauthorize flows instead of requiring operators to create a new
  connection.
- Blessed browser OAuth completion auto-registers the matching email, calendar,
  or GitHub account; separate `POST /v1/*/accounts` calls are no longer part of
  the happy path for those domains.
- `POST /v1/todos/connect` is the blessed Todoist connect path. It stores the
  manual API token in the secret store, creates or updates the connection, and
  auto-registers the matching todo account.
- `GET /v1/people`, `GET /v1/people/search`, and the People mutation routes are
  the canonical operator surfaces for the local derived-first identity graph
  built from Gmail, Calendar, and GitHub sync data.
- Email, calendar, and GitHub reads/searches/digests continue to fail closed
  with domain-specific `400` errors when their backing connection policy is
  disabled or invalid.
- Email draft records now persist `accountId` and `connectionId` ownership so
  draft updates resolve deterministically across multiple Gmail accounts.
  Legacy or unmapped drafts fail closed with an explicit account-resolution
  error rather than assuming a single connected mailbox.
- Email drafts, calendar event create/update, GitHub comments, and GitHub
  notification mark-read are evaluator-backed write flows:
  - non-allowlisted resources fail closed before approval evaluation
  - approval-required cases return domain-specific `409` errors
  - successful writes return the provider-normalized record and leave receipt /
    audit evidence with approval or grant provenance
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
  - `POST /v1/telegram/replies/:chatId/:telegramMessageId/mark-sending`
  - `POST /v1/telegram/replies/:chatId/:telegramMessageId/mark-pending`
  - `POST /v1/telegram/replies/:chatId/:telegramMessageId/mark-uncertain`
- Telegram delivery management routes:
  - `GET /v1/telegram/deliveries/uncertain` — list deliveries with uncertain send status
  - `GET /v1/telegram/deliveries/:id` — delivery record by ID
  - `POST /v1/telegram/deliveries/:id/resolve` — resolve an uncertain delivery
  - `GET /v1/telegram/deliveries/:id/resolutions` — resolution history for a delivery
  - `GET /v1/telegram/deliveries/:id/attempts` — send attempt history for a delivery
  - `POST /v1/telegram/send-attempts` — record a send attempt
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
