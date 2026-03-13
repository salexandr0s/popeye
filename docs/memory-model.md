# Memory Model

## Architecture

Popeye's memory is a two-layer system:

- **Markdown layer** (human-readable): `MEMORY.md` (curated), `memory/daily/YYYY-MM-DD.md` (daily notes), workspace knowledge docs.
- **SQLite layer** (machine-queryable): `memory.db` containing `memories`, `memory_events`, `memory_embeddings` (sqlite-vec), `memory_sources`, `memory_consolidations`, `memories_fts` (FTS5), `memory_vec` (sqlite-vec).

## Memory Types

| Type | Description | Storage |
|---|---|---|
| Episodic | What happened — receipts, run events, conversation snapshots | SQLite |
| Semantic | What is known — extracted facts, preferences, decisions | SQLite + markdown |
| Procedural | How to do things — learned workflows, correction patterns | SQLite + markdown |

## Retrieval Pipeline

Two-stage hybrid search, target latency <200ms:

1. **Fast index:** FTS5 (lexical) + sqlite-vec (semantic) fired in parallel, results unioned.
2. **Rerank:** Weighted scoring formula:
   - 0.40 x relevance (max of FTS5 BM25 normalized rank and vector cosine similarity)
   - 0.25 x recency (exponential decay: `exp(-days/90)`)
   - 0.20 x confidence (confidence decay applied)
   - 0.15 x scope match (exact=1.0, global=0.7, other=0.1)
3. **Filter:** workspace/project scope, memory type, minimum confidence threshold.
4. **Package:** Descriptions first (progressive disclosure), full content on demand via `includeContent`.

### Search Modes

- **hybrid**: Both FTS5 and sqlite-vec available. Best quality.
- **fts_only**: sqlite-vec not loaded. Lexical search only.
- **vec_only**: FTS5 empty but vectors available. Rare.

## Confidence Decay

Memories decay in confidence without reinforcement:

```
newConfidence = initialConfidence x 0.5^(daysSinceLastReinforcement / halfLifeDays)
```

Default half-life: 30 days. Configurable via `memory.confidenceHalfLifeDays`.

Memories below the archive threshold (default 0.1) are archived — excluded from search but not deleted.

## Deduplication

Every memory gets a dedup key: `sha256(scope:description:content[0:500])`. If a new memory matches an existing dedup key, the existing memory is reinforced (confidence boosted) instead of creating a duplicate.

## Consolidation

Periodic consolidation merges redundant memories:

1. **Exact dedup:** Same `dedup_key` (race condition cleanup). Keeps highest confidence.
2. **Text overlap:** Jaccard token similarity > 0.8. Merges content, keeps higher confidence.

Consolidation preserves provenance through `memory_consolidations` records.

## Lifecycle

1. **Capture** — Automatic extraction from receipts at run end.
2. **Daily summaries** — Generated at configured hour for previous day's activity.
3. **Compaction flush** — Runtime intercepts Pi compaction events, extracts memories before context loss.
4. **Decay** — Daily confidence decay reduces stale memory scores.
5. **Consolidation** — Daily merge of redundant memories.
6. **Promotion** — Explicit promotion to curated markdown files requires diff review and receipt.
7. **Archive** — Low-confidence memories archived (excluded from search, not deleted).

## Redaction

All memory content is redacted before storage using `redactText()`. Sensitive patterns (API keys, tokens, PEM blocks, JWTs) are replaced with redaction markers.

## Configuration

```json
{
  "memory": {
    "confidenceHalfLifeDays": 30,
    "archiveThreshold": 0.1,
    "dailySummaryHour": 23,
    "consolidationEnabled": true,
    "compactionFlushConfidence": 0.7
  },
  "embeddings": {
    "provider": "disabled",
    "model": "text-embedding-3-small",
    "dimensions": 1536
  }
}
```

Set `embeddings.provider` to `"openai"` and provide `OPENAI_API_KEY` env var to enable vector search.
