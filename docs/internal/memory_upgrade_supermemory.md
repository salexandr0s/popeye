
# Popeye Memory Upgrade Plan from Supermemory

## 1. Title and purpose

**Title:** Popeye memory upgrade plan inspired by Supermemory

**Purpose:** This document is an implementation guide for upgrading Popeye’s memory system using the strongest transferable ideas from Supermemory while keeping Popeye aligned with its own goals: local-first operation, explicit operator control, durable provenance, privacy, auditability, and compatibility with an always-on personal-agent runtime.

This is not a feature comparison. It is a build plan.

---

## 2. Executive summary

Popeye already has a better local-first foundation than most memory systems. The current codebase has real strengths: SQLite-based durability, explicit workspace/project location semantics, evidence links from facts to artifacts and from syntheses to facts, explainable recall, confidence/reinforcement mechanics, and an operator-oriented promotion path into curated markdown. The core issue is not that Popeye lacks a memory system; it is that the system is split between a legacy `memories` compatibility layer and a newer structured layer that is not yet canonical in retrieval, ranking, lifecycle governance, or semantic indexing.

Supermemory’s strongest architectural lesson is not “use a vector DB” or “build a graph.” Its strongest lesson is the separation between **raw source material** and **normalized memory**, plus the operational workflows around that separation:

- raw documents/conversations are ingested as updateable source objects
- those sources are chunked intelligently
- normalized memory is extracted and versioned over time
- retrieval is hybrid across extracted memories and document chunks
- profiles materialize durable context into a short, agent-friendly form
- history, latest/current state, and forgetting/expiration are first-class

Popeye currently has some of these pieces, but they are incomplete or misbalanced:

- the hot search path still leans heavily on legacy `memories`
- vector search only covers legacy rows, not facts, syntheses, or source chunks
- artifacts are mostly provenance objects, not retrievable knowledge objects
- structured ingestion only runs for selected source types
- fact extraction and deduplication are conservative but shallow
- memory age is modeled mostly through confidence decay, which conflates uncertainty with staleness
- “profile” exists in the contracts as a synthesis kind, but is not materialized as a first-class context primitive
- provenance exists, but source identity, update history, trust weighting, and delete cascades are not yet strong enough for future email/calendar/files/repos workflows

**Recommended direction:** make Popeye’s structured memory layers canonical and phase the legacy layer out of the hot path. Keep SQLite, keep location and operator control, keep explainability, but adopt a stronger layered model:

1. **source stream -> artifact snapshot -> artifact chunks -> facts/relations -> syntheses/profile -> context assembly**
2. add hybrid retrieval across **chunks + facts + syntheses**
3. add versioned facts with `is_latest`, `root_fact_id`, `parent_fact_id`, `forget_after`, and staleness fields
4. materialize **profile_static** and **profile_dynamic** syntheses
5. replace age-based confidence decay as the main lifecycle mechanism with explicit freshness, staleness, TTL, and operator governance
6. add a real source provenance/trust model and delete/update cascades
7. keep Supermemory’s transferable ideas, but reject cloud proxy/router assumptions and container-tag-driven multi-tenant design as Popeye’s core abstraction

**Minimum high-value upgrade set:**

- searchable artifact chunks
- structured embeddings for chunks/facts/syntheses
- hybrid retrieval + better reranking
- source stream identity and incremental update semantics
- version/latest semantics for facts
- static/dynamic profile syntheses
- provenance-aware deletion and refresh

**Ideal longer-term architecture:**

A SQLite-backed, provenance-first personal memory substrate where every durable claim can be traced to source, every update has history, short-term context can mature into durable memory, and the operator can inspect, pin, forget, reindex, or restrict any memory object without handing control to a cloud memory service.

---

## 3. Scope and assumptions

### 3.1 What was analyzed

### Popeye
The analysis is based on direct inspection of Popeye’s public repository, especially:

- `docs/memory-model.md`
- `docs/domain-model.md`
- `architecture.md`
- `packages/contracts/src/memory.ts`
- `packages/memory/src/search-service.ts`
- `packages/memory/src/fts5-search.ts`
- `packages/memory/src/vec-search.ts`
- `packages/memory/src/scoring.ts`
- `packages/memory/src/strategy.ts`
- `packages/memory/src/pure-functions.ts`
- `packages/memory/src/artifact-store.ts`
- `packages/memory/src/fact-extractor.ts`
- `packages/memory/src/fact-store.ts`
- `packages/memory/src/synthesis.ts`
- `packages/memory/src/revision.ts`
- `packages/memory/src/entity-extraction.ts`
- `packages/memory/src/location.ts`
- `packages/memory/src/namespace.ts`
- `packages/memory/src/summary-dag.ts`
- `packages/runtime-core/src/database.ts`
- `packages/runtime-core/src/memory-lifecycle.ts`
- `packages/runtime-core/src/message-ingestion.ts`

### Supermemory
The analysis is based on public docs, public SDK/tooling code, and public API type definitions, especially:

- repo overview and package structure
- docs: intro, how it works, memory vs RAG, search, add memories, user profiles, content types, SuperRAG, document operations, connectors overview
- API docs for memory create/update/forget/history and conversation ingestion
- `packages/ai-sdk` / tool descriptions
- `conversations-client.ts`
- `tools-shared.ts`
- `memory-graph-api-types.ts`

### 3.2 In scope

In scope:

- memory architecture
- storage boundaries
- ingestion workflows
- chunking and normalization strategy
- memory schemas and object model
- search and ranking
- deduplication and update semantics
- source provenance and trust
- lifecycle and maintenance jobs
- agent-facing memory APIs
- operator-facing controls relevant to memory
- migration strategy from Popeye’s current state

### 3.3 Out of scope

Out of scope:

- full UI design for web or macOS inspectors
- capability-specific sync implementations for Gmail, Calendar, GitHub, Todoist
- model selection benchmarking for embeddings or rerankers
- replacing SQLite with a different database
- broad platform comparisons unrelated to Popeye and Supermemory
- Supermemory’s closed backend internals beyond what can be inferred from public docs and code

### 3.4 Necessary assumptions

- Supermemory backend internals are not fully visible. Where backend behavior is described here, it is inferred only from public docs, API contracts, and SDK/tooling behavior.
- Popeye’s memory behavior is centered in `packages/memory` and `packages/runtime-core`, with adjacent runtime modules influencing ingestion and policy but not replacing memory-layer logic.
- Popeye’s current memory direction is intentionally local-first, single-operator, and SQLite-centric; this plan preserves that direction rather than replacing it with a hosted-service design.

### 3.5 Remaining uncertainties

- Exact Supermemory backend heuristics for fact extraction, contradiction detection, and reranking are not visible.
- Popeye’s future People graph integration path is not fully specified from the inspected memory modules.
- Some runtime prompt-assembly code outside the inspected memory modules may require later follow-up integration work.

These uncertainties do not block the upgrade plan because the key implementation decisions are grounded in Popeye’s code and in clear, exposed Supermemory concepts.

---

## 4. Popeye current-state memory audit

## 4.1 Current architecture

Popeye’s memory system is already layered on paper and partially layered in code.

Current intended layers:

- **working/session context**: transient and runtime-owned
- **artifacts**: immutable source captures
- **facts**: extracted atomic claims
- **syntheses**: evidence-backed summaries
- **curated markdown**: operator-owned long-term memory

Current actual architecture is split:

- the legacy `memories` table still acts as the universal compatibility layer and carries the only vector-searchable embeddings
- structured tables (`memory_artifacts`, `memory_facts`, `memory_syntheses`, evidence/revision/tag/namespace tables) exist and are already populated for selected source types
- search reads from both, but semantic search only works against the legacy table
- memory lifecycle jobs such as decay and consolidation still operate primarily on legacy rows

That split is the defining architectural problem.

## 4.2 Current data flow

The core write path lives in `packages/runtime-core/src/memory-lifecycle.ts`.

Current flow in `insertMemory()`:

1. classify memory type
2. write a legacy `memories` row via `MemorySearchService.storeMemory()`
3. patch extra fields directly onto the legacy row (`domain`, `context_release_policy`, `dedup_key`, `source_run_id`, `source_timestamp`, `durable`)
4. if not rejected, optionally dual-write into structured memory using `captureStructuredMemory()`

`captureStructuredMemory()` currently only runs for a hardcoded subset of source types:

- `receipt`
- `compaction_flush`
- `workspace_doc`
- `daily_summary`
- `coding_session`
- `code_review`
- `debug_session`

It does **not** run for all source types already defined in contracts, and it does not yet define a general source/document abstraction with stable identity.

## 4.3 Storage model

### Existing durable surfaces

**Human-readable surface**
- curated markdown files
- generated daily summaries under `memory/daily/YYYY-MM-DD.md`

**SQLite memory surface**
- legacy tables:
  - `memories`
  - `memory_events`
  - `memory_sources`
  - `memory_consolidations`
  - `memories_fts`
  - `memory_entities`
  - `memory_entity_mentions`
  - `memory_summaries`
  - `memory_summary_sources`
- structured tables:
  - `memory_namespaces`
  - `memory_tags`
  - `memory_artifacts`
  - `memory_facts`
  - `memory_fact_sources`
  - `memory_revisions`
  - `memory_syntheses`
  - `memory_synthesis_sources`
  - `memory_facts_fts`
  - `memory_syntheses_fts`

### Important current strength

Popeye has a strong explicit location model in `location.ts`:

- global: both `workspace_id` and `project_id` null
- workspace scoped: `workspace_id` set, `project_id` null
- project scoped: both set

This is materially better than using only flat tags.

### Current storage weaknesses

- no first-class logical source identity beyond ad hoc `source_ref` and legacy `memory_sources`
- no artifact chunk table
- no structured embedding registry for facts/syntheses/chunks
- no canonical delete/update cascade across source -> artifact -> derived memory
- no structured-layer `context_release_policy` propagation comparable to the legacy row patching

## 4.4 Current indexing

### Full-text search
Implemented in `fts5-search.ts`:

- legacy `memories_fts`
- `memory_facts_fts`
- `memory_syntheses_fts`

Artifacts are not part of the primary search path. They are readable by ID and appear in explain/describe flows, but not as hot retrieval candidates.

### Vector search
Implemented in `vec-search.ts` and used from `search-service.ts`:

- only legacy `memories` rows have vectors in `memory_vec`
- facts, syntheses, and artifacts/chunks do not have semantic search support

This creates a structural mismatch:
- the newer, more meaningful structured layers exist
- the only semantically searchable layer is the older compatibility layer

## 4.5 Current retrieval flow

`packages/memory/src/search-service.ts` does the following:

1. sanitize query
2. apply consumer-profile defaults
3. build a recall plan using `buildRecallPlan()`
4. classify strategy using `strategy.ts`
5. search FTS across:
   - legacy memories
   - facts
   - syntheses
6. if embeddings are enabled, embed the query and search vectors **only in legacy memories**
7. merge and rerank candidates with `rerankAndMerge()`
8. optionally do type-budget allocation
9. return results with score breakdowns

Important detail: the current code effectively keeps legacy search in the hot path for most structured-layer queries because `shouldSearchLegacy` is true for any layer selection other than pure artifact retrieval.

### Current ranking signals

`scoring.ts` currently uses:

- FTS relevance
- vector similarity (legacy only)
- Jaccard fallback relevance
- recency / temporal fit
- confidence decay
- location match
- entity boost

This is a reasonable start and explainable, but it is missing several signals Popeye now needs:

- source trust
- latest/version status
- operator pinning or protection
- evidence density
- layer prior
- support count
- duplicate suppression across source versions and chunk siblings

## 4.6 Current memory lifecycle

### Creation
- writes legacy first
- structured dual-write second, only for selected sources

### Deduplication
Legacy:
- exact dedup via `dedup_key`
- overlap-based consolidation with Jaccard-like text overlap
- quality sweeps archive weak rows

Structured facts:
- `dedup_key = sha256(scope + factKind + normalized text prefix)`
- if same dedup key exists, confidence is bumped and evidence is linked
- otherwise new fact row inserted

### Revision/update semantics
- `memory_revisions` exists
- `revision.ts` only handles `supersedes` and `confirmed_by`
- `supersedes` marks target fact as `revision_status='superseded'`

This is useful but too narrow. It does not amount to a full version chain or current-state model.

### Decay
`runConfidenceDecay()` applies confidence decay and archives legacy memories below threshold. Durable memories get a longer half-life.

This is one of the biggest current design liabilities:
- confidence is being used partly as trust and partly as freshness
- old but true facts should not necessarily become less trusted
- temporary facts should expire explicitly, not only via confidence shrinkage

### Synthesis generation
Current automatic syntheses are narrow:

- `daily_summary` can generate a `daily` synthesis
- `compaction_flush` summaries can generate a `project_state` synthesis

The contracts already define `profile` as a synthesis kind, but the runtime does not yet materialize profile syntheses.

### Promotion
`proposePromotion()` and `executePromotion()` provide a path from DB memory to curated markdown. This is operator-friendly and should be kept.

## 4.7 Current context assembly

Current agent-facing packaging is result-list oriented:

- ranked search results
- optional evidence count
- score breakdown
- recall explanation

What is missing is a stronger **context pack** abstraction:

- no materialized static/dynamic profile
- no purpose-built split between “durable background”, “recent context”, “top facts”, and “supporting source chunks”
- no robust token-budget strategy by layer/source role
- no default provenance packaging format optimized for downstream prompt assembly

## 4.8 Current strengths worth preserving

Popeye should keep and extend these:

1. **SQLite + markdown dual surface**
2. **explicit location semantics**
3. **namespaces and tags as additive structure**
4. **explainable ranking**
5. **evidence links and lineage**
6. **operator promotion / curated memory**
7. **redaction before durable writes**
8. **single-operator local-first assumptions**
9. **compaction and summary DAG infrastructure**
10. **consumer-profile aware filtering hooks**

## 4.9 Limitations and technical debt

### High-severity
- legacy `memories` still dominates semantic retrieval
- no artifact chunk retrieval layer
- no structured embeddings
- no version/latest semantics for current truth state
- decay conflates age with uncertainty
- no source stream identity and incremental update semantics
- no profile materialization
- structured pipeline does not cover all relevant source types
- no deletion cascade across structured layers

### Medium-severity
- fact extraction is deterministic and shallow
- entity extraction is too weak for relation-aware memory
- source trust exists as a field but is not a ranking input
- structured layers lack richer policy fields
- observability is legacy-centric
- maintenance jobs do not yet govern the structured layers as first-class citizens

### Low-severity but future pressure points
- source-type enum growth for future integrations
- lack of query-specific context packing
- lack of backfill/deprecation plan for legacy `memories`

## 4.10 Missing primitives

The following primitives are the most important absences:

- logical source stream identity
- immutable artifact snapshots per source version
- searchable artifact chunks
- structured embeddings keyed by owner kind/id
- fact version chain (`root_fact_id`, `parent_fact_id`, `is_latest`)
- explicit TTL / `forget_after`
- source trust weighting
- materialized static/dynamic profile
- deletion/invalidation cascade
- structured retrieval logs and assembly traces

---

## 5. Supermemory architecture and memory-primitives breakdown

## 5.1 What Supermemory is doing particularly well

Supermemory’s most valuable ideas are not the hosted-service parts. They are the memory primitives and workflows:

### 1. Clear distinction between documents and memories
Supermemory treats raw inputs as documents and normalized understanding as memories. This is the right conceptual split. It prevents document storage from being confused with user/entity memory.

### 2. Hybrid retrieval
Search can return either:
- extracted memory objects
- document chunks

That is strategically important. Agents often need both:
- the normalized claim
- the exact supporting passage

### 3. Update/version semantics
Supermemory treats updates as first-class:
- `isLatest`
- `parentMemoryId`
- `rootMemoryId`
- update history
- soft forgetting / expiration

That is materially better than treating memory as append-only rows plus fuzzy dedup.

### 4. Relationship semantics
The public model distinguishes:
- `updates`
- `extends`
- `derives`

These are simple but powerful relation types. They are more useful than a generic “graph” pitch because they encode concrete memory behavior:
- replacement
- enrichment
- inference

### 5. Static vs dynamic profile
Supermemory’s profile endpoint is one of its best abstractions:
- **static** = durable long-term context
- **dynamic** = recent / changing context
- optional query-specific search results in the same response

This is a real context-engineering primitive, not just a convenience feature.

### 6. Source identity and incremental updates
The `customId` / conversation ID model lets the system treat content as an evolving source stream rather than a stream of unrelated inserts.

### 7. Content-type-aware normalization and chunking
Supermemory treats content differently by type:
- docs by semantic sections
- markdown by heading hierarchy
- code by AST-aware chunking
- web pages by cleaned structure
- OCR/transcription where needed

This is a strong architectural decision because chunking is not a generic pre-processing step; it shapes retrieval quality.

### 8. Simple agent ergonomics
The public interface is easy to reason about:
- add
- search
- profile
- forget
- update
- list history

Popeye does not need to match the same external API, but it should match the same internal simplicity.

## 5.2 What is strategically useful vs product-specific

### Strategically useful
- documents vs memories split
- hybrid retrieval
- version history + current/latest semantics
- TTL/forget model
- profile static/dynamic
- source stream identity (`customId`, `conversationId`)
- content-type-specific chunking
- relation types (`updates`, `extends`, `derives`)
- operational pipeline stages

### Product-specific
- dashboard-driven management
- hosted OAuth connector flows as the primary UX
- memory router / infinite chat proxy
- container-tag-first multi-tenancy
- marketing benchmark framing
- hosted “zero code” context proxying

### Implementation detail, not the core lesson
- exact public API shapes
- exact field names in the hosted service
- container-tag semantics
- hosted queueing behavior

## 5.3 Major Supermemory concepts: borrow directly, adapt heavily, reject

| Supermemory concept | What it solves | Decision for Popeye | Why |
|---|---|---|---|
| Raw documents vs extracted memories | separates evidence from normalized knowledge | **Borrow directly** | Popeye already started this with artifacts/facts/syntheses; it should finish the job |
| Hybrid retrieval over memories + chunks | returns both normalized facts and supporting passages | **Borrow directly** | This is the single highest-value retrieval upgrade for Popeye |
| Static + dynamic profiles | compacts durable vs recent context for prompts | **Borrow directly** | Popeye already has a `profile` synthesis kind reserved but not materialized |
| Version chain with `isLatest` / parent / root | default-to-current memory without losing history | **Borrow directly** | Popeye needs this for evolving personal context |
| `forgetAfter` / soft forget | temporary memory lifecycle | **Borrow directly** | Better fit than confidence decay for transient context |
| `updates` / `extends` / `derives` relations | models replacement, enrichment, inference | **Adapt heavily** | Good semantics, but Popeye should apply them conservatively and provenance-first |
| `customId` incremental updates | stable source identity and diffing | **Adapt heavily** | Popeye should implement this as local `source_streams` and snapshot versioning |
| Content-type-aware chunking | better retrieval quality by source type | **Adapt heavily** | Correct idea, but implemented locally with Popeye’s file/chat/runtime sources |
| Container tags | scoping/filtering | **Reject as primary abstraction** | Popeye’s location model is stronger; tags should remain additive |
| `entityContext` on container tags | persistent extraction hints | **Adapt heavily** | Useful as operator-authored extraction hints on namespaces/source streams, not as core tenancy primitive |
| Memory router / infinite chat proxy | transparent context injection | **Reject** | Too opaque for Popeye’s operator-control goals |
| Hosted connector model | cloud-managed sync | **Reject as architecture** | Popeye should reuse its local runtime jobs and capability adapters instead |
| Opaque managed extraction defaults | convenience | **Reject for core path** | Popeye needs inspectable, operator-governed memory behavior |
| Public dashboard-first operations | operational UX | **Optional later** | Useful as UI inspiration, not a core memory design requirement |

## 5.4 What Popeye should learn from Supermemory without copying blindly

The main lesson is not “become Supermemory locally.” The main lesson is:

- make sources explicit
- make normalized memory explicit
- make updates/history explicit
- make hybrid retrieval explicit
- make profile/context materialization explicit

Popeye should **not** adopt:

- hosted black-box behavior
- tag-only scoping
- transparent memory proxying that hides decisions from the operator
- a cloud-first connector/control model

---

## 6. Gap analysis: Popeye vs Supermemory

| Category | Popeye current state | Relevant Supermemory concept | Value | Decision | Why / implementation direction |
|---|---|---|---|---|---|
| Ingestion identity | Ad hoc `source_ref`; no logical source stream model | `customId`, `conversationId` | stable updates, diffing, dedup, delete cascade | **Adapt** | add `memory_source_streams` and snapshot versioning |
| Normalization | Artifact capture exists but no chunk layer | documents -> chunked memories | better retrieval and traceability | **Adopt** | artifact chunks become first-class retrievable units |
| Memory schema | Facts/syntheses exist, but no current/latest chain | memory history, `isLatest`, parent/root | correct handling of evolving truth | **Adopt** | add fact version chain fields |
| Memory types | episodic/semantic/procedural exist | static/dynamic profile split | better agent context | **Adapt** | add `profile_static` and `profile_dynamic` synthesis kinds |
| Source provenance | Evidence links exist but no strong source identity/trust model | documentId, sourceCount, status/history | auditability and conflict handling | **Adapt** | source streams + trust weighting + cascades |
| Search | FTS on facts/syntheses + legacy semantic search only | hybrid search on memories and chunks | large recall improvement | **Adopt** | hybrid retrieval becomes default |
| Ranking | explainable but missing trust/latest/salience/evidence | rerank, thresholds, hybrid result mixing | better recall quality | **Adapt** | keep deterministic core, add new features |
| Dedup / merge | exact-ish dedup only, narrow revisions | updates / extends / derives | handles changed vs enriched facts | **Adapt** | conservative resolver with provenance-backed updates |
| Freshness / staleness | confidence decay on legacy rows | `isLatest`, `forgetAfter`, soft forget | separates truth from freshness | **Adopt** | stop using decay as primary freshness model |
| Entity relationships | lightweight regex entity mentions | graph memory / relation edges | better retrieval and disambiguation | **Adapt** | relation table first, full graph later only if justified |
| Context building | ranked results + explanations | profile + search in one response | agent-friendly context assembly | **Adopt** | add context pack API |
| Operator controls | strong local control, promotion exists | forget/update/list history APIs | stronger governance | **Adapt** | add pin/protect/forget/inspect on structured layers |
| Observability | audit exists but mostly legacy-centric | visible pipeline stages/status | operability | **Adopt** | source/job/retrieval traces across structured layers |
| Testing | current system testable but no retrieval benchmark harness visible | profile/search/docs behaviors are productized | regression safety | **Adapt** | add golden retrieval/context tests |
| Scaling characteristics | okay for small local datasets, but no chunk pipeline for future connectors | queued pipeline with content-type-aware indexing | prepares for email/calendar/files/repos | **Adapt** | use runtime jobs, not external queue |

## 6.1 Most important gaps to fix first

### Gap 1: Structured memory is not the canonical retrieval substrate
Popeye already invested in structured memory, but the search system still relies on legacy `memories` for the only vector-based semantic recall.

**Upgrade decision:** fix first.

### Gap 2: Artifacts are provenance objects, not searchable knowledge objects
Without searchable chunks, source material is mostly invisible at recall time.

**Upgrade decision:** fix first.

### Gap 3: No current-state version semantics
The system can supersede a fact, but it does not yet have a strong “latest/current” model for evolving user/project memory.

**Upgrade decision:** fix first.

### Gap 4: No profile primitive
Popeye needs a short, durable background/context materialization for an always-on personal agent.

**Upgrade decision:** fix first.

### Gap 5: Confidence decay is doing too much conceptual work
Age and confidence are not the same. This will become more damaging as Popeye ingests more durable but slowly changing personal data.

**Upgrade decision:** replace with explicit freshness/TTL/governance.

## 6.2 Gaps Popeye should not solve by copying Supermemory directly

### Full graph-first retrieval
Supermemory’s public positioning emphasizes graph memory. Popeye should not jump to graph traversal as the core retrieval mode yet.

**Reason:** the immediate bottleneck is not graph traversal. It is missing chunks, versioning, and context packing.

### Tag-first scoping
Popeye’s location model is stronger than container tags. Do not flatten it.

### Transparent proxy memory routing
Popeye should not insert a hosted-style memory proxy in front of its LLM path. Context assembly should stay inspectable and explicit.

---

## 7. Recommended target architecture for Popeye memory

## 7.1 Target architectural direction

Popeye should move to a **provenance-first layered memory substrate** with structured layers as the canonical source of truth.

### Canonical path

```text
local source adapter / runtime event
        ↓
logical source stream
        ↓
immutable artifact snapshot
        ↓
type-specific normalization + chunking
        ↓
artifact chunks (FTS + embeddings + entity mentions)
        ↓
fact extraction + resolution
        ↓
versioned facts + relations + evidence links
        ↓
materialized syntheses (daily / project_state / profile_static / profile_dynamic / procedure)
        ↓
retrieval planner
        ↓
hybrid candidate generation (chunks + facts + syntheses + curated)
        ↓
rerank + duplicate suppression + context packing
        ↓
agent context + operator audit surfaces
```

## 7.2 Major subsystems

### A. Source stream registry
Canonical identity for evolving upstream objects:
- files
- conversations
- receipts
- summaries
- future email threads, calendar events, repo documents, task records

Responsibilities:
- stable key
- provider/source metadata
- location
- trust tier
- release policy
- sync cursor / last processed hash
- deleted status
- ingestion status

### B. Artifact snapshot store
Immutable captures of normalized source content at a point in time.

Responsibilities:
- artifact versioning
- raw-to-normalized boundary
- content hash
- snapshot lineage
- evidence anchor for derived memory

### C. Chunking/normalization layer
Transforms artifacts into retrievable, source-typed chunks.

Responsibilities:
- markdown chunking by heading hierarchy
- code chunking by syntax/AST-aware boundaries where possible
- generic conversation chunking by message windows / turns
- plain text sectioning
- future email/calendar-specific normalizers

### D. Fact resolver
Converts extracted statements into stable memory behavior:
- confirm existing fact
- create new fact
- create new fact version that updates an old one
- create `extends` relation
- optionally create `derives` only for low-trust inferred layers later

### E. Synthesis builders
Materialize high-value summaries:
- daily
- project_state
- procedure digest
- profile_static
- profile_dynamic

### F. Retrieval pipeline
Hybrid retrieval across:
- facts
- syntheses
- artifact chunks
- curated memory

### G. Governance / maintenance jobs
Responsible for:
- TTL expiry
- stale marking
- source deletion cascades
- synthesis refresh
- re-embedding
- re-extraction
- integrity checks

### H. Agent-facing interfaces
Simple internal memory APIs:
- ingest/update source
- recall/search
- get profile
- explain lineage
- forget/pin/protect
- reindex/reembed

### I. Operator-facing controls
Memory inspection and governance:
- inspect source lineage
- inspect why a fact exists
- view ranking explanation
- pin/protect/forget/delete
- override trust
- approve or reject merge/update decisions

## 7.3 Storage layers

### Keep
- SQLite as the canonical structured memory store
- FTS5 for lexical recall
- sqlite-vec for local semantic recall
- curated markdown for operator-owned memory

### Do not add now
- external vector DB
- graph DB
- distributed queue
- hosted memory proxy

### Reason
Popeye’s strength is explicit, ownable local infrastructure. The right move is to deepen the current SQLite architecture, not replace it.

## 7.4 Boundaries between raw data, normalized memory, and assembled context

### Raw source
Original source-specific object:
- email thread
- calendar event payload
- markdown file bytes
- transcript
- receipt
- run output

May live in source-specific storage or be referenced from metadata.

### Artifact
Normalized snapshot of source content suitable for durable processing and audit.

### Chunk
Retrievable span of artifact content.

### Fact
Atomic claim derived from one or more chunks/artifacts.

### Synthesis
Materialized aggregate over facts/chunks.

### Context assembly
Ephemeral query-specific package for the agent. This is not a stored memory object unless explicitly logged for diagnostics.

## 7.5 ASCII target architecture

```text
┌────────────────────────────────────────────────────────────────────┐
│ Source adapters / local integrations                              │
│ files | telegram | receipts | coding sessions | future mail/cal   │
└───────────────┬────────────────────────────────────────────────────┘
                │
                v
┌────────────────────────────────────────────────────────────────────┐
│ memory_source_streams                                              │
│ stable_key | provider_kind | location | trust | policy | status    │
└───────────────┬────────────────────────────────────────────────────┘
                │ new snapshot / update
                v
┌────────────────────────────────────────────────────────────────────┐
│ memory_artifacts                                                   │
│ immutable normalized snapshots + metadata + hashes + source link   │
└───────────────┬────────────────────────────────────────────────────┘
                │
                v
┌────────────────────────────────────────────────────────────────────┐
│ Normalizers + chunkers                                             │
│ markdown | code | transcript | plain text | future email/calendar  │
└───────────────┬────────────────────────────────────────────────────┘
                │
                v
┌────────────────────────────────────────────────────────────────────┐
│ memory_artifact_chunks + FTS + embeddings + entity mentions        │
└───────────────┬────────────────────────────────────────────────────┘
                │
                v
┌────────────────────────────────────────────────────────────────────┐
│ Fact extraction + fact resolver                                    │
│ confirm | update | extend | derive(optional later)                 │
└───────────────┬────────────────────────────────────────────────────┘
                │
                v
┌────────────────────────────────────────────────────────────────────┐
│ versioned memory_facts + memory_relations + evidence links         │
└───────────────┬────────────────────────────────────────────────────┘
                │
                v
┌────────────────────────────────────────────────────────────────────┐
│ memory_syntheses                                                   │
│ daily | project_state | profile_static | profile_dynamic | procedure│
└───────────────┬────────────────────────────────────────────────────┘
                │
                v
┌────────────────────────────────────────────────────────────────────┐
│ Retrieval planner + hybrid candidate generation + rerank           │
│ facts | syntheses | chunks | curated                               │
└───────────────┬────────────────────────────────────────────────────┘
                │
                v
┌────────────────────────────────────────────────────────────────────┐
│ Context assembler                                                  │
│ profile + facts + support chunks + provenance + trace              │
└────────────────────────────────────────────────────────────────────┘
```

## 7.6 MVP vs recommended next-level vs optional long-term

| Tier | What belongs here |
|---|---|
| **Minimum viable upgrade** | source streams, artifact chunks, structured embeddings, hybrid retrieval, profile syntheses, version/latest fields, delete cascade |
| **Recommended next-level architecture** | stronger fact resolver, trust-weighted ranking, TTL/staleness jobs, chunk-aware syntheses, richer operator controls, backfill off legacy `memories` |
| **Optional long-term enhancements** | local reranker, richer entity graph, inference memories, graph traversal retrieval, richer inspector UX, learned extraction |

---

## 8. Proposed data model and schemas

## 8.1 Guiding schema rules

1. **Keep SQLite canonical**
2. **Make source identity explicit**
3. **Keep raw source, normalized artifact, derived fact, and assembled context separate**
4. **Make lifecycle fields explicit instead of overloading confidence**
5. **Prefer additive migrations**
6. **Preserve provenance links at every derivation step**
7. **Do not require a graph DB for relation semantics**

## 8.2 Tables to keep as-is or lightly extend

Keep:
- `memory_namespaces`
- `memory_tags`
- `memory_entities`
- `memory_entity_mentions`
- `memory_artifacts`
- `memory_facts`
- `memory_fact_sources`
- `memory_syntheses`
- `memory_synthesis_sources`

Legacy compatibility to retain temporarily:
- `memories`
- `memory_events`
- `memory_sources`
- `memory_consolidations`

## 8.3 New canonical tables

### `memory_source_streams`
Logical identity for an evolving upstream source.

| Field | Type | Purpose |
|---|---|---|
| `id` | TEXT PK | internal source-stream ID |
| `stable_key` | TEXT UNIQUE NOT NULL | canonical identity, e.g. `file:/abs/path`, `telegram:chat:msg-thread`, `run:<id>` |
| `provider_kind` | TEXT NOT NULL | `local_fs`, `telegram`, `runtime`, future `gmail`, `gcal`, `github`, etc. |
| `source_type` | TEXT NOT NULL | coarse source category; existing `MemorySourceType` can map here |
| `external_id` | TEXT NULL | provider-native object ID |
| `namespace_id` | TEXT NOT NULL | location/namespace tie-in |
| `workspace_id` | TEXT NULL | explicit location |
| `project_id` | TEXT NULL | explicit location |
| `title` | TEXT NULL | human-readable label |
| `canonical_uri` | TEXT NULL | local path or provider URI |
| `classification` | TEXT NOT NULL | inherited safety class |
| `context_release_policy` | TEXT NOT NULL | release rules for downstream consumers |
| `trust_tier` | INTEGER NOT NULL DEFAULT 3 | coarse precedence in conflicts |
| `trust_score` | REAL NOT NULL DEFAULT 0.7 | ranking feature |
| `ingestion_status` | TEXT NOT NULL DEFAULT 'ready' | `ready`, `queued`, `processing`, `done`, `failed`, `deleted` |
| `last_processed_hash` | TEXT NULL | supports no-op updates |
| `last_sync_cursor` | TEXT NULL | future connector checkpoint |
| `metadata_json` | TEXT NOT NULL DEFAULT '{}' | provider metadata |
| `created_at` | TEXT NOT NULL | audit |
| `updated_at` | TEXT NOT NULL | audit |
| `deleted_at` | TEXT NULL | soft delete |

**Why:** this is Popeye’s local equivalent of Supermemory’s `customId` / conversation identity model.

### `memory_artifact_chunks`
First-class retrievable chunk layer.

| Field | Type | Purpose |
|---|---|---|
| `id` | TEXT PK | chunk ID |
| `artifact_id` | TEXT NOT NULL FK | parent artifact snapshot |
| `source_stream_id` | TEXT NOT NULL FK | source lineage |
| `chunk_index` | INTEGER NOT NULL | stable order within artifact |
| `section_path` | TEXT NULL | heading path / logical section |
| `chunk_kind` | TEXT NOT NULL | `paragraph`, `heading`, `code_fn`, `message_window`, `table`, etc. |
| `text` | TEXT NOT NULL | normalized searchable text |
| `text_hash` | TEXT NOT NULL | chunk dedup fingerprint |
| `token_count` | INTEGER NOT NULL | budget calculations |
| `language` | TEXT NULL | useful for code/docs |
| `classification` | TEXT NOT NULL | safety inheritance |
| `context_release_policy` | TEXT NOT NULL | release policy inheritance |
| `created_at` | TEXT NOT NULL | audit |
| `updated_at` | TEXT NOT NULL | audit |
| `invalidated_at` | TEXT NULL | source deletion or replacement cascade |
| `metadata_json` | TEXT NOT NULL DEFAULT '{}' | chunk-specific metadata |

Indexes:
- unique `(artifact_id, chunk_index)`
- index on `(source_stream_id, invalidated_at)`
- FTS table `memory_artifact_chunks_fts(chunk_id UNINDEXED, section_path, text)`

### `memory_embeddings`
Metadata for all embeddings, regardless of owner kind.

| Field | Type | Purpose |
|---|---|---|
| `id` | TEXT PK | embedding record ID |
| `owner_kind` | TEXT NOT NULL | `artifact_chunk`, `fact`, `synthesis` |
| `owner_id` | TEXT NOT NULL | row ID in owner table |
| `model` | TEXT NOT NULL | embedding model identifier |
| `dim` | INTEGER NOT NULL | vector dimension |
| `content_hash` | TEXT NOT NULL | invalidation trigger |
| `status` | TEXT NOT NULL DEFAULT 'active' | `active`, `stale`, `deleted` |
| `created_at` | TEXT NOT NULL | audit |
| `updated_at` | TEXT NOT NULL | audit |
| `embedding_version` | TEXT NOT NULL | model/runtime versioning |
| `metadata_json` | TEXT NOT NULL DEFAULT '{}' | optional backend metadata |

Vector storage:
- use sqlite-vec virtual table keyed by `embedding_id`
- keep embedding blobs out of ordinary row scans
- join embedding results back to `memory_embeddings` to resolve owner kind/id

### `memory_relations`
General relation table for facts, syntheses, and later entity-linked relations.

| Field | Type | Purpose |
|---|---|---|
| `id` | TEXT PK | relation ID |
| `relation_type` | TEXT NOT NULL | `updates`, `extends`, `derives`, `confirmed_by`, `contradicts`, `related_to` |
| `source_kind` | TEXT NOT NULL | `fact`, `synthesis`, `entity` |
| `source_id` | TEXT NOT NULL | relation source |
| `target_kind` | TEXT NOT NULL | `fact`, `synthesis`, `entity` |
| `target_id` | TEXT NOT NULL | relation target |
| `confidence` | REAL NOT NULL DEFAULT 1.0 | relation confidence |
| `created_by` | TEXT NOT NULL | `resolver`, `operator`, `maintenance_job` |
| `reason` | TEXT NOT NULL DEFAULT '' | human-readable reason |
| `metadata_json` | TEXT NOT NULL DEFAULT '{}' | relation details |
| `created_at` | TEXT NOT NULL | audit |

**Migration note:** keep `memory_revisions` initially as a compatibility event table; gradually converge new revision semantics into `memory_relations`.

### `memory_operator_actions`
Operator governance trail.

| Field | Type | Purpose |
|---|---|---|
| `id` | TEXT PK | action ID |
| `action_kind` | TEXT NOT NULL | `pin`, `protect`, `forget`, `delete_source`, `approve_update`, `reject_merge`, `promote`, `trust_override` |
| `target_kind` | TEXT NOT NULL | `source_stream`, `artifact`, `chunk`, `fact`, `synthesis` |
| `target_id` | TEXT NOT NULL | target row |
| `reason` | TEXT NOT NULL DEFAULT '' | operator note |
| `payload_json` | TEXT NOT NULL DEFAULT '{}' | action details |
| `created_at` | TEXT NOT NULL | audit |

### `memory_retrieval_logs`
Structured retrieval diagnostics.

| Field | Type | Purpose |
|---|---|---|
| `id` | TEXT PK | trace ID |
| `query_hash` | TEXT NOT NULL | privacy-preserving lookup key |
| `query_text_redacted` | TEXT NULL | optional redacted query for local debugging |
| `strategy` | TEXT NOT NULL | factual/temporal/procedural/etc. |
| `filters_json` | TEXT NOT NULL | effective filters |
| `candidate_counts_json` | TEXT NOT NULL | counts by layer/stage |
| `selected_json` | TEXT NOT NULL | final chosen objects |
| `feature_traces_json` | TEXT NOT NULL | ranking features |
| `latency_ms` | REAL NOT NULL | performance |
| `created_at` | TEXT NOT NULL | audit |

### `memory_context_assemblies`
Optional but recommended for debugging golden contexts.

| Field | Type | Purpose |
|---|---|---|
| `id` | TEXT PK | assembly ID |
| `retrieval_log_id` | TEXT NOT NULL FK | tie to trace |
| `max_tokens` | INTEGER NOT NULL | assembly budget |
| `assembled_json` | TEXT NOT NULL | final context sections |
| `created_at` | TEXT NOT NULL | audit |

## 8.4 Existing tables to extend

### Extend `memory_artifacts`

Add:

- `source_stream_id TEXT NOT NULL`
- `artifact_version INTEGER NOT NULL DEFAULT 1`
- `normalized_format TEXT NULL`
- `token_count INTEGER NULL`
- `classification TEXT NOT NULL` (already exists)
- `context_release_policy TEXT NOT NULL DEFAULT 'full'`
- `trust_score REAL NOT NULL DEFAULT 0.7`
- `chunker_version TEXT NULL`
- `extractor_version TEXT NULL`
- `raw_locator TEXT NULL` for optional raw-source pointer
- `invalidated_at TEXT NULL`
- `deleted_at TEXT NULL`

### Extend `memory_facts`

Add:

| Field | Type | Purpose |
|---|---|---|
| `root_fact_id` | TEXT NULL | root of version chain |
| `parent_fact_id` | TEXT NULL | immediate predecessor |
| `is_latest` | INTEGER NOT NULL DEFAULT 1 | default view should search current facts |
| `claim_key` | TEXT NULL | groups semantically equivalent claim family |
| `salience` | REAL NOT NULL DEFAULT 0.5 | ranking / promotion signal |
| `support_count` | INTEGER NOT NULL DEFAULT 1 | evidence-backed reinforcement count |
| `source_trust_score` | REAL NOT NULL DEFAULT 0.7 | retrieval feature |
| `context_release_policy` | TEXT NOT NULL DEFAULT 'full' | downstream release rules |
| `forget_after` | TEXT NULL | TTL for transient facts |
| `forget_reason` | TEXT NULL | why it should expire |
| `stale_after` | TEXT NULL | warning threshold for recency-sensitive facts |
| `expired_at` | TEXT NULL | expired/forgotten lifecycle |
| `invalidated_at` | TEXT NULL | deleted source cascade |
| `operator_status` | TEXT NOT NULL DEFAULT 'normal' | `normal`, `pinned`, `protected`, `rejected` |

Compatibility note:
- keep `revision_status` temporarily
- eventually derive “superseded” from `is_latest=0` plus relation chain

### Extend `memory_fact_sources`
Keep table name initially for migration simplicity, but treat it as evidence.

Add:
- `chunk_id TEXT NULL`
- `source_stream_id TEXT NOT NULL`
- `span_json TEXT NULL`
- `quote TEXT NULL`
- `confidence_contribution REAL NOT NULL DEFAULT 1.0`
- `trust_snapshot REAL NOT NULL DEFAULT 0.7`

### Extend `memory_syntheses`

Add:

| Field | Type | Purpose |
|---|---|---|
| `subject_kind` | TEXT NULL | `location`, `entity`, `source_stream` |
| `subject_id` | TEXT NULL | profile or project target |
| `input_window_start` | TEXT NULL | dynamic profile window |
| `input_window_end` | TEXT NULL | dynamic profile window |
| `refresh_due_at` | TEXT NULL | scheduler target |
| `salience` | REAL NOT NULL DEFAULT 0.5 | ranking |
| `quality_score` | REAL NOT NULL DEFAULT 0.7 | generation confidence |
| `context_release_policy` | TEXT NOT NULL DEFAULT 'full' | downstream release |
| `invalidated_at` | TEXT NULL | source delete cascade |
| `operator_status` | TEXT NOT NULL DEFAULT 'normal' | pin/protect |

### Extend `memory_entity_mentions`
Generalize from `memory_id` only to owner-kind references:

- `owner_kind TEXT NOT NULL`
- `owner_id TEXT NOT NULL`
- `mention_text TEXT`
- `span_start INTEGER NULL`
- `span_end INTEGER NULL`
- `extraction_method TEXT NOT NULL DEFAULT 'regex'`
- `confidence REAL NOT NULL DEFAULT 0.7`

## 8.5 Synthesis kinds

Change `MemorySynthesisKind` from:

- `daily`
- `weekly`
- `profile`
- `procedure`
- `project_state`

to:

- `daily`
- `weekly`
- `procedure`
- `project_state`
- `profile_static`
- `profile_dynamic`

Compatibility:
- keep `profile` as a read alias or migrate old rows if any exist later

## 8.6 Relation types

Change `MemoryRevisionRelation` / relation semantics from current:
- `supersedes`
- `confirmed_by`

to an expanded relation vocabulary:

- `updates`
- `extends`
- `confirmed_by`
- `contradicts`
- `derives`
- `related_to`

Mapping:
- current `supersedes` -> `updates`
- keep `confirmed_by`

## 8.7 Workspace / personal scope boundaries

Do **not** replace Popeye’s location model with container tags.

Use:
- `workspace_id`
- `project_id`
- `namespace_id`

Tags stay additive.

For future personal context and integration data:
- keep source streams bound to a location/namespace
- allow `subject_kind='entity'` for profile syntheses that refer to a person/project
- later link entities to the existing People graph instead of rebuilding a second identity system inside memory

---

## 9. Retrieval and ranking redesign

## 9.1 Retrieval design goals

The new retrieval system must:

1. search structured memory canonically
2. search both normalized facts and supporting source chunks
3. default to current/latest memory state
4. honor location, policy, sensitivity, and trust
5. explain why a result was chosen
6. assemble a context pack, not just a result list

## 9.2 Query understanding

Extend the current deterministic planning model in `recall-planner.ts` and `strategy.ts`.

### Recommended query intents

- `factual`
- `temporal`
- `procedural`
- `project_state`
- `profile`
- `audit`
- `exploratory`

### Query understanding outputs

For each query derive:

- intent
- target layers
- temporal window
- entity candidates
- desired provenance depth
- whether profile material is needed
- whether exact-support chunks should be preferred

### Suggested implementation
Keep this deterministic first. Do not make an LLM query-rewriter mandatory.

Add:
- alias normalization
- simple source-type hints (`email`, `calendar`, `repo`, `doc`, `code`)
- time normalization
- explicit “show evidence/source” audit intent

## 9.3 Candidate generation

### Lexical retrieval
Run FTS across:

- `memory_facts_fts`
- `memory_syntheses_fts`
- `memory_artifact_chunks_fts`
- optionally curated-memory artifact chunks or syntheses

### Semantic retrieval
Run vector search across embedding owners:

- facts
- syntheses
- artifact chunks

### Structured filters
Apply before or immediately after candidate generation:

- location filter (`workspace_id`, `project_id`, `include_global`)
- namespace filter
- tags
- domains
- source types/provider kinds
- `is_latest=1` by default
- exclude `expired_at`, `invalidated_at`, `deleted_at`, `forgotten` state by default
- classification ceiling / consumer policy
- temporal filters on `occurred_at`, `valid_from`, `valid_to`

## 9.4 Ranking model

Keep a deterministic, explainable linear reranker, but expand the signal set.

### New core signals

| Signal | Meaning |
|---|---|
| `semantic_similarity` | embedding match strength |
| `lexical_relevance` | FTS match strength |
| `temporal_fit` | explicit match to requested time window |
| `recency` | fallback freshness signal |
| `confidence` | extraction + evidence trust, not age decay |
| `source_trust` | trust tier/score of supporting source |
| `salience` | reinforced/pinned importance |
| `location_fit` | workspace/project/global fit |
| `layer_prior` | facts vs syntheses vs chunks depending on intent |
| `latestness` | penalty for non-latest or superseded items |
| `evidence_density` | support count / evidence quality |
| `entity_coverage` | overlap with extracted query entities |
| `duplicate_penalty` | suppress same root fact or sibling chunks |
| `operator_bonus` | pin/protect/manual confirmation |

### Default scoring formula

Start with:

```text
final_score =
  0.24 * semantic_similarity +
  0.16 * lexical_relevance +
  0.10 * temporal_fit_or_recency +
  0.12 * confidence +
  0.08 * source_trust +
  0.08 * salience +
  0.08 * location_fit +
  0.06 * layer_prior +
  0.04 * latestness +
  0.04 * evidence_density +
  0.04 * entity_coverage +
  0.04 * operator_bonus -
  duplicate_penalty
```

This is intentionally conservative. Popeye’s current explainable reranking is a strength; keep that, just add the missing features.

### Intent-specific weighting
Adjust `layer_prior` and the balance of recency vs evidence:

- **factual**: prefer latest facts, trusted syntheses, some support chunks
- **temporal**: favor event/state facts and dynamic syntheses
- **procedural**: favor procedural facts and code/doc chunks
- **project_state**: favor project-state syntheses plus recent state facts
- **profile**: favor static/dynamic profile syntheses first
- **audit**: favor chunks and evidence-backed facts, not high-level syntheses

## 9.5 Dedupe suppression in retrieval

Add a second pass after reranking:

- suppress multiple results from the same `root_fact_id`
- suppress adjacent artifact chunks from the same section unless audit mode asks for them
- suppress older versions when `is_latest=1` result is already selected
- suppress duplicate syntheses of the same kind/subject/location
- suppress daily summary plus project_state synthesis duplication when one subsumes the other

This should replace the current coarse type-budget allocation as the main diversity mechanism.

## 9.6 Context budget management

Current `budgetFit()` is token-estimation based but not layer-aware enough.

### New assembly model

Assemble context in ordered sections:

1. **Profile static** — durable background if relevant
2. **Profile dynamic / recent state** — recent context if relevant
3. **Top facts** — concise normalized claims
4. **Support chunks** — short quoted spans or excerpts
5. **Provenance footer** — source IDs/paths/thread references

### Suggested budgets by intent

| Intent | Static profile | Dynamic/profile state | Facts | Chunks | Provenance |
|---|---:|---:|---:|---:|---:|
| factual | 10% | 10% | 45% | 25% | 10% |
| temporal | 5% | 25% | 35% | 25% | 10% |
| procedural | 5% | 5% | 30% | 50% | 10% |
| project_state | 10% | 25% | 30% | 25% | 10% |
| audit | 0% | 10% | 25% | 55% | 10% |
| profile | 40% | 35% | 15% | 0-5% | 5-10% |

### Assembly rules

- prefer concise normalized facts over raw chunk text
- include chunks only when they add grounding or exact wording
- include provenance on every selected item
- never include raw source text that violates classification or release policy
- in normal mode, include only latest facts
- in audit mode, allow history when explicitly requested

## 9.7 Agent-facing interfaces

### `recallContext()`
Recommended internal API:

```ts
recallContext({
  q,
  workspaceId,
  projectId,
  includeGlobal = true,
  maxTokens = 1200,
  intent,
  latestOnly = true,
  includeHistory = false,
  includeProvenance = true,
  consumerProfile = "assistant"
})
```

Returns:

- `profileStatic[]`
- `profileDynamic[]`
- `facts[]`
- `syntheses[]`
- `chunks[]`
- `citations[]`
- `traceId`

### `getProfileContext()`
Recommended internal API:

```ts
getProfileContext({
  workspaceId,
  projectId,
  subjectKind = "location",
  subjectId,
  q,
  maxTokens = 600
})
```

Returns:
- `static`
- `dynamic`
- optional `searchResults`

This is Popeye’s local equivalent of Supermemory’s profile + search pattern.

## 9.8 Example: provenance-aware retrieval

**Query:** “What did I decide about SQLite workspace indexing?”

Planned retrieval:

- intent: factual/project_state
- candidate layers: facts + project_state syntheses + artifact chunks
- filters: current workspace/project, latest only
- ranking:
  - a fact about SQLite indexing ranks high
  - a project_state synthesis may rank second
  - a supporting workspace-doc chunk from the architecture doc ranks third
- final context pack:
  - fact: concise decision statement
  - synthesis: brief current project framing
  - chunk: 1 supporting excerpt
  - provenance: source file path + artifact ID + capture time

---

## 10. Memory lifecycle design

## 10.1 Lifecycle principles

1. **Age is not truth**
2. **Every derived object must point back to evidence**
3. **Updates should create history, not silent overwrite**
4. **Temporary context should expire explicitly**
5. **Operator actions override heuristics**
6. **Re-embedding and re-extraction are maintenance tasks, not semantic updates**

## 10.2 Creation

### New standard ingest flow

1. resolve or create `memory_source_streams` row by `stable_key`
2. compare content hash with `last_processed_hash`
3. if unchanged, no-op
4. if changed:
   - create new artifact snapshot
   - chunk the artifact
   - upsert chunk embeddings + FTS
   - extract entities
   - extract facts
   - resolve facts against existing latest facts
   - refresh syntheses as needed
   - update source stream status/hash

This replaces the current “legacy first, structured second” mental model.

## 10.3 Enrichment

### Immediate enrichment
- chunk extraction
- entity mentions
- fact extraction
- support/evidence links

### Deferred enrichment jobs
- better relation detection
- profile refresh
- re-embedding
- re-extraction when extractors improve

## 10.4 Updates

### Source-level updates
If the same logical source changes:
- create a new artifact snapshot
- do **not** mutate the old artifact
- invalidate or supersede derived objects as appropriate
- preserve history

### Fact-level updates
If a new fact changes the truth state of an old fact:
- insert a new fact row
- set `parent_fact_id`
- propagate `root_fact_id`
- mark old fact `is_latest=0`
- add relation `updates`
- keep old fact queryable only in history/audit mode

### Metadata-only updates
If only operator metadata changes:
- do not rechunk or re-extract
- update source/fact/synthesis metadata only

## 10.5 Merging and deduplication

### Exact duplicate
Same `claim_key` or strong exact normalized text identity:
- no new fact row
- add evidence/support
- update `support_count`
- bump `salience` modestly, not confidence blindly

### Semantic duplicate with same meaning
High-similarity fact plus same entities/fact kind/time bucket:
- default conservative behavior: attach as supporting evidence if confidence is high
- do not merge across different trust tiers without evidence compatibility

### Semantic update
Same subject/claim family but changed value:
- create new version
- relation `updates`

### Enrichment
New fact adds context without replacing:
- keep both facts
- relation `extends`

### Inference
Derived relationship or synthesized claim:
- only if enabled
- mark low trust
- relation `derives`
- keep out of default recall unless confidence/trust threshold met

## 10.6 Invalidation and archival

### Invalidation
Use explicit invalidation fields, not only `archived_at`.

When a source/artifact is deleted or replaced:
- chunks tied only to that artifact get `invalidated_at`
- facts with no remaining valid evidence get `invalidated_at` or `expired_at`
- syntheses dependent on invalidated facts get queued for refresh

### Archival
Use `archived_at` for:
- old compatibility rows
- obsolete synthesized outputs no longer used
- intentional operator archival

### Expiration
Use `forget_after` and `expired_at` for transient facts:
- session-level project state
- temporary availability
- one-off reminders
- short-lived conversational context

## 10.7 Decay and staleness handling

### Recommendation
Replace current confidence-decay-centric lifecycle with:

- `confidence`: trust in the claim/evidence
- `recency`: ranking signal
- `stale_after`: warn or down-rank when likely outdated
- `forget_after`: auto-expire temporary memory
- `salience`: retrieval importance
- `support_count`: reinforcement/evidence depth

**Do not** keep using confidence decay as the main mechanism for structured memory freshness.

### Why
A preference stated six months ago may still be highly true.
A temporary project state from yesterday may already be stale.
Those are different concepts.

## 10.8 Promotion from short-term to durable memory

Promotion should happen when at least one of these is true:

- repeated confirmation across independent sources
- operator pin/protect action
- source trust exceeds threshold and fact kind is durable
- fact appears in multiple recent syntheses and survives TTL horizon
- procedure or preference is reused repeatedly

Implementation:
- transient facts start with `forget_after`
- maintenance job checks reinforcement/support/operator confirmation
- promoted facts have TTL cleared and `salience` increased
- may be included in `profile_static`

## 10.9 Operator pinning / protection / deletion

### Pinning
Raises salience for retrieval.

### Protection
Prevents TTL expiry or auto-supersession without operator approval.

### Forgetting
Soft-removes a fact from normal recall while preserving audit trail.

### Deleting source
Cascades invalidation through derived layers.

## 10.10 Re-embedding and reindexing triggers

Trigger re-embedding when:
- embedding model changes
- content hash changes
- chunker version changes
- extractor version changes for synthesized text that changed
- operator requests reindex

Trigger re-extraction when:
- extractor logic changes materially
- source stream is backfilled from legacy
- relation resolution logic changes and history needs rebuild

## 10.11 Concrete lifecycle examples

### Example A: a workspace doc enters the system
1. `stable_key = file:/repo/docs/memory.md`
2. source stream row created or reused
3. content hash differs from `last_processed_hash`
4. new artifact snapshot created
5. markdown chunker produces chunks by heading hierarchy
6. chunks get FTS rows and embeddings
7. fact extractor emits candidate facts
8. fact resolver confirms 3 existing facts, inserts 2 new facts, updates 1 old fact version
9. profile_static refresh queued if durable facts changed
10. source stream updated to `done`

### Example B: duplicate memories are merged correctly
A preference appears in a workspace doc and later in a coding session:
- same `claim_key`
- no new fact version is created
- second source becomes an additional evidence link
- `support_count` increases
- fact trust becomes the max or weighted aggregate of supporting evidence
- raw artifacts remain separate and auditable

### Example C: provenance-aware query answer
Query: “What’s my current preference about dark mode?”
- profile_static provides the durable preference
- latest fact version outranks old version
- if needed, one supporting chunk from the underlying doc/message is included
- provenance footer identifies the supporting source stream and artifact snapshot

### Example D: short-term interaction becomes durable memory
Input: “Today I’m debugging auth in Project Alpha”
- initially stored as transient state fact with `forget_after=7d`
- repeated across several coding sessions and daily summaries
- support count rises and it appears in project_state syntheses
- maintenance job promotes it into durable project-state memory or extends the project profile

### Example E: operator deletion cascade
Operator deletes a synced email thread:
- source stream marked deleted
- artifact snapshots for that thread invalidated
- their chunks removed from FTS/vector search
- facts supported only by those chunks become invalidated/forgotten
- syntheses refresh and drop unsupported claims
- retrieval trace after refresh no longer returns those objects

---

## 11. Source provenance and trust model

## 11.1 Provenance goals

Every memory returned to the agent should answer:

- where did this come from?
- what exact evidence supports it?
- is it current?
- is it derived or directly observed?
- what happens if the source changes or is deleted?

## 11.2 Provenance chain

Recommended canonical lineage:

```text
source_stream
  -> artifact_snapshot
    -> artifact_chunk
      -> fact
        -> synthesis
          -> context assembly
```

Each edge should be inspectable.

## 11.3 Source trust tiers

Use a simple default trust model with operator overrides.

| Trust tier | Examples | Notes |
|---|---|---|
| 5 | curated markdown, operator-confirmed facts | highest precedence |
| 4 | workspace docs, repo docs, direct calendar records, canonical local files | generally trusted source-of-record |
| 3 | receipts, coding sessions, direct messages, observational logs | useful but not always canonical |
| 2 | daily summaries, compaction summaries, auto-generated syntheses | derived summaries, not primary evidence |
| 1 | inferred/derived relations or speculative synthesis outputs | off by default for sensitive recall |

Implementation:
- store base trust on `memory_source_streams`
- artifact inherits trust snapshot
- facts aggregate trust from evidence
- syntheses inherit min/max/weighted trust from inputs

## 11.4 Conflict handling

When facts conflict:
1. prefer higher trust
2. prefer newer source **only if the fact kind is time-sensitive**
3. prefer operator-confirmed or pinned facts
4. require explicit version/update relation rather than silent overwrite

### Important rule
A low-trust derived summary should not automatically replace a high-trust direct source fact.

## 11.5 Raw source vs normalized memory

### Raw source
May be large, noisy, or sensitive.

### Artifact snapshot
Stores normalized content needed for audit and chunking.

### Fact
Stores the claim.

The fact should never be treated as the raw source. It is a derived object that must remain linked to source evidence.

## 11.6 Auditability surfaces

Popeye should expose operator inspection for:

- source stream metadata and status
- artifact snapshot versions
- chunk text and section path
- fact history and update chain
- synthesis inputs
- ranking explanation for why a memory was returned
- delete/forget operator actions

## 11.7 Delete and edit semantics

### Delete source stream
- mark source deleted
- invalidate artifacts
- invalidate chunks
- remove vectors/FTS rows
- recompute fact support counts
- invalidate or forget unsupported facts
- refresh syntheses

### Edit operator metadata only
- no rechunking or re-extraction
- provenance remains intact

### Replace content
- new artifact snapshot
- rechunk and re-extract
- version/update facts as needed
- preserve history

---

## 12. Privacy, safety, and local-first constraints

## 12.1 Local-first storage

Default policy:
- all memory DB state remains local
- embeddings remain local by default
- chunking, FTS, and provenance stay local
- external model providers for embeddings/reranking are opt-in, not required

## 12.2 Sensitive data handling

Popeye already redacts before durable writes. Extend that to the full structured path:

- redact before artifact chunking
- respect `classification` and `context_release_policy` on chunks, facts, and syntheses
- do not embed denied/sensitive content unless operator explicitly permits it
- allow summary-only derived facts from high-sensitivity source text when release policy forbids raw recall

## 12.3 Least privilege

For future email/calendar/files/messages:

- only the source adapter that needs access should read the raw source
- memory layer should work from normalized snapshots and explicit metadata
- retrieval should not require live provider access
- delete and refresh should flow through source stream records, not hidden side channels

## 12.4 Operator visibility

The operator should be able to inspect:

- what was stored
- what was chunked
- what was extracted
- what was returned
- why it was returned
- what will expire
- what will be affected by deleting a source

## 12.5 Permissioning and release control

Move `context_release_policy` into structured layers.

Default rule:
- inherited from source stream to artifact to chunk/fact/synthesis
- can become stricter automatically
- can only become looser by explicit operator override

Consumer profiles should gate:
- max classification
- allowed release policies
- whether raw chunks are allowed
- whether history/forgotten memory is visible

## 12.6 Deletion guarantees

Deletion should remove or invalidate:

- source stream
- artifact snapshots
- chunks
- vector rows
- FTS rows
- unsupported facts
- syntheses that rely only on deleted evidence

This must be testable. “Soft delete” is acceptable for auditability, but default recall must treat deleted objects as gone.

## 12.7 Encryption considerations

Recommended:
- leave SQLite as the canonical store
- optionally support SQLCipher or OS-level disk encryption
- encrypt raw source cache paths if Popeye later stores local copies of email/file payloads beyond normalized artifact text

Do not make encryption architecture depend on a hosted memory service.

## 12.8 Safe handling of email/calendar/files/messages

Recommended defaults:

- email thread artifacts: `classification=sensitive`, `context_release_policy=summary_only` unless operator allows raw
- calendar events: high trust but often sensitive; expose structured facts before raw descriptions
- files and repo docs: trust depends on path/source classification
- messages: lower trust than curated docs, often transient, more TTL-driven

---

## 13. Concrete phased implementation plan

## Phase 0: audit and instrumentation

### Objective
Create a measurable baseline before changing retrieval semantics.

### Exact work
- add retrieval traces to `search-service.ts`
- add ingestion counters and structured-layer coverage metrics to `memory-lifecycle.ts`
- add golden query corpus for current memory behavior
- record baseline:
  - legacy-hit rate
  - structured-hit rate
  - average retrieval latency
  - result-layer distribution
- add backfill inventory query: which legacy rows have no structured counterpart

### Key files/modules likely to change
- `packages/memory/src/search-service.ts`
- `packages/runtime-core/src/memory-lifecycle.ts`
- `packages/runtime-core/src/database.ts`
- new `packages/memory/src/retrieval-logging.ts`
- test fixtures for retrieval

### Migrations/jobs/services/APIs to add
- `memory_retrieval_logs`
- optional `memory_context_assemblies`

### Dependencies
None

### Risks
- logging sensitive query text
- over-logging and local DB growth

### Acceptance criteria
- every recall can produce a trace ID
- baseline metrics are queryable
- golden query fixtures exist for before/after comparison

---

## Phase 1: schema foundation

### Objective
Add the canonical schema needed for structured-first memory.

### Exact work
- add `memory_source_streams`
- add `memory_artifact_chunks` + FTS
- add `memory_embeddings` metadata + new sqlite-vec index keyed by embedding ID
- extend `memory_artifacts`, `memory_facts`, `memory_fact_sources`, `memory_syntheses`, `memory_entity_mentions`
- extend contracts in `packages/contracts/src/memory.ts`
- keep old tables operational

### Key files/modules likely to change
- `packages/contracts/src/memory.ts`
- `packages/runtime-core/src/database.ts`
- migration tests

### Migrations/jobs/services/APIs to add
- schema migration IDs for the above tables/columns
- compatibility read helpers for old vs new rows

### Dependencies
Phase 0

### Risks
- migration complexity on existing local DBs
- column-name collisions with historical tables

### Acceptance criteria
- migration succeeds on a populated existing DB
- old memory APIs still run
- new schema available for feature work without breaking search

---

## Phase 2: ingestion normalization

### Objective
Make structured ingest canonical and source-aware.

### Exact work
- introduce `source_streams` service: resolve/create by stable key
- refactor `captureStructuredMemory()` into a real pipeline:
  - source stream
  - artifact snapshot
  - chunking
  - entity extraction
  - fact extraction
  - synthesis refresh hooks
- add normalizer/chunker interfaces
- implement chunkers for:
  - markdown
  - code / code-like text
  - conversation transcript
  - generic plain text
- extend structured ingestion coverage to include at least:
  - `curated_memory`
  - `file_doc`
  - `telegram`
  - existing summary/doc/session types

### Key files/modules likely to change
- `packages/runtime-core/src/memory-lifecycle.ts`
- `packages/memory/src/artifact-store.ts`
- new `packages/memory/src/source-streams.ts`
- new `packages/memory/src/chunk-store.ts`
- new `packages/memory/src/chunkers/*`
- `packages/memory/src/entity-extraction.ts`

### Migrations/jobs/services/APIs to add
- source-stream upsert API
- artifact chunk insert/update helpers
- chunk FTS sync helpers

### Dependencies
Phase 1

### Risks
- chunk explosion
- incorrect stable-key mapping
- duplicate snapshot creation

### Acceptance criteria
- workspace docs produce chunks
- re-ingesting unchanged content is a no-op
- changing a file/conversation produces a new artifact snapshot, not duplicate unchanged facts
- lineage from source stream to chunk exists

---

## Phase 3: retrieval and ranking upgrade

### Objective
Make structured hybrid retrieval the default.

### Exact work
- add chunk search to `fts5-search.ts`
- replace legacy-only vector search with unified embedding search
- rerank across facts, syntheses, and chunks
- add latest-only filtering by default
- add ranking signals for trust, salience, evidence, operator status
- add duplicate suppression by `root_fact_id` and sibling chunk groups
- add `recallContext()` assembly API

### Key files/modules likely to change
- `packages/memory/src/search-service.ts`
- `packages/memory/src/fts5-search.ts`
- `packages/memory/src/vec-search.ts` or new `embedding-search.ts`
- `packages/memory/src/scoring.ts`
- `packages/memory/src/strategy.ts`
- new `packages/memory/src/context-assembler.ts`
- `packages/memory/src/recall-explainer.ts`

### Migrations/jobs/services/APIs to add
- structured embedding backfill job
- trace explanations for new rank features

### Dependencies
Phase 2

### Risks
- retrieval regressions during mixed legacy/structured period
- higher latency if chunk candidates are not bounded carefully

### Acceptance criteria
- top results can include facts, syntheses, and chunks
- score breakdown includes trust/salience/latestness
- queries over docs/code return support chunks
- legacy-only vector path is no longer required for good recall

---

## Phase 4: provenance and entity/version layer

### Objective
Add durable update semantics and profile materialization.

### Exact work
- add fact version-chain logic (`root_fact_id`, `parent_fact_id`, `is_latest`)
- introduce `memory_relations`
- expand revision semantics from `supersedes` to `updates` / `extends`
- implement conservative fact resolver
- add `profile_static` and `profile_dynamic` synthesis builders
- connect profile refresh to ingestion and maintenance jobs
- integrate operator pin/protect actions into ranking

### Key files/modules likely to change
- `packages/memory/src/fact-store.ts`
- `packages/memory/src/revision.ts` or new `relations.ts`
- new `packages/memory/src/fact-resolver.ts`
- `packages/memory/src/synthesis.ts`
- new `packages/memory/src/profile-builder.ts`
- `packages/memory/src/entity-extraction.ts`

### Migrations/jobs/services/APIs to add
- profile refresh jobs
- lineage inspection API
- operator action write path

### Dependencies
Phase 3

### Risks
- false-positive update detection
- relation overproduction
- profile churn

### Acceptance criteria
- a changed preference or status produces a new latest fact version
- history remains visible in audit mode
- profile_static and profile_dynamic are queryable and evidence-backed

---

## Phase 5: maintenance jobs and memory governance

### Objective
Replace legacy-centric maintenance with structured governance.

### Exact work
- replace `runConfidenceDecay()` with structured governance jobs:
  - TTL expiry
  - staleness marking
  - synthesis refresh
  - delete cascades
  - re-embedding
  - re-extraction
- repurpose `getMemoryAudit()` to report structured-layer health
- extend `runIntegrityCheck()` for:
  - orphan chunks
  - facts with zero valid evidence
  - stale embeddings
  - profile refresh debt

### Key files/modules likely to change
- `packages/runtime-core/src/memory-lifecycle.ts`
- new `packages/runtime-core/src/memory-governance.ts`
- `packages/memory/src/summary-dag.ts` reuse where helpful
- `packages/memory/src/synthesis.ts`

### Migrations/jobs/services/APIs to add
- maintenance job status records
- CLI/API endpoints for reindex/reembed/refresh

### Dependencies
Phase 4

### Risks
- accidental over-expiration
- stale profile material if refresh cadence is wrong

### Acceptance criteria
- transient facts expire via `forget_after`
- deleting a source invalidates unsupported downstream objects
- profile and syntheses refresh automatically when inputs change

---

## Phase 6: agent-context integration

### Objective
Make the runtime consume structured context packs instead of raw ranked result lists.

### Exact work
- wire `recallContext()` into the agent prompt/context path
- use profile static/dynamic selectively by intent
- enforce structured-layer `context_release_policy` in context assembly
- expose stronger recall explanation to operator surfaces
- ensure curated markdown remains high-trust material in recall

### Key files/modules likely to change
- `packages/memory/src/search-service.ts`
- `packages/memory/src/context-assembler.ts`
- runtime prompt/context integration modules
- control API memory endpoints where relevant

### Migrations/jobs/services/APIs to add
- `getProfileContext`
- `recallContext`
- richer explain/inspect endpoints

### Dependencies
Phase 3 minimum, Phase 4 recommended

### Risks
- prompt-size regressions if context packing is not disciplined
- mixing old and new memory contracts during rollout

### Acceptance criteria
- agent context is delivered as profile + facts + chunks + provenance
- golden prompt-assembly tests pass
- policy-restricted material is filtered correctly

---

## Phase 7: polish, observability, operator UX, legacy deprecation

### Objective
Finish the transition and make the system operator-friendly.

### Exact work
- add CLI/API tools for:
  - inspect source lineage
  - inspect fact history
  - pin/protect/forget
  - trust override
  - reindex/reembed
- expose structured metrics in inspector UI later
- backfill legacy `memories` into structured layers where needed
- freeze legacy `memories` as compatibility-only
- remove legacy rows from default search path
- optionally convert legacy `memories` into a compatibility view or archival table later

### Key files/modules likely to change
- CLI/control API memory commands
- web inspector memory views
- `packages/runtime-core/src/memory-lifecycle.ts`
- migration/backfill scripts

### Migrations/jobs/services/APIs to add
- backfill job
- legacy coverage report
- operator memory governance endpoints

### Dependencies
All prior phases

### Risks
- mixed-mode rollout complexity
- local DB size growth during backfill

### Acceptance criteria
- structured layers are canonical in retrieval
- legacy table is not required for good recall
- operator can fully inspect and govern memory lineage

---

## 14. Detailed task backlog

## 14.1 Schema and storage

- [ ] Add migration for `memory_source_streams`
- [ ] Add `source_stream_id` to `memory_artifacts`
- [ ] Add migration for `memory_artifact_chunks`
- [ ] Add `memory_artifact_chunks_fts`
- [ ] Add migration for `memory_embeddings`
- [ ] Add sqlite-vec table keyed by `embedding_id`
- [ ] Extend `memory_facts` with version/latest/TTL/salience/trust/policy fields
- [ ] Extend `memory_fact_sources` with `chunk_id`, `source_stream_id`, span and trust snapshot fields
- [ ] Extend `memory_syntheses` with subject/profile refresh fields
- [ ] Extend `memory_entity_mentions` to owner-kind references
- [ ] Add `memory_relations`
- [ ] Add `memory_operator_actions`
- [ ] Add `memory_retrieval_logs`
- [ ] Add `memory_context_assemblies`
- [ ] Add migration tests from an existing Popeye DB fixture

## 14.2 Ingestion pipeline

- [ ] Implement `resolveSourceStream()` helper
- [ ] Implement `upsertSourceStreamStatus()` helper
- [ ] Refactor `captureStructuredMemory()` into pipeline stages
- [ ] Add no-op update detection via content hash on source stream
- [ ] Add artifact snapshot versioning
- [ ] Add artifact invalidation on source delete
- [ ] Add structured ingestion coverage for `curated_memory`
- [ ] Add structured ingestion coverage for `file_doc`
- [ ] Add structured ingestion coverage for `telegram`
- [ ] Preserve explicit `workspace_id` / `project_id` and namespace assignment throughout ingest
- [ ] Propagate `classification`, `domain`, and `context_release_policy` into structured layers

## 14.3 Chunking and normalization

- [ ] Define `Chunker` interface
- [ ] Implement markdown chunker by heading hierarchy
- [ ] Implement plain-text chunker by paragraph/section boundaries
- [ ] Implement conversation chunker by turn windows
- [ ] Implement code-aware chunker with function/class boundaries where possible
- [ ] Store `section_path`, `chunk_kind`, `token_count`, and `language`
- [ ] Add chunk FTS sync
- [ ] Add chunk entity mention extraction
- [ ] Add chunk metadata for later evidence excerpts

## 14.4 Embedding and indexing

- [ ] Define embedding owner kinds: `artifact_chunk`, `fact`, `synthesis`
- [ ] Build embedding insert/update helpers
- [ ] Backfill embeddings for existing facts and syntheses
- [ ] Add query embedding path that searches all owner kinds
- [ ] Add content-hash-based re-embedding invalidation
- [ ] Track model name/version in embedding metadata
- [ ] Add re-embedding maintenance job
- [ ] Add embedding failure logging with retry semantics

## 14.5 Fact extraction and resolution

- [ ] Split extraction from resolution logic
- [ ] Keep current deterministic extractor as baseline
- [ ] Add optional extractor interface for future higher-quality local extraction
- [ ] Add `claim_key` generation
- [ ] Implement exact duplicate resolution
- [ ] Implement semantic update detection for selected fact kinds
- [ ] Implement `updates` relation creation
- [ ] Implement `extends` relation creation
- [ ] Keep `derives` disabled or low-trust by default
- [ ] Add support count updates from new evidence
- [ ] Decouple reinforcement from blind confidence inflation

## 14.6 Provenance

- [ ] Record source stream ID on every artifact, chunk, and evidence row
- [ ] Capture evidence spans/quotes where possible
- [ ] Add provenance inspection helper from fact -> evidence -> artifact -> source stream
- [ ] Add delete cascade logic
- [ ] Add source-trust aggregation logic for facts
- [ ] Add synthesis input lineage that can include facts and later chunks

## 14.7 Retrieval and ranking

- [ ] Add chunk FTS search function
- [ ] Add chunk semantic retrieval
- [ ] Replace legacy-only semantic retrieval in `search-service.ts`
- [ ] Add layer-aware candidate merging
- [ ] Add rank features: source trust, salience, latestness, evidence density, operator status
- [ ] Add duplicate suppression by `root_fact_id` and sibling chunks
- [ ] Add intent-specific layer priors
- [ ] Extend `RecallExplanation` to cover chunks and version chains
- [ ] Keep full feature breakdown available for operator debugging

## 14.8 Profile and synthesis layer

- [ ] Extend synthesis kinds with `profile_static` and `profile_dynamic`
- [ ] Build `profile_static` from durable identity/preference/procedure facts
- [ ] Build `profile_dynamic` from recent event/state/project facts
- [ ] Reuse summary/compaction infrastructure where helpful
- [ ] Add refresh triggers when durable facts change
- [ ] Add refresh triggers when recent-state windows roll over
- [ ] Add `getProfileContext()` API

## 14.9 Context assembly

- [ ] Create `context-assembler.ts`
- [ ] Implement per-intent budget templates
- [ ] Add provenance footer generation
- [ ] Add consumer-profile policy enforcement on context assembly
- [ ] Prefer concise facts over raw chunks by default
- [ ] Add audit mode that surfaces history and deeper evidence
- [ ] Add context assembly logging for golden tests

## 14.10 Background jobs and governance

- [ ] Replace confidence-decay maintenance with structured governance
- [ ] Implement TTL expiry job
- [ ] Implement stale marking job
- [ ] Implement synthesis refresh job
- [ ] Implement source delete cascade job
- [ ] Implement re-extraction job
- [ ] Implement re-embedding job
- [ ] Extend integrity checks for structured layers
- [ ] Extend memory audit to show structured counts and health

## 14.11 Configuration

- [ ] Add memory config for chunker versions
- [ ] Add config for embedding model/backend
- [ ] Add ranking weight config
- [ ] Add trust-tier defaults by source type/provider
- [ ] Add TTL defaults by source category
- [ ] Add profile refresh cadence config
- [ ] Add retrieval logging privacy config

## 14.12 Operator tooling

- [ ] Add CLI/API to inspect a source stream
- [ ] Add CLI/API to inspect a fact and its history
- [ ] Add CLI/API to pin/protect/forget
- [ ] Add CLI/API to override trust
- [ ] Add CLI/API to reindex a source
- [ ] Add CLI/API to re-embed a layer
- [ ] Add CLI/API to preview delete cascade impact
- [ ] Add inspector support for ranking trace IDs

## 14.13 Tests and docs

- [ ] Add schema migration tests
- [ ] Add retrieval golden tests
- [ ] Add chunker tests
- [ ] Add fact resolver tests
- [ ] Add delete cascade tests
- [ ] Add profile assembly tests
- [ ] Add structured-layer audit tests
- [ ] Update memory architecture docs
- [ ] Document migration/rollback procedure

---

## 15. Testing and validation strategy

## 15.1 Unit tests

Add focused unit tests for:

- `location.ts` behavior remains unchanged
- source stream stable-key resolution
- chunkers by content type
- fact `claim_key` generation
- update vs extend vs confirm logic
- provenance chain construction
- policy propagation
- TTL expiry logic
- duplicate suppression in context assembly

## 15.2 Retrieval quality tests

Create a local golden corpus containing:

- workspace docs
- curated markdown
- compaction summaries
- daily summaries
- coding-session notes
- conflicting preference updates
- transient state facts
- deleted-source scenarios

For each query, assert:
- relevant layer appears
- latest fact wins by default
- support chunk appears when needed
- deleted/forgotten objects do not appear
- policy-restricted material does not leak

## 15.3 Regression tests

Before rollout, capture current outputs for a set of representative queries. After each phase, compare:

- top 5 result set
- result-layer distribution
- latency
- recall explanation structure

## 15.4 Migration tests

Test migrations from:
- current schema with only legacy memories
- mixed schema with structured facts/syntheses already present
- DB with archived legacy rows
- DB with partially populated location fields

Assert:
- no data loss
- backfill idempotency
- old code paths still readable during rollout

## 15.5 Dedupe and update tests

Must cover:

- exact duplicate fact from second source
- new evidence reinforcing an existing fact
- changed preference creates new latest fact version
- extended detail creates `extends`, not replacement
- lower-trust summary does not replace higher-trust direct fact

## 15.6 Provenance tests

Assert:

- every fact has at least one valid evidence link
- every synthesis has valid inputs
- deleting a source invalidates unsupported facts
- lineage inspection can walk from synthesis to source stream

## 15.7 Performance tests

Run local performance tests for:

- large workspace-doc reindex
- mixed retrieval over facts + chunks + syntheses
- profile refresh job
- delete cascade on source streams with many chunks

Target:
- keep interactive search latency acceptable on a laptop-sized dataset
- chunk counts and embedding jobs should scale incrementally, not require full reindex on every change

## 15.8 Privacy and safety checks

Add tests to verify:

- denied/sensitive material is redacted before chunking/embedding
- `context_release_policy` blocks prohibited raw chunks
- forgotten/deleted objects do not appear in default recall
- retrieval logs can redact stored query text

## 15.9 Golden context-assembly cases

Create golden assembly outputs for:

- personal-profile question
- project-state question
- procedural question
- evidence/audit question
- recent temporal question
- deleted-source aftermath question

These are more valuable than pure search-result snapshots because Popeye is building an agent context system, not just a search endpoint.

---

## 16. Observability and diagnostics

## 16.1 What should be measurable

### Ingestion
- source streams discovered
- artifacts created
- unchanged source no-op rate
- chunk counts by source type
- fact extraction counts by fact kind
- synthesis refresh counts
- source delete cascades

### Resolution
- duplicate confirmations
- updates created
- extends relations created
- invalidations
- TTL expiries
- operator overrides

### Embeddings
- embeddings created by owner kind
- embedding failures by model/backend
- stale embeddings awaiting refresh
- re-embedding job durations

### Retrieval
- candidate counts by layer and stage
- final selected counts by layer
- hybrid vs lexical-only fallback cases
- score feature contributions
- latest-version suppression counts
- chunk sibling suppression counts

### Governance
- expired fact counts
- stale fact counts
- unsupported fact counts
- syntheses awaiting refresh
- orphan chunk or evidence counts

## 16.2 Ranking explanations

Extend current score explanations so an operator can inspect:

- semantic score
- lexical score
- trust score
- salience
- latestness
- evidence density
- location fit
- policy gates that excluded candidates

## 16.3 Operator debug surfaces

Recommended surfaces:

- `pop memory trace "<query>"`
- `pop memory inspect <fact-or-synthesis-id>`
- `pop memory source <source-stream-id>`
- `pop memory profile --workspace <id> [--project <id>]`
- `pop memory delete-preview <source-stream-id>`

Inspector UI later can mirror the same underlying APIs.

## 16.4 Existing Popeye diagnostic hooks to reuse

- `RecallExplanation`
- `getMemoryAudit()`
- `runIntegrityCheck()`

These should be extended rather than replaced.

---

## 17. Risks and tradeoffs

## 17.1 Where Supermemory ideas may not fit directly

### Graph complexity risk
Supermemory’s public framing emphasizes graph memory. Popeye should not rush into graph-traversal retrieval or a graph DB. A relation table is enough for the next several iterations.

### Multi-tenant abstractions
Container tags are weaker than Popeye’s location model. Flattening to tags would be a regression.

### Proxy-based memory routing
A transparent memory proxy would reduce operator visibility and complicate local-first guarantees.

## 17.2 Operational complexity risk

Adding source streams, chunks, versions, syntheses, and governance jobs increases complexity. The mitigation is:

- additive migrations
- phased rollout
- keep SQLite
- keep deterministic ranking first
- reuse current modules rather than rewriting everything

## 17.3 Over-engineering risk

The biggest over-engineering traps are:

- building a full knowledge graph too early
- adding inference memories before provenance and versioning are stable
- building a heavy local reranker before structured hybrid retrieval exists
- inventing a new queue system instead of using Popeye’s runtime jobs

## 17.4 Local-first performance constraints

Chunk search and embeddings will increase local storage and CPU usage.

Mitigations:
- incremental reindexing via source streams
- no-op update detection by content hash
- bounded chunk sizes
- background jobs for embeddings
- per-layer candidate caps before reranking

## 17.5 Migration hazards

- mixed legacy and structured retrieval during rollout
- duplicate memory objects after backfill
- stale legacy assumptions in downstream prompt code

Mitigations:
- keep legacy compatibility read path during transition
- add coverage metrics
- do not remove legacy search until structured hit quality is verified

## 17.6 Schema lock-in risk

Poor early choices around versioning or source identity could be sticky.

Mitigations:
- use additive fields (`root_fact_id`, `parent_fact_id`, `is_latest`)
- keep `memory_revisions` as a compatibility trail while moving to `memory_relations`
- do not overload one field with multiple meanings

## 17.7 Entity/graph complexity risk

Popeye already has a derived-first People graph outside the narrow memory layer. Duplicating a full person graph inside memory would create drift.

Mitigation:
- keep memory entities lightweight
- later link memory entities to People graph IDs instead of rebuilding identity semantics twice

## 17.8 Embedding drift risk

Changing embedding models can reorder retrieval results and destabilize tests.

Mitigations:
- model/version tracking in `memory_embeddings`
- explicit re-embedding jobs
- golden retrieval tests
- controlled rollout

## 17.9 Extraction quality risk

Current deterministic extraction is simple. Better versioning and chunking will help, but extraction quality will still matter.

Mitigation:
- extractor interface with deterministic baseline
- optional higher-quality local extractor later
- operator controls and provenance reduce damage from imperfect extraction

---

## 18. Final recommendation

## 18.1 Strongest recommended memory direction for Popeye

Popeye should become a **structured, provenance-first, local memory substrate** where:

- **source streams** define stable upstream identity
- **artifacts** store immutable normalized snapshots
- **chunks** make artifacts searchable and supportable
- **facts** are versioned, trust-aware, and evidence-backed
- **syntheses** materialize high-value summaries, especially static and dynamic profile
- **context assembly** is explicit and explainable
- **operator governance** can pin, protect, forget, delete, inspect, and reindex any memory object

This borrows the right lessons from Supermemory while preserving Popeye’s better local-first assumptions.

## 18.2 Minimum high-value upgrade set

If only a subset is built first, build this set:

1. `memory_source_streams`
2. `memory_artifact_chunks` + FTS
3. structured embeddings for chunks, facts, and syntheses
4. hybrid retrieval as default
5. fact version/latest semantics
6. `profile_static` and `profile_dynamic`
7. deletion cascade + structured governance jobs

That set alone materially improves recall quality, provenance, maintainability, and future extensibility.

## 18.3 Ideal longer-term architecture

Longer term, Popeye should converge on:

- structured layers as the only canonical memory path
- legacy `memories` retired from hot retrieval
- relation-aware fact history
- profile-backed personal context
- source-aware governance for email/calendar/files/repos/tasks
- optional richer local extraction and reranking
- operator-visible memory lineage for every durable claim

## 18.4 Bottom line

**What Supermemory is doing particularly well:** source-vs-memory separation, hybrid retrieval, profile materialization, update/latest history, and content-type-aware ingestion.

**What Popeye is currently missing:** canonical structured retrieval, searchable chunks, versioned facts, profile syntheses, source stream identity, and explicit TTL/freshness governance.

**What Popeye should adopt directly:** hybrid retrieval, static/dynamic profile, current/latest version semantics, TTL/forgetting, and source identity.

**What Popeye should adapt:** update/extend/derive relation semantics, content-type chunking, and simple memory APIs.

**What Popeye should reject:** tag-first scoping, hosted proxy memory routing, cloud-first connector assumptions, and opaque memory behavior.

The right build is not “copy Supermemory.” The right build is: **finish Popeye’s structured memory architecture using the best ideas Supermemory has already validated, but do it in a local-first, operator-controlled, SQLite-native way.**
