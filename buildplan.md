# Popeye Build Plan

**Document status:** locked execution plan
**Audience:** human reviewer and coding agents
**Planning rule:** deliver the smallest durable vertical slices first

---

## 1. Project overview

Popeye is a long-term owned agent platform built on top of a controlled Pi fork.

Three facts hold from day one:

1. **Pi is the engine, not the product.** The Pi fork (`pi`) provides LLM session management. Popeye owns everything above and around it.
2. **The runtime is the product core.** The daemon (`popeyed`), scheduler, memory, receipts, and control API are the product.
3. **OpenClaw is only a donor for selected concepts.** Concepts may transfer; code does not migrate wholesale.

The implementation plan focuses on:

- understanding what Pi already provides
- inventorying what is actually needed from current OpenClaw usage
- freezing a stable repo/fork strategy
- building an always-on runtime shell first
- delaying optional surfaces until the core is boring and inspectable

**Naming conventions:**
- CLI binary: `pop`
- Daemon binary: `popeyed`
- Package scope: `@popeye/`
- Product name: Popeye

---

## 2. Build strategy

### 2.1 Core strategy

Build the system in a sequence of small, durable layers:

1. discovery and donor analysis
2. Pi fork freeze and repo bootstrap
3. thin runtime vertical slice
4. always-on daemon and heartbeat
5. explicit task/job/session model
6. memory and instruction systems
7. observability, receipts, recovery, and security audit
8. stable control API
9. first UI
10. packaging, hardening, and security review

### 2.2 Why this order

The highest-risk questions are not model quality questions. They are operational questions:

- can the daemon run continuously?
- can a run be observed and explained?
- can stale work be recovered?
- can you inspect state without touching internals?
- can you upgrade the fork without fear?

The plan reduces those risks in that order.

### 2.3 Implementation posture

- Keep changes small and reviewable.
- Prefer vertical slices over giant frameworks.
- Use fake adapters early to harden contracts before integrating Pi deeply.
- Do not build UI-first.
- Do not build donor compatibility-first.
- Do not build speculative plugin systems.
- The builder team is primarily AI agents; the user reviews and decides.

---

## 3. Assumptions

- Backend/runtime language is TypeScript (strict mode).
- Primary platform is macOS.
- SQLite is the operational store for v1.
- Pi fork is maintained in a separate repo (`pi`) from day one.
- Local loopback control API is acceptable for v1.
- Current OpenClaw usage can be inventoried before migration.
- The goal is start-to-finish ownership more than feature volume.

---

## 4. Preconditions (locked)

All preconditions are resolved. These are the locked decisions:

| Decision | Resolution |
|---|---|
| Product/repo name | **Popeye** |
| Node version | **Node 22 LTS** |
| Package manager | **pnpm** |
| Monorepo tooling | **pnpm workspaces + Turborepo** |
| Platform monorepo layout | As specified in Section 5 |
| Pi fork repo | **`pi`** (separate repo from day one) |
| macOS runtime data path | **~/Library/Application Support/Popeye/** |
| Config format | **JSON + Zod validation** |
| API framework | **Fastify** with Zod schema validation |
| v1 workspace count | **Multi-workspace in model, one primary for validation** |
| Builder team | **Primarily AI agents, user reviews and decides** |

Also gathered (or to be gathered in Phase 0):

- current OpenClaw config
- current workspace files
- heartbeat habits
- recurring jobs and cron usage
- custom tools/scripts currently depended on
- any must-preserve memory or instruction files

---

## 5. Repo and folder structure

### 5.1 Platform repo (Popeye)

```text
popeye/
  pnpm-workspace.yaml
  turbo.json
  package.json
  docs/
    architecture.md
    buildplan.md
    agents.md
    adr/
    migration/
    runbooks/
  apps/
    daemon/
      package.json          # @popeye/daemon
    cli/
      package.json          # @popeye/cli
    web-inspector/
      package.json          # @popeye/web-inspector
    macos/                  # Swift app (Phase 9, second UI)
  packages/
    contracts/
      package.json          # @popeye/contracts
    engine-pi/
      package.json          # @popeye/engine-pi
    runtime-core/
      package.json          # @popeye/runtime-core
    scheduler/
      package.json          # @popeye/scheduler
    sessions/
      package.json          # @popeye/sessions
    workspace/
      package.json          # @popeye/workspace
    instructions/
      package.json          # @popeye/instructions
    memory/
      package.json          # @popeye/memory
    receipts/
      package.json          # @popeye/receipts
    observability/
      package.json          # @popeye/observability
    control-api/
      package.json          # @popeye/control-api
    telegram/
      package.json          # @popeye/telegram
    testkit/
      package.json          # @popeye/testkit
  scripts/
  fixtures/
  config/
```

### 5.2 Pi fork repo

```text
pi/
  # stay close to upstream Pi
```

### 5.3 Package responsibilities

| Package | Responsibility |
|---|---|
| `@popeye/contracts` | Shared types, schemas, event contracts |
| `@popeye/engine-pi` | Pi adapter and compatibility tests |
| `@popeye/runtime-core` | Daemon bootstrap, run coordinator, policy/invariants |
| `@popeye/scheduler` | Schedules, leases, retries, job runner |
| `@popeye/sessions` | SessionRoot model and mapping |
| `@popeye/workspace` | Workspace/project registry and routing |
| `@popeye/instructions` | Instruction source resolution and snapshotting |
| `@popeye/memory` | Retrieval, summaries, durable memory, hybrid search |
| `@popeye/receipts` | Receipt generation, persistence, cost/usage tracking |
| `@popeye/observability` | Structured logging, event normalization, redact-on-write |
| `@popeye/control-api` | Fastify HTTP/SSE server and generated client types |
| `@popeye/telegram` | Telegram Bot API adapter, allowlist enforcement, rate limiting |
| `@popeye/testkit` | Fake engine, fixture workspaces, integration helpers |

---

## 6. Dependency and fork strategy

### 6.1 Pi fork strategy

- Keep Pi fork in a separate repo (`pi`).
- Track exact upstream baseline tag/commit.
- Maintain a minimal documented delta.
- Pin exact engine package versions in the Popeye repo.
- Never use floating version ranges for engine packages.
- Upgrade only on explicit cadence.

### 6.2 Runtime dependency strategy

- Keep core dependencies small.
- Strict lockfiles committed.
- Explicit DB migrations.
- Strict schema validation (Zod).
- No runtime dependence on donor packages except where intentionally imported.

### 6.3 Donor code strategy

For anything adapted from OpenClaw:

- Confirm license/provenance before copying code.
- Prefer concept transfer over code copy.
- If code is adapted, record source path and rewrite boundary immediately.
- Do not copy whole subsystem directories.
- Do not preserve donor naming unless there is a reason.

---

## 7. What to build first, stub first, and avoid early

### 7.1 Build first

Build these first because they prove the architecture:

- engine adapter
- runtime DB and migrations
- task/job/run model
- run coordinator
- receipts
- basic CLI inspection (`pop`)
- daemon shell (`popeyed`)
- scheduler and heartbeat
- instruction preview

### 7.2 Stub initially

Stub these until the runtime boundary is solid:

- approval workflows
- remote API exposure
- rich UI
- dynamic extension install
- distributed workers
- multi-agent orchestration

### 7.3 Avoid building too early

Avoid these before Phase 8 or later:

- broad channel integrations beyond Telegram
- workflow builder UI
- mobile app
- open plugin model
- full donor compatibility modes
- heavy web dashboard

---

## 8. Delivery model by phase

Each phase includes:

- purpose
- deliverables
- implementation tasks
- dependencies
- risks
- exit criteria

The next phase does not start until the current phase has a credible, testable baseline.

---

## Phase 0 -- Discovery, code reading, and donor analysis

### Purpose

Create an accurate map of:

- what you currently use in OpenClaw
- what Pi already offers
- what must be new
- what to omit

### Deliverables

- `docs/current-openclaw-inventory.md`
- `docs/pi-capability-map.md`
- `docs/openclaw-donor-map.md`
- `docs/omissions.md`
- `docs/domain-model.md`
- `docs/pi-fork-strategy.md`

### Implementation tasks

- Inventory current OpenClaw usage in concrete terms.
- Classify every current dependency as: required, optional, or baggage.
- Map Pi capabilities for: sessions, SDK embedding, context files, event streaming, tools, providers.
- Identify donor categories worth examining: heartbeat, recurring jobs, workspace structure, durable memory, receipts/logging/troubleshooting.
- Create a first-pass domain model for: workspace, project, task, schedule, job, run, receipt, SessionRoot, intervention.

### Dependencies

- Access to current OpenClaw config and workspace.
- Access to Pi fork and docs.

### Risks

- Hidden OpenClaw coupling goes unnoticed.
- Donor ideas are mistaken for mandatory features.
- Too much time is spent reading without classifying.

### Exit criteria

- Every desired feature is classified as Pi reuse / donor / new / omit.
- An omission list exists.
- Domain nouns are defined clearly enough to start implementation.

---

## Phase 1 -- Fork freeze and repo bootstrap

### Purpose

Create the owned technical baseline.

### Deliverables

- Pi fork repo (`pi`) under your control
- Tagged upstream baseline
- Popeye monorepo scaffold (pnpm workspaces + Turborepo)
- Strict TypeScript build/test/lint setup
- Lockfiles and CI
- Base config loader with JSON + Zod validation
- ADR directory and templates
- Keychain integration and secret storage conventions

### Implementation tasks

- Fork Pi into the `pi` repo.
- Tag upstream baseline.
- Apply only minimal fork branding/config changes.
- Decide internal release/version naming strategy.
- Scaffold Popeye monorepo with `pnpm-workspace.yaml` and `turbo.json`.
- Add strict TS config.
- Add linting, formatting, and test CI.
- Add workspace-wide Zod schema validation.
- Create initial `@popeye/*` package skeletons.
- Set up macOS Keychain integration for secret storage.
- Define secret storage conventions (keychain for system secrets, `.env` for per-project, never committed).
- Write:
  - `docs/adr/0001-repo-topology.md`
  - `docs/adr/0002-pi-fork-strategy.md`

### Dependencies

- Phase 0 classification complete.

### Risks

- Unnecessary churn inside Pi fork.
- Package boundaries are too vague.
- CI is weak or inconsistent from the start.

### Exit criteria

- Pi fork builds under your control.
- Popeye repo builds/tests/lints cleanly.
- Engine dependency pinning is in place.
- Fork strategy doc exists.
- Keychain integration works for storing/retrieving secrets.

---

## Phase 2 -- Core runtime shell

### Purpose

Ship the smallest meaningful vertical slice that proves Popeye can submit and observe one Pi-backed run.

### Deliverables

- Initial domain schemas
- SQLite migration framework
- `EngineAdapter` interface
- `PiEngineAdapter` implementation
- Basic manual task submission via `pop` CLI
- Run lifecycle persistence
- Raw run event capture
- First receipt format
- Auth token for control API

### Implementation tasks

- Define schemas for:
  - workspaces
  - projects
  - agent profiles
  - tasks
  - jobs
  - runs
  - receipts
  - SessionRoots
  - memories
  - memory_events
  - memory_embeddings
  - memory_sources
  - memory_consolidations
- Note: memory schemas are created here for migration ordering. Population and retrieval logic is deferred to Phase 5.
- Add migration runner.
- Build fake engine adapter for tests.
- Implement real Pi adapter.
- Capture engine events and persist normalized event records.
- Write minimal `pop task run`, `pop run show`, `pop receipt show` CLI commands.
- Store engine session ref per run.
- Preserve instruction snapshot placeholder even if full resolver is not ready.
- Implement auth token generation and validation for the control API.

### Dependencies

- Phase 1 complete.

### Risks

- Pi assumptions leak beyond the adapter.
- Task/job/run get conflated.
- Receipts are too thin to be useful.

### Exit criteria

- One manual task can be run from `pop` CLI.
- One run persists state and raw events.
- One receipt is generated.
- Memory tables exist in schema and migrations pass.
- Auth token is required for control API access.
- At least one fake-engine integration test and one real Pi smoke test pass.

---

## Phase 3 -- Always-on daemon and heartbeat

### Purpose

Turn the runtime into a service.

### Deliverables

- Daemon bootstrap (`popeyed`)
- Local runtime data root (`~/Library/Application Support/Popeye/`)
- launchd install/start/stop/status support
- Daemon health command or endpoint
- Heartbeat trigger source (default: 1 hour, configurable per-workspace)
- Stale-run reconciliation on startup
- Loopback-only binding (127.0.0.1)

### Implementation tasks

- Build `apps/daemon` (`popeyed`).
- Add service lifecycle CLI commands (`pop daemon install`, `pop daemon start`, `pop daemon stop`, `pop daemon status`).
- Define `daemon_state`.
- Add scheduler wake mechanism.
- Implement lease sweeper.
- Implement dedicated heartbeat SessionRoot with 1-hour default interval, configurable per-workspace.
- Add startup reconciliation logic.
- Add busy/idle state reporting.
- Bind daemon to loopback only (127.0.0.1).
- Write:
  - `docs/runbooks/daemon.md`

### Dependencies

- Phase 2 complete.

### Risks

- Daemon and CLI diverge in behavior.
- Heartbeat pollutes main interactive continuity.
- Stale run recovery is lossy.

### Exit criteria

- Daemon can install and run under launchd.
- Daemon restart is survivable.
- Heartbeat runs on schedule (1-hour default).
- Stale in-flight runs are reconciled predictably.
- Daemon binds to loopback only.

---

## Phase 3.5 -- Telegram channel adapter

### Purpose

Add the first external channel adapter so Popeye can receive and respond to messages via Telegram.

### Deliverables

- `@popeye/telegram` package
- Telegram Bot API integration
- Allowlist-only DM policy
- Message routing through the control API
- Rate limiting

### Implementation tasks

- Build thin Telegram bot adapter that receives messages via Telegram Bot API.
- Implement allowlist-only DM policy (no pairing, no open registration).
- Route incoming Telegram messages through provisional daemon endpoints (formalized in Phase 8's control API).
- Return engine responses back through Telegram.
- Implement rate limiting on inbound messages.
- Add Telegram adapter integration tests.
- Write:
  - `docs/telegram-adapter.md`

### Dependencies

- Phase 3 complete (daemon running, auth token from Phase 2 in place). Telegram connects to provisional daemon endpoints that are formalized in Phase 8.

### Risks

- Telegram API changes break the adapter.
- Rate limiting is too aggressive or too permissive.
- Allowlist management is awkward.

### Exit criteria

- Allowlisted Telegram user can send a message and receive an agent response.
- Non-allowlisted users are rejected silently.
- Messages route through the control API (not direct engine calls).
- Rate limiting is enforced and tested.

---

## Phase 4 -- State, session, and task model

### Purpose

Make orchestration explicit and durable.

### Deliverables

- Explicit Task / Job / Run separation
- Named SessionRoots and session policies
- Job queue and leases
- Retry/backoff
- Pause/resume/cancel support
- Workspace concurrency locks

### Implementation tasks

- Implement job state machine.
- Implement run state machine.
- Add `job_leases` and `locks`.
- Implement retry policy.
- Implement backoff and retry scheduling.
- Implement coalesce keys.
- Implement deterministic SessionRoot selection.
- Add CLI/API inspection for jobs and sessions.
- Write:
  - `docs/domain-model.md`
  - `docs/session-model.md`

### Dependencies

- Phase 3 complete.

### Risks

- State machine complexity grows too early.
- Implicit session reuse creates confusing continuity.
- Lock semantics are underspecified.

### Exit criteria

- Recurring jobs work.
- Delayed one-shot jobs work.
- Retry and backoff work.
- One active run per workspace is enforced by default.
- Session selection rules are test-covered and deterministic.

---

## Phase 5 -- Memory layer

### Purpose

Add durable, inspectable, searchable memory with SQLite-native hybrid retrieval.

### Deliverables

- Memory type modeling (episodic, semantic, procedural, working — working is in-memory only)
- SQLite-native hybrid search (FTS5 + sqlite-vec)
- Confidence scores and decay mechanism
- Memory consolidation (merge redundant, dedup)
- Provenance tracking (every memory links to source run/receipt)
- Compaction flush (runtime intercepts Pi compaction, triggers memory extraction)
- Two-stage retrieval pipeline (fast index then LLM reranking)
- `pop memory audit` CLI command
- `pop memory search` CLI command
- Curated memory file policy (markdown as human-readable layer, explicit promotion)
- Workspace memory conventions
- Daily memory summaries
- Receipt search
- Knowledge/doc indexing

### Implementation tasks

- Define memory directory layout.
- Implement memory type schema (episodic, semantic, procedural) with confidence scores. Working memory is in-memory only and needs no persistence.
- Implement sqlite-vec embedding storage and retrieval.
- Build FTS5 indexes for receipts, memory, and docs.
- Implement two-stage retrieval pipeline: fast index query (FTS5 + sqlite-vec) followed by LLM reranking.
- Implement confidence decay mechanism (time-based, configurable).
- Implement memory consolidation: merge redundant memories, deduplicate, update confidence.
- Implement provenance tracking: every memory record links to its source run/receipt.
- Implement compaction flush: runtime intercepts Pi context compaction events and triggers memory extraction.
- Build receipt-to-daily-summary flow.
- Define memory write policy and curated memory promotion rules.
- Implement `pop memory search` command.
- Implement `pop memory audit` command (shows provenance, confidence, staleness).
- Implement `pop knowledge search` command.
- Implement `pop receipt search` command.
- Add retrieval packaging with source references.
- Add fixtures for retrieval tests, including sqlite-vec retrieval tests.
- Add memory consolidation tests.
- Add confidence decay tests.
- Write:
  - `docs/workspace-conventions.md`
  - `docs/memory-model.md`

### Dependencies

- Phase 4 complete.

### Risks

- Memory and audit records become entangled.
- Index scopes are too fuzzy.
- Consolidation loses important nuance.
- Embedding model choice creates a hard dependency.

### Exit criteria

- Runs retrieve useful workspace/project knowledge via hybrid search.
- Hybrid search (FTS5 + sqlite-vec) returns relevant results under 200ms.
- Operator can inspect where retrieved content came from (provenance).
- Daily summaries are deterministic and readable.
- Memory consolidation merges duplicates without losing provenance.
- Confidence decay reduces stale memory scores over time.
- `pop memory audit` shows memory health and provenance chain.

---

## Phase 6 -- Instruction, identity, workspace, and project system

### Purpose

Make instruction loading deterministic, visible, and product-owned.

### Deliverables

- Instruction resolver
- Workspace registry
- Project registry
- Identity/profile files
- Instruction snapshotting and preview
- Critical control-file write policy

### Implementation tasks

- Define authoritative workspace and project file names.
- Implement precedence and merge rules.
- Store compiled instruction bundles in `instruction_snapshots`.
- Implement preview/diff commands and endpoints.
- Implement workspace/project registration flows.
- Implement cwd routing.
- Define default read-only policy for critical instruction files.
- Optionally build a compatibility import tool for legacy files.
- Write:
  - `docs/instruction-resolution.md`
  - `docs/workspace-routing.md`

### Dependencies

- Phases 2, 4, and 5 complete. Phase 3 (daemon) is not required — instruction resolution is independent of the daemon lifecycle.

### Risks

- Hidden instruction precedence rules.
- Compatibility shims become permanent architecture.
- Critical files remain silently mutable.

### Exit criteria

- Instruction resolution is deterministic and inspectable.
- Operator can explain why a run received a specific instruction.
- Workspace and project routing are explicit.
- Control-file write policy is enforced and tested.

---

## Phase 7 -- Observability, receipts, recovery, intervention, and security audit

### Purpose

Make Popeye operable on bad days, not just good days. Add security audit capability.

### Deliverables

- Structured daemon and run logs
- Richer receipt schema with cost/usage tracking
- Failure taxonomy
- Intervention queue
- Recovery supervisor
- Diagnosis-oriented CLI/API
- Security audit CLI (`pop security audit`)
- Redact-on-write for sensitive patterns in logs and receipts
- Incident response runbook reference

### Implementation tasks

- Define log schema.
- Improve receipt schema to include cost/usage data (token counts, model, estimated cost).
- Classify failure types.
- Implement intervention creation and resolution.
- Add run timelines.
- Implement redact-on-write: detect and redact sensitive patterns (API keys, tokens, secrets) before persisting logs and receipts.
- Implement `pop security audit` command: scans config, file permissions, exposed ports, secret storage.
- Add recovery decisions: retry, block, fail final.
- Implement commands/endpoints:
  - `pop runs tail`
  - `pop runs failures`
  - `pop interventions list`
  - `pop recovery retry`
  - `pop security audit`
- Add security audit tests and redaction tests.
- Write:
  - `docs/runbooks/recovery.md`
  - `docs/runbooks/incident-response.md`
  - `docs/receipt-schema.md`

### Dependencies

- Phase 4 complete.
- Phases 5 and 6 complete before finalizing.

### Risks

- Observability remains too raw or too thin.
- Recovery logic is too clever and hard to trust.
- Intervention queue becomes an afterthought.
- Redaction patterns miss edge cases.

### Exit criteria

- Failures are diagnosable from stored artifacts.
- Intervention queue is usable.
- Raw and summarized records both exist.
- Recovery paths have failure-injection tests.
- Cost/usage data appears in receipts.
- `pop security audit` passes with no critical findings.
- Sensitive patterns are redacted before write in logs and receipts.

---

## Phase 8 -- API and control surface

### Purpose

Freeze a stable client boundary.

### Deliverables

- Versioned local Fastify HTTP API with Zod schema validation
- SSE event stream
- Local auth/token handling
- CSRF protection on all state-changing endpoints
- Sec-Fetch-Site validation
- Telegram message ingress/egress endpoints
- API schemas and docs
- Generated TypeScript client (auto-generated)
- Generated Swift client models (for Phase 9)
- CLI backed by API where appropriate

### Implementation tasks

- Define request/response/event schemas with Zod.
- Implement Fastify server with Zod validation on all routes.
- Implement auth token flow.
- Implement SSE event stream.
- Add CSRF protection on all state-changing endpoints.
- Add Sec-Fetch-Site validation.
- Add Telegram message ingress/egress endpoints (receive from adapter, send responses back).
- Generate TypeScript client automatically.
- Generate Swift client models for Phase 9.
- Add CSRF tests.
- Document versioning and compatibility rules.
- Keep API surface intentionally small.
- Write:
  - `docs/control-api.md`
  - `docs/adr/0003-control-api-boundary.md`

### Dependencies

- Phases 3-7 complete.
- Phase 3.5 complete (for Telegram endpoints).

### Risks

- Raw internal schema leaks through API.
- Versioning starts too late.
- Clients begin relying on unstable details.

### Exit criteria

- CLI operates through the API for key workflows.
- At least one external client can inspect live state.
- Event stream supports live run updates.
- Telegram messages route through the API successfully.
- CSRF protection blocks cross-origin state-changing requests.
- API contracts are versioned and documented.

---

## Phase 9 -- First UI

### Purpose

Validate the API boundary with real operator clients.

### Deliverables

- **Primary:** Minimal local web inspector (`@popeye/web-inspector`)
- **Secondary:** Thin Swift macOS inspection client

Both use the same control API. The web inspector ships first; the Swift app follows.

### Implementation tasks

- Build web inspector views for:
  - daemon status
  - active runs
  - job queue
  - run timeline
  - receipt viewer
  - instruction preview
  - intervention queue
  - memory search
- Ensure all client logic uses the control API (no direct file reads).
- Build a dedicated Swift `ControlAPIClient` using the generated Swift models.
- Validate daemon management experience on macOS.
- Write:
  - `docs/ui-surface.md`

### Dependencies

- Phase 8 complete.

### Risks

- UI pressures backend into leaking internals.
- Swift app starts reading files directly.
- Product semantics end up scattered across multiple clients.

### Exit criteria

- Live run state can be observed from web inspector.
- Receipts open from UI.
- Pause/resume/retry/cancel work through the API.
- At least one non-CLI client proves the API boundary is real.

---

## Phase 10 -- Polish, packaging, migration, and hardening

### Purpose

Turn Popeye into something you can live with for years.

### Deliverables

- Packaging/install flow
- Backup/export/import path
- Migration notes/tools from current OpenClaw usage
- Pi upgrade compatibility suite
- Operator runbooks
- Error message cleanup and operational polish
- Security hardening review
- File permission enforcement

### Implementation tasks

- Harden launchd installation and status flows.
- Build backup/export commands (`pop backup create`, `pop backup restore`).
- Document restore flow.
- Add migration helpers for selected workspace/memory artifacts.
- Create Pi upgrade compatibility suite.
- Document upgrade procedure.
- Profile startup, worker spawn, and indexing costs.
- Conduct security hardening review: file permissions, socket permissions, token rotation, secret exposure.
- Enforce file permission policy on runtime data directory.
- Write:
  - `docs/migration/openclaw.md`
  - `docs/migration/qmd-replacement.md`
  - `docs/migration/telegram-bot.md`
  - `docs/runbooks/upgrades.md`
  - `docs/runbooks/backup-restore.md`

### Dependencies

- Phases 0-9 complete.

### Risks

- Packaging hides weak operational behavior.
- Migration drags donor assumptions into the product.
- Upgrades remain emotionally expensive.

### Exit criteria

- Clean bootstrap on a new machine is documented.
- Backup and restore work.
- Upgrade runbook exists and is test-backed.
- Migration path from current OpenClaw setup is explicit.
- Security hardening review passes with no critical findings.
- File permissions on runtime data are enforced.

---

## 9. Test strategy by phase

### 9.1 General test posture

Use multiple test layers:

- Unit tests for pure logic.
- Integration tests for orchestration.
- Smoke tests for real Pi interaction.
- Failure-injection tests for recovery.
- Contract tests for API.
- Client integration tests for UI.

### 9.2 Phase-specific emphasis

| Phase | Priority tests |
|---|---|
| 0-1 | Repo bootstrap smoke tests, doc review checklists |
| 2 | Fake-engine integration tests, one real Pi smoke test |
| 3 | Daemon lifecycle tests, worker kill/restart tests |
| 3.5 | Telegram adapter integration tests, allowlist enforcement tests, rate limiting tests |
| 4 | Job state machine tests, retry/backoff tests, session selection golden tests |
| 5 | sqlite-vec retrieval tests, FTS5 retrieval tests, memory consolidation tests, confidence decay tests, daily summary generation tests |
| 6 | Instruction precedence golden tests, snapshot hash tests, file policy tests |
| 7 | Failure-injection tests, intervention queue tests, reconciliation tests, security audit tests, redaction tests |
| 8 | API contract tests, auth tests, SSE stream tests, CSRF tests, Telegram endpoint tests |
| 9 | Mock-client integration tests, one live UI smoke flow |
| 10 | Packaging smoke tests, backup/restore tests, Pi upgrade suite, security hardening tests |

---

## 10. Milestone demos

### Demo 1 -- Thin vertical slice

Manual task from `pop` CLI -> Pi-backed run -> receipt.

### Demo 1.5 -- Telegram channel

Telegram message -> agent run -> Telegram response (allowlist-only).

### Demo 2 -- Always-on core

launchd-managed `popeyed` -> status command -> heartbeat run -> stale-run recovery.

### Demo 3 -- Scheduling and retries

Recurring job -> failure -> retry with backoff -> intervention after retry budget exhausted.

### Demo 4 -- Memory and instructions

Instruction preview -> retrieval from workspace/project docs with hybrid search (FTS5 lexical + sqlite-vec semantic) -> resulting receipt with sources and provenance.

### Demo 5 -- API boundary proof

Web inspector and/or Swift client shows live run state and opens receipt without reading runtime files directly.

---

## 11. Agent usage by phase

### 11.1 Good uses for agents

Use agents for:

- Repo reading and feature inventory.
- Schema drafting.
- Migration scaffolding.
- Adapter plumbing.
- Test fixture generation.
- API schema generation.
- CLI boilerplate.
- Swift model/client scaffolding.
- Runbook drafting.
- Telegram adapter implementation.
- Memory layer implementation.

### 11.2 Human-review checkpoints

Require human review for:

- Fork strategy decisions.
- Package boundaries.
- State machine semantics.
- Critical file write policy.
- Migration mapping.
- Security posture changes.
- Any donor code adoption.
- Telegram allowlist policy.
- Memory consolidation rules.

### 11.3 Agent limits

Do not let agents:

- Quietly invent new architecture layers.
- Import donor subsystems wholesale.
- Bypass tests because "it looks right."
- Modify Pi fork and runtime core in the same uncontrolled sweep.
- Create compatibility shims without documenting them.
- Weaken security controls to make tests pass.

---

## 12. Docs and files to create during implementation

- `docs/current-openclaw-inventory.md`
- `docs/pi-capability-map.md`
- `docs/openclaw-donor-map.md`
- `docs/omissions.md`
- `docs/domain-model.md`
- `docs/session-model.md`
- `docs/pi-fork-strategy.md` (Phase 0 — planning rationale)
- `docs/pi-fork-delta.md` (ongoing — tracks every fork patch)
- `docs/workspace-conventions.md`
- `docs/workspace-routing.md`
- `docs/memory-model.md`
- `docs/instruction-resolution.md`
- `docs/receipt-schema.md`
- `docs/control-api.md`
- `docs/ui-surface.md`
- `docs/telegram-adapter.md`
- `docs/migration/openclaw.md`
- `docs/migration/qmd-replacement.md`
- `docs/migration/telegram-bot.md`
- `docs/runbooks/daemon.md`
- `docs/runbooks/recovery.md`
- `docs/runbooks/incident-response.md`
- `docs/runbooks/upgrades.md`
- `docs/runbooks/backup-restore.md`
- `docs/adr/*.md`

---

## 13. Migration notes from current OpenClaw usage

### 13.1 Migrate early

Migrate these first because they carry enduring value:

- Durable memory files.
- Useful heartbeat checklists.
- Important project/workspace docs.
- Identity/persona content.
- Recurring task definitions.
- Manually curated knowledge sources.

### 13.2 Do not migrate early

Do not bring these over immediately:

- Raw donor session transcripts.
- Donor config structure wholesale.
- Channel settings.
- Broad plugin/skill sprawl.
- Donor UI expectations.
- Gateway-specific routing semantics.

### 13.3 Migration sequence

1. Inventory current OpenClaw usage.
2. Rewrite instructions into the new model.
3. Import durable memory and knowledge.
4. Recreate essential schedules manually.
5. Create fresh SessionRoots in Popeye.
6. Run `popeyed` in observation mode first.
7. Only enable write-affecting automation once receipts and recovery feel trustworthy.

### 13.4 Compatibility posture

Migration is allowed. Compatibility is not the product.

If an import tool is created, it is a **one-way migration helper**, not a permanent compatibility layer.

### 13.5 QMD replacement

Popeye's built-in memory database (SQLite + FTS5 + sqlite-vec) replaces QMD for all knowledge search within the Popeye runtime. QMD continues to serve other uses outside Popeye until all consumers are migrated.

### 13.6 Telegram bot migration

The existing Telegram bot migrates to the `@popeye/telegram` adapter:

- New bot token (registered under Popeye identity).
- New adapter (`@popeye/telegram`).
- Same allowlist policy carries forward.
- Old bot is decommissioned after validation.

---

## 14. First implementation slice

The exact first practical slice:

1. Scaffold Popeye repo with pnpm workspaces and Turborepo.
2. Implement fake engine adapter.
3. Implement real Pi adapter.
4. Add manual CLI task submission (`pop task run`).
5. Persist one run and one receipt.
6. Add daemon bootstrap (`popeyed`).
7. Add heartbeat (1-hour default).
8. Add live status command (`pop daemon status`).

This sequence is the fastest way to prove there is a real product core.

---

## 15. Definition of done for the first usable Popeye

The first usable Popeye exists when all of the following are true:

- `popeyed` can be started and stopped repeatably.
- One workspace can be registered and routed correctly.
- Manual tasks can execute through Pi.
- Heartbeat can run on its own continuity.
- Scheduled jobs can run and retry.
- Receipts and logs explain what happened.
- Cost/usage data appears in receipts.
- Instruction preview works.
- Failures become interventions instead of disappearing.
- Memory hybrid search returns relevant results under 200ms.
- Telegram messages route through the control API successfully.
- `pop security audit` passes with no critical findings.
- A UI client can inspect live state through the control API.

---

## 16. Security posture by phase

Security is not a late-stage concern. Each phase has explicit security work:

| Phase | Security work |
|---|---|
| 1 | Keychain integration, secret storage conventions |
| 2 | Auth token for control API from day one |
| 3 | Loopback-only binding (127.0.0.1) |
| 3.5 | Telegram allowlist enforcement |
| 7 | Security audit CLI, redact-on-write, incident response runbook |
| 8 | CSRF protection, Sec-Fetch-Site validation on all state-changing endpoints |
| 10 | Security hardening review, file permission enforcement |

---

## 17. Execution notes for coding agents

When a coding agent executes this plan, it states:

- The phase it is working in.
- What artifact or acceptance criterion it is targeting.
- Whether the change belongs to Pi, runtime, or UI.
- Whether the change is reuse, donor adaptation, or new implementation.
- What tests and docs were updated.

This requirement is mandatory because Popeye optimizes for ownership, not just for code generation speed.
