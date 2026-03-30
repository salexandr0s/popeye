# Memory Model

## Architecture

Popeye memory is now a **layered local-first system**:

- **Working/session context** — transient, engine-owned, not durable truth
- **Artifacts** — immutable source captures (receipts, compaction flushes, workspace docs, daily summaries)
- **Facts** — extracted atomic claims with temporal fields and evidence links
- **Syntheses** — evidence-backed higher-order summaries
- **Curated markdown** — operator-owned long-term memory files

Storage remains two-surface:

- **Markdown layer** (human-readable): curated files and `memory/daily/YYYY-MM-DD.md`
- **SQLite layer** (machine-queryable): legacy `memories` plus structured artifact/fact/synthesis tables

Popeye now also distinguishes **memory** from **recall**:

- **memory** = durable structured truth with provenance, confidence, and lifecycle controls
- **recall** = first-class retrieval over runtime history (receipts, run events, messages, ingress decisions, interventions) plus memory references

The new recall surface does not replace memory. Durable memory remains the
truth substrate; recall is the retrieval surface over what actually happened.

## Durable SQLite tables

### Compatibility / existing

- `memories`
- `memory_events`
- `memory_sources`
- `memory_consolidations`
- `memories_fts`
- `memory_entities`
- `memory_entity_mentions`
- `memory_summaries`
- `memory_summary_sources`

### Structured memory foundation

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

`memories` remains the compatibility layer while new ingestion dual-writes into artifacts/facts/syntheses.

For compatibility, legacy `memories.scope` remains present, but retrieval and
policy enforcement now use explicit memory location fields:

- `workspace_id`
- `project_id`

Location invariants:

- both `NULL` -> global
- `workspace_id != NULL`, `project_id = NULL` -> workspace-scoped
- both set -> project-scoped

Explicit location is the canonical authority for durable access decisions.
`scope` remains a compatibility and display field and is regenerated from
`workspace_id` / `project_id` when new records are written.

## Key semantics

### Memory axes

- **Type:** `episodic | semantic | procedural`
- **Layer:** `artifact | fact | synthesis | curated`

### Namespace model

Namespaces replace flat scope-only reasoning for structured memory. The legacy
compatibility layer also now stores explicit workspace/project location, so
project-aware retrieval no longer has to infer everything from a single scope
string.

Namespaces do not replace runtime access control. Agent-facing search,
describe, expand, explain, and budget-fit paths all apply the same explicit
location gate before returning durable memory.

Kinds:

- `global`
- `workspace`
- `project`
- `communications`
- `integration`

Tags are additive filters; they do not replace namespace isolation.

### Temporal model

Facts can store:

- `occurred_at`
- `valid_from`
- `valid_to`
- `created_at`
- `source_timestamp`

Recall prefers event/valid time when available instead of relying only on record creation time.

### Evidence model

- artifacts capture source content
- facts link back to artifacts via `memory_fact_sources`
- syntheses link back to facts via `memory_synthesis_sources`
- revisions record explicit fact-to-fact supersession/confirmation edges

## Ingestion

Current structured dual-write sources:

- **receipts** → artifact + facts
- **compaction flushes** → artifact + facts, plus project-state synthesis for summary rollups
- **workspace docs** → artifact + facts
- **daily summaries** → artifact + facts + daily synthesis

General flow:

```text
source input
  -> redact
  -> legacy memory write (compatibility)
  -> artifact capture
  -> fact extraction
  -> fact upsert + evidence links
  -> optional synthesis creation
```

## Retrieval

Retrieval is still local and deterministic.

### Candidate sources

- legacy `memories`
- `memory_facts`
- `memory_syntheses`

Artifacts remain read-by-ID evidence objects in this tranche; they participate
in describe/expand/explain flows and use the same location gate as other memory
layers.

### Query planning

For each query, Popeye derives:

- strategy (`factual`, `temporal`, `procedural`, `exploratory`)
- optional temporal constraint (for example `today`, `yesterday`, `last week`, `last month`, `recent`)
- requested layers / namespaces / tags
- superseded-record policy

### Ranking

Default ranking remains deterministic and explainable:

- relevance
- recency / temporal fit
- effective confidence
- location match / scope match
- optional entity boost

### Packaging

Results can expose:

- `layer`
- `namespaceId`
- temporal fields
- revision status
- evidence count

Recall explanations can include score breakdown plus evidence links.

## Unified recall surface

The runtime now exposes an additive unified recall substrate over real runtime
artifacts:

- `receipt`
- `run_event`
- `message`
- `message_ingress`
- `intervention`
- `memory`

Key properties:

- normalized result cards with source kind, source id, location, run/session
  references, snippet, and score
- deterministic ranking (source-local relevance, light recency normalization,
  scope fit)
- existing durable memory search reused for `memory` hits rather than creating a
  second truth store
- agent access remains scope-gated through execution envelopes
- no external search service and no silent memory mutation

### Location filtering

- project-scoped recall can see:
  - project-local records in the same workspace
  - workspace-shared records in the same workspace
  - global records only when `includeGlobal = true`
- project-scoped recall cannot see:
  - sibling projects
  - other workspaces
- `global` does not imply cross-workspace access; it only admits records whose
  explicit location is global

## Privacy and safety

- redaction still happens before durable writes
- structured memory respects namespace boundaries
- facts and syntheses remain inspectable and traceable
- curated memory remains operator-owned and explicit
- no mandatory external memory service is introduced

## Current phase state

Implemented now:

- structured schema + migrations
- dual-write foundation
- deterministic fact extraction
- daily/project-state syntheses for selected flows
- layered search over legacy memories, facts, and syntheses
- recall explanation with evidence links

Still intentionally deferred:

- full graph retrieval
- contradiction-heavy revision logic beyond supersession/confirmation
- automatic neural reranking in the hot path
- broad UI explorer surfaces
