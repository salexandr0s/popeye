# @popeye/memory

Memory policy, retrieval, and storage for the Popeye platform. Implements the
two-stage hybrid search pipeline (FTS5 + sqlite-vec) with scoring, reranking,
and confidence decay.

## Purpose

Provides the complete memory subsystem: pure policy functions for embedding
eligibility, confidence decay, memory classification, and dedup key computation;
FTS5 full-text search; sqlite-vec semantic vector search; a scoring/reranking
pipeline that merges results from both indexes; and `MemorySearchService` which
orchestrates search, storage, embedding, and maintenance operations against
SQLite.

## Layer

Runtime domain. Pure policy functions have no I/O; search and storage modules
operate on `better-sqlite3` database handles.

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
| `shouldArchive()`               | Check if confidence is below archive threshold      |
| `buildFts5MatchExpression()`    | Sanitize user query into FTS5 match expression      |
| `normalizeRelevanceScore()`     | Normalize FTS5 rank to 0-1 range                    |
| `computeRecencyScore()`         | Exponential recency decay score                     |
| `renderDailySummaryMarkdown()`  | Render daily activity summary as markdown           |

### Search pipeline

| Export                  | Description                                          |
| ----------------------- | ---------------------------------------------------- |
| `MemorySearchService`   | Orchestrates hybrid search, storage, and embedding   |
| `searchFts5()`          | FTS5 full-text search with scope/type/confidence filters |
| `searchVec()`           | sqlite-vec cosine similarity search                  |
| `rerankAndMerge()`      | Merge FTS5+vec candidates with relevance/recency/confidence/scope scoring |
| `loadSqliteVec()`       | Load the sqlite-vec extension into a database handle |

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

const service = new MemorySearchService({ db, embeddingClient, vecAvailable: true });
const results = await service.search({ query: 'auth decisions', limit: 10 });
```

See `src/*.test.ts` for tests covering FTS5 search, vec search, scoring,
embedding eligibility, confidence decay, and the full search service.
