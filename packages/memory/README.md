# @popeye/memory

Memory policy, retrieval, and storage for the Popeye platform. Implements a
structured memory pipeline with FTS5 search, scoring, reranking, and
confidence decay.

## Purpose

Provides the complete memory subsystem: pure policy functions for embedding
eligibility, confidence decay, memory classification, and dedup key computation;
FTS5 full-text search across facts, syntheses, and chunks; a scoring/reranking
pipeline; and `MemorySearchService` which orchestrates search operations against
SQLite.

## Layer

Runtime domain. Pure policy functions have no I/O; search modules operate on
`better-sqlite3` database handles.

## Provenance

New platform implementation.

## Key exports

### Pure functions (`pure-functions.ts`)

| Export                          | Description                                        |
| -------------------------------- | -------------------------------------------------- |
| `decideEmbeddingEligibility()`  | Check if a memory qualifies for vector storage     |
| `computeConfidenceDecay()`      | Time-based exponential confidence decay             |
| `classifyMemoryType()`          | Classify as episodic, semantic, or procedural       |
| `computeDedupKey()`             | SHA-256 dedup key from description+content+scope    |
| `buildFts5MatchExpression()`    | Sanitize user query into FTS5 match expression      |
| `normalizeRelevanceScore()`     | Normalize FTS5 rank to 0-1 range                    |
| `computeRecencyScore()`         | Exponential recency decay score                     |
| `renderDailySummaryMarkdown()`  | Render daily activity summary as markdown           |
| `assessMemoryQuality()`        | Quality gate for memory content                     |

### Search pipeline

| Export                    | Description                                          |
| ------------------------- | ---------------------------------------------------- |
| `MemorySearchService`     | Orchestrates FTS5 search with scoring and reranking  |
| `searchFactsFts5()`       | FTS5 search over `memory_facts`                      |
| `searchSynthesesFts5()`   | FTS5 search over `memory_syntheses`                  |
| `searchChunksFts5()`      | FTS5 search over `memory_artifact_chunks`            |
| `rerankAndMerge()`        | Score and rank candidates by relevance/recency/confidence/scope |
| `loadSqliteVec()`         | Load the sqlite-vec extension into a database handle |

### Structured memory

| Export                    | Description                                          |
| ------------------------- | ---------------------------------------------------- |
| `captureArtifact()`       | Store a raw memory artifact                          |
| `extractFacts()`          | Extract atomic facts from content                    |
| `upsertFacts()`           | Insert or update facts with dedup                    |
| `createSynthesis()`       | Create a synthesis (daily summary, project state)    |
| `recallContext()`         | Token-budgeted context assembly for agent prompts    |

### Embedding

| Export                            | Description                               |
| --------------------------------- | ----------------------------------------- |
| `createOpenAIEmbeddingClient()`   | OpenAI text-embedding-3-small client      |
| `createDisabledEmbeddingClient()` | No-op client when embeddings are disabled |

## Dependencies

- `@popeye/contracts` -- `EmbeddingEligibility`, `DataClassification`
- `@popeye/observability` -- `sha256` for dedup keys, `redactText` for content redaction

## Usage

```ts
import { MemorySearchService, createOpenAIEmbeddingClient } from '@popeye/memory';

const service = new MemorySearchService({ db, embeddingClient });
const results = await service.search({ query: 'auth decisions', limit: 10 });
```

See `src/*.test.ts` for tests covering FTS5 search, scoring, embedding
eligibility, confidence decay, and the full search service.
