# Popeye personal assistant implementation plan

Date: 2026-03-16

# Evidence legend

- **VERIFIED IN CODE** — I directly inspected the repository tree and/or file contents and confirmed the statement in code.
- **DOC CLAIM ONLY** — the statement appears in repo documentation, but I did not find it confirmed in code during this audit.
- **INFERRED** — the statement is a reasoned conclusion from inspected structure, tests, docs, or adjacent code, but not line-verified end-to-end.
- **PROPOSED** — this is my recommended future design or implementation step.


## Executive goal

Evolve Popeye from a strong local runtime foundation into a real always-on personal assistant while preserving these principles:

- **PROPOSED** runtime-owned product semantics
- **PROPOSED** local-first durable state
- **PROPOSED** explicit approvals before risky side effects
- **PROPOSED** inspectable receipts and recoverability
- **PROPOSED** bounded complexity
- **PROPOSED** no plugin marketplace, no multi-tenant SaaS pivot, no OpenClaw re-expansion

## Guiding principles

1. **VERIFIED IN CODE / PROPOSED** Preserve the current split: engine boundary, runtime core, control API, replaceable interfaces.
2. **PROPOSED** Add capability packages, not capability sprawl inside `runtime-service.ts`.
3. **PROPOSED** Read-only first for every new external domain.
4. **PROPOSED** Proposal-first, approval-required for all writes.
5. **PROPOSED** Separate operational state, general memory, and restricted vault data.
6. **PROPOSED** Every sync, summary, proposal, approval, and action gets a receipt.
7. **PROPOSED** Make provider adapters thin and disposable; keep product logic runtime-owned.
8. **PROPOSED** Do not build generic provider/plugin frameworks until the second real provider forces it.
9. **PROPOSED** Finance and medical domains remain read-only and highly constrained until the rest of the platform has proven safety and recoverability.

## Sequencing strategy

**PROPOSED** Sequence by the following dependency order:

1. Fix misleading docs and unblock architectural debt.
2. Add policy/vault/security substrate before sensitive integrations.
3. Add file/root permissioning and general knowledge substrate.
4. Ship the first useful read-only capability slice.
5. Add controlled write-capable domains with approvals.
6. Add proactive cross-capability reviews.
7. Only then add restricted finance/medical read-only vaults.
8. Defer native/macOS polish and broad interface expansion until the runtime model stabilizes.

## Target architecture after implementation

### Runtime remains the control plane

**PROPOSED** `packages/runtime-core` remains the orchestration/control-plane owner for:
- capability registration,
- scheduler ownership,
- approvals/interventions,
- receipts,
- context assembly,
- security audit,
- daemon state,
- backup/restore,
- policy evaluation.

### Capability packages own domain behavior

**PROPOSED** Add packages such as:
- `packages/cap-email`
- `packages/cap-calendar`
- `packages/cap-todos`
- `packages/cap-github`
- `packages/cap-files`
- `packages/cap-people`
- later `packages/vault-finance`
- later `packages/vault-medical`

Each package should contain:
- provider adapters,
- local DB schema + migrations or schema ownership,
- sync logic,
- normalized domain types,
- runtime tools,
- receipt emitters,
- tests.

### Control API remains the only client boundary

**PROPOSED** extend `packages/control-api` and `packages/api-client`; do not let web/CLI/mobile touch SQLite directly.

### Sensitive data moves into vault-aware storage

**PROPOSED** storage layout:
- `app.db` — runtime state only
- `memory.db` — general/derived memory only
- `capabilities/email.db`
- `capabilities/calendar.db`
- `capabilities/todos.db`
- `capabilities/github.db`
- `capabilities/files.db`
- `capabilities/people.db`
- `vaults/finance.db` (encrypted)
- `vaults/medical.db` (encrypted)

This keeps boundaries inspectable and makes per-domain backup/restore practical.

## Required cross-cutting changes

### Contracts and config

**PROPOSED** update:
- `packages/contracts/src/config.ts`
- `packages/contracts/src/execution.ts`
- `packages/contracts/src/memory.ts`
- `packages/contracts/src/api.ts`
- `packages/contracts/src/security.ts`
- `packages/api-client/src/index.ts`
- `generated/swift/PopeyeModels.swift`
- `scripts/generate-swift-models.ts`

Add:
- capability connection schemas,
- sync cursor schemas,
- approval/action schemas,
- domain/sensitivity/trust/context-release schemas,
- vault metadata schemas,
- notification/digest schemas.

Whenever API contracts change in a phase, **PROPOSED** regenerate `packages/api-client/src/index.ts` and `generated/swift/PopeyeModels.swift` via `scripts/generate-swift-models.ts` so web/CLI/native clients stay aligned.

### Runtime-core modularization

**PROPOSED** refactor `packages/runtime-core/src/runtime-service.ts` by extracting:
- `approval-service.ts`
- `capability-registry.ts`
- `context-release-service.ts`
- `secret-store.ts`
- `vault-manager.ts`
- `sync-orchestrator.ts`
- `digest-service.ts`

This is an internal refactor that keeps runtime ownership but prevents one giant service class from becoming the only place changes can land.

### Receipts and observability

**PROPOSED** expand receipt types for:
- sync cycles,
- digest generation,
- proposal creation,
- approval decision,
- external action execution,
- context release,
- vault access,
- import/export/delete events.

### Approval model

**PROPOSED** extend current intervention model with action-specific approval metadata:
- `actionType`
- `domain`
- `riskClass`
- `payloadPreview`
- `idempotencyKey`
- `expiresAt`
- `resolvedBy`
- `decisionReason`

Default approval posture:
- read-only sync/digest: allow
- file write: ask
- calendar write: ask
- email send: ask
- todo write: ask
- GitHub write: ask/deny initially
- finance read full-content release: ask
- finance write: deny
- medical read full-content release: ask
- medical write: deny

## Phase plan

---

## Phase 0 — truth pass, doc correction, and guardrails

### Goal
Align docs with code reality and prevent further drift before adding product capabilities.

### Why now
Current docs overstate completion for the target end state. That will distort every future design decision if left uncorrected.

### Exact packages/files to change
- `README.md`
- `architecture.md`
- `buildplan.md`
- `known_bugs.md` if needed
- `docs/phase-audit-2026-03-14.md`
- `packages/scheduler/README.md`
- `docs/control-api.md`, `docs/api-contracts.md` if any route/schema drift is found during implementation
- add/update the four docs requested by this audit

### Actions
- **PROPOSED** explicitly separate “foundation complete” from “assistant product complete”.
- **PROPOSED** mark email/calendar/todo/GitHub/people/finance/medical as not yet built.
- **PROPOSED** document the current runtime-tool workaround in engine/Pi boundary docs as a live caveat, not a resolved detail.
- **PROPOSED** add repo docs describing planned capability-module pattern.

### Migration implications
None.

### Test implications
Minimal; add doc/link lint if available.

### Acceptance criteria
- Docs no longer imply assistant capabilities exist where they do not.
- Package READMEs describe current code truth.
- Product roadmap docs point to capability-module plan and sensitive-data posture.

---

## Phase 1 — policy, secret-store, and vault substrate

### Goal
Create the minimum architecture required to safely add real personal data sources.

### Why now
Without domain permissions, action approvals, and restricted vaults, adding email/calendar/finance/medical would create unsafe architectural debt.

### Exact packages/files to change
- `packages/contracts/src/config.ts`
- `packages/contracts/src/execution.ts`
- `packages/contracts/src/memory.ts`
- `packages/contracts/src/api.ts`
- `packages/runtime-core/src/runtime-service.ts`
- `packages/runtime-core/src/database.ts`
- `packages/runtime-core/src/auth.ts`
- `packages/runtime-core/src/keychain.ts`
- `packages/runtime-core/src/backup.ts`
- `packages/observability/src/*`
- `packages/control-api/src/index.ts`
- `config/example.json`
- `docs/config-reference.md`
- `docs/specs/backup-restore-and-retention.md`
- add new runtime-core modules: `secret-store.ts`, `approval-service.ts`, `vault-manager.ts`, `context-release-service.ts`

### Actions
- **PROPOSED** add capability connection config:
  - provider kind
  - secret ref
  - allowed scopes
  - read/write mode
  - sync interval
  - allowed repos/calendars/accounts/roots
- **PROPOSED** add domain and trust model:
  - `domain`: general/email/calendar/todos/github/files/people/finance/medical
  - `sensitivity`: internal/personal/restricted
  - `embeddingPolicy`: none/derived_only/full
  - `contextReleasePolicy`: none/summary/excerpt/full
- **PROPOSED** implement secret-store abstraction:
  - macOS Keychain backend first
  - passphrase-wrapped local fallback backend for non-Keychain environments
- **PROPOSED** implement vault manager for restricted stores
- **PROPOSED** extend interventions/approvals with structured action payloads
- **PROPOSED** version backup format for per-store backup manifests and encrypted restricted-vault backups
- **PROPOSED** add context-release receipts

### Migrations
- `app.db`: add approval/intervention fields, capability connections, secret refs, maybe policy records
- `memory.db`: add domain/trust/context-release fields or a migration mapping from current classification
- backup manifest version bump

### API changes
- `/v1/approvals`
- `/v1/approvals/:id`
- `/v1/approvals/:id/resolve`
- `/v1/security/policy`
- `/v1/connections`
- `/v1/context-release/preview` (if needed for restricted reads)

### Receipts/logging changes
- add `approval_requested`
- add `approval_resolved`
- add `context_released`
- add `vault_accessed`
- add `secret_rotated` / `connection_updated`

### Testing strategy
- secret-store backend tests
- approval lifecycle tests
- migration tests for new contract fields
- encrypted backup/restore tests
- context-release policy tests
- redaction tests for new domains

### Acceptance criteria
- No future provider token needs to live as raw plaintext in normal DB records or logs.
- Runtime can represent domain-aware approvals.
- Restricted vault storage model exists, even before finance/medical are onboarded.
- Backups can distinguish ordinary stores from restricted vault stores.

---

## Phase 2 — file roots, personal knowledge substrate, and runtime modularization

### Goal
Finish the local knowledge/file substrate and reduce `runtime-service.ts` growth before domain packages land.

### Why now
Files and memory are core to almost every future slice. Also, runtime modularization is easier before five new capabilities are added.

### Exact packages/files to change
- `packages/runtime-core/src/runtime-service.ts`
- `packages/runtime-core/src/database.ts`
- `packages/workspace/src/policy.ts`
- `packages/workspace/src/workspace-registry.ts`
- `packages/memory/src/*`
- new `packages/cap-files`
- `packages/contracts/src/api.ts`
- `packages/contracts/src/config.ts`
- `packages/control-api/src/index.ts`
- `apps/web-inspector/src/views/*`
- `apps/cli/src/index.ts`

### Actions
- **PROPOSED** add explicit file roots with permissions:
  - read-only roots
  - index-enabled roots
  - write-disabled by default
- **PROPOSED** create file capability package with:
  - root registration
  - indexing/reindex jobs
  - search APIs
  - provenance into memory
- **PROPOSED** refactor runtime-core to load capability modules through a capability registry
- **PROPOSED** add personal-knowledge derived memory flows from approved files/notes only
- **PROPOSED** keep promotion into durable curated memory conservative

### Migrations
- add `file_roots`, `file_permissions`, and file index metadata store
- optional memory provenance expansion

### API changes
- `/v1/files/roots`
- `/v1/files/search`
- `/v1/files/documents/:id`
- `/v1/files/reindex`
- CLI commands for root registration and reindex

### Jobs/watchers
- file reindex jobs
- stale-index repair jobs

### Receipts/logging changes
- file index/update receipts
- file read context-release receipts for sensitive roots
- explicit write-denied receipts for disallowed mutations

### Testing strategy
- path boundary tests
- index/reindex tests
- provenance tests
- root permission tests
- runtime modularization regression tests

### Acceptance criteria
- Operator can explicitly grant a root for indexing/search.
- Runtime can search indexed file knowledge without direct DB access from UI.
- Runtime-core is segmented enough that new capabilities do not need to pile into one giant class.

---

## Phase 3 — first vertical slice: read-only email digest and triage

### Goal
Ship the first truly useful assistant slice.

### Why this slice first
**PROPOSED** Email is high-value, read-only is safe, and it directly exercises:
- secret store,
- sync cursors,
- receipts,
- memory derivation,
- digests,
- people context seeds,
- approval architecture for future drafting/sending.

### Exact packages/files to change
- new `packages/cap-email`
- `packages/contracts/src/api.ts`
- `packages/contracts/src/config.ts`
- `packages/runtime-core/src/runtime-service.ts`
- `packages/control-api/src/index.ts`
- `packages/api-client/src/index.ts`
- `generated/swift/PopeyeModels.swift`
- `scripts/generate-swift-models.ts`
- `packages/runtime-core/src/database.ts`
- `packages/memory/src/*` (email-derived memory filters)
- `packages/receipts/src/*` or runtime receipt emitters
- `apps/web-inspector/src/views/*`
- `apps/cli/src/index.ts`
- `config/example.json`
- docs/runbooks for provider onboarding

### Capability shape
`packages/cap-email/src/`
- `schemas.ts`
- `provider/gmail.ts` (or chosen provider)
- `db.ts`
- `sync.ts`
- `service.ts`
- `digest.ts`
- `tools.ts`
- `receipts.ts`
- tests

### Actions
- **PROPOSED** implement read-only provider adapter and sync cursors
- **PROPOSED** store normalized accounts/threads/messages locally
- **PROPOSED** generate digest views:
  - unread summary
  - high-signal thread shortlist
  - stale follow-up candidates
- **PROPOSED** expose email search/read summary runtime tools
- **PROPOSED** create memory only from derived summaries/curated facts, not raw bodies by default

### Migrations / stores
- `capabilities/email.db` with accounts, labels, threads, messages, sync cursors, digest metadata
- runtime connection records in `app.db`

### API changes
- `/v1/email/accounts`
- `/v1/email/threads`
- `/v1/email/threads/:id`
- `/v1/email/messages/:id`
- `/v1/email/digest`
- `/v1/email/sync`
- maybe `/v1/email/search`

### Jobs/watchers
- scheduled inbox sync
- digest generation
- stale-thread review

### Receipts / logging / observability
- sync receipts by account
- digest receipts
- context-release receipts for raw message excerpts
- stronger email-specific redaction rules

### Memory changes
- derived memory from sender importance, recurring commitments, follow-up facts
- people seeds from sender identities
- default no embeddings on raw email body content unless explicitly downgraded and redacted

### Approval model
- read-only sync and digest: auto
- future draft generation: ask before storing draft proposal if raw sensitive content is included
- send: not in this phase

### Testing strategy
- provider fakes in `packages/testkit`
- sync replay/idempotency tests
- digest ranking tests
- redaction tests
- raw-body context policy tests
- end-to-end local flow tests via control API + web/CLI

### Acceptance criteria
- Popeye can sync one approved inbox account locally.
- It can produce a reliable unread/high-signal digest.
- No email send or archive side effects occur.
- All artifacts remain local and auditable.

---

## Phase 4 — second vertical slice: calendar read, summarize, and propose writes with approval

### Goal
Make Popeye useful for agenda awareness and planning while keeping writes tightly controlled.

### Exact packages/files to change
- new `packages/cap-calendar`
- `packages/runtime-core/src/runtime-service.ts`
- `packages/runtime-core/src/database.ts`
- `packages/control-api/src/index.ts`
- `packages/api-client/src/index.ts`
- `generated/swift/PopeyeModels.swift`
- `scripts/generate-swift-models.ts`
- `packages/contracts/src/api.ts`
- `packages/contracts/src/config.ts`
- `apps/web-inspector/src/views/*`
- `apps/cli/src/index.ts`

### Actions
- **PROPOSED** implement read-only calendar sync
- **PROPOSED** local event store with recurrence support
- **PROPOSED** agenda and conflict summary jobs
- **PROPOSED** proposal model for create/update/cancel
- **PROPOSED** approval-required execution path for writes

### Migrations / stores
- `capabilities/calendar.db`: calendars, events, instances, attendees, sync cursors, proposals, action executions

### API changes
- `/v1/calendar/agenda`
- `/v1/calendar/events`
- `/v1/calendar/proposals`
- `/v1/calendar/proposals/:id/approve`
- `/v1/calendar/proposals/:id/reject`

### Jobs/watchers
- recurring sync
- daily agenda digest
- upcoming-conflict detection
- missed-follow-up reminders

### Receipts / logging
- sync receipts
- proposal receipts
- approved execution receipts
- context-release receipts for full event details when needed

### Memory changes
- derived memory for routines, meeting cadence, recurring commitments
- avoid raw long descriptions by default

### Approval model
- event writes always require approval in this phase
- no autonomous modifications

### Testing strategy
- recurrence parsing tests
- proposal diff tests
- idempotent write tests
- approval resolution tests
- digest tests

### Acceptance criteria
- Popeye can summarize the agenda and spot conflicts.
- It can propose event changes.
- Operator can approve or reject each write.
- No hidden calendar changes occur.

---

## Phase 5 — third vertical slice: canonical todos and reconciliation

### Goal
Give Popeye a local task model it actually owns.

### Why this is the third slice
After email and calendar, Popeye has incoming commitments and scheduled obligations. A canonical todo model lets it reconcile that into action.

### Exact packages/files to change
- new `packages/cap-todos`
- `packages/runtime-core/src/runtime-service.ts`
- `packages/runtime-core/src/database.ts`
- `packages/control-api/src/index.ts`
- `packages/api-client/src/index.ts`
- `generated/swift/PopeyeModels.swift`
- `scripts/generate-swift-models.ts`
- `packages/contracts/src/api.ts`
- `packages/contracts/src/config.ts`
- `apps/web-inspector/src/views/*`
- `apps/cli/src/index.ts`

### Actions
- **PROPOSED** create a local canonical todo store
- **PROPOSED** support initial ingest from simple local formats/importers before provider sprawl
- **PROPOSED** reconcile tasks from email/calendar derived suggestions into canonical todos
- **PROPOSED** add review flows:
  - inbox-to-todo
  - due-soon review
  - overdue review
  - weekly review

### Migrations / stores
- `capabilities/todos.db`: todo items, sources, state history, recurrence, links to email/calendar/github items

### API changes
- `/v1/todos`
- `/v1/todos/inbox`
- `/v1/todos/reconcile`
- `/v1/todos/reviews`
- `/v1/todos/:id`

### Jobs/watchers
- daily task review
- overdue reminder
- weekly reconciliation

### Receipts / logging
- reconciliation receipts
- prioritization receipts
- approval receipts for destructive changes if introduced later

### Memory changes
- routine/habit memory can be derived from completed recurring tasks
- avoid automatic durable memory promotion without repetition/confidence

### Approval model
- creating suggested todo items may be automatic into an inbox state
- destructive merges/deletes ask for approval or remain reversible

### Testing strategy
- dedupe/reconcile tests
- priority/ranking tests
- recurrence tests
- import/export tests

### Acceptance criteria
- Popeye owns a local todo list.
- Email/calendar can feed suggested tasks into it.
- Operator can review and reconcile tasks locally.

---

## Phase 6 — GitHub monitoring and repo watch

### Goal
Add repo-awareness without turning Popeye back into a devtool platform.

### Exact packages/files to change
- new `packages/cap-github`
- `packages/runtime-core`
- `packages/runtime-core/src/database.ts`
- `packages/control-api`
- `packages/api-client/src/index.ts`
- `generated/swift/PopeyeModels.swift`
- `scripts/generate-swift-models.ts`
- `packages/contracts`
- `apps/web-inspector`
- `apps/cli`

### Actions
- **PROPOSED** implement read-only GitHub watch on an explicit repo allowlist
- **PROPOSED** normalize issues, PRs, comments, reviews, checks, releases
- **PROPOSED** generate repo digests and “needs attention” views
- **PROPOSED** keep write actions (comment/merge/close) out of scope for this phase

### Stores
- `capabilities/github.db`

### API changes
- `/v1/github/repos`
- `/v1/github/feed`
- `/v1/github/items/:id`
- `/v1/github/digest`

### Jobs/watchers
- repo poll jobs per subscription
- digest jobs
- stale review reminder jobs

### Security considerations
- fine-grained read-only repo access
- explicit allowlist of repos
- token in secret store only

### Acceptance criteria
- Popeye can tell the operator what changed across chosen repos.
- No write actions are performed.

---

## Phase 7 — cross-capability digests, reminders, and proactive reviews

### Goal
Turn separate capabilities into an actual assistant rhythm.

### Exact packages/files to change
- `packages/runtime-core` (digest/orchestration)
- capability packages
- `packages/control-api`
- `apps/web-inspector`
- `apps/cli`
- possibly `packages/telegram` surfaces for notifications

### Actions
- **PROPOSED** add unified morning briefing:
  - calendar agenda
  - email digest
  - task shortlist
  - GitHub attention items
- **PROPOSED** add weekly review
- **PROPOSED** add reminder and follow-up rules
- **PROPOSED** add quiet hours / notification sensitivity settings

### API changes
- `/v1/digests/morning`
- `/v1/digests/weekly`
- `/v1/reminders`
- `/v1/check-ins`

### Jobs/watchers
- morning digest
- evening follow-up
- weekly review
- staleness audits

### Security considerations
- notification redaction levels by surface
- Telegram notifications must be more aggressively redacted than local web UI

### Acceptance criteria
- Popeye can proactively surface useful, bounded, reviewable summaries across domains.
- Operator can inspect why each item appeared and trace it back to source data.

---

## Phase 8 — finance vault, read-only first

### Goal
Introduce financial data safely and conservatively.

### Why now
Only after approvals, secret handling, vaults, receipts, and context-release controls have been proven in less restricted domains.

### Exact packages/files to change
- new `packages/vault-finance`
- runtime-core vault/policy modules
- control-api
- contracts
- observability
- backup/restore code and docs
- web inspector/CLI read-only views

### Actions
- **PROPOSED** add encrypted finance vault DB
- **PROPOSED** add read-only import pipelines:
  - operator-selected documents/folders first
  - provider APIs later only if needed
- **PROPOSED** extract obligations, due dates, balances, statement metadata
- **PROPOSED** produce reminders and summaries without exposing raw docs by default

### API changes
- `/v1/finance/overview`
- `/v1/finance/obligations`
- `/v1/finance/documents`
- `/v1/finance/release-preview`
- no write endpoints

### Approval model
- full raw-content release to LLM: always ask
- any write/mutation: deny in this phase

### Acceptance criteria
- Finance data is stored separately and encrypted.
- Raw data does not automatically enter general memory or model context.
- Operator can review reminders and derived summaries locally.

---

## Phase 9 — medical vault, read-only first

### Goal
Support medical context with the strictest default posture.

### Exact packages/files to change
- new `packages/vault-medical`
- runtime-core vault/policy modules
- control-api
- contracts
- observability
- backup/restore code/docs
- web inspector/CLI read-only views

### Actions
- **PROPOSED** add encrypted medical vault DB
- **PROPOSED** import appointments, prescriptions, records, labs/history from approved sources
- **PROPOSED** generate reminders for appointments/medications/refills
- **PROPOSED** block raw model context by default

### API changes
- `/v1/medical/appointments`
- `/v1/medical/medications`
- `/v1/medical/documents`
- `/v1/medical/release-preview`
- no write endpoints

### Approval model
- full-content release: always ask
- all writes: deny in this phase

### Acceptance criteria
- Medical data is isolated, encrypted, and redacted in outputs.
- Assistant behavior is limited to read-only reminders and summaries.

---

## Phase 10 — interface polish and optional native surfaces

### Goal
Improve operator experience after the runtime model stabilizes.

### Why last
The runtime/control/policy architecture matters far more than native UI polish right now.

### Exact packages/files to change
- `apps/web-inspector`
- `apps/macos`
- `generated/swift`
- `packages/api-client`
- `packages/control-api`

### Actions
- **PROPOSED** improve approvals UI
- **PROPOSED** improve digest and review surfaces
- **PROPOSED** only then reconsider `apps/macos`

### Acceptance criteria
- UI remains a client of the control API.
- No UI surface introduces direct DB coupling.

## Fix plan integration

These fixes should occur in Phase 0–2, not later:
- doc drift correction
- approval model strengthening
- domain/trust model introduction
- secret-store abstraction
- runtime-service modularization
- file permission model expansion
- backup encryption/versioning for restricted vaults
- Pi host-tool boundary hardening for richer capability tools

## Config changes

**PROPOSED** extend `config/example.json` and config schema with:
- `capabilities.email`
- `capabilities.calendar`
- `capabilities.todos`
- `capabilities.github`
- `capabilities.files`
- later `capabilities.finance`
- later `capabilities.medical`
- `approvalPolicies`
- `notificationPolicies`
- `vaults`
- `quietHours`
- per-capability allowlists

## Testing strategy

### Unit tests
- provider adapters
- approval policies
- redaction rules
- context release rules
- secret-store backends
- ranking/reconciliation logic

### Integration tests
- DB migrations
- sync replay/recovery
- action idempotency
- backup/restore by store
- encrypted vault restore

### End-to-end tests
- daemon + control API + capability read models
- approval flows
- digest generation
- crash/restart/recovery
- Telegram/web inspector notification surfaces

### Security tests
- auth/CSRF
- path traversal
- secret leakage/redaction
- prompt-injection quarantine/sanitize
- restricted data context-release rules

## Rollout strategy

1. **PROPOSED** feature-flag each capability in config.
2. **PROPOSED** add one provider/account/source at a time.
3. **PROPOSED** keep every new capability read-only first.
4. **PROPOSED** require backup/restore drills before restricted-domain rollout.
5. **PROPOSED** do not enable finance/medical until receipts, approvals, and vault backups are proven in practice.
6. **PROPOSED** keep old routes and schemas compatible until migrated clients are updated.

## What should not be built yet

- **PROPOSED** no plugin marketplace
- **PROPOSED** no multi-tenant/cloud architecture
- **PROPOSED** no remote mobile auth stack
- **PROPOSED** no autonomous email send
- **PROPOSED** no autonomous calendar modification
- **PROPOSED** no GitHub write actions
- **PROPOSED** no finance write flows
- **PROPOSED** no medical write flows
- **PROPOSED** no broad whole-disk indexing
- **PROPOSED** no premature provider-agnostic framework before a second provider exists

## Implementation-plan conclusion

**VERIFIED IN CODE** — Popeye already has the hard part that many projects never get: a coherent local runtime/control-plane skeleton.  
**PROPOSED** — The winning path is to treat that skeleton as the permanent product core, strengthen security/policy boundaries, and add assistant domains one by one in runtime-owned capability modules.
