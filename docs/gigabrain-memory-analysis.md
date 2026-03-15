# Gigabrain Memory System — Adoption Analysis for Popeye

**Date:** 2026-03-15
**Source:** [legendaryvibecoder/gigabrain](https://github.com/legendaryvibecoder/gigabrain) v0.5.3
**Purpose:** Evaluate which components from gigabrain's memory system Popeye should inherit, adapt, or skip.

---

## 1. System Comparison at a Glance

| Aspect | Popeye | Gigabrain |
|---|---|---|
| Language | TypeScript (strict) | JavaScript (Node 22) |
| SQLite binding | better-sqlite3 (assumed) | `node:sqlite` (experimental) |
| Vector search | sqlite-vec + OpenAI embeddings (1536d) | None — pure lexical |
| Full-text search | FTS5 | FTS5 |
| Retrieval strategy | Two-stage: FTS5 + vec, then 4-factor rerank | Multi-stage: FTS5 + Jaccard similarity, strategy-based rerank |
| Memory types | 3 (episodic, semantic, procedural) | 7 (USER_FACT, PREFERENCE, DECISION, ENTITY, EPISODE, AGENT_IDENTITY, CONTEXT) |
| Capture method | Automatic extraction from receipts/compaction | Agent emits `<memory_note>` XML tags + "remember this" intent detection |
| Lifecycle | Decay + consolidation + promotion | Nightly maintenance pipeline (20+ stages) |
| Confidence decay | Yes (half-life model) | No (recency in scoring, but no automatic decay) |
| World model | No | Yes (entities, beliefs, episodes, open loops, contradictions, syntheses) |
| External deps | OpenAI for embeddings | None for core (Ollama optional) |
| Integration modes | Daemon control API | OpenClaw plugin, MCP server, Obsidian vault |

---

## 2. Components Worth Inheriting

### 2.1 Orchestrator Strategy Selection — STRONG CANDIDATE

**What it is:** Before recall, gigabrain classifies the query intent and selects a retrieval strategy: `quick_context`, `entity_brief`, `timeline_brief`, `relationship_brief`, or `verification_lookup`. Each strategy changes which memories are prioritized and how results are filtered.

**Why Popeye should consider it:** Popeye currently runs a single retrieval pipeline regardless of query type. A "what is X?" question and a "what happened last Tuesday?" question go through the same scoring. Strategy selection would let Popeye weight recency heavily for timeline queries, entity-match for entity queries, etc.

**Adoption path:** New platform implementation. Build a lightweight intent classifier (regex-based like gigabrain, or keyword heuristic) that adjusts the scoring weights in `scoring.ts` rather than having fixed weights (0.40/0.25/0.20/0.15).

**Risk:** Moderate complexity increase. Keep strategies to 3-4 max initially.

---

### 2.2 Entity Mention Tracking — STRONG CANDIDATE

**What it is:** Gigabrain extracts entity mentions (people, projects, organizations) from memories via `person-service.js`, stores them in `memory_entity_mentions`, and uses entity resolution during recall to boost entity-relevant results.

**Why Popeye should consider it:** Popeye has no entity awareness. Queries like "what does Alex prefer?" cannot leverage entity-scoped retrieval. Entity tracking would significantly improve recall precision for person- and project-oriented queries.

**Adoption path:** New platform implementation inspired by gigabrain's concept. Add a `memory_entities` table and `memory_entity_mentions` junction table. Extract entities during capture (simple NER or pattern matching). Use entity match as a scoring boost factor in the reranker.

**Risk:** Entity extraction quality can be noisy. Start with explicit mentions only (proper nouns, @-references) rather than full NER.

---

### 2.3 Query Sanitization — ADOPT

**What it is:** Before recall, gigabrain strips prior `<gigabrain-context>` blocks, metadata prefixes, and transcript noise from the query. This prevents the retrieval system from matching on its own injected context.

**Why Popeye should consider it:** If Popeye injects memory context into prompts, subsequent compaction or re-queries could match on the injected context itself, creating feedback loops. Query sanitization is a cheap safeguard.

**Adoption path:** Thin utility function in `@popeye/memory`. Strip any prior memory injection blocks before search.

**Risk:** Minimal. Pure improvement.

---

### 2.4 Budget Allocation for Recall Results — CONSIDER

**What it is:** Gigabrain allocates a fixed token budget across result classes (core 45%, situational 30%, decisions 25%) to ensure diversity in recalled memories rather than returning N results of the same type.

**Why Popeye should consider it:** Popeye returns top-N by score, which could cluster around a single memory type. Budget allocation ensures the agent gets a mix of facts, context, and decisions.

**Adoption path:** Post-rerank diversification step in `search-service.ts`. Group results by `memoryType`, allocate slots proportionally.

**Risk:** Low. Could be added as an optional mode without changing the default pipeline.

---

### 2.5 Junk Filtering / Quality Gates on Capture — ADOPT

**What it is:** Before storing a memory, gigabrain runs it through junk filters (system prompt fragments, API keys, benchmark artifacts blocked by regex) and plausibility heuristics (broken phrases, entityless numeric facts).

**Why Popeye should consider it:** Popeye has redaction (strips secrets) but limited quality gating. Compaction flush content may include low-value noise that becomes a permanent memory. Quality gates would reduce memory pollution.

**Adoption path:** Extend `pure-functions.ts` with content quality checks. Popeye already has redaction patterns — add heuristic filters for trivially useless content (single-word memories, pure code snippets without context, system prompt echoes).

**Risk:** Overly aggressive filtering could drop valid memories. Start conservative with high-precision patterns.

---

### 2.6 Weighted Jaccard Similarity (for Non-Embedding Fallback) — CONSIDER

**What it is:** Gigabrain's core similarity uses a four-component weighted Jaccard: word tokens (0.35), character trigrams (0.25), numeric tokens (0.20), semantic anchors (0.20). No embeddings required.

**Why Popeye should consider it:** Popeye falls back to FTS5-only mode when sqlite-vec is unavailable or embeddings are disabled. In that degraded mode, search quality drops to raw BM25 ranking. Jaccard similarity would provide a meaningful semantic signal without requiring any external service.

**Adoption path:** Implement as an alternative scorer in `fts5-search.ts` or a new `jaccard-search.ts` module. Use when `embeddings.provider === "disabled"`.

**Risk:** Jaccard is CPU-bound and O(n) over all memories for pairwise comparison. Gigabrain mitigates this by using FTS5 as a candidate generator first, then scoring candidates with Jaccard — Popeye should do the same.

---

### 2.7 Durable Pattern Detection — CONSIDER

**What it is:** Gigabrain identifies "durable" memories — facts likely to remain true long-term (names, birthdays, relationships, chronic conditions, professional roles) — and boosts them in recall scoring (+0.18). Detection uses regex patterns for temporal stability indicators.

**Why Popeye should consider it:** Popeye's confidence decay treats all memories equally. A user's birthday and a transient debugging note both decay at the same rate. Durable pattern detection could exempt stable facts from aggressive decay or give them a scoring boost.

**Adoption path:** Add a `durable` boolean to `MemoryRecord`. Set during capture via pattern matching. Adjust decay: durable memories get a much longer half-life (or no decay). Add a scoring boost in `scoring.ts`.

**Risk:** Low. The pattern list needs curation but the concept is sound.

---

## 3. Components to Adapt Carefully

### 3.1 World Model (Entities, Beliefs, Episodes, Open Loops, Contradictions)

**What it is:** Gigabrain projects atomic memories into higher-level structures: entities with aliases and mention counts, beliefs with confidence, time-bound episodes, unresolved questions (open loops), conflicting beliefs (contradictions), and reusable briefing syntheses.

**Why it's tempting:** The world model provides a structured knowledge graph over raw memories. It enables questions like "what do I believe about X?" or "what contradictions exist?" and powers richer recall strategies.

**Why to be careful:** This is gigabrain's most complex subsystem. It requires entity extraction, belief derivation, contradiction detection, and synthesis generation — each a non-trivial NLP task. Gigabrain uses optional LLM calls (Ollama) for some of these. Porting this wholesale would violate Popeye's rule 12 ("prefer deletion and omission over speculative complexity").

**Recommendation:** Do not port the full world model now. Instead:
1. Start with entity tracking (section 2.2 above) as the foundation
2. Add belief extraction later if entity tracking proves valuable
3. Consider contradiction detection only when there's a concrete operator workflow that needs it
4. Open loops are interesting but overlap with Popeye's task/job model — evaluate overlap first

---

### 3.2 Nightly Maintenance Pipeline

**What it is:** Gigabrain runs a 20+ stage maintenance pipeline: snapshot, sync, quality sweep, dedup, entity refresh, belief refresh, episode refresh, contradiction detection, synthesis build, briefing build, archive compression, vacuum, vault build, graph build.

**Why to be careful:** Popeye already has consolidation (exact dedup + text overlap) and confidence decay. Gigabrain's pipeline is far more elaborate but also tightly coupled to its world model. Many stages (belief refresh, synthesis build, vault build) are gigabrain-specific.

**Recommendation:** Cherry-pick individual stages rather than porting the pipeline concept:
- **Quality sweep** (reclassify and archive low-value memories) — worth adding to Popeye's existing consolidation
- **Backup rotation** (emergency snapshots before destructive operations) — good operational hygiene, easy to add
- **FTS5 rebuild after VACUUM** — technical best practice, adopt
- Skip: vault build, graph build, briefing build (these serve gigabrain's Obsidian integration)

---

### 3.3 Native Markdown Sync + Promotion

**What it is:** Gigabrain indexes markdown files into `memory_native_chunks` (SQLite), then promotes durable bullets from native markdown into the structured registry.

**Why to be careful:** Popeye already has workspace doc indexing (`indexWorkspaceDocs`) and a promotion flow (propose → approve → execute with diff + receipt). The concepts overlap but the implementations diverge. Gigabrain's native sync is bidirectional (markdown ↔ SQLite), while Popeye's is unidirectional (markdown → SQLite for search, explicit promotion for curated writes).

**Recommendation:** Popeye's existing approach is cleaner and more aligned with its "operator-owned critical files" principle. Do not adopt gigabrain's bidirectional sync. However, consider gigabrain's chunking strategy if Popeye's workspace doc indexing handles large files poorly.

---

## 4. Components to Skip

### 4.1 `<memory_note>` XML Tag Capture — SKIP

**Why:** Gigabrain relies on agents emitting structured `<memory_note>` tags in their output. This requires modifying agent system prompts and creates coupling between the memory system and prompt engineering. Popeye's approach (extracting from receipts and compaction events) is more transparent and doesn't require agent cooperation.

---

### 4.2 "Remember This" Intent Detection — SKIP

**Why:** Regex-based detection of phrases like "remember that I..." is fragile and prone to false positives. Popeye's compaction flush approach captures important context without requiring explicit user commands. If explicit memory storage is needed, Popeye's `POST /v1/memory/import` endpoint already serves this purpose.

---

### 4.3 No-Embedding Architecture — SKIP (as primary strategy)

**Why:** Gigabrain deliberately avoids vector embeddings, relying entirely on lexical search + Jaccard similarity. While this is simpler and has zero external dependencies, Popeye has already committed to sqlite-vec + OpenAI embeddings as a resolved technical decision (CLAUDE.md section 3). Semantic search via embeddings will outperform lexical-only for conceptually similar but lexically different queries.

**However:** Gigabrain's Jaccard approach is worth adopting as a fallback (section 2.6) for when embeddings are disabled.

---

### 4.4 `node:sqlite` Experimental API — SKIP

**Why:** Gigabrain uses Node.js's experimental built-in `node:sqlite` (DatabaseSync). This is an unstable API that could break across Node versions. Popeye should stick with its existing SQLite binding which is mature and well-tested.

---

### 4.5 Obsidian Vault Mirror — SKIP

**Why:** Gigabrain builds a read-only Obsidian vault from memory data for visualization. Popeye has a web inspector that serves this purpose. Building an Obsidian integration would be speculative complexity with no concrete operator need.

---

### 4.6 MCP Server Mode — SKIP (for now)

**Why:** Gigabrain exposes memory tools via Model Context Protocol for Claude/Codex integration. Popeye's architecture routes everything through the control API with auth + CSRF. An MCP interface would be a separate integration surface. Not needed until there's a concrete requirement.

---

### 4.7 Review Queue (JSONL) — SKIP

**Why:** Gigabrain has a JSONL-based review queue for borderline captures. Popeye's promotion flow (propose → approve → execute) already handles the "human in the loop" need for curated memory. A separate review queue adds complexity without clear value.

---

## 5. Priority Ranking

If adopting gigabrain-inspired improvements, suggested order:

| Priority | Component | Effort | Impact |
|---|---|---|---|
| 1 | Query sanitization | Low | Prevents feedback loops |
| 2 | Junk filtering / quality gates | Low | Reduces memory pollution |
| 3 | Entity mention tracking | Medium | Major recall precision improvement |
| 4 | Durable pattern detection | Low | Better decay behavior |
| 5 | Orchestrator strategy selection | Medium | Smarter retrieval per query type |
| 6 | Budget allocation for results | Low | Better result diversity |
| 7 | Jaccard similarity fallback | Medium | Better degraded-mode search |
| 8 | Quality sweep in consolidation | Low | Better memory hygiene |

---

## 6. Key Takeaways

1. **Gigabrain's strongest innovation is its recall pipeline** — strategy selection, entity resolution, multi-factor scoring with type-intent boosts, and budget allocation. Popeye's retrieval is simpler and would benefit from selective adoption of these ideas.

2. **Gigabrain proves lexical-only search can work well** with enough scoring sophistication. Popeye should ensure its FTS5-only fallback mode is robust, possibly incorporating Jaccard similarity.

3. **Gigabrain's capture model (XML tags) is worse than Popeye's** (automatic extraction). Popeye's approach is less intrusive and doesn't require agent prompt modification.

4. **Gigabrain's world model is ambitious but premature for Popeye.** Entity tracking is the valuable foundation; the rest (beliefs, contradictions, syntheses) should wait for concrete operator need.

5. **Gigabrain has no confidence decay**, which means stale memories persist at full strength indefinitely. Popeye's half-life decay model is superior for long-running systems.

6. **Both systems share the same core philosophy**: local-first, SQLite-based, FTS5 for search, markdown for human readability, operator control over curated knowledge. The alignment makes selective adoption natural.

---

## 7. Popeye Rules Compliance Notes

Per CLAUDE.md section 8 (OpenClaw rules, applicable to any donor system):

- **Need it now?** Items in priority 1-2 address active quality issues. Items 3-5 address recall precision gaps.
- **Pi equivalent?** None of these are engine-level concerns — all belong in the runtime layer.
- **Thin slice?** All recommendations above are thin concepts, not code ports.
- **Contamination risks:** Low — gigabrain's JavaScript codebase shares no code with Popeye. Risk is conceptual drift toward gigabrain's world-model complexity. Mitigate by adopting only what has a concrete operator workflow.

**Classification for any adopted concepts:** OpenClaw donor concept (adapted idea) or New platform implementation (inspired by, but rebuilt fresh).
