# Popeye personal assistant current-state audit

Date: 2026-03-16  
Scope: `github.com/salexandr0s/popeye` repo-first/code-first audit for personal-assistant evolution

# Evidence legend

- **VERIFIED IN CODE** — I directly inspected the repository tree and/or file contents and confirmed the statement in code.
- **DOC CLAIM ONLY** — the statement appears in repo documentation, but I did not find it confirmed in code during this audit.
- **INFERRED** — the statement is a reasoned conclusion from inspected structure, tests, docs, or adjacent code, but not line-verified end-to-end.
- **PROPOSED** — this is my recommended future design or implementation step.


## Executive summary

**VERIFIED IN CODE** — Popeye is not greenfield. The repo already contains a real local runtime foundation: a daemon app, a local control API, a runtime service, a scheduler/task/job/run model, receipts, interventions, memory services, observability/redaction, workspace registration/policy, a Telegram thin bridge, a web inspector, a CLI, CI, and a Pi engine adapter boundary.

**VERIFIED IN CODE** — Popeye is also not yet the target personal assistant product. There are no email, calendar, GitHub, todo, contacts, finance, or medical capability packages or app modules in the repo tree. The codebase is a strong runtime/control-plane foundation, not yet an always-on assistant that can operate across those domains.

**INFERRED** — The architecture is directionally right for the intended end state. The strongest parts are the runtime/core package split, the control API boundary, local-first storage, auditable receipts, memory/search foundations, and interface replaceability.

**VERIFIED IN CODE** — The biggest blockers are not “missing daemon basics.” They are:
1. no domain capability modules for the target product areas,
2. no security/data architecture strong enough for finance/medical domains,
3. no explicit approval/policy model by action type and domain,
4. coarse data classification and memory segregation,
5. growing centralization in `packages/runtime-core/src/runtime-service.ts`,
6. some stale/overstated docs.

**Bottom line**: Popeye is a **strong foundation** for a personal assistant, but today it is still **foundation-first**, not **assistant-product-complete**.

## Docs and code areas inspected

**VERIFIED IN CODE** — I inspected these root docs:
- `README.md`
- `architecture.md`
- `buildplan.md`
- `agents.md`
- `CLAUDE.md`
- `known_bugs.md`
- `open_questions.md`

**VERIFIED IN CODE** — I inspected these domain/design docs:
- `docs/phase-audit-2026-03-14.md`
- `docs/current-openclaw-inventory.md`
- `docs/pi-capability-map.md`
- `docs/openclaw-donor-map.md`
- `docs/omissions.md`
- `docs/domain-model.md`
- `docs/session-model.md`
- `docs/memory-model.md`
- `docs/instruction-resolution.md`
- `docs/control-api.md`
- `docs/api-contracts.md`
- `docs/telegram-adapter.md`
- `docs/config-reference.md`
- `docs/runbooks/*`
- `docs/migration/*`
- `docs/specs/*`
- `docs/adr/*`

**VERIFIED IN CODE** — I also inspected the relevant repo tree and representative implementation files under:
- `apps/cli`
- `apps/daemon`
- `apps/web-inspector`
- `apps/macos`
- `packages/contracts`
- `packages/engine-pi`
- `packages/runtime-core`
- `packages/control-api`
- `packages/instructions`
- `packages/memory`
- `packages/observability`
- `packages/receipts`
- `packages/scheduler`
- `packages/sessions`
- `packages/telegram`
- `packages/workspace`
- `packages/api-client`
- `packages/testkit`
- `config/example.json`
- `scripts/*`
- `test/*`
- workspace/build/test/CI config files

## Audit method

I inspected the repo docs first, then the code tree and representative implementation files. I did **not** trust docs blindly. Where a doc made a claim, I checked whether code existed to back it up. Where I did not line-audit every implementation detail, I mark the conclusion **INFERRED** rather than **VERIFIED IN CODE**.

## Repository and build reality

| Area | Status | Evidence |
|---|---|---|
| Monorepo with apps + packages | **VERIFIED IN CODE** | `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `turbo.json` |
| Apps present | **VERIFIED IN CODE** | `apps/cli`, `apps/daemon`, `apps/web-inspector`, `apps/macos` |
| Packages present | **VERIFIED IN CODE** | `packages/api-client`, `contracts`, `control-api`, `engine-pi`, `instructions`, `memory`, `observability`, `receipts`, `runtime-core`, `scheduler`, `sessions`, `telegram`, `workspace`, `testkit` |
| CI exists | **VERIFIED IN CODE** | `.github/workflows/ci.yml` |
| Security/verification scripts exist | **VERIFIED IN CODE** | `scripts/check-pi-boundary.mjs`, `scripts/check-pi-checkout.mjs`, `scripts/scan-secrets.mjs` |
| Playwright / test infra exists | **VERIFIED IN CODE** | `playwright.config.ts`, `vitest.config.ts`, `test/e2e`, `test/smoke` |

## Intended invariants versus code reality

| Intended invariant | Assessment | Notes |
|---|---|---|
| Pi is the engine, not the product | **VERIFIED IN CODE** | `packages/engine-pi` is a narrow engine boundary; runtime semantics live elsewhere. |
| Popeye runtime is the product | **VERIFIED IN CODE** | `packages/runtime-core`, `packages/control-api`, `apps/daemon`, `apps/cli`, `apps/web-inspector` carry product semantics. |
| OpenClaw is a donor, not the architecture | **INFERRED** | Tree/package structure is bespoke; I did not find OpenClaw code in the inspected tree, but I did not run a full source diff against OpenClaw. |
| Runtime/daemon/scheduler/memory/receipts/control API are core | **VERIFIED IN CODE** | Those packages and apps exist and are wired together. |
| Interfaces remain replaceable | **VERIFIED IN CODE** | Engine boundary and Telegram thin bridge are explicit. |
| UI remains decoupled from runtime internals | **VERIFIED IN CODE** | `packages/control-api` + `packages/api-client` exist; ADR 0007 explicitly locks this boundary. |
| Personal data remains local-first | **VERIFIED IN CODE** | Loopback-only bind host in config schema; local SQLite/runtime paths/backups/receipts. |
| Auditability and explicit control beat feature volume | **INFERRED** | Receipts, audit logs, interventions, backup/restore, and boundary scripts support this; however upcoming sensitive domains need stronger formalization. |

## What exists today

### Apps

| App | Assessment | Notes |
|---|---|---|
| `apps/daemon` | **VERIFIED IN CODE — solid foundation** | Boots config, ensures runtime paths, starts runtime, scheduler, control API, optional web inspector, optional Telegram bridge, graceful shutdown. |
| `apps/cli` | **VERIFIED IN CODE — solid operator/admin surface** | Commands for auth, daemon lifecycle, backups, security audit, runs, receipts, memory, jobs, sessions, migrations. |
| `apps/web-inspector` | **VERIFIED IN CODE — real but secondary surface** | React/Vite app exists with views/components; runtime serves it when built. |
| `apps/macos` | **VERIFIED IN CODE — deferred/placeholder** | README says deferred/not started; not part of the TS project references I inspected. |

### Core packages

| Package | Assessment | Notes |
|---|---|---|
| `packages/contracts` | **VERIFIED IN CODE — solid** | Shared Zod types for config, execution, memory, API, security, sessions, etc. |
| `packages/engine-pi` | **VERIFIED IN CODE — solid with caveat** | Strong engine boundary, timeout/cancel, fake adapters, runtime-tool fallback. Caveat: runtime metadata fields are not fully propagated into Pi semantics. |
| `packages/runtime-core` | **VERIFIED IN CODE — strong but centralizing** | Runtime service, DB migrations, auth, browser sessions, prompt scan, memory lifecycle, backup/restore, keychain helper, security audit, message ingress, workspace registry integration. |
| `packages/control-api` | **VERIFIED IN CODE — strong** | Loopback Fastify API with auth, CSRF, browser bootstrap nonce exchange, SSE, task/job/run/memory/security routes. |
| `packages/memory` | **VERIFIED IN CODE — strong foundation, not sensitive-domain ready** | Search, budget fit, compaction, embeddings, integrity checker, doc indexer, summaries, scoring. |
| `packages/observability` | **VERIFIED IN CODE — strong** | Redaction/log hashing package with secret/token patterns. |
| `packages/receipts` | **VERIFIED IN CODE — solid** | Receipt rendering + artifact IO. |
| `packages/scheduler` | **VERIFIED IN CODE — usable but approval-light** | `TaskManager`, retry/coalescing, pause/resume/enqueue. Currently hardcodes `sideEffectProfile: 'read_only'`. |
| `packages/sessions` | **VERIFIED IN CODE — solid foundation** | Session root service + deterministic root IDs. |
| `packages/instructions` | **VERIFIED IN CODE / INFERRED** | Resolver package exists and is referenced by runtime/docs; not every resolution path was line-audited. |
| `packages/telegram` | **VERIFIED IN CODE — strong thin bridge** | Long-poll relay, update normalization, allowlist model, control-plane routing. |
| `packages/workspace` | **VERIFIED IN CODE — partial** | Registry for workspaces/projects and a narrow critical-file mutation policy. |
| `packages/api-client` | **VERIFIED IN CODE / DOC CLAIM ONLY** | Package exists and docs say typed client; I did not line-audit every client method. |
| `packages/testkit` | **VERIFIED IN CODE — small support package** | Re-exports fakes/helpers. |

## Production-readiness assessment

| Subsystem | Assessment | Notes |
|---|---|---|
| Daemon bootstrap + loopback control API + auth/CSRF | **VERIFIED IN CODE — production-grade foundation** | This is the strongest part of the repo and already suitable as the permanent product control plane. |
| Runtime task/job/run/receipt/intervention substrate | **VERIFIED IN CODE — production-grade foundation for local orchestration** | Good enough to keep; needs richer action semantics, not replacement. |
| Observability/redaction/security-audit posture | **VERIFIED IN CODE — production-grade foundation** | Strong for a local single-operator runtime, though not yet domain-specific enough for finance/medical. |
| Telegram thin bridge for current scope | **VERIFIED IN CODE — production-grade for current narrow role** | The bridge is thin, controlled, and aligned with runtime ownership. |
| Memory/search/lifecycle | **VERIFIED IN CODE — strong partial** | Serious capability exists, but restricted-domain handling is not ready. |
| Scheduler/recovery | **VERIFIED IN CODE / INFERRED — strong partial** | Good substrate, but not yet carrying personal-assistant jobs. |
| Workspace/file safety | **VERIFIED IN CODE — partial** | Real foundation exists, but explicit file-root permissions and full file capability are missing. |
| Web inspector | **VERIFIED IN CODE — partial** | Real interface exists, but assistant-domain workflows are not there yet. |
| Backup/restore | **VERIFIED IN CODE — partial** | Good checksum/restore baseline; restricted-vault backup posture is missing. |
| macOS native app | **VERIFIED IN CODE — placeholder/deferred** | Deferred, not started as a real product surface. |
| Email/calendar/todo/GitHub/people/finance/medical capabilities | **VERIFIED IN CODE — not built** | These are the main product gaps. |


## What is solid today

### 1. Local daemon and control-plane foundation

**VERIFIED IN CODE** — `apps/daemon/src/index.ts` does the expected always-on local-runtime work:
- requires a config path,
- ensures runtime paths,
- cleans stale Pi temp directories,
- creates the runtime service,
- starts the scheduler,
- mounts the control API,
- serves the web inspector when available,
- binds to loopback,
- optionally starts Telegram,
- performs graceful shutdown.

This is a real daemon foundation, not a stub.

### 2. Local-only control API boundary

**VERIFIED IN CODE** — `packages/control-api/src/index.ts` exposes a substantial `/v1/*` API with:
- bearer auth and browser-session auth,
- CSRF enforcement,
- browser bootstrap nonce exchange,
- rate limiting,
- security headers,
- SSE,
- routes for tasks, jobs, runs, receipts, instruction previews, interventions, memory, messages, Telegram relay state, usage, and security audit.

This is the right architectural boundary for future local web/desktop/admin surfaces.

### 3. Runtime-owned orchestration model

**VERIFIED IN CODE** — the runtime owns:
- task/job/run state,
- scheduler ticks and leases,
- receipts,
- workspace/project registration,
- session roots,
- message ingestion,
- intervention creation/resolution,
- memory services,
- query/status surfaces.

That is the correct product shape for a single-operator assistant.

### 4. Message ingress and Telegram bridge discipline

**VERIFIED IN CODE** — inbound message handling is more mature than a typical side project:
- durable `message_ingress`,
- duplicate replay handling,
- prompt-injection quarantine/sanitize paths,
- security audit events,
- linkage from ingress → task/job/run,
- explicit Telegram delivery state handling.

This thin-bridge pattern is a good model for future external interface adapters.

### 5. Memory/search/maintenance substrate

**VERIFIED IN CODE** — the repo contains:
- memory contracts,
- search service,
- scoring/strategy,
- integrity checks,
- budget fitting,
- compaction/summarization modules,
- workspace document indexing modules,
- runtime hooks to start maintenance and doc indexing.

This is more than placeholder memory. It is a meaningful substrate.

### 6. Observability and receipts

**VERIFIED IN CODE** — Popeye already values inspectability:
- receipt manager package,
- log redaction package,
- runtime security audit trail,
- backup manifest checksums,
- CLI receipt and audit commands.

This is exactly the kind of foundation worth preserving.

## What is partial today

### 1. Always-on assistant behavior

**VERIFIED IN CODE / INFERRED** — scheduler, leases, retries, recovery, startup reconciliation, and heartbeat session kinds exist or are referenced.  
**Assessment**: partial, because the generic runtime behavior exists, but the personal-assistant jobs that would make Popeye proactively useful are not yet implemented.

### 2. Approval/intervention model

**VERIFIED IN CODE** — interventions exist.  
**VERIFIED IN CODE** — `TaskManager` hardcodes `sideEffectProfile: 'read_only'`.  
**Assessment**: partial. There is an intervention mechanism, but there is not yet a strong action-type/domain-based approval model for assistant behavior.

### 3. File/workspace safety

**VERIFIED IN CODE** — workspaces and projects can be registered and stored.  
**VERIFIED IN CODE** — critical file writes for `WORKSPACE.md`, `PROJECT.md`, `IDENTITY.md`, `HEARTBEAT.md` require explicit approval via `packages/workspace/src/policy.ts`.  
**Assessment**: partial. This is not yet a full scoped filesystem capability or a file-indexing assistant feature.

### 4. Backup and restore

**VERIFIED IN CODE** — backup/verify/restore logic exists and the CLI exposes it.  
**VERIFIED IN CODE** — backups are checksum-verified and copy config/state/receipts and optional workspace paths.  
**Assessment**: partial. Good foundation, but no encryption for restricted domains and no per-vault restore posture.

### 5. Memory for deeply personal life context

**VERIFIED IN CODE** — memory exists, provenance fields exist, classifications exist, embedding gating exists.  
**Assessment**: partial. Good for ordinary assistant memory; not sufficient yet for “knows everything about me” across finance/medical data.

### 6. Web inspector

**VERIFIED IN CODE** — real app exists.  
**INFERRED** — it is useful for internal inspection and admin.  
**Assessment**: partial, because assistant-domain surfaces are not yet present.

## What is missing today

### Personal assistant capability modules

**VERIFIED IN CODE** — I did not find packages or app modules for:
- email,
- calendar,
- todo/task systems beyond runtime task orchestration,
- GitHub monitoring,
- contacts/people,
- finance,
- medical,
- broad file/folder knowledge beyond workspace/doc-index foundations.

These are central to the target product and are the largest current gap.

### Sensitive-domain security architecture

**VERIFIED IN CODE** — current data classification is `secret | sensitive | internal | embeddable`.  
**VERIFIED IN CODE** — memory records use that same classification axis.  
**VERIFIED IN CODE** — there is no finance-specific or medical-specific trust class, vault, or policy model in the inspected contracts/runtime code.  
**Assessment**: missing.

### Domain-specific approvals and bounded autonomy

**VERIFIED IN CODE** — there is no explicit approval matrix for action types like `email_send`, `calendar_write`, `finance_read`, `medical_read`, etc.  
**Assessment**: missing.

### Durable provider-sync model

**VERIFIED IN CODE** — there are no capability-specific sync cursor/checkpoint schemas or stores for email/calendar/GitHub/todo provider data.  
**Assessment**: missing.

### Explicit context-release policy

**INFERRED** — the code has redaction and embedding policy discipline, but not yet a formal model for “what raw data may enter LLM context by domain and trust level.”  
**Assessment**: missing.

## Doc/code drift

| Doc claim | Reality | Assessment |
|---|---|---|
| `docs/phase-audit-2026-03-14.md` frames the repo as roughly “90% complete” | **VERIFIED IN CODE** the runtime substrate is mature, but the target assistant capabilities (email/calendar/todo/GitHub/people/finance/medical) are not present in code | **DOC CLAIM ONLY / overstated for target product** |
| `docs/phase-audit-2026-03-14.md` references docs like `workspace-conventions.md` and `workspace-routing.md` | **VERIFIED IN CODE** I did not find those docs in the inspected `docs/` tree | **DOC CLAIM ONLY / stale** |
| `packages/scheduler/README.md` says the package contains retry/backoff utilities | **VERIFIED IN CODE** the package also contains `TaskManager` and task/job orchestration behavior | **Doc drift** |
| `apps/macos` as a future interface | **VERIFIED IN CODE** deferred/not started, despite broader repo maturity elsewhere | **Accurately documented as deferred** |
| README/product copy references future browser/email/file capability | **VERIFIED IN CODE** those capabilities are mostly not present as product modules today | **Intent, not code truth** |

## Architecture strengths

1. **VERIFIED IN CODE** — clean product split: engine boundary, runtime core, control API, replaceable interfaces.
2. **VERIFIED IN CODE** — runtime owns durable state and orchestration, not the UI.
3. **VERIFIED IN CODE** — strong local-first posture: loopback binding, local SQLite, local receipts, local backups.
4. **VERIFIED IN CODE** — good auditability posture: receipts, interventions, security audit, CLI/admin surfaces.
5. **VERIFIED IN CODE** — explicit engine adapter and fake adapters make testing and replacement sane.
6. **VERIFIED IN CODE** — Telegram is thin, not central. That is the right pattern.
7. **VERIFIED IN CODE / INFERRED** — memory is already substantial enough to become useful once real data sources exist.

## Architecture weaknesses

1. **VERIFIED IN CODE / INFERRED** — `runtime-service.ts` is becoming a very large center of gravity. It is workable today but will become a bottleneck if every new capability is added directly into it.
2. **VERIFIED IN CODE** — approval semantics are too generic and too weak for sensitive-domain actions.
3. **VERIFIED IN CODE** — data classification is too coarse for finance/medical isolation and context-release rules.
4. **VERIFIED IN CODE** — workspace/file safety is narrower than the target product needs.
5. **VERIFIED IN CODE** — backup posture is not yet designed for encrypted restricted vaults.
6. **VERIFIED IN CODE / DOC CLAIM ONLY** — the Pi host-tool boundary still relies on a workaround path (`extension_ui_request`) when native host-tool RPC is unavailable. That is acceptable now but will be stressed by richer assistant capabilities.
7. **INFERRED** — the current architecture is still somewhat “devtool/control-plane shaped” in its implemented feature mix, even though the core split is appropriate for a personal assistant.

## Capability matrix

| Target capability | Current state | Evidence level | Notes |
|---|---|---|---|
| Always-on daemon lifecycle | **Already built** | **VERIFIED IN CODE** | Daemon app, launch/install CLI, runtime start/stop, graceful shutdown. |
| Heartbeat / scheduled work | **Partially built** | **VERIFIED IN CODE / INFERRED** | Scheduler exists; heartbeat semantics appear in docs/session model and runtime query helpers, but assistant jobs are not yet there. |
| Recoverable task execution | **Partially built** | **VERIFIED IN CODE / INFERRED** | Job leases, retries, run states, recovery docs/tests, startup reconciliation hooks. |
| Intervention / approval flows | **Partially built** | **VERIFIED IN CODE** | Interventions exist, but no action-type/domain approval policy yet. |
| Local control API | **Already built** | **VERIFIED IN CODE** | Strong `/v1/*` surface with auth/CSRF/SSE. |
| Memory with provenance and retrieval | **Already built (foundation)** | **VERIFIED IN CODE** | Provenance/source fields, search, lifecycle, audit, doc indexing hooks. |
| Audit / receipts / observability | **Already built** | **VERIFIED IN CODE** | Receipts, security audit, redaction package, CLI/admin surfaces. |
| Safe file access / explicit workspace access | **Partially built** | **VERIFIED IN CODE** | Workspace registry and narrow critical-file policy exist; full file capability does not. |
| Email read / summarize / triage | **Not built** | **VERIFIED IN CODE** | No email capability package/app module present. |
| Calendar read / summarize / propose actions | **Not built** | **VERIFIED IN CODE** | No calendar capability package/app module present. |
| Calendar create/modify with approval | **Not built** | **VERIFIED IN CODE** | No calendar domain/action model present. |
| Todo ingestion / prioritization / reconciliation | **Not built** | **VERIFIED IN CODE** | Runtime task model is not the same as personal todo domain. |
| GitHub issue/PR/repo watch | **Not built** | **VERIFIED IN CODE** | No GitHub monitoring package/app module present. |
| Reminders / digests / recurring reviews | **Partially built** | **VERIFIED IN CODE / INFERRED** | Scheduler + Telegram + memory summaries provide substrate; no real assistant digest capability exists yet. |
| File / folder knowledge and indexing | **Partially built** | **VERIFIED IN CODE** | Workspace doc indexer modules and runtime hooks exist; generalized user-facing file capability does not. |
| People / contact context | **Not built** | **VERIFIED IN CODE** | No contact/person schema or adapter package found. |
| Personal knowledge / routines / habits | **Partially built** | **VERIFIED IN CODE / INFERRED** | Memory can store it, but there is no dedicated personal-knowledge pipeline or domain model. |
| Financial data handling | **Not built** | **VERIFIED IN CODE** | No finance domain model, vault, or adapter package found. |
| Medical data handling | **Not built** | **VERIFIED IN CODE** | No medical domain model, vault, or adapter package found. |
| Local-only durable storage | **Already built (foundation)** | **VERIFIED IN CODE** | Loopback bind + local state/backup paths. |
| Explicit approval policies by action type | **Not built** | **VERIFIED IN CODE** | Missing domain/action approval matrix. |
| Domain-based permissioning | **Not built** | **VERIFIED IN CODE / INFERRED** | Workspaces exist; domain permissions do not. |
| Redaction and secret handling | **Partially built** | **VERIFIED IN CODE** | Strong logging/prompt-scan foundation, but not field/domain specific yet. |
| High-sensitivity data segregation | **Not built** | **VERIFIED IN CODE** | No vault classes for finance/medical. |
| Recoverability and backup | **Partially built** | **VERIFIED IN CODE** | Good base, but not hardened for restricted data. |
| Inspectable logs and receipts | **Already built** | **VERIFIED IN CODE** | Present. |
| Operator override | **Partially built** | **VERIFIED IN CODE** | Interventions exist; richer approvals absent. |
| Bounded autonomy | **Partially built** | **VERIFIED IN CODE / INFERRED** | Current runtime is conservative but not formally policy-driven by domain/action. |

## Explicit classification: already built / partially built / not built

### Already built
- **VERIFIED IN CODE** daemon/runtime/control-plane foundation
- **VERIFIED IN CODE** task/job/run/receipt/intervention substrate
- **VERIFIED IN CODE** local control API with auth/CSRF/SSE
- **VERIFIED IN CODE** memory/search/audit foundation
- **VERIFIED IN CODE** observability/redaction foundation
- **VERIFIED IN CODE** Telegram thin bridge
- **VERIFIED IN CODE** CLI/operator tooling
- **VERIFIED IN CODE** backup/restore foundation
- **VERIFIED IN CODE** workspace/project registry foundation

### Partially built
- **VERIFIED IN CODE / INFERRED** proactive scheduler behavior
- **VERIFIED IN CODE** approval/intervention mechanism
- **VERIFIED IN CODE** file/workspace safety
- **VERIFIED IN CODE / INFERRED** document indexing and daily-summary style memory lifecycle
- **VERIFIED IN CODE / INFERRED** bounded autonomy
- **VERIFIED IN CODE** web inspector/admin UI

### Not built
- **VERIFIED IN CODE** email assistant capability
- **VERIFIED IN CODE** calendar assistant capability
- **VERIFIED IN CODE** todo assistant capability
- **VERIFIED IN CODE** GitHub monitoring capability
- **VERIFIED IN CODE** contact/people capability
- **VERIFIED IN CODE** finance vault/domain
- **VERIFIED IN CODE** medical vault/domain
- **VERIFIED IN CODE** domain-based permissioning and trust levels
- **VERIFIED IN CODE** structured approval policy by action type/domain
- **VERIFIED IN CODE** restricted-domain encryption/vault architecture

## Current-state conclusion

**VERIFIED IN CODE** — Popeye is currently architected more like a serious local assistant runtime than a toy devtool.  
**INFERRED** — It is still “devtool-shaped” in the sense that the shipped capabilities center on runtime plumbing, Telegram, and admin/debug surfaces rather than personal-assistant domains.  
**Recommendation**: preserve the current core architecture, fix the security/policy gaps, and add runtime-owned capability modules in small read-only slices.
