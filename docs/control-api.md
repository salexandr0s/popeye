# Control API

The Popeye control API is a Fastify HTTP server bound to `127.0.0.1` only. All endpoints are versioned under `/v1/`. The runtime service (`PopeyeRuntimeService`) backs every endpoint.

## Authentication

Popeye supports three authenticated client modes:

1. **Bearer auth** for CLI/API clients. The token is validated against the auth
   store file specified by `config.authFile`. The store is role-scoped:
   `operator`, `service`, and `readonly`. Token rotation is supported per role:
   during the overlap window, both the current and next tokens are accepted.
   Legacy single-token auth files still load as `operator`.
2. **Native app session auth** for first-party local clients such as the macOS
   app. A native session is issued through the bootstrap flow and then sent via
   the `x-popeye-native-session` header. This session is loopback-only in use,
   carries `operator` authority, uses its own CSRF token, and is distinct from
   the long-lived bearer token in the auth store. Disconnect in the macOS app
   now revokes only the current native app session server-side.
3. **Browser session auth** for the web inspector. A one-time bootstrap nonce
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
  audit, approvals, security policy, vault access, memory maintenance/promotion,
  and other operator-only control surfaces

Routes default to `operator` unless explicitly downgraded.

Memory and recall routes are explicitly operator-only in this phase, including
memory search/read/maintenance/promotion surfaces plus unified recall search and
detail reads. Browser sessions remain operator-authority only, and legacy
single-token auth files still normalize to `operator`.

## CSRF Protection

All mutating methods (`POST`, `PUT`, `PATCH`, `DELETE`) require two additional checks:

1. **CSRF token** -- the `x-popeye-csrf` header must contain a valid token obtained from `GET /v1/security/csrf-token`.
2. **Sec-Fetch-Site** -- if present, must be `same-origin` or `none`. Cross-site requests are blocked with `403 { error: "csrf_cross_site_blocked" }`.

Invalid CSRF tokens return `403 { error: "csrf_invalid" }`.

`POST /v1/auth/exchange` is the single mutation exempt from CSRF because it
requires operator bearer auth and a valid daemon-issued nonce. Native app
sessions use the same `x-popeye-csrf` header as browser sessions and bearer
clients, but they send their auth credential via `x-popeye-native-session`
instead of `Authorization`.

## Endpoints

### Bootstrap

| Method | Path | Description | Response shape |
|--------|------|-------------|----------------|
| GET | `/v1/bootstrap/status` | Loopback-only unauthenticated readiness probe for first-party local onboarding. | `BootstrapStatusResponse` |
| POST | `/v1/bootstrap/native-app-session` | Loopback-only native app session issuance. Requires operator bearer auth + CSRF. | `NativeAppSessionCreateResponse` |
| DELETE | `/v1/auth/native-app-session/current` | Revoke the currently authenticated native app session. Requires native-session auth + CSRF. | `NativeAppSessionRevokeResponse` |

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

### Recall

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/recall/search` | Search a normalized historical recall surface across receipts, run events, messages, ingress decisions, interventions, and durable memory references. Query params: `q` (or `query`), optional `workspaceId`, `projectId`, `includeGlobal`, comma-separated `kinds`, and `limit`. |
| GET | `/v1/recall/:kind/:id` | Get normalized detail for one recall artifact. `kind` is one of `receipt`, `run_event`, `message`, `message_ingress`, `intervention`, or `memory`. Returns 404 if not found. |

Unified recall is intentionally distinct from the durable memory API:

- **memory** remains the durable truth substrate with promotion, provenance, and lifecycle controls
- **recall** is the product-level history surface over runtime artifacts plus memory references

This first slice is operator-only because it can expose full artifact bodies and
durable memory content. Agent access goes through the runtime-owned
`popeye_recall_search` tool, which still enforces execution-envelope recall
scope.

### Instructions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/instruction-previews/:scope` | Preview compiled instructions for a workspace scope. Optional query: `projectId` to include project context. Returns `400 { error: "invalid_context" }` if the project belongs to a different workspace, and `404` for unknown workspace/project IDs. |

Instruction previews only include active canonical playbooks. Draft playbooks and pending proposals remain auditable through the playbook control surfaces until activation.

### Playbooks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/playbooks` | List canonical playbooks. Optional query: `q`, `scope`, `workspaceId`, `projectId`, `status`, `limit`, `offset`. `q` uses the canonical SQLite FTS mirror. Returned records include additive `effectiveness` metrics. |
| GET | `/v1/playbooks/stale-candidates` | List active playbooks that show recent failure/intervention signals and lack a newer follow-up proposal. |
| GET | `/v1/playbooks/:id` | Get one canonical playbook with current revision metadata. Returns 404 if not found. |
| GET | `/v1/playbooks/:id/revisions` | List canonical revisions for one playbook. Returns 404 if the playbook does not exist. |
| GET | `/v1/playbooks/:id/usage` | List recent runs that compiled the playbook. Optional query: `limit`, `offset`. |
| GET | `/v1/playbook-proposals` | List DB-backed playbook proposals. Optional query: `q`, `status`, `kind`, `scope`, `sourceRunId`, `targetRecordId`, `sort`, `limit`, `offset`. |
| GET | `/v1/playbook-proposals/:id` | Get one playbook proposal. Returns 404 if not found. |
| POST | `/v1/playbook-proposals` | Create a draft or patch proposal. Drafts accept scope/workspace/project fields; patches may include `baseRevisionHash` for conflict-safe authoring. Proposal content is prompt-scanned and redacted before durable write. Blocked proposals fail closed with `400`. |
| PATCH | `/v1/playbook-proposals/:id` | Update a `drafting` proposal body/title/summary/allowed profiles and rerun canonicalization + prompt scanning. |
| POST | `/v1/playbook-proposals/:id/submit-review` | Move a `drafting` proposal into `pending_review`. Patch drafts must still match the current base revision and must change canonical content before submit. |
| POST | `/v1/playbook-proposals/:id/review` | Approve or reject a proposal. Returns `409` if the lifecycle transition is invalid. |
| POST | `/v1/playbook-proposals/:id/apply` | Apply an approved proposal back into the canonical file-backed playbook store. Patch applies fail with `409` on stale base revision conflicts. |
| POST | `/v1/playbooks/:id/suggest-patch` | Create a deterministic `drafting` patch proposal from recent failed/intervened run evidence for that playbook. |
| POST | `/v1/playbooks/:id/activate` | Change a canonical playbook status to `active`. |
| POST | `/v1/playbooks/:id/retire` | Change a canonical playbook status to `retired`. |

Playbook routes are operator-only. Canonical runtime behavior remains file-backed: proposals live in the database until explicitly reviewed and applied, and only active canonical playbooks affect instruction compilation or `receipt.runtime.playbooks`. The backend now also runs an hourly maintenance sweep that may auto-create `drafting` patch proposals for stale playbooks when repeated failure/intervention signals exist, but those proposals are never auto-approved or auto-applied.

### Interventions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/interventions` | List all interventions |
| POST | `/v1/interventions/:id/resolve` | Resolve an open intervention |

### Approvals and policy

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/approvals` | List approval records. Optional query: `domain`, `scope`, `status`, `actionKind`, `runId`, `resolvedBy`. |
| POST | `/v1/approvals` | Create a low-level approval request. Body uses `ApprovalRequestSchema`. This route stays stable for manual/operator use and tests even though runtime-owned capability flows now go through the central action policy evaluator first. |
| GET | `/v1/approvals/:id` | Get one approval record. Returns 404 if not found. |
| POST | `/v1/approvals/:id/resolve` | Resolve an existing approval with an operator decision. |
| GET | `/v1/policies/standing-approvals` | List standing approvals. Optional query: `status`, `domain`, `actionKind`. |
| POST | `/v1/policies/standing-approvals` | Create a standing approval record. |
| POST | `/v1/policies/standing-approvals/:id/revoke` | Revoke a standing approval. |
| GET | `/v1/policies/automation-grants` | List automation grants. Optional query: `status`, `domain`, `actionKind`. |
| POST | `/v1/policies/automation-grants` | Create an automation grant. |
| POST | `/v1/policies/automation-grants/:id/revoke` | Revoke an automation grant. |
| GET | `/v1/security/policy` | Read the effective domain policies plus the central action-policy evaluator state (`defaultRiskClass`, built-in `actionDefaults`, and explicit `approvalRules`). |

Approval and policy routes are operator-only. The resulting records are the
canonical source for approval state rendered in CLI and web inspector views.
Standing approvals and automation grants are the current autonomy substrate for
policy-driven unattended writes; approval records expose the exact grant or
policy path that resolved them.

The runtime evaluates action policy in one place. Precedence is fixed:

1. First matching configured `approvalRules` entry in config order
2. Built-in action defaults
3. `defaultRiskClass`

The built-in defaults are intentionally opinionated:

- `sync`, `import`, `digest`, `classify`, and `triage` auto-run by default
- `write`, `send`, and `open_vault` default to `ask`
- `connect`, `delete`, and `release_context` default to `ask` without grant eligibility
- finance and medical `write` / `send` / `delete` default to `deny`
- finance and medical context release always stays explicit-approval only

The web inspector now exposes dedicated operator pages for:

- `Approvals`
- `Standing Approvals`
- `Automation Grants`
- `Security Policy`
- `Vaults`
- `Playbooks`
- `Playbook Proposals`

### Vaults

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/vaults` | List vault records. Optional query: `domain`. |
| POST | `/v1/vaults` | Create a capability or restricted vault. |
| GET | `/v1/vaults/:id` | Get one vault record. Returns 404 if not found. |
| POST | `/v1/vaults/:id/open` | Open a vault using an approved `approvalId`. Returns `403 { error: "vault_open_denied" }` when the approval gate is not satisfied. |
| POST | `/v1/vaults/:id/close` | Close an open vault. Returns 404 if the vault does not exist. |
| POST | `/v1/vaults/:id/seal` | Seal a vault. Returns 404 if the vault does not exist. |

### Connections

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/connections` | List connections. Optional query: `domain`. Returned records include additive `policy`, `health`, `sync`, and typed `resourceRules` read models. |
| GET | `/v1/connections/oauth/providers` | Return config-derived readiness for the blessed OAuth providers (`gmail`, `google_calendar`, `google_tasks`, `github`). Each record includes `status` plus actionable `details` so clients can suppress impossible setup actions before click. |
| POST | `/v1/connections/oauth/start` | Start a blessed browser OAuth connect flow for `gmail`, `google_calendar`, `google_tasks`, or `github`. Returns an `authorizationUrl` plus session metadata. Optional `connectionId` turns the same route into a reconnect / reauthorize flow. Missing provider OAuth config now returns `409 { error: "oauth_provider_not_configured", details }`; invalid connection mismatch still fails closed with 400/404. |
| GET | `/v1/connections/oauth/sessions/:id` | Read the current OAuth session state (`pending`, `completed`, `failed`, `expired`). Returns 404 if not found. |
| GET | `/v1/connections/oauth/callback` | Loopback-only OAuth callback endpoint used by the browser connect flow. Returns a simple success/failure HTML page instead of JSON. |
| GET | `/v1/config/provider-auth` | Return non-secret Google/GitHub OAuth readiness records including `clientId`, `clientSecretRefId`, `secretAvailability`, `status`, and actionable `details`. |
| POST | `/v1/config/provider-auth/:provider` | Save Google or GitHub OAuth config. Accepts `clientId`, optional write-only `clientSecret`, and `clearStoredSecret`. Stores the secret in Popeye's secret store, updates `clientSecretRefId`, writes a `provider_auth_update` receipt, and records a security-audit event. |
| POST | `/v1/connections` | Create a connection. Invalid provider/domain combinations or missing secret refs fail closed with `400 { error: "invalid_connection" }`. |
| PATCH | `/v1/connections/:id` | Update a connection. Returns 404 if not found and `400 { error: "invalid_connection" }` for policy validation failures. |
| DELETE | `/v1/connections/:id` | Delete a connection. Returns 404 if not found. |

Blessed browser OAuth remains separate per domain: Gmail, Google Calendar, and
Google Tasks share Google client credentials but become distinct Popeye
connections. The
runtime owns PKCE, state validation, token exchange, vault persistence,
connection updates, and account auto-registration.

Connection rollups are additive read models:

- `policy`: readiness and secret-policy posture
- `health`: auth/provider health, last check time, last provider error,
  diagnostics, and operator remediation (`reauthorize`, `reconnect`,
  `scope_fix`, or `secret_fix`) when degraded
- `sync`: last attempt/success, sync status, cursor kind/presence, lag summary
- `resourceRules`: typed write-target policy for provider resources such as
  calendars and GitHub repos

### Email

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/email/accounts` | List registered email accounts. |
| GET | `/v1/email/threads` | List threads for one account. Optional query: `accountId`, `limit`, `unreadOnly=true`. |
| GET | `/v1/email/threads/:id` | Read one thread record. Returns 404 if not found. |
| GET | `/v1/email/messages/:id` | Read one message record. Returns 404 if not found. |
| GET | `/v1/email/digest` | Read the latest digest for one account. Optional query: `accountId`. |
| GET | `/v1/email/drafts` | List Popeye-tracked drafts for one account. Optional query: `accountId`, `limit`. |
| GET | `/v1/email/drafts/:id` | Read one Popeye-tracked draft with full body content. Accepts either the local draft id or the provider draft id. Returns 404 if not found. |
| GET | `/v1/email/search` | Search synced email threads. Query params: `query`, optional `accountId`, `limit`. |
| POST | `/v1/email/accounts` | Register an email account manually. Blessed browser OAuth now auto-registers the happy path. |
| POST | `/v1/email/sync` | Trigger a sync for one email account. Body: `{ accountId }`. |
| POST | `/v1/email/digest` | Generate a digest. Body: `{ accountId? }`. |
| GET | `/v1/email/providers` | List email providers currently available in the runtime. Blessed UX uses direct Gmail; legacy provider detections remain informational. |
| POST | `/v1/email/drafts` | Create a Gmail draft. Body uses `EmailDraftCreateInputSchema`. Returns `409 { error: "email_draft_requires_approval" }` when policy requires approval. |
| PATCH | `/v1/email/drafts/:id` | Update a Gmail draft. Body uses `EmailDraftUpdateInputSchema`. Returns the same approval error shape as draft creation and fails closed when the draft cannot be mapped back to an owning account. |

Email writes in this tranche are intentionally conservative: draft create/update
only, no send. Non-allowlisted resources fail closed before approval
evaluation.

Draft ownership is now persisted locally. Popeye records `draftId -> accountId ->
connectionId` so updates resolve deterministically across multiple Gmail
accounts instead of assuming a single mailbox, while full draft bodies are
fetched from the provider on demand rather than persisted in the local draft DB.

### GitHub

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/github/accounts` | List registered GitHub accounts. |
| GET | `/v1/github/repos` | List synced repos. Optional query: `accountId`, `limit`. |
| GET | `/v1/github/prs` | List pull requests. Optional query: `accountId`, `state`, `limit`. |
| GET | `/v1/github/prs/:id` | Read one pull request record. Returns 404 if not found. |
| GET | `/v1/github/issues` | List issues. Optional query: `accountId`, `state`, `assigned=true`, `limit`. |
| GET | `/v1/github/issues/:id` | Read one issue record. Returns 404 if not found. |
| GET | `/v1/github/notifications` | List unread notifications. Optional query: `accountId`, `limit`. |
| GET | `/v1/github/digest` | Read the latest digest for one account. Optional query: `accountId`. |
| GET | `/v1/github/search` | Search PRs and issues. Query params: `query`, optional `accountId`, `entityType`, `limit`. |
| POST | `/v1/github/sync` | Trigger a sync for one account. Body: `{ accountId }`. |
| POST | `/v1/github/comments` | Add an issue or PR comment. Body uses `GithubCommentCreateInputSchema`. Returns `409 { error: "github_comment_requires_approval" }` when policy requires approval. |
| POST | `/v1/github/notifications/mark-read` | Mark a notification read. Body uses `GithubNotificationMarkReadInputSchema`. Returns `404` if the notification is unknown and `409` when approval is required. |

GitHub writes are restricted to low-risk actions in this tranche: add comments
on allowlisted repos and mark notifications read.

### Calendar

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/calendar/accounts` | List registered calendar accounts. |
| GET | `/v1/calendar/events` | List synced events. Optional query: `accountId`, `dateFrom`, `dateTo`, `limit`. |
| GET | `/v1/calendar/events/:id` | Read one event record. Returns 404 if not found. |
| GET | `/v1/calendar/search` | Search synced events. Query params: `query`, optional `accountId`, `dateFrom`, `dateTo`, `limit`. |
| GET | `/v1/calendar/digest` | Read the latest digest for one account. Optional query: `accountId`. |
| GET | `/v1/calendar/availability` | Compute availability. Query params: `date`, optional `accountId`, `startHour`, `endHour`, `slotMinutes`. |
| POST | `/v1/calendar/accounts` | Register a calendar account manually. Blessed browser OAuth now auto-registers the happy path. |
| POST | `/v1/calendar/sync` | Trigger a sync for one account. Body: `{ accountId }`. |
| POST | `/v1/calendar/events` | Create a calendar event. Body uses `CalendarEventCreateInputSchema`. Returns `409 { error: "calendar_event_requires_approval" }` when policy requires approval. |
| PATCH | `/v1/calendar/events/:id` | Update a calendar event. Body uses `CalendarEventUpdateInputSchema`. Returns `404` if the event is unknown and `409` when approval is required. |

Calendar writes are restricted to create/update on explicitly allowlisted
calendars. Deletes remain out of scope for this tranche.

### Todos

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/todos/accounts` | List registered todo accounts. |
| GET | `/v1/todos/items` | List synced todo items. Optional query: `accountId`, `projectId`, `status`, `limit`. |
| GET | `/v1/todos/items/:id` | Read one todo item. Returns 404 if not found. |
| GET | `/v1/todos/search` | Search synced todo items. Query params: `query`, optional `accountId`, `projectId`, `limit`. |
| GET | `/v1/todos/digest` | Read the latest digest for one account. Optional query: `accountId`. |
| POST | `/v1/todos/accounts` | Register a todo account manually. Blessed Google Tasks OAuth now auto-registers the happy path. |
| POST | `/v1/todos/items` | Create a todo item. Body uses `TodoCreateInputSchema`. |
| POST | `/v1/todos/items/:id/complete` | Complete a todo item. Returns 404 if not found. |
| POST | `/v1/todos/sync` | Trigger a sync for one todo account. Body: `{ accountId }`. |

Google Tasks is now the blessed todo provider path. Start it through
`POST /v1/connections/oauth/start` with `providerKind: "google_tasks"`.

Current Google Tasks semantics:

- Google Task Lists map to Popeye projects.
- Creates without `projectName` use the default Google task list.
- Creates or moves with a new `projectName` create that task list on demand.
- Completion maps to Google Tasks `status=completed`.
- Due dates are supported as date-only values.
- Reprioritize is unsupported.
- Labels are unsupported.
- Due times are unsupported.

### People

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/people` | List people in the canonical local graph. |
| GET | `/v1/people/search` | Search the graph. Query params: `query`, optional `limit`. |
| GET | `/v1/people/:id` | Read one person record with identities, contact methods, and policy metadata. Returns 404 if not found. |
| PATCH | `/v1/people/:id` | Apply bounded manual edits such as display name, pronouns, tags, notes, routing, and approval notes. |
| POST | `/v1/people/merge` | Merge one person into another. Body uses `PersonMergeInputSchema`. |
| POST | `/v1/people/:id/split` | Split selected identities into a new person. Body uses `PersonSplitInputSchema`. |
| POST | `/v1/people/identities/attach` | Attach an identity record to an existing person. Body uses `PersonIdentityAttachInputSchema`. |
| POST | `/v1/people/identities/:id/detach` | Detach one identity from its current person. Body uses `PersonIdentityDetachInputSchema`. |

People is a derived-first local identity graph. Gmail, Calendar, and GitHub sync
data project into canonical people records after successful syncs. Exact
normalized email and GitHub identity matches auto-merge; display-name-only
matches do not.

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

File roots now support a `kind` field. `kind: "knowledge_base"` reserves a
single workspace-owned root for the Knowledge subsystem and is auto-created on
first knowledge import.

### Knowledge

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/knowledge/sources` | List knowledge sources. Query params: `workspaceId`. |
| GET | `/v1/knowledge/sources/:id` | Get one knowledge source. Returns 404 if not found. |
| POST | `/v1/knowledge/import` | Import one source into immutable `raw/` storage, normalize it to markdown, and auto-create a draft wiki compile revision. |
| POST | `/v1/knowledge/sources/:id/reingest` | Reimport an existing logical source, dedupe unchanged content, and create a new snapshot + draft only when content materially changed. |
| GET | `/v1/knowledge/sources/:id/snapshots` | List immutable snapshots for one logical source. Returns metadata only; runtime file paths stay private. |
| GET | `/v1/knowledge/converters` | Return converter readiness for Jina Reader, Trafilatura, MarkItDown, and Docling, including whether each converter is coming from the bundled runtime, the system environment, a remote service, or is missing. |
| GET | `/v1/knowledge/beta-runs` | List stored Knowledge beta corpus runs. Query params: `workspaceId`, optional `limit`. |
| GET | `/v1/knowledge/beta-runs/:id` | Get one stored Knowledge beta corpus run with import/reingest rows, gate summary, audit snapshot, and markdown report. |
| POST | `/v1/knowledge/beta-runs` | Store one Knowledge beta corpus run uploaded by the harness. Body uses `KnowledgeBetaRunCreateRequestSchema`. |
| GET | `/v1/knowledge/documents` | List normalized source docs, wiki docs, or output docs. Query params: `workspaceId`, optional `kind`, optional `q`. Search is backed by title/slug/content FTS when `q` is provided. |
| GET | `/v1/knowledge/documents/:id` | Get one knowledge document with markdown text. Returns 404 if not found. |
| GET | `/v1/knowledge/documents/:id/revisions` | List knowledge revisions for a document. Returns 404 if the document is unknown. |
| POST | `/v1/knowledge/documents/:id/revisions` | Propose a draft revision for an editable wiki/output document. Body uses `KnowledgeDocumentRevisionProposalInputSchema`. |
| POST | `/v1/knowledge/revisions/:id/apply` | Apply a reviewed revision and persist a mutation receipt. Returns `{ revision, document, receipt }`. Body uses `KnowledgeDocumentRevisionApplyInputSchema`. |
| POST | `/v1/knowledge/revisions/:id/reject` | Reject a draft revision and persist a mutation receipt. Returns `{ revision, document, receipt }`. |
| GET | `/v1/knowledge/documents/:id/neighborhood` | Read the local document graph neighborhood: incoming links, outgoing links, and related docs. |
| POST | `/v1/knowledge/links` | Create one explicit document link. Body uses `KnowledgeLinkCreateInputSchema`. |
| GET | `/v1/knowledge/compile-jobs` | List recent knowledge compile jobs. Query params: `workspaceId`. |
| GET | `/v1/knowledge/audit` | Read the knowledge audit summary for one workspace. Query params: `workspaceId`. Includes degraded-source, warning-source, and asset-localization-failure counts. |
| POST | `/v1/knowledge/lint` | Run the knowledge lint pass for one workspace. Body uses `{ workspaceId }`. Persists a mutation receipt. |
| POST | `/v1/knowledge/index/regenerate` | Regenerate `wiki/_index.md` for one workspace. Body uses `{ workspaceId }`. Persists a mutation receipt. |
| POST | `/v1/knowledge/file-query` | File an answer into `outputs/YYYY-MM-DD/*.md` as an `output_note`. Body uses `KnowledgeFileQueryInputSchema` (`title` max 200 chars, `answerText` max 100000 chars). Persists a mutation receipt. |
| POST | `/v1/knowledge/sync` | Rewrite active `wiki_article` and `output_note` documents from the indexed markdown back to disk. Body uses `{ workspaceId }`. Returns `{ synced }` and persists a mutation receipt. |

Knowledge imports are now logical-source aware. Reimporting the same URL/path/title
reuses the same source record, stores immutable snapshots under `raw/<source-id>/snapshots/`,
records `created | updated | unchanged` outcomes, and localizes discoverable assets into
`raw/<source-id>/assets/` before the normalized markdown is compiled.

Knowledge is markdown-first and local-first:

- immutable source captures are written under `raw/<source-id>/`
- canonical editable docs live under `wiki/` and `outputs/`
- imports auto-run normalization, indexing, link extraction, and draft compile
- canonical wiki writes still require explicit review/apply
- Knowledge source responses expose operator-safe metadata only; the API does not
  leak internal absolute runtime paths.
- converter fallback order is URL/article: Jina Reader → Trafilatura → native;
  file/doc: MarkItDown → Docling → native
- converter readiness reports `provenance` as one of `bundled`, `system`,
  `remote`, or `missing`; packaged `.app` / `.pkg` installs should normally
  report bundled readiness for MarkItDown, Trafilatura, and Docling

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
