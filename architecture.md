# architecture.md

**Document status:** locked architecture specification
**Audience:** human builders, coding agents, future UI/API contributors
**Primary design rule:** **Pi = engine, runtime/Popeye = product, OpenClaw = donor**

---

## 1. Executive summary

Popeye is a **three-layer system with a hard product boundary**:

1. **Pi fork** provides the engine foundation: model/provider abstraction, agent runtime, tool calling, session mechanics, and SDK/process integration.
2. **Popeye runtime** provides the product semantics: always-on daemon (`popeyed`), scheduler, heartbeat loop, session orchestration, instruction resolution, memory contracts, receipts, audit, recovery, and policy enforcement.
3. **Interfaces** provide replaceable operator surfaces: CLI (`pop`) and Telegram adapter first, then a local web inspector and a Swift macOS client.

The central architectural decision is to **avoid two traps**:

- do **not** rebuild an agent engine from scratch when Pi already supplies one
- do **not** recreate OpenClaw wholesale inside Pi or inside the runtime

Instead:

- **reuse Pi where it is already the right abstraction**
- **borrow only selected concepts from OpenClaw**
- **implement a thin, owned runtime layer that becomes the actual product**

The result is a system you own end to end: minimal, explicit, observable, locally controlled, and resilient to upstream churn.

---

## 2. Assumptions

- Primary target environment is **macOS**.
- Backend/runtime is **TypeScript/Node 22 LTS**, because Pi already exists there.
- Monorepo managed with **pnpm + Turborepo**.
- Deployment model is **local-first** and **single trusted operator** by default.
- The runtime executes tools and code with meaningful host access; this is not a hostile multi-tenant design.
- The first fully useful version is **CLI/admin-first**, with a control API that later supports a Swift macOS client.
- The Pi fork lives in a **separate repo** and is updated on an explicit cadence rather than continuously tracking upstream.
- Popeye does **not** maintain OpenClaw config or runtime compatibility as an external promise.
- **Telegram is the primary conversational surface** (allowlist-only). CLI, web, and Swift are for inspection and admin.

---

## 3. Goals and non-goals

## 3.1 Goals

### Core goals

- fully owned agent stack
- stable long-term architecture
- minimal surprise from upstream behavior changes
- clear product boundary
- easy maintenance and debugging
- explicit invariants
- local-first deployment posture
- strong observability and auditability
- extensible platform, not a hardcoded one-off flow

### Functional goals

- always-on daemon (`popeyed`)
- heartbeat / recurring agent loop (default: 1 hour, configurable per-workspace)
- durable state and persistent sessions
- workspace/project routing
- structured instruction loading
- layered memory handling with SQLite-backed semantic/episodic/procedural memory
- task scheduling and cron-like execution
- receipts, logs, audit trail, cost/usage tracking, and failure visibility
- clear manual intervention points
- decoupled UI surface
- Telegram adapter as the primary conversational channel
- optional additional adapters only when justified

### Product goals

- the system feels like **your platform**
- backend/runtime/UI can evolve independently
- UI does not depend on internal runtime storage layout
- you start with CLI/admin tooling and grow into a polished desktop app
- Swift desktop UI is a first-class target, not a throwaway note
- Telegram is a thin bridge to the control API, not a port of OpenClaw's channel ecosystem

## 3.2 Non-goals

- rebuilding a general-purpose agent engine from scratch
- recreating all of OpenClaw
- preserving donor config schemas for compatibility
- adversarial multi-tenant deployment in v1
- plugin marketplace or arbitrary third-party package install in v1
- distributed workers or cluster scheduling in v1

---

## 4. Design principles

### 4.1 Pi remains the engine

Pi is responsible for engine-level concerns:

- provider/model abstraction
- agent loop mechanics
- tool execution plumbing
- session tree / branch / compaction mechanics
- SDK integration points
- context file support where useful

The runtime does not reimplement these unless there is a proven gap.

### 4.2 The runtime is the product

Anything that gives the system its long-term identity belongs in the runtime layer:

- daemon lifecycle
- job orchestration
- heartbeat semantics
- session policy
- instruction resolution
- receipts and audit
- memory contracts
- recovery logic
- operator-facing APIs
- security enforcement

### 4.3 Operational state is explicit

Every durable concept has a clear home:

- declarative config
- operational DB
- engine session store
- workspace/project files
- logs / receipts / indexes

No hidden state decides behavior.

### 4.4 Stable boundaries beat cleverness

Interfaces between layers are narrow and versioned:

- runtime talks to Pi through an engine adapter
- UI talks to runtime through a control API
- Telegram adapter routes through the control API, not directly to Pi
- workspace files are not used as an ad hoc substitute for runtime state

### 4.5 Prefer omission over speculative extensibility

A subsystem must justify itself. If a feature does not clearly reduce friction or risk, do not include it.

### 4.6 Prompt text is not policy

If something matters operationally, enforce it in code. Prompting may influence behavior, but it is not the only line of defense for invariants.

### 4.7 Critical control files are operator-owned by default

Instruction files and platform control files such as `WORKSPACE.md`, `PROJECT.md`, `IDENTITY.md`, and `HEARTBEAT.md` are **operator-owned content**. Agent writes to those files are blocked by default or routed through an explicit, receipted workflow.

### 4.8 Audit records live outside the workspace

Logs, receipts, intervention records, and operational metadata do not rely on agent-editable workspace files for integrity.

---

## 5. System layers

| Layer | Role | Owned by | Contents |
|---|---|---|---|
| Layer 1 | Engine | Pi fork | model/provider abstraction, agent sessions, tool calling, compaction, context file support, SDK/process embedding |
| Layer 2 | Product core | Popeye | daemon, scheduler, heartbeat, session orchestration, instruction resolution, memory services, receipts, audit, recovery, policy enforcement, security, control API |
| Layer 3 | Interfaces | Popeye | CLI (`pop`), Telegram adapter, local web inspector, Swift macOS app, optional API clients |

### Boundary statement

- **Pi is not the product**
- **OpenClaw is not the architecture**
- **the runtime is the product core**
- **all clients see the runtime, not Pi internals**

### System topology

```text
+-------------------------------------------+
| CLI (pop) | Telegram | Web Inspector | Swift |
+-------------------+-----------------------+
                    |
                    v
+-------------------------------------------+
| Local Control API (Fastify) + SSE         |
+-------------------+-----------------------+
                    |
                    v
+-------------------------------------------------------------+
| Popeye Runtime / Platform Core                              |
| daemon | scheduler | run-coordinator | sessions | memory    |
| instructions | receipts | observability | recovery          |
| security | cost tracking                                    |
+-------------------------+-----------------------------------+
                          |
                          v
+-------------------------------------------------------------+
| Engine Adapter (Pi boundary)                                |
+-------------------------+-----------------------------------+
                          |
                          v
+-------------------------------------------------------------+
| Pi Fork / Worker Process(es)                                |
| providers | agent loop | tools | sessions | compaction      |
+-------------------------------------------------------------+
```

---

## 6. Major components

## 6.1 Core runtime components

| Component | Responsibility | Persistence touched | Notes |
|---|---|---|---|
| `daemon` | service lifecycle, bootstrapping, loop ownership | config, DB, logs | always-on process (`popeyed`) |
| `engine-adapter` | maps runtime requests to Pi execution | Pi sessions, run events | only runtime package allowed to know Pi details |
| `run-coordinator` | owns one execution attempt | DB, receipts, logs | turns a job into a run |
| `scheduler` | due-time calculation, leasing, retry windows | DB | no business logic outside schedule/routing |
| `heartbeat-service` | low-cost periodic attention loop (default: 1 hour) | DB, dedicated session root | implemented as a specialized trigger source |
| `session-registry` | product session model and mapping to Pi sessions | DB | separates product sessions from engine session refs |
| `instruction-resolver` | builds the final instruction bundle for a run | DB, workspace files | hashes and snapshots all inputs |
| `workspace-manager` | workspace/project registration and path routing | DB, config | resolves current working directory and scope |
| `memory-service` | durable memory lookup, extraction, consolidation, retrieval | SQLite memory DB, workspace files, FTS5, sqlite-vec | two-layer memory (markdown + SQLite) |
| `receipt-service` | immutable run summaries and artifacts including cost/usage | DB, receipts store | every run gets a receipt |
| `event-log` | append-only structured events | log files, DB indexes | used by CLI, API, UI |
| `recovery-supervisor` | restart reconciliation and retry decisions | DB | never silently loses failed work |
| `control-api` | local versioned control plane (Fastify) | DB, logs | only interface UI/CLI/Telegram should depend on |
| `runtime-tools` | runtime-owned tools surfaced to agent | runtime services | e.g. memory search, receipt lookup |
| `telegram-adapter` | thin bridge between Telegram and control API | none (stateless bridge) | allowlist-only, rate-limited |
| `security-service` | auth tokens, CSRF, redaction, audit | DB, config | fail-closed enforcement |

## 6.2 Supporting components

| Component | Responsibility |
|---|---|
| `config-loader` | strict JSON parsing and Zod validation of config |
| `auth-store` | operator-side auth token / local secret references |
| `migration-runner` | DB schema migrations and compatibility checks |
| `testkit` | fake engine, fixture workspaces, integration helpers |
| `packaging/install` | launchd install/uninstall/start/stop/status helpers |

---

## 7. Major boundaries and interfaces

## 7.1 Runtime <> Pi boundary

The runtime depends on a narrow contract:

```ts
type RunRequest = {
  workspaceId: string;
  projectId?: string;
  sessionPolicy: SessionPolicy;
  instructionSnapshotId: string;
  cwd: string;
  modelOverride?: string;
  trigger: TriggerDescriptor;
  taskBrief: string;
  runtimeTools: RuntimeToolDescriptor[];
};

type EngineRunHandle = {
  runId: string;
  sessionRef?: string;
  events: AsyncIterable<EngineEvent>;
  cancel(): Promise<void>;
};

type SessionPolicy =
  | { type: 'dedicated'; rootId: string }    // use specific SessionRoot
  | { type: 'ephemeral' }                     // no continuity
  | { type: 'per_task'; taskId: string };     // one SessionRoot per task

type TriggerDescriptor = {
  source: 'manual' | 'heartbeat' | 'schedule' | 'telegram' | 'api';
  originId?: string;       // e.g., Telegram message ID, schedule ID
  timestamp: string;       // ISO 8601
};

type RuntimeToolDescriptor = {
  name: string;            // e.g., 'memory_search', 'receipt_lookup'
  description: string;
  inputSchema: unknown;    // Zod-generated JSON Schema at runtime
};

type EngineEvent =
  | { type: 'session_started'; sessionRef: string; timestamp: string }
  | { type: 'tool_call'; toolName: string; input: unknown; timestamp: string }
  | { type: 'tool_result'; toolName: string; output: unknown; timestamp: string }
  | { type: 'text_chunk'; content: string; timestamp: string }
  | { type: 'completion'; result: 'success' | 'error'; summary?: string; timestamp: string }
  | { type: 'error'; code: string; message: string; retryable: boolean; timestamp: string }
  | { type: 'compaction'; beforeTokens: number; afterTokens: number; timestamp: string }
  | { type: 'cost_update'; inputTokens: number; outputTokens: number; model: string; timestamp: string };
```

Required adapter responsibilities:

- create or select Pi session
- launch execution
- stream engine events
- return final outcome
- expose enough metadata for inspection

The runtime does **not** let Pi details leak into the rest of the system.

## 7.2 Runtime <> UI boundary

Clients interact only with a **local control API**, never with:

- Pi session JSONL files
- internal SQLite schema
- workspace path heuristics
- ad hoc file tailing of raw logs

The UI thinks in product-level nouns:

- workspaces
- projects
- agent profiles
- tasks
- jobs
- runs
- receipts
- interventions
- instruction previews
- health/status
- cost/usage summaries

## 7.3 Workspace <> operational state boundary

**Workspace content** is for human/agent collaboration and durable knowledge.

**Operational state** is for orchestration, audit, and control.

This distinction is hard:

| Belongs in workspace | Belongs in operational state |
|---|---|
| `WORKSPACE.md` | current job lease state |
| `PROJECT.md` | run status |
| `MEMORY.md` | raw event log |
| knowledge docs | instruction snapshot hashes |
| user-curated identity files | retry counters |
| project files | receipts |
| day notes | interventions |
| | cost/usage records |

---

## 8. Runtime model

## 8.1 Trigger sources

A run is created by one of the following trigger sources:

- manual operator request (CLI or API)
- scheduled/cron trigger
- heartbeat trigger
- retry/recovery trigger
- Telegram message (routed through control API)
- future: webhook / inbox / file watcher trigger

Each trigger is normalized into the same internal `Task -> Job -> Run` flow.

## 8.2 Canonical lifecycle

1. **Trigger arrives**
2. **Task intent is normalized**
3. **Job record is created or selected**
4. **Scheduler leases the job**
5. **Run record is created**
6. **Instruction snapshot is resolved**
7. **Session root is selected**
8. **Engine worker is started**
9. **Events stream into logs + DB**
10. **Run finalizes**
11. **Receipt is written (including cost/usage)**
12. **Memory extraction runs**
13. **Retry, follow-up, or intervention is scheduled if needed**

## 8.3 Product nouns

### Task

A durable statement of intent.

Examples:

- "daily project scan"
- "manual research request"
- "heartbeat check"
- "reconcile failed run"
- "Telegram conversation thread"

### Job

A schedulable executable instance or recurring schedule-backed work item.

### Run

A single attempt to execute a job.

### SessionRoot

A long-lived continuity container selected by product policy.

### Receipt

An immutable summary of what happened during a run, including cost/usage data.

### Intervention

A human action request generated by the platform when the system cannot or should not proceed automatically.

---

## 9. Process model

## 9.1 Process topology

The v1 process model:

- **one daemon process (`popeyed`)**
- **one worker child process per active run**
- **local HTTP API served by daemon (Fastify)**
- **SSE stream for live updates**
- **CLI (`pop`), Telegram adapter, and Swift/web clients connect to daemon**

Why this topology:

- crash isolation between runtime and engine
- easier worker restart semantics
- easier raw event capture
- simpler future replacement of engine or worker implementation
- better operational clarity than deep in-process embedding

## 9.2 Future process topology

Later, if needed:

- worker pool
- per-workspace concurrency caps
- optional in-process SDK adapter
- optional remote worker host
- stronger workspace isolation with dedicated OS users or VMs

## 9.3 Daemon lifecycle

### Startup

- read config (JSON + Zod validation)
- open DB and run migrations
- verify runtime directories
- initialize workspace registry
- reconcile stale leases/runs
- start scheduler timers
- expose local control API
- report ready state

### Steady state

- sleep until next due event or API action
- keep job lease sweeper active
- monitor active worker processes
- update live state summaries

### Shutdown

Shutdown procedure on SIGTERM or `pop daemon stop`:

1. **Drain** — stop taking new leases, stop scheduler timers (immediate)
2. **Signal workers** — send SIGTERM to all active worker child processes
3. **Grace period** — wait up to 30 seconds for workers to complete or acknowledge cancellation
4. **Force kill** — SIGKILL any workers still running after grace period
5. **Persist** — for each in-flight run: write partial receipt with last-known state, mark run as `abandoned` if not cleanly terminated
6. **Flush** — flush all pending log writes and DB WAL checkpoint
7. **Release** — close DB connections, release file locks, close HTTP server
8. **Exit** — exit with code 0 (clean) or 1 (forced/unclean)

If the daemon is killed with SIGKILL (no graceful shutdown), startup reconciliation (Section 19.3) handles recovery.

## 9.4 launchd integration for macOS

Use a **per-user LaunchAgent**:

- starts at login or on demand
- loopback-only API
- runtime data under `~/Library/Application Support/Popeye/`
- service management through `pop` CLI wrapper

---

## 10. Always-on architecture details

## 10.1 Scheduling posture

The daemon is **not** a busy polling loop. It uses:

- event-driven control actions
- time-driven scheduling for due jobs
- a calculated next-wake timestamp
- small lease sweep intervals

This gives stable, low-noise always-on behavior.

## 10.2 Worker liveness

Every running run maintains a **lease heartbeat**:

- daemon records `lease_owner` (PID) and `lease_expires_at` in `job_leases`
- lease TTL: **60 seconds** (configurable)
- daemon refreshes the lease every **15 seconds** by checking worker PID liveness (`kill -0`)
- if the worker process has exited, the run is immediately marked `abandoned`
- if the lease expires without refresh (daemon was also down), startup reconciliation handles it (Section 19.3)
- grace period after worker SIGTERM: **30 seconds** before escalating to SIGKILL
- recovery decision follows the matrix in Section 19.3

## 10.3 Manual intervention points

The daemon surfaces clear signals when it cannot continue automatically:

- credentials missing
- instruction resolution conflict
- workspace misconfiguration
- policy violation
- external tool failure needing judgment
- retry budget exhausted

These appear as **interventions**, not as silent dead ends.

## 10.4 Visibility into current activity

The control plane answers:

- what is running now?
- why is it running?
- which workspace/project is it touching?
- which session root is being used?
- which instructions were resolved?
- what tools have run so far?
- is it healthy, blocked, retrying, or waiting?
- what has it cost so far?

---

## 11. State and storage model

Explicit storage classes.

## 11.1 Declarative config

Purpose:

- install/runtime settings
- workspace registration
- model defaults
- retry limits
- API bind settings
- feature flags
- heartbeat interval (default: 1 hour)
- redaction patterns

Properties:

- validated at startup via Zod
- strict schema
- versioned
- small and human-readable

Format: **JSON with Zod schema validation** at load time.

## 11.2 Operational state (SQLite)

Purpose:

- orchestration source of truth
- durable state across crashes
- query surface for CLI/API/UI

SQLite settings:

- WAL mode
- foreign keys enabled
- deterministic migrations
- append-only logs plus current-state tables

### Tables

| Table | Purpose |
|---|---|
| `daemon_state` | service metadata, schema version, last startup/shutdown |
| `workspaces` | registered workspaces |
| `projects` | project registry and routing info |
| `agent_profiles` | identity/profile metadata |
| `tasks` | durable intent definitions |
| `schedules` | cron/interval config for recurring tasks |
| `jobs` | queued and schedulable executable items |
| `runs` | one execution attempt |
| `run_events` | normalized event stream records |
| `run_outputs` | file changes / artifact summaries if needed |
| `receipts` | immutable run summaries including cost/usage |
| `instruction_snapshots` | resolved instruction bundles + hashes |
| `session_roots` | product-level session containers |
| `job_leases` | active job/run leases |
| `locks` | workspace/project concurrency locks |
| `interventions` | manual action queue |
| `memories` | extracted/consolidated memory units with type, content, description, confidence, source, scope, timestamps |
| `memory_events` | raw memory lifecycle events (created, reinforced, decayed, promoted, archived) |
| `memory_embeddings` | vector embeddings for semantic search (sqlite-vec) |
| `memory_sources` | links memories to origin (run, receipt, daily note, manual entry) |
| `memory_consolidations` | merge/dedup operations with before/after |
| `retrieval_cache` | optional cached retrieval metadata |
| `security_audit` | auth failures, policy violations, redaction events |

## 11.3 Engine state (Pi)

Purpose:

- session JSONL or equivalent
- branch summaries / compaction artifacts
- engine-local metadata

Rule:

- the runtime may reference engine state
- the runtime does not make engine state the primary orchestration store

## 11.4 Workspace state (filesystem)

Purpose:

- long-lived human/agent collaboration
- instructions
- curated memory (MEMORY.md, daily notes)
- knowledge docs
- outputs

## 11.5 Log and receipt stores

Structure:

```text
~/Library/Application Support/Popeye/
  config/
  state/
    app.db
    memory.db
    indexes/
  logs/
    daemon.jsonl
    runs/
  receipts/
    by-run/
    by-day/
  engine/
    # if you choose to mirror or relocate engine data
```

---

## 12. Session model

Separate **product sessions** from **engine sessions**.

## 12.1 Product-level session concepts

### SessionRoot

A named continuity scope, such as:

- `interactive/main`
- `system/heartbeat`
- `project/<projectId>/main`
- `scheduled/<taskId>`
- `recovery/<taskId>`
- `telegram/<userId>`

### Run

A single attempt against a SessionRoot.

## 12.2 Engine session concepts

Pi session refs, branches, files, and compaction are engine details. The runtime stores references to them but does not expose them as the product's primary abstraction.

## 12.3 Session policies

| Use case | Policy |
|---|---|
| interactive/manual work | reuse a stable `interactive/main` SessionRoot |
| heartbeat | use dedicated `system/heartbeat` SessionRoot |
| recurring scheduled task with continuity | one SessionRoot per task |
| one-shot/manual automation | ephemeral or ad hoc SessionRoot |
| recovery | dedicated recovery SessionRoot or explicit branch |
| Telegram conversation | per-user `telegram/<userId>` SessionRoot |

## 12.4 Session invariants

- heartbeat does not reuse the main interactive continuity by default
- session selection is deterministic given run inputs
- engine session refs are stored for every stateful run
- a run never guesses its session root from cwd alone

---

## 13. Memory model

Two-layer architecture: a human-readable markdown layer and a machine-queryable SQLite memory database.

## 13.1 Markdown layer (human-readable)

- `MEMORY.md` — curated workspace knowledge
- `memory/daily/YYYY-MM-DD.md` — daily notes
- Knowledge docs in workspace

The operator reads and writes markdown files directly. The agent writes via explicit promotion workflows only.

## 13.2 SQLite memory DB (machine-queryable)

Tables (in `memory.db`):

- **`memories`** — extracted/consolidated memory units with type, content, description, confidence, source, scope, dedup key, timestamps
- **`memory_events`** — raw lifecycle events (created, reinforced, decayed, promoted, archived)
- **`memory_embeddings`** — vector embeddings for semantic search (sqlite-vec)
- **`memory_sources`** — links memories to origin (run, receipt, daily note, manual entry)
- **`memory_consolidations`** — merge/dedup operations with before/after snapshots

## 13.3 Memory types

| Type | Description | Storage |
|---|---|---|
| **Episodic** | what happened — receipts, run events, conversation snapshots | SQLite |
| **Semantic** | what is known — extracted facts, preferences, decisions | SQLite + markdown |
| **Procedural** | how to do things — learned workflows, correction patterns | SQLite + markdown |
| **Working** | current context — compiled instructions, retrieved snippets, tool outputs | in-memory only, not persisted |

## 13.4 Retrieval pipeline

Two-stage retrieval, target latency <200ms:

1. **Fast index:** FTS5 (lexical) + sqlite-vec (semantic) in parallel, union results
2. **Rerank:** relevance to task + recency + confidence + scope match
3. **Filter:** workspace/project scope, memory type, minimum confidence
4. **Package:** descriptions first (progressive disclosure), full content on demand

## 13.5 Memory lifecycle

1. **Capture** at run end (automatic extraction from receipts and conversation)
2. **Daily notes** written (human-readable log of activity)
3. **Explicit promotion** to curated memory (requires diff + receipt)
4. **Periodic consolidation** (merge redundant, decay confidence, archive stale)

## 13.6 Key properties

- **sqlite-vec** for embeddings (lightweight, no external service)
- Every memory has **provenance** (source run, timestamp, confidence)
- **Confidence decay** formula: `score = initial_confidence × 0.5^(days_since_last_reinforcement / half_life_days)`. Default half-life: 30 days. Memories below 0.1 confidence are archived. Reinforcement (re-extraction or manual confirmation) resets `days_since_last_reinforcement` to 0 and may increase `initial_confidence` up to 1.0.
- Consolidation **merges redundant** memories
- **Dedup keys** prevent storing the same fact repeatedly
- **Scope**: workspace, project, or global
- **Compaction flush**: runtime intercepts Pi compaction, triggers memory extraction

## 13.7 Memory write policy

- Runtime always writes receipts (automatic)
- Runtime writes daily summaries (automatic)
- Agent may update curated memory only via explicit promotion workflow (diff + receipt required)
- Critical instruction files are read-only by default
- Self-review/learnings: agent can append
- Sensitive data is redacted before memory storage (see Section 22)

---

## 14. Heartbeat model

Heartbeat is **not** just another cron job.

## 14.1 Meaning of heartbeat

Heartbeat means:

- a lightweight recurring attention pass
- low-cost, bounded instructions
- dedicated session continuity
- the ability to surface "nothing to do" without noisy output

## 14.2 Heartbeat design

Default interval: **1 hour**, configurable per-workspace.

Inputs:

- dedicated `HEARTBEAT.md`
- optional workspace health rules
- optional active-hours window
- optional lightweight context mode

Outputs:

- `no_action`
- `action_taken`
- `followup_scheduled`
- `alert_required`
- `blocked`

## 14.3 Heartbeat scheduling rules

- dedicated low-priority trigger source
- coalesce overlapping heartbeat jobs
- skip if the same workspace already has a non-heartbeat active run
- optionally suppress "OK" events in operator UI unless configured otherwise

## 14.4 Heartbeat session policy

Dedicated `system/heartbeat` SessionRoot.

Do **not** pollute the main interactive session unless that is an explicit operator choice.

---

## 15. Scheduling and job model

## 15.1 Canonical types

### Task

Stable intent definition.

### Schedule

Timing policy for recurring tasks.

### Job

An executable queued or due instance.

### Run

A single attempt with outcomes, receipts, and cost/usage tracking.

## 15.2 Job state machine

### States

| State | Terminal? |
|---|---|
| `queued` | no |
| `leased` | no |
| `running` | no |
| `waiting_retry` | no |
| `paused` | no |
| `blocked_operator` | no |
| `succeeded` | yes |
| `failed_final` | yes |
| `cancelled` | yes |

### Transitions

| From | To | Trigger | Side-effect |
|---|---|---|---|
| `queued` | `leased` | scheduler picks job | set `lease_owner`, `lease_expires_at` |
| `leased` | `running` | worker confirms execution started | create Run record |
| `running` | `succeeded` | run completes successfully | release lease, write receipt |
| `running` | `waiting_retry` | run fails with retryable error, retry budget remaining | release lease, increment retry count |
| `running` | `failed_final` | run fails, retry budget exhausted or non-retryable | release lease, write receipt, create intervention |
| `running` | `blocked_operator` | run requires operator decision | emit intervention event |
| `running` | `cancelled` | operator or system cancels | signal worker, release lease, write receipt |
| `waiting_retry` | `queued` | backoff timer expires | re-enqueue with next backoff delay |
| `paused` | `queued` | operator resumes | re-enqueue |
| `blocked_operator` | `queued` | operator resolves intervention | re-enqueue |
| `queued` | `paused` | operator pauses | — |
| `queued` | `cancelled` | operator cancels | write receipt |
| `leased` | `queued` | lease expires without worker confirmation | release stale lease |

## 15.3 Run state machine

### States

| State | Terminal? |
|---|---|
| `starting` | no |
| `running` | no |
| `succeeded` | yes |
| `failed_retryable` | yes |
| `failed_final` | yes |
| `cancelled` | yes |
| `abandoned` | yes |

### Transitions

| From | To | Trigger | Side-effect |
|---|---|---|---|
| `starting` | `running` | engine confirms session active | begin event streaming |
| `starting` | `failed_final` | engine fails to start (bad config, missing model) | write receipt with error |
| `running` | `succeeded` | engine emits completion event | persist final events, write receipt |
| `running` | `failed_retryable` | engine error classified as transient | persist events, write receipt, notify parent Job |
| `running` | `failed_final` | engine error classified as permanent | persist events, write receipt, notify parent Job |
| `running` | `cancelled` | cancel signal received | call `EngineRunHandle.cancel()`, persist events, write receipt |
| `running` | `abandoned` | worker process dies or lease expires without completion | mark with last-known event, write partial receipt |
| `abandoned` | `failed_retryable` | startup reconciliation classifies as retryable | — |
| `abandoned` | `failed_final` | startup reconciliation classifies as non-retryable | create intervention |

## 15.4 Scheduling capabilities

- one-shot delayed jobs
- cron-like recurring jobs
- retry with exponential backoff: base delay **5 seconds**, multiplier **2×**, max delay **15 minutes**, default retry budget **3 attempts** (configurable per-task)
- coalescing / dedupe keys
- pause and resume
- manual enqueue
- per-workspace concurrency locks

## 15.5 Concurrency rules

Default rules:

- one active run per workspace
- one active run per SessionRoot unless explicitly allowed otherwise
- heartbeat is lower priority than manual or recovery work
- missed recurring jobs coalesce by default instead of stacking infinitely

## 15.6 Side-effect awareness

Jobs that produce external side effects are flagged in metadata so the UI/API renders them differently and retries are handled more cautiously.

---

## 16. Instruction and identity model

This is a core product feature and is runtime-owned.

## 16.1 Instruction source classes

From lowest to highest precedence:

1. Pi base/system behavior
2. Popeye base instructions
3. global operator instructions
4. workspace instructions
5. project instructions
6. identity/persona instructions
7. task brief
8. trigger overlay
9. runtime-generated notes for current run

Code-level invariants override all of the above.

## 16.2 File conventions

Workspace layout:

```text
<workspace>/
  WORKSPACE.md
  HEARTBEAT.md
  MEMORY.md
  memory/
    daily/
  identities/
    default.md
    reviewer.md
  projects/
    <project>/
      PROJECT.md
      knowledge/
      worktree/   # or a pointer to external path
```

Popeye may also support repo-local `AGENTS.md` via Pi where useful, but that is an input to the runtime's instruction resolution, not the product's sole instruction model.

## 16.3 Compiled instruction bundle

For every run, the runtime generates a **compiled instruction bundle**:

```ts
interface InstructionSource {
  precedence: number;         // 1 (lowest, Pi base) to 9 (highest, runtime notes)
  type: 'pi_base' | 'popeye_base' | 'global_operator' | 'workspace' | 'project' | 'identity' | 'task_brief' | 'trigger_overlay' | 'runtime_notes';
  path?: string;              // file path for file-based sources
  inlineId?: string;          // identifier for generated/inline sources
  contentHash: string;        // SHA-256 of source content
  content: string;            // raw source text
}

interface CompiledInstructionBundle {
  id: string;                 // unique snapshot ID
  sources: InstructionSource[]; // ordered by precedence (ascending)
  compiledText: string;       // final merged instruction text
  bundleHash: string;         // SHA-256 of compiledText
  warnings: string[];         // e.g., "workspace and project both define conflicting tool policies"
  createdAt: string;          // ISO 8601
}
```

**Merge algorithm:** sources are concatenated in precedence order (lowest first). Higher-precedence sources override lower ones. Conflicts within the same precedence level produce a warning but both are included. The `compiledText` is the final concatenation. Code-level invariants (enforced in runtime code) override all instruction content regardless of precedence.

Stored in `instruction_snapshots`.

## 16.4 Resolution requirements

Instruction resolution is:

- deterministic
- inspectable
- hashable
- previewable without running a task
- diffable between runs

## 16.5 Critical file write policy

Default policy:

- `WORKSPACE.md`, `PROJECT.md`, `IDENTITY.md`, `HEARTBEAT.md` are operator-owned
- agent writes to these files are blocked unless a dedicated workflow explicitly allows them
- any allowed mutation to a critical instruction file generates a receipt and diff

This is a deliberate ownership and security measure.

---

## 17. Workspace and project model

## 17.1 Workspace

A workspace is a long-lived operational domain.

It owns:

- instruction defaults
- curated memory
- knowledge sources
- project registry
- heartbeat checklist
- identity files
- default model/policy overrides
- heartbeat interval override

## 17.2 Project

A project is a scoped target under a workspace.

It owns:

- project instruction file
- repo/worktree path
- project knowledge
- project-specific sessions if needed

## 17.3 Routing rules

Every run resolves:

- `workspace_id`
- optional `project_id`
- `cwd`
- instruction scope
- memory scope
- session policy

There is no "implied current workspace" hidden inside random code paths.

## 17.4 Workspace boundary rule

Workspace routing improves organization and reasoning clarity. It is **not** a hard sandbox. If stronger isolation is needed, add OS user separation, sandboxing, or VM/container boundaries.

---

## 18. Observability, logging, receipts, and audit

Operational clarity is a first-class requirement.

## 18.1 Structured logs

Structured JSON logs with correlation fields:

- `timestamp`
- `component`
- `level`
- `workspaceId`
- `projectId`
- `taskId`
- `jobId`
- `runId`
- `sessionRootId`
- `engineSessionRef`
- `eventType`

## 18.2 Canonical artifacts

Every run leaves behind:

- raw run event stream
- summarized run timeline
- receipt (including cost/usage)
- instruction snapshot reference
- engine session reference if applicable
- output artifact references
- failure/intervention linkage where relevant
- extracted memories

## 18.3 Receipt schema

Every receipt includes:

- identity of run/job/task
- trigger type
- workspace/project/session scope
- instruction snapshot id
- start/end timestamps
- summary
- important decisions
- tools used
- files changed
- created artifacts
- errors/failures
- follow-up suggestions
- **usage metrics** (tokens in/out, model, provider)
- **cost data** (estimated cost per run, cumulative)

## 18.4 Live state view

The control API produces:

- daemon health summary
- active runs
- queue summary
- recent failures
- pending interventions
- workspace/project health overview
- cost/usage aggregates

---

## 19. Failure handling, recovery, and supervision

## 19.1 Failure taxonomy

Failures are classified as:

- engine crash
- worker process crash
- provider/model error
- tool execution error
- instruction resolution error
- workspace routing error
- policy violation
- persistence or migration error
- explicit operator cancellation
- auth failure (never retried, escalated immediately)

## 19.2 Recovery rules

- daemon restarts are handled by launchd
- daemon startup reconciles stale leases and in-flight runs
- transient failures retry with capped backoff
- repeated failures become interventions
- failures are never silently swallowed
- auth failures are never retried — they escalate immediately

## 19.3 Startup reconciliation

On daemon startup:

1. find runs marked `running` or `starting`
2. inspect associated worker PID or lease state
3. if liveness cannot be confirmed, mark as `abandoned`
4. apply recovery decision matrix (below)
5. preserve all raw evidence (raw events, partial receipts, last-known state)

### Recovery decision matrix

| Condition | Action | Rationale |
|---|---|---|
| Run has retries remaining AND last error was transient | create retry Job with backoff | transient failures are worth retrying |
| Run has retries remaining AND last error was unknown (worker died) | create retry Job with backoff | assume transient unless proven otherwise |
| Run has no retries remaining | create `retry_budget_exhausted` intervention | operator decides next step |
| Run error was auth/credentials failure | create `needs_credentials` intervention, do NOT retry | auth failures never auto-retry |
| Run error was policy violation | create `needs_policy_decision` intervention, do NOT retry | policy issues require human judgment |
| Run was a heartbeat | re-enqueue silently (heartbeat is self-recovering) | heartbeat runs are low-stakes |
| No error information available | create `needs_operator_input` intervention | insufficient evidence to auto-recover |

## 19.4 Operator interventions

Intervention codes:

- `needs_credentials`
- `needs_policy_decision`
- `needs_instruction_fix`
- `needs_workspace_fix`
- `needs_operator_input`
- `retry_budget_exhausted`
- `failed_final`
- `auth_failure`

---

## 20. Extension and plugin model

## 20.1 Extension points

No broad open plugin marketplace or dynamic package installer.

Narrow extension points only:

- `EngineAdapter`
- `InstructionSource`
- `TriggerSource`
- `RuntimeTool`
- `ClientAPI`
- `ChannelAdapter`

## 20.2 Why this restriction matters

Open-ended plugin systems create:

- security risk
- upgrade burden
- invisible behavior
- blurred ownership

Pi already supports packages/extensions and warns that they execute with broad host privileges. That is a good reason to keep the product surface conservative.

## 20.3 Runtime-owned tools

A small runtime tool surface belongs in the product layer. Initial tools:

- `memory_search`
- `knowledge_search`
- `receipt_lookup`
- `workspace_info`
- `schedule_task`
- `job_status`

These call stable runtime services, not poke raw storage.

---

## 21. UI, API, and channel integration model

## 21.1 Control plane requirements

A single local control plane that all clients use.

Transport:

- HTTP/JSON for commands and queries (Fastify)
- SSE for live events
- loopback bind only by default (127.0.0.1)
- auth token required even on loopback (fail-closed)
- versioned routes from day one
- CSRF protection on all state-changing endpoints

## 21.2 API surface

```text
GET    /v1/health
GET    /v1/status
GET    /v1/workspaces
GET    /v1/projects
GET    /v1/agent-profiles
POST   /v1/tasks
GET    /v1/tasks
GET    /v1/jobs
POST   /v1/jobs/:id/pause
POST   /v1/jobs/:id/resume
POST   /v1/jobs/:id/enqueue
GET    /v1/runs
GET    /v1/runs/:id
GET    /v1/runs/:id/events
POST   /v1/runs/:id/retry
POST   /v1/runs/:id/cancel
GET    /v1/receipts/:id
GET    /v1/instruction-previews/:scope
GET    /v1/interventions
POST   /v1/interventions/:id/resolve
GET    /v1/events/stream
POST   /v1/messages/ingest
GET    /v1/messages/:id
GET    /v1/usage/summary
GET    /v1/security/audit
```

## 21.3 Telegram adapter

Telegram is the primary conversational surface for Popeye.

Architecture:

- Thin bridge between Telegram Bot API and Popeye control API
- Routes messages through `/v1/messages/ingest`, not directly to Pi
- Receives responses via SSE or polling the control API
- Stateless adapter — all state lives in the Popeye runtime

Message flow:

1. Telegram Bot API webhook or long-poll delivers update to `@popeye/telegram`
2. Adapter extracts sender ID, message text, and metadata
3. Adapter checks sender against allowlist — reject silently if not listed
4. Adapter applies rate limit check — reject with backpressure if exceeded
5. Adapter POSTs to `/v1/messages/ingest` with `{ source: 'telegram', senderId: string, text: string, telegramMessageId: number }`
6. Runtime creates or reuses a **dedicated SessionRoot per Telegram user** (keyed by sender ID)
7. Runtime creates a Job/Run for the message
8. On completion, runtime stores response; adapter polls or receives via SSE
9. Adapter sends response back through Telegram Bot API `sendMessage`

Security:

- **Allowlist-only** DM policy (no pairing flow, no open registration)
- All messages treated as untrusted input
- Rate limiting on message ingress (default: 10 messages/minute per user)
- Prompt injection detection applied to all inbound messages

The adapter is **not** a port of OpenClaw's channel ecosystem.

## 21.4 Swift app model

The Swift client is a real product surface:

- SwiftUI front end
- separate API client package/module
- event stream subscriber
- no direct SQLite/file parsing
- no dependency on Pi internals

Initial Swift views:

- daemon status
- queue and active runs
- run timeline
- receipt viewer
- instruction preview
- intervention queue
- workspace/project switcher
- cost/usage dashboard

---

## 22. Security model

## 22.1 Trust model

Popeye operates under these trust assumptions:

- one trusted operator boundary
- local loopback API with mandatory auth
- runtime with meaningful host authority
- no hostile multi-tenant guarantee
- secrets stored outside the workspace

## 22.2 Network security

- **Loopback-only binding** by default (127.0.0.1)
- **Auth token required** even on loopback (fail-closed)
- Long random tokens (`openssl rand -hex 32`)
- **CSRF protection** on all state-changing API endpoints (Sec-Fetch-Site validation + CSRF tokens)
- Remote access only via Tailscale/VPN/SSH tunnel in future

## 22.3 Secrets management

- Multiple credential sources: env vars, file-based, exec providers, macOS Keychain
- File permissions enforced: 700 dirs, 600 files
- Never store secrets in workspace docs or config files
- **Redact-on-write** for sensitive patterns (not just read-path)
- Configurable redaction patterns per deployment

### Redaction pipeline

Redaction runs **before** any write to logs, receipts, memory, or daily summaries:

1. Apply built-in patterns: API keys (`sk-...`, `key-...`), Bearer tokens, PEM blocks (`-----BEGIN`), JWTs (`eyJ...`), hex secrets (40+ hex chars)
2. Apply deployment-configured custom patterns (regex list in `config.json` under `redaction.patterns`)
3. Replace matches with `[REDACTED:<pattern-name>]`
4. Log redaction event to `security_audit` table (pattern matched, field redacted, no secret content)

Redaction is fail-safe: if the redactor errors, the write is blocked (not written unredacted).

## 22.4 Trust boundaries

- All external content is untrusted data
- Prompt injection detection on all inbound messages — detected injections are logged to `security_audit` and the message content is sanitized before processing
- Critical instruction files are operator-owned (read-only by default)
- Retrieved content claims no elevated authority
- Telegram messages are untrusted input regardless of allowlist status

## 22.5 Tool execution security

- **Default-deny** for dangerous operations
- Explicit approval gates for irreversible actions
- **Single policy enforcement point** — no bypass paths
- Auth failures never retried, escalated immediately

## 22.6 Audit

- Every run receipted including failures
- Security audit CLI command (`pop security audit`)
- Incident response runbook (`docs/runbooks/incident-response.md`)
- `security_audit` table records auth failures, policy violations, redaction events

## 22.7 Honesty rule

Workspace scoping is **not** security isolation. If stronger isolation is needed, use sandboxing or separate hosts/users. Path conventions are not a security boundary.

---

## 23. Deployment model

## 23.1 Deployment layout

macOS layout:

```text
~/Library/Application Support/Popeye/
  config/
    config.json
    auth.json
  state/
    app.db
    memory.db
    indexes/
  logs/
    daemon.jsonl
    runs/
  receipts/
    by-run/
    by-day/
```

Workspaces are registered separately and live anywhere appropriate.

## 23.2 Packaging goals

- installable via `pop` CLI helper
- launchd service file generation
- predictable backup/restore path
- explicit upgrade command
- explicit data export/import path later

## 23.3 Backup strategy

Backup coverage:

- config
- auth references or credential instructions
- SQLite DBs (app.db, memory.db)
- receipts
- workspaces
- Pi session storage if continuity matters

---

## 24. Upgrade and fork ownership strategy

## 24.1 Pi fork strategy

- keep Pi fork in its own repo
- pin exact versions/SHAs in the Popeye repo
- maintain `docs/pi-fork-delta.md`
- upgrade on explicit cadence
- run compatibility suite before accepting any Pi bump
- prefer fork-level rebrand hooks over mass renaming

## 24.2 Runtime strategy

- the Popeye repo is the product repo
- all Pi integration goes through `packages/engine-pi`
- no direct imports of Pi internals across runtime packages
- no floating version ranges for engine packages

## 24.3 Donor strategy for OpenClaw

For every donor feature:

1. identify the concrete need
2. check Pi for an equivalent or hook first
3. choose reuse, wrap, thin port, rewrite, or omit
4. document provenance
5. restate the idea in Popeye's own contracts and naming
6. explicitly record what was left behind

---

## 25. Source classification

## 25.1 Reuse from Pi

Use Pi for:

- model/provider abstraction
- agent runtime mechanics
- tool calling
- session persistence/tree behavior
- compaction/branch behavior
- SDK embedding
- context file support
- engine event streaming
- provider customization hooks

## 25.2 Port or adapt from OpenClaw

Donor concepts:

- heartbeat semantics and `HEARTBEAT.md`
- recurring automation concepts
- workspace-centric organization
- markdown durable memory
- strict config validation discipline
- control-plane mindset
- troubleshooting / operational clarity patterns

## 25.3 Build new

Build new in the Popeye repo:

- always-on daemon (`popeyed`)
- scheduler/job queue
- task/job/run state model
- session registry
- instruction resolver
- workspace/project registry
- receipt service (with cost/usage)
- intervention queue
- recovery supervisor
- versioned control API (Fastify)
- security service (auth, CSRF, redaction, audit)
- two-layer memory system (markdown + SQLite + sqlite-vec)
- Telegram adapter
- CLI/admin tools (`pop`)
- Swift client
- runtime-owned tool surface

## 25.4 Intentionally omit

Intentionally omit from v1:

- full channel ecosystem (Telegram adapter is purpose-built, not a general channel framework)
- media pipeline
- mobile/device pairing systems
- broad plugin marketplace
- donor UI stack
- donor config compatibility
- multi-tenant trust model

---

## 26. Risks, tradeoffs, and architectural tensions

## 26.1 Child-process adapter vs in-process SDK

**Child process**
- better isolation
- easier crash recovery
- cleaner logs
- slightly more plumbing

**In process**
- lower overhead
- deeper access to Pi objects
- more coupling

**Decision:** child process first, SDK option later.

## 26.2 Memory architecture

**Two-layer (markdown + SQLite with sqlite-vec)**
- auditable markdown for humans
- queryable SQLite for machines
- sqlite-vec avoids external service dependency
- <200ms retrieval target is achievable
- consolidation prevents unbounded growth

**Risk:** sqlite-vec embedding quality depends on model choice. Mitigated by two-stage retrieval (FTS5 catches what semantic search misses).

## 26.3 CLI-first vs UI-first

**CLI-first**
- hardens architecture
- forces clean APIs and logs

**UI-first**
- improves ergonomics sooner
- risks forcing backend shortcuts

**Decision:** CLI/admin-first (`pop`), then Telegram adapter, then Swift inspector.

## 26.4 Compatibility temptation

The biggest long-term risk is drifting into "OpenClaw clone plus different UI". This is treated as a design failure.

---

## 27. MVP architecture

## 27.1 In scope for v1

- separate Pi fork under Popeye's control
- Popeye repo (pnpm + Turborepo monorepo) with daemon, scheduler, and engine adapter
- one local control API (Fastify)
- one or more registered workspaces
- named SessionRoots
- manual tasks
- recurring scheduled jobs
- dedicated heartbeat (default: 1 hour, configurable per-workspace)
- SQLite operational state (WAL mode, foreign keys)
- SQLite memory DB with sqlite-vec
- receipts with cost/usage tracking and raw event logs
- instruction preview
- workspace/project routing
- two-layer memory (markdown + SQLite)
- <200ms retrieval (FTS5 + sqlite-vec)
- restart reconciliation and intervention queue
- security: loopback auth, CSRF, redact-on-write, audit
- CLI/admin surface (`pop`)
- Telegram adapter (allowlist-only)
- thin web or Swift inspection client

## 27.2 Explicitly out of scope for v1

- full channel ecosystem beyond Telegram
- multi-user deployment
- plugin ecosystem
- remote API exposure (use Tailscale/VPN/SSH tunnel)
- sophisticated approval engine
- distributed execution
- donor compatibility promises

## 27.3 MVP success criteria

The MVP is successful when:

- the daemon survives restart cleanly
- a scheduled run produces deterministic state transitions
- heartbeat uses its own session continuity
- every run yields a receipt with cost/usage data
- failures are diagnosable from stored artifacts
- the UI can inspect live state through the API without touching internals
- Telegram conversations work end-to-end through the control API
- memory retrieval returns relevant results in <200ms
- `pop security audit` reports clean on a healthy installation

---

## 28. Future-state architecture

After the MVP is stable:

- add a richer Swift desktop client
- support more than one active workspace comfortably
- add optional approval gates for risky operations
- add event/webhook/file triggers
- add stronger runtime isolation for sensitive workspaces
- add import/export and migration tooling
- optionally support remote worker hosts without changing UI contracts
- expand memory consolidation with more sophisticated merging strategies
- add cost budgets and alerts

The future-state architecture preserves the same central rule:

> **Pi remains the engine, Popeye remains the product, interfaces remain replaceable.**

---

## 29. Canonical invariants

These invariants are encoded in code and tests.

1. **Only `engine-pi` imports Pi internals.**
2. **UI clients never read runtime DB or Pi sessions directly.**
3. **Every run has a receipt, including failures and cancellations.**
4. **Heartbeat does not reuse the main interactive SessionRoot by default.**
5. **Critical instruction files are operator-owned unless explicitly unlocked.**
6. **Runtime audit records live outside the workspace.**
7. **Session selection is deterministic from explicit inputs.**
8. **A running job has a lease and liveness tracking.**
9. **Startup reconciliation resolves stale runs before new leases begin.**
10. **The control API never binds outside loopback without authentication.**
11. **Secrets never persist in workspace files, logs, or receipts.**
12. **All state-changing API endpoints have CSRF protection.**
13. **Tool execution policy has exactly one enforcement point — no bypass paths.**
14. **Sensitive data is redacted on write, not just on read.**
15. **No subsystem is added without an owner, tests, and a reason to exist.**

---

## 30. Technical stack

| Layer | Choice |
|---|---|
| Runtime | Node 22 LTS |
| Package manager | pnpm |
| Monorepo | pnpm workspaces + Turborepo |
| Language | TypeScript (strict mode) |
| Config format | JSON + Zod validation |
| API framework | Fastify |
| Database | SQLite (WAL mode, foreign keys) |
| Vector search | sqlite-vec |
| Full-text search | FTS5 |
| Embedding model | OpenAI text-embedding-3-small |
| Testing | Vitest (unit) + Playwright (E2E) |
| Linting | ESLint 9 + Prettier |
| macOS data path | `~/Library/Application Support/Popeye/` |
| Package scope | `@popeye/` |
| CLI binary | `pop` |
| Daemon binary | `popeyed` |

---

## 31. Reference notes

These upstream materials are pinned for implementation reference:

- Pi SDK: <https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md>
- Pi development / rebranding notes: <https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/development.md>
- Pi context file example: <https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/sdk/07-context-files.ts>
- Pi package security notes: <https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md>
- OpenClaw heartbeat docs: <https://docs.openclaw.ai/gateway/heartbeat>
- OpenClaw workspace docs: <https://docs.openclaw.ai/concepts/agent-workspace>
- OpenClaw security model docs: <https://docs.openclaw.ai/gateway/security>
- Ars Contexta: memory architecture design reference

Local doc set to maintain:

- `docs/pi-capability-map.md`
- `docs/openclaw-donor-map.md`
- `docs/pi-fork-delta.md`
- `docs/pi-fork-strategy.md`
- `docs/domain-model.md`
- `docs/session-model.md`
- `docs/workspace-conventions.md`
- `docs/instruction-resolution.md`
- `docs/memory-model.md`
- `docs/receipt-schema.md`
- `docs/control-api.md`
- `docs/telegram-adapter.md`
- `docs/ui-surface.md`
- `docs/migration/openclaw.md`
- `docs/runbooks/daemon.md`
- `docs/runbooks/recovery.md`
- `docs/runbooks/incident-response.md`
- `docs/runbooks/upgrades.md`
- `docs/runbooks/backup-restore.md`
- `docs/adr/*.md`
