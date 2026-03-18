
# Hindsight → Popeye Memory Analysis

_Method note:_ this is a repo-first, architecture-first review focused only on memory. Hindsight is treated as a memory-system reference, not as a whole-product template. Evidence labels used throughout:

- **[Confirmed in code]** — directly supported by implementation files reviewed.
- **[Docs/plans]** — stated in repo docs/plans but not fully confirmed in implementation.
- **[Inference]** — a reasoned conclusion from repo structure and code shape, but not explicitly guaranteed.

---

## 1. Executive summary

Hindsight contains **genuinely valuable memory architecture ideas for Popeye**, but **the value is mostly in the memory model and pipeline discipline, not in Hindsight’s exact storage stack or product shape**.

The highest-leverage lesson from Hindsight is this:

> Popeye’s next memory milestone is **not** “add more retrieval.” It is to **improve what gets stored**, by separating raw artifacts from extracted facts, synthesized memories, and operator-curated memory.

Popeye already has a real memory subsystem. It is not greenfield. Today it already includes SQLite-backed memory records, FTS5 search, optional sqlite-vec search, confidence decay, consolidation, daily summaries, compaction summaries, provenance hooks, entity mentions, audit APIs, integrity checks, and runtime tools. That is a strong local-first base. The main weakness is that the current system still stores memory mostly as **coarse records** rather than **well-normalized atomic facts with explicit evidence and temporal meaning**. [Confirmed in code: `packages/memory/src/search-service.ts`, `packages/runtime-core/src/memory-lifecycle.ts`, `packages/runtime-core/src/runtime-service.ts`, `packages/runtime-core/src/database.ts`]

Hindsight is stronger exactly where Popeye is still thin:

- ingestion and normalization of memory from source artifacts
- separation between raw facts, consolidated observations, and curated higher-order memory
- temporal extraction and temporal retrieval
- namespace/tag isolation
- evidence chains for synthesized knowledge
- evaluation of memory quality as a first-class engineering concern

The biggest opportunities for Popeye are therefore:

1. **Add an explicit artifact → fact → synthesis → curated pipeline.**
2. **Add event-time / valid-time fields and temporal recall.**
3. **Strengthen provenance so every synthesized memory is traceable to concrete facts and source artifacts.**
4. **Replace the current flat `scope` model with structured namespaces plus tags.**
5. **Introduce a Popeye-native evaluation harness for memory quality, not just unit tests.**

The biggest mismatches and risks are:

- Hindsight is built around a **PostgreSQL + pgvector + graph + async job** architecture; Popeye should stay **SQLite/markdown/local-first**.
- Hindsight includes **multi-tenant, bank-profile, directives, and disposition** concepts that are much heavier than Popeye currently needs.
- Hindsight’s retrieval stack can become benchmark-friendly but operationally heavy if copied wholesale.
- Some Hindsight type semantics are still evolving (`world` / `experience` / `opinion`, plus `observations` and `mental models`), so Popeye should copy the **layering idea**, not the exact taxonomy. [Confirmed in code: `hindsight_api/engine/memory_engine.py`, `hindsight_api/engine/retain/fact_extraction.py`, `hindsight_api/engine/consolidation/consolidator.py`, `hindsight_api/engine/reflect/reflect_agent.py`]

**Overall recommendation:**  
Adopt Hindsight’s **retention pipeline, layered memory model, temporal handling, evidence discipline, and evaluation mindset**. Do **not** adopt Hindsight’s full stack, full graph system, or product-level reflection/disposition machinery. Keep long-term memory ownership in **Popeye**, ask **pi-mono** only for better session/context hooks, and evolve Popeye incrementally rather than rewriting its current memory subsystem.

---

## 2. Popeye memory current state

### 2.1 What Popeye currently has

### A. Durable storage and schema

Popeye already has a real memory schema in SQLite. [Confirmed in code]

Current durable tables and indexes include:

- `memories`
- `memory_events`
- `memory_sources`
- `memory_consolidations`
- `memories_fts`
- `memory_entities`
- `memory_entity_mentions`
- `memory_summaries`
- `memory_summary_sources`

This is not a placeholder design. It is implemented in runtime migrations and used by the memory services. The schema also includes fields for memory type, dedup keys, reinforcement timestamps, archive timestamps, source run IDs, source timestamps, and a `durable` flag. [Confirmed in code: `packages/runtime-core/src/database.ts`, especially the migrations that create/alter `memories`, `memories_fts`, `memory_entities`, `memory_summaries`, and the integrity checks in `packages/memory/src/integrity-checker.ts`]

Important nuance: older schema elements such as `memory_embeddings` and `retrieval_cache` are created in early migrations and later dropped, which shows the memory model is already evolving, not frozen. [Confirmed in code: `packages/runtime-core/src/database.ts`]

### B. Memory representation

Popeye’s persisted `MemoryRecord` model already includes:

- description
- classification
- source type
- content
- confidence
- scope
- source run ID / source timestamp
- memory type (`episodic`, `semantic`, `procedural`)
- dedup key
- reinforcement/archive timestamps
- created timestamp
- durable flag

Query strategy is also explicit (`factual`, `temporal`, `procedural`, `exploratory`) and search results expose score breakdowns including relevance, recency, confidence, scope match, and entity boost. [Confirmed in code: `packages/contracts/src/memory.ts`]

This is already better than many “memory” systems that are just a vector store with strings.

### C. Retrieval

Popeye already implements a local hybrid retrieval path. [Confirmed in code]

Current retrieval features:

- FTS5 full-text search
- optional sqlite-vec semantic search
- parallel candidate gathering
- deterministic reranking/merge
- query strategy classification
- recency/confidence/scope weighting
- light entity boosting
- token-budget fitting and expansion
- memory description and content expansion tools

Search is intentionally local and self-contained. It does not require an external vector DB or external retrieval service. [Confirmed in code: `packages/memory/src/fts5-search.ts`, `packages/memory/src/vec-search.ts`, `packages/memory/src/scoring.ts`, `packages/memory/src/strategy.ts`, `packages/memory/src/budget-allocation.ts`, `packages/memory/src/search-service.ts`]

One implementation nuance: the vector search path clearly expects a `memory_vec` table and sqlite-vec support, but the exact creation/bootstrap path for that table was not visible in the runtime migrations I reviewed. So vector retrieval is **confirmed**, while the precise table bootstrap path is only **partially confirmed / inferred** from the reviewed files.

### D. Ingestion and lifecycle

Popeye already ingests memory from several runtime flows. [Confirmed in code]

Implemented memory feeds include:

- **receipts** — receipt summaries/details are captured as episodic memories
- **compaction flushes** — Pi compaction output can be summarized into a summary DAG and stored as memories
- **daily summaries** — generated into `memory/daily/YYYY-MM-DD.md` and also stored as memories
- **workspace docs** — markdown files are indexed into memory
- **manual / curated inserts** — runtime methods exist for manual memory insertion and curated memory insertion

Popeye also has periodic maintenance jobs:

- confidence decay
- archiving when confidence falls too low
- exact dedup via `dedup_key`
- text-overlap consolidation
- low-quality sweep
- workspace doc reindexing
- daily summary generation
- integrity checking / audit

[Confirmed in code: `packages/runtime-core/src/receipt-manager.ts`, `packages/runtime-core/src/memory-lifecycle.ts`, `packages/runtime-core/src/runtime-service.ts`, `packages/memory/src/compaction-engine.ts`, `packages/memory/src/summary-dag.ts`]

### E. Operator surfaces

Popeye already exposes memory at runtime, though not yet with rich inspection UX. [Confirmed in code]

Currently visible surfaces include:

- runtime tools:
  - `popeye_memory_search`
  - `popeye_memory_describe`
  - `popeye_memory_expand`
- memory audit method
- integrity check method
- promotion proposal and execution methods
- daily markdown summaries in the workspace memory directory

[Confirmed in code: `packages/runtime-core/src/runtime-service.ts`, `packages/runtime-core/src/memory-lifecycle.ts`]

### 2.2 What Popeye explicitly wants memory to become

From the repo docs, Popeye’s locked architecture and build plan clearly intend memory to be:

- durable
- inspectable
- local-first
- SQLite-native
- backed by human-readable markdown plus machine-queryable storage
- auditable and provenance-aware
- confidence-aware
- subject to decay/consolidation
- operator-controlled, especially for curated memory
- integrated into the product runtime rather than buried in the engine layer

[Docs/plans: `architecture.md`, `buildplan.md`, “Memory and Knowledge” decisions in `open_questions.md`]

More specifically, the documented target includes:

- layered memory handling with SQLite-backed semantic/episodic/procedural memory
- daily summaries as automatic memory
- curated memory only by explicit promotion
- memory search/audit CLI surfaces
- compaction flush interception
- provenance tracking linking memory back to source runs/receipts
- markdown as human-readable layer, SQLite as machine-queryable layer

[Docs/plans: `architecture.md`, `buildplan.md`, `open_questions.md`]

From your prompt, the intended product direction goes even further:

- searchable long-term personal memory
- daily notes / capture
- promotion from raw memory into curated memory
- provenance and auditability
- confidence / uncertainty handling
- decay / aging
- consolidation / summarization
- safe recall for agent work
- operator visibility/control
- privacy-aware storage for highly sensitive personal data

That target is consistent with the repo direction. The current gap is mostly **semantic depth**, not lack of a persistence substrate.

### 2.3 Current strengths

Popeye’s current memory implementation is already strong in ways that matter for your product goals:

1. **Local-first fit is real, not aspirational.**  
   SQLite + markdown + redaction + explicit promotion already align with ownership, inspectability, and privacy.

2. **Memory is owned by the runtime, not the engine.**  
   This is the correct long-term architecture for a personal agent product.

3. **There is already meaningful lifecycle logic.**  
   Decay, consolidation, daily summaries, compaction summaries, and indexing are implemented.

4. **Retrieval already respects practical agent constraints.**  
   Query strategy classification, reranking, entity boost, and token-budget fitting are already there.

5. **There is an auditability foundation.**  
   Source links, events, summary DAGs, and integrity checks mean Popeye can evolve into a trustworthy memory system without starting over.

### 2.4 Current weaknesses / gaps

The current weaknesses are not “no memory.” They are mainly about **what level of abstraction is stored and recalled**.

#### Gap 1: coarse memory capture

Receipt details, workspace docs, and compaction outputs are stored as memories, but there is no strong intermediate layer of **atomic extracted facts**. Popeye often stores a whole artifact-like blob as a memory record. [Confirmed in code]

Related nuance: `MemorySourceType` already includes sources such as `telegram`, but in the runtime/message-ingestion code I reviewed, I did not find an equally mature fact-extraction path for message traffic. That suggests the source taxonomy is ahead of the actual semantic ingestion depth. [Confirmed in contracts; partially confirmed in runtime flows]

#### Gap 2: limited normalization

Popeye classifies memory type heuristically and extracts entities with regexes, but it does not yet normalize messages, actions, tool outputs, or documents into typed fact records with strong temporal and relational structure. [Confirmed in code: `packages/memory/src/pure-functions.ts`, `packages/memory/src/entity-extraction.ts`]

#### Gap 3: partial provenance, not full evidence chains

Popeye does track source references, source run IDs, and consolidations, but it does not yet have a first-class evidence model where a synthesized claim explicitly cites supporting fact IDs. [Confirmed in code]

#### Gap 4: temporal reasoning is shallow

Popeye has `sourceTimestamp`, `createdAt`, and recency scoring, but not a serious event-time model or query-time temporal parsing. Today “temporal” mostly means “weigh recent things more heavily,” not “understand when the underlying fact occurred.” [Confirmed in code: `packages/memory/src/strategy.ts`, `packages/memory/src/scoring.ts`]

#### Gap 5: contradiction / revision is missing

Popeye can dedup and archive, but it does not yet model “this old fact was superseded,” “these two claims conflict,” or “this fact is now invalid after a later update.” [Confirmed in code]

#### Gap 6: namespaces and isolation are too simple

`scope` is a useful start, but a personal always-on agent will need stronger boundaries between private profile memory, workspace/repo memory, communication memory, and future integrations like email and calendar. [Confirmed in code; inferred from product intent]

#### Gap 7: operator tooling is still thin

There is no rich memory explorer yet for evidence chain inspection, retrieval explanations, conflict review, or promotion review. [Confirmed in code for existing methods; Docs/plans for future inspector]

### 2.5 Docs/plans vs implementation: important distinctions

The repo contains at least one notable memory-design mismatch:

- `open_questions.md` describes “two-stage retrieval (fast index search then LLM reranking).”
- the current memory package actually implements **deterministic scoring/reranking**, not LLM reranking in the hot path.

That means the current code is already simpler and more local-friendly than the earlier design note. The code should be treated as the source of truth here. [Docs/plans vs confirmed in code: `open_questions.md` vs `packages/memory/src/search-service.ts`, `packages/memory/README.md`]

Other items that are present in docs/plans but not fully confirmed end-to-end in the code reviewed:

- richer CLI memory commands such as `pop memory search` / `pop memory audit`
- a local web inspector with memory views
- an explicit `MEMORY.md`-style curated file convention as a fully wired product surface
- “working memory” as a first-class in-memory type beyond general runtime/session context

### 2.6 Role of pi-mono in the memory story

This boundary matters a lot.

#### What belongs in pi-mono (runtime/foundation)

pi-mono should own engine/foundation concerns:

- model/provider abstraction
- tool execution plumbing
- agent loop mechanics
- session history
- branching / session tree
- compaction mechanics
- context-file loading
- session lifecycle APIs
- hook points for pre-request or pre-turn context injection

This is consistent with Popeye’s architecture docs and pi-mono’s SDK/session model. [Docs/plans for Popeye: `architecture.md`; pi-mono docs/issues: `packages/coding-agent/docs/sdk.md`, issue `#324`]

#### What belongs in Popeye (product/application layer)

Popeye should own long-term memory semantics:

- what counts as a memory-worthy artifact
- how artifacts are normalized into facts
- what is stored durably
- how sensitive data is classified/redacted
- what gets embedded
- confidence / decay / reinforcement policies
- consolidation / synthesis policies
- provenance and revision chains
- recall ranking policy
- what memory gets injected or exposed to the agent
- operator promotion / curation rules

This matches the repo’s explicit “Pi = engine, runtime/Popeye = product” boundary. [Docs/plans: `architecture.md`]

#### What belongs in operator-facing tooling / inspection surfaces

Operator-facing surfaces should live in Popeye, not pi-mono:

- memory explorer
- evidence chain inspector
- retrieval explanation UI/API
- promotion review/diff
- contradiction review
- staleness/decay audit
- namespace/tag visibility controls

#### Practical consequence

pi-mono should **not** become the home of Popeye’s long-term memory model.

The most useful pi-mono improvement for Popeye would be a better dynamic context hook (for example, a per-request hook rather than only session-creation-time context). That would let Popeye inject fresh memory into long-lived sessions without forcing memory to live inside pi-mono. The relevant pi-mono issue explicitly calls out “dynamic memory systems” and “per-request context injection” as missing today. [pi-mono issue `#324`; Docs/plans + inference]

---

## 3. Hindsight memory architecture summary

### 3.1 What Hindsight is, technically

Hindsight is best understood as a memory engine organized around three operations:

- **retain** — ingest and normalize information into memory
- **recall** — retrieve relevant memory with a multi-strategy search pipeline
- **reflect** — produce higher-order reasoning/synthesis using prioritized memory layers

That separation is not marketing fluff; it is reflected directly in the code organization and runtime API. [Confirmed in code: `hindsight_api/engine/memory_engine.py`, `hindsight_api/engine/retain/`, `hindsight_api/engine/search/`, `hindsight_api/engine/reflect/`]

The core namespace abstraction is a **memory bank**. Banks isolate memory and can also hold higher-order configuration and curated state. Hindsight then layers different kinds of memory on top of that bank:

- raw facts / memories
- observations (auto-consolidated higher-order knowledge)
- mental models (user-curated living documents for common queries)
- directives (hard rules used during reflect)
- bank profile / mission / disposition

This layering is one of Hindsight’s biggest architectural strengths, even though some exact type names are Hindsight-specific. [Confirmed in code and docs: `memory_engine.py`, `consolidator.py`, `reflect_agent.py`, API docs for mental models/directives]

### 3.2 Ingestion model (retain)

Hindsight’s retain pipeline is considerably more structured than Popeye’s current ingestion path.

At a high level, the pipeline looks like this:

1. accept content items for a bank
2. merge item tags with document tags
3. chunk large inputs
4. extract structured facts with an LLM
5. generate embeddings
6. track documents and chunks
7. insert normalized facts
8. process entities / resolution
9. create temporal links
10. create semantic links
11. create entity links
12. create causal links
13. trigger consolidation asynchronously

That is not inferred — the orchestrator code literally performs those stages. [Confirmed in code: `hindsight_api/engine/retain/orchestrator.py`]

Important implementation details:

- Retain supports batch ingestion and auto-chunking by token count.
- Facts can carry metadata, tags, entities, occurred times, and causal relations.
- Documents and chunks are tracked as first-class source artifacts.
- There is explicit support for per-fact document IDs, chunk IDs, and tag inheritance.
- Entity processing and link creation happen as part of the same ingestion pipeline.

[Confirmed in code: `retain/orchestrator.py`, `retain/fact_extraction.py`, `retain/fact_storage.py`, `retain/entity_processing.py`, `retain/link_creation.py`]

### 3.3 Memory representation and storage model

Hindsight’s core fact storage lives in `memory_units` in PostgreSQL. A stored fact can include:

- fact text
- embedding
- event date
- occurred start / end
- mentioned-at time
- context
- fact type
- metadata
- document ID
- chunk ID
- tags
- search text signals
- links to entities and other facts

[Confirmed in code: `retain/fact_storage.py`, PostgreSQL storage modules]

It also stores or derives additional structures:

- documents
- chunks
- entities
- graph links (temporal / semantic / entity / causal)
- observations
- mental models
- directives
- bank settings/profile state

The main architectural strength is not “Postgres.” The strength is that Hindsight separates:

- **source artifacts** (documents/chunks)
- **normalized facts**
- **linked relationships**
- **auto-consolidated summaries**
- **operator-curated higher-order memory**

That separation is portable to Popeye.

### 3.4 Retrieval model (recall)

Hindsight’s recall path is sophisticated and explicit. The code describes it as:

1. run 4-way parallel retrieval
   - semantic vector search
   - BM25 keyword search
   - graph retrieval
   - temporal retrieval
2. merge via Reciprocal Rank Fusion (RRF)
3. rerank with heuristic or cross-encoder
4. diversify via MMR
5. filter to token budget

[Confirmed in code: `memory_engine.py`, `search/retrieval.py`, `search/fusion.py`, `search/reranking.py`]

Other strong retrieval features:

- temporal constraint extraction from the user query
- retrieval across multiple fact types in parallel
- tag and tag-group filtering
- optional inclusion of entities, chunks, and source facts under separate token budgets
- bank isolation throughout retrieval
- trace/debug facilities

This is a materially stronger recall stack than Popeye’s current lexical+vector+heuristic rerank system.

### 3.5 Reflection / consolidation model

Hindsight does not stop at raw recall.

#### Consolidation

After retain, Hindsight can run a consolidation job that turns new raw facts into **observations** — a higher-order memory layer that merges evidence over time. Observations track source memory IDs and change history. Consolidation can update, merge, or delete observations based on new evidence. [Confirmed in code: `consolidation/consolidator.py`]

This is one of Hindsight’s most transplantable ideas.

#### Reflect

Hindsight’s `reflect` layer then reasons over memory in a quality order:

1. mental models
2. observations
3. raw facts

This is a very useful pattern: **use curated and consolidated memory first, but keep raw facts as ground truth and fallback evidence**. [Confirmed in code/docs: `reflect/reflect_agent.py`, docs overview]

#### Mental models

Mental models are user-curated living documents that can be refreshed from a source query and keep history. This is essentially a curated higher-order memory layer with explicit operator ownership. [Docs + confirmed API surface]

That concept is extremely relevant for Popeye, but the exact Hindsight implementation is heavier than Popeye needs right now.

### 3.6 Temporal handling

Temporal handling is one of Hindsight’s clearest strengths.

Hindsight does not just track record creation time. It extracts or stores:

- `event_date`
- `occurred_start`
- `occurred_end`
- `mentioned_at`

It also analyzes queries for temporal constraints using a dedicated query analyzer and then activates a temporal retrieval path when relevant. [Confirmed in code: `query_analyzer.py`, `search/retrieval.py`, `retain/fact_extraction.py`]

This matters because personal-agent memory often depends on event time, not storage time:

- when a meeting happened
- when a person said a preference
- when a repo decision was made
- whether a statement is still valid

Popeye currently has only a small fraction of this.

### 3.7 Metadata / scoping / isolation

Hindsight’s scoping model is stronger than Popeye’s current scope string.

Key features:

- bank namespace
- tags
- tag matching modes
- tag groups / boolean-like filtering
- scoped mental models
- scoped consolidation refresh behavior
- tenant/request-context support

The multi-tenant parts are overkill for Popeye, but the **bank + tags + strict filtering discipline** is architecturally valuable.

### 3.8 Evaluation strategy

Hindsight treats memory quality as an engineering discipline, not just a feature claim.

Evidence of that includes:

- a separate benchmarks repo
- LongMemEval / LoCoMo benchmarking workflows
- a benchmark runner
- a visualizer
- memory-quality comparisons as a core part of project positioning

[Docs/repo structure]

Popeye should not copy Hindsight’s benchmark targets wholesale, but it should copy the **idea that memory quality needs repeatable evaluation outside ad hoc manual testing**.

### 3.9 What makes Hindsight strong

Hindsight’s strongest memory ideas are:

1. **retain/recall/reflect separation**
2. **fact-first normalization**
3. **clear layering between raw, consolidated, and curated memory**
4. **temporal reasoning built into both storage and retrieval**
5. **namespaces/tags as first-class isolation**
6. **explicit evidence flow into higher-order memory**
7. **evaluation as part of the architecture**

### 3.10 What makes Hindsight opinionated, heavy, or hard to transplant

Hindsight is not a drop-in fit for Popeye.

Hard-to-transplant or overbuilt aspects include:

- PostgreSQL + pgvector + HNSW dependence
- server/API-first architecture
- multi-tenant request-context machinery
- broad graph retrieval stack (BFS / link expansion / MPFP)
- cross-encoder reranker expectations
- async task/orchestration assumptions
- bank mission/disposition/directive model for reflect
- concept drift in the type model (`opinion` still appears in code while docs/recall prioritize observations and mental models)

For Popeye, the real win is to copy **the structure of the memory system**, not the infrastructure or every advanced retrieval trick.

---

## 4. Best memory components / patterns worth adopting

### 4.1 Explicit artifact → fact retain pipeline

**What it does**  
Adds a clear ingestion pipeline from raw source artifacts (receipts, messages, tool outputs, compaction flushes, docs, future email/calendar artifacts) into normalized fact records.

**Why it matters**  
Right now Popeye often stores artifact-like blobs as memories. That reduces retrieval precision and makes provenance/refinement harder.

**Why it fits Popeye specifically**  
Popeye is an always-on personal agent. It will eventually ingest heterogeneous, sensitive artifacts. A disciplined retain pipeline is the safest way to keep memory inspectable and controllable.

**Where it belongs**  
**Popeye**. This is a product memory concern, not a pi-mono concern.

**Complexity**  
**High**

**Implementation prerequisites**

- source artifact table/model
- typed extraction interfaces
- per-source extraction policy
- fact schema with evidence links
- migration plan that coexists with current `memories`

**Risks / caveats**

- extraction hallucinations
- too many low-value facts
- sensitive leakage into embeddings
- duplicated facts across sources

**Priority**  
**Core**

**Adoption guidance**  
This is the single highest-leverage adaptation from Hindsight.

---

### 4.2 Layered memory model: artifacts, facts, syntheses, curated memory

**What it does**  
Separates raw captured artifacts from extracted facts, synthesized/consolidated memories, and operator-curated memory.

**Why it matters**  
Without this separation, raw text, derived summaries, and curated truth all get mixed together and become hard to reason about.

**Why it fits Popeye specifically**  
Popeye already wants daily summaries and explicit promotion to curated memory. A layered model turns that from a convention into architecture.

**Where it belongs**  
Mostly **Popeye**, with **operator tooling** for review/promotion.

**Complexity**  
**Medium**

**Implementation prerequisites**

- record-layer field or separate tables
- evidence links between layers
- retrieval policy by layer
- promotion workflow that targets curated layer only

**Risks / caveats**

- migration complexity
- more tables and more queries
- need to keep operator mental model simple

**Priority**  
**Core**

**Adoption guidance**  
Use Hindsight’s layering idea, but keep Popeye’s naming and local-first ergonomics.

---

### 4.3 Evidence graph / provenance chain

**What it does**  
Every fact points to one or more source artifacts; every synthesis points to one or more supporting facts; every revision records what superseded what.

**Why it matters**  
This is the foundation for auditability, safe recall, and operator trust.

**Why it fits Popeye specifically**  
You explicitly want provenance, auditability, and safe use around sensitive personal data. Evidence chains are how those become enforceable rather than aspirational.

**Where it belongs**  
**Popeye**, with **operator tooling** for inspection.

**Complexity**  
**Medium**

**Implementation prerequisites**

- artifact IDs
- fact IDs
- synthesis IDs
- link tables and explain APIs

**Risks / caveats**

- more storage
- more complex debugging if links are incomplete
- need clear UX for evidence display

**Priority**  
**Core**

**Adoption guidance**  
Do not try to infer provenance after the fact. Make it part of every write path.

---

### 4.4 Event-time / valid-time model plus temporal query parsing

**What it does**  
Distinguishes when a fact occurred from when it was observed or stored, then uses that in retrieval.

**Why it matters**  
For a personal agent, “what happened when?” is more important than “when did the system store this record?”

**Why it fits Popeye specifically**  
Email, calendar, daily logs, repo work, and personal preferences all require temporal reasoning.

**Where it belongs**  
**Popeye**

**Complexity**  
**Medium**

**Implementation prerequisites**

- new time fields on facts/syntheses
- query analyzer for temporal expressions
- temporal-aware retrieval branch
- revision logic for time-bounded facts

**Risks / caveats**

- wrong inferred dates
- confusion between occurrence time and mention time
- ranking complexity

**Priority**  
**Core**

**Adoption guidance**  
Start simple: `occurred_at`, optional `valid_from`, `valid_to`, and a lightweight temporal parser. You do not need Hindsight’s full graph-temporal stack to get major value.

---

### 4.5 Structured namespaces plus tags

**What it does**  
Moves Popeye beyond a flat `scope` string into explicit namespaces (for example: operator/global, workspace, repo, communications, future email/calendar) with tags for filtering.

**Why it matters**  
Memory isolation becomes critical as Popeye expands into more personal domains.

**Why it fits Popeye specifically**  
You want a personal agent that will touch highly sensitive data. Namespace discipline is essential for privacy and operator control.

**Where it belongs**  
**Popeye**, with **operator tooling** for visibility/filtering.

**Complexity**  
**Low to medium**

**Implementation prerequisites**

- namespace schema
- tag schema / indexes
- migration path from current `scope`
- default visibility rules

**Risks / caveats**

- overcomplicated filtering semantics
- namespace sprawl
- accidental hidden-memory bugs if defaults are wrong

**Priority**  
**Core**

**Adoption guidance**  
Adopt the **idea** of Hindsight banks, not the full bank management machinery.

---

### 4.6 Deterministic staged recall planner

**What it does**  
Plans recall in stages: candidate generation, filtering, optional expansion, reranking, and token-budget packaging.

**Why it matters**  
A complex memory store without a disciplined recall planner tends to either over-retrieve or hide useful evidence.

**Why it fits Popeye specifically**  
Popeye already has the beginnings of this with query strategy and budget fitting.

**Where it belongs**  
**Popeye**

**Complexity**  
**Medium**

**Implementation prerequisites**

- layered memory schema
- namespace-aware filters
- temporal-aware query classification
- explainable score breakdowns

**Risks / caveats**

- too many heuristics
- hard-to-debug ranking changes
- accidental complexity creep

**Priority**  
**Core**

**Adoption guidance**  
Keep Popeye’s reranker deterministic by default. Make any neural reranking optional and off the hot path.

---

### 4.7 Synthesized memory layer (Popeye version of observations)

**What it does**  
Creates refreshable, evidence-backed syntheses that sit between atomic facts and curated markdown.

Examples:

- daily summaries
- rolling weekly summaries
- stable preference summaries
- durable profile summaries
- workflow/procedure syntheses
- repo/project state syntheses

**Why it matters**  
Agents rarely need raw facts alone. They need higher-order memory that is still inspectable and traceable.

**Why it fits Popeye specifically**  
Popeye already creates daily summaries and compaction summaries. This is a natural extension rather than a foreign concept.

**Where it belongs**  
**Popeye**, with **operator tooling** for review and promotion.

**Complexity**  
**Medium to high**

**Implementation prerequisites**

- fact layer
- evidence links
- refresh policy
- revision model
- synthesis storage

**Risks / caveats**

- over-automation and drift
- synthesis becoming pseudo-truth without enough evidence
- too much background work

**Priority**  
**Helpful now, core later**

**Adoption guidance**  
Start with a narrow synthesis set: daily/weekly summaries, durable personal profile summaries, and procedure summaries.

---

### 4.8 Lightweight entity normalization and relation links

**What it does**  
Improves entity handling beyond regex extraction by adding canonical identities, aliases, and source-backed relations.

**Why it matters**  
Recall quality improves dramatically once “Alex”, “Alexander”, “salexandr0s”, and “maintainer of repo X” can be recognized as the same entity when appropriate.

**Why it fits Popeye specifically**  
Email, calendar, tasks, repo issues, and personal memory all revolve around stable entities.

**Where it belongs**  
**Popeye**

**Complexity**  
**Medium**

**Implementation prerequisites**

- canonical entity store
- alias table
- entity mention linking
- conservative resolver policy

**Risks / caveats**

- false merges are dangerous
- graph complexity can spiral
- privacy risk if cross-domain merges are too aggressive

**Priority**  
**Helpful**

**Adoption guidance**  
Do not import Hindsight’s full graph retrieval stack. Start with canonicalization + source-backed relations only.

---

### 4.9 Revision / contradiction model

**What it does**  
Adds explicit relationships such as:

- supersedes
- contradicts
- confirmed_by
- invalidated_by

**Why it matters**  
Personal agents must handle changing facts safely: preferences change, schedules change, repo state changes, permissions change.

**Why it fits Popeye specifically**  
Your stated target includes confidence, uncertainty, aging, and safe recall. Revision handling is central to all of those.

**Where it belongs**  
**Popeye**

**Complexity**  
**Medium to high**

**Implementation prerequisites**

- fact IDs and synthesis IDs
- revision edges
- recency policy
- retrieval logic that prefers active/current facts

**Risks / caveats**

- bad supersession logic can hide true history
- contradictory memories may be legitimate if time-bounded
- UX can get confusing without good inspection surfaces

**Priority**  
**Core for later phases**

**Adoption guidance**  
Start with supersedes + confirmed_by. Add contradiction handling only once event-time modeling exists.

---

### 4.10 Memory quality evaluation harness

**What it does**  
Provides repeatable tests/benchmarks for recall quality, temporal correctness, namespace isolation, stale-memory handling, and privacy leakage.

**Why it matters**  
Memory systems degrade silently unless quality is measured on realistic tasks.

**Why it fits Popeye specifically**  
Popeye will operate on sensitive personal data. A benchmark-friendly system that is not safe or inspectable is not acceptable.

**Where it belongs**  
**Popeye testkit / operator tooling**

**Complexity**  
**Medium**

**Implementation prerequisites**

- realistic fixtures
- golden queries/answers
- scoring metrics
- trace capture

**Risks / caveats**

- optimizing to synthetic benchmarks instead of product value
- maintenance overhead

**Priority**  
**Core**

**Adoption guidance**  
Copy Hindsight’s evaluation mindset, not its public leaderboard strategy.

---

### 4.11 Dynamic pre-request memory injection hook

**What it does**  
Lets Popeye inject fresh recall into a live pi-mono session on a per-request basis instead of only at session creation or via explicit tools.

**Why it matters**  
Long-lived sessions and always-on agents need fresh memory without restarting or freezing context at session start.

**Why it fits Popeye specifically**  
Popeye wants durable memory but also long-running sessions and compaction-aware continuity.

**Where it belongs**  
**pi-mono foundation**, consumed by **Popeye runtime**

**Complexity**  
**Medium**

**Implementation prerequisites**

- pi-mono hook support
- context size guardrails
- recall package contract
- observability around injected memory

**Risks / caveats**

- prompt bloat
- harder reproducibility
- subtle changes in agent behavior over session lifetime

**Priority**  
**Helpful, not core**

**Adoption guidance**  
Useful once Popeye’s fact/synthesis layers are mature. Until then, explicit memory tools plus pre-run assembly are enough.

---

## 5. Areas where Hindsight seems stronger than Popeye

### 5.1 Ingestion from raw activity into usable memory

**Overlap**  
Both systems try to turn raw activity into durable memory.

**Why Hindsight appears better**  
Hindsight has an explicit retain pipeline that extracts structured facts, timestamps, entities, and relations from content. Popeye currently captures large memory records from receipts/docs/compaction but performs much less semantic normalization.

**What Popeye should learn**  
The main lesson is to treat ingestion as a multi-stage pipeline, not a single “store memory” call.

**Concrete adoption recommendation**  
Add a `memory_artifacts` layer and a typed fact-extraction stage before or alongside today’s `memories` writes.

### 5.2 Separation of raw and higher-order memory

**Overlap**  
Both systems distinguish, at least conceptually, between raw records and curated knowledge.

**Why Hindsight appears better**  
Hindsight explicitly separates raw facts, observations, and mental models. Popeye currently has daily summaries and curated memory promotion, but the layers are not yet formal enough.

**What Popeye should learn**  
Make the separation structural, not just conventional.

**Concrete adoption recommendation**  
Introduce an explicit `layer` or separate tables for `artifact`, `fact`, `synthesis`, and `curated`.

### 5.3 Temporal reasoning

**Overlap**  
Both systems know that recency matters.

**Why Hindsight appears better**  
Hindsight stores event/occurrence times and analyzes temporal constraints in queries. Popeye currently mostly uses recency scoring and simple temporal query classification.

**What Popeye should learn**  
Personal-agent memory needs event time, not just record age.

**Concrete adoption recommendation**  
Add `occurred_at` / `valid_from` / `valid_to` and a small temporal parser before attempting any advanced temporal graph logic.

### 5.4 Retrieval breadth and quality

**Overlap**  
Both systems retrieve across stored memory to support agent behavior.

**Why Hindsight appears better**  
Hindsight combines semantic, BM25, graph, and temporal retrieval before fusion/reranking/diversification. Popeye currently combines lexical and vector candidates with heuristic reranking.

**What Popeye should learn**  
Retrieval should become **multi-strategy**, but in a layered, explainable way.

**Concrete adoption recommendation**  
Add temporal retrieval first, then lightweight relation/entity expansion. Do not jump straight to full graph search.

### 5.5 Evidence-backed consolidation

**Overlap**  
Both systems consolidate memory over time.

**Why Hindsight appears better**  
Hindsight’s consolidation produces observations backed by source memory IDs. Popeye consolidates by dedup/text overlap and writes summaries, but evidence-backed higher-order memory is still thin.

**What Popeye should learn**  
Synthesis should remain traceable to supporting facts.

**Concrete adoption recommendation**  
Promote daily summaries and other syntheses into a first-class synthesis layer with explicit source fact links.

### 5.6 Isolation and scope control

**Overlap**  
Both systems need to avoid memory contamination across contexts.

**Why Hindsight appears better**  
Banks + tags + strict filtering are stronger than Popeye’s current `scope` string.

**What Popeye should learn**  
Isolation should be formal and queryable, not implicit.

**Concrete adoption recommendation**  
Replace simple scope matching with namespace + tags + sensitivity class filters.

### 5.7 Evaluation discipline

**Overlap**  
Both systems need to know whether memory recall is actually good.

**Why Hindsight appears better**  
Hindsight has a visible benchmarks/evaluation culture. Popeye currently appears to rely on package tests and implementation confidence.

**What Popeye should learn**  
Memory quality needs scenario-based measurement.

**Concrete adoption recommendation**  
Add a Popeye memory-eval harness with product-specific fixtures rather than importing LongMemEval-style objectives directly.

---

## 6. Hindsight ideas that should NOT be adopted

### 6.1 Do not adopt Hindsight’s full storage/infrastructure stack

Hindsight’s PostgreSQL + pgvector + HNSW + async/server-first setup is not a good default for Popeye. It conflicts with Popeye’s strongest product properties:

- local-first ownership
- low operational burden
- inspectability
- simple backups
- strong operator control

**Better Popeye solution**  
Stay SQLite-first. Add structure in the schema and retrieval planner before adding infrastructure complexity.

### 6.2 Do not adopt the full graph retrieval stack early

Hindsight’s graph retrieval variants are impressive, but they are not the first thing Popeye needs.

**Why it is a bad fit now**

- graph maintenance increases complexity fast
- relation quality depends on better fact extraction first
- it is easy to build an elaborate graph that does not improve real recall much

**Better Popeye solution**  
Start with source-backed relations and light expansion, not a general graph engine.

### 6.3 Do not adopt multi-tenant bank/auth machinery

Hindsight’s multi-tenant/request-context layer is reasonable for its product shape, but it is unnecessary weight for a local-first single-operator personal agent.

**Better Popeye solution**  
Use simple local namespaces, tags, and sensitivity controls. Keep the model inspectable.

### 6.4 Do not adopt bank mission/disposition as a memory prerequisite

Hindsight’s mission/directive/disposition layer is tied to `reflect`, not `recall`, and is part memory system, part reasoning policy system.

**Why it is a bad fit now**

- it mixes memory with agent personality/control
- it adds more policy surface than Popeye currently needs
- Popeye already has instruction files and runtime policy concepts

**Better Popeye solution**  
Keep instructions and control policy in Popeye’s existing instruction/runtime layer. If you later want curated “hard rules,” store them as operator-curated memory/policy, not as a full Hindsight-like bank profile system.

### 6.5 Do not copy Hindsight’s exact taxonomy

Hindsight’s types have evolved. The code still contains `opinion` in some paths, while recall and docs emphasize raw facts, observations, and mental models.

**Why it is a bad fit**
Popeye should not inherit taxonomy drift from another project.

**Better Popeye solution**  
Keep Popeye’s existing semantic axes (`episodic` / `semantic` / `procedural`) and add a second axis for **memory layer** (`artifact` / `fact` / `synthesis` / `curated`).

### 6.6 Do not optimize for benchmark complexity alone

Hindsight’s benchmark culture is a strength, but benchmark-driven retrieval complexity can become a trap if it hurts:

- operator visibility
- predictability
- simplicity
- privacy-aware controls

**Better Popeye solution**  
Evaluate with product-relevant scenarios first: personal profile recall, workspace memory, repo/task recall, temporal recall, stale-memory safety, and privacy leakage resistance.

### 6.7 Do not let automated synthesis outrun operator control

One risk in memory systems inspired by Hindsight is over-automating consolidation so the system quietly produces authoritative-seeming summaries.

**Better Popeye solution**  
Keep automated synthesis clearly marked as synthesized, evidence-backed, revisable, and inspectable. Curated memory should still require explicit operator promotion.

---

## 7. Popeye-specific memory gaps revealed by this comparison

This section explicitly evaluates the memory areas you asked for.

| Area | Popeye current equivalent | Hindsight approach appears better? | Belongs in | Priority | Complexity | Risks introduced | Recommendation |
|---|---|---:|---|---|---|---|---|
| Raw memory ingestion pipeline | **Partial.** Receipts, compaction flushes, workspace docs, manual inserts | **Yes** | Popeye | Essential | Medium | ingestion sprawl, sensitive overcapture | Add `memory_artifacts` and per-source retain pipeline |
| Memory normalization / extraction | **Weak/partial.** Heuristics, little structured extraction | **Yes** | Popeye | Essential | High | extraction hallucination | Add typed extraction stage before durable fact storage |
| Fact extraction from messages, actions, and tool calls | **Very limited.** Receipt capture is coarse; tool/message facts are not first-class | **Yes** | Popeye | Essential | High | noisy facts, privacy leakage | Extract facts from run events, tool outputs, ingress messages, future email/calendar artifacts |
| Typed memory categories | **Partial.** Episodic/semantic/procedural exist | **Mixed.** Hindsight layering is better, exact types are not | Popeye | Useful | Low | taxonomy churn | Keep Popeye type axis; add memory-layer axis |
| Separation between raw events and curated memories | **Partial.** Daily summary vs curated promotion exists conceptually | **Yes** | Popeye + operator tooling | Essential | Medium | migration complexity | Make artifacts/facts/syntheses/curated explicit |
| Entity extraction / normalization | **Partial.** Regex entity extraction and mentions | **Yes** | Popeye | Helpful | Medium | false merges | Add canonical entities, aliases, conservative resolver |
| Relationships between entities | **Minimal.** Mentions only | **Yes** | Popeye | Optional early / Helpful later | Medium-High | graph bloat, hallucinated relations | Start with source-backed relations only |
| Temporal memory representation | **Partial.** Created/source timestamps and recency scoring | **Yes, strongly** | Popeye | Essential | Medium | wrong inferred times | Add event-time fields and temporal semantics |
| Metadata, tags, and memory scoping | **Partial.** Scope/classification/sourceType exist | **Yes** | Popeye | Essential | Low-Medium | filter complexity | Introduce namespaces + tags + sensitivity filters |
| Per-user / per-operator / per-domain isolation | **Weak.** Mostly workspace scope | **Yes** | Popeye | Essential | Medium | leakage across domains | Separate operator/global, workspace, comms, integration namespaces |
| Retrieval strategy design | **Good baseline.** Strategy classification + deterministic weights | **Yes** | Popeye | Essential | Medium | heuristic sprawl | Keep deterministic planner; expand it rather than replacing it |
| Hybrid recall (semantic, lexical, temporal, graph-based, etc.) | **Partial.** Lexical + vector + light entity boost | **Yes** | Popeye | Helpful now, Core later | Medium-High | overengineering | Add temporal first, then lightweight relation expansion |
| Reranking / relevance ordering | **Good baseline.** Deterministic score merge | **Slightly** | Popeye | Useful | Medium | opacity if neural reranker added | Keep heuristics default; make neural reranker optional |
| Token-budget-aware memory recall | **Yes.** `budgetFit`, expansion, describe/expand tools | **Slightly** | Popeye | Essential | Low-Medium | source explosion | Extend packaging by layer: facts first, evidence second |
| Memory reflection / synthesis / consolidation | **Partial.** Dedup, overlap merge, daily summaries, compaction summaries | **Yes** | Popeye | Essential | Medium-High | drift, overautomation | Add evidence-backed synthesis layer |
| Confidence scoring | **Yes.** Scalar confidence + reinforcement + decay + durable half-life | **Not clearly.** Hindsight is not decisively stronger here | Popeye | Useful | Medium | false precision | Extend Popeye’s model into source reliability + extraction confidence + human confirmation |
| Provenance tracking | **Partial.** Source refs, source run IDs, consolidations, summary DAG | **Yes** | Popeye + operator tooling | Essential | Medium | schema sprawl | Add explicit evidence joins and explain APIs |
| Decay / staleness handling | **Yes, and already good.** Decay + archive threshold implemented | **Not clearly** | Popeye | Useful | Low-Medium | over-decay of durable truths | Keep Popeye’s lead; tune per layer rather than copy Hindsight |
| Contradiction handling / fact revision | **Weak.** Dedup/archive exist, explicit contradiction model does not | **Yes** | Popeye | Essential | Medium-High | hiding true history | Add revision edges and “active vs superseded” states |
| Memory bank / namespace design | **Weak.** Basic scope only | **Yes** | Popeye | Essential | Medium | namespace sprawl | Adopt a simplified bank-like namespace model |
| Observability and inspection of memory | **Partial.** Audit, integrity, describe, expand | **Yes** | Popeye + operator tooling | Essential | Medium | UI/API cost | Build memory explorer, recall trace, evidence browser |
| Evaluation / benchmark strategy for memory quality | **Weak.** Unit tests exist; no visible memory-quality harness | **Yes** | Popeye testkit / operator tooling | Essential | Medium | benchmark overfitting | Build product-specific memory eval harness |
| Privacy and security implications of the memory architecture | **Strong baseline.** Local-first, redaction, classification, operator-owned runtime | **Mixed.** Hindsight helps on isolation, not overall posture | Popeye + operator tooling | Essential | Low-Medium | embedding leakage, overcapture | Preserve Popeye’s privacy posture; adopt only namespace/tag isolation ideas |

### Priority ranking of the most important missing capabilities

1. **Artifact → fact normalization**
2. **Evidence-backed layered memory**
3. **Temporal fact model**
4. **Namespace/tag isolation**
5. **Revision/contradiction handling**
6. **Memory inspection and retrieval explanation**
7. **Evaluation harness**
8. **Entity normalization / relation expansion**

### How directly Hindsight helps with each gap

- **Directly helpful:** fact normalization, layered memory, temporal handling, namespaces/tags, evidence-backed synthesis, evaluation mindset
- **Indirectly helpful:** contradiction handling, operator tooling patterns, entity normalization
- **Not especially helpful:** Popeye’s privacy posture, local-first storage simplicity, existing decay model — Popeye already has better instincts there

---

## 8. Recommended memory architecture for Popeye

### 8.1 Target memory-system shape

Popeye should evolve toward a **five-layer memory architecture**:

### Layer 0 — Session/working context (pi-mono owned)
Transient session history, compaction state, and engine-local context management.

- owned by: **pi-mono**
- not the source of durable truth
- should expose hooks for fresh memory injection

### Layer 1 — Source artifacts (Popeye owned)
Immutable or append-only records of what actually happened or was observed.

Examples:

- receipts
- message ingress records
- tool outputs / structured action logs
- compaction flush artifacts
- workspace doc snapshots
- future email summaries / calendar snapshots / repo event artifacts

### Layer 2 — Extracted facts (Popeye owned)
Atomic, typed memory claims derived from artifacts.

Examples:

- “User prefers concise responses”
- “Repo `popeye` uses pnpm + Turborepo”
- “On 2026-03-15, task X failed due to missing credentials”
- “Procedure Y requires explicit approval before file mutation”

### Layer 3 — Synthesized memories (Popeye owned)
Evidence-backed higher-order memory derived from facts.

Examples:

- daily/weekly summaries
- durable profile syntheses
- recurring workflow syntheses
- repo/project status syntheses
- refreshed procedural summaries

### Layer 4 — Curated memory (operator-owned)
Explicitly promoted markdown or structured notes that the operator has approved.

Examples:

- identity/profile facts
- long-term preferences
- standing procedures
- durable allowlists/constraints
- curated personal notes

This architecture preserves Popeye’s strongest product property: **operator-owned curated memory with a local, inspectable substrate**.

### 8.2 Recommended boundaries

### pi-mono / runtime foundation

Should provide:

- session lifecycle
- compaction events
- working context management
- pre-request context injection hook (eventually)
- token/context telemetry

Should **not** own:

- artifact retention policy
- fact extraction
- synthesis rules
- namespace model
- memory privacy classification
- long-term recall ranking policy

### Popeye / product memory layer

Should own:

- artifact capture
- fact extraction
- fact storage
- namespace resolution
- sensitivity policy
- recall planning
- synthesis/consolidation
- revision/conflict logic
- curation/promotion workflow
- operator memory tooling

### Operator-facing tooling

Should expose:

- search by layer, namespace, time, sensitivity
- “why was this recalled?”
- evidence chain
- source artifact view
- revision/conflict view
- stale/decayed memory view
- promotion review/diff
- syntheses and their source facts

### 8.3 Recommended ingestion flow

```text
Source event/artifact
  -> artifact capture
  -> classify namespace + sensitivity + source type
  -> source-specific extraction
  -> normalize to atomic facts
  -> dedup/reinforce/update
  -> entity/temporal tagging
  -> optional embedding
  -> store evidence links
  -> enqueue synthesis/consolidation jobs
  -> optional operator promotion to curated memory
```

### Practical source-specific policies

- **Receipts:** keep full artifact, extract facts about outcome, decisions, failures, costs, follow-ups
- **Compaction flushes:** keep artifact, extract facts from condensed history, create synthesis summaries
- **Workspace docs:** keep doc snapshot/hash, extract facts conservatively, preserve doc provenance
- **Messages/tool calls:** extract only high-value, source-backed facts; do not store every utterance as durable memory
- **Sensitive integrations (future email/calendar):** stricter extraction policies, sensitivity flags before embeddings

### 8.4 Recommended storage model

### Keep vs add

Do **not** rewrite everything immediately.

#### Keep for now

- current `memories` table
- `memory_events`
- `memory_consolidations`
- `memories_fts`
- `memory_entities`
- `memory_entity_mentions`
- `memory_summaries`
- current search service and maintenance jobs

#### Add incrementally

- `memory_artifacts`
- `memory_artifact_chunks` (optional if needed)
- `memory_facts`
- `memory_fact_sources`
- `memory_fact_entities`
- `memory_fact_relations`
- `memory_revisions`
- `memory_namespaces`
- `memory_tags`
- `memory_syntheses`
- `memory_synthesis_sources`

### Recommended field model

#### `memory_artifacts`

- `id`
- `source_type`
- `namespace_id`
- `sensitivity`
- `source_run_id`
- `source_ref`
- `captured_at`
- `occurred_at` (nullable)
- `content`
- `content_hash`
- `metadata_json`

#### `memory_facts`

- `id`
- `namespace_id`
- `memory_type` (`episodic` / `semantic` / `procedural`)
- `fact_kind` (`event`, `preference`, `identity`, `procedure`, `relationship`, `state`, etc.)
- `text`
- `confidence`
- `source_reliability`
- `extraction_confidence`
- `human_confirmed` (bool)
- `occurred_at`
- `valid_from`
- `valid_to`
- `created_at`
- `last_reinforced_at`
- `archived_at`
- `active_revision_id` or status
- `durable`

#### `memory_syntheses`

- `id`
- `namespace_id`
- `synthesis_kind` (`daily`, `weekly`, `profile`, `procedure`, `project_state`, etc.)
- `text`
- `confidence`
- `refresh_policy`
- `created_at`
- `updated_at`
- `archived_at`

#### curated markdown layer

Keep markdown files under a stable layout such as:

- `memory/curated/profile/*.md`
- `memory/curated/procedures/*.md`
- `memory/daily/YYYY-MM-DD.md`

Then index curated files back into SQLite as curated records, but preserve the files as the operator-owned canonical surface.

### 8.5 Recommended retrieval model

### Stage 1 — query analysis
Determine:

- query strategy
- temporal constraint
- namespace constraints
- sensitivity ceiling
- whether the task wants facts, syntheses, procedures, or curated memory

### Stage 2 — candidate generation
Search in parallel across:

- curated memory
- synthesized memory
- extracted facts

Using:

- FTS5
- sqlite-vec where enabled
- namespace/tag filters
- type/layer filters

### Stage 3 — optional expansions
Only when justified:

- temporal window expansion
- entity-based expansion
- source-evidence expansion
- relation expansion from explicit source-backed links

### Stage 4 — reranking
Default scoring should remain deterministic and inspectable:

- lexical/semantic relevance
- temporal fit
- confidence
- revision status (active beats superseded)
- namespace match
- curated/synthesis layer preference when appropriate
- provenance density (evidence-backed beats weakly sourced)

### Stage 5 — token-budget packaging
Package memory in quality order:

1. curated memory
2. synthesized memory
3. atomic facts
4. source evidence excerpts only when needed

That is the key Hindsight-inspired change: **facts should remain ground truth, but not always the first thing shown to the agent**.

### 8.6 Recommended consolidation / reflection model

Popeye does not need Hindsight’s full `reflect` stack to get real value.

### Recommended Popeye synthesis model

- **Daily synthesis** — already exists; make it evidence-backed
- **Weekly synthesis** — optional rollup of daily syntheses
- **Profile synthesis** — rolling summary of durable identity/preferences
- **Procedure synthesis** — recurring steps and workflow summaries
- **Project/workspace synthesis** — current state summaries for repos/projects

### Rules

- synthesis must link to supporting fact IDs
- synthesis is never the only copy of the underlying knowledge
- synthesis can be refreshed/rebuilt
- curated memory remains explicit operator promotion
- superseded syntheses stay inspectable

This gives Popeye most of the value of Hindsight observations + mental models without copying the entire reflect subsystem.

### 8.7 Operator control / audit surfaces

Popeye should add a real memory inspector with at least:

- **Search** across artifacts/facts/syntheses/curated
- **Explain** why a memory was returned
- **Trace** score breakdown and filters applied
- **Evidence** view from synthesis → facts → artifacts
- **Revision** view showing superseded/conflicting memories
- **Decay** view showing what is aging out
- **Promotion** view showing diff from synthesis/facts to curated markdown
- **Namespace/sensitivity** filters

This is how operator visibility becomes practical rather than symbolic.

### 8.8 Security / privacy boundaries

Popeye should keep its current privacy posture and strengthen it.

### Keep

- local-first storage
- runtime-owned redaction
- explicit operator control
- no mandatory external retrieval service
- simple local backupability

### Add

- sensitivity policy before embedding
- namespace isolation defaults
- explicit “never embed / never summarize automatically” source policies
- curated-memory approval for highly sensitive profile facts
- recall filters that honor sensitivity class
- optional at-rest encryption later if needed, but not at the expense of inspectability

### Important principle

For Popeye, privacy is not just an access-control problem. It is also a **memory-shape problem**:

- what gets extracted
- what gets embedded
- what gets synthesized
- what is visible across namespaces
- what is safe to inject into agent context

---

## 9. Recommended phased roadmap

### Phase 0: prerequisites / cleanup

**Goals**

- make the current memory subsystem easier to evolve safely
- resolve spec/code mismatches
- define the long-term data model without rewriting everything

**Exact areas affected**

- contracts
- memory package
- runtime database
- architecture/docs
- pi-mono boundary notes

**Deliverables**

- source-of-truth memory model doc
- explicit distinction between current records and future fact/synthesis layers
- doc/code cleanup around retrieval semantics
- explicit vec-table creation path and migration documentation
- boundary note for what lives in pi-mono vs Popeye
- initial namespace model design

**Dependencies**

- none

**Expected benefit**

- reduces redesign risk
- prevents accidental Hindsight overfitting
- clarifies migration path

**Major risks**

- spending too long in design without shipping
- trying to finalize taxonomy too early

---

### Phase 1: memory foundation

**Goals**

- add the missing structural substrate for high-quality memory
- begin storing source artifacts and extracted facts separately

**Exact areas affected**

- runtime ingestion
- database schema
- memory package interfaces
- receipt/compaction/doc indexing flows

**Deliverables**

- `memory_artifacts` table
- `memory_facts` + `memory_fact_sources`
- per-source artifact capture interfaces
- first fact extractor for receipts, compaction summaries, workspace docs
- initial temporal fields (`occurred_at`, maybe `valid_from`/`valid_to`)
- initial namespace + tag schema
- dual-write or compatibility strategy with existing `memories`

**Dependencies**

- Phase 0 schema/design cleanup

**Expected benefit**

- dramatically better future recall quality
- stronger provenance base
- cleaner path to synthesis and revision handling

**Major risks**

- extraction quality problems
- too many low-value facts
- migration complexity

---

### Phase 2: better recall and retrieval

**Goals**

- improve recall quality without sacrificing inspectability
- make namespaces, temporal constraints, and layered retrieval real

**Exact areas affected**

- search service
- query analysis
- retrieval ranking
- runtime memory tools

**Deliverables**

- query analyzer with temporal extraction
- namespace/tag-aware retrieval
- layered recall planner across curated/synthesis/facts
- recall explanation / score breakdown endpoint
- optional temporal expansion
- better token-budget packaging by layer
- updated runtime tools or APIs for `search`, `explain`, `expand_evidence`

**Dependencies**

- Phase 1 fact storage + namespaces

**Expected benefit**

- better real-world recall
- safer context assembly
- easier debugging when memory results look wrong

**Major risks**

- ranking complexity
- performance regressions on SQLite if indexes are not tuned

---

### Phase 3: reflection / consolidation / confidence / decay

**Goals**

- move from raw facts to refreshable higher-order memory
- handle uncertainty and change more safely

**Exact areas affected**

- lifecycle jobs
- synthesis/consolidation services
- confidence model
- revision/conflict model

**Deliverables**

- synthesis layer (`memory_syntheses`)
- evidence-backed daily/weekly/profile/procedure syntheses
- revision edges (`supersedes`, `confirmed_by`)
- richer confidence model:
  - extraction confidence
  - source reliability
  - human-confirmed override
- decay policies by layer
- active vs superseded fact handling

**Dependencies**

- Phase 1 fact/evidence model
- Phase 2 layered recall

**Expected benefit**

- much better long-term usefulness
- less drift from stale memories
- better safety around changing personal facts

**Major risks**

- synthesis drift
- overly complicated confidence semantics
- operator confusion if conflict/revision UX is weak

---

### Phase 4: advanced memory quality and operator tooling

**Goals**

- make memory inspectable, governable, and regression-tested
- add only the advanced quality features that prove valuable

**Exact areas affected**

- control API
- web inspector
- CLI
- testkit/evaluation
- optional pi-mono integration hooks

**Deliverables**

- memory explorer UI/API
- evidence chain viewer
- promotion review flow
- conflict/revision viewer
- memory-quality evaluation harness
- privacy-leakage regression tests
- optional lightweight entity resolver improvements
- optional local neural reranker behind a feature flag
- optional pi-mono per-request context hook integration

**Dependencies**

- earlier phases

**Expected benefit**

- operator trust
- maintainability
- safer extension into email/calendar/todos/repos

**Major risks**

- too much tooling before core memory quality is stable
- feature creep from optional advanced ranking/graph ideas

---

## 10. Concrete implementation guidance

### 10.1 Practical next steps

1. **Freeze the current model in writing before refactoring.**  
   Document what `memories` means today and what future `facts` / `syntheses` will mean.

2. **Add artifacts and facts first, not observations/graph/reranker first.**  
   Better storage shape beats fancier retrieval.

3. **Dual-write before migration cutover.**  
   Keep current `memories` functioning while new artifact/fact paths mature.

4. **Start with three source pipelines only.**  
   Receipts, compaction summaries, and workspace docs are enough to prove the new architecture.

5. **Only after facts exist, upgrade retrieval and synthesis.**

### 10.2 Likely modules/services/interfaces to add or refactor

### In `@popeye/contracts`

Add or extend contracts for:

- `MemoryArtifactRecord`
- `MemoryFactRecord`
- `MemorySynthesisRecord`
- `MemoryRevisionRecord`
- `MemoryNamespace`
- `RecallPlan`
- `RecallExplanation`
- `EvidenceLink`

### In `@popeye/memory`

Suggested new modules:

- `artifact-store.ts`
- `fact-extractor.ts`
- `fact-normalizer.ts`
- `fact-store.ts`
- `namespace.ts`
- `temporal.ts`
- `revision.ts`
- `synthesis.ts`
- `recall-planner.ts`
- `recall-explainer.ts`

Keep and adapt existing modules:

- `search-service.ts`
- `scoring.ts`
- `budget-allocation.ts`
- `entity-extraction.ts`
- `summary-dag.ts`
- `integrity-checker.ts`

### In `@popeye/runtime-core`

Suggested integration modules:

- `memory-ingestion/receipt-facts.ts`
- `memory-ingestion/compaction-facts.ts`
- `memory-ingestion/doc-facts.ts`
- later:
  - `memory-ingestion/message-facts.ts`
  - `memory-ingestion/email-facts.ts`
  - `memory-ingestion/calendar-facts.ts`

### In `@popeye/engine-pi` or pi fork integration layer

Only if needed:

- hook adapter for pre-request memory injection
- compaction metadata plumbing
- token/context telemetry exposure

### 10.3 Suggested storage/indexing boundaries

**Do not put raw artifacts in the same table as synthesized memory.**

Recommended indexing split:

- artifacts: hash/content/source lookup
- facts: FTS5 + optional vec
- syntheses: FTS5 + optional vec
- curated memory: FTS5, maybe vec only for selected categories
- relations/evidence: relational joins only
- tags/namespaces: indexed filter columns

SQLite is still a good fit if the schema is normalized and indexed carefully.

### 10.4 Suggested memory APIs

Internal service APIs could look like:

```ts
captureArtifact(input: CaptureArtifactInput): MemoryArtifactRecord
extractFacts(input: ExtractFactsInput): ExtractFactsResult
upsertFacts(input: UpsertFactsInput): UpsertFactsResult
searchMemory(input: SearchMemoryInput): SearchMemoryResult
assembleRecallContext(input: RecallContextInput): RecallContextResult
createSynthesis(input: CreateSynthesisInput): MemorySynthesisRecord
refreshSynthesis(input: RefreshSynthesisInput): RefreshSynthesisResult
recordRevision(input: RecordRevisionInput): MemoryRevisionRecord
explainRecall(input: ExplainRecallInput): RecallExplanation
promoteToCurated(input: PromoteToCuratedInput): PromotionProposal
```

### 10.5 Suggested inspection / debugging surfaces

CLI/API/UI surfaces that would materially help:

- `memory search`
- `memory explain`
- `memory facts show <id>`
- `memory artifact show <id>`
- `memory synthesis show <id>`
- `memory revisions show <id>`
- `memory audit`
- `memory conflicts`
- `memory promote --from synthesis:<id>`

For each returned memory result, expose:

- why it matched
- score components
- namespace/tags
- revision status
- evidence chain
- whether it was curated, synthesized, or raw fact

### 10.6 Suggested evaluation harness for memory quality

Build a Popeye-specific harness with scenario fixtures such as:

- personal preference changes over time
- repo decision history
- task failure and follow-up recall
- workspace procedure recall
- “what changed this week?” temporal queries
- conflicting facts where newer fact should win
- privacy-sensitive memories that must not leak across namespaces
- queries that should return curated memory first but still expose evidence

Measure at least:

- precision@k
- recall@k
- MRR
- temporal accuracy
- stale-memory leakage rate
- namespace leakage rate
- evidence availability rate
- token-package usefulness (did the returned package fit and help?)

### 10.7 Recommended integration strategy with the current Popeye codebase

This should be an **evolution**, not a rewrite.

#### Step 1
Keep current `MemorySearchService` as the public facade.

#### Step 2
Teach it to search new fact/synthesis tables in addition to current `memories`.

#### Step 3
Migrate ingestion flows one by one to populate artifacts/facts.

#### Step 4
Use syntheses to replace some current coarse summary-style memories.

#### Step 5
Only later decide whether the legacy `memories` table should become:
- a compatibility layer
- the synthesis/curated table
- or be retired

That path minimizes risk and respects the fact that Popeye already has working memory behavior.

---

## 11. Final verdict

### What you should definitely adopt from Hindsight

- the **retain/recall/reflect-style separation**, adapted into Popeye’s own terminology
- an explicit **artifact → fact → synthesis → curated** memory layering
- **temporal fact fields** and temporal query handling
- stronger **namespace/tag isolation**
- **evidence-backed synthesis**
- a real **memory-quality evaluation harness**

### What you should probably ignore

- PostgreSQL/pgvector/HNSW as the default architecture
- full graph retrieval from day one
- multi-tenant/auth-heavy bank machinery
- mission/disposition as core memory architecture
- Hindsight’s exact taxonomy and evolving type names
- benchmark-chasing complexity that weakens inspectability

### What gives the highest leverage for improving Popeye’s memory management

1. **Improve ingestion and representation first.**
2. **Add evidence-backed layers before adding fancy retrieval tricks.**
3. **Add temporal and namespace semantics before adding graph complexity.**
4. **Add operator inspection and evaluation before trusting automatic synthesis too much.**
5. **Use pi-mono only for better hooks, not as the home of long-term memory.**

The deepest conclusion from this comparison is:

> Hindsight’s biggest gift to Popeye is not better search technology.  
> It is a better answer to the question, “What exactly is a memory, and how does it mature over time?”

If Popeye adopts that answer in a **SQLite-native, local-first, operator-visible** way, it can end up with a memory system that is both more useful than today’s implementation and more aligned with your actual product goals than Hindsight’s full architecture would be.
