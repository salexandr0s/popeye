# Popeye roadmap

Date: 2026-03-16

> Historical note: this roadmap predates the current repo-truth snapshot.
> Use `docs/current-state-matrix.md` for what already exists and
> `docs/fully-polished-release-gate.md` for the current acceptance bar.

# Evidence legend

- **VERIFIED IN CODE** — I directly inspected the repository tree and/or file contents and confirmed the statement in code.
- **DOC CLAIM ONLY** — the statement appears in repo documentation, but I did not find it confirmed in code during this audit.
- **INFERRED** — the statement is a reasoned conclusion from inspected structure, tests, docs, or adjacent code, but not line-verified end-to-end.
- **PROPOSED** — this is my recommended future design or implementation step.


## Executive judgment

**VERIFIED IN CODE** — Popeye already has a serious local runtime foundation: daemon lifecycle, control API, runtime orchestration, scheduler/task/job/run/receipt/intervention models, memory/search substrate, observability/redaction, workspace registry, Telegram thin bridge, and operator tooling.

**VERIFIED IN CODE** — Popeye does **not** yet have the fully polished domain product set required for the target always-on personal assistant. Capability packages exist for files, email, calendar, todos, and GitHub, but People, finance, and medical remain missing as first-class products and the existing general-domain packages remain short of the polished bar.

**INFERRED** — The architecture is good enough to evolve into the target product **without a rewrite**, but only if the next work tightens:
- approval/policy architecture,
- secret/token storage,
- vault separation,
- context-release rules,
- runtime modularization,
- capability-local sync stores.

## Direct answers to the 10 explicit questions

### 1. Is Popeye currently architected like a strong foundation for a personal assistant, or is it still too devtool-shaped?

**Answer**: **INFERRED** — it is a strong foundation, but the implemented feature mix is still somewhat devtool/control-plane shaped.

Why:
- **VERIFIED IN CODE** the foundation is much stronger than a toy: daemon, control API, memory, receipts, scheduler, interventions, recovery, backup, and security audit all exist.
- **VERIFIED IN CODE** the missing pieces are exactly the assistant-domain capabilities.
- **INFERRED** that means Popeye is best understood as a credible assistant runtime that has not yet crossed into assistant-product completeness.

### 2. Which current subsystems are reusable as-is?

**Answer**:
- **VERIFIED IN CODE** `packages/engine-pi` as the engine boundary
- **VERIFIED IN CODE** `packages/control-api` as the UI/client boundary
- **VERIFIED IN CODE** `packages/contracts`
- **VERIFIED IN CODE** `packages/receipts`
- **VERIFIED IN CODE** `packages/observability`
- **VERIFIED IN CODE** large parts of `packages/sessions`
- **VERIFIED IN CODE** large parts of `packages/telegram`
- **VERIFIED IN CODE** daemon bootstrap and CLI operator surfaces
- **VERIFIED IN CODE / INFERRED** much of `packages/memory` for general personal memory

### 3. Which current subsystems need extension?

**Answer**:
- **VERIFIED IN CODE / PROPOSED** `packages/runtime-core` — approvals, secret store, capability registry, vault manager, context release
- **VERIFIED IN CODE / PROPOSED** `packages/contracts` — domain/trust/action/capability schemas
- **VERIFIED IN CODE / PROPOSED** `packages/memory` — domain-aware trust and restricted-memory behavior
- **VERIFIED IN CODE / PROPOSED** `packages/workspace` — explicit file-root permissions
- **VERIFIED IN CODE / PROPOSED** `packages/control-api` — capability endpoints and approval surfaces
- **VERIFIED IN CODE / PROPOSED** `packages/observability` — finance/medical-specific redaction rules
- **VERIFIED IN CODE / PROPOSED** `packages/scheduler` — action-aware job policy, not just generic read-only task creation

### 4. Which subsystems need refactoring before more integrations are added?

**Answer**:
- **VERIFIED IN CODE / PROPOSED** `packages/runtime-core/src/runtime-service.ts` — reduce centralization
- **VERIFIED IN CODE / PROPOSED** approval/intervention model — make it action/domain aware
- **VERIFIED IN CODE / PROPOSED** data classification model — split domain/sensitivity/context-release concerns
- **VERIFIED IN CODE / PROPOSED** backup model — add restricted vault support
- **VERIFIED IN CODE / PROPOSED** workspace/file permission model — current policy is too narrow
- **VERIFIED IN CODE / PROPOSED** engine runtime-tool boundary — harden before capability tool surface expands

### 5. Where should email/calendar/GitHub/todo live in the architecture?

**Answer**: **PROPOSED** — as runtime-owned capability modules in new packages, with thin provider adapters behind them.

Not in:
- UI
- Telegram bridge
- engine-pi
- direct provider calls from Pi
- generic plugin marketplace

Recommended packages:
- `packages/cap-email`
- `packages/cap-calendar`
- `packages/cap-todos`
- `packages/cap-github`

### 6. How should highly sensitive domains like financial and medical data be modeled and isolated?

**Answer**: **PROPOSED** —
- separate vault-oriented packages/stores,
- encrypted at-rest restricted vault DBs,
- domain-specific trust and context-release policies,
- read-only first,
- no raw embeddings,
- no automatic raw model context,
- explicit approval for full-content release,
- receipts for every release/import/export/access decision.

Recommended stores:
- `vaults/finance.db`
- `vaults/medical.db`

### 7. What should be the first truly useful personal-assistant vertical slice from the current repo?

**Answer**: **PROPOSED** — read-only email sync + digest + triage.

Why:
- highest immediate value,
- read-only is safe,
- exercises sync, receipts, memory derivation, people seeds, digests, and policy boundaries,
- does not require sending or destructive actions.

### 8. What should the second and third slices be?

**Answer**:
- **PROPOSED** second: calendar read/summarize/propose writes with approval
- **PROPOSED** third: canonical local todo model + reconciliation

GitHub watch should come immediately after those, not before the safety/personal-assistant core is established.

### 9. What should absolutely not be built yet?

**Answer**:
- **PROPOSED** plugin marketplace
- **PROPOSED** multi-tenant/cloud architecture
- **PROPOSED** remote/mobile auth stack
- **PROPOSED** autonomous email sending
- **PROPOSED** autonomous calendar writes
- **PROPOSED** GitHub write actions
- **PROPOSED** finance write flows
- **PROPOSED** medical write flows
- **PROPOSED** whole-machine indexing
- **PROPOSED** provider-generic abstraction layers before second providers exist

### 10. What are the biggest risks to turning Popeye into an always-on assistant that “knows everything about me” without becoming unsafe, brittle, or unmaintainable?

**Answer**:
1. **VERIFIED IN CODE / PROPOSED** insufficient sensitive-data architecture
2. **VERIFIED IN CODE / PROPOSED** lack of formal context-release rules
3. **VERIFIED IN CODE / PROPOSED** weak approval semantics for side effects
4. **VERIFIED IN CODE / PROPOSED** runtime-core turning into a monolith
5. **VERIFIED IN CODE / PROPOSED** integration sprawl without capability boundaries
6. **VERIFIED IN CODE / PROPOSED** unencrypted restricted backups
7. **INFERRED** memory pollution from uncurated/raw ingestion
8. **VERIFIED IN CODE / PROPOSED** doc drift causing bad architectural decisions
9. **VERIFIED IN CODE / PROPOSED** provider tokens/secrets being handled casually
10. **VERIFIED IN CODE / PROPOSED** expanding model context without domain trust filters

## Condensed roadmap

### Phase order

1. **Phase 0** — doc correction and guardrails  
2. **Phase 1** — approval/policy/secret-store/vault substrate  
3. **Phase 2** — file roots + personal knowledge substrate + runtime modularization  
4. **Phase 3** — email read-only digest/triage  
5. **Phase 4** — calendar read/propose/write-with-approval  
6. **Phase 5** — canonical todo model and reconciliation  
7. **Phase 6** — GitHub monitoring  
8. **Phase 7** — cross-capability digests/reminders/reviews  
9. **Phase 8** — finance read-only restricted vault  
10. **Phase 9** — medical read-only restricted vault  
11. **Phase 10** — optional interface polish/macOS later  

## Key file/package changes to expect

### Existing files/packages to extend
- `packages/contracts/src/config.ts`
- `packages/contracts/src/execution.ts`
- `packages/contracts/src/memory.ts`
- `packages/contracts/src/api.ts`
- `packages/runtime-core/src/runtime-service.ts`
- `packages/runtime-core/src/auth.ts`
- `packages/runtime-core/src/keychain.ts`
- `packages/runtime-core/src/backup.ts`
- `packages/control-api/src/index.ts`
- `packages/workspace/src/policy.ts`
- `packages/memory/src/*`
- `packages/observability/src/*`
- `apps/web-inspector/src/views/*`
- `apps/cli/src/index.ts`
- `config/example.json`

### New packages/modules to add
- `packages/cap-files`
- `packages/cap-email`
- `packages/cap-calendar`
- `packages/cap-todos`
- `packages/cap-github`
- `packages/cap-people`
- later `packages/vault-finance`
- later `packages/vault-medical`
- internal runtime-core modules:
  - `approval-service.ts`
  - `secret-store.ts`
  - `vault-manager.ts`
  - `context-release-service.ts`
  - `capability-registry.ts`
  - `sync-orchestrator.ts`

## Safe default posture

### General domains
- **PROPOSED** local-only durable storage
- **PROPOSED** provider tokens in secret store, not DB rows
- **PROPOSED** read-only first
- **PROPOSED** receipts for every sync and action
- **PROPOSED** redacted notifications by surface

### Finance and medical
- **PROPOSED** encrypted vaults
- **PROPOSED** no raw embeddings
- **PROPOSED** no automatic raw model context
- **PROPOSED** read-only only
- **PROPOSED** explicit approval for full-content release
- **PROPOSED** separate backup and restore posture
- **PROPOSED** domain-specific deletion and retention rules

## Final recommendation

**VERIFIED IN CODE** — do not rebuild Popeye from scratch.  
**PROPOSED** — treat the existing runtime as the permanent product core, correct the weak spots, and then ship assistant domains as tightly bounded capability packages.

## Supporting documents

This roadmap is supported by four split documents created alongside it:

- `docs/personal-assistant-current-state-audit.md`
- `docs/personal-assistant-gap-analysis.md`
- `docs/personal-assistant-implementation-plan.md`
- `docs/personal-assistant-fix-plan.md`
