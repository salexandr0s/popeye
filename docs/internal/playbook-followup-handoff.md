# Playbook Follow-up Handoff

**Status:** follow-on implementation handoff after the unified recall slice  
**Audience:** next coding/planning agent working in the current Popeye checkout  
**Purpose:** provide one exact source-of-truth doc for the next implementation step so the next prompt does not depend on thread context

---

## 1. Current branch state

The previous pass implemented the **unified recall substrate** described in:

- `docs/internal/hermes-to-popeye-handoff.md`

That work is already present in the current working tree and was verified with:

- `pnpm typecheck`
- targeted Vitest runs for runtime/core, control API, and API client
- `pnpm dev-verify`

### Important

Treat the current unified-recall work as the new baseline.

Do **not** revert or redesign it unless a follow-on playbook change strictly
requires a small corrective fix. In particular:

- durable memory remains the truth substrate
- unified recall is additive
- recall API routes are intentionally **operator-only**
- agent recall goes through the scoped `popeye_recall_search` tool

There is also an unrelated untracked file in the repo:

- `internal/release-readiness.md`

Leave it alone.

---

## 2. What is done already

The current branch already added:

- recall contracts in `@popeye/contracts`
- runtime `RecallService`
- app-db FTS support for:
  - receipts
  - messages
  - message ingress
  - interventions
  - existing run events
- control API routes:
  - `GET /v1/recall/search`
  - `GET /v1/recall/:kind/:id`
- typed API client support for recall
- runtime tool:
  - `popeye_recall_search`
- docs separating **memory** vs **recall**

That work should be considered complete for this tranche.

---

## 3. Exact next task

Implement the **smallest correct playbook slice**.

This is the next priority after recall from:

- `docs/internal/hermes-to-popeye-handoff.md`

### Scope for this pass

Build only enough to make playbooks a real Popeye concept with:

1. **owned schema**
2. **operator-controlled storage**
3. **instruction-resolution integration**
4. **receipt visibility**

### Explicitly in scope

#### 3.1 New playbook package

Create:

- `packages/playbooks`

It should own:

- playbook front-matter schema
- markdown parsing/loading
- canonical content hashing
- scope filtering

#### 3.2 Canonical playbook storage

Use **file-backed canonical playbooks** plus app-db metadata.

Use these locations:

- global: runtime data dir under `playbooks/`
- workspace: `<workspaceRoot>/.popeye/playbooks/`
- project: `<projectPath>/.popeye/playbooks/`

Do **not** invent a marketplace, package registry, or remote distribution layer.

#### 3.3 Minimal app-db metadata

Add only the minimum tables needed for a correct first slice:

- `playbooks`
- `playbook_revisions`
- `playbook_usage`

You may add `playbook_bindings` only if it is genuinely required for a clean
implementation, but avoid proposal/review tables in this pass.

#### 3.4 Instruction resolution integration

Playbooks must become a first-class instruction source.

Add an instruction source type:

- `playbook`

Required precedence model for this pass:

1. `pi_base`
2. `popeye_base`
3. `global_operator`
4. `workspace`
5. `project`
6. `playbook`
7. `identity`
8. `task_brief`
9. `trigger_overlay`
10. `runtime_notes`

Meaning:

- playbooks are reusable procedure
- identity/task/trigger/runtime notes can still override them

#### 3.5 Playbook selection rules

For this first slice, keep selection deterministic and boring.

Select playbooks by:

- location compatibility:
  - global
  - workspace
  - project
- active status
- optional allowed profile IDs from front matter

Do **not** add semantic ranking, fuzzy trigger matching, or model-based selection.

#### 3.6 Receipt visibility

Every run that compiled playbooks must leave auditable evidence.

Add additive receipt visibility so an operator can answer:

- which playbooks affected this run?

Smallest acceptable implementation:

- extend receipt runtime summary with a playbook usage list, or
- add receipt timeline entries with playbook IDs and revision hashes

Preferred implementation:

- additive `runtime.playbooks` summary with playbook id, title, scope, and
  revision hash

Also persist normalized usage rows in `playbook_usage`.

---

## 4. Explicit non-goals for this pass

Do **not** implement any of the following yet:

- proposal-driven playbook drafting
- playbook patch proposals
- activation approval workflow beyond operator-owned status/metadata
- UI pages
- CLI commands
- procedural-memory indexing of playbooks
- agent mutation of active playbooks
- marketplace/package/plugin behavior

If you have time left after the scoped playbook slice, stop and document follow-ups.

---

## 5. Required classification

State explicitly before coding:

- **Layer:** runtime + contracts + instructions
- **Provenance:** new platform implementation
- **Scope:** feature
- **Security impact:** moderate; playbooks affect resolved instructions and must remain operator-controlled
- **Memory impact:** additive only; playbooks are reusable procedure, not a replacement for durable memory

---

## 6. Files the next agent must inspect first

### Contracts / architecture

- `agents.md`
- `docs/internal/hermes-to-popeye-handoff.md`
- `README.md`
- `architecture.md`
- `docs/current-state-matrix.md`
- `docs/instruction-resolution.md`
- `docs/receipt-schema.md`

### Current implementation touched by the recall pass

- `packages/runtime-core/src/runtime-service.ts`
- `packages/runtime-core/src/runtime-tools.ts`
- `packages/runtime-core/src/run-executor.ts`
- `packages/runtime-core/src/database.ts`
- `packages/control-api/src/index.ts`
- `packages/contracts/src/instructions.ts`
- `packages/contracts/src/receipts.ts`
- `packages/instructions/src/resolver.ts`
- `packages/runtime-core/src/receipt-builder.ts`

### Donor/planning references

- `docs/internal/hermes_popeye.md`
- `docs/internal/hermes_popeye_implementation_plan.md`

Read only the sections relevant to playbooks/procedure.

---

## 7. Recommended implementation plan

Follow this order:

1. add playbook contracts and `packages/playbooks`
2. add app-db migration(s) for playbook metadata
3. add loader/resolver hooks for global/workspace/project playbooks
4. integrate `playbook` into instruction resolution
5. persist auditable playbook usage for runs
6. expose additive read-only playbook data only if strictly needed for tests
7. update docs
8. run verification

Keep the change as small as possible.

---

## 8. Invariants to preserve

These are non-negotiable:

- do not weaken approvals, receipts, redaction, or operator control
- do not move playbook semantics into Pi
- do not bypass the control API boundary from interfaces
- do not silently mutate protected procedure
- do not let donor naming become Popeye public architecture
- do not turn playbooks into skills/plugins/extensions
- keep durable memory separate from playbooks
- keep unified recall working as implemented

---

## 9. Tests required

At minimum add/update:

### Unit

- playbook front-matter parsing / validation
- deterministic playbook selection by scope/profile
- instruction precedence including `playbook`

### Golden

- updated instruction precedence golden tests
- receipt output/golden coverage if receipt schema changes

### Integration

- runtime instruction bundle includes active playbooks
- receipt for a completed run records playbook usage
- migration idempotency for new playbook tables

### Verification

Run:

- targeted Vitest for changed packages
- `pnpm typecheck`
- `pnpm dev-verify`

Note: `pnpm audit --audit-level=high` currently reports existing moderate
vulnerabilities but still exits successfully under the current repo gate. Do not
treat that output alone as a regression unless severity changes or the command
fails.

---

## 10. Docs required

Update at least:

- `docs/instruction-resolution.md`
- `docs/receipt-schema.md`
- `docs/current-state-matrix.md`
- `architecture.md` if the playbook layer becomes architecture-visible
- package README for `packages/playbooks`

---

## 11. Deliverable definition

The next agent is done when all of the following are true:

- playbooks are a real owned Popeye concept
- playbooks can be loaded from operator-controlled locations
- active playbooks are compiled into instruction bundles deterministically
- the exact playbooks affecting a run are visible in receipts
- tests pass
- docs are updated

Proposal-driven learning remains intentionally deferred after this pass.

---

## 12. Final report format for the next agent

End with:

- **Intent**
- **Layer**
- **Provenance**
- **Files changed**
- **Tests run**
- **Docs updated**
- **Risks / follow-ups**

