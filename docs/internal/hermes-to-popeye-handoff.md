# Hermes → Popeye Handoff

**Status:** handoff summary for follow-on implementation work  
**Audience:** coding/planning agents working inside the Popeye repo  
**Purpose:** provide a single explicit reference document so follow-on prompts do not depend on chat-thread context

---

## 1. Executive summary

Popeye should **learn from Hermes at the pattern level**, not by copying Hermes architecture.

The core conclusion is:

- **keep Popeye’s current memory system**
- **add a first-class unified recall surface**
- **add first-class, operator-reviewable playbooks**
- **make learning proposal-driven, not silently self-mutating**

Hermes is useful mainly as a donor for:

- separation of **memory vs recall vs reusable procedure**
- agent ergonomics around **cross-session recall**
- a closed-loop habit of **capturing reusable procedure**
- patching stale procedure instead of letting it drift

Hermes is **not** the right architecture for Popeye’s product core.

---

## 2. What Popeye already has

Popeye already has a stronger durable-memory foundation than Hermes:

- layered memory: **artifact / fact / synthesis / curated**
- typed memory: **episodic / semantic / procedural**
- provenance and evidence links
- scope-aware retrieval
- redaction before durable writes
- operator-reviewed promotion
- explainable recall primitives (`search`, `describe`, `expand`, `explain`)

Relevant Popeye files:

- `docs/memory-model.md`
- `packages/memory/src/search-service.ts`
- `packages/memory/src/recall-planner.ts`
- `packages/memory/src/recall-explainer.ts`
- `packages/runtime-core/src/memory-facade.ts`
- `packages/runtime-core/src/runtime-tools.ts`

So the recommended direction is **not** to replace Popeye memory with Hermes-style `MEMORY.md` / `USER.md` semantics as the primary truth model.

---

## 3. What Hermes does better

Hermes has a cleaner product-level split between:

1. **compact persistent memory**
   - `MEMORY.md`
   - `USER.md`
2. **historical recall**
   - `session_search`
   - FTS5 over transcripts plus summarization
3. **reusable procedure**
   - `skill_manage`
   - create/patch procedural artifacts after successful or difficult work

Relevant Hermes files:

- `agent/prompt_builder.py`
- `tools/session_search_tool.py`
- `tools/memory_tool.py`
- `tools/skill_manager_tool.py`
- `website/docs/user-guide/features/memory.md`
- `website/docs/user-guide/features/skills.md`

The main lesson is **workflow separation**, not storage design.

---

## 4. Translation into Popeye terms

### 4.1 Memory

Keep Popeye memory as the durable truth substrate.

Do **not** collapse everything into one generic memory bucket.

### 4.2 Recall

Add a **first-class unified recall surface** over Popeye’s real runtime artifacts, including:

- runs
- receipts
- interventions
- messages / ingress
- session roots
- memory layers

Recall should be:

- scope-aware
- provenance-aware
- explainable
- aligned with Popeye nouns

This is the biggest Hermes lesson for Popeye.

### 4.3 Playbooks

Add first-class **Popeye playbooks** as reusable procedure artifacts.

Playbooks should be:

- operator-reviewable
- versioned
- scoped
- auditable
- safe to activate / retire
- optionally indexed into procedural memory with provenance

Playbooks are **not** a plugin marketplace and **not** a direct clone of Hermes skills.

### 4.4 Learning loop

Make learning **proposal-driven**, not hidden self-mutation.

Runs should be able to produce:

- memory promotion proposals
- playbook draft proposals
- playbook patch proposals

Protected or active procedure should not be silently rewritten.

Everything should remain receipted and inspectable.

---

## 5. Recommended implementation priorities

If the full scope cannot be done at once, prioritize in this order:

1. **Unified recall substrate**
2. **Playbook schema + resolution integration**
3. **Proposal-driven learning loop**

More explicit sequencing:

1. inspect current recall entrypoints and gaps
2. introduce or consolidate a Popeye-native recall service
3. add playbook data model and storage
4. integrate playbooks into instruction resolution and snapshots
5. record playbook usage in receipts
6. add proposal surfaces for drafts/patches

---

## 6. Architectural guardrails

These are mandatory.

### Keep in Popeye

- recall service
- playbooks
- playbook versioning and approval
- memory policy
- receipts
- interventions
- operator approval workflows
- scheduling semantics
- session policy
- security / redaction / audit

### Keep out of Pi

Do **not** move the following into Pi:

- recall policy
- playbook semantics
- playbook approval/versioning
- product-level learning loop behavior
- runtime memory policy
- operator-facing audit behavior

### Do not introduce

- plugin marketplace behavior
- uncontrolled mutable skills ecosystem
- donor naming as canonical Popeye public API
- UI/runtime boundary violations
- hidden self-editing of active procedures

---

## 7. Expected end state

The desired Popeye model is:

- **memory** = durable structured truth
- **recall** = historical retrieval over real runtime artifacts
- **playbooks** = reusable reviewed procedure
- **learning** = proposal-driven and auditable

This is the intended adaptation of Hermes’s strongest ideas into Popeye’s local-first, runtime-centered architecture.

---

## 8. Reference docs inside Popeye

Read these alongside this handoff:

- `agents.md`
- `README.md`
- `architecture.md`
- `docs/current-state-matrix.md`
- `docs/memory-model.md`
- `docs/instruction-resolution.md`
- `docs/receipt-schema.md`
- `docs/internal/hermes_popeye.md`
- `docs/internal/hermes_popeye_implementation_plan.md`
- `docs/internal/ultimate_implementation_plan.md`
- `docs/internal/hindsight_popeye_memory.md`

---

## 9. Short implementation directive

Implement the Hermes-inspired improvements in Popeye by:

1. preserving Popeye’s existing memory system,
2. building a unified recall surface,
3. introducing operator-reviewable playbooks,
4. making learning proposal-driven rather than silently self-mutating.

If a tradeoff is unclear, prefer:

- Popeye contracts over donor convenience
- explicit auditability over autonomous mutation
- narrow owned abstractions over broad imported ecosystems
