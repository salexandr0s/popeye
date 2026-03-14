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

### 6. FTS5 rowid JOIN assumed synchronized rowids with `memories` table

**Symptom:** FTS queries joined `memories_fts` to `memories` via `rowid`, which could misjoin after row reuse (for example after delete + reinsert, or after vacuuming file-backed databases).

**Impact:** Memory search could return wrong or missing records.

**Fix:** Added memory migration `006-memory-fts-stable-id` to rebuild `memories_fts` with `memory_id UNINDEXED`, updated FTS sync helpers to write/delete by `memory_id`, and changed runtime/memory search joins to use `m.id = memories_fts.memory_id`.

---

### 7. Secret scan false positives from generated source-neighbor artifacts

**Symptom:** `pnpm security:secrets` flagged compiled `.js` artifacts next to `.ts` source files (for example tests containing fake API keys used for redaction coverage).

**Impact:** CI/dev friction and noisy secret-scan failures.

**Fix:** Updated `scan-secrets.mjs` to skip generated `.js`/`.d.ts`/map files only when a same-basename `.ts`/`.tsx` source sibling exists, and added ignore rules for generated source-neighbor artifacts.

---

### 8. Missing migration coverage for workspace/project paths and new memory FTS rebuild

**Symptom:** App migration `005-workspace-project-paths` had no dedicated upgrade-path test. The new memory FTS rebuild migration also required explicit coverage.

**Impact:** Storage changes could regress without detection.

**Fix:** Added upgrade-path tests that seed pre-migration databases, reopen through `openRuntimeDatabases()`, and verify both schema changes and preserved data/backfilled FTS rows.

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

## Open Bugs

None currently verified as open after the 2026-03-13 bug sweep.

---

## Previously Observed (may recur)

### Post-edit hook reverting file modifications

**Symptom:** Edits to existing files (especially JSON configs like `tsconfig.json`, `package.json`) are silently reverted by the post-edit formatting hook at `~/GitHub/ai-config/scripts/claude-post-edit-format.sh`.

**Workaround:** Re-read files after hook execution and re-apply changes if needed. The hook runs prettier which can reformat but should not change semantics. In some cases, file modifications appeared to be fully reverted — this may be a timing issue with the hook.
