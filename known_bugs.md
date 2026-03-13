# Known Bugs & Issues

Last updated: 2026-03-13

---

## Resolved (fixed during Phase 8 completion)

### 1. Missing Zod schemas in `@popeye/contracts`

**Symptom:** `PopeyeApiClient` imported `HealthResponseSchema`, `TaskCreateResponseSchema`, `SecurityAuditResponseSchema`, and `MemorySearchResponseSchema` from `@popeye/contracts`, but these schemas did not exist in the source file (`packages/contracts/src/index.ts`).

**Impact:** Runtime errors (`schema.parse is not a function`) when the api-client tried to validate responses. Typecheck passed due to stale `.d.ts` artifacts.

**Fix:** Added all four schemas to `packages/contracts/src/index.ts`.

---

### 2. Missing `memory` config in control-api test fixtures

**Symptom:** `TypeError: Cannot read properties of undefined (reading 'confidenceHalfLifeDays')` in `PopeyeRuntimeService` constructor.

**Impact:** All control-api tests failed (`index.test.ts`, `csrf.test.ts`, `sec-fetch.test.ts`, `contract.test.ts`, `sse.test.ts`). Also affected `runtime-service.test.ts`, `state-guards.test.ts`, and `daemon-boot.test.ts` test configs that were missing the `memory` field.

**Root cause:** The `memory` field was added to `AppConfigSchema` with `.default({})`, and the runtime service started accessing `config.memory.confidenceHalfLifeDays`. Test configs that bypassed Zod parsing (passing raw objects) needed the field explicitly.

**Fix:** Added `memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 }` to all test config objects.

---

### 3. `@popeye/api-client` not registered in monorepo tsconfig

**Symptom:** TypeScript path alias `@popeye/api-client` not resolving; `pnpm install` failing with `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` when referenced from CLI.

**Fix:** Added `@popeye/api-client` to `tsconfig.base.json` paths, `tsconfig.json` references, and `apps/cli/package.json` dependencies.

---

### 4. `TaskCreateInput` type requiring `coalesceKey`

**Symptom:** TypeScript error `Property 'coalesceKey' is missing` when calling `client.createTask(...)` without providing `coalesceKey`.

**Root cause:** `z.infer<typeof TaskCreateInputSchema>` produces the OUTPUT type where `coalesceKey` (which has `.default(null)`) is required. Callers expect the INPUT type where it's optional.

**Fix:** Changed `createTask` method signature to use `z.input<typeof TaskCreateInputSchema>`.

---

### 5. Invalid mock data in api-client unit tests

**Symptom:** Zod validation errors (`Invalid enum value: Expected 'read_only' | 'external_side_effect', received 'standard'`).

**Root cause:** Mock response used `sideEffectProfile: 'standard'` and `status: 'open'`, which aren't valid enum values. Also missing `retryPolicy` field.

**Fix:** Updated mock to use correct enum values and include all required fields.

---

## Known Warnings (non-blocking)

### sqlite-vec extension not available

**Message:** `[memory] sqlite-vec extension not available — falling back to FTS5-only search`

**Impact:** None — memory search falls back to FTS5-only mode. Vector search is disabled. This is expected in environments where `sqlite-vec` native extension is not installed.

**Resolution:** Install `sqlite-vec` native extension if hybrid (FTS5 + vector) search is needed. Not required for development or CI.

---

### Stale build artifacts in `packages/contracts/src/`

**Observation:** `packages/contracts/src/` contains committed `.d.ts`, `.js`, and `.js.map` files alongside the `.ts` source. These can drift out of sync with the source (as happened with the missing schemas above).

**Recommendation:** Either add these to `.gitignore` and generate them at build time, or ensure they are regenerated on every change to the `.ts` source. Currently they are committed but can become stale.

---

### `packages/engine-pi/src/` contains committed build artifacts

**Observation:** Similar to contracts, `packages/engine-pi/src/` has committed `.d.ts`, `.js`, and `.js.map` files. These should be treated the same way as the contracts artifacts.

---

## Open Bugs (found during Phase 4 implementation)

### 6. Memory DB: `memory_consolidations` table missing `reason` column

**Severity:** High
**Files:**
- Schema: `packages/runtime-core/src/database.ts` — migration `001-memory-schema` (line 73)
- Code: `packages/runtime-core/src/memory-lifecycle.ts` (lines 192, 210)

**Description:**
The `memory_consolidations` table is created with columns `(id, memory_id, merged_into_id, created_at)`, but `MemoryLifecycleService` inserts with a `reason` column:

```sql
INSERT INTO memory_consolidations (id, memory_id, merged_into_id, reason, created_at) VALUES (?, ?, ?, ?, ?)
```

This will crash at runtime whenever memory consolidation runs (merging duplicate or redundant memories).

**Fix:** Add `reason TEXT` to the CREATE TABLE in migration 001, or add a new migration: `ALTER TABLE memory_consolidations ADD COLUMN reason TEXT;`.

---

### 7. Memory DB: `memory_vec` virtual table not created by any migration

**Severity:** Medium (non-blocking — runtime falls back to FTS5-only)
**Files:**
- Code: `packages/memory/src/vec-search.ts` (lines 10, 23, 27)
- Missing from: `packages/runtime-core/src/database.ts` (MEMORY_MIGRATIONS)

**Description:**
The vector search module queries, inserts into, and deletes from a `memory_vec` table:

```sql
SELECT memory_id, distance FROM memory_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?
INSERT INTO memory_vec(memory_id, embedding) VALUES (?, ?)
DELETE FROM memory_vec WHERE memory_id = ?
```

No migration creates this table. The test at `packages/memory/src/vec-search.test.ts:14` creates it manually:

```sql
CREATE VIRTUAL TABLE memory_vec USING vec0(memory_id TEXT PRIMARY KEY, embedding float[4])
```

The runtime falls back to FTS5-only search when sqlite-vec isn't available, so this doesn't block normal operation. But when sqlite-vec IS loaded, the missing table will cause query failures.

**Fix:** Add a conditional migration or create the table dynamically in the sqlite-vec extension loader (`packages/memory/src/extension-loader.ts`).

---

### 8. `runtime-service.test.ts`: `close()` cleanup leaves stale leases/locks

**Severity:** Low (test-only)
**Files:**
- `packages/runtime-core/src/runtime-service.test.ts` (lines 381, 383, 440)

**Description:**
Tests "close() with idle runtime cleans up completely" and "close() cancels in-flight run" assert zero leases and locks after `runtime.close()`:

```ts
expect(leases.count).toBe(0);
expect(locks.count).toBe(0);
```

But `close()` leaves 1 lease or lock behind. The `close()` method may not be sweeping all job leases or releasing all workspace locks during shutdown.

**Fix:** Audit `close()` in `runtime-service.ts` to ensure it deletes all job leases and releases all workspace locks before shutdown completes.

---

### 9. FTS5 rowid JOIN assumes synchronized rowids with `memories` table

**Severity:** High
**Files:**
- `packages/runtime-core/src/runtime-service.ts` — `searchMemories` method

**Description:**
The `searchMemories` query joins on `m.rowid = memories_fts.rowid`:

```sql
JOIN memories m ON m.rowid = memories_fts.rowid
```

The `memories` table has a TEXT primary key (`id`), so its `rowid` is an internal auto-increment. The FTS5 table has its own separate `rowid`. While insertions are currently paired, any future deletion, vacuum, or re-insertion will desynchronize the rowids, producing wrong or missing results.

**Fix:** Either use an FTS5 content table (`USING fts5(description, content, content=memories, content_rowid=rowid)`) with triggers, or store the memory `id` in FTS5 and join on that instead of rowid.

---

### 10. `memory_consolidations` table missing `reason` column (duplicate of #6)

See bug #6 above. Still open.

---

### 11. Stale `.js` build artifact triggers secret scan false positive

**Severity:** Low (CI/dev friction)
**Files:**
- `packages/observability/src/index.test.js` — stale compiled output

**Description:**
`pnpm security:secrets` fails because `scan-secrets.mjs` finds a pattern match in the compiled `.js` file at `packages/observability/src/index.test.js`. The test file contains test data for redaction patterns (e.g., fake API keys), which are flagged as potential secrets.

**Fix:** Either add `*.js` build artifacts in `packages/*/src/` to `.gitignore`, or add an exclusion for `*.test.js` files in `scan-secrets.mjs`.

---

### 12. Database migration `003-workspace-project-paths` has no test coverage

**Severity:** Medium
**Files:**
- `packages/runtime-core/src/database.ts` — migration 003

**Description:**
The migration adds columns via `ALTER TABLE ADD COLUMN` but has no dedicated test verifying the migration runs successfully. CLAUDE.md section 12 requires: "Runtime storage changes require migrations and migration tests."

**Fix:** Add a migration test that verifies the columns exist after migration 003 runs.

---

## Previously Observed (may recur)

### Post-edit hook reverting file modifications

**Symptom:** Edits to existing files (especially JSON configs like `tsconfig.json`, `package.json`) are silently reverted by the post-edit formatting hook at `~/GitHub/ai-config/scripts/claude-post-edit-format.sh`.

**Workaround:** Re-read files after hook execution and re-apply changes if needed. The hook runs prettier which can reformat but should not change semantics. In some cases, file modifications appeared to be fully reverted — this may be a timing issue with the hook.
