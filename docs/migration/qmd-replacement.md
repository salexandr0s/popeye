# QMD to Popeye Memory Migration

## QMD architecture

QMD is a hybrid search tool over markdown directories:
- BM25 full-text search
- Vector search (embeddings)
- LLM reranking for final ordering
- Operates on raw markdown files in configured directories

## Popeye replacement

Popeye replaces QMD with `memory.db`, a SQLite database containing:

| Table | Purpose |
|---|---|
| `memories` | Core memory records with type, content, confidence, provenance |
| `memories_fts` | FTS5 virtual table for lexical search |
| `memory_vec` | sqlite-vec table for semantic vector search |
| `memory_sources` | Provenance tracking (source run, timestamp) |
| `memory_events` | Memory lifecycle events |
| `memory_consolidations` | Merge/decay tracking |

## Key differences

| Aspect | QMD | Popeye memory |
|---|---|---|
| Storage | Markdown files | SQLite tables |
| Search | BM25 + vector + LLM rerank | FTS5 + sqlite-vec + scoring rerank |
| Structure | Raw documents | Typed records with metadata |
| Provenance | None | Source run, timestamp, confidence |
| Confidence | None | Score with decay over time |
| Dedup | None | Dedup keys prevent redundancy |
| Scope | Collection-based | Workspace/project/global |

## Migration path

1. **Export from QMD** — use `qmd search "*" -c <collection>` for each collection
2. **Classify** — sort into memory types: semantic, procedural, or episodic
3. **Insert through runtime API** — use `/v1/memory` endpoints with type and classification
4. **Verify retrieval** — test with `pop memory search <query>`

## What is lost

- LLM reranking (Popeye uses scoring-function rerank for <200ms latency)
- Direct markdown file editing (memories are DB records)
- Collection-based organization (replaced by workspace/project scoping)
