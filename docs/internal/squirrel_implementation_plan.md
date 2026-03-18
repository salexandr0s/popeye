
# Squirrel-Informed Popeye Implementation Plan

## 1. Goal

Integrate the highest-value ideas revealed by the OpenSquirrel comparison into Popeye **without** collapsing Popeye’s daemon-first architecture, weakening privacy/security boundaries, or turning Popeye into a pane-based coding-agent console.

This plan assumes the target product is still:

- local-first
- operator-controlled
- daemon-based
- backed by durable local state
- designed for sensitive personal data
- eventually expanded with memory, communications, scheduling, repo awareness, and workflow automation

## 2. Guiding constraints

1. **Do not move product semantics into pi-mono.**  
   pi-mono stays the engine/foundation. Popeye stays the product runtime.

2. **Do not let UI state become canonical runtime state.**  
   Runtime truth remains in the daemon’s DB and receipts.

3. **Do not implement “multi-agent” as a UI gimmick first.**  
   If delegation is added, it must be auditable, bounded, and expressed in product nouns.

4. **Do not build around raw runtime knobs.**  
   Expose named execution profiles, not a giant matrix of runtime/model flags.

5. **Do not add remote execution before you have an execution-target abstraction.**

## 3. Target architecture after the first two phases

```text
Clients (CLI / Web Inspector / Swift)
        |
        v
Control API
        |
        v
Popeye Runtime
  - scheduler
  - run coordinator
  - profile resolver
  - run projection service
  - delegation service
  - memory / receipts / audit
  - workbench anchor support
        |
        v
Engine Adapter (engine-pi)
  - capability reporting
  - host-tool transport
  - execution-target adapter
        |
        v
pi-mono / Pi
  - provider/model abstraction
  - agent loop
  - tool execution
  - session tree / compaction
  - RPC / SDK
```

## 4. Top components to implement

### Component A — Engine capability registry + host-tool bridge cleanup

#### Why this comes first

Popeye can add control-plane polish without changing the engine seam, but it should **not** add stronger runtime-owned tools or delegated subtasks on top of a hidden/fragile seam.

Today, `engine-pi` is good overall, but runtime-owned tools still depend on a fallback path that uses a temporary extension plus `extension_ui_request`. That is too brittle to become the foundation for delegation, connector tools, or richer operator control.

#### What to build

Add an explicit `EngineCapabilities` contract.

Suggested shape:

```ts
type HostToolMode = "native" | "bridge" | "none";
type CancellationMode = "abort" | "terminate" | "best_effort";

interface EngineCapabilities {
  engineKind: string;
  persistentSessions: boolean;
  resumeBySessionRef: boolean;
  hostToolMode: HostToolMode;
  emitsCompactionEvents: boolean;
  cancellationMode: CancellationMode;
  supportsExecutionTargets: string[];
}
```

Extend `EngineAdapter` with either:

- `getCapabilities(): EngineCapabilities`
- or a `capabilities` property exposed on construction

#### Where to implement it

**Popeye**

- `@popeye/contracts`: add capability types
- `@popeye/engine-pi`: implement capabilities for the current Pi adapter
- `@popeye/runtime-core`: validate capabilities on startup and record warnings/audit events if a degraded mode is active

**pi-mono / Pi**

- if possible, add or stabilize first-class host-tool RPC so Popeye can stop depending on the extension-UI carrier for runtime tools

#### What not to do

- Do not design a giant speculative capability system.
- Do not move Popeye’s orchestration into pi-mono.
- Do not wait for perfect multi-engine support before making the seam explicit.

#### Acceptance criteria

- runtime startup can report the active engine capability set
- host-tool mode is operator-visible in health/status
- runtime-owned tools no longer rely on hidden behavior
- degraded host-tool mode is clearly visible and tested

---

### Component B — Run projection service

#### Why this is high leverage

Popeye already stores better raw run data than OpenSquirrel. The missing layer is **projection**.

Without projection, every client has to piece together raw `run_events`, receipt data, and special cases. With projection, Popeye gets:

- readable run timelines
- robust final-output extraction
- interruption/resume affordances
- channel reply reuse
- delegation handoff reuse
- future native UI compatibility

#### What to build

A `RunProjectionService` in `runtime-core`.

Suggested outputs:

```ts
interface RunProjection {
  run: RunRecord;
  receipt: ReceiptRecord | null;
  summary: RunSummary;
  segments: RunProjectionSegment[];
  resumeActions: RunResumeAction[];
  replyCandidate: { source: string; text: string } | null;
  childRuns?: RunTreeNode[];
}

type RunProjectionSegment =
  | { kind: "prompt"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool_call"; toolName: string; args?: unknown }
  | { kind: "tool_result"; toolName: string; isError: boolean; text?: string }
  | { kind: "compaction"; summary: string }
  | { kind: "system"; text: string }
  | { kind: "error"; text: string };
```

Start by building it from:

- `runs`
- `run_events`
- `receipts`
- maybe interventions and delivery metadata where useful

Use existing canonical run-reply logic as one input, not the whole design.

#### Where to implement it

- `packages/runtime-core/src/run-projection.ts` (or equivalent)
- `packages/control-api`: add:
  - `GET /v1/runs/:id/projection`
  - `GET /v1/runs/:id/summary`

#### UI uses

- run detail view
- recent runs view
- failed-run debug view
- intervention context
- future delegation tree
- Telegram reply debug page

#### What not to do

- Do not make transcript projection the canonical store.
- Do not collapse memory summaries and transcript summaries into one thing.
- Do not make UI render raw events forever.

#### Acceptance criteria

- a client can render a full run from one projection call
- success/failure/cancelled/compacted runs have consistent projections
- reply generation can reuse projection logic
- projections are deterministic and test-covered

---

### Component C — Make execution profiles real

#### Why this matters

OpenSquirrel exposes runtime/model/target choices explicitly. Popeye should absorb that lesson in a safer way: by turning `agent_profiles` into first-class execution profiles.

This is how Popeye should express differences such as:

- read-only vs side-effecting work
- safe inbox triage vs repo maintenance
- sensitive-data-only local execution
- different memory budgets or model families
- later different connector/tool grants

#### What to build

Expand `agent_profiles` into something like the real product-policy object they already hint at in the schema:

```ts
interface AgentProfile {
  id: string;
  name: string;
  description?: string;
  engineKind: string;
  modelPolicy: {
    preferredModel?: string;
    reasoningStyle?: "minimal" | "balanced" | "deep";
  };
  sideEffectProfile: "read_only" | "external_side_effect";
  runtimeTools: string[];
  executionTargetId: string;
  memoryPolicy?: {
    maxRetrievedItems?: number;
    allowPromotion?: boolean;
  };
  connectorGrants?: string[]; // later
}
```

Then add profile resolution into task/job/run creation.

#### Where to implement it

**Popeye**

- `@popeye/contracts`: profile types
- DB migrations: expand `agent_profiles`, add `profile_id` to tasks/runs if needed
- `runtime-core`: profile resolver and validation
- `control-api`: list/get/update profiles if editable at runtime
- UI: profile selection and display

**pi-mono / engine-pi**

- consume resolved profile output indirectly through engine request fields
- do not own the profile concept

#### Good defaults to introduce

Start with a small, opinionated set:

- `default_interactive`
- `safe_read_only`
- `repo_maintenance`
- `sensitive_local_only`

#### What not to do

- Do not expose raw runtime CLI flags everywhere.
- Do not make profiles a dumping ground for every engine setting.
- Do not skip profiles and jump straight to multi-runtime UI.

#### Acceptance criteria

- every task/run has a clear effective profile
- profile choice is visible in receipts and run detail
- runtime rejects incompatible profile/capability combinations cleanly
- profiles are testable policy objects, not UI-only labels

---

### Component D — Operator workbench persistence and restore

#### Why this matters

Popeye has runtime durability; it needs operator continuity.

A good workbench restore should let the operator reopen the control plane and return to:

- the same workspace/run/intervention context
- the same saved view
- the same recent filters
- the same “what needs attention?” state

without making UI state authoritative.

#### What to build

A two-tier workbench model:

#### 1. Daemon-stored anchors

These are worth syncing across clients:

- saved views
- pinned runs/tasks/interventions
- last-opened workspaces or panels
- maybe named operator dashboards

#### 2. Client-local layout state

These should stay local:

- pane widths
- scroll offsets
- temporary drafts
- last selected tab inside a detail pane

#### Where to implement it

**Popeye**

- `contracts`: `WorkbenchAnchor`, `SavedView`
- maybe DB table `saved_views` or `workbench_anchors`
- `control-api`:
  - `GET /v1/saved-views`
  - `PUT /v1/saved-views/:id`
  - or a simpler `/v1/workbench/default`

**Clients**

- web inspector: use local storage for layout, daemon for anchors
- Swift app later: same contract

#### Suggested first saved views

- `attention` — open interventions, uncertain deliveries, failed runs
- `recent activity`
- `memory curation`
- `workflows`

#### What not to do

- Do not copy OpenSquirrel’s “full app state in JSON is the truth” model.
- Do not store unsent secrets or long drafts server-side unless you really mean to.
- Do not let workbench restore re-drive execution automatically.

#### Acceptance criteria

- reopening the web inspector restores the operator to a coherent context
- saved views can be shared across clients
- runtime truth still comes only from tasks/jobs/runs/interventions/etc.

---

### Component E — Setup wizard + command palette + ops surfaces

#### Why this matters

Popeye already has operational power hidden in backend and CLI surfaces. The control plane should make important operator actions obvious.

This is one of the most useful ideas OpenSquirrel demonstrates.

#### What to build

A setup/status surface with checks for:

- daemon status
- engine/Pi compatibility
- auth initialized / rotation age
- runtime data directory permissions
- workspace registration
- memory mode (FTS only vs vector enabled)
- backup freshness
- Telegram relay status
- open interventions / uncertain deliveries

And a command palette with actions like:

- create task
- retry failed run
- cancel active run
- resolve intervention
- rotate auth token
- trigger memory maintenance
- create backup
- switch saved view

#### Where to implement it

- `runtime-core`: aggregate setup/status service
- `control-api`: `GET /v1/setup/status`
- web inspector first
- Swift later against the same API

#### What not to do

- Do not make it mostly cosmetic.
- Do not expose raw engine details when a profile-level action is clearer.
- Do not let the setup wizard become a second configuration system.

#### Acceptance criteria

- first-time operator can confirm system health without touching internal files
- recurring operator actions are accessible from one command surface
- interventions and degraded states are obvious

---

### Component F — Delegation service (Phase 2)

#### Why this is the most powerful later addition

If Popeye is going to become a serious personal agent, some tasks will benefit from bounded decomposition. OpenSquirrel shows a good child-to-parent handoff pattern. Popeye should implement it using its own product nouns.

#### The correct Popeye-shaped model

Do **not** keep parent and worker processes as in-memory UI objects.  
Do **not** push this down into pi-mono either; the inspected pi-coding-agent docs explicitly position sub-agents/orchestration as something higher layers should own.

Instead:

1. a parent run issues a structured delegation request
2. Popeye persists a delegation batch
3. Popeye creates child tasks/jobs/runs
4. child runs produce receipts and projections
5. Popeye synthesizes a condensed child-summary artifact
6. Popeye enqueues a parent continuation run on the parent session root
7. the parent continuation receives the condensed summaries, not the full child transcripts

This fits Popeye far better than copying OpenSquirrel’s pane model.

#### Data model options

I recommend explicit tables:

```text
delegation_batches
- id
- parent_run_id
- parent_task_id
- parent_session_root_id
- status
- created_at
- completed_at
- continuation_task_id
- continuation_run_id

delegation_items
- id
- batch_id
- ordinal
- title
- prompt
- profile_id
- execution_target_id
- child_task_id
- child_job_id
- child_run_id
- status
- summary_json
- created_at
- completed_at
```

You can also add `parent_run_id` to `runs` for easier tree queries.

#### How the parent requests delegation

Best option after host-tool cleanup:

- add a runtime-owned tool such as `popeye_delegate_tasks`

This is better than a fenced-output convention because it is explicit, validated, and auditable.

Suggested input shape:

```ts
{
  tasks: [
    {
      id: "string",
      title: "string",
      prompt: "string",
      profileId?: "string",
      executionTargetId?: "string"
    }
  ]
}
```

#### Concurrency rule for v1

Because Popeye currently enforces one active run per workspace by default, do **not** immediately implement free concurrent worker execution in the same workspace.

Start with one of these:

- sequential child execution in the same workspace
- concurrency only when children target distinct execution targets/workspaces
- no recursive delegation by workers

This keeps the existing lock/recovery model intact.

#### Child-to-parent handoff

Each child handoff should include:

- child run id
- title / task id
- final status
- usage
- tool summary
- diff/file summary if relevant
- condensed final output
- link to child receipt / artifacts

This should be generated by the run projection layer, not by ad hoc string scraping.

#### Where to implement it

- `runtime-core/delegation-service.ts`
- `runtime-core/run-projection.ts`
- `control-api` run-tree or delegation endpoints
- `engine-pi` runtime-tool transport
- UI tree view in the web inspector

#### What not to do

- Do not let delegation bypass profile or target policy.
- Do not allow infinite depth or unbounded fan-out.
- Do not bury child outcomes in prompt text only.

#### Acceptance criteria

- a parent run can request child work through a structured path
- child work produces ordinary receipts and memory capture
- the parent continuation gets a bounded structured summary
- the operator can inspect the full run tree
- failures create interventions in the right place

---

### Component G — Optional later: execution target abstraction

#### Why it is later

This is useful, but only after profiles and delegation exist. Otherwise it becomes a premature transport feature.

#### What to build

A product-layer target registry:

```ts
interface ExecutionTarget {
  id: string;
  kind: "local" | "ssh" | "sandbox";
  description?: string;
  capabilities?: string[];
  policy?: {
    allowSensitiveData: boolean;
    allowWriteTools: boolean;
  };
}
```

Tasks/runs should reference `execution_target_id`, not raw host strings.

#### Where to implement it

- contracts + config schema
- runtime-core target resolver
- engine adapter target execution path
- later UI target selection through profiles

#### What not to do

- Do not make `ssh+tmux` the public abstraction.
- Do not hide secret or data-classification rules behind target implementation details.

#### Acceptance criteria

- target choice is visible and auditable
- profiles constrain valid targets
- target execution failures are first-class runtime events

## 5. Suggested implementation sequence

### PR 1 — Contracts and capability seam

- add `EngineCapabilities`
- add expanded `AgentProfile` contracts
- add `RunProjection` / `RunSummary`
- expose engine capabilities through `engine-pi`
- runtime startup logs/report include capability state

### PR 2 — Run projection service

- add projection module in runtime-core
- add `/v1/runs/:id/projection` and `/summary`
- add fixture tests

### PR 3 — Make `agent_profiles` functional

- DB migration
- profile resolver
- task/run linkage
- profile visibility in run detail / receipts

### PR 4 — Workbench anchors and saved views

- daemon-stored saved views
- web inspector restore using daemon anchors + local layout storage
- basic command palette

### PR 5 — Setup/status surface

- aggregate setup/status endpoint
- web inspector setup page / health page
- quick actions for core admin tasks

### PR 6 — Native host-tool cleanup

- improve Pi / pi-mono host-tool support if needed
- reduce reliance on extension-UI bridge
- make host-tool mode reliable enough for stronger runtime tools

### PR 7 — Delegation batch schema + runtime service

- `popeye_delegate_tasks`
- delegation tables
- child task/run orchestration
- parent continuation flow
- fake-engine integration tests

### PR 8 — Run tree UI

- show parent/child relationships
- condensed child results
- links to full receipts/projections
- guardrail visibility (depth/fan-out/profile/target)

### PR 9+ — Optional execution targets and Swift client

- only after the above are stable

## 6. What this plan deliberately does not solve yet

This plan is about the **control plane and orchestration quality** revealed by the OpenSquirrel comparison. It does **not** directly solve:

- email connector implementation
- calendar connector implementation
- repo/issue/PR connector implementation
- local-only embeddings/summarization strategy
- broader workflow engine design

That is fine. The point of these changes is to make those future domains fit naturally into Popeye.

Once these components exist, future connectors can plug into a much stronger substrate:

- profile-governed execution
- projection-rich run inspection
- saved operator workbench
- delegation when needed
- clearer engine capabilities
- explicit target policies

## 7. Final implementation recommendation

If I were implementing this next, I would not start with multi-agent UI.

I would start with:

1. **engine capabilities**
2. **run projections**
3. **real execution profiles**
4. **workbench restore**
5. **setup/status UX**
6. **only then delegation**

That order gives Popeye the part of OpenSquirrel that most improves an always-on personal agent: not the visible swarm, but the **operable, restorable, profile-aware control plane** around a durable local runtime.
