# Hermes → Popeye Implementation Plan

**Document status:** implementation plan derived from the prior repo-first analysis  
**Primary goal:** turn the Hermes comparison into a concrete, architecture-safe build sequence for Popeye  
**Planning stance:** not greenfield, not a rewrite, not a feature wishlist

---

## 1. Planning frame

This plan assumes the following baseline is already true in Popeye:

- the **runtime is the product core**
- **Pi / pi-mono remains the engine substrate**, not the product surface
- Popeye already has durable runtime nouns and state: **Task → Job → Run**, receipts, interventions, memory, session roots, a control API, and an always-on daemon
- the next step is **not** “make Popeye more like Hermes”
- the next step **is** to selectively add the Hermes patterns that improve continuity, reuse, and controlled autonomy without weakening Popeye’s trust boundary

That changes how the work should be sequenced:

1. **harden what Popeye already has**
2. add **recall and continuity**
3. add **reusable procedure**
4. add **policy/capability control**
5. only then add **controlled autonomy**
6. treat any Hermes-like code/program execution as **late and optional**

---

## 2. Success criteria

This implementation plan is successful if, after execution, Popeye can do all of the following **without architecture drift**:

- recover prior work from real historical artifacts instead of forcing everything into memory
- reuse operator-owned procedures/playbooks across runs
- run under explicit capability/policy profiles
- decompose work into auditable child runs when needed
- improve Telegram and always-on interaction semantics
- stay local-first, operator-controlled, and maintainable
- keep sensitive-data handling and policy enforcement in Popeye rather than leaking them into pi-mono

It is **not** successful if it introduces any of these:

- a plugin marketplace
- automatic third-party package installs
- broad MCP-style dynamic tool loading
- multi-tenant assumptions
- hidden subagent behavior with weak lineage
- “agent loop as product core”
- a sprawling gateway abstraction copied from Hermes

---

## 3. Architectural guardrails

These are hard constraints for every phase.

### 3.1 What stays in Popeye

These are product-semantic and should remain Popeye-owned:

- receipts
- interventions
- memory policy
- recall policy
- playbooks / procedural knowledge
- capability profiles
- connector permissions
- email/calendar/repo/file access policy
- scheduling semantics
- message ingress rules
- operator approval workflows
- audit and redaction policy
- session-root policy
- child-run lineage

### 3.2 What may belong in pi-mono

Only move something into pi-mono if it is a genuinely generic engine/runtime capability that would help more than one product.

The only realistic candidates from this plan are:

- better child-session primitives
- richer cancellation hooks
- metadata passthrough on sessions/runs
- tighter host-tool restriction hooks
- generic context-file loading primitives if Popeye cannot cleanly resolve prompt inputs itself

### 3.3 What should not move into pi-mono

Do **not** move any of these into pi-mono:

- recall service
- artifact indexing
- playbook approval/versioning
- connector adapters
- operator-facing policy bundles
- receipts or intervention records
- content-ingress scanning policy
- Telegram semantics
- backup/restore behavior
- sensitive-data handling rules

---

## 4. Implementation strategy at a glance

| Phase | Theme | Primary repo | Why now | Risk |
|---|---|---|---|---|
| Phase 0 | Hardening and cleanup | Popeye | closes known runtime gaps before new product behavior lands | Low |
| Phase 1 | Continuity foundation | Popeye | highest-leverage Hermes lesson: recall and context continuity | Medium |
| Phase 2 | Reusable procedure and policy | Popeye | makes behavior durable and operator-owned | Medium |
| Phase 3 | Controlled autonomy | Popeye, maybe tiny pi-mono support | adds power only after control surfaces exist | Medium–High |
| Phase 4 | Optional bounded execution | Popeye | only if later justified; easiest to get wrong | High |

---

## 5. Phase 0 — harden the current runtime first

This phase is mandatory. It converts the remaining “known gaps” in Popeye into a safer base for the Hermes-inspired work.

## 5.1 Structured logging and event normalization

### Objective
Make every important runtime action traceable across daemon, API, scheduler, engine adapter, message ingress, memory, and future delegation.

### Why this is first
Recall, playbooks, capability profiles, and child runs all increase state complexity. Without correlation IDs and normalized events, Popeye will get harder to debug at exactly the moment it needs to become more trustworthy.

### Primary ownership
**Popeye only**

### Packages affected
- `packages/observability`
- `packages/contracts`
- `packages/runtime-core`
- `packages/control-api`
- `packages/engine-pi`
- `apps/daemon`
- `apps/cli`

### Concrete work
1. Introduce a shared `LogContext` / `ExecutionContext` schema in `@popeye/contracts`.
2. Standardize these correlation fields:
   - `workspaceId`
   - `projectId`
   - `taskId`
   - `jobId`
   - `runId`
   - `sessionRootId`
   - `messageThreadId` or equivalent
   - `parentRunId` (reserved now, used in Phase 3)
3. Replace ad hoc log writes with one structured logger interface.
4. Add an event normalization layer so engine events, message events, scheduler events, security events, and future delegation events map into one consistent envelope.
5. Ensure SSE, receipts, and security audit records can all point back to the same correlated run context.
6. Add redaction at the logger boundary, not only at downstream sinks.

### Deliverables
- `ExecutionContextSchema`
- shared logger implementation
- normalized event envelope
- runtime-wide log plumbing
- end-to-end correlation in at least one full run path

### Acceptance criteria
- a single run can be traced from ingress to receipt using stable IDs
- security audit entries and runtime logs refer to the same correlated operation
- `pop run show` and the web inspector can display the same lineage IDs that logs use
- no module emits raw free-form error logs for expected runtime flows

### Risks
- log payload sprawl
- over-logging sensitive data

### Mitigation
- default-to-structured metadata, not giant text blobs
- centralize redaction in observability package

---

## 5.2 Migration tooling, packaging, and health checks

### Objective
Make Popeye installable, inspectable, and upgradable without requiring maintainers to reason directly from the monorepo layout.

### Primary ownership
**Popeye only**

### Packages/apps affected
- `apps/cli`
- `apps/daemon`
- `packages/runtime-core`
- docs / runbooks

### Concrete work
1. Add `pop daemon health`.
2. Add `pop migrate status`.
3. Add `pop migrate plan`.
4. Add `pop migrate apply` with backup-before-apply behavior.
5. Add a release/install path that can bootstrap:
   - runtime data directories
   - auth material
   - launchd service metadata
   - initial config validation
6. Expand backup/restore docs into an operator-grade runbook.

### Deliverables
- migration CLI
- release/install bootstrap flow
- daemon health command
- backup-before-migrate workflow

### Acceptance criteria
- a clean machine or clean runtime directory can be bootstrapped without manual repo surgery
- schema upgrades are visible before they are applied
- backup is created automatically before destructive migration steps

### Risks
- upgrade path bugs
- mismatch between release artifacts and launchd assumptions

### Mitigation
- release smoke tests
- migration test fixtures with old DB snapshots

---

## 5.3 Continuous Pi compatibility verification

### Objective
Turn the Pi boundary from “well designed” into “continuously enforced”.

### Primary ownership
**Popeye first**  
**pi-mono only if a real boundary gap is discovered**

### Packages affected
- `packages/engine-pi`
- CI workflows
- `scripts/check-pi-boundary.*`
- smoke fixtures

### Concrete work
1. Add CI that runs Popeye against the pinned Pi version plus the exact checked-out fork state.
2. Convert the current smoke into a repeatable compatibility suite.
3. Assert required engine event shapes, cancellation behavior, and session selection invariants.
4. Fail CI if `engine-pi` starts depending on internals outside the allowed boundary.

### Deliverables
- boundary smoke suite
- CI gate
- compatibility report artifact

### Acceptance criteria
- Pi upgrades fail fast in CI rather than surfacing through runtime breakage later
- engine adapter regressions are visible before release

### Risks
- flaky smoke tests
- excessive coupling to Pi implementation details

### Mitigation
- assert only the runtime contract, not Pi internals
- keep smoke minimal and deterministic

---

## 5.4 Hybrid memory test closure

### Objective
Close the gap between the sophistication of Popeye’s memory design and the confidence of its automated test coverage.

### Primary ownership
**Popeye only**

### Packages affected
- `packages/memory`
- integration test fixtures
- CI config

### Concrete work
1. Add a full hybrid search integration test for the FTS5 + sqlite-vec path.
2. Add explicit fallback tests for vec-unavailable mode.
3. Add invariants for:
   - provenance preservation
   - confidence decay
   - consolidation behavior
   - doc indexing flow
4. Add a regression test for memory search under realistic run/receipt ingestion.

### Acceptance criteria
- the combined retrieval path is exercised end-to-end in CI where supported
- fallback behavior is explicitly tested where vec is unavailable

---

## 6. Phase 1 — continuity foundation

This is the most important Hermes-inspired phase. It gives Popeye a real answer to “how does the system remember what happened before?” without abusing the memory subsystem.

## 6.1 Build a recall index and `RecallService`

### Objective
Create a first-class recall surface for historical work artifacts.

### Why this matters
Hermes is strong because it separates **history recall** from **durable memory**. Popeye already has richer artifacts than Hermes. This phase turns those artifacts into something the operator and the agent can actually query.

### Primary ownership
**Popeye only**

### Recommended location
Start in `packages/runtime-core` as a dedicated service.  
Do **not** create a separate package yet unless it becomes independently reusable.

### Core design decision
Index **high-signal artifacts first**, not raw event firehose data.

### Initial indexed sources
- receipt summaries
- receipt details (redacted form only)
- run outputs
- message bodies / ingress bodies
- intervention reasons
- generated session summaries (see 6.2)
- later: connector summaries for email/calendar/repo

### Do not index initially
- full raw `run_events`
- raw tool payload dumps
- unredacted sensitive content blobs
- arbitrary workspace file content outside explicit policy

### Suggested schema additions
**App DB**
- `artifact_index`
- `artifact_links`
- `session_summaries`

Suggested shape:

- `artifact_index`
  - `artifactType`
  - `artifactId`
  - `workspaceId`
  - `sessionRootId`
  - `sourceRunId`
  - `title`
  - `summary`
  - `body`
  - `sensitivityClass`
  - `createdAt`
  - `updatedAt`

- `artifact_links`
  - `parentArtifactType`
  - `parentArtifactId`
  - `childArtifactType`
  - `childArtifactId`
  - `relation`

Use FTS5 over the recall body/summary fields and keep artifact metadata in ordinary relational tables.

### Service responsibilities
- perform FTS search across recall artifacts
- merge or rank with memory search where appropriate
- return provenance-rich hits
- optionally generate a compact result summary
- enforce workspace/profile/sensitivity scope

### Runtime tools
Add runtime-owned tools such as:
- `history_search`
- `artifact_open`
- `related_artifacts`

### API surface
- `GET /v1/recall/search`
- `GET /v1/recall/artifacts/:type/:id`
- `GET /v1/runs/:id/related`
- `GET /v1/session-roots/:id/history`

### CLI surface
- `pop recall search`
- `pop recall open`
- `pop run related`
- `pop session history`

### Web inspector surface
- recall search view
- related artifacts panel on run/receipt pages
- session history page

### Acceptance criteria
- a prior decision recorded in a receipt can be found through recall without promoting it to memory
- a run page can show related receipts/messages/interventions
- the agent can retrieve relevant history through a bounded runtime tool instead of needing giant prompt history

### Risks
- recall becoming a second memory subsystem
- accidental overexposure of sensitive historical material

### Mitigation
- keep recall artifact-oriented and provenance-first
- scope by workspace/profile
- default to summaries before raw bodies
- require explicit escalation to expose sensitive full content

---

## 6.2 Add generated session summaries

### Objective
Make long-lived continuity usable without requiring full transcript replay or noisy indexing.

### Primary ownership
**Popeye only**

### Packages affected
- `packages/runtime-core`
- `packages/contracts`
- maybe `packages/receipts`

### Concrete work
1. Generate a bounded summary after run finalization for the owning `sessionRoot`.
2. Update the summary incrementally instead of reconstructing from scratch each time.
3. Store the summary in `session_summaries`.
4. Record source artifact span and provenance.
5. Use session summaries as the first recall/search target for long histories.

### Important rule
Session summaries are **recall artifacts**, not durable personal memory facts.  
Do not auto-promote them into memory.

### Acceptance criteria
- long-running interactive threads remain searchable and explainable
- recall results can point to a concise session-level summary first, then drill into underlying artifacts

---

## 6.3 Add recursive context layering without replacing Popeye’s existing control files

### Objective
Adopt the useful Hermes pattern of hierarchical/project-local context discovery while preserving Popeye’s stronger operator-owned instruction model.

### Primary ownership
**Popeye only**

### Packages affected
- `packages/instructions`
- `packages/workspace`
- `packages/runtime-core`
- `apps/cli`
- `packages/control-api`

### Concrete work
1. Keep existing high-authority files (`WORKSPACE.md`, `PROJECT.md`, `IDENTITY.md`, `HEARTBEAT.md`) as the main control surfaces.
2. Add an additional lower-precedence source type for recursive context files.
3. Support one of these two options:
   - **Option A (recommended):** Popeye-native `.popeye/context/*.md`
   - **Option B (compatibility):** read-only support for `AGENTS.md` when present inside a registered workspace
4. Walk from the effective working path upward to the workspace root.
5. Snapshot all discovered files with path, hash, and precedence into `instruction_snapshots`.
6. Add:
   - `pop instructions preview --explain`
   - `pop instructions diff`
7. Extend critical-file protection to any operator-owned Popeye context directory.

### Recommendation
Prefer **Option A** as the canonical Popeye shape and support `AGENTS.md` only as an import/compatibility layer. That keeps Popeye’s architecture coherent while still learning from Hermes’s path-based context pattern.

### Acceptance criteria
- instruction resolution can explain exactly which recursive context files contributed to a run
- no recursive context source can silently outrank operator-owned control files
- the CLI can diff two compiled instruction bundles

### Risks
- instruction precedence confusion
- accidental sprawl of context sources

### Mitigation
- explicit precedence in docs and preview output
- hash/snapshot every resolved file
- keep high-authority sources few and obvious

---

## 7. Phase 2 — reusable procedure and explicit policy

This phase turns Hermes’s best “skills” ideas into a Popeye-native, operator-safe form.

## 7.1 Introduce Popeye playbooks

### Objective
Create a durable, reviewable, reusable procedure layer.

### Why this matters
A personal agent becomes much more useful when repeated workflows stop living only in transcripts or giant prompts.

### Primary ownership
**Popeye only**

### Recommended packaging
Create a new package: `packages/playbooks`

Reason:
- this is a first-class new product domain
- it will touch runtime-core, instructions, control-api, CLI, web-inspector, and memory
- keeping it explicit is cleaner than burying it inside instructions forever

### Canonical storage model
Use a hybrid model:

1. **human-readable canonical files**
   - global: under runtime data
   - workspace/project: under a protected Popeye-owned directory such as `.popeye/playbooks/`

2. **operational metadata in app DB**
   - status
   - bindings
   - revision hashes
   - activation state
   - usage records
   - proposal/approval state

### Suggested file format
Markdown with front matter, for example:

```md
---
id: mail-triage
title: Mail triage
scope: workspace
effectClass: read_only
sensitivity: medium
allowedProfiles:
  - mail/triage
requiredTools:
  - mail.read
  - memory.search
  - receipt.write
activation: manual
---
# Purpose
...
# Procedure
...
# Escalation rules
...
```

### Suggested schema additions
- `playbooks`
- `playbook_revisions`
- `playbook_bindings`
- `playbook_usage`
- `playbook_proposals`

Suggested lifecycle:
- `draft`
- `proposed`
- `approved`
- `active`
- `retired`

### Runtime behavior
1. A run resolves applicable playbooks from scope + profile + trigger.
2. The instruction resolver compiles them into the run’s instruction bundle.
3. The final snapshot records exact playbook IDs and revision hashes.
4. Receipts record playbook usage.
5. Approved playbooks may optionally be indexed as procedural memory with provenance.

### Agent permissions
Allow:
- `playbook_search`
- `playbook_view`
- `playbook_propose`

Do not allow by default:
- silent activation
- silent mutation of protected playbooks
- direct deletion of active playbooks

### API surface
- `GET /v1/playbooks`
- `GET /v1/playbooks/:id`
- `GET /v1/playbooks/:id/revisions`
- `POST /v1/playbooks`
- `POST /v1/playbooks/:id/propose`
- `POST /v1/playbooks/:id/activate`
- `POST /v1/playbooks/:id/retire`

### CLI surface
- `pop playbook list`
- `pop playbook show`
- `pop playbook diff`
- `pop playbook approve`
- `pop playbook activate`
- `pop playbook retire`

### Web inspector surface
- playbooks list/detail/revision pages
- proposal review queue
- “used by these runs” linkage

### Acceptance criteria
- a repeated workflow can be captured once and reused across runs
- every active playbook is inspectable, versioned, and linked to receipts
- the agent can suggest changes without becoming the owner of the procedure layer

### Risks
- playbooks turning into a plugin ecosystem
- hidden behavior changes from mutable instructions

### Mitigation
- keep them local, explicit, versioned, and approval-gated
- no third-party package install path
- snapshot everything that materially affects a run

---

## 7.2 Expand `agent_profiles` into real capability profiles

### Objective
Turn profiles into enforceable policy bundles rather than labels.

### Primary ownership
**Popeye only**

### Packages affected
- `packages/contracts`
- `packages/runtime-core`
- `packages/control-api`
- `packages/engine-pi` (only to pass final allowed tool list)
- `apps/cli`
- `apps/web-inspector`

### Recommended implementation shape
Extend the existing `agent_profiles` model in place rather than introducing a second profile concept.

Use a structured policy object validated by Zod, for example:

- allowed runtime tools
- allowed connector scopes
- allowed memory scopes
- allowed recall scopes
- session policy default
- intervention policy
- max side-effect class
- max delegation depth
- allowed child profiles
- default playbook bindings
- message interrupt policy
- sensitivity handling mode

### Suggested seed profiles
- `interactive/general`
- `background/heartbeat`
- `repo/read_only`
- `repo/reviewer`
- `mail/triage`
- `calendar/read_only`
- `calendar/assistant`
- `files/read_sensitive`
- `files/write_guarded`
- `operator/admin`

### Enforcement points
- run creation
- instruction resolution
- runtime tool exposure
- connector access
- message ingress routing
- future delegation policy
- UI/admin surfaces

### Important rule
Profiles are not just convenience presets. They must be enforced in runtime code.

### Acceptance criteria
- a run cannot access tools or connectors outside its assigned profile
- the UI and CLI can show the effective policy bundle for any run
- future connectors can attach to profiles without ad hoc special cases

### Risks
- profiles degenerating into labels
- overcomplicated policy schema too early

### Mitigation
- start with one structured policy object on `agent_profiles`
- normalize later only if operationally necessary

---

## 7.3 Generalize content-ingress safety scanning

### Objective
Create one reusable safety-scanning path for any content that may enter Popeye prompts, memory, recall indexes, or durable storage.

### Why this matters
Popeye is moving toward highly sensitive connectors and permitted-file access. Hermes is a useful reminder that broad capability surfaces get dangerous quickly; Popeye should answer that with shared product-level scanning and escalation logic, not scattered per-feature checks.

### Primary ownership
**Popeye only**

### Packages affected
- `packages/runtime-core`
- `packages/memory`
- `packages/workspace`
- `packages/control-api`
- future connector packages
- `packages/playbooks`

### Concrete work
1. Extract the reusable parts of current ingress/safety checks into one shared scanning module.
2. Apply that module to:
   - message ingress
   - workspace doc indexing
   - playbook proposals
   - future email/calendar/repo/file content ingestion
3. Standardize scan outcomes:
   - `allow`
   - `allow_with_warning`
   - `block`
   - `escalate_to_intervention`
4. Write every scan decision to `security_audit`.
5. Attach scan metadata to receipts where content materially influenced a run.

### Important rule
This is a product safety boundary, not an LLM prompt trick. The model may help classify content, but the runtime owns the enforcement and escalation path.

### Acceptance criteria
- all new content-ingress paths use one shared scan/evaluate interface
- a blocked or escalated content item is visible in audit records
- connector authors do not need to invent their own prompt-injection/safety handling

### Risks
- false positives on useful content
- false confidence if scanning is treated as a complete defense

### Mitigation
- make policies configurable by profile/connector
- record both the scan outcome and the reason
- keep operator override explicit and receipted

---

## 7.4 Define connector contracts before building sensitive connectors

### Objective
Prepare the architecture for email/calendar/repo/file access without prematurely implementing all connectors.

### Primary ownership
**Popeye only**

### Packages affected
- `packages/contracts`
- `packages/runtime-core`
- maybe new connector packages later

### Concrete work
1. Define a connector contract shape:
   - capability name
   - read/write classes
   - redaction policy
   - receipt policy
   - memory-promotion policy
   - recall indexing policy
   - sensitivity class
2. Add connector-scope support to capability profiles.
3. Add receipt metadata conventions for connector-backed side effects.

### Why now
This prevents the first mail/calendar/repo connector from inventing its own security model.

### Acceptance criteria
- the first sensitive connector can plug into an existing policy model rather than inventing one
- receipts and interventions can represent connector activity uniformly

---

## 8. Phase 3 — controlled autonomy

Only start this phase after Phases 0–2 are functioning.

## 8.1 Implement delegation as explicit child runs

### Objective
Adopt the useful Hermes pattern of decomposition, but map it onto Popeye’s stronger Task/Job/Run model instead of hidden subagents.

### Primary ownership
**Popeye first**  
**pi-mono only if a genuinely generic session/cancel primitive is missing**

### Packages affected
- `packages/contracts`
- `packages/runtime-core`
- `packages/control-api`
- `packages/engine-pi`
- `apps/cli`
- `apps/web-inspector`

### Schema changes
Add to `runs`:
- `parentRunId`
- `lineageRootRunId`
- `delegatedProfileId`
- `delegationDepth`
- `delegationReason`

Optional later:
- dedicated `run_lineage` table if lineage becomes richer than a tree

### Runtime behavior
1. Parent run requests delegation through a runtime tool.
2. Runtime validates:
   - profile allows delegation
   - max depth not exceeded
   - allowed child profile
   - budget available
3. Runtime creates child task/job/run or direct child run, depending on use case.
4. Child run gets:
   - its own run record
   - its own receipts
   - its own events
   - a bounded tool/profile scope
   - its own session policy (usually dedicated or ephemeral by default)
5. Parent receives only:
   - bounded summary
   - artifact references
   - optional structured output

### Important design choices
- no invisible subagents
- no unbounded recursion
- budgets enforced by runtime, not prompt text
- child results are artifacts, not mystical hidden context

### UI/CLI requirements
- show child-run tree on run pages
- `pop run children`
- `pop run lineage`
- ability to cancel a child run independently

### Acceptance criteria
- a delegated child run is fully inspectable
- the parent run’s receipt links to child receipts
- cancellation and failure of child runs are operator-visible

### Risks
- hidden complexity
- runaway recursion
- lineages that are hard to inspect

### Mitigation
- strict profile gating
- max depth and budget caps
- lineage-first UI

---

## 8.2 Add Telegram interrupt / queue / coalesce semantics

### Objective
Make Popeye’s conversational surface feel more like an always-on personal system rather than a stateless message bridge.

### Why now
Hermes’s gateway behavior is useful here, but Popeye should keep the scope narrow and local-first.

### Primary ownership
**Popeye only**

### Packages affected
- `packages/runtime-core`
- `packages/telegram`
- `packages/control-api`
- `apps/web-inspector`

### Concrete work
1. Add a message-thread or conversation-slot abstraction for Telegram sessions.
2. Define three ingress policies:
   - `interrupt`
   - `queue`
   - `coalesce`
3. Bind the policy to the assigned capability profile.
4. When a message arrives during an active run:
   - create a `message_ingress` record
   - apply policy
   - if `interrupt`, signal current run and create follow-up work
   - if `queue`, process after current run
   - if `coalesce`, merge pending messages into one next-turn artifact
5. Add explicit operator commands:
   - `/status`
   - `/stop`
   - `/continue`

### Important rule
Keep this limited to Popeye’s single-operator Telegram path. Do not generalize prematurely into a multi-platform gateway framework.

### Acceptance criteria
- active Telegram work can be interrupted or queued predictably
- pending messages are visible in runtime state and UI
- no message is silently lost or ambiguously merged

---

## 8.3 Add continuity-focused UI and CLI surfaces

### Objective
Expose the new continuity/autonomy model to the operator.

### Primary ownership
**Popeye only**

### Web inspector changes
Add:
- Sessions / History view
- Recall search view
- Related artifacts panel
- Playbooks view
- Profile/policy detail view
- Child-run lineage tree
- message-thread state where relevant

### CLI changes
Add:
- `pop recall ...`
- `pop session history`
- `pop playbook ...`
- `pop run children`
- `pop run lineage`
- `pop instructions diff`
- `pop daemon health`
- `pop migrate ...`

### Acceptance criteria
- an operator can inspect continuity and control surfaces without using the DB directly
- the CLI and web inspector speak the same product nouns

---

## 9. Phase 4 — optional bounded workflow-script execution

This is the nearest equivalent to Hermes’s `execute_code`, but it should be treated as optional and late.

## 9.1 Build a bounded local script runner only if needed

### Objective
Allow short-lived programmatic orchestration of runtime tools when it materially reduces model round-trips for repetitive workflows.

### Primary ownership
**Popeye only**  
Do not move this to pi-mono unless it becomes a clearly generic engine feature.

### Strong recommendation
Start with **Node/TypeScript only**, because Popeye is already a Node/TypeScript runtime. Do not add a generic multi-language execution matrix.

### Design
1. Create a dedicated worker process for scripts.
2. Expose only an allowlisted JSON-RPC tool surface.
3. Disable network and filesystem access except through approved runtime tools.
4. Record every script invocation and nested tool call in receipts.
5. Feature-flag it off by default.

### Do not claim
Do not claim strong sandboxing unless OS-level enforcement is actually implemented and tested.

### Possible later hardening
- OS-level restrictions
- per-profile enablement
- explicit approval for sensitive workspaces

### Acceptance criteria
- scripts cannot bypass runtime policy
- every nested action is auditable
- disabling the feature cleanly removes the surface

### Risks
- attack-surface expansion
- policy bypass through local execution
- false sense of sandbox security

### Mitigation
- late delivery
- feature flag
- no raw package installs
- no direct ambient network access

---

## 10. Cross-repo ownership map

| Workstream | Popeye | pi-mono | Notes |
|---|---|---|---|
| Structured logging / event normalization | Own completely | No | product observability |
| Migration/install/health tooling | Own completely | No | product operations |
| Pi compatibility CI | Own boundary tests | Maybe only if engine contract is missing | boundary enforcement starts in Popeye |
| Recall service | Own completely | No | product artifact recall |
| Session summaries | Own completely | No | product continuity |
| Recursive context layering | Own resolution | Maybe only generic context-file primitive later | keep precedence in Popeye |
| Playbooks | Own completely | No | product procedure layer |
| Capability profiles | Own completely | Maybe only final tool restriction passthrough | policy belongs in Popeye |
| Connector contracts | Own completely | No | sensitive-data policy layer |
| Child-run delegation | Own lineage/policy/budget | Maybe child-session helpers | parent/child semantics remain Popeye-owned |
| Telegram interrupt semantics | Own completely | No | channel-specific product behavior |
| Workflow script runner | Own completely | No, unless generic enough later | do not offload security semantics |

---

## 11. Schema, API, and CLI change summary

## 11.1 Suggested DB additions

### App DB
- `artifact_index`
- `artifact_links`
- `session_summaries`
- `playbooks`
- `playbook_revisions`
- `playbook_bindings`
- `playbook_usage`
- `playbook_proposals`

### Existing table extensions
- `runs.parentRunId`
- `runs.lineageRootRunId`
- `runs.delegatedProfileId`
- `runs.delegationDepth`
- `runs.delegationReason`
- `agent_profiles.policyJson` or equivalent structured policy fields

## 11.2 Suggested API additions

### Recall
- `GET /v1/recall/search`
- `GET /v1/recall/artifacts/:type/:id`
- `GET /v1/runs/:id/related`
- `GET /v1/session-roots/:id/history`

### Playbooks
- `GET /v1/playbooks`
- `GET /v1/playbooks/:id`
- `GET /v1/playbooks/:id/revisions`
- `POST /v1/playbooks`
- `POST /v1/playbooks/:id/propose`
- `POST /v1/playbooks/:id/activate`
- `POST /v1/playbooks/:id/retire`

### Profiles
- `GET /v1/profiles`
- `GET /v1/profiles/:id`
- `PATCH /v1/profiles/:id/policy`

### Delegation / lineage
- `GET /v1/runs/:id/children`
- `GET /v1/runs/:id/lineage`

### Ops
- `GET /v1/health`
- migration/status endpoints only if needed by web inspector

## 11.3 Suggested CLI additions

- `pop daemon health`
- `pop migrate status`
- `pop migrate plan`
- `pop migrate apply`
- `pop recall search`
- `pop recall open`
- `pop session history`
- `pop instructions diff`
- `pop playbook list`
- `pop playbook show`
- `pop playbook diff`
- `pop playbook approve`
- `pop playbook activate`
- `pop run children`
- `pop run lineage`

---

## 12. Testing, rollout, and release gating

## 12.1 Feature flags

Ship the bigger features behind explicit flags first:

- `enableRecall`
- `enableSessionSummaries`
- `enablePlaybooks`
- `enableDelegation`
- `enableTelegramInterrupts`
- `enableWorkflowScripts`

## 12.2 Required test layers

### Unit tests
- recall ranking logic
- playbook resolution
- profile enforcement
- delegation policy validation
- message coalescing rules

### Integration tests
- end-to-end recall against seeded receipts/messages
- playbook selection and snapshotting
- profile restriction on runtime tools
- child-run lineage and cancellation
- Telegram interrupt/queue/coalesce flows
- migration from pre-feature DB snapshots

### Smoke tests
- clean install → daemon start → run → receipt
- Pi compatibility smoke
- backup → migrate → restore
- recall over old artifacts
- playbook activation/deactivation

## 12.3 Rollout gates

### Gate A — before sensitive connectors
Must have:
- structured logs
- recall
- capability profiles
- content-scanning policy reused across ingestion paths
- playbook snapshotting and receipts

### Gate B — before delegation
Must have:
- lineage schema
- profile enforcement
- UI/CLI lineage inspection
- budget caps

### Gate C — before workflow scripts
Must have:
- strong audit trail
- policy-restricted tool surface
- explicit feature flag
- honest security posture

---

## 13. Starter backlog (implementation-ready epics)

This is the practical issue list I would open first.

## Epic 0 — Observability hardening
1. Add `ExecutionContextSchema` to `@popeye/contracts`
2. Implement structured logger in `@popeye/observability`
3. Add event normalization envelope
4. Plumb correlation IDs through daemon → control API → runtime-core → engine-pi
5. Update receipt and security audit linkage

## Epic 1 — Runtime operations hardening
1. Add `pop daemon health`
2. Add migration CLI (`status`, `plan`, `apply`)
3. Add upgrade backup hook
4. Add clean install/bootstrap flow
5. Add release smoke tests

## Epic 2 — Pi compatibility safety net
1. Define minimal engine contract assertions
2. Build compatibility smoke runner
3. Wire CI gate
4. Document upgrade procedure

## Epic 3 — Recall foundation
1. Add `artifact_index` and FTS migration
2. Implement `RecallService`
3. Add recall API endpoints
4. Add `pop recall search`
5. Add web inspector recall search page

## Epic 4 — Session summaries and related artifacts
1. Add `session_summaries` table
2. Generate/update summaries after run finalization
3. Add related-artifact graph builder
4. Add run detail related-artifacts panel
5. Add session history page

## Epic 5 — Recursive context layering
1. Add new instruction source type for recursive context files
2. Add path walk and snapshot hashing
3. Add `pop instructions diff`
4. Extend instruction preview API to show resolved order and hashes
5. Extend protected file policy to Popeye-owned context dirs

## Epic 6 — Playbooks
1. Create `packages/playbooks`
2. Add playbook schema + migrations
3. Implement file + DB hybrid storage
4. Integrate playbooks into instruction resolution
5. Add playbook API/CLI/UI
6. Add proposal/approval flow
7. Add playbook usage to receipts
8. Add optional procedural-memory indexing for approved playbooks

## Epic 7 — Capability profiles
1. Extend `agent_profiles` policy schema
2. Implement runtime enforcement
3. Add profile inspector surfaces
4. Seed default profiles
5. Bind playbooks and interrupt policy to profiles

## Epic 8 — Content-ingress safety scanning
1. Extract shared scan/evaluate module
2. Apply it to message ingress and doc indexing
3. Apply it to playbook proposals
4. Standardize scan outcomes and audit writes
5. Add regression tests and operator override flow

## Epic 9 — Connector contract scaffolding
1. Define connector capability contract
2. Add profile binding points
3. Define receipt/redaction conventions
4. Add docs for future mail/calendar/repo/files packages

## Epic 10 — Delegation
1. Add run lineage columns
2. Add runtime delegation policy checks
3. Implement child-run creation and cancellation
4. Add lineage API/CLI/UI
5. Add receipts and related-artifact linkage for child runs

## Epic 11 — Telegram continuity semantics
1. Add thread/slot abstraction
2. Implement interrupt/queue/coalesce policies
3. Add Telegram operator commands
4. Add inspector state view
5. Add end-to-end delivery/intrusion regression tests

## Epic 12 — Optional workflow scripts
1. Define JSON-RPC tool surface
2. Implement worker process
3. Add strict allowlist and feature flag
4. Add receipt nesting/audit
5. Add explicit operator docs and warnings

---

## 14. What to postpone on purpose

These are tempting, but they should not be in the first implementation wave:

- multi-platform messaging gateway expansion
- MCP-first tool import
- third-party package/skill install
- multi-user sharing and access control
- remote execution backends
- generalized plugin marketplace
- full transcript indexing as the default recall strategy
- unconstrained agent-authored procedures
- generic “self-modifying system prompt” behavior

---

## 15. Recommended execution order

If I were sequencing the work for actual implementation, I would do it in this exact order:

1. **Observability hardening**
2. **Migration/install/health**
3. **Pi compatibility safety net**
4. **Hybrid memory test closure**
5. **Recall foundation**
6. **Session summaries / related artifacts**
7. **Recursive context layering + instruction diff**
8. **Playbooks**
9. **Capability profiles**
10. **Content-ingress safety scanning**
11. **Connector contract scaffolding**
12. **Sessions/history UI and CLI polish**
13. **Delegation**
14. **Telegram interrupt/coalesce semantics**
15. **Optional workflow scripts**

That order is deliberate:

- it fixes the runtime before enlarging it
- it delivers the highest-leverage Hermes lessons early
- it delays the riskiest surfaces until Popeye has better policy and audit primitives
- it keeps Pi/pi-mono in the right role throughout

---

## 16. Final implementation recommendation

The best concrete translation of Hermes into Popeye is:

- **Phase 1:** make Popeye excellent at recall and continuity
- **Phase 2:** make reusable procedure operator-owned and versioned
- **Phase 3:** add explicit policy bundles and auditable child-run autonomy
- **Phase 4:** only then consider bounded programmatic execution

Everything else should be judged by one rule:

> Does this make Popeye a more durable, local-first, operator-controlled personal platform?

If yes, implement it in Popeye.  
If it is merely clever, broad, or agent-framework-shaped, leave it out.

---

## Appendix A — Source basis used for this plan

Primary Popeye sources used:
- `architecture.md`
- `docs/phase-audit-2026-03-14.md`
- `packages/runtime-core/src/runtime-service.ts`
- `packages/control-api/README.md`
- `packages/engine-pi/README.md`
- `packages/memory/README.md`
- `apps/daemon/src/index.ts`
- `apps/cli/src/index.ts`

Primary Hermes sources used:
- `README.md`
- `docs/architecture.md`
- `run_agent.py`
- `model_tools.py`
- `toolsets.py`
- `hermes_state.py`
- docs covering memory, skills, gateway/messaging, context files, and execute_code

Primary pi-mono sources used:
- `packages/coding-agent/docs/sdk.md`
- `packages/coding-agent/docs/packages.md`
- examples showing session handling, skills, and extension patterns

This plan intentionally treats Hermes as a **pattern reference**, not an import target.
