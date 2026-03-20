# Popeye Build Plan Phase Audit

**Date:** 2026-03-14
**Scope:** All phases (0 through 10) audited against the actual codebase
**Method:** Automated agent research per phase, compiled into this report
**Codebase health at audit time:** Lint clean, typecheck clean, 700 tests passing (1 skipped smoke test)

> Historical audit note: this document captures repo truth as of 2026-03-14.
> For the current canonical snapshot, use `docs/current-state-matrix.md`. The
> specific gaps around default `runtimeDataDir`, `pop daemon health`, generated
> contract artifacts, and CLI help have since been closed.

---

## Executive Summary

Popeye is substantially built. Phases 0 through 9 are delivered with only minor gaps. Phase 10 is partially delivered -- docs and backup exist, but packaging and migration tooling do not.

| Phase | Status | Verdict |
|-------|--------|---------|
| 0 -- Discovery & donor analysis | **Complete** | All exit criteria met. 5 of 6 named docs exist; one is split across two files. |
| 1 -- Fork freeze & repo bootstrap | **Complete** | All exit criteria met. Monorepo, CI, keychain, file permissions all in place. |
| 2 -- Core runtime shell | **Complete** | All exit criteria met. Substantially exceeds scope. |
| 3 -- Daemon & heartbeat | **Complete** | All exit criteria met. Daemon, launchd, heartbeat, reconciliation, loopback all working. |
| 3.5 -- Telegram adapter | **Complete** | All exit criteria met. Thin bridge with allowlist, rate limiting, delivery state machine. |
| 4 -- State, session, task model | **Complete** | All exit criteria met. Full Task/Job/Run separation, leases, retry, pause/resume. |
| 5 -- Memory layer | **Mostly complete** | Hybrid search works. No automated workspace doc indexing. sqlite-vec is alpha. |
| 6 -- Instructions & workspace | **Complete** | All exit criteria met. Resolver, snapshotting, preview, write policy all working. |
| 7 -- Observability & security | **Mostly complete** | Receipts, security audit, redaction, interventions all working. No structured logger with correlation IDs. |
| 8 -- API & control surface | **Complete** | ~50 versioned endpoints, SSE, auth, CSRF, Sec-Fetch-Site. TS client is hand-written not codegen. |
| 9 -- First UI | **Mostly complete** | Web inspector delivered with 11 views + Command Center. Swift macOS client deferred (ADR 0008). |
| 10 -- Polish & packaging | **Partially complete** | Backup/restore works. Security audit works. Packaging and migration tooling remain incomplete. |

**Overall: ~90% of the build plan was delivered at audit time.** Use
`docs/current-state-matrix.md` and `docs/fully-polished-release-gate.md` for
the current repo truth and the current definition of "done."

---

## Phase 0 -- Discovery, Code Reading, and Donor Analysis

### Exit Criteria

| Criterion | Status |
|-----------|--------|
| Every feature classified as Pi reuse / donor / new / omit | MET |
| Omission list exists | MET |
| Domain nouns defined clearly enough to start implementation | MET |

### Deliverables

| Document | Status | Notes |
|----------|--------|-------|
| `docs/current-openclaw-inventory.md` | Present | |
| `docs/pi-capability-map.md` | Present | |
| `docs/openclaw-donor-map.md` | Present | |
| `docs/omissions.md` | Present | |
| `docs/domain-model.md` | Present | |
| `docs/pi-fork-strategy.md` | **Missing (naming only)** | Content split across `docs/adr/0002-pi-fork-strategy.md` and `docs/pi-fork-delta.md`. Better structure, but doesn't match the buildplan literally. |

### Gaps

1. **`docs/pi-fork-strategy.md`** does not exist as a standalone file. The content is covered by ADR 0002 + pi-fork-delta.md.

### Observations

- Documents reflect the fully-built system rather than a discovery-phase survey, suggesting they were refined as the system was built. Quality is high.

---

## Phase 1 -- Fork Freeze and Repo Bootstrap

### Exit Criteria

| Criterion | Status |
|-----------|--------|
| Pi fork builds under your control | MET -- fork at `~/GitHub/pi`, owned GitHub repo |
| Popeye repo builds/tests/lints cleanly | MET -- full CI pipeline |
| Engine dependency pinning in place | MET -- `config.engine.piVersion` pinned to `0.57.1` |
| Fork strategy doc exists | MET (via ADR 0002 + pi-fork-delta.md) |
| Keychain integration works | MET -- full keychain module with tests |
| File permissions (700/600) enforced | MET -- `ensureRuntimePaths`, auth.ts, security audit all enforce |

### Deliverables

| Deliverable | Status |
|-------------|--------|
| Pi fork repo (`pi`) | Present |
| Popeye monorepo (pnpm + Turborepo) | Present |
| Strict TypeScript | Present (`strict: true`) |
| Lockfiles | Present (`pnpm-lock.yaml` committed) |
| CI | Present (4 GitHub Actions workflows) |
| Zod config validation | Present (`loadAppConfig` with Zod) |
| ADR directory | Present (12 ADRs) |
| `docs/adr/0001-repo-topology.md` | Present |
| `docs/adr/0002-pi-fork-strategy.md` | Present |
| Keychain integration | Present |
| Secret storage conventions | Present |

### Gaps

1. ~~**ESLint type-aware rules disabled.**~~ **Fixed.** `eslint.config.mjs` now uses `projectService: true` with `no-floating-promises`, `no-misused-promises`, and `await-thenable` enabled as errors.

---

## Phase 2 -- Core Runtime Shell

### Exit Criteria

| Criterion | Status |
|-----------|--------|
| One manual task from `pop` CLI | MET -- `pop task run` |
| One run persists state and raw events | MET -- `runs` + `run_events` tables |
| One receipt generated | MET -- `ReceiptManager.writeReceipt()` |
| Memory tables exist in schema | MET -- all 6 memory tables in migrations |
| Auth token required for control API | MET -- bearer validation on every endpoint |
| Fake-engine integration test passes | MET |
| Real Pi smoke test passes | MET (conditional on `POPEYE_ENABLE_PI_SMOKE=1`) |

### Deliverables

All delivered and substantially exceed Phase 2 scope:

- **Domain schemas:** All required schemas as Zod in `@popeye/contracts` (workspaces, projects, agent profiles, tasks, jobs, runs, receipts, SessionRoots, memories, memory_events, memory_sources, memory_consolidations)
- **SQLite migration framework:** 12 app migrations + 6 memory migrations, WAL mode, foreign keys
- **EngineAdapter interface + PiEngineAdapter:** Full implementation with child process, RPC, event streaming, host tool bridge
- **FakeEngineAdapter:** 5 failure modes (success, transient, permanent, timeout, protocol_error)
- **CLI commands:** `pop task run`, `pop run show`, `pop receipt show` all present
- **Receipt format:** DB + disk artifacts, cost/usage, redaction

### Gaps

None for Phase 2 scope.

### Observations

- Stale `.js`/`.d.ts` build artifacts in `packages/contracts/src/` (known issue in `known_bugs.md`)
- Engine-pi test uses relative import `../../contracts/src/config.ts` instead of package name

---

## Phase 3 -- Always-On Daemon and Heartbeat

### Exit Criteria

| Criterion | Status |
|-----------|--------|
| Daemon installs and runs under launchd | MET |
| Daemon restart survivable | MET -- startup reconciliation |
| Heartbeat runs on schedule (1-hour default) | MET -- configurable per-workspace |
| Stale in-flight runs reconciled | MET -- `reconcileStartupState()` |
| Daemon binds to loopback only | MET -- enforced at schema + runtime + audit |

### Deliverables

| Deliverable | Status |
|-------------|--------|
| Daemon bootstrap (`popeyed`) | Present -- `apps/daemon/` |
| launchd support | Present -- install/load/unload/restart/uninstall/status/plist |
| Heartbeat | Present -- 3600s default, per-workspace config |
| Stale-run reconciliation | Present -- marks abandoned, writes receipts, applies recovery |
| Loopback enforcement | Present -- 3 layers (Zod schema, runtime check, security audit) |
| `docs/runbooks/daemon.md` | Present -- 58 lines |

### Gaps

1. **Fixed on 2026-03-20:** `runtimeDataDir` now defaults to `~/Library/Application Support/Popeye/` when omitted from the config file.
2. **`pop daemon start` is foreground-only.** Background operation requires `pop daemon install && pop daemon load` (launchd). This is reasonable for macOS but worth noting.
3. **Fixed on 2026-03-20:** `pop daemon health` now checks the running daemon's API/engine health.

---

## Phase 3.5 -- Telegram Channel Adapter

### Exit Criteria

| Criterion | Status |
|-----------|--------|
| Allowlisted user can send/receive | MET |
| Non-allowlisted users rejected | MET |
| Messages route through control API | MET -- `POST /v1/messages/ingest` |
| Rate limiting enforced and tested | MET -- global (30/min) + per-user (10/min) |

### Deliverables

| Deliverable | Status |
|-------------|--------|
| `@popeye/telegram` package | Present -- 663 lines |
| Bot API integration | Present -- long-poll with getUpdates/sendMessage |
| Allowlist-only DM policy | Present -- private chat + allowedUserId check |
| Rate limiting | Present -- sliding window, two levels |
| `docs/telegram-adapter.md` | Present -- 125 lines |

### Delivery State Machine

The adapter implements a full delivery state machine: `pending` -> `sending` -> `sent` / `uncertain`, with operator resolution flow, duplicate suppression, retry with per-attempt audit recording. This exceeds Phase 3.5 scope.

### Gaps

1. **Long-poll only.** Webhook transport intentionally out of scope per docs.
2. **Single `allowedUserId`.** Config supports one user, not an array. Correct for single-operator daemon.

---

## Phase 4 -- State, Session, and Task Model

### Exit Criteria

| Criterion | Status |
|-----------|--------|
| Recurring jobs work | MET -- heartbeat schedules |
| Delayed one-shot jobs work | MET -- `availableAt` scheduling |
| Retry and backoff work | MET -- exponential backoff with cap |
| One active run per workspace enforced | MET -- workspace lock + scheduler guard |
| Session selection deterministic and tested | MET -- `{kind}:{scope}` deterministic IDs |

### Deliverables

All delivered:

- **Task/Job/Run separation:** Full Zod schemas, DB tables, state machines
- **SessionRoots:** 5 kinds (`interactive_main`, `system_heartbeat`, `scheduled_task`, `recovery`, `telegram_user`), deterministic selection
- **Job queue and leases:** `job_leases` table, 60s TTL, 15s sweep interval, liveness checking
- **Retry/backoff:** `RetryPolicySchema` with exponential backoff capped at `maxDelaySeconds`
- **Pause/resume/cancel:** State guards tested, CLI commands present
- **Concurrency locks:** `locks` table, INSERT-or-reject pattern, cleanup on finalization/reconciliation/sweep
- **`docs/domain-model.md`:** Field-level reference with state machine diagrams
- **`docs/session-model.md`:** Session kinds, selection rules, Pi relationship

### Gaps

None.

---

## Phase 5 -- Memory Layer

### Exit Criteria

| Criterion | Status |
|-----------|--------|
| Hybrid search returns relevant results under 200ms | MET -- FTS5 + sqlite-vec in parallel, latencyMs tracked |
| Provenance inspectable | MET -- `memory_sources`, `source_run_id`, `memory_events` |
| Daily summaries reproducible and human-readable | MET -- `renderDailySummaryMarkdown()` |
| Consolidation merges without losing provenance | MET -- exact dedup + text overlap merge (Jaccard > 0.8) |
| Confidence decay reduces stale scores | MET -- configurable half-life (default 30 days) |
| `pop memory audit` shows health and provenance | MET -- totalMemories, byType, byScope, averageConfidence, staleCount |

### Deliverables

| Deliverable | Status |
|-------------|--------|
| Memory type modeling | Present -- episodic, semantic, procedural stored; working is in-memory only |
| FTS5 + sqlite-vec hybrid search | Present -- parallel query, scoring-function rerank |
| Confidence scores and decay | Present -- `0.5^(days/halfLife)`, archival below threshold |
| Consolidation | Present -- exact dedup + text overlap merge |
| Provenance tracking | Present -- `memory_sources`, `source_run_id`, events |
| Compaction flush | Present -- intercepts Pi compaction events, chunks, redacts |
| Two-stage retrieval | Present -- fast index then `(0.4*relevance + 0.25*recency + 0.2*confidence + 0.15*scopeMatch)` |
| `pop memory search` | Present -- with `--full` flag |
| `pop memory audit` | Present |
| Curated memory policy | Present -- propose/approve promotion with path traversal protection |
| Daily summaries | Present -- automated hourly check, markdown output |
| Receipt search | Present -- `pop receipt search` (episodic filter) |
| Knowledge/doc indexing | **Partial** |
| `docs/memory-model.md` | Present |
| `docs/workspace-conventions.md` | Present |

### Gaps

1. ~~**No automated workspace document indexing.**~~ **Fixed.** `startDocIndexing()` now runs on daemon startup and on a configurable timer (`docIndexIntervalHours`, default 6h). `indexWorkspaceDocs()` walks subdirectories recursively (skipping `node_modules`, `.git`, `dist`).

2. **sqlite-vec is alpha.** Pinned at `0.1.7-alpha.2`. The code handles unavailability gracefully (falls back to FTS5-only), but the alpha status should be noted for production readiness.

3. **No full hybrid integration test.** Vec tests are conditional on extension availability. `search-service.test.ts` uses disabled embedding client, so the combined FTS5+vec code path is not tested end-to-end in CI.

4. ~~**Legacy `searchMemories()` method.**~~ **Fixed.** The raw FTS5 bypass has been removed. All memory search now goes through the two-stage pipeline via `searchMemory()`.

---

## Phase 6 -- Instruction, Identity, Workspace, and Project System

### Exit Criteria

| Criterion | Status |
|-----------|--------|
| Instruction resolution deterministic and inspectable | MET -- SHA-256 hashing, snapshots, preview API |
| Operator can explain why a run received a specific instruction | MET -- bundle includes ordered sources with paths and hashes |
| Workspace and project routing explicit | MET -- `workspaceId` on every entity |
| Control-file write policy enforced and tested | MET -- 4 protected files, approval gate |

### Deliverables

| Deliverable | Status |
|-------------|--------|
| Instruction resolver | Present -- 8 source types, precedence 2-9 |
| Workspace registry | Present -- CRUD with Zod validation |
| Project registry | Present -- integrated in WorkspaceRegistry |
| Identity/profile files | Present -- path-traversal-safe resolution at precedence 6 |
| Instruction snapshotting & preview | Present -- persisted snapshots, API endpoint |
| Critical file write policy | Present -- WORKSPACE.md, PROJECT.md, IDENTITY.md, HEARTBEAT.md |
| `docs/instruction-resolution.md` | Present -- 62 lines |
| `docs/workspace-routing.md` | Present -- 62 lines |

### Gaps

1. **No CWD routing.** Workspace is set by caller in `TaskCreateInput.workspaceId`, not auto-detected from working directory.
2. **No `pop instructions diff` command.** The API returns compiled bundles, but there is no CLI diff tool.

---

## Phase 7 -- Observability, Receipts, Recovery, Intervention, and Security Audit

### Exit Criteria

| Criterion | Status |
|-----------|--------|
| Failures diagnosable from stored artifacts | MET |
| Intervention queue usable | MET -- API + CLI + automatic creation |
| Raw and summarized records both exist | MET -- run_events raw, receipts summarized |
| Recovery paths have failure-injection tests | PARTIALLY MET -- retry budget tested; auth/policy recovery not explicitly tested |
| Cost/usage data in receipts | MET |
| `pop security audit` passes | MET -- 11 check categories |
| Sensitive patterns redacted before write | MET for receipts and errors; NOT MET for general app logging |

### Deliverables

| Deliverable | Status |
|-------------|--------|
| Structured daemon/run logs | **Partial** -- Fastify pino logs only; no dedicated structured logger with correlation IDs |
| Receipt schema with cost/usage | Present -- provider, model, tokensIn, tokensOut, estimatedCostUsd |
| Failure taxonomy | Present -- 8 engine classifications + 7 run states + 9 job states |
| Intervention queue | Present -- 9 intervention codes, create/resolve |
| Recovery supervisor | Present -- startup reconciliation, retry, block, abandon, lease sweep |
| Diagnosis-oriented CLI/API | Present -- 6 CLI commands + 14 API endpoints |
| Security audit CLI | Present -- 11 check categories including ReDoS detection |
| Redact-on-write | Present -- 14 builtin patterns + custom patterns |
| `docs/runbooks/recovery.md` | Present -- 75 lines |
| `docs/runbooks/incident-response.md` | Present -- 120 lines |
| `docs/receipt-schema.md` | Present but thin -- 22 lines |

### Gaps

1. **No structured application logger.** CLAUDE.md section 14 requires "Structured JSON logs with correlation IDs (`workspaceId`, `projectId`, `taskId`, `jobId`, `runId`, `sessionRootId`)." The `@popeye/observability` package contains only `redactText()` and `sha256()` -- no structured logger, no log rotation, no correlation ID propagation. Logging relies entirely on Fastify's pino and `console.error`.

2. **No event normalization module.** `NormalizedEngineEvent` exists in contracts, but normalization happens inline in runtime-service.ts and engine-pi, not in a dedicated observability component.

3. **`docs/receipt-schema.md` is thin.** At 22 lines it documents fields but not the receipt lifecycle, redaction behavior, artifact format, or rendering format.

4. **Auth/policy failure recovery paths not tested with failure injection.** Only retry budget exhaustion has explicit failure-injection coverage.

---

## Phase 8 -- API and Control Surface

### Exit Criteria

| Criterion | Status |
|-----------|--------|
| CLI operates through API for key workflows | MET -- `tryConnectDaemon()` with fallback |
| External client can inspect live state | MET -- web inspector |
| Event stream supports live run updates | MET -- SSE at `/v1/events/stream` |
| Telegram messages route through API | MET |
| CSRF blocks cross-origin mutations | MET -- `x-popeye-csrf` + Sec-Fetch-Site |
| API contracts versioned and documented | MET -- all `/v1/`, `docs/control-api.md` |

### Deliverables

| Deliverable | Status |
|-------------|--------|
| Versioned Fastify HTTP API | Present -- ~50 endpoints under `/v1/` |
| SSE event stream | Present -- heartbeat, connection limits, auth required |
| Auth/token handling | Present -- bearer + browser session (nonce exchange + HttpOnly cookie) |
| CSRF protection | Present -- on all POST/PUT/PATCH/DELETE |
| Sec-Fetch-Site validation | Present -- blocks non-same-origin/none |
| Telegram endpoints | Present -- 12 Telegram-specific endpoints |
| API docs | Present -- `docs/control-api.md` (245 lines) + `docs/api-contracts.md` |
| ADR | Present -- `docs/adr/0007-control-api-boundary.md` (numbered differently from buildplan's 0003) |
| TypeScript client | Present -- hand-written `PopeyeApiClient` (577 lines) |
| Swift client models | Present -- `generated/swift/PopeyeModels.swift` (220 lines, data models only) |

### Gaps

1. **TypeScript client is still hand-written, not auto-generated.** The buildplan said "Generated TypeScript client (auto-generated)." The actual client is comprehensive and well-tested but manually maintained.
2. **Fixed on 2026-03-20:** generated contract artifacts now include a JSON Schema bundle plus generated TypeScript and Swift model bundles.
3. **Swift client has no network layer.** `PopeyeModels.swift` contains only `Codable` structs/enums -- no API client class.

---

## Phase 9 -- First UI

### Exit Criteria

| Criterion | Status |
|-----------|--------|
| Live run state observable from web inspector | MET |
| Receipts open from UI | MET |
| Pause/resume/retry/cancel through API | MET |
| Non-CLI client proves API boundary is real | MET -- web inspector uses only `/v1/*` endpoints |

### Deliverables

| Deliverable | Status |
|-------------|--------|
| Web inspector | Present -- Vite + React 19 + TailwindCSS v4 |
| Dashboard view | Present |
| Command Center | Present -- 903 lines, SSE-connected, exceeds spec |
| Runs list/detail | Present |
| Jobs list | Present |
| Receipts list/detail | Present |
| Instructions preview | Present |
| Interventions | Present |
| Memory search | Present |
| Usage & audit | Present |
| API-only client logic | Confirmed -- no direct file reads or SQLite access |
| Swift macOS client | **Deferred** -- ADR 0008 |
| `docs/ui-surface.md` | Present -- 68 lines |

### Gaps

1. **Swift macOS client deferred.** `apps/macos/` contains only a README. Documented and intentional per ADR 0008.
2. **No dedicated Sessions view.** Session roots accessible via API but no web inspector view for browsing them directly.

---

## Phase 10 -- Polish, Packaging, Migration, and Hardening

### Exit Criteria

| Criterion | Status |
|-----------|--------|
| Clean bootstrap on a new machine documented | MET -- `docs/runbooks/bootstrap.md` (119 lines) |
| Backup and restore work | MET -- 7 tests pass |
| Upgrade runbook exists and is test-backed | PARTIAL -- runbook exists, Pi smoke test is manual-dispatch only |
| Migration path from OpenClaw explicit | DOCS ONLY -- 3 migration docs, no tooling |
| Security hardening review passes | MET -- `pop security audit` with 11 checks |
| File permissions verified | MET -- `ensureRuntimePaths` + security audit |

### Deliverables

| Deliverable | Status |
|-------------|--------|
| Backup/restore | Present -- create, verify, restore with SHA-256 manifest |
| `docs/migration/openclaw.md` | Present -- 43 lines |
| `docs/migration/qmd-replacement.md` | Present -- 48 lines |
| `docs/migration/telegram-bot.md` | Present -- 51 lines |
| `docs/runbooks/upgrades.md` | Present -- 66 lines |
| `docs/runbooks/backup-restore.md` | Present -- 22 lines (thin) |
| Security audit | Present -- comprehensive |
| File permissions | Present -- pervasive enforcement |
| Packaging/install flow | **Not present** |
| Migration tooling | **Not present** |
| Pi upgrade compatibility suite | Partial -- manual-dispatch smoke, no continuous suite |
| Startup profiling | Test exists -- no documented results |

### Gaps

1. **No packaging artifact.** The CLI runs from the monorepo checkout via `tsx`. No `npm pack`, no standalone binary, no homebrew formula. `pop daemon start` hard-codes a path to `node_modules/.bin/tsx`.

2. **No migration helper tooling.** The buildplan says "Add migration helpers for selected workspace/memory artifacts." Only migration docs exist -- no `pop migrate` command or script.

3. **CLI lacks `--help`.** No help flag, no subcommand help. The only guidance is a catch-all usage line. Several commands silently fall through on missing arguments.

4. **No `--verbose`/`--quiet` flags, no colorized output.**

5. **Backup CLI doesn't expose workspace paths.** `createBackup` accepts `workspacePaths` but the CLI handler never passes them.

6. **`docs/runbooks/backup-restore.md` is thin.** 22 lines. No pre-restore checklist, no worked example.

7. **Pi upgrade compatibility suite is manual-dispatch only.** `pi-fork-delta.md` acknowledges: no detailed fork patch inventory, no compatibility matrix by tag, no continuous smoke in CI.

8. **No config reference documentation.** `config/example.json` is the only reference. No doc explaining each config field.

---

## Cross-Cutting Observations

### What's Strong

- **Security posture is defense-in-depth:** loopback binding at 3 levels, auth on every endpoint, CSRF + Sec-Fetch-Site, redact-on-write with 14 patterns, ReDoS detection, file permissions at creation + audit, 4 CI security workflows.
- **Test coverage is substantial:** 700 tests including golden tests, contract tests, failure injection, state guards, and security tests.
- **Domain modeling is clean:** Task/Job/Run separation, SessionRoot kinds, intervention codes, failure taxonomy all well-defined in Zod.
- **The control API boundary is real:** Web inspector proved it -- zero direct file reads or DB access.
- **Documentation is above average:** 12 ADRs, 6 runbooks, API docs, domain model, session model, memory model, instruction resolution, workspace conventions.

### What Needs Work

| Priority | Gap | Phase |
|----------|-----|-------|
| High | No structured application logger with correlation IDs | 7 |
| High | No packaging/install flow (runs from monorepo checkout) | 10 |
| ~~High~~ | ~~No automated workspace doc indexing into memory~~ — **Fixed** | 5 |
| Medium | No migration helper tooling | 10 |
| ~~Medium~~ | ~~CLI lacks --help and subcommand help~~ — **Fixed** | 10 |
| Medium | TypeScript API client is hand-written, not codegen | 8 |
| Medium | No full hybrid search integration test (FTS5 + vec combined) | 5 |
| ~~Medium~~ | ~~ESLint type-aware rules disabled~~ — **Fixed** | 1 |
| Medium | Pi upgrade smoke is manual-dispatch only | 10 |
| Low | Swift macOS client deferred | 9 |
| Low | No Sessions view in web inspector | 9 |
| Low | No CWD-based workspace routing | 6 |
| Low | receipt-schema.md is thin | 7 |
| ~~Low~~ | ~~Legacy `searchMemories()` bypasses two-stage pipeline~~ — **Fixed** | 5 |
| Low | sqlite-vec pinned to alpha release | 5 |
| Low | No config reference doc | 10 |

### Test Gaps Worth Noting

- Sessions package has minimal isolated tests (1 test)
- No integration test for full hybrid search path (FTS5 + vec together)
- No failure injection for auth_failure / policy_failure recovery paths
- No integration test for memory maintenance timer scheduling
- No CLI integration/smoke tests (logic tested via unit tests of underlying functions)

---

## Recommended Next Steps

1. **Structured logger** -- Build the `@popeye/observability` logger with correlation IDs. This is an explicit CLAUDE.md requirement that is unmet.
2. **CLI polish** -- Add `--help`, argument validation, and error messages. This is the primary operator interface.
3. ~~**Workspace doc indexer**~~ -- **Done.** `startDocIndexing()` runs on daemon startup and on a configurable timer.
4. **Packaging** -- Either `pnpm deploy` for a deployable artifact, or at minimum a documented global install path.
5. **Hybrid search integration test** -- Test the FTS5 + vec combined path in CI.
