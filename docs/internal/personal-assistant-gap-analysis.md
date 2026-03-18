# Popeye personal assistant gap analysis

Date: 2026-03-16

# Evidence legend

- **VERIFIED IN CODE** — I directly inspected the repository tree and/or file contents and confirmed the statement in code.
- **DOC CLAIM ONLY** — the statement appears in repo documentation, but I did not find it confirmed in code during this audit.
- **INFERRED** — the statement is a reasoned conclusion from inspected structure, tests, docs, or adjacent code, but not line-verified end-to-end.
- **PROPOSED** — this is my recommended future design or implementation step.


## Framing

This document maps the target personal-assistant product to the current Popeye repo.

**Core judgment**: the runtime/control-plane foundation is real and reusable. The gap is primarily in:
- product capability modules,
- policy/security architecture,
- domain data modeling,
- capability-local sync stores,
- action approvals,
- sensitive-domain isolation.

## Recommended target shape

**PROPOSED** — Each major assistant domain should be implemented as a **runtime-owned capability module** with three layers:

1. **Adapter layer**  
   Provider/API auth, polling, cursor handling, normalization.  
   Example: Gmail adapter, Google Calendar adapter, GitHub adapter.

2. **Local domain store + sync layer**  
   Durable local SQLite store, sync cursors/checkpoints, provenance, idempotency, repair/replay behavior.

3. **Runtime service layer**  
   Product semantics: digests, triage, proposals, approvals, memory derivation, receipts, runtime tools, control API read models.

This means:
- **not** plugin marketplace,
- **not** UI-owned logic,
- **not** a generic multi-tenant integration framework,
- **not** direct provider access from Pi or the web UI.

## Gap map: core runtime

### Always-on daemon lifecycle

| Field | Analysis |
|---|---|
| Target behavior | Reliable boot, shutdown, restart, recovery, scheduler ownership, durable runtime state. |
| Current repo support | **VERIFIED IN CODE** daemon bootstrap, scheduler start, loopback API, graceful shutdown, CLI daemon lifecycle commands. |
| Missing components | **INFERRED** richer health/readiness surfaces for capability watchers and sync loops. |
| Design decision needed | **PROPOSED** keep daemon ownership centralized in `apps/daemon`; do not move capability loops into UI apps. |
| Recommended package location | `apps/daemon`, `packages/runtime-core` |
| Data model changes | `daemon_components` or equivalent readiness view for capability watchers (optional). |
| API changes | `/v1/daemon/components`, `/v1/sync/status` later. |
| Security considerations | Loopback-only remains correct. |
| Testing requirements | watcher lifecycle tests, restart/recovery tests, migration + restart tests. |

### Heartbeat / scheduled work / proactive behavior

| Field | Analysis |
|---|---|
| Target behavior | Recurring jobs for digests, syncs, reminders, reviews, follow-ups. |
| Current repo support | **VERIFIED IN CODE / INFERRED** scheduler/job/lease substrate exists. |
| Missing components | Capability-specific recurring jobs; calendar/email/GitHub/todo watch rules; approval-aware proactive actions. |
| Design decision needed | **PROPOSED** define job kinds per capability and per action mode (`observe`, `summarize`, `propose`, `apply`). |
| Recommended package location | `packages/runtime-core` orchestration + per-capability packages |
| Data model changes | job metadata for `capability`, `jobKind`, `approvalMode`, `idempotencyKey`, `cursorRef`. |
| API changes | `/v1/jobs` filtering by capability/kind; `/v1/digests/*`; `/v1/reminders/*`. |
| Security considerations | Proactive jobs must default to observe/summarize only. |
| Testing requirements | scheduler replay/idempotency tests, duplicate-suppression tests, time-window tests. |

### Recoverable task execution

| Field | Analysis |
|---|---|
| Target behavior | Idempotent external actions, crash-safe recovery, retry semantics, operator intervention when ambiguous. |
| Current repo support | **VERIFIED IN CODE / INFERRED** tasks/jobs/runs/leases/interventions/retry/recovery foundation exists. |
| Missing components | Provider action idempotency, capability-specific outbox/action logs, ambiguous-result resolution for external APIs. |
| Design decision needed | **PROPOSED** reuse interventions for operator resolution; add structured approval/action records rather than ad hoc run metadata. |
| Recommended package location | `packages/contracts`, `packages/runtime-core`, per-capability packages |
| Data model changes | `action_proposals`, `action_executions`, `sync_cursors`, `outbox`-style records or equivalent. |
| API changes | `/v1/approvals`, `/v1/actions`, `/v1/sync/cursors` read models. |
| Security considerations | Every side effect must be tied to a proposal/action idempotency key and receipt. |
| Testing requirements | crash/restart tests, replay tests, external ambiguity tests, operator-resolution tests. |

### Intervention / approval flows

| Field | Analysis |
|---|---|
| Target behavior | Explicit approvals by action type/domain, review payloads, operator override, expiry, audit trail. |
| Current repo support | **VERIFIED IN CODE** generic interventions exist. |
| Missing components | Structured approval types for email send, calendar write, file write, finance read, medical read, etc. |
| Design decision needed | **PROPOSED** extend `interventions` into a structured approval system instead of inventing a separate disconnected mechanism. |
| Recommended package location | `packages/contracts/src/execution.ts`, `packages/runtime-core`, `packages/control-api`, `apps/web-inspector`, `apps/cli` |
| Data model changes | Add `intervention_type`, `action_type`, `domain`, `payload_json`, `expires_at`, `resolved_by`, `decision_receipt_id`. |
| API changes | `/v1/approvals` or richer `/v1/interventions` payloads. |
| Security considerations | Restricted-domain approvals must include data-minimized previews. |
| Testing requirements | approval lifecycle tests, expiry tests, CSRF/auth tests, receipt assertions. |

### Local control API

| Field | Analysis |
|---|---|
| Target behavior | Stable local surface for web/desktop/CLI/admin clients. |
| Current repo support | **VERIFIED IN CODE** strong current boundary. |
| Missing components | Capability endpoints, approval endpoints, sync status, policy inspection. |
| Design decision needed | **PROPOSED** keep one runtime-owned API; do not let UI or provider adapters bypass it. |
| Recommended package location | `packages/control-api`, `packages/api-client`, `generated/swift` |
| Data model changes | response schemas for new capabilities and approvals. |
| API changes | add `/v1/email/*`, `/v1/calendar/*`, `/v1/todos/*`, `/v1/github/*`, `/v1/files/*`, `/v1/people/*`, `/v1/approvals/*`, `/v1/sync/*`. |
| Security considerations | preserve loopback, auth, CSRF, and browser bootstrap posture. |
| Testing requirements | contract tests, CSRF tests, SSE tests, auth tests for new routes. |

### Memory with provenance and retrieval

| Field | Analysis |
|---|---|
| Target behavior | Deep personal memory with provenance, retrieval, trust filters, domain-aware context release. |
| Current repo support | **VERIFIED IN CODE** strong general memory foundation with provenance and search. |
| Missing components | domain axis, trust levels, restricted vault-derived memory, context release rules, memory classes for finance/medical. |
| Design decision needed | **PROPOSED** split current classification model into domain + sensitivity + embedding eligibility + context release policy. |
| Recommended package location | `packages/contracts/src/memory.ts`, `packages/contracts/src/config.ts`, `packages/memory`, `packages/runtime-core` |
| Data model changes | add `domain`, `trust_level`, `embedding_policy`, `context_release_policy`, `vault_id`/`source_store`. |
| API changes | query filters by domain/trust, context-release preview endpoints. |
| Security considerations | no raw finance/medical content into general memory by default. |
| Testing requirements | migration tests, retrieval-filter tests, policy tests, redaction tests. |

### Audit / receipts / observability

| Field | Analysis |
|---|---|
| Target behavior | Every ingest, sync, proposal, approval, mutation, and context release is auditable. |
| Current repo support | **VERIFIED IN CODE** strong base. |
| Missing components | receipts for sync cycles, proposal decisions, provider actions, context releases, vault access. |
| Design decision needed | **PROPOSED** keep receipts runtime-owned; every capability must emit normalized receipt events. |
| Recommended package location | `packages/receipts`, `packages/runtime-core`, per-capability packages |
| Data model changes | new receipt types and structured payload shapes. |
| API changes | filters by capability/domain/action/result. |
| Security considerations | store hashes/IDs for restricted content rather than raw payloads. |
| Testing requirements | receipt completeness tests, redaction tests, restore/replay tests. |

### Safe file access / explicit workspace access

| Field | Analysis |
|---|---|
| Target behavior | Explicit operator-granted read roots and write roots, file indexing, provenance, safe mutations with approval. |
| Current repo support | **VERIFIED IN CODE** workspace/project registry and narrow critical-file policy. |
| Missing components | explicit allowed roots beyond workspaces, per-root permissions, file index, content parsers, capability UI/API. |
| Design decision needed | **PROPOSED** create a dedicated file capability rather than stretching workspace registry to do everything. |
| Recommended package location | new `packages/cap-files`, plus `packages/workspace` extensions |
| Data model changes | `file_roots`, `file_documents`, `file_chunks`, `file_permissions`, `file_actions`. |
| API changes | `/v1/files/roots`, `/v1/files/search`, `/v1/files/documents/:id`, `/v1/files/actions/*`. |
| Security considerations | default read-only, per-root allowlists, approval for write/delete/move. |
| Testing requirements | path traversal tests, root-boundary tests, parser tests, mutation approval tests. |

## Gap map: personal assistant capabilities

### Email

| Field | Analysis |
|---|---|
| Target behavior | Read, summarize, triage, classify, digest, search, draft replies, send with approval. |
| Current repo support | **VERIFIED IN CODE** none beyond generic runtime foundation. |
| Missing components | provider adapter, local email store, thread/message schemas, sync cursors, digest jobs, search/read APIs, draft/send approval flow. |
| Design decision needed | **PROPOSED** start provider-specific (Gmail first if that is the chosen provider) behind runtime-owned email service; avoid premature generic provider abstraction. |
| Recommended package location | new `packages/cap-email`; runtime orchestration in `packages/runtime-core`; API in `packages/control-api`. |
| Data model changes | accounts, labels, threads, messages, snippets, sync cursors, email action proposals, delivery receipts. |
| API changes | `/v1/email/accounts`, `/v1/email/threads`, `/v1/email/messages/:id`, `/v1/email/digests`, `/v1/email/proposals/:id/*`. |
| Security considerations | raw bodies can contain finance/medical data; default to summary/metadata first, provider tokens stored via secret store, send requires approval. |
| Testing requirements | provider fake tests, sync replay tests, digest tests, redaction tests, approval tests, end-to-end read-only slice tests. |

### Calendar

| Field | Analysis |
|---|---|
| Target behavior | Read agenda, summarize, detect conflicts, propose actions, create/modify/cancel with approval. |
| Current repo support | **VERIFIED IN CODE** none beyond generic runtime substrate. |
| Missing components | calendar adapter, local event store, sync cursors, event proposal model, agenda/reminder jobs. |
| Design decision needed | **PROPOSED** calendar write actions should remain proposal-first for a long time. |
| Recommended package location | new `packages/cap-calendar` |
| Data model changes | calendars, events, attendees, event instances, sync cursors, proposals, approvals. |
| API changes | `/v1/calendar/calendars`, `/v1/calendar/events`, `/v1/calendar/agenda`, `/v1/calendar/proposals`. |
| Security considerations | calendar details are personal; full details into LLM context should be filtered by time range/purpose. |
| Testing requirements | recurrence sync tests, conflict detection tests, proposal approval tests, idempotent event mutation tests. |

### Todo / task systems

| Field | Analysis |
|---|---|
| Target behavior | Ingest from chosen source(s), maintain canonical personal task list, prioritize, reconcile duplicates, link to calendar/reminders. |
| Current repo support | **VERIFIED IN CODE** runtime tasks/jobs are orchestration tasks, not end-user todo records. |
| Missing components | canonical todo domain model, source importers, reconciliation logic, ranking/prioritization logic, recurring review jobs. |
| Design decision needed | **PROPOSED** make Popeye own the canonical todo model locally; add source importers later instead of starting with a vendor-shaped model. |
| Recommended package location | new `packages/cap-todos` |
| Data model changes | todo items, source references, reconciliation links, due dates, recurrence, task state history. |
| API changes | `/v1/todos`, `/v1/todos/reconcile`, `/v1/todos/reviews`, `/v1/todos/import/*`. |
| Security considerations | lower risk than email/calendar, but still personal; preserve local-only posture. |
| Testing requirements | reconciliation tests, ranking tests, recurrence tests, import/export tests. |

### GitHub / repo monitoring

| Field | Analysis |
|---|---|
| Target behavior | Watch selected repos for issues, PRs, comments, reviews, checks, failures, releases; deliver digests and reminders. |
| Current repo support | **VERIFIED IN CODE** none as a domain capability. |
| Missing components | GitHub adapter, repo subscription model, normalized event store, digest/watch rules. |
| Design decision needed | **PROPOSED** start read-only with fine-grained read scopes; no write/merge/comment actions early. |
| Recommended package location | new `packages/cap-github` |
| Data model changes | repo subscriptions, issues, PRs, reviews, checks, comments, releases, sync cursors, watch rules. |
| API changes | `/v1/github/repos`, `/v1/github/feed`, `/v1/github/watch-rules`, `/v1/github/items/:id`. |
| Security considerations | PAT/App tokens must live in secret store; repo allowlists should be explicit. |
| Testing requirements | webhook/poll emulation tests, dedupe tests, digest tests, permission-scope tests. |

### Reminders / digests / recurring reviews / proactive check-ins

| Field | Analysis |
|---|---|
| Target behavior | daily agenda, inbox digest, weekly review, repo digest, follow-up reminders, check-ins. |
| Current repo support | **VERIFIED IN CODE / INFERRED** scheduler and messaging surfaces exist, but no assistant digest layer yet. |
| Missing components | digest domain model, templates, scheduling policies, quiet hours, approval boundary for proactive nudges. |
| Design decision needed | **PROPOSED** keep digests runtime-owned and source-agnostic; do not let each adapter invent its own notification layer. |
| Recommended package location | `packages/runtime-core` or later `packages/cap-digests` only if complexity proves it necessary |
| Data model changes | digest jobs, digest results, acknowledgement state, reminder rules. |
| API changes | `/v1/digests`, `/v1/reminders`, `/v1/reviews`. |
| Security considerations | notifications must be redactable and preview-safe, especially for Telegram/mobile. |
| Testing requirements | schedule tests, quiet-hour tests, dedupe tests, redacted-notification tests. |

### File / folder knowledge and indexing

| Field | Analysis |
|---|---|
| Target behavior | index operator-approved roots, search content, summarize docs, link file knowledge to memory. |
| Current repo support | **VERIFIED IN CODE** doc-indexing substrate exists, but no full product capability. |
| Missing components | operator-granted root model, parsers, file metadata/search APIs, reindex jobs, safety policies. |
| Design decision needed | **PROPOSED** keep indexing explicit and scoped; do not build a whole-machine crawler. |
| Recommended package location | new `packages/cap-files` + `packages/memory` integration |
| Data model changes | file roots, doc metadata, chunk metadata, provenance links. |
| API changes | `/v1/files/*` routes. |
| Security considerations | classification per root and per file, write actions separate from read/index. |
| Testing requirements | parser coverage, reindex/recovery tests, root scope tests. |

### People / contact context

| Field | Analysis |
|---|---|
| Target behavior | identify people across email/calendar/GitHub, remember preferences and relationship context. |
| Current repo support | **VERIFIED IN CODE** none as a first-class capability. |
| Missing components | identity resolution model, people store, provenance links, derived memory pipeline. |
| Design decision needed | **PROPOSED** derive people graph from email/calendar/GitHub once those exist; do not build manual CRM first. |
| Recommended package location | new `packages/cap-people` after email/calendar baseline |
| Data model changes | person, identity, alias, relationship fact, confidence, provenance. |
| API changes | `/v1/people`, `/v1/people/:id`, `/v1/people/search`. |
| Security considerations | relationship/private notes should not be auto-exposed to LLMs. |
| Testing requirements | identity merge/split tests, provenance tests, privacy filter tests. |

### Personal knowledge / preferences / routines / habits

| Field | Analysis |
|---|---|
| Target behavior | stable memory of preferences, routines, habits, recurring obligations, personal context. |
| Current repo support | **VERIFIED IN CODE / INFERRED** memory can hold it, but no acquisition and trust model exists yet. |
| Missing components | explicit memory classes, curation flows, routine schedulers, conflict-resolution rules. |
| Design decision needed | **PROPOSED** keep personal preference memory curated/derived, not fully auto-promoted. |
| Recommended package location | `packages/memory`, `packages/runtime-core`, later `packages/cap-people` / `packages/cap-todos` contributions |
| Data model changes | memory domains, trust/source quality, routine records. |
| API changes | preference/routine views or filtered memory APIs. |
| Security considerations | automatic promotion from raw inputs should stay conservative. |
| Testing requirements | promotion policy tests, decay/consolidation tests, retrieval-filter tests. |

## Gap map: sensitive-data domains

### Financial data

| Field | Analysis |
|---|---|
| Target behavior | read balances/documents/obligations locally, summarize safely, surface reminders, remain inspectable and under operator control. |
| Current repo support | **VERIFIED IN CODE** none. |
| Missing components | finance domain model, restricted vault, import/read adapters, obligation tracking, context-release policy, encrypted backup posture. |
| Design decision needed | **PROPOSED** read-only first, file/import first before any bank API automation, zero automatic writes, no embeddings on raw finance docs. |
| Recommended package location | later `packages/vault-finance` or `packages/cap-finance`; vault manager in runtime-core/contracts |
| Data model changes | accounts, statements, obligations, documents, normalized transactions (only if needed), vault metadata, release receipts. |
| API changes | `/v1/finance/*` read-only, plus approval-gated release routes. |
| Security considerations | strongest posture in the system: encrypted vault, field-level redaction, no raw LLM context by default. |
| Testing requirements | encryption/key handling tests, import parser tests, release-policy tests, backup/restore drills. |

### Medical data

| Field | Analysis |
|---|---|
| Target behavior | read appointments, prescriptions, records, labs/history safely; derive reminders and summaries. |
| Current repo support | **VERIFIED IN CODE** none. |
| Missing components | medical domain model, restricted vault, source importers, data minimization, release policy, retention/deletion model. |
| Design decision needed | **PROPOSED** read-only first, explicit document import/scoped connectors later, no raw embeddings, no autonomous actions. |
| Recommended package location | later `packages/vault-medical` or `packages/cap-medical` |
| Data model changes | providers, appointments, medications, documents, results, release receipts, retention tags. |
| API changes | `/v1/medical/*` read-only and approval-gated. |
| Security considerations | same or stricter than finance; context release must be explicit and logged. |
| Testing requirements | encryption tests, parser tests, release-policy tests, backup/restore and deletion tests. |

## Gap map: safety and control

### Secret management / token storage

| Field | Analysis |
|---|---|
| Target behavior | provider tokens in OS secret store or encrypted local secret vault; DB stores references, not raw secrets. |
| Current repo support | **VERIFIED IN CODE** auth token file for local control API exists; macOS keychain helper exists. |
| Missing components | general cross-capability secret store abstraction and provider token lifecycle management. |
| Design decision needed | **PROPOSED** new secret-store abstraction in runtime-core; keychain first on macOS, passphrase-wrapped fallback elsewhere. |
| Recommended package location | `packages/runtime-core` |
| Data model changes | `secret_refs` or connection records storing secret handles. |
| API changes | minimal; onboarding flows only. |
| Security considerations | never put provider tokens in memory, receipts, logs, or plaintext backups. |
| Testing requirements | keychain/passphrase fallback tests, rotation/rebind tests, backup exclusion tests. |

### Local encryption strategy

| Field | Analysis |
|---|---|
| Target behavior | restricted vaults encrypted at rest with envelope encryption and separate backup posture. |
| Current repo support | **VERIFIED IN CODE** none beyond file permissions and OS/local assumptions. |
| Missing components | key hierarchy, vault encryption, wrapped keys, restore path. |
| Design decision needed | **PROPOSED** encrypt restricted vault DBs first; keep `app.db` operational and data-minimized. |
| Recommended package location | `packages/runtime-core` + new vault packages |
| Data model changes | vault metadata, key refs, encrypted backup manifests. |
| API changes | none required for raw key access; keep internal. |
| Security considerations | finance/medical should not rely only on general disk encryption assumptions. |
| Testing requirements | encryption/decryption tests, corrupted-key tests, restore drills. |

### Sensitive data compartmentalization

| Field | Analysis |
|---|---|
| Target behavior | operational state separate from general memory and restricted vaults. |
| Current repo support | **VERIFIED IN CODE** `app.db` and `memory.db` separation exists. |
| Missing components | per-capability stores and restricted vault stores. |
| Design decision needed | **PROPOSED** keep `app.db` for runtime state, `memory.db` for derived/general memory, add capability DBs and restricted vault DBs. |
| Recommended package location | runtime-core + new capability packages |
| Data model changes | per-capability DB schema ownership. |
| API changes | none directly; runtime exposes read models. |
| Security considerations | raw restricted data must stay out of general memory and receipts. |
| Testing requirements | store-boundary tests, restore tests, migration tests. |

### Field-level redaction rules / logging policies

| Field | Analysis |
|---|---|
| Target behavior | secret, account, identity, medical, and financial fields redacted in logs/notifications/receipts. |
| Current repo support | **VERIFIED IN CODE** strong general redaction patterns and prompt scan. |
| Missing components | domain-specific rules (IBAN/account numbers, MRNs, insurance IDs, prescription IDs, etc.) and context-release receipts. |
| Design decision needed | **PROPOSED** extend observability redactors per domain and by output target (logs vs notifications vs LLM context). |
| Recommended package location | `packages/observability`, per-capability packages, runtime-core |
| Data model changes | redaction metadata on receipt/event payloads where needed. |
| API changes | redacted preview endpoints where necessary. |
| Security considerations | Telegram/mobile notifications must be more aggressively redacted than local web UI. |
| Testing requirements | regex safety tests, redaction snapshot tests, target-specific output tests. |

### Data retention / archival / deletion

| Field | Analysis |
|---|---|
| Target behavior | explicit per-domain retention, archive, purge, and export policies. |
| Current repo support | **VERIFIED IN CODE / INFERRED** some backup/archive semantics exist, but no domain retention model. |
| Missing components | retention policy schemas, purge jobs, vault-specific archive/export policy. |
| Design decision needed | **PROPOSED** add domain retention policies before finance/medical ingestion. |
| Recommended package location | contracts + runtime-core + capability packages |
| Data model changes | retention tags, archival state, purge audit records. |
| API changes | policy inspection and export/delete endpoints later. |
| Security considerations | restricted-domain deletion must leave a durable audit of deletion without retaining the deleted data. |
| Testing requirements | purge tests, export tests, restore-after-archive tests. |

### What can enter LLM context

| Field | Analysis |
|---|---|
| Target behavior | principled domain-aware release of data into model context. |
| Current repo support | **VERIFIED IN CODE / DOC CLAIM ONLY** embedding policy discipline exists; formal context-release policy does not. |
| Missing components | context-release classes, operator approval hooks, release receipts, domain filters. |
| Design decision needed | **PROPOSED** four-level model: `none`, `derived_summary_only`, `operator_approved_excerpt`, `full_read_only` (used sparingly). |
| Recommended package location | contracts, runtime-core, memory |
| Data model changes | context release policy fields on sources/memories/capability records. |
| API changes | release preview/approval endpoints for restricted reads. |
| Security considerations | finance/medical default `none`; email/calendar default `derived_summary_only` or tighter by account. |
| Testing requirements | policy matrix tests, context assembly tests, receipt tests. |

## Gap-analysis conclusion

**VERIFIED IN CODE** — Popeye already has the substrate to become a real local personal assistant.  
**VERIFIED IN CODE** — The missing pieces are product-domain capability modules and a much stronger sensitive-data policy architecture.  
**PROPOSED** — The correct move is not a rewrite. It is:
1. harden security/policy/data boundaries,
2. add runtime-owned capability modules one at a time,
3. keep adapters thin,
4. keep UI/API decoupled,
5. keep restricted data out of general memory and general model context by default.
