
# OpenSquirrel → Popeye Analysis

_Evidence basis:_ this analysis is based on direct inspection of Popeye code/docs in `runtime-core`, `engine-pi`, `control-api`, `memory`, `sessions`, `workspace`, `receipts`, and root architecture/build docs; direct inspection of OpenSquirrel code in `main.rs`, `lib.rs`, `state_tests.rs`, `Cargo.toml`, and `README.md`; and inspection of pi-mono package metadata plus the `pi-ai`, `pi-agent-core`, `pi-coding-agent`, and SDK READMEs included in the repo snapshot.  
_When I say **confirmed in code**, that is from inspected source. When I say **docs-only**, that is from project docs or README text not verified against deeper source. When I say **inference**, that is my architectural conclusion rather than an explicit implementation fact._

## 1. Executive summary

OpenSquirrel is worth studying for Popeye, but not as a template for Popeye’s core runtime. Its main value is as a **control-plane donor**: it shows how much operator leverage you can get from persistent workbench state, explicit runtime selection, interruption/resume UX, bounded coordinator/worker delegation, and a native-feeling control surface. It does **not** provide a better substrate than Popeye’s existing daemon + DB + receipts + memory + security architecture.

The most important conclusion is this: **Popeye already has the stronger product-core architecture for an owned, local-first personal agent.** In the inspected code, Popeye already has the pieces that matter for long-term durability: a daemonized orchestration core, explicit product nouns (`task`, `job`, `run`, `session_root`, `receipt`, `intervention`), SQLite-backed operational state, memory and receipt infrastructure, restart reconciliation, security auditing, authenticated loopback control API, and a narrow Pi integration seam. OpenSquirrel is stronger somewhere else: **operator-facing runtime ergonomics**.

The biggest opportunities Popeye can learn from OpenSquirrel are:

1. **Persistent operator workbench restore**: Popeye persists runtime state well, but not operator context well.
2. **A bounded delegation model**: OpenSquirrel’s coordinator/worker handoff pattern is genuinely useful, if reformulated as auditable child tasks/runs instead of in-memory worker panes.
3. **Transcript projection and interruption/resume UX**: Popeye stores raw run events, but does not yet expose a rich operator-facing projection layer.
4. **First-class execution profiles**: OpenSquirrel’s explicit runtime/model/target choices suggest Popeye should turn `agent_profiles` into real policy-bearing execution profiles.
5. **A more explicit engine capability seam**: OpenSquirrel survives because runtime quirks are visible. Popeye currently hides too much inside `engine-pi`, especially around runtime tools.

The biggest mismatches and risks are:

- OpenSquirrel is **UI-driven and agent-pane-centric**; Popeye should remain **daemon-driven and task/run-centric**.
- OpenSquirrel’s runtime abstraction is mostly a thin wrapper over provider-specific CLI flags and output parsers; Popeye should not import that complexity into its product core.
- OpenSquirrel’s remote execution model (`ssh` + `tmux`) is clever but operationally fragile and too implicit for a security-sensitive personal agent unless it is refactored into an explicit execution-target boundary.
- OpenSquirrel keeps critical state in app-local JSON; Popeye should not retreat from its stronger operational DB model.
- OpenSquirrel’s tool/MCP model is useful as a convenience layer, but too ad hoc to become Popeye’s core attachment model.

**Overall recommendation:** keep Popeye’s core architecture intact; adopt a small number of OpenSquirrel-inspired patterns in the Popeye layer, not the pi-mono layer, and not by copying UI/runtime coupling. The highest-leverage path is:

- first clean up the Popeye ↔ pi seam,
- then add transcript projections and operator workbench restore,
- then add execution profiles,
- then add bounded delegated subtask orchestration,
- and only later consider remote targets or richer native-control-plane features.

## 2. Popeye current state

### What Popeye currently is

**Confirmed in code and architecture docs:** Popeye is already a serious daemon-first local platform, not a sketch.

The inspected architecture documents and code agree on a three-layer model:

1. **pi / pi-mono** as engine foundation,
2. **Popeye runtime** as product core,
3. **interfaces** (CLI, Telegram, web inspector, future Swift app) on top of the control API.

That split is not just aspirational. In the inspected code:

- `runtime-core/runtime-service.ts` is a substantial orchestration core.
- `engine-pi/index.ts` is the only place that knows Pi specifics.
- `control-api/index.ts` is a real authenticated loopback surface with SSE and browser-session bootstrap.
- `memory/*` is a real subsystem, not a placeholder.
- `message-ingestion.ts` is a real ingress/security boundary.
- `database.ts` defines a nontrivial operational schema.

A useful shorthand is:

- **Pi decides how a single agent session runs.**
- **Popeye decides why a run exists, when it runs, what it may touch, how it is audited, and how the operator sees it.**

That is the right product split for the end-state you described.

### Core architectural shape

**Confirmed in code.**

Popeye’s current shape is roughly:

- a long-lived runtime service (`PopeyeRuntimeService`)
- SQLite app DB + separate SQLite memory DB
- a scheduler and recovery loop
- task/job/run orchestration
- session-root selection and engine-session mapping
- receipt generation and memory capture
- authenticated local control API
- Telegram ingress/egress plumbing
- explicit security, backup, and audit services

The most important architectural facts visible in code are:

#### 1. The runtime is already a daemon-grade coordinator

`PopeyeRuntimeService`:

- opens the databases,
- creates the engine adapter,
- loads/initializes memory services,
- seeds reference data,
- reconciles abandoned work on startup,
- starts the scheduler,
- starts memory maintenance,
- starts document indexing,
- starts token-rotation checks.

This is not “call Pi and print output.” It is already an always-on runtime shell.

#### 2. Operational state is explicit and durable

`runtime-core/database.ts` defines tables for:

- `tasks`
- `jobs`
- `job_leases`
- `locks`
- `session_roots`
- `runs`
- `run_events`
- `receipts`
- `instruction_snapshots`
- `interventions`
- `security_audit`
- `messages`
- `message_ingress`
- Telegram delivery/checkpoint tables
- browser sessions
- memory tables, FTS tables, entity tables, summary DAG tables

That is a real product-state model. It is much closer to the architecture Popeye needs than OpenSquirrel’s app-state JSON persistence.

#### 3. Session continuity is a product concept, not a UI accident

Popeye distinguishes:

- **product session roots** (`session_roots`)
- **engine session refs** (`engine_session_ref` on runs)

`selectSessionRoot()` plus `SessionService` give Popeye deterministic session lineage. This is better than a pure UI-side “remember the last CLI session id” approach, because it keeps the product’s notion of continuity separate from engine internals.

#### 4. Scheduling and recovery already exist

`startJobExecution()`, `awaitRunCompletion()`, `finalizeRun()`, `scheduleRetry()`, and `applyRecoveryDecision()` implement:

- queued → leased → running transitions,
- workspace locking,
- retry scheduling,
- cancellation,
- abandoned-run recovery,
- operator interventions on final failures, credentials issues, policy issues, retry exhaustion.

That is exactly the kind of boring explicit machinery an always-on personal agent needs.

### Major existing subsystems

#### A. Run orchestration and lifecycle

**Confirmed in code.**

The run lifecycle is explicit:

- task resolved
- workspace lock acquired
- job leased
- session root selected
- instructions resolved/snapshotted
- engine request built
- normalized engine events persisted
- run finalized into success, cancelled, retryable failure, final failure, or abandoned
- receipt emitted
- optional intervention created

This is stronger than OpenSquirrel’s process-lifecycle model from a durability perspective.

#### B. Memory subsystem

**Confirmed in code.**

Popeye’s memory subsystem is already substantial:

- FTS5 + sqlite-vec hybrid retrieval
- query classification and weighted retrieval strategy
- entity extraction and mention boosting
- deduplication/reinforcement
- confidence decay and archival
- daily summary generation
- compaction-flush capture
- workspace doc indexing
- explicit promotion workflow to curated markdown targets

This matters because it means Popeye already has one of the key differentiators of a personal agent: a durable, queryable, operator-auditable memory layer.

A nuance worth noting: the storage and indices are local-first, but embedding/summarization clients may call OpenAI if configured. That is an explicit privacy boundary Popeye will need to keep tightening as it moves into more sensitive personal data.

#### C. Message ingress and security boundary

**Confirmed in code.**

`message-ingestion.ts` is a strong sign that Popeye is not just a wrapper around an agent loop. Telegram ingress is already policy-enforced:

- enabled/disabled gate
- private-chat-only gate
- allowlisted sender gate
- per-user and global rate limits
- prompt-injection scanning with quarantine/sanitize behavior
- redaction and security-audit recording
- idempotency via ingress keying
- link-back to task/job/run and Telegram reply delivery state

That is excellent product thinking for a personal agent that will eventually handle highly sensitive data.

#### D. Receipts, audit, and observability

**Confirmed in code.**

Popeye already receipts every run, including failures and abandoned work, and captures memory from receipts. It also records security audit events and exposes them through the control API.

This is a major architectural advantage over OpenSquirrel. Operator trust in a personal agent depends on receipts, auditability, and visible intervention points.

#### E. Control plane API

**Confirmed in code.**

`control-api/index.ts` is a real versioned control surface:

- bearer-token auth
- browser session exchange and CSRF
- daemon status and scheduler status
- CRUD-ish task/job/run views
- receipt endpoints
- instruction preview
- intervention resolution
- memory search / describe / expand / audit / integrity / promotion
- message ingest
- SSE stream
- Telegram relay/checkpoint/delivery routes
- security audit
- usage summary

This means Popeye already has the right architectural place to put any OpenSquirrel-inspired operator UX: the **client layer**, not the runtime core.

### Current weaknesses / missing areas

The important missing pieces are not “basic runtime.” They are mostly **operator control-plane** and **next-layer orchestration** gaps.

#### 1. No mature operator workbench yet

**Confirmed by inspected code/docs gap.**

Popeye has durable runtime state, but no equivalent yet to OpenSquirrel’s strong operator workbench:

- no persisted multi-view operator context,
- no rich interrupted-run restore UX,
- no session-tree or run-tree visual model,
- no command-palette-grade control plane,
- no mature native client.

#### 2. No explicit subtask / delegation model

**Confirmed in inspected code.**

Popeye has tasks/jobs/runs, but no first-class notion of:

- child task spawned from a parent run,
- delegation batch,
- condensed child-to-parent handoff,
- run tree / delegation tree.

This is a real gap if Popeye is going to do meaningful longer workflows without becoming opaque.

#### 3. The engine seam is good, but still too Pi-shaped in one critical spot

**Confirmed in code.**

The Popeye ↔ Pi boundary is mostly good, but runtime-owned tools currently rely on a brittle fallback:

- first try `register_host_tools`
- otherwise use a temporary Pi extension and `extension_ui_request(method: "editor")`

That is a clever workaround, but it is not the kind of seam you want to build more product power on top of, especially for sensitive-data tools.

#### 4. Transcript handling is stored, not yet projected

**Confirmed in code.**

Popeye stores raw `run_events` and already has a small derived output path via `getRunReply()` / `buildCanonicalRunReply()`, but it does not yet have a generalized transcript projection layer for:

- operator inspection,
- interruption/resume actions,
- delegated-child summaries,
- run-tree visualization,
- UI-friendly segment rendering.

OpenSquirrel is stronger here, even though Popeye has the better underlying data.

#### 5. No real connector domain yet for email/calendar/repo awareness

**Confirmed by absence in inspected code; docs/intention only.**

The end-state direction clearly points toward email, calendar, repo/issue/PR awareness, and file access policy. In the inspected code, Telegram is real; those domain connectors are not yet.

This matters because some OpenSquirrel lessons will help those future connectors (control-plane UX, profiles, transcript projections), but OpenSquirrel does not solve the connectors directly.

### Role of pi-mono in the overall system

This is the most important boundary to get right.

#### What belongs in pi-mono

**Documented in inspected pi-mono READMEs/SDK docs; not deeply source-verified beyond docs and package metadata.**

pi-mono appears to own the engine/foundation layer:

- provider/model abstraction (`pi-ai`)
- agent loop and tool execution semantics (`pi-agent-core`)
- message / event streaming
- session tree / branch / compaction mechanics (`pi-coding-agent`)
- SDK embedding and RPC transport
- settings/resource loading for extensions/skills/prompts/context files

The inspected `pi-coding-agent` README is also explicit about what it does **not** want to hard-code in core: things like sub-agents and broad orchestration are intentionally left to higher layers, extensions, or external control planes. That reinforces the boundary I would keep here: delegation/orchestration belongs in Popeye, not in pi-mono.

That is the right home for **general engine capabilities**.

#### What belongs in Popeye

**Confirmed in Popeye code/docs.**

Popeye should continue to own:

- task/job/run orchestration
- daemon lifecycle
- heartbeat and schedule semantics
- workspace/project registry
- session-root policy
- durable personal memory model
- receipts, audit, interventions, recovery
- connector security boundaries (Telegram today; email/calendar/repo later)
- operator auth, CSRF, browser/native client surfaces
- file/sensitivity policy
- backup/restore
- operator workbench and control plane

That is the right home for **product identity**.

#### Boundary rule I would keep

A clean way to say it:

- **pi-mono owns how an agent thinks, streams, calls tools, and persists session trees.**
- **Popeye owns why work is created, when it runs, which profile/target/tool set it may use, what memory and receipts are created, and how the operator governs it.**

#### The current boundary risk

The current risk is not that Popeye is in the wrong layer. It is that the runtime-tool bridge is still partially implemented as a Pi-specific workaround. That is the first place I would tighten before importing more OpenSquirrel-inspired features.

## 3. OpenSquirrel architecture summary

### Concise architectural shape

**Confirmed in code.**

OpenSquirrel is a native Rust app built on GPUI. In the inspected snapshot it is structurally very compact but highly centralized:

- `main.rs` (~6.5k lines): UI, state, lifecycle, runtime spawning, restore, parsing, remote attach
- `lib.rs` (~500 lines): transcript-line classification, markdown-ish parsing, prompt/session helpers, diff summarization
- `state_tests.rs` (~425 lines): app-state and helper tests

This is not a service-oriented architecture. It is a single native control-plane application that directly manages agent processes.

### Important primitives, systems, and patterns

**Confirmed in code.**

The important OpenSquirrel primitives are:

- `SavedAgentState` and `SavedAppState` for persistence in `~/.opensquirrel/state.json`
- `RuntimeDef`, `McpDef`, `MachineDef`, and `AppConfig` in `~/.opensquirrel/config.toml`
- `AgentRole` (`Coordinator` / `Worker`)
- `AgentStatus` (`Working`, `Idle`, `Blocked`, `Starting`, `Interrupted`)
- `TurnState` (`Ready`, `Running`, `Interrupted`)
- `MachineTarget` for local or SSH-backed execution
- `DelegateRequest` / `DelegateTask` parsed from fenced JSON blocks
- `OpenSquirrel` as the root app state with modes, groups, palette, setup wizard, search, sidebar tabs, model lists, and agent list

This is an **operator console with integrated launcher/orchestrator**, not a separate runtime plus clients.

### Control-plane / runtime model

This is the key architectural point.

OpenSquirrel’s “runtime abstraction” is mostly:

1. a config record describing how to launch a CLI,
2. parser logic for the CLI’s output format,
3. some runtime-specific session/resume flags,
4. optional local-vs-remote routing via SSH + tmux.

`agent_thread()` and `agent_thread_claude_persistent()` directly spawn or reconnect processes. The UI owns:

- the agent list,
- process lifecycle,
- parser choice,
- session id handling,
- restore state,
- remote line-cursor state,
- worker-parent relationships.

That is exactly why OpenSquirrel feels immediate and operationally useful. It is also exactly why it is hard to transplant into Popeye unchanged.

### Delegation model

**Confirmed in code.**

OpenSquirrel’s coordinator/worker pattern is one of its strongest ideas.

The flow is:

- a coordinator model gets a preamble telling it how to emit a fenced ```delegate JSON block,
- the app parses that block,
- `handle_delegate_request()` spawns worker agents,
- workers run subtasks,
- when they finish, `handle_delegated_worker_done()` creates a condensed handoff prompt containing:
  - task id/title
  - worker/runtime/target/model
  - success/failure
  - token and tool summary
  - diff summary
  - truncated final output
- that condensed summary is sent back to the parent coordinator

The important pattern is **not** “spawn many panes.”  
The important pattern is **child work returns a bounded summary, not a full transcript**.

That part is portable.

### Persistence and session restore

**Confirmed in code.**

OpenSquirrel’s restore story is very strong:

- groups, focus, view mode, and sidebar state are restored
- agent panes are recreated
- transcripts and stats are restored
- session ids are restored
- interrupted turns become `Interrupted`
- pending prompts become resumable
- remote tmux sessions can reattach using saved session name + line cursor
- restore notices tell the operator what to do

This is a real operator-quality feature, not a cosmetic add-on.

### Runtime abstraction across multiple CLIs

**Confirmed in code.**

OpenSquirrel supports multiple coding-agent CLIs by defining runtime records with:

- command
- args
- env removal/injection
- model flag
- known models (or dynamic discovery)

Then it normalizes output by parser families:

- Claude
- Codex
- Cursor
- OpenCode

This is practical and useful for a control plane. It is not a deeply abstract substrate. It is parser-and-flag orchestration over concrete CLIs.

### Remote machine targeting

**Confirmed in code.**

Remote execution is implemented through explicit machine config plus SSH + tmux behavior:

- launch runtime remotely
- run it inside tmux
- poll/stream pane output
- persist remote session name and line cursor
- reattach on restore

This is a strong operator convenience feature, but it is tightly coupled to OpenSquirrel’s process model and assumptions.

### MCP/tool attachment model

**Confirmed in code.**

OpenSquirrel builds MCP CLI args through `build_mcp_config_args()` and attaches them selectively, currently mainly for Claude-style `--mcp-config`. This is useful for local control-plane convenience, but it is not a general tool-attachment architecture.

### What makes OpenSquirrel strong

OpenSquirrel is strongest in five areas:

1. **Operator continuity**  
   Restart the app and your workbench returns.

2. **Visible agent lifecycle**  
   The state of each runtime is legible.

3. **Bounded coordinator/worker delegation**  
   Child work is summarized rather than dumped wholesale.

4. **Fast operational UX**  
   Palette, wizard, focus modes, search, agent grouping.

5. **Runtime heterogeneity and remote targeting**  
   It is comfortable treating CLIs and machines as selectable operator resources.

### What makes OpenSquirrel opinionated or hard to transplant

OpenSquirrel is harder to transplant than it first appears because its strongest behavior depends on its product shape:

- It is a **human-operated coding-agent console**, not an always-on personal daemon.
- It couples UI, runtime spawning, state persistence, parser logic, and remote attach in one app.
- It assumes direct process ownership in the UI layer.
- It assumes coding-agent CLIs with specific JSON streams and permission-bypass flags.
- It persists authoritative app state in JSON files.
- Its MCP model is a per-runtime CLI convenience, not a stable policy layer.
- Its remote execution is tmux-shaped rather than product-policy-shaped.

In other words: OpenSquirrel is mature where Popeye is currently thin, but those strengths are wrapped in assumptions Popeye should not copy.

## 4. Components / patterns from OpenSquirrel worth adopting

### 4.1 Operator workbench persistence and restore

**What it does**  
Persist the operator’s current work context and restore it after client restart: selected workspace/project/run, pinned views, interrupted items, recent searches, saved view mode, and direct “resume this” affordances.

**Why it matters**  
Popeye already preserves runtime truth. What it lacks is operator continuity. A personal agent that is always on but hard to re-enter is still operationally expensive.

**Why it fits Popeye specifically**  
Your target product is not a toy chat client. It is an owned system that will eventually manage memory, workflows, communications, and sensitive data. Strong operator control requires a persistent control plane, not just persistent backend state.

**Whether Popeye currently has an equivalent**  
Partially. Popeye has durable runtime state, session roots, receipts, interventions, and even browser sessions. It does **not** yet appear to have a rich persisted operator workbench equivalent.

**Where it belongs**  
Primarily **Popeye**, in the control-plane/UI layer.  
A small amount of support can live in Popeye runtime/control API for saved “workbench anchors” or named views, but detailed layout state should remain client-local.

**Integration complexity**  
**Medium**

**Implementation prerequisites**

- a run/transcript projection API
- a clear split between:
  - durable workbench anchors stored by the daemon, and
  - local presentation details stored by the client
- consistent identifiers for runs, tasks, interventions, and saved views

**Risks / caveats**

- Do not let UI layout become canonical operational state.
- Do not pollute runtime-core with every pixel-level view concern.
- Restore must be built on canonical runtime data, not stale copied JSON blobs.

**Core or nice-to-have**  
**Core** for Popeye’s long-term operator-control goals.

---

### 4.2 Transcript projection layer + interruption/resume model

**What it does**  
Create a structured, operator-friendly projection from raw `run_events`, receipts, and run state:

- message segments
- tool-call/result segments
- compaction segments
- errors and interventions
- “best available final answer”
- resume/retry/continue actions
- condensed summaries for UI and delegation handoff

**Why it matters**  
OpenSquirrel is stronger than Popeye at showing an operator what happened. Popeye already stores more durable raw data; it just has not yet turned that into a clean control-plane view.

**Why it fits Popeye specifically**  
Popeye already has the raw ingredients:

- `run_events`
- receipts
- canonical run reply generation
- engine session refs
- interventions
- compaction flush capture
- memory capture from receipts

That makes a transcript projection layer a very high-leverage addition.

**Whether Popeye currently has an equivalent**  
Partially. `getRunReply()` is a small channel-facing projection, but not a general-purpose operator transcript model.

**Where it belongs**  
**Popeye**, mainly runtime-core + control-api.  
Clients should render projections; they should not reconstruct semantics directly from raw events.

**Integration complexity**  
**Medium**

**Implementation prerequisites**

- stable normalized event taxonomy
- explicit projection DTOs in `@popeye/contracts`
- agreement on what “resume” means for different run states and engine capabilities

**Risks / caveats**

- Do not confuse transcript summaries with durable memory; they are different products.
- Avoid duplicating truth in too many caches early. Derived-on-read is fine first.
- Projection rules should remain deterministic and testable.

**Core or nice-to-have**  
**Core**

---

### 4.3 First-class execution profiles (make `agent_profiles` real)

**What it does**  
Turn Popeye’s existing but currently thin `agent_profiles` concept into real execution profiles that bundle:

- engine/model policy
- allowed runtime tools
- execution target
- side-effect budget / autonomy level
- memory budget policy
- connector grants (later)
- possibly prompt-frame or identity selection

**Why it matters**  
OpenSquirrel’s operator can explicitly choose runtime, model, target, and MCP attachments per agent. Popeye should not expose that as raw knob soup. But it should absolutely adopt the underlying idea: **execution choices must be explicit and operator-legible**.

**Why it fits Popeye specifically**  
For a personal agent handling sensitive data, the right abstraction is not “pick a runtime CLI.” It is “pick a named, audited operating profile.” Popeye’s schema already has hints that this direction is natural (`agent_profiles` exist, and tasks already carry a `side_effect_profile`). The missing step is to make those concepts operationally meaningful rather than leaving them as thin placeholders.

Examples would be:

- `read_only_memory_curator`
- `inbox_triage_safe`
- `repo_maintenance_autonomous`
- `interactive_admin`
- `sensitive_data_no_remote`

This aligns much better with Popeye’s side-effect and privacy concerns.

**Whether Popeye currently has an equivalent**  
Barely. The DB has `agent_profiles`, but in the inspected code it looks mostly seeded/default and not yet central to orchestration.

**Where it belongs**  
**Popeye**.  
pi-mono can consume profile-derived model/tool settings, but the profiles themselves are product policy.

**Integration complexity**  
**Medium**

**Implementation prerequisites**

- engine capability descriptors
- config / schema expansion
- task/job/run linkage to profile ids
- clear profile-to-engine mapping rules

**Risks / caveats**

- Avoid profile sprawl.
- Profiles should encode policy and execution posture, not every possible engine knob.
- Do not let raw model/runtime details leak into every product surface.

**Core or nice-to-have**  
**Core**

---

### 4.4 Engine capability descriptors and adapter negotiation

**What it does**  
Make the Popeye ↔ pi seam explicit about what the engine can actually do:

- persistent sessions
- resume support
- host-tool mode (`native`, `bridge`, `none`)
- compaction event support
- cancellation semantics
- execution-target support
- structured tool-result fidelity
- maybe branching/continuation capabilities

**Why it matters**  
OpenSquirrel survives runtime diversity because runtime quirks are explicit in config and launch logic. Popeye currently hides important engine assumptions inside `engine-pi`. That is manageable with one engine today, but it will become brittle as Popeye grows.

**Why it fits Popeye specifically**  
Popeye is meant to be durable and owned. Hidden assumptions are exactly what make that hard. A capability contract is a durability move, not a feature move.

**Whether Popeye currently has an equivalent**  
No explicit one in the inspected code.

**Where it belongs**  
At the **Popeye ↔ pi-mono seam**:

- contract type owned by Popeye
- adapter implementation in `engine-pi`
- better native support likely added in pi-mono / Pi itself

**Integration complexity**  
**Medium to High**

**Implementation prerequisites**

- contract update
- adapter implementation
- possibly pi-mono or Pi changes for first-class host-tool RPC

**Risks / caveats**

- Do not overdesign a giant capability matrix.
- Start with capabilities Popeye already needs for control plane, projections, and delegation.
- Keep the abstraction engine-shaped, not UI-shaped.

**Core or nice-to-have**  
**Core prerequisite**

---

### 4.5 Bounded delegated subtask orchestration with condensed return

**What it does**  
Allow a parent run to spawn auditable child tasks/runs that return a structured condensed result to the parent, instead of exposing every worker transcript inline.

**Why it matters**  
This is the most genuinely portable OpenSquirrel pattern. It helps complex tasks without requiring Popeye to become a pane-based swarm UI.

**Why it fits Popeye specifically**  
A personal agent will eventually need bounded delegation for things like:

- inbox triage
- repo issue summarization
- document comparison
- preparation of multiple candidate actions
- parallelizable research or file analysis

But Popeye needs that in a way that preserves:

- receipts
- memory capture
- intervention points
- profile/target policy
- workspace safety

**Whether Popeye currently has an equivalent**  
No.

**Where it belongs**  
Primarily **Popeye runtime**.  
The engine should only supply reliable structured tool calling / session continuation support. The orchestration logic belongs above it. That placement also matches pi-mono’s own documented philosophy: the engine core intentionally does not want to become the home of sub-agent orchestration.

**Integration complexity**  
**High**

**Implementation prerequisites**

- engine capability / host-tool cleanup
- transcript projection layer
- run-tree / child-run data model
- profile selection for child work
- strong loop/recursion guardrails

**Risks / caveats**

- This must not silently violate Popeye’s one-active-run-per-workspace default.
- Child work should initially be sequential or tightly bounded unless concurrency policy is redesigned.
- Workers should not recursively delegate in v1.
- The parent should receive **receipted summaries**, not raw child transcript blobs.

**Core or nice-to-have**  
**Core eventually**, but **not first**. It is Phase 2 material.

---

### 4.6 Setup wizard, command palette, and operational shortcuts

**What it does**  
Provide a fast operator UX for setup and recurring operations:

- daemon status
- Pi/engine health
- auth initialization/rotation
- workspace registration
- Telegram status
- memory/backup status
- retry/cancel/resolve-intervention actions
- saved view switching

**Why it matters**  
Popeye already has many operational surfaces hidden behind CLI/API. OpenSquirrel proves that low-friction operator UX has real architectural value for systems that stay open all day.

**Why it fits Popeye specifically**  
You want strong operator control. A control plane should make the safe actions obvious and the dangerous actions explicit.

**Whether Popeye currently has an equivalent**  
Not really beyond CLI/admin functionality.

**Where it belongs**  
**Popeye UI layer only**

**Integration complexity**  
**Low to Medium**

**Implementation prerequisites**

- stable health/setup endpoints
- transcript projections / resume actions
- profile surfaces
- basic workbench state

**Risks / caveats**

- This should follow real backend affordances; it should not become decorative UI over missing control.
- Avoid exposing raw engine implementation details if profiles can express them more safely.

**Core or nice-to-have**  
**Nice-to-have in isolation, but high leverage once the web inspector exists**

---

### 4.7 Optional later: execution target abstraction

**What it does**  
Introduce an explicit product-layer notion of where work runs:

- local default
- local restricted/sandboxed target
- remote trusted machine
- remote high-risk machine
- later maybe air-gapped or domain-specific targets

**Why it matters**  
OpenSquirrel shows that target selection can be operationally powerful. For Popeye, the best reason is not “many coding boxes.” It is **isolation and policy**.

**Why it fits Popeye specifically**  
Because Popeye will eventually touch:

- personal files
- communications
- repos
- sensitive memory

The ability to say “this class of work may only execute on target X with profile Y” can become important.

**Whether Popeye currently has an equivalent**  
No.

**Where it belongs**  
**Popeye runtime + engine adapter**, not merely UI.

**Integration complexity**  
**High**

**Implementation prerequisites**

- execution profiles
- engine capability descriptors
- scheduler/lock awareness
- audit and secret-boundary rules

**Risks / caveats**

- This is easy to make fragile if copied as `ssh+tmux`.
- It changes the security envelope and should not be rushed.
- It is optional until there is a concrete isolation use case.

**Core or nice-to-have**  
**Optional / later-stage**

## 5. Overlapping areas where OpenSquirrel appears stronger than Popeye

Not every overlap favors OpenSquirrel. In several important areas, Popeye is already stronger architecturally. The useful comparison is:

| Area | Popeye equivalent today | Is OpenSquirrel better? | Belongs in | Essential / optional / distracting | Portability | Adoption recommendation |
|---|---|---|---|---|---|---|
| Operator control-plane design | CLI + control API + early inspector direction | **Yes** on UX | Popeye UI | **Essential** | High | Build a run-centric workbench, not an agent-grid clone |
| Multi-agent session layout / workspace model | Session roots, tasks/jobs/runs, no pane model | **Partly** | Popeye UI | Optional | Medium | Adapt into run-tree / saved views, not tiled worker panes as primary shell |
| Agent spawning and lifecycle management | Strong backend lifecycle, weak operator visibility | **Partly** | Popeye runtime + UI | Medium | Medium | Keep Popeye backend, add better lifecycle projection and restore UX |
| Coordinator / worker delegation | No first-class model | **Yes** | Popeye runtime | **Essential later** | High | Add bounded child-task orchestration with condensed return |
| Transcript rendering / compression boundaries | Raw events + receipts + run reply | **Yes** on rendering/handoff | Popeye runtime/UI | **Essential** | High | Add transcript projections and child-summary boundaries |
| Persistent session restore | Backend continuity exists, workbench restore does not | **Yes** | Popeye UI | **Essential** | High | Add operator restore, not UI-owned runtime spawning |
| Runtime abstraction across providers / CLIs | Pi already abstracts providers; Popeye has no multi-engine surface | **Partly** | Popeye ↔ pi seam | Optional | Medium | Add engine capabilities, not a zoo of CLI wrappers in Popeye |
| Remote machine targeting | None | **Technically yes**, strategically later | Popeye runtime/adapter | Optional | Medium | Only after explicit execution-target design |
| Config structure / runtime config surfaces | JSON + Zod + DB + docs | Mixed | Popeye | Medium | Medium | Keep JSON/Zod; improve operator-facing config/status surfaces |
| MCP / tool attachment model | Runtime tools exist; no general attachment policy | **No** | Seam + Popeye policy | Medium | Low | Do **not** copy raw CLI arg injection; use policy-driven attachment descriptors |
| State persistence model | SQLite app DB + memory DB + receipts | **No**; Popeye is stronger | Popeye runtime | **Essential already solved** | High | Keep Popeye’s model |
| Command palette / setup wizard / operational UX | Minimal today | **Yes** | Popeye UI | Medium | High | Adopt after projection/workbench basics |
| Native desktop UX vs web / terminal only | Swift planned later, web first | OpenSquirrel proves value, but not urgency | Popeye UI | Optional later | High | Keep web-first validation; use Swift later against stable API |
| Boundary between orchestration UI and execution substrate | Strongly separated | **No**; Popeye is stronger | Keep current split | **Essential** | High | Do not collapse the boundary |

### What exactly Popeye should learn from those stronger areas

#### Operator control plane

OpenSquirrel’s real lesson is not “native Rust UI.”  
It is: **operator continuity is a first-class architectural concern**.

Popeye should absorb that lesson by building a workbench around its own nouns:

- workspaces
- tasks
- runs
- interventions
- receipts
- memory items
- profiles
- execution targets

not around visible runtime panes.

#### Delegation

OpenSquirrel demonstrates a simple truth: multi-step work becomes tractable when child work returns a bounded artifact instead of flooding the parent with raw transcript.

Popeye should copy that boundary, but implement it in a product-native way:

- child work as child task/job/run
- child result as structured receipt/summary
- parent continuation as a new run on the parent session root
- all of it visible and auditable

#### Transcript UX

OpenSquirrel proves that restore/resume and transcript readability matter operationally. Popeye should learn from that, but use its stronger data model:

- raw run events remain canonical,
- transcript projections are derived,
- receipts remain immutable,
- memory capture remains separate from transcript display.

#### Runtime explicitness

OpenSquirrel makes runtime differences operator-visible. Popeye should learn from that by making capabilities explicit at the adapter boundary and by turning `agent_profiles` into real execution profiles, not by importing raw per-CLI knob management into the product.

## 6. OpenSquirrel components that should NOT be adopted

### 6.1 A tiled multi-agent desktop as Popeye’s primary product shell

This is the clearest bad fit.

Why not:

- Popeye is not primarily a coding-agent operator console.
- Popeye’s primary units are not “pane” and “agent”; they are “task”, “run”, “intervention”, “memory”, and eventually “workflow”.
- A personal agent with email/calendar/todo/repo awareness needs a **workflow and state console**, not a swarm dashboard.

Better Popeye answer:

- a run-centric workbench,
- saved views,
- delegation tree when needed,
- memory and intervention panels,
- later a native control app.

### 6.2 UI-owned process orchestration as the authoritative runtime

OpenSquirrel directly spawns agent processes from the app. Popeye should not move in that direction.

Why not:

- it would weaken restart recovery,
- blur audit boundaries,
- make multiple clients harder,
- undermine the daemon/control-API architecture,
- make background behavior depend on the current UI being open.

Better Popeye answer:

- daemon owns execution,
- control API exposes execution state,
- clients restore onto daemon state.

### 6.3 Raw CLI-wrapper complexity as product architecture

OpenSquirrel’s runtime abstraction is practical, but it is still mostly a collection of CLI-specific wrappers, flags, and parsers.

Why it is a bad fit:

- Popeye already chose pi-mono as the engine abstraction layer.
- The more Popeye duplicates provider/runtime differences above that line, the more it defeats the point of owning a runtime foundation.
- It would create two abstraction layers solving the same problem badly.

Better Popeye answer:

- let pi-mono keep provider/model/runtime details,
- let Popeye define execution profiles and capability expectations.

### 6.4 Raw MCP CLI-arg injection in Popeye core

OpenSquirrel’s MCP attachment path is convenient, but too ad hoc.

Why it is a bad fit:

- it is runtime-specific,
- provider-specific,
- not policy-rich,
- not a stable contract for sensitive-data tooling.

Better Popeye answer:

- explicit tool / connector attachment descriptors,
- profile-driven attachment policy,
- engine-adapter translation layer,
- ideally first-class host-tool support in pi-mono or Pi.

### 6.5 SSH + tmux as the default remote execution substrate

OpenSquirrel’s remote targeting is clever and useful inside its product frame. It should not become Popeye’s near-term execution architecture.

Why it is a bad fit:

- too much hidden state lives in remote tmux sessions,
- reconnection semantics are operationally fragile,
- auditability is weaker than Popeye’s current local model,
- it complicates a product that is explicitly local-first and privacy-sensitive.

Better Popeye answer:

- postpone remote execution,
- later introduce explicit `execution_target` semantics with policy and audit,
- only then choose an implementation strategy.

### 6.6 Monolithic control-plane/runtime coupling

The fact that OpenSquirrel’s strongest code is mostly in one giant `main.rs` is informative: it optimized for product speed and coherence, not for transplantable architecture.

Popeye should avoid copying that coupling style.

Why it is a bad fit:

- Popeye is explicitly built for long-term maintainability and strong boundary control,
- it wants multiple clients,
- it wants a stable daemon/API contract,
- it will likely outgrow any single in-app orchestration file quickly.

Better Popeye answer:

- keep the daemon and UI separate,
- push reusable logic into runtime services and contracts,
- keep clients thin over the control API.

## 7. Popeye-specific gaps revealed by this comparison

This comparison reveals several important gaps, but they are not all the same kind of gap.

### Priority 1 — no rich operator workbench

**How much OpenSquirrel helps:** directly  
**Priority:** **P0**

Popeye already has the hard backend state. It needs a better human operating surface over that state:

- restore
- focus
- run inspection
- interruption handling
- quick actions
- saved views

This is the highest-leverage gap because it improves every future connector and workflow.

### Priority 2 — no transcript projection / explanation layer

**How much OpenSquirrel helps:** indirectly but strongly  
**Priority:** **P0**

Popeye’s current raw-event storage is good; operator experience is still too low-level. A projection layer will improve:

- UI rendering
- Telegram reply generation generalization
- delegation handoff
- operator debugging
- future native-client design

### Priority 3 — `agent_profiles` are present but not yet central

**How much OpenSquirrel helps:** directly at the pattern level  
**Priority:** **P1**

OpenSquirrel’s runtime/model/target selection shows the value of making execution posture explicit. Popeye should respond by making `agent_profiles` real, not by copying raw runtime knobs.

This will become extremely important once Popeye spans:

- memory curation
- inbox work
- repo work
- sensitive-data tasks
- semi-autonomous workflows

### Priority 4 — no first-class delegation tree / subtask model

**How much OpenSquirrel helps:** directly  
**Priority:** **P1**

OpenSquirrel provides a concrete delegation pattern. Popeye needs its own version because complex personal-agent work will eventually need bounded decomposition.

OpenSquirrel does not give Popeye the exact implementation, but it does reveal the missing capability clearly.

### Priority 5 — engine capability seam is under-specified

**How much OpenSquirrel helps:** indirectly  
**Priority:** **P1**

OpenSquirrel lives in a world where runtime differences are visible. Popeye hides too much of that today. That is acceptable until it starts adding:

- richer runtime tools,
- delegation,
- profiles,
- execution targets,
- maybe alternate engine modes later.

This is a foundational cleanup gap.

### Priority 6 — no first-class execution target model

**How much OpenSquirrel helps:** indirectly  
**Priority:** **P2**

This is not urgent, but the comparison highlights that Popeye currently assumes local execution while your end-state may eventually want isolation boundaries.

### Priority 7 — connector domains are still mostly future intent

**How much OpenSquirrel helps:** very little directly  
**Priority:** **P1/P2 depending on connector**

Email/calendar/repo awareness are central to Popeye’s end-state, but OpenSquirrel does not directly solve them. The comparison mostly helps by improving the operating model those connectors will eventually plug into.

### Net takeaway on the gaps

The comparison does **not** say “Popeye lacks a runtime.”  
It says:

- Popeye lacks a mature **operator shell**,
- a mature **transcript/explanation layer**,
- a mature **execution-profile surface**,
- and a mature **delegation model**.

Those are exactly the places where OpenSquirrel has something to teach.

## 8. Recommended adoption roadmap

### Phase 0: prerequisites / architectural cleanup

**Objectives**

- make the Popeye ↔ pi seam more explicit
- formalize execution profiles
- define transcript projection contracts
- define the boundary for workbench persistence
- prepare for delegation without implementing it yet

**Exact areas likely affected**

- `@popeye/contracts`
- `@popeye/engine-pi`
- `@popeye/runtime-core`
- `@popeye/control-api`
- pi-mono / Pi RPC support (if native host-tool support is improved)
- whichever UI client is first (likely web inspector)

**Expected benefits**

- fewer hidden engine assumptions
- cleaner long-term ownership
- stable foundation for UI and delegation
- safer path for future sensitive-data connectors

**Dependency ordering**

This phase comes first because the next phases depend on stable seams.

**Risk level**

**Medium**

**Concrete deliverables**

- `EngineCapabilities` contract
- real `AgentProfile` / execution-profile shape
- `RunProjection` / `RunSummary` contracts
- decision on daemon-stored anchors vs client-local layout state
- documented strategy for native host-tool RPC vs temporary bridge

---

### Phase 1: highest-leverage adoptions

**Objectives**

- build the operator workbench foundation
- add transcript projections
- add interrupted-run / resume / retry affordances
- add execution-profile visibility
- add setup/status/ops UX

**Exact areas likely affected**

- `@popeye/runtime-core`
- `@popeye/control-api`
- web inspector
- CLI (for parity on some actions)
- later Swift client contract generation

**Expected benefits**

- immediate operator leverage
- better debuggability
- better day-to-day usability without changing core runtime semantics
- a much stronger base for future domain connectors

**Dependency ordering**

Depends on Phase 0 contracts and engine-capability cleanup.

**Risk level**

**Low to Medium**

**Concrete deliverables**

- `/runs/:id/projection`
- `/runs/:id/summary`
- workbench restore
- saved views / pinned contexts
- setup/status page or wizard
- quick actions / palette
- better run/intervention navigation

---

### Phase 2: secondary improvements

**Objectives**

- add bounded delegated child-task orchestration
- preserve auditability and receipts
- expose a run/delegation tree in the workbench
- synthesize structured child-to-parent handoff

**Exact areas likely affected**

- `@popeye/contracts`
- `@popeye/runtime-core`
- `@popeye/engine-pi`
- possibly pi-mono / Pi host-tool support
- control API
- workbench UI

**Expected benefits**

- Popeye can decompose more complex tasks safely
- multi-step workflows become more legible
- delegation becomes a product feature, not an opaque prompt trick

**Dependency ordering**

Depends heavily on Phase 0 and Phase 1, especially transcript projections and engine capability cleanup.

**Risk level**

**High**

**Concrete deliverables**

- delegation batch/item data model
- child task/run linkage
- structured condensed child summaries
- parent continuation runs
- run-tree / child receipt UI

---

### Phase 3: optional / later-stage ideas

**Objectives**

- add explicit execution targets
- optionally add richer native Swift control-plane UX
- maybe later support alternate engine modes if genuinely needed

**Exact areas likely affected**

- config schema
- `runtime-core`
- `engine-pi`
- execution-target policy modules
- Swift app

**Expected benefits**

- stronger isolation options
- richer long-running operator control
- future flexibility without overcommitting early

**Dependency ordering**

Only after phases 0–2 are stable.

**Risk level**

**High**

**Concrete deliverables**

- `execution_targets`
- profile-to-target mapping
- target-aware scheduling and audit
- native workbench surfaces using the same control API

## 9. Concrete implementation guidance

### 9.1 New or expanded contracts

I would introduce the following explicit contracts in `@popeye/contracts`:

#### Engine-side seam

- `EngineCapabilities`
- `HostToolMode = "native" | "bridge" | "none"`
- `CancellationMode = "abort" | "terminate" | "best_effort"`
- `ExecutionTargetCapability[]`

#### Run/transcript layer

- `RunProjection`
- `RunProjectionSegment`
- `RunSummary`
- `RunResumeAction`
- `RunTreeNode`

#### Product profile layer

- `AgentProfile` expanded to include:
  - `engineKind`
  - `modelPolicy`
  - `runtimeToolSet`
  - `executionTargetId`
  - `sideEffectProfile`
  - `memoryBudgetPolicy`
  - later `connectorGrants`

#### Delegation layer

- `DelegationBatch`
- `DelegationItem`
- `DelegationContinuation`
- `DelegationChildSummary`

#### Workbench layer

- `WorkbenchAnchor`
- `SavedView`
- optionally `WorkbenchSnapshot` (daemon-stored anchor-level only)

### 9.2 Runtime modules to introduce or refactor

#### A. `runtime-core/run-projection.ts`

Responsibility:

- transform `run`, `run_events`, `receipt`, interventions, and maybe Telegram reply info into a canonical operator-facing structure

This should become the home for:

- current `getRunReply()` generalization
- tool/result grouping
- compaction rendering
- best-available final-answer extraction
- resume/retry action computation
- child-summary synthesis for delegation

This is the cleanest way to stop making each client reinvent transcript semantics.

#### B. `runtime-core/profile-service.ts` or equivalent

Responsibility:

- load/resolve execution profiles
- validate profile compatibility with engine capabilities
- resolve model/tool/target policy for a task/run

This is where OpenSquirrel’s “runtime/model/target selection” becomes a Popeye-native concept rather than raw runtime knobs.

#### C. `runtime-core/delegation-service.ts`

Responsibility:

- persist delegation batch/items
- enqueue child tasks
- collect child receipts / summaries
- decide when to enqueue the parent continuation run
- guard against recursion / depth / width explosions

Do **not** implement delegation inside the UI. Do **not** make it an implicit prompt-only convention forever.

#### D. `runtime-core/execution-targets.ts` (later)

Responsibility:

- resolve execution target by id
- validate profile/tool/target compatibility
- eventually route to local or remote runner

### 9.3 Database changes

I would keep Popeye’s current explicit state model and extend it, not replace it.

#### Likely new tables

- `saved_views` or `workbench_anchors`
- `delegation_batches`
- `delegation_items`

#### Likely useful new columns

- `tasks.profile_id`
- `jobs.profile_id` or inherited view
- `runs.profile_id`
- `runs.parent_run_id` (if using simple tree linkage)
- `runs.execution_target_id`
- maybe `runs.continuation_of_run_id`

#### Caching

A `run_projection_cache` table is optional, not required initially. I would start by deriving projections on read and add caching only if the UI proves it necessary.

### 9.4 Control API additions

The current control API is already the right place to surface new control-plane capabilities.

I would add:

- `GET /v1/runs/:id/projection`
- `GET /v1/runs/:id/summary`
- `GET /v1/runs/:id/tree`
- `GET /v1/profiles`
- `PUT /v1/workbench/default` or `GET/PUT /v1/saved-views/...`
- `GET /v1/setup/status`
- maybe `POST /v1/runs/:id/continue` if resume semantics become richer than retry

For delegation:

- `GET /v1/delegations/:id` if batches are first-class
- or expose delegation through `runs/:id/tree` if you want to keep the public API smaller

### 9.5 How the useful OpenSquirrel ideas should be integrated into Popeye

#### Persistent session restore → workbench restore

Do **not** recreate OpenSquirrel’s “spawn agent panes on startup from saved app state.”  
Instead:

- daemon stays source of truth,
- client stores local layout and view state,
- client asks daemon for current runs/interventions/workspace state,
- client reattaches to the existing world.

That preserves Popeye’s stronger architecture.

#### Delegation → child task/run batches

Do **not** recreate OpenSquirrel’s in-memory worker panes as the product model.  
Instead:

- parent run asks for delegation via a runtime tool or other structured mechanism,
- runtime persists child work as first-class tasks/jobs/runs,
- child receipts are summarized,
- parent continuation run receives the condensed result.

That preserves receipts, memory capture, and interventions.

#### Runtime abstraction → execution profiles + engine capabilities

Do **not** recreate OpenSquirrel’s raw runtime CLI selection as the main operator abstraction.  
Instead:

- operator selects named profiles,
- profile maps to engine/model/tool/target policy,
- adapter validates against engine capabilities,
- pi-mono remains the engine substrate.

#### MCP convenience → policy-driven tool attachment

Do **not** import raw `--mcp-config` assembly into Popeye core.  
Instead:

- define attachment descriptors at the profile/task level,
- let the adapter translate them into engine/runtime-specific form,
- keep the policy decision in Popeye.

### 9.6 pi-mono changes worth considering

Only a small number of comparison-driven changes belong in pi-mono:

#### Worth considering

1. **first-class host-tool RPC**
   - remove reliance on Popeye’s extension-UI workaround
   - make runtime-owned tools a normal engine feature

2. **clear capability reporting**
   - session resume
   - host tools
   - compaction events
   - maybe continuation/branch support

3. **possibly richer continuation primitives**
   - only if needed for parent/child continuation flows

#### Not worth moving into pi-mono

- Popeye’s task/job/run orchestration
- receipts/interventions/security audit
- workbench persistence
- delegation batches as a product concept
- execution profiles as product policy
- connector security boundaries

### 9.7 Testing strategy

The adoption should be validated with the same seriousness as Popeye’s current core.

I would add:

- projection fixtures for success/failure/cancelled/compacted runs
- engine capability contract tests
- host-tool-mode tests (`native` vs `bridge`)
- delegation integration tests using fake engine adapters
- startup restore tests for saved views / workbench anchors
- run-tree API tests
- policy tests that child delegation does not bypass workspace lock or profile constraints

## 10. Final verdict

### What you should definitely adopt

- **Operator workbench persistence and restore**
- **Transcript projection / explanation layer**
- **Real execution profiles**
- **A more explicit engine capability seam**
- **Bounded delegation with condensed child return**

These are the OpenSquirrel ideas with the best durability/fit ratio for Popeye.

### What you should probably ignore

- tiled multi-agent UI as the primary product shell
- UI-owned process orchestration
- raw multi-CLI wrapper complexity in Popeye core
- raw MCP CLI arg injection as architecture
- SSH + tmux remote execution as an early substrate
- monolithic UI/runtime coupling

### What gives the highest leverage for Popeye’s real future

The highest-leverage path is not “make Popeye more like OpenSquirrel.”

It is:

1. **keep Popeye’s core as-is**
2. **make the operator experience dramatically stronger**
3. **make execution posture explicit through profiles and capabilities**
4. **add auditable delegation only after the seam is ready**

If you do that, you keep the part of OpenSquirrel that is genuinely excellent—its operator-facing control-plane thinking—without sacrificing the part Popeye already does better: being a durable, local-first, operator-controlled runtime for a serious personal agent.
