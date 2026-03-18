
# Ultimate Implementation Plan

## 1. Executive summary

This document is the final, deduped master plan for Popeye after synthesizing the uploaded Hermes-, OpenSquirrel-, NemoClaw-, and roadmap-derived planning documents and checking the current Popeye repository shape and implementation reality.

It is **not** a merge of every recommendation. It is a filtered plan built with one rule: **keep Popeye’s existing runtime-centered architecture, import only the patterns that materially improve local-first personal-agent capability, and reject anything that weakens operator control, privacy, or maintainability**.

### How this was synthesized

The synthesis process used five filters on every recommendation:

1. **Repo fit** — does it fit Popeye as it exists, not a hypothetical rewrite?
2. **Boundary cleanliness** — does it preserve the Popeye ↔ Pi split?
3. **Security and privacy posture** — does it improve control over sensitive data, or expand the trust boundary?
4. **Delivery order realism** — can it be implemented in a sane dependency order?
5. **Long-term ownership** — will this make Popeye easier or harder to operate and maintain in two years?

Anything that failed those tests was either dropped, deferred, or rewritten into a narrower recommendation.

### Biggest conclusions

Popeye already has the right **product skeleton**. It does **not** need a rewrite. Its daemon, task/job/run model, receipts, interventions, memory subsystem, control API, and strict Pi boundary are strong enough to support the intended end-state.

The biggest gap is not “more runtime.” The biggest gap is the layer above it:

- a real **policy and approval substrate**
- a real **continuity model** beyond memory search
- real **assistant-domain capability packages**
- real **operator control surfaces**
- a more explicit **execution profile** model
- cleaner **security boundaries** for files, network, secrets, and sensitive data release

The best ideas from the source documents converge into one final direction:

1. **Harden the substrate before enlarging the product surface.**
2. **Unify profile, policy, and execution-envelope ideas into one model.**
3. **Separate memory, recall, and reusable procedure as different product surfaces.**
4. **Build capability modules in Popeye, not in Pi and not as a plugin marketplace.**
5. **Use read-only-first vertical slices to grow into a personal assistant safely.**
6. **Add delegation only after profiles, projections, approvals, and lineage exist.**

### Biggest strategic priorities

The highest-priority work for Popeye is:

- lock down the Pi execution surface for always-on Popeye operation
- replace brittle privileged-tool plumbing with a first-class host-tool bridge
- turn `agent_profiles` into real execution profiles with runtime enforcement
- add approvals, context-release, and explicit filesystem / egress policy
- add run projection and artifact recall
- ship the first safe personal-assistant vertical: **read-only email sync + digest + triage**

### Biggest things intentionally excluded

This plan explicitly rejects or deprioritizes the following:

- a plugin marketplace or MCP-first attachment model
- dynamic third-party package install/update in always-on mode
- broad multi-platform gateway sprawl
- a pane-based multi-agent console as the main product shell
- UI-owned process orchestration
- generic remote execution as an early architectural priority
- autonomous outbound writes in email/calendar/GitHub early on
- pretending Popeye has stronger sandboxing than it really does
- broad recursive context-file sprawl as the core instruction model
- cloud-first, multi-tenant, or donor-compatibility architecture

The result is deliberately narrower and more opinionated than some of the source documents. That is a feature, not a bug.

---

## 2. Current-state reality check

## 2.1 What Popeye actually is today

**Confirmed in code:** Popeye is already a daemon-first, local runtime with clear product boundaries. It is not just a wrapper around Pi and it is not just a chat interface.

The current repo already contains:

- apps for `cli`, `daemon`, `macos`, and `web-inspector`
- packages for `runtime-core`, `control-api`, `engine-pi`, `memory`, `instructions`, `scheduler`, `sessions`, `receipts`, `observability`, `telegram`, `workspace`, `contracts`, `api-client`, and `testkit`
- a documented architecture where **Pi is the engine substrate** and **Popeye is the product runtime**

The architectural center is already correct:

- **Pi / pi-mono**: model/provider abstraction, agent loop, session machinery, compaction, generic tool/runtime substrate
- **Popeye**: daemon lifecycle, scheduling, task/job/run orchestration, instruction resolution, memory policy, receipts, interventions, security, control API, operator-facing semantics
- **interfaces**: CLI, web inspector, macOS app, Telegram bridge

That is the right long-term split for a local-first personal agent.

## 2.2 What is already implemented

### Confirmed in code and usable

Popeye already has the following major systems:

#### Runtime and orchestration
- `Task -> Job -> Run` lifecycle
- scheduler and startup reconciliation
- workspace registry
- session-root selection
- receipt generation
- interventions and retry/failure handling
- local daemon lifecycle

#### Durable operational state
- SQLite operational schema with tables for workspaces, projects, agent profiles, tasks, jobs, leases, runs, run events, run outputs, receipts, instruction snapshots, interventions, security audit, messages, and ingress state

#### Memory
- local memory DB
- FTS5 + sqlite-vec hybrid retrieval
- memory typing (`episodic`, `semantic`, `procedural`)
- confidence decay / consolidation concepts
- doc indexing and memory search services

#### Control plane
- local Fastify control API
- bearer auth
- browser-session bootstrap
- CSRF enforcement for mutating browser actions
- SSE event stream
- security-audit endpoints
- memory endpoints
- run/task endpoints

#### Message ingress
- Telegram bridge
- idempotent ingress records
- allowlist and rate limits
- prompt-scan / quarantine path
- linkage from ingress to tasks/jobs/runs
- reply delivery state

#### Boundary discipline
- `engine-pi` is the only package allowed to know Pi internals
- boundary scripts forbid leaking Pi-specific paths or RPC details into the rest of Popeye

This is a real foundation, not a speculative one.

## 2.3 What is partially implemented, thin, or underpowered

The current repo has several important concepts that exist, but are not yet fully developed enough for the target end-state.

### `agent_profiles` exist but are still thin
The table and API surface exist, but today profiles are closer to labels/records than a real execution-policy system. They need to become first-class runtime policy objects.

### The engine seam is strong overall, but one critical part is still provisional
The current runtime-owned tool path still depends on a temporary Pi extension and an `extension_ui_request` carrier path. That is a workable bridge, but it is not a good long-term foundation for privileged runtime tools, approvals, or capability modules.

### The runtime service is doing too much
`runtime-service.ts` is already large and central. The repo works, but future capability growth will turn it into a bottleneck unless more responsibility is extracted into focused services.

### Memory is ahead of recall
Popeye has a strong memory subsystem, but it still lacks a first-class **artifact recall** surface over receipts, runs, messages, interventions, and session history.

### Operator continuity is weaker than runtime continuity
The runtime already preserves important state, but the operator-facing control plane is still thinner than it should be for an always-on personal system. There is no mature run-projection layer, no first-class history/continuity UX, and no true workbench-restore model.

### Workspace boundaries are routing boundaries, not hard sandbox boundaries
The repo documentation is explicit: workspace boundaries do not currently imply a hard sandbox. That matters. Any plan that assumes “the workspace is already a security boundary” is wrong.

### Known operational gaps already acknowledged by the repo
The repo’s own audit trail also points to several real gaps that matter before expansion:

- no finished structured application logger with stable correlation IDs
- no polished install/bootstrap flow outside the repo checkout model
- migration helper tooling is still thin
- hybrid memory search lacks a stronger full-path integration test story
- Pi compatibility smoke is still too manual
- the web inspector still needs stronger session/history surfaces
- CWD-based workspace routing is not yet there
- `sqlite-vec` is still pinned to an alpha release

These are not reasons to stop. They are reasons to sequence infrastructure cleanup ahead of aggressive feature growth.

## 2.4 What is still missing for the intended product

Popeye does **not** yet have first-class capability modules for the actual assistant domains you want. In particular, the current repo does not yet contain product modules for:

- email sync / triage / summarize
- calendar sync / summarize / propose actions
- canonical local todo model and reconciliation
- GitHub / issue / PR awareness
- explicit permitted file/folder access as a mature capability package
- contacts/people model
- finance and medical vaults
- explicit secret-store / context-release substrate
- real execution profiles and approval policy
- playbooks as versioned reusable procedures
- explicit child-run delegation

Those are the main missing pieces.

## 2.5 Role of pi-mono in the current and future system

This boundary must remain clean.

### What belongs in Pi / pi-mono
Pi is the generic engine substrate. It should continue to own:

- model/provider abstraction
- generic agent loop behavior
- session machinery and compaction
- RPC / subprocess embedding
- generic tool execution substrate
- generic session metadata / cancellation / host-tool hooks where needed

### What belongs in Popeye
Popeye should continue to own:

- tasks, jobs, runs, receipts, interventions
- scheduler and daemon lifecycle
- session-root policy
- memory policy and durable memory storage
- recall policy
- instruction resolution
- capability registry
- sync orchestration
- approvals and context-release rules
- security audit and operator-visible policy
- connector semantics for email/calendar/todos/GitHub/files
- backup / restore
- control API and operator UI

### The final boundary rule
If a feature is about **generic engine mechanics**, it may belong in Pi.

If it is about **Popeye’s product semantics, permissions, approvals, memory, connectors, or operator control**, it belongs in Popeye.

That means:
- a better host-tool bridge may require Pi work
- child-session helpers may require Pi work
- capability modules, approvals, recall, playbooks, and connector policy absolutely do not belong in Pi

---

## 3. Source-doc synthesis summary

## 3.1 Which source docs were most useful

### Most useful overall

#### `hermes_popeye.md`
This was the strongest source for **knowledge-surface separation** and continuity architecture. Its best contributions were:

- separate **recall** from **durable memory**
- separate **procedure/playbooks** from both
- treat delegation as explicit runtime lineage, not hidden subagents
- treat content-ingress scanning as a product-level security concern
- keep Pi generic and Popeye product-semantic

This document contributed some of the most durable architectural ideas in the final plan.

#### `opensquirrel_popeye.md`
This was the strongest source for **operator control-plane thinking** and for clarifying what Popeye lacks at the execution seam. Its best contributions were:

- explicit engine capability reporting
- run projection / transcript projection
- real execution profiles
- operator workbench restore
- setup/status/command-palette surfaces
- delegation only after profiles/projections/seam cleanup

This document was especially valuable because it improved Popeye without trying to turn it into OpenSquirrel.

#### `popeye_nemoclaw_implementation_plan.md`
This was the strongest source for **trust-boundary hardening**. Its best contributions were:

- a Popeye-safe restricted Pi mode
- first-class runtime-tool bridge
- capability packs / egress groups / filesystem scopes
- durable approvals and policy overlays
- honesty about tool-path enforcement versus real sandboxing

This document was the clearest reminder that the hardest mistakes would be security and containment mistakes, not feature mistakes.

#### `popeye_roadmap.md`
This was the strongest source for **assistant-domain sequencing** and sensitive-domain posture. Its best contributions were:

- runtime is already good enough; no rewrite
- domain modules should live in Popeye packages
- first useful vertical should be read-only email
- calendar and local todos should come before GitHub writes or exotic automation
- finance/medical need a stricter vault architecture later
- plugin/cloud/whole-machine indexing/autonomous writes should be explicitly deferred

This document kept the final plan tied to product value instead of architecture for architecture’s sake.

#### `hermes_popeye_implementation_plan.md`
This was useful as a **tactical sequencing companion** to `hermes_popeye.md`. It did not add many new top-level architectural ideas, but it was helpful for turning the Hermes-derived continuity themes into a concrete order of work: hardening first, then recall, then reusable procedure, then policy, then delegation.

#### `squirrel_implementation_plan.md`
This was useful as a **practical implementation companion** to `opensquirrel_popeye.md`. Its strongest contribution was implementation ordering: capability seam first, then run projection, then real profiles, then workbench restore, and only later delegation. Most of its core ideas were absorbed into stronger recommendations already present in the longer OpenSquirrel analysis.

## 3.2 Major overlaps across docs

Across the uploaded documents, the strongest recurring themes were:

1. **Profiles must become real policy objects.**
2. **Popeye needs better continuity than memory search alone provides.**
3. **The Pi seam needs more explicit capability and host-tool handling.**
4. **Delegation should be explicit, bounded, and auditable.**
5. **Operator control surfaces need to improve, but not by making the UI authoritative.**
6. **Capability modules belong in Popeye, not in Pi and not as a plugin ecosystem.**
7. **Security and policy must be explicit for files, network, and sensitive data.**
8. **Read-only-first sequencing is the safest path into personal data domains.**

That overlap is why those themes dominate the final plan.

## 3.3 Major contradictions across docs

The source docs were not equally right, and they were not always compatible.

### Contradiction 1: continuity-first vs security-first ordering
Some Hermes-derived recommendations pushed recall/playbooks very early. The NemoClaw-derived plan correctly argued that unrestricted Pi/runtime surface area must be reduced first. The final plan resolves this by putting **execution-surface hardening before continuity expansion**.

### Contradiction 2: multiple profile concepts
Different docs proposed:
- capability profiles
- execution profiles
- runtime profile manifests
- capability packs
- execution envelopes

Keeping all of those separately would create architecture clutter. The final plan normalizes them into **one profile model** plus **one derived per-run envelope**.

### Contradiction 3: UI ambition versus runtime sequencing
The OpenSquirrel-derived workbench ideas are valuable, but some variants pushed UI polish too early. The final plan keeps the best UX ideas, but **after** profiles, approvals, and run projection exist.

### Contradiction 4: “strict policy” language versus actual enforcement ability
The NemoClaw-inspired hardening docs use language that can sound stronger than Popeye’s current local enforcement ability actually is. The final plan keeps the posture, but is explicit that early enforcement can realistically cover **Popeye-owned tool and connector paths**, not arbitrary shell commands or arbitrary third-party binaries.

### Contradiction 5: context layering breadth
Some Hermes-inspired suggestions leaned toward broader recursive context-file discovery. That conflicts with Popeye’s stronger existing instruction model. The final plan treats broad recursive context expansion as **optional compatibility**, not a core roadmap item.

## 3.4 Recurring recommendations that were valid

These recommendations appeared repeatedly and survived synthesis:

- do not rewrite Popeye
- keep Pi generic and Popeye product-semantic
- harden the runtime-tool / engine seam
- turn profiles into real runtime policy
- add artifact recall separate from memory
- add reusable procedure as local, versioned, operator-controlled playbooks
- add generalized content-ingress scanning
- add explicit approvals and operator-visible policy
- ship read-only domain slices first
- treat finance/medical as later, stricter domains
- keep delegation explicit and later

## 3.5 Recurring recommendations that were weak, redundant, or poor-fit

These suggestions appeared in some form, but should not drive the final plan:

- pane-based multi-agent UI as the primary shell
- broad gateway/platform expansion
- plugin / hub / marketplace style extensibility
- raw MCP-first architecture
- early remote execution
- broad AGENTS-like recursive context discovery as core behavior
- replacing Popeye’s richer memory model with a simpler two-file memory model
- session-only approvals
- broad workflow-script / code-exec surfaces before policy and audit are mature

---

## 4. Deduped strategic decisions

This section is the normalized set of final decisions after filtering and synthesis.

## 4.1 What to build

### Decision 1 — Keep Popeye’s runtime as the permanent product core
Do not rewrite Popeye around the agent loop, the UI, or donor architecture. The daemon + task/job/run + receipts/interventions model is the right center of gravity.

### Decision 2 — Introduce one unified profile model
Do **not** create separate systems for “agent profiles,” “capability profiles,” “runtime profiles,” and “execution profiles.”

Use a single first-class profile model, ideally by evolving the existing `agent_profiles` records into the product’s real **execution profile** concept.

Each run should then derive a concrete **execution envelope** from:
- execution profile
- workspace/project context
- task intent
- trigger
- allowed capability packs
- filesystem policy class
- egress policy
- session policy
- approval thresholds

### Decision 3 — Separate memory, recall, and playbooks
Popeye should explicitly maintain three different knowledge surfaces:

#### Memory
Curated, durable facts/preferences/derived knowledge.

#### Recall
Searchable operational history and artifacts:
- receipts
- run outputs
- selected run-event summaries
- messages / ingress
- interventions
- connector-derived history artifacts

#### Playbooks
Versioned, operator-controlled reusable procedures.

Do not blur these together.

### Decision 4 — Capability modules live in Popeye packages
Assistant-domain integrations belong in runtime-owned capability packages with thin provider adapters behind them.

The canonical direction is:

- `packages/cap-files`
- `packages/cap-email`
- `packages/cap-calendar`
- `packages/cap-todos`
- `packages/cap-github`
- optionally `packages/cap-people`

Later:
- `packages/vault-finance`
- `packages/vault-medical`

They do **not** belong:
- in the UI
- in `engine-pi`
- as direct provider calls from Pi
- in a generic plugin marketplace

### Decision 5 — Read-only-first is the default product posture
The first useful verticals should emphasize local sync, summarization, triage, and operator-reviewed proposals before any autonomous external write behavior.

### Decision 6 — Harden the Pi surface before capability growth
Always-on Popeye mode should not inherit Pi’s broad project/package/extension openness. A Popeye-safe restricted mode is required before claiming strong operator control.

### Decision 7 — Replace the temporary privileged-tool bridge
The current temporary extension/UI carrier path is not acceptable as the permanent substrate for privileged runtime tools. A first-class host-tool bridge is required.

### Decision 8 — Approvals, context release, and policy overlays are first-class product systems
Popeye must gain durable approval records, policy overlays, and context-release rules before it gains broad domain capabilities.

### Decision 9 — Delegation is explicit child lineage, not hidden subagents
When delegation is added, it should be expressed using Popeye’s own nouns:
- child tasks / jobs / runs
- bounded lineage
- structured handoff summaries
- explicit policy inheritance
- inspectable receipts

### Decision 10 — Sensitive domains use stricter stores and stricter release rules
Finance and medical data should not be treated as “just more memories.” They need separate vaults, no automatic raw embeddings, and explicit context-release approval.

## 4.2 What not to build

The following should **not** be built as part of Popeye’s core roadmap:

- plugin marketplace
- dynamic third-party package install/update
- generic MCP-first capability architecture
- multi-tenant or cloud-first architecture
- UI-owned runtime spawning
- pane-based swarm console as product shell
- broad multi-channel gateway abstraction
- broad remote execution by default
- autonomous outbound writes in early slices
- whole-machine indexing
- “self-modifying prompt system” behavior
- unrestricted shell/code-execution in unattended default mode

## 4.3 What to postpone

These ideas are valid in some form, but premature:

- explicit execution-target registry
- bounded workflow-script runner
- child-run delegation
- recursive context compatibility beyond clear need
- browser/system automation beyond narrow admin flows
- finance/medical vaults
- GitHub write actions
- broader mobile/native polish beyond stable web/API surfaces

## 4.4 What belongs in Popeye

Popeye owns:

- runtime orchestration
- profiles, envelopes, approvals, context-release
- memory, recall, playbooks
- capability modules and sync stores
- receipts, audit, interventions
- workspace/file policies
- operator UI and CLI
- local-first sensitive-data semantics

## 4.5 What belongs in pi-mono

Pi may own or help with:

- restricted Popeye runtime mode
- host-tool RPC
- capability reporting
- child-session primitives
- inherited cancellation hooks
- generic run metadata passthrough
- generic tool restriction hooks

Pi should **not** own:

- capability modules
- approvals
- playbooks
- memory/recall policy
- email/calendar/GitHub logic
- secret store or vault semantics
- operator-facing policy systems

---

## 5. Target architecture

## 5.1 Target system shape

The target system should look like this:

```text
Clients (CLI / Web Inspector / macOS)
        |
        v
Control API
        |
        v
Popeye Runtime
  - scheduler
  - task/job/run coordinator
  - profile resolver
  - execution-envelope resolver
  - approval service
  - context-release service
  - recall service
  - run projection service
  - session summary service
  - capability registry
  - sync orchestrator
  - memory / receipts / audit / interventions
  - playbook resolver
        |
        +----------------------+
        |                      |
        v                      v
Capability Packages        Engine Adapter (engine-pi)
  - cap-files               - capability reporting
  - cap-email               - host-tool transport
  - cap-calendar            - restricted Popeye mode negotiation
  - cap-todos               - session / cancel bridge
  - cap-github              - execution metadata passthrough
  - cap-people
        |                      |
        v                      v
Local capability stores     Pi / pi-mono
and provider adapters         - provider/model abstraction
                              - agent loop
                              - tool execution substrate
                              - session tree / compaction
                              - RPC / subprocess runtime
```

## 5.2 Core subsystems

### A. Orchestration core
The existing task/job/run model remains the core product execution model.

### B. Profile and policy layer
A first-class execution-profile model that defines what a run is allowed to do and how it should execute.

### C. Continuity layer
A combination of:
- run projection
- artifact recall
- session summaries
- workbench anchors
- playbook usage visibility

### D. Capability platform
A registry and sync orchestration layer for domain packages:
- files
- email
- calendar
- todos
- GitHub
- people

### E. Sensitive-data control layer
A combination of:
- secret store
- approvals
- context-release service
- vault manager
- redaction policy
- capability-specific release rules

### F. Operator surfaces
Web inspector and CLI as the first-class operator control plane over all of the above.

## 5.3 Boundaries and interfaces

### Popeye ↔ Pi
Popeye tells Pi:
- which session to use
- what instructions bundle applies
- what runtime tools are exposed
- what profile/envelope is active
- what metadata to attach
- what cancellation/timeout rules apply

Pi tells Popeye:
- streamed engine events
- usage and final output
- host-tool requests/results
- health/capability state
- cancellation/failure mode

### Popeye ↔ Capability packages
Capability packages should expose a narrow contract:

- capability metadata
- local store initialization/migrations
- sync functions
- query functions
- runtime tool adapters
- recall artifact emitters
- memory-promotion rules
- redaction policy
- context-release policy

### Control API ↔ Clients
Clients should consume derived runtime truth:
- run projections
- recall hits
- profile/policy summaries
- approval queues
- environment health
- capability sync state

Clients should **not** be reconstructing product semantics from raw database rows or raw engine event streams.

## 5.4 Security and privacy model

### Default posture
- local-first
- loopback control API only
- operator-authenticated
- read-only-first capability rollout
- redaction before logs/receipts/memory writes
- restricted always-on Pi mode
- no auto-loading of arbitrary project/global extensions in Popeye-safe mode

### Filesystem policy
Each run should resolve:
- read roots
- write roots
- protected paths
- scratch root

Protected files should include:
- Popeye control docs / identity docs
- curated memory targets
- other explicitly protected operator-owned files

### Network policy
Early egress policy should be enforced honestly:
- first for Popeye-owned connector/tool paths
- audit-first, then approval-gated, then enforced
- capability packs and egress groups should be explicit
- generic shell traffic is **not** magically covered in the first implementation

### Context release
Not all data visible to a capability package should be automatically releasable to the model.

Introduce explicit release classes such as:
- metadata only
- summary only
- redacted content
- selected raw excerpts
- full raw content

Restricted domains should default to the narrowest release mode that still works.

### Sensitive vaults
Finance and medical later get:
- separate encrypted stores
- explicit release approvals
- no automatic raw embeddings
- stricter retention and backup rules

## 5.5 Persistence and memory model

Popeye should explicitly maintain several local persistence layers:

### App DB
Operational truth:
- tasks, jobs, runs
- receipts, interventions, audit
- profiles, approvals, policy overlays
- workbench anchors / saved views
- artifact index / session summaries
- delegation lineage later

### Memory DB
Durable cross-run memory:
- episodic / semantic / procedural records
- embeddings where allowed
- provenance and confidence metadata

### Capability stores
Local normalized sync stores for domain packages, likely under `stores/`:
- `email.db`
- `calendar.db`
- `github.db`
- `todos.db` or app-db-backed if simpler
- optional `people.db`

### Vault stores
Restricted encrypted stores under `vaults/` later:
- `finance.db`
- `medical.db`

### Knowledge-surface rule
- capability stores are not memory
- memory is not recall
- recall is not just raw transcripts
- session summaries are recall artifacts, not durable personal facts
- playbooks are reusable procedures, not transient plans

## 5.6 Tool and integration model

The integration model should be:

1. capability package exposes a narrow internal interface
2. runtime exposes selected package functions as runtime tools
3. execution profile determines whether those tools are available
4. every use is receipted and auditable
5. connector data promotion into memory or recall follows explicit policy

This is much cleaner than:
- direct provider calls from Pi
- third-party plugin loading
- generic marketplace-style tool import

## 5.7 Orchestration and runtime model

Popeye should keep and extend the current model:

- triggers create tasks
- tasks become jobs
- jobs become runs
- runs bind to session roots
- runs produce receipts and memory/recall side effects
- capability sync jobs are scheduled like other product work
- later delegation creates child tasks/jobs/runs under explicit lineage

The one-active-run-per-workspace default should remain the baseline until delegation and concurrency policy are designed explicitly.

## 5.8 Operator control surfaces

The target operator surface should provide:

- run projections
- history/recall search
- profile and policy visibility
- approval queue
- environment status / doctor
- capability sync status
- playbook inspection
- saved views / workbench anchors
- later run-lineage tree

The UI should become stronger, but the runtime must remain the source of truth.

---

## 6. Final prioritized workstreams

## Workstream 1 — Engine boundary and runtime hardening

**Objective**  
Make the Popeye ↔ Pi seam explicit, restricted, and safe enough to support future capability growth.

**Why it matters**  
Every later feature depends on this seam. If the seam stays provisional or too open, approvals, profiles, and connector policy will be built on sand.

**Main components involved**
- `packages/engine-pi`
- Pi fork / pi-mono support
- `packages/contracts`
- boundary scripts and CI
- `packages/observability`
- `apps/cli`

**Dependencies**  
None. This is the first workstream.

**Risk level**  
Medium.

**Expected payoff**  
Very high. It removes the biggest substrate ambiguity and reduces trust-surface risk before new capability work begins.

## Workstream 2 — Profiles, approvals, and context-release substrate

**Objective**  
Introduce a real execution-policy layer for runs.

**Why it matters**  
Without this, Popeye cannot safely grow into email/calendar/files/GitHub, because nothing formal defines what a run may see, change, or release to the model.

**Main components involved**
- `packages/contracts`
- `packages/runtime-core`
- `packages/control-api`
- `packages/workspace`
- `packages/receipts`

**Dependencies**  
Workstream 1.

**Risk level**  
Medium to high.

**Expected payoff**  
Very high. This is the core safety and control substrate for the rest of the roadmap.

## Workstream 3 — Continuity and operator control

**Objective**  
Add run projections, recall, session summaries, and operator continuity surfaces.

**Why it matters**  
This is what makes Popeye feel like an always-on personal system instead of a collection of runs and logs.

**Main components involved**
- `packages/runtime-core`
- `packages/control-api`
- `apps/web-inspector`
- `apps/cli`
- memory / receipt / instruction systems

**Dependencies**  
Workstream 1 for seam clarity, Workstream 2 for policy and scoping.

**Risk level**  
Medium.

**Expected payoff**  
High. It reduces re-explaining, makes the system inspectable, and lays groundwork for playbooks and delegation.

## Workstream 4 — Capability platform and local sync stores

**Objective**  
Create the reusable product pattern for assistant-domain modules.

**Why it matters**  
Without a capability platform, every connector would become a one-off integration, and the repo would drift into ad hoc sprawl.

**Main components involved**
- new capability packages
- runtime capability registry
- sync orchestrator
- local stores
- redaction and memory/recall promotion rules

**Dependencies**  
Workstreams 1 and 2. Workstream 3 is helpful but not strictly blocking for the first read-only slice.

**Risk level**  
Medium.

**Expected payoff**  
Very high. This is what turns Popeye from a control-plane runtime into an actual personal-assistant platform.

## Workstream 5 — First personal-assistant vertical slices

**Objective**  
Ship real user value with the safest and most useful domain sequencing.

**Why it matters**  
The plan succeeds only if it produces useful operator-visible capability, not just a cleaner substrate.

**Main components involved**
- `cap-email`
- `cap-calendar`
- `cap-todos`
- `cap-github`
- `cap-people`
- related CLI/UI surfaces

**Dependencies**  
Workstreams 2 and 4.

**Risk level**  
Medium.

**Expected payoff**  
Very high. This is the first point where Popeye becomes recognizably your local personal agent rather than just its foundation.

## Workstream 6 — Playbooks and reusable procedure

**Objective**  
Make repeated workflows durable, inspectable, and operator-controlled.

**Why it matters**  
The system becomes dramatically more useful once repeated routines stop living only in transcripts or giant prompt files.

**Main components involved**
- `packages/playbooks`
- instructions resolver
- memory / receipts
- profile bindings
- control API / CLI / web inspector

**Dependencies**  
Workstreams 2 and 3, plus at least one real capability slice to bind procedures to.

**Risk level**  
Medium.

**Expected payoff**  
High, but only after capability slices exist.

## Workstream 7 — Controlled delegation and advanced automation

**Objective**  
Support bounded decomposition through explicit child runs.

**Why it matters**  
Complex work will eventually need controlled decomposition, but only if it remains auditable and policy-bound.

**Main components involved**
- `runtime-core/delegation-service`
- run projection
- profile system
- engine adapter / Pi support
- run-lineage UI

**Dependencies**  
Workstreams 1, 2, and 3 are mandatory. Workstream 6 helps but is not required.

**Risk level**  
High.

**Expected payoff**  
Potentially high, but only once the substrate is mature.

## Workstream 8 — Sensitive-data vaults

**Objective**  
Introduce a stricter architecture for finance and medical domains.

**Why it matters**  
These are the easiest places to cause real harm with a careless architecture.

**Main components involved**
- vault packages
- secret store / context-release
- approval system
- backup rules
- local-only model/retrieval policies

**Dependencies**  
Workstream 2 and enough maturity in Workstream 4.

**Risk level**  
High.

**Expected payoff**  
High long-term, but low immediate product leverage compared with email/calendar/todos.

---

## 7. Phased implementation roadmap

## Phase 0: architectural cleanup / prerequisites

### Goals
- harden the Popeye ↔ Pi seam
- close the known repo-operability gaps that will make later work brittle
- stop always-on Popeye from inheriting overly open Pi behavior
- make future work observable and supportable

### Exact areas affected
- `packages/engine-pi`
- Pi fork / pi-mono support
- `packages/contracts`
- `packages/observability`
- `packages/runtime-core`
- `packages/control-api`
- `apps/cli`
- CI / boundary scripts / smoke tests

### Prerequisites
None.

### Deliverables
1. **Popeye-safe restricted Pi mode**
   - disable arbitrary project/global extension and package auto-loading in always-on Popeye mode
   - disable package mutation flows in that mode
   - expose effective tool/extension/provider summary back to Popeye

2. **Engine capability contract**
   - explicit `EngineCapabilities`
   - host-tool mode visibility
   - cancellation mode visibility
   - session/resume support reporting

3. **First-class host-tool bridge**
   - replace privileged runtime-tool carrier hack with a cleaner bridge

4. **Structured logging and correlation IDs**
   - `workspaceId`, `projectId`, `taskId`, `jobId`, `runId`, `sessionRootId`, later `parentRunId`

5. **Install / migrate / health / doctor basics**
   - `pop daemon health`
   - `pop migrate status|plan|apply`
   - startup checks for Pi restricted mode and capability state

6. **Pi compatibility safety net**
   - automated smoke / boundary CI beyond manual checking

7. **Runtime-core extraction plan**
   - identify and begin extracting service concerns from `runtime-service.ts`

### Acceptance criteria
- Popeye startup can report restricted Pi mode and engine capability state
- privileged runtime-tool calls no longer depend on hidden carrier behavior
- logs can correlate a run end-to-end
- Pi boundary regressions fail in CI
- migration/install/health tooling exists well enough to support the next phases
- no new capability work is built on the old provisional seam

### Major risks
- over-designing capabilities before real need
- underestimating Pi work for host-tool cleanup
- mixing “hardening” with too much product feature work and losing focus

## Phase 1: foundation

### Goals
- introduce one real execution-policy model
- add approvals, context release, and filesystem / egress posture
- add the continuity foundation Popeye currently lacks
- define the capability platform contract before building capability packages

### Exact areas affected
- `packages/contracts`
- `packages/runtime-core`
- `packages/control-api`
- `packages/workspace`
- `packages/memory`
- `packages/receipts`
- `apps/cli`
- `apps/web-inspector`
- `packages/engine-pi`
- Pi fork support where needed

### Prerequisites
Phase 0.

### Deliverables
1. **Unified execution profiles**
   - evolve `agent_profiles` into real execution profiles
   - add runtime enforcement points
   - derive per-run `ExecutionEnvelope`

2. **Approval service**
   - durable approval records
   - policy overlays with TTL or durable scope
   - intervention integration

3. **Context-release service**
   - explicit release classes
   - capability-aware content release
   - especially important for future restricted domains

4. **Filesystem scope and protected-path resolution**
   - read roots, write roots, protected paths, scratch root
   - shared machinery for file tools and curated writes

5. **Audit-first egress policy for Popeye-owned tool paths**
   - capability packs / egress groups
   - `would_deny` audit events first
   - honest limits on what is actually covered

6. **Run projection service**
   - canonical operator-facing run timeline and summary surface

7. **Recall service + artifact index + session summaries**
   - search receipts/runs/messages/interventions/connector artifacts
   - do not overload memory search

8. **Generalized content-ingress scanning**
   - message ingress
   - doc indexing
   - capability ingestion
   - playbook proposal ingestion later

9. **Capability registry + sync orchestrator skeleton**
   - package contract ready before domain modules land

### Acceptance criteria
- every run resolves to a visible effective profile and envelope
- blocked or escalated actions can create durable approval records
- protected files cannot be silently modified through Popeye-owned paths
- the operator can inspect a run via projection, not raw events alone
- prior receipts/runs/messages can be found through a recall API
- capability modules have a defined contract before any serious connector logic is added

### Major risks
- profile schema overgrowth
- mixing policy language with implementation details
- claiming stronger filesystem/egress guarantees than the runtime actually enforces
- building recall that turns into a second memory subsystem instead of artifact history

## Phase 2: core capabilities

### Goals
- establish the capability-package pattern with real user value
- ship the first truly useful assistant slice
- keep all writes narrow, explicit, and mostly proposal-based

### Exact areas affected
- `packages/cap-files`
- `packages/cap-email`
- `packages/cap-people`
- `packages/runtime-core`
- `packages/control-api`
- `apps/web-inspector`
- `apps/cli`
- local capability stores

### Prerequisites
Phase 1.

### Deliverables
1. **`cap-files` read-first capability**
   - explicit permitted roots
   - protected writes
   - receipted reads/writes/promotions
   - no whole-machine indexing

2. **`cap-email` read-only sync + local store**
   - read/list/search/fetch
   - local normalized email store
   - sync cursors
   - digest generation
   - triage summaries
   - reply/send excluded for now

3. **`cap-people` minimal extraction layer**
   - derive people/contact entities from email/calendar metadata where useful
   - keep it local and policy-bound

4. **Email digest / triage operator surfaces**
   - CLI and UI
   - receipts and recall hooks
   - memory promotion rules for summaries, not uncontrolled raw promotion

5. **Minimal workbench continuity surfaces**
   - recent activity
   - attention queue
   - history/recall pages using Phase 1 foundations

### Acceptance criteria
- Popeye can sync a local email store and produce useful read-only digests/triage
- all sync and summary actions are receipted
- no connector bypasses profile/policy/capability rules
- no direct provider calls occur from the UI or from Pi
- file access is explicit and bounded by policy

### Major risks
- making email a special case instead of a pattern for later capabilities
- over-ingesting raw email content into memory
- trying to add email sending too early

## Phase 3: hardening / operator control / polish

### Goals
- add the next assistant slices with approval-aware semantics
- improve the operator control plane substantially
- add reusable procedure now that there are real domains to automate

### Exact areas affected
- `packages/cap-calendar`
- `packages/cap-todos`
- `packages/playbooks`
- `packages/runtime-core`
- `packages/control-api`
- `apps/web-inspector`
- `apps/cli`
- packaging/install/migrate UX

### Prerequisites
Phase 2.

### Deliverables
1. **`cap-calendar`**
   - read/summarize
   - availability views
   - proposed writes
   - explicit approval for create/update/respond actions

2. **`cap-todos`**
   - canonical local todo model
   - reconciliation with external systems later if needed
   - task and workflow linkage

3. **Playbooks**
   - versioned local procedures
   - workspace/project/global scope
   - profile bindings
   - receipt linkage
   - operator activation / proposal review flow

4. **Workbench anchors and saved views**
   - daemon-stored anchors
   - client-local layout restore
   - attention/recent/history/workflow views

5. **Setup/status and command surfaces**
   - environment status
   - capability sync health
   - approvals queue
   - quick actions and command palette

6. **Packaging and migration polish**
   - install/bootstrap flow
   - better CLI discoverability
   - release smoke and restore docs

### Acceptance criteria
- calendar proposals are useful and writes are approval-gated
- Popeye has a canonical local todo representation
- repeated workflows can be captured as playbooks and linked to receipts
- operator can reopen the control plane and recover meaningful working context
- setup/status/approval surfaces are good enough for day-to-day use

### Major risks
- over-polishing UI before the new domain modules are stable
- letting playbooks become an uncontrolled plugin substitute
- under-specifying todo ownership and reconciliation rules

## Phase 4: optional advanced capabilities

### Goals
- add higher-complexity capabilities only after the foundations are stable
- introduce bounded autonomy without hiding runtime lineage
- isolate the most sensitive domains properly

### Exact areas affected
- `packages/cap-github`
- `packages/runtime-core`
- `packages/engine-pi`
- Pi support where necessary
- `packages/vault-finance`
- `packages/vault-medical`
- `apps/web-inspector`
- `apps/cli`

### Prerequisites
Phases 0-3.

### Deliverables
1. **`cap-github` read/watch capability**
   - notifications, issues, PR awareness, summaries
   - write actions remain later unless clearly justified

2. **Delegation service**
   - explicit child task/job/run lineage
   - bounded child summaries
   - no recursive swarm behavior
   - operator-visible tree and receipts

3. **Sensitive vaults**
   - finance read-only vault
   - medical read-only vault
   - explicit release rules
   - no raw embeddings / no automatic full-context release

4. **Optional execution targets**
   - only if a real isolation use case exists

5. **Optional bounded workflow-script runner**
   - only if repeated workflows genuinely need programmatic orchestration
   - feature-flagged
   - no false sandbox claims

### Acceptance criteria
- GitHub read/watch capability fits the same platform model as email/calendar
- delegation produces explicit child receipts and lineage
- finance/medical remain isolated and approval-bound
- any optional advanced execution feature can be disabled cleanly

### Major risks
- autonomy arriving before enough operator visibility
- capability sprawl
- overpromising isolation for advanced execution features

---

## 8. Concrete implementation backlog

This backlog translates the plan into implementable additions and refactors.

## 8.1 Modules / services / components to add

### Runtime core
Add:

- `run-projection.ts`
- `recall-service.ts`
- `session-summary-service.ts`
- `profile-service.ts`
- `execution-envelope.ts`
- `approval-service.ts`
- `context-release-service.ts`
- `secret-store.ts`
- `policy-service.ts`
- `environment-service.ts`
- `environment-doctor.ts`
- `capability-registry.ts`
- `sync-orchestrator.ts`
- `substrate-event-bridge.ts`
- later `delegation-service.ts`

### New packages
Add:

- `packages/cap-files`
- `packages/cap-email`
- `packages/cap-calendar`
- `packages/cap-todos`
- `packages/cap-github`
- `packages/cap-people`
- `packages/playbooks`
- later `packages/vault-finance`
- later `packages/vault-medical`

### Pi / engine support
Add or improve:

- restricted Popeye runtime mode
- host-tool bridge
- engine capability reporting
- session metadata passthrough needed for future lineage
- inherited cancellation hooks if delegation later needs them

## 8.2 Modules / services / components to refactor

Refactor:

- `packages/runtime-core/src/runtime-service.ts`
  - extract service responsibilities instead of expanding the class further

- `packages/engine-pi/src/index.ts`
  - replace temporary privileged-tool transport
  - expose capability reporting cleanly
  - negotiate restricted mode explicitly

- `packages/workspace`
  - evolve from routing-only policy toward explicit file-root / protected-path policy

- `packages/contracts`
  - unify execution/policy/approval/recall/projection/capability schemas

- `packages/control-api/src/index.ts`
  - stop being the place where new semantics get improvised ad hoc
  - route new features through explicit services and DTOs

- `packages/memory`
  - add restricted-domain memory policies
  - keep general memory separate from capability stores and vault stores

## 8.3 Interfaces and boundaries to define

### Execution profile
Define one product-level profile schema that includes at least:

- id / name / description
- mode (`restricted`, `interactive`, `elevated`)
- engine kind / model policy
- allowed runtime tools
- allowed connector/capability grants
- side-effect class
- memory and recall scopes
- session policy
- approval thresholds
- egress groups / capability packs
- filesystem policy class
- extension policy
- allowed child profiles later

### Execution envelope
Define a derived per-run envelope that includes at least:

- profile id
- workspace / project context
- read roots / write roots / protected paths / scratch root
- allowed egress groups
- release policy summary
- run label / provenance metadata

### Engine capabilities
Define a contract that reports:

- engine kind
- persistent session support
- resume-by-session-ref support
- host-tool mode
- compaction event support
- cancellation mode
- execution-target support later

### Capability package contract
Define a narrow interface for capability packages:

- metadata
- local store init/migrations
- sync
- query
- runtime tools
- recall artifact emission
- memory promotion rules
- redaction policy
- context-release policy

## 8.4 Data and storage changes

### App DB changes
Add or extend:

- richer `agent_profiles` fields
- `tasks.profile_id`
- `runs.profile_id`
- approval records
- policy overlays
- artifact index
- artifact links
- session summaries
- saved views / workbench anchors
- capability sync state or registry state
- later run lineage / delegation tables

### Memory DB changes
Keep current memory DB, but add policy for restricted-domain exclusions.

### Capability stores
Create local stores as needed under a stable runtime path such as:

- `stores/email.db`
- `stores/calendar.db`
- `stores/github.db`
- `stores/people.db`

Todo storage can start in app DB if simpler, but should still obey capability boundaries.

### Vault stores
Later, separate encrypted vault stores under:

- `vaults/finance.db`
- `vaults/medical.db`

Do not place restricted vault content into the generic memory DB.

## 8.5 Security and hardening tasks

- add restricted always-on Pi mode
- stop auto-loading arbitrary project/global extensions in that mode
- implement first-class host-tool bridge
- add capability packs / egress groups
- add audit-first network policy for Popeye-owned tools
- add filesystem scope enforcement for Popeye-owned file tools
- add protected-path handling for control files and curated memory targets
- add durable approvals with TTL and durable overlays
- add context-release classes and enforcement points
- move provider tokens toward a proper secret store
- add restricted-domain policy: no raw embeddings, no automatic full-context release
- be explicit in docs and UI where shell / arbitrary process execution is outside early enforcement coverage

## 8.6 Observability and health tasks

- structured JSON logs with correlation IDs
- end-to-end event normalization across runtime, capability sync, approvals, and engine events
- `pop daemon health`
- `pop env status`
- `pop env doctor`
- Pi compatibility smoke in CI
- migration health / plan / apply flow
- capability sync health summaries
- recent denied / would-deny activity in CLI/API/UI
- clearer receipt rendering for blocked, escalated, or approval-gated actions

## 8.7 UX and operator-surface tasks

### CLI
Add:

- `pop daemon health`
- `pop migrate status`
- `pop migrate plan`
- `pop migrate apply`
- `pop env status`
- `pop env doctor`
- `pop profile list`
- `pop profile show`
- `pop approvals list`
- `pop approvals approve`
- `pop approvals deny`
- `pop recall search`
- `pop recall open`
- `pop session history`
- `pop playbook list`
- `pop playbook show`
- later `pop run tree`
- capability-specific commands as each package lands

### Control API
Add endpoints for:

- run projection / summary
- recall search / artifact open
- profiles and effective policy
- approvals queue and actions
- environment status / doctor
- capability sync status
- playbooks
- later run lineage / delegation

### Web inspector
Add views for:

- run projection
- recall / history
- profile detail
- approvals queue
- environment status
- capability sync health
- workbench anchors / saved views
- playbooks
- later run tree / child-run lineage

---

## 9. Rejected or deferred recommendations

This section is explicit on what was dropped, deferred, or absorbed.

## 9.1 Ideas from the source docs that should not be adopted

### Plugin / marketplace / hub style extensibility
Rejected. It widens the trust boundary in exactly the wrong way for Popeye’s always-on, sensitive-data future.

### Broad multi-channel gateway architecture
Rejected. Popeye should stay narrow and domain-specific rather than becoming a messaging-platform hub.

### Pane-based multi-agent UI as the product shell
Rejected. Popeye’s primary nouns are tasks, runs, receipts, interventions, and capabilities, not panes and worker agents.

### UI-owned process orchestration
Rejected. It would undermine daemon truth, recovery, multi-client support, and auditability.

### OpenShell / Docker / K3s / NVIDIA / OpenClaw compatibility direction
Rejected. Those are donor-stack assumptions, not good Popeye architecture.

### Replacing Popeye’s memory model with a tiny two-file memory system
Rejected. The useful lesson was knowledge-surface separation, not the exact storage format.

### Session-only approvals as the main permission model
Rejected. Popeye needs durable approvals and overlays.

### Early autonomous external writes
Rejected for early phases. This includes email sending, calendar writes without approval, and GitHub writes.

## 9.2 Ideas that are valid but premature

### Execution targets / remote target abstractions
Valid, but only after profiles, approvals, and capability modules are stable.

### Workflow-script runner / bounded code execution
Potentially useful later, but too risky before the host-tool seam, receipts, and policy model are mature.

### Child-run delegation
Valid and likely important, but premature before:
- profile enforcement
- run projection
- recall
- lineage surfaces
- bounded host-tool support

### Finance and medical vaults
Valid, but they should not be the first domains because they require the strictest context-release and vault rules.

### Recursive context compatibility (`AGENTS.md`-style)
Potentially useful as a compatibility layer later, but not a core roadmap item. Popeye already has a clearer instruction precedence model.

### Broad browser/system automation
Potentially useful later, but not before file, approval, and profile boundaries are more mature.

## 9.3 Ideas that were redundant and absorbed into stronger recommendations

### Multiple profile systems
Absorbed into one **execution profile** model plus derived **execution envelope**.

### Session search vs run projection vs history UI
Absorbed into a combined continuity layer:
- run projection
- artifact recall
- session summaries
- workbench anchors

### Skills / procedures / procedural memory / playbooks
Absorbed into **Popeye playbooks**:
- versioned
- local
- operator-controlled
- instruction-bound
- receipt-linked

### Environment doctor / status / setup wizard / command palette
Absorbed into a single operator-control-surface workstream rather than treated as separate architectures.

### Strict policy rhetoric that implied complete sandboxing
Absorbed into a narrower, honest design:
- tool-path enforcement first
- shell/arbitrary-binary gaps called out explicitly
- generic isolation optional and later

---

## 10. Final verdict

The right move is not to make Popeye more like Hermes, OpenSquirrel, or NemoClaw.

The right move is to keep Popeye’s current architecture and selectively import the parts that strengthen it.

### The highest-leverage next moves

If implementation started today, the best next sequence would be:

1. **Lock down the Pi surface for always-on Popeye mode and replace the provisional privileged-tool bridge.**
2. **Turn `agent_profiles` into the real execution-profile system and add approvals/context release/filesystem/egress policy.**
3. **Add run projection and artifact recall so Popeye has real continuity.**
4. **Build the capability platform and ship read-only email sync + digest + triage.**
5. **Then add calendar proposals, local todos, playbooks, and stronger operator control surfaces.**
6. **Only after that add GitHub, delegation, and restricted vault domains.**

### The architectural principles that must be protected

Popeye succeeds only if it protects these principles:

- **runtime is the product core**
- **Pi stays generic**
- **local-first and operator-owned remain non-negotiable**
- **memory, recall, and playbooks stay separate**
- **capability modules are explicit, local, and policy-bound**
- **read-only-first beats clever autonomy**
- **approval and context release are code and data structures, not just prompt text**
- **operator surfaces reflect runtime truth rather than replacing it**
- **security claims stay honest**

### What would make this plan succeed

This plan will succeed if Popeye becomes:

- safer without becoming paralyzed
- more useful without becoming sprawling
- more continuous without becoming opaque
- more autonomous only after it becomes more inspectable

### What would make this plan fail

This plan will fail if Popeye:

- adds connectors before it adds policy
- adds autonomy before it adds visibility
- lets Pi/project extensibility reopen the trust boundary
- treats restricted domains as generic memory problems
- lets `runtime-service.ts` become a larger monolith instead of a thinner coordinator
- confuses “lots of features” with “a coherent owned personal system”

### Final judgment

Popeye already has the stronger long-term product shape.

The best path forward is:

- **harden the substrate**
- **formalize policy**
- **add continuity**
- **ship real assistant domains**
- **add reusable procedure**
- **then add bounded autonomy**

That path is more disciplined than any single source document, and it is the best fit for the system Popeye is actually trying to become.
