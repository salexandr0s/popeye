# Coding Agent Memory Extension Plan

**Status:** Draft
**Author:** Agent-assisted
**Date:** 2026-03-21
**Classification:** New platform implementation
**Layer:** Runtime (memory subsystem) + Interface (coding agent bridge)

---

## 1. Problem

We use multiple coding agents (Claude Code, Codex, etc.) daily across projects.
Their memory is currently .md files + qmd search — disconnected from Popeye's
structured SQLite memory system. This means:

- No shared recall between assistant and coding agents
- No confidence decay, dedup, or evidence linking for coding knowledge
- No hybrid search (FTS5 + vector) over coding patterns
- Duplicate effort: assistant learns something about code, coding agent can't see it, and vice versa

## 2. Goal

Extend the existing memory system so that coding agents can read and write to
the same DB, filtered to coding-relevant memories by default, without polluting
the assistant agent's context with noise.

**Not** a new memory system. Not a new DB. Not a new search pipeline. Just new
enum values, a consumer profile convention, and an ingestion bridge.

---

## 3. Design Principles

1. **Single DB, filtered views** — no sync, no duplication
2. **Additive schema changes only** — new enum values, no table changes
3. **Convention over configuration** — consumer profiles are query defaults, not enforcement
4. **Cross-pollination by opt-in** — either consumer can widen its filter when needed
5. **Existing pipeline unchanged** — FTS5, sqlite-vec, scoring, decay, consolidation all work as-is

---

## 4. Schema Changes

### 4.1 Domain kind

**File:** `packages/contracts/src/domain.ts`

Add `coding` to `DomainKindSchema`:

```typescript
export const DomainKindSchema = z.enum([
  'general', 'email', 'calendar', 'todos', 'github',
  'files', 'people', 'finance', 'medical',
  'coding',  // NEW
]);
```

Domain policy:

```typescript
coding: {
  domain: 'coding',
  sensitivity: 'internal',
  embeddingPolicy: 'full',
  contextReleasePolicy: 'full',
},
```

Rationale: coding knowledge is not sensitive (no PII, no financial data).
Full embedding and full context release — we want maximum recall.

### 4.2 Namespace kind

**File:** `packages/contracts/src/memory.ts`

Add `coding` to `MemoryNamespaceKindSchema`:

```typescript
export const MemoryNamespaceKindSchema = z.enum([
  'global', 'workspace', 'project', 'communications', 'integration',
  'coding',  // NEW
]);
```

Auto-created per workspace on first coding-agent write (same pattern as
`communications` namespace for Telegram).

### 4.3 Source types

**File:** `packages/contracts/src/memory.ts`

Add coding-specific source types to `MemorySourceTypeSchema`:

```typescript
export const MemorySourceTypeSchema = z.enum([
  'receipt', 'telegram', 'daily_summary', 'curated_memory',
  'workspace_doc', 'compaction_flush', 'capability_sync',
  'context_release', 'file_doc',
  'coding_session',   // NEW — end-of-session summary from coding agent
  'code_review',      // NEW — review findings, patterns noticed
  'debug_session',    // NEW — root cause analysis, fix patterns
]);
```

### 4.4 No new tables, no new columns

Everything fits in existing schema:

| Existing field | Coding agent usage |
|---|---|
| `domain` | `'coding'` |
| `namespace_id` | points to `coding` namespace |
| `source_type` | `coding_session` / `code_review` / `debug_session` |
| `memory_type` | `procedural` (patterns), `semantic` (facts), `episodic` (events) |
| `fact_kind` | `procedure` / `preference` / `state` / `event` |
| `tags` | freeform: `typescript`, `debugging`, `architecture`, `pattern`, `tool-preference` |
| `workspace_id` / `project_id` | scoped to the project being worked on |
| `confidence` | set by ingestion heuristic |
| `durable` | `true` for explicitly promoted patterns |

---

## 5. Consumer Profiles

A consumer profile is a set of **query defaults** applied at the search API
layer. Not a permission boundary — just sensible defaults to reduce noise.

### 5.1 Profile definition

**File:** `packages/memory/src/consumer-profiles.ts` (new, ~40 lines)

```typescript
import type { DomainKind, MemoryNamespaceKind } from '@popeye/contracts';

export interface ConsumerProfile {
  id: string;
  label: string;
  /** Namespaces included by default */
  defaultNamespaceKinds: MemoryNamespaceKind[];
  /** Domains included by default */
  defaultDomains: DomainKind[];
  /** Domains excluded by default (overrides include) */
  excludedDomains: DomainKind[];
  /** Whether to include global memories by default */
  includeGlobal: boolean;
}

export const CONSUMER_PROFILES: Record<string, ConsumerProfile> = {
  assistant: {
    id: 'assistant',
    label: 'Popeye Assistant',
    defaultNamespaceKinds: ['global', 'workspace', 'project', 'communications', 'integration'],
    defaultDomains: [],  // all
    excludedDomains: ['coding'],  // exclude coding noise by default
    includeGlobal: true,
  },
  coding: {
    id: 'coding',
    label: 'Coding Agent',
    defaultNamespaceKinds: ['coding', 'workspace', 'project', 'global'],
    defaultDomains: ['coding', 'general', 'github'],
    excludedDomains: ['email', 'calendar', 'finance', 'medical', 'people'],
    includeGlobal: true,
  },
};
```

### 5.2 Profile resolution

When a search request arrives at the control API:

1. Check for `X-Consumer-Profile` header (value: `assistant` | `coding` | absent)
2. If present, merge profile defaults into query params (query params override profile)
3. If absent, no filtering — raw search, caller controls everything

This is **not** auth. The auth token is still required. The profile header is a
convenience that sets sensible defaults. A coding agent can always pass explicit
`namespaceIds` or `domains` to override.

### 5.3 Search service changes

**File:** `packages/memory/src/search-service.ts`

Add a `applyConsumerProfile(query, profile)` function that:

1. If `query.namespaceIds` is empty, resolve profile's `defaultNamespaceKinds` to actual namespace IDs
2. If `query.domains` is empty (new optional field on `MemorySearchQuerySchema`), apply profile's `defaultDomains`
3. Filter out `excludedDomains` unless explicitly included in the query
4. Set `includeGlobal` from profile if not specified in query

The existing rerank/merge/filter pipeline is untouched.

### 5.4 Search query schema extension

**File:** `packages/contracts/src/memory.ts`

Add optional `domains` filter to `MemorySearchQuerySchema`:

```typescript
export const MemorySearchQuerySchema = z.object({
  // ... existing fields ...
  domains: z.array(DomainKindSchema).optional(),       // NEW
  consumerProfile: z.string().optional(),               // NEW — alternative to header
});
```

And add `domain` to `MemorySearchResultSchema` so callers can see it:

```typescript
export const MemorySearchResultSchema = z.object({
  // ... existing fields ...
  domain: DomainKindSchema.optional(),                  // NEW
});
```

---

## 6. Ingestion Bridge

### 6.1 How coding agents write memories

Coding agents write via the existing control API. No new endpoints needed.

**Primary path:** `POST /v1/memory/import`

```json
{
  "sourceType": "coding_session",
  "domain": "coding",
  "workspaceId": "popeye",
  "projectId": "popeye",
  "classification": "internal",
  "memories": [
    {
      "description": "Vitest mock pattern for SQLite in-memory DBs",
      "content": "Use better-sqlite3 in :memory: mode with the same migration runner...",
      "memoryType": "procedural",
      "factKind": "procedure",
      "confidence": 0.8,
      "tags": ["testing", "vitest", "sqlite", "pattern"],
      "durable": true
    },
    {
      "description": "runtime-service.ts has a circular dep risk with memory-lifecycle.ts",
      "content": "Both import each other indirectly through...",
      "memoryType": "semantic",
      "factKind": "state",
      "confidence": 0.7,
      "tags": ["architecture", "risk"]
    }
  ]
}
```

The import endpoint already exists. We just need to:

1. Accept `domain` field on import (currently not passed through — ~5 line change)
2. Auto-create `coding` namespace for the workspace if it doesn't exist
3. Tag with source type

### 6.2 Automatic ingestion (future, not in v1)

Later, we could add hooks so that coding agents automatically flush session
learnings at end-of-session. For now, explicit import is sufficient.

Possible future hooks:
- Claude Code `/handoff` skill writes to Popeye memory
- Post-commit hook extracts patterns from diff + commit message
- Debug session auto-captures root cause + fix pattern

### 6.3 Migration of existing .md memories

One-time bulk import:

```bash
pop memory import-dir ~/path/to/md/memories \
  --source-type workspace_doc \
  --domain coding \
  --tags coding,migrated \
  --workspace popeye
```

This can use the existing `/v1/memory/import` endpoint in a loop. No new CLI
command strictly needed, but a convenience wrapper would be nice.

---

## 7. Retrieval Flow (By Consumer)

### 7.1 Coding agent queries

```
GET /v1/memory/search?query=vitest+mock+pattern&consumerProfile=coding
```

Resolves to:
- Namespaces: `coding`, `workspace`, `project`, `global`
- Domains: `coding`, `general`, `github`
- Excluded: `email`, `calendar`, `finance`, `medical`, `people`

Returns coding patterns, project state facts, general knowledge. Does NOT
return personal email summaries, calendar events, financial records.

### 7.2 Assistant agent queries

```
GET /v1/memory/search?query=what+did+we+work+on+yesterday
```

Resolves to (default assistant profile):
- Namespaces: `global`, `workspace`, `project`, `communications`, `integration`
- Domains: all except `coding`

Returns daily summaries, communication logs, project state. Does NOT return
coding patterns or debug sessions.

### 7.3 Cross-pollination (explicit)

Assistant gets a code question:

```
GET /v1/memory/search?query=auth+middleware+pattern&consumerProfile=assistant&domains=coding,general
```

Explicitly includes `coding` domain — overrides the default exclusion.

Coding agent needs project context:

```
GET /v1/memory/search?query=project+goals&consumerProfile=coding&domains=general,todos
```

Explicitly includes `todos` domain.

---

## 8. Implementation Steps

### Phase 1: Schema extension (~30 min)

| # | Task | File(s) | Lines |
|---|------|---------|-------|
| 1.1 | Add `coding` to `DomainKindSchema` | `packages/contracts/src/domain.ts` | +1 |
| 1.2 | Add `coding` domain policy defaults | `packages/contracts/src/domain.ts` | +1 |
| 1.3 | Add `coding` to `MemoryNamespaceKindSchema` | `packages/contracts/src/memory.ts` | +1 |
| 1.4 | Add `coding_session`, `code_review`, `debug_session` to `MemorySourceTypeSchema` | `packages/contracts/src/memory.ts` | +3 |
| 1.5 | Add `domains` and `consumerProfile` to `MemorySearchQuerySchema` | `packages/contracts/src/memory.ts` | +2 |
| 1.6 | Add `domain` to `MemorySearchResultSchema` | `packages/contracts/src/memory.ts` | +1 |
| 1.7 | Update contract tests for new enum values | `packages/contracts/src/contracts.test.ts` | ~+20 |

### Phase 2: Consumer profiles (~1 hr)

| # | Task | File(s) | Lines |
|---|------|---------|-------|
| 2.1 | Create `consumer-profiles.ts` with profile definitions | `packages/memory/src/consumer-profiles.ts` | ~40 |
| 2.2 | Add `applyConsumerProfile()` to search service | `packages/memory/src/search-service.ts` | ~30 |
| 2.3 | Wire `consumerProfile` query param / `X-Consumer-Profile` header in control API | `packages/control-api/src/index.ts` | ~15 |
| 2.4 | Add domain filtering to the search pipeline (WHERE clause on `domain`) | `packages/memory/src/fts5-search.ts`, `search-service.ts` | ~20 |
| 2.5 | Unit tests for profile resolution and domain filtering | `packages/memory/src/consumer-profiles.test.ts` | ~60 |

### Phase 3: Ingestion bridge (~1 hr)

| # | Task | File(s) | Lines |
|---|------|---------|-------|
| 3.1 | Pass `domain` through import endpoint to memory writes | `packages/control-api/src/index.ts`, `packages/runtime-core/src/memory-lifecycle.ts` | ~10 |
| 3.2 | Auto-create `coding` namespace on first coding-domain write | `packages/memory/src/namespace.ts` | ~15 |
| 3.3 | Ensure new source types flow through legacy + structured dual-write | `packages/runtime-core/src/memory-lifecycle.ts` | ~5 |
| 3.4 | Integration test: coding agent import → search with coding profile | `packages/runtime-core/src/memory-lifecycle.test.ts` | ~40 |

### Phase 4: Documentation + migration helper (~30 min)

| # | Task | File(s) |
|---|------|---------|
| 4.1 | Update `docs/memory-model.md` with coding namespace and consumer profiles |  |
| 4.2 | Update `docs/api-contracts.md` with new query params |  |
| 4.3 | Add coding agent integration guide to `docs/runbooks/` |  |
| 4.4 | Document .md migration path |  |

---

## 9. What This Does NOT Change

- No new SQLite tables or columns (domain is already on `MemoryRecord`)
- No new packages
- No changes to the scoring/ranking algorithm
- No changes to confidence decay or consolidation
- No changes to the embedding pipeline
- No changes to redaction or security
- No changes to the legacy `memories` compatibility layer
- No breaking API changes (all new fields are optional)

---

## 10. Domain column — current state check

The `domain` field exists on `MemoryRecordSchema` (Zod) and maps to the
`memories` legacy table. Need to verify it's present on the structured tables
(`memory_facts`, `memory_artifacts`, `memory_syntheses`).

**If missing from structured tables:** Add a migration (013) that adds a
`domain TEXT DEFAULT 'general'` column to `memory_facts` and
`memory_artifacts`. This is the only potential schema migration needed.

**If present:** No migration needed.

This must be checked before implementation.

---

## 11. Coding Agent Authentication

Coding agents authenticate the same way as any other control API consumer:
bearer token on every request. No new auth mechanism.

For local coding agents (Claude Code running on the same machine), the token
is available via the same mechanism as the CLI — read from the runtime's
auth token file at `~/Library/Application Support/Popeye/auth-token`.

For remote coding agents (future): not in scope. Loopback-only per security
rules.

---

## 12. Future Extensions (Not in This Plan)

- **Auto-flush hook:** coding agent session → Popeye memory at end of session
- **Pattern synthesis:** periodic consolidation of coding facts into procedural syntheses ("here's how we test in this project")
- **Cross-project coding memory:** global coding namespace for patterns that apply everywhere
- **Coding-specific scoring boost:** weight `procedure` fact_kind higher for coding consumers
- **MCP memory tool:** expose Popeye memory search as an MCP tool so coding agents can query mid-session without HTTP calls
- **qmd bridge:** index Popeye's coding memories in qmd for agents that use qmd natively

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Coding memories flood the DB with low-value noise | Confidence threshold + decay handles this naturally; set initial confidence conservatively (0.6-0.7) |
| Domain filter adds latency to search | Domain is indexed via location indexes; WHERE clause is cheap |
| Consumer profiles create implicit coupling | Profiles are soft defaults, never enforced; any caller can override |
| Existing tests break from new enum values | New values are additive; existing tests parse subsets, not exhaustive matches |
| `domain` column missing from structured tables | Check before implementing; if missing, migration is trivial (DEFAULT handles backfill) |

---

## 14. Success Criteria

1. A coding agent can write a memory via `/v1/memory/import` with `domain: 'coding'`
2. That memory is searchable by another coding agent with `consumerProfile=coding`
3. That memory does NOT appear in default assistant searches
4. An assistant CAN find it when explicitly including `domains=coding`
5. Existing assistant memory is unaffected — no behavior change without the new query params
6. All existing tests pass without modification
7. `dev-verify` passes
