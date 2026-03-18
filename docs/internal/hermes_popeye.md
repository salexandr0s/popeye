
# Hermes → Popeye Analysis

*Evidence tags used throughout:* **[Code]** = confirmed directly in repository code or closely coupled implementation files; **[Docs]** = stated in repo docs / design docs but not fully re-verified in code; **[Inference]** = architectural interpretation from the available evidence. Where I discuss **pi-mono**, the strongest evidence comes from **Popeye’s own enforced boundary** plus the public Pi / coding-agent SDK layout; Popeye itself names the sibling repo `pi`, while your prompt calls it `pi-mono`.

## 1. Executive summary

Hermes absolutely contains ideas worth learning from, but **mostly at the pattern level, not at the subsystem-copy level**.

The biggest opportunity is that Hermes has a much more mature answer to a question Popeye will eventually have to solve well: **how a personal agent remembers, reuses, and resumes work over time without collapsing everything into one giant prompt or one giant memory bucket**. Hermes separates:
- past conversational/work history (`session_search`)
- durable compact user/environment memory (`MEMORY.md`, `USER.md`)
- reusable procedure (`skills`)

That separation is conceptually strong and highly relevant to Popeye.

The biggest mismatch is architectural. Hermes is fundamentally **agent-loop-centered and tool-surface-centered**. Popeye is already **runtime-centered and operation-centered**: tasks, jobs, runs, receipts, interventions, security audit, scheduling, session roots, control API. That is not a small stylistic difference; it changes where the “center of gravity” of the system should live. Hermes can teach Popeye how a personal agent should *feel* and what operator affordances matter. It should **not** replace Popeye’s stronger product-core / engine-boundary architecture.

Biggest opportunities:
- a first-class **historical recall** surface, not just memory search
- a first-class **procedural memory / playbook** layer, not just raw instruction files and not just episodic memory
- **capability profiles / policy bundles** for future connectors and use-cases
- **constrained delegation** using Popeye’s own Task → Job → Run model
- **file/context threat scanning** for future permitted-folder access

Biggest risks / mismatches:
- Hermes’s broad gateway/platform sprawl conflicts with Popeye’s deliberate omission of channel sprawl
- Hermes’s mutable skill ecosystem conflicts with Popeye’s operator-control and sensitive-data posture
- Hermes’s openness to MCP, many terminal backends, and dynamic tool/package loading expands the attack surface in exactly the direction Popeye is trying to avoid
- Hermes sometimes hides complexity inside the agent loop; Popeye’s durability depends on keeping complexity in explicit runtime state

Overall recommendation:
- **Adopt a small number of Hermes patterns aggressively.**
- **Do not adopt Hermes architecture wholesale.**
- **Do not move product semantics into pi-mono.**
- Keep Popeye’s current runtime/core split.
- Use Hermes mainly as a reference for **memory/recall/procedure/delegation ergonomics**, not for infrastructure breadth.

My highest-leverage recommendation is:

1. build a **unified recall service** over Popeye’s real artifacts (runs, receipts, interventions, messages, memory, session roots),
2. add **reviewable playbooks / procedural memory** as a product-level construct in Popeye,
3. add **capability profiles** on top of existing Popeye profile / instruction / side-effect concepts,
4. add **child-run delegation** only through Popeye’s existing runtime nouns, never as invisible subagent magic.

## 2. Popeye current state

### What Popeye currently is

**[Code]** Popeye is already a serious TypeScript monorepo, not a sketch. It has:
- apps: `cli`, `daemon`, `macos`, `web-inspector`
- packages: `runtime-core`, `control-api`, `engine-pi`, `memory`, `instructions`, `scheduler`, `sessions`, `receipts`, `observability`, `telegram`, `contracts`, `workspace`, `api-client`, `testkit`

**[Docs]** The repo positions Popeye as a **local-first, always-on, single-operator personal agent**, explicitly *not* a generic SaaS platform and explicitly *not* a port of donor architecture.

**[Docs]** The design decisions are already unusually crisp:
- two separate repos from day one: `popeye` and `pi`
- child-process Pi integration with streamed events
- one active run per workspace by default
- operator-owned critical instruction files
- loopback-only API
- explicit omission of plugin/skill marketplace, multi-channel gateway abstractions, and donor UI stack

This matters because it means Popeye is **not greenfield**. The architecture has already chosen its center.

### Core architectural shape

**[Docs]** `architecture.md` defines a strict three-layer split:

1. **Layer 1 / Engine** — Pi fork  
   model/provider abstraction, agent sessions, tool calling, compaction, context-file support, SDK/process embedding

2. **Layer 2 / Product core** — Popeye  
   daemon, scheduler, heartbeat, session orchestration, instruction resolution, memory services, receipts, audit, recovery, policy enforcement, security, control API

3. **Layer 3 / Interfaces** — Popeye  
   CLI, Telegram adapter, local web inspector, Swift/macOS app, optional API clients

**[Docs]** The repo is explicit that:
- **Pi is not the product**
- **the runtime is the product core**
- interfaces talk to runtime, not to Pi internals

That is the single most important architectural fact in the repo.

### Runtime and operational model

**[Docs]** Popeye’s canonical flow is **Task → Job → Run**. Triggers (manual, schedule, heartbeat, retry, Telegram, future webhook/inbox/file watcher) are normalized into that flow before the engine is invoked.

**[Code]** `packages/runtime-core/src/runtime-service.ts` confirms the runtime is composed around explicit services instead of burying everything in the transport layer:
- `TaskManager`
- `SessionService`
- `ReceiptManager`
- `MessageIngestionService`
- `QueryService`
- `WorkspaceRegistry`
- memory search + memory lifecycle services
- engine adapter
- timers for memory maintenance, doc indexing, token rotation

**[Docs]** The v1 process topology is:
- one daemon
- one worker child process per active run
- local Fastify API + SSE
- CLI / Telegram / inspector / future Swift as clients

**[Code]** `packages/engine-pi/src/index.ts` confirms that actual engine work is run out-of-process by spawning the Pi child with RPC mode.

### Major existing subsystems

#### A. Runtime orchestration

**[Code]** `PopeyeRuntimeService` in `packages/runtime-core/src/runtime-service.ts` is already a real product-core coordinator, not a placeholder. It handles startup reconciliation, scheduler startup, memory maintenance, doc indexing, auth rotation checks, and delegates task / receipt / query / message flows to focused services.

**Assessment:** this is already the correct architectural direction for a durable personal agent.

#### B. Durable operational storage

**[Code]** `packages/runtime-core/src/database.ts` shows an explicit operational schema in SQLite with tables such as:
- `daemon_state`
- `workspaces`
- `projects`
- `agent_profiles`
- `tasks`
- `jobs`
- `job_leases`
- `session_roots`
- `runs`
- `run_events`
- `run_outputs`
- `receipts`
- `instruction_snapshots`
- `interventions`
- `security_audit`
- `messages`
- later migrations: `message_ingress`, `browser_sessions`, Telegram relay / delivery / resolution state

This is a major strength. Hermes has richer personal-agent UX in some places, but Popeye already has **much stronger explicit operational state**.

#### C. Memory subsystem

**[Code]** `packages/memory/src/search-service.ts` confirms Popeye is not using a toy memory layer:
- FTS5 + sqlite-vec hybrid retrieval
- lexical and vector search merged/reranked
- memory type filtering
- provenance and source references
- confidence scoring and decay
- budget-fit query handling
- redaction before durable writes
- embeddings handled as optional / degradable

**[Code]** Control API endpoints expose memory search, audit, integrity check, budget-fit, describe, expand, and typed filtering over `episodic`, `semantic`, and `procedural` memory.

**[Docs]** The memory design explicitly distinguishes episodic / semantic / procedural / working memory and prefers SQLite-native, local retrieval over external services.

#### D. Message ingress and operator intervention

**[Code]** `packages/runtime-core/src/message-ingestion.ts` is more than a chat adapter. It records idempotent ingress rows, links accepted ingress to tasks/jobs/runs, tracks Telegram reply delivery state, rate limits, and security-audits rejected ingress.

**[Code]** Runtime methods around Telegram uncertain delivery create explicit interventions rather than guessing.

This is very aligned with a sensitive-data personal agent: ambiguous external effects become operator-visible runtime state.

#### E. Security and control surfaces

**[Code]** `packages/control-api/src/index.ts` confirms the control plane is intentionally local and hardened:
- loopback HTTP API
- bearer auth
- browser sessions
- CSRF enforcement
- `Sec-Fetch-Site` checking for browser mutations
- helmet/CSP
- rate limiting
- SSE event stream
- redaction in logs

**[Code]** `packages/control-api/src/auth.ts` shows a proper auth store with overlap rotation, constant-time comparison, cookie isolation, and separate CSRF token handling.

#### F. Pi boundary and engine adapter

**[Code]** `packages/engine-pi/src/index.ts`, `scripts/check-pi-boundary.mjs`, and `scripts/check-pi-checkout.mjs` show a deliberately narrow integration:
- default separate checkout at `../pi`
- expected Pi layout includes `packages/coding-agent`
- version pin checked against `packages/coding-agent/package.json`
- Pi launched in `--mode rpc`
- host tools bridged through a Popeye-owned adapter path
- only `@popeye/engine-pi` may know Pi internals

**[Docs]** `docs/pi-capability-map.md` and `docs/pi-fork-delta.md` are especially important. They make clear that Popeye owns:
- runtime orchestration
- scheduling
- task/job/run lifecycle
- session-root policy
- instruction selection
- memory policy and storage
- receipts and audit
- interventions
- auth/CSRF/security
- control API
- backup/restore

while Pi owns the generic engine substrate:
- model/provider abstraction
- agent loop
- generic tool calling
- compaction
- session machinery
- SDK/process runtime surface

This is an excellent boundary.

### What is already implemented vs only implied

#### Confirmed already implemented in code
- SQLite operational state and migrations
- daemon/runtime composition
- Task / Job / Run / Receipt / Intervention model
- Pi child-process adapter
- strict Pi boundary enforcement
- control API with auth / CSRF / SSE
- hybrid memory retrieval
- message ingress and Telegram delivery state
- instruction preview endpoint
- agent profile listing endpoint
- workspace doc indexing timers
- backup / restore and security audit surfaces

#### Docs-backed and largely consistent, but not all re-verified in code
- one worker child per active run as the intended process topology
- per-use-case session-root policies
- operator-owned and read-only critical instruction files by default
- broader future end-state around mail/calendar/repo/folder access
- future possibility of SDK mode behind the same engine interface

#### Inference / interpretation
- Popeye is already much closer to a **local operations platform for an owned personal agent** than to a chat bot with tools
- the current repo is strong on runtime durability and explicit state, but still relatively early on **high-level personal-agent ergonomics** (cross-session recall, procedural reuse, connector personas, operator continuity UX)

### Current weaknesses / missing areas

There are two kinds of gaps: **known repo gaps** and **future-product gaps**.

#### Known repo gaps already identified by Popeye itself

**[Docs]** `docs/phase-audit-2026-03-14.md` lists several real remaining issues:
- no structured application logger with correlation IDs
- no packaging / install flow; still runs from monorepo checkout
- no migration helper tooling
- CLI lacks `--help` and stronger validation/polish
- no full hybrid search integration test
- Pi upgrade smoke is still manual-dispatch oriented
- no Sessions view in the web inspector
- no CWD-based workspace routing
- sqlite-vec remains pinned to an alpha release

These are not fatal, but they matter because Popeye’s future will depend on trust, recoverability, and operator insight.

#### Future-product gaps relative to your target end-state

From the code today, Popeye still lacks first-class product subsystems for:
- email reading/summarization flows
- calendar awareness and action flows
- todo/workflow operator surfaces beyond task/job/run primitives
- repo / issue / PR awareness
- an explicit permissioned file/folder capability surface for sensitive local data
- first-class historical recall across all operational artifacts
- a first-class procedural playbook layer

Those are exactly the areas where Hermes is most useful as a reference.

### Role of pi-mono in the overall system

This boundary is central, so it is worth being explicit.

#### What belongs in pi-mono / Pi

**[Code] + [Docs]** Based on Popeye’s own boundary enforcement and the public Pi/coding-agent SDK surface, pi-mono is the right home for generic engine/runtime capabilities such as:
- model/provider abstraction
- agent session lifecycle
- generic tool-calling runtime
- compaction
- generic session tree / branch mechanics
- RPC mode / subprocess integration
- generic custom tool registration
- generic resource loading / session management / slash-command / context-file machinery (if Popeye ever wants to use more of it)

#### What belongs in Popeye

**[Code] + [Docs]** Popeye should continue to own:
- daemon lifecycle
- job scheduling and leasing
- task/job/run semantics
- session-root policy
- instruction compilation / workspace identity
- memory policy and durable storage
- receipts
- interventions
- security audit
- control API
- backup/restore
- connector policy and permissions
- operator-facing local control surfaces
- every product rule about sensitive data and side effects

#### What should not cross the boundary

Popeye already enforces this in code.

**[Code]** `scripts/check-pi-boundary.mjs` forbids leaked references outside `engine-pi` such as:
- `../pi`
- `packages/coding-agent`
- `packages/ai`
- `--mode rpc`
- `extension_ui_request`
- `extension_ui_response`
- `popeye.runtime_tool`

That tells you exactly how seriously the repo takes the separation.

#### Important conclusion on the Popeye ↔ pi-mono relationship

Popeye is using pi-mono correctly: **as a replaceable engine substrate, not as the product architecture**.

That means any Hermes-inspired adoption should pass a simple test:

> Is this a generic engine capability, or is it a Popeye product capability?

If it is about memory policy, receipts, mail/calendar/repo integration, operator control, interventions, or sensitive local data handling, it belongs in **Popeye**.
If it is about session primitives, generic tool dispatch, compaction, or generic agent runtime mechanics, it may belong in **pi-mono**.

## 3. Hermes-agent architecture summary

### The architectural center of Hermes

Hermes is much more mature than Popeye in one very specific way: it is already a broad, lived-in **personal agent system**.

But its architecture is organized differently.

**[Code]** The center of Hermes is the `AIAgent` in `run_agent.py`. That file is large and carries a lot of cross-cutting responsibility:
- model call orchestration
- tool execution coordination
- callback surfaces
- compression/fallback handling
- session continuation
- memory nudging / flushing
- Honcho activation
- delegation handling
- platform integration hooks

Hermes is therefore best described as **agent-loop-first**. The rest of the system orbits the agent loop.

Popeye, by contrast, is **runtime-first**. The engine loop is a worker under the runtime.

That difference should shape every adoption decision.

### Important primitives, systems, and patterns in Hermes

#### A. AIAgent / session-centered runtime

**[Code]** `run_agent.py` exposes an agent loop with:
- configurable model/provider/API mode
- callbacks such as `tool_progress_callback`, `thinking_callback`, `clarify_callback`, `stream_delta_callback`
- shared `IterationBudget`
- optional fallback model
- session DB support
- prompt compression machinery
- memory and todo stores per agent
- optional Honcho integration

**[Code]** Hermes can share one iteration budget across parent and child agents, which matters for delegation.

#### B. Tool registry + toolsets

**[Code]** `model_tools.py` and `toolsets.py` define a self-registering tool architecture:
- tool modules self-register
- `get_tool_definitions()` resolves active tools via enabled/disabled toolsets
- `_AGENT_LOOP_TOOLS` like `todo`, `memory`, `session_search`, `delegate_task` are intercepted by the agent loop
- toolsets are named bundles for scenarios and platforms

**[Code]** `_HERMES_CORE_TOOLS` is broad: web, terminal, files, vision, skills, browser, todo, memory, session search, code execution, delegation, cronjob, cross-platform messaging, Honcho, Home Assistant, etc.

This is powerful, but it is also exactly where Hermes becomes opinionated and hard to transplant.

#### C. Session storage and search

**[Code]** `hermes_state.py` uses SQLite (`~/.hermes/state.db`) with:
- sessions table
- messages table
- metadata including model and system prompt
- FTS5 search over messages
- source/platform/user metadata
- parent session relationships

**[Docs]** Hermes also keeps raw JSONL transcripts separately under `~/.hermes/sessions/`.

This is one of Hermes’s strongest ideas: **past work is searchable operational history**, not vague “memory”.

#### D. Persistent memory

**[Code]** `tools/memory_tool.py` confirms Hermes uses a deliberately small persistent-memory model:
- two files: `MEMORY.md` and `USER.md`
- default limits: `2200` and `1375` chars
- entries are loaded at session start and frozen into a system-prompt snapshot
- add/replace/remove actions are bounded and de-duplicated
- memory content is scanned for injection / exfiltration patterns and invisible Unicode
- live state persists to disk after mutation

**[Docs]** Hermes explicitly says this memory is for durable facts/preferences, not task progress. Task progress is supposed to come from `session_search`.

This separation is more important than the specific two-file implementation.

#### E. Skills

**[Docs] + [Code]** Skills are markdown procedures loaded from `~/.hermes/skills/`, with discovery rules that accept `.md` or `SKILL.md`. The public Pi/coding-agent SDK has analogous skill loading machinery. Hermes uses:
- `skills_list`
- `skill_view`
- `skill_manage`

**[Docs]** Skills can come bundled, from hubs, or be created by the agent itself. This is powerful, but it is also a major trust/surface-area expansion.

#### F. Delegation / subagents

**[Code]** `tools/delegate_tool.py` spawns child `AIAgent` instances with:
- fresh conversation
- focused child system prompt
- restricted toolsets
- their own task/session state
- shared iteration budget
- optional parallel batch execution
- parent only sees delegation call + summarized result, not the full child internal trace

This is a good idea in principle, but Hermes’s exact tradeoffs are not a direct fit for Popeye.

#### G. Messaging gateway and cron

**[Code] + [Docs]** `gateway/run.py` and `cron/scheduler.py` provide:
- per-chat session continuity across platforms
- a gateway process that routes incoming messages to agent sessions
- cron job execution using the same agent runtime
- background scheduler tick every 60 seconds
- file-based lock for cron ticks
- origin-aware delivery and mirroring into gateway sessions

This is one of the most “product-complete” aspects of Hermes, but it also reflects a much broader platform ambition than Popeye wants.

#### H. Security surfaces

**[Code] + [Docs]** Hermes has several concrete control layers:
- allowlists / pairing for messaging access
- dangerous command detection + approval prompts
- optional “smart approvals” via auxiliary model
- context-file scanning for prompt injection patterns
- MCP credential filtering
- container/back-end isolation options

These are meaningful, not superficial.

### What makes Hermes strong

Hermes is strong where it matters for a personal agent operator experience:

1. **Recall is first-class.**  
   `session_search` turns prior work into something the agent can actually use.

2. **Knowledge surfaces are separated.**  
   Historical sessions, durable fact memory, and procedural knowledge are different things.

3. **Procedures are real artifacts.**  
   Skills make reusable know-how explicit and local.

4. **Delegation exists and is practical.**  
   The system can decompose work.

5. **Operator surfaces are cohesive.**  
   CLI, gateway, sessions, cron, skills, memory, and messaging feel like parts of one system.

6. **Security is operationalized.**  
   Context scanning and dangerous-command gating are built into the normal flow, not bolted on.

### What makes Hermes opinionated or hard to transplant

1. **Too much architectural gravity lives inside the agent loop.**  
   Hermes’s product behavior tends to accrete around `AIAgent`.

2. **The tool surface is extremely broad.**  
   Toolsets are powerful, but they assume a more open agent than Popeye should be.

3. **Skills are highly mutable.**  
   Useful for experimentation; risky for sensitive-data stewardship.

4. **Gateway sprawl is a core assumption.**  
   Telegram/Discord/Slack/WhatsApp/Signal/Email/Home Assistant is a very different scope decision from Popeye’s.

5. **MCP and package openness increase the trust boundary.**  
   That is excellent for a general agent framework, but not automatically good for a private, operator-owned system.

6. **Some controls are model-mediated.**  
   Example: smart approvals via an auxiliary model. That is convenient, but less durable as a trust boundary than Popeye’s explicit intervention model.

## 4. Components / patterns from Hermes worth adopting

### 4.1 Knowledge-surface separation: history vs durable memory vs procedure

**What it does**

Hermes treats three kinds of “knowing” as separate:
- session history recall (`session_search`)
- durable compact memory (`MEMORY.md`, `USER.md`)
- reusable procedural guidance (`skills`)

**Why it matters**

This prevents the classic personal-agent failure mode where:
- everything gets stuffed into memory,
- memory becomes noisy,
- prompts bloat,
- task progress pollutes durable knowledge,
- procedures are hidden in random transcripts.

**Why it fits Popeye specifically**

Popeye already has the raw ingredients:
- operational history in app DB (`tasks`, `jobs`, `runs`, `run_events`, `run_outputs`, `receipts`, `messages`, `message_ingress`, `interventions`)
- memory DB with typed memory (`episodic`, `semantic`, `procedural`)
- an instruction system with snapshotting and preview
- deterministic session-root policies

What Popeye lacks is a **product-level explicitness** that says:
- this is recall,
- this is curated durable knowledge,
- this is reusable procedure.

Hermes’s separation is therefore a strong conceptual model for Popeye’s next layer of product evolution.

**Belongs in Popeye or pi-mono?**

Primarily **Popeye**.  
pi-mono may expose generic session and tool primitives, but the classification and policy of knowledge surfaces is a product concern.

**Integration complexity**

**Medium**

**Implementation prerequisites**
- a unified recall API
- a procedural-memory / playbook representation
- instruction resolver support for procedure inclusion
- clear operator UX for promotion / approval / review

**Risks / caveats**
- too many “knowledge surfaces” can confuse the operator if not presented clearly
- without strong naming and UI, this can become taxonomy theater
- avoid leaking product semantics into pi-mono

### 4.2 Unified historical recall service

**What it does**

Hermes’s `session_search` uses SQLite FTS5 over past sessions, groups results by session, excludes the current session, resolves child delegation sessions back to parents, and summarizes the top matches with a cheaper model.

**Why it matters**

This is one of Hermes’s best ideas. It recognizes that the agent should not have to ask the operator to repeat information that already exists in its history.

**Why it fits Popeye specifically**

Popeye should not copy `session_search` literally. It should build something **stronger**, because Popeye’s operational record is richer than Hermes’s session record.

Popeye can search across:
- `run_outputs.summary`
- `receipts.summary` and `receipts.details`
- `run_events`
- `message_ingress.body`
- `messages.body`
- `interventions.reason`
- session-root metadata
- memory search results from `memory.db`

Hermes shows the right pattern:
- **do not store task history in durable memory**
- **search it as history**
- **summarize only the relevant slices**

Popeye is actually in a better position than Hermes here because it already has more structured operational nouns.

**Belongs in Popeye or pi-mono?**

**Popeye**

This is product recall over product artifacts, not generic agent runtime behavior.

**Integration complexity**

**Medium**

**Implementation prerequisites**
- a `RecallService` in `runtime-core`
- FTS indexes over operational text fields in `app.db`
- optional join/merge with memory search results from `memory.db`
- a summarization step that can be disabled, kept local, or routed to an approved backend
- control API + UI surfaces

**Risks / caveats**
- do not silently use a remote cheap model for highly sensitive history unless the operator explicitly allows it
- avoid summarizing more material than necessary
- keep provenance visible: “this answer came from receipt X / run Y / message Z”
- do not blur recall and memory promotion

### 4.3 Reviewable playbooks / procedural memory documents

**What it does**

Hermes skills are reusable local procedures in markdown that the agent can discover, inspect, and invoke conceptually.

**Why it matters**

A personal agent becomes dramatically more useful once repeated procedures stop living only in transcripts or in giant identity/workspace prompts.

**Why it fits Popeye specifically**

Popeye already has:
- an instruction layer
- instruction snapshots
- typed procedural memory in the memory system
- explicit operator approval and receipt culture

That makes Popeye a very good home for a **playbook layer** that is more durable and trustworthy than Hermes skills for sensitive work.

What Popeye should adopt is **the procedure artifact pattern**, not the Hermes skill ecosystem.

A Popeye playbook should probably be:
- local and inspectable
- versioned
- tied to workspace/project/global scope
- optionally indexed into procedural memory
- compiled into instruction bundles at run start
- operator-reviewed before activation for any side-effectful workflow
- linked to receipts when it materially affected a run

Examples:
- “mail triage routine”
- “weekly calendar review”
- “PR review policy for repo X”
- “document safe export procedure”
- “backup verification checklist”

**Belongs in Popeye or pi-mono?**

Mostly **Popeye**.  
At most, pi-mono might provide a generic ability to consume resolved prompt content. It should not own Popeye’s playbook semantics, versioning, or approval rules.

**Integration complexity**

**Medium**

**Implementation prerequisites**
- playbook schema + storage
- instruction resolver support
- revision history
- binding rules for scope/profile/use-case
- operator approval workflow for activation or mutation
- indexing into `memory.db` as procedural memory, with provenance

**Risks / caveats**
- letting the agent directly create/modify active playbooks by default would be a bad fit
- avoid turning playbooks into an uncontrolled plugin system
- keep playbooks separate from transient task plans and transient session notes

### 4.4 Capability profiles / tool bundles / policy bundles

**What it does**

Hermes toolsets define named bundles of tools for platforms and scenarios. The exact Hermes implementation is too broad, but the pattern is sound: an agent should run under a named capability shape, not a flat pile of tools.

**Why it matters**

As Popeye grows into email, calendar, repo, file, and workflow actions, it will need an explicit way to say:
- what this run is allowed to see
- what it is allowed to change
- what memory scopes it may use
- what instructions apply
- what intervention thresholds apply

**Why it fits Popeye specifically**

Popeye already has pieces of this:
- `agent_profiles`
- instruction scopes and previews
- `side_effect_profile` on tasks
- session policies
- runtime tool descriptors
- security / intervention mechanisms

Hermes shows the usability pattern. Popeye can implement it in a stricter, product-owned way:
- `mail-triage`
- `calendar-assistant`
- `repo-maintainer`
- `operator-admin`
- `background-heartbeat`
- `sensitive-files-readonly`

These should be more than tool lists. They should be **policy bundles**.

**Belongs in Popeye or pi-mono?**

**Popeye**

pi-mono may support generic tool enabling/disabling, but the policy meaning of profiles belongs in Popeye.

**Integration complexity**

**Low to Medium**

**Implementation prerequisites**
- enrich `agent_profiles`
- define policy fields for tool access, connector scopes, side-effect classes, memory scopes, and instruction overlays
- expose profile inspection and assignment in API/UI

**Risks / caveats**
- don’t reduce profiles to mere marketing labels
- keep them deterministic and inspectable
- avoid importing Hermes’s “everything on every platform” stance

### 4.5 Constrained child-run delegation

**What it does**

Hermes can spawn subagents with fresh context, restricted toolsets, and shared iteration budget.

**Why it matters**

Some personal-agent tasks are naturally decomposable:
- triage inbox then draft summaries
- analyze a repo issue, then inspect related PRs
- compare calendar conflicts and then draft an action plan
- scan a large folder and then produce a review summary

Delegation can lower context pressure and improve focus.

**Why it fits Popeye specifically**

Popeye already has the exact nouns needed to implement this cleanly:
- `Task`
- `Job`
- `Run`
- `SessionRoot`
- receipts
- interventions
- usage tracking

That means Popeye can implement delegation as **explicit child runs**, not as magical hidden subagents.

This is where Popeye should improve on Hermes:
- every child should have a run record
- every child should produce receipts and usage
- lineage should be queryable
- parent/child linkage should be visible in UI/API
- operator can inspect or cancel children
- policy inheritance should be explicit

**Belongs in Popeye or pi-mono?**

Mostly **Popeye**, with possible small supporting work in **pi-mono**.

pi-mono may need only generic support for:
- fresh child sessions
- runtime tool restrictions
- inherited cancellation / budget hooks
- perhaps parent session metadata if useful

But the scheduling, lineage, persistence, and policy rules belong in Popeye.

**Integration complexity**

**High**

**Implementation prerequisites**
- parent/child run linkage in schema
- child-run orchestration in runtime-core
- policy inheritance rules
- budget/time/usage accounting across run trees
- UI/API lineage visualization
- failure and cancellation semantics

**Risks / caveats**
- the wrong implementation would bypass Popeye’s biggest strengths (explicit state and receipts)
- do not let delegation create invisible side effects
- do not implement free-form recursive agent spawning
- keep depth caps and profile constraints

### 4.6 File/context threat scanning before prompt inclusion

**What it does**

Hermes scans context-bearing files and memory content for prompt injection / exfiltration patterns and invisible Unicode before including them in agent context.

**Why it matters**

Your target end-state explicitly includes access to explicitly permitted files and folders and operation on highly sensitive personal data. Once Popeye starts ingesting user-approved folders or mail/repo content more broadly, prompt-injection-like content becomes a real risk.

**Why it fits Popeye specifically**

Popeye already has a good start:
- redaction before memory writes
- message ingress scanning and security audit
- operator-owned critical instruction files
- strong local control surfaces

Hermes suggests the next step:
- apply equivalent scanning to workspace documents before indexing
- apply it to future permitted-folder ingestion
- apply it to connector content before auto-promotion into memory or instructions
- record findings in `security_audit` and optionally create interventions

**Belongs in Popeye or pi-mono?**

Mostly **Popeye**, especially for file indexing and connector ingestion.

pi-mono may have generic context-file scanning facilities, but Popeye should still own the policy for what is indexed, blocked, or escalated.

**Integration complexity**

**Low to Medium**

**Implementation prerequisites**
- a reusable scanning module for document ingestion
- integration points in workspace doc indexer, future file connectors, and playbook proposal flows
- policy codes and security-audit reporting

**Risks / caveats**
- pattern-only detection will be imperfect
- false positives are possible
- scanning should be logged and reviewable, not silently destructive

### 4.7 Operator-facing session continuity / recall UX

**What it does**

Hermes feels mature because recall, sessions, messaging, and background jobs are exposed as ordinary operator experiences, not just hidden backend state.

**Why it matters**

Popeye already has strong runtime state, but that state has limited operator UX compared with Hermes. For an always-on personal agent, continuity must be inspectable and steerable.

**Why it fits Popeye specifically**

Popeye already has:
- SSE
- web inspector
- control API
- CLI
- session roots
- interventions
- run events
- receipts

The missing piece is a first-class continuity UX:
- “what have we already done about this?”
- “show related runs / receipts / messages”
- “resume that thread / task / session root”
- “what background jobs are active and why?”
- “which child runs did this parent spawn?”
- “what playbooks affected this run?”

Hermes shows why these surfaces matter.

**Belongs in Popeye or pi-mono?**

**Popeye** interfaces + runtime query layer

**Integration complexity**

**Medium**

**Implementation prerequisites**
- unified recall/search backend
- session/run lineage exposure
- UI views for sessions/history/lineage
- richer CLI commands

**Risks / caveats**
- don’t build UI-only features with no runtime semantics
- the runtime should remain the source of truth

## 5. Overlapping areas where Hermes appears stronger than Popeye

### 5.1 Cross-session recall

**Area both systems are trying to solve**

Both systems care about durable usefulness over time. Popeye already has memory and session roots. Hermes has a more mature operator-and-agent recall loop.

**Why Hermes’ approach looks better**

Hermes makes historical recall an explicit capability (`session_search`) instead of assuming memory search is enough.

**What exactly Popeye should learn**

Popeye should stop treating “memory” as the only answer to continuity. It should add **history recall over runtime artifacts**, not just improve embedding search.

**Concrete adoption recommendation**

Implement a `RecallService` in `runtime-core` with:
- FTS over app DB artifacts
- merged results from `memory.db`
- provenance-first hits
- optional local summarization of top matches
- API/UI surfaces for operator and agent use

### 5.2 Procedure reuse

**Area both systems are trying to solve**

Both systems need reusable behavior over time.

**Why Hermes’ approach looks better**

Hermes has an explicit procedure artifact (`skills`). Popeye has instruction files and procedural memory types, but not yet a clear product-level procedural object.

**What exactly Popeye should learn**

Procedure should be a first-class artifact, not an accidental byproduct of memory or a giant global instruction file.

**Concrete adoption recommendation**

Add **Popeye playbooks**:
- versioned
- scoped
- operator-reviewable
- linked to instruction compilation
- optionally indexed as procedural memory
- linked to run receipts when used

### 5.3 Delegation

**Area both systems are trying to solve**

Both systems need to handle work that is too big or too diverse for a single uninterrupted context.

**Why Hermes’ approach looks better**

Hermes already has a functioning subagent/delegation implementation with tool restrictions and shared budget.

**What exactly Popeye should learn**

Delegation should be supported, but with stronger explicit lineage and audit than Hermes currently exposes to the parent.

**Concrete adoption recommendation**

Implement delegation as **child runs**, not hidden subagents. Reuse Popeye’s run/receipt infrastructure.

### 5.4 Session continuity UX

**Area both systems are trying to solve**

Both want long-lived useful continuity with an agent.

**Why Hermes’ approach looks better**

Hermes treats continuity as a normal operator feature across CLI, gateway, sessions, cron, and recall.

**What exactly Popeye should learn**

Continuity must be exposed and inspectable. Session roots alone are not enough if the operator cannot navigate them comfortably.

**Concrete adoption recommendation**

Add:
- sessions/history view to the inspector
- CLI history/recall commands
- linked run/session/receipt navigation
- session-root and child-run lineage views

### 5.5 Context security around imported content

**Area both systems are trying to solve**

Both systems must protect the agent from untrusted context.

**Why Hermes’ approach looks better**

Hermes operationalizes prompt-injection scanning across memory/context surfaces more visibly.

**What exactly Popeye should learn**

As Popeye expands from workspace docs into mail/repo/files, its current message-ingress and redaction discipline should generalize into a broader content-ingress policy.

**Concrete adoption recommendation**

Introduce a reusable content-scanning stage for:
- file indexing
- connector ingestion
- playbook proposals
- future email/repo summarization inputs

## 6. Hermes components that should NOT be adopted

### 6.1 Broad multi-platform gateway as a core architectural assumption

**What should be avoided**

The full Hermes gateway model as a Popeye architectural direction:
- Telegram
- Discord
- Slack
- WhatsApp
- Signal
- Email
- Home Assistant
- cross-platform message sending as a default capability surface

**Why it is a bad fit**

Popeye explicitly rejects channel sprawl. Its design docs and omissions are clear that only a thin Telegram bridge is intended early on, and that gateway multi-channel abstractions are out of scope. For a sensitive, owned personal agent, every additional external surface multiplies complexity, auth risk, data leakage risk, and operator confusion.

**How Popeye should solve the problem instead**

Use narrow, deliberate adapters only when justified.  
For your target end-state, email/calendar/repo integrations should be **domain-native connectors**, not “just another platform in a general gateway.”

### 6.2 Agent-editable open skill ecosystem

**What should be avoided**

Hermes’s hub/package-oriented, agent-mutable skill ecosystem as a direct model.

**Why it is a bad fit**

Popeye is meant to operate over highly sensitive personal data with strong operator control. Allowing the agent to freely create, mutate, delete, or install procedural artifacts is a trust-boundary problem. Hermes is optimized more for experimentation and personal flexibility. Popeye needs more controlled durability.

**How Popeye should solve the problem instead**

Adopt the idea as **reviewable playbooks**, with:
- version history
- activation state
- provenance
- optional operator approval before activation or mutation
- strict scoping and policy linkage

### 6.3 MCP-first openness and dynamic third-party tool loading

**What should be avoided**

A broad MCP/open package model as the early answer to Popeye’s connector roadmap.

**Why it is a bad fit**

Hermes’s openness is an advantage for a general-purpose agent framework. For Popeye, it would be premature and likely destabilizing:
- more credentials
- more trust boundaries
- more remote dependencies
- harder auditability
- harder reproducibility

**How Popeye should solve the problem instead**

Implement native Popeye connectors first:
- mail
- calendar
- todo/workflow
- repo/issue/PR
- permitted file/folder access

If a more generic tool bus is ever needed later, it should be local-only, allowlisted, and subordinate to Popeye policy.

### 6.4 Broad environment/backend matrix for terminal execution

**What should be avoided**

Hermes’s full execution backend spread (local, docker, ssh, singularity, modal, daytona, etc.) as a Popeye priority.

**Why it is a bad fit**

Popeye’s target is local-first personal stewardship, not multi-environment agent ops. The broader the environment matrix, the harder the security and support story becomes.

**How Popeye should solve the problem instead**

If Popeye eventually needs isolation for risky automations, add **narrow local sandboxing** or per-connector safe execution zones later. Do not import the full environment matrix.

### 6.5 Two-file memory as Popeye’s primary memory architecture

**What should be avoided**

Replacing Popeye’s richer memory design with Hermes’s `MEMORY.md` / `USER.md` model.

**Why it is a bad fit**

Hermes’s memory model is elegant because it is small, but Popeye already has a stronger long-term architecture:
- typed memory
- provenance
- confidence decay
- retrieval
- explicit promotion
- audit surfaces

Downgrading to a tiny two-file memory model would be a regression.

**How Popeye should solve the problem instead**

Learn the **separation of concerns**, not the storage format:
- facts/preferences → curated memory
- past work → recall
- procedures → playbooks/procedural memory

### 6.6 Monolithic agent-loop-centered product structure

**What should be avoided**

Letting Popeye drift toward “the agent loop is the product core.”

**Why it is a bad fit**

Popeye’s strongest architectural choice is that the runtime is the product core and the engine is a replaceable worker. That is exactly the right shape for a sensitive, always-on local agent.

**How Popeye should solve the problem instead**

Keep all durable semantics in the runtime:
- scheduling
- receipts
- interventions
- connector state
- audit
- memory policy
- operator actions

Hermes can inspire runtime features, but Popeye should not re-center itself around the engine loop.

### 6.7 LLM-mediated smart approvals as a primary trust boundary

**What should be avoided**

Using an auxiliary model as the primary arbiter of whether a dangerous action is safe.

**Why it is a bad fit**

Hermes’s smart approvals are a useful convenience layer for a developer-oriented agent. Popeye’s target is highly sensitive personal data and long-term operator trust. A model can help classify or prioritize, but it should not become the primary authority for sensitive side effects.

**How Popeye should solve the problem instead**

Use:
- explicit capability profiles
- explicit side-effect classes
- explicit operator interventions / approval workflows
- deterministic policy checks
- receipts and audit

Model judgment can assist, but should not replace these.

## 7. Popeye-specific gaps revealed by this comparison

### Priority 1 — Unified recall over real runtime history
- **Gap:** Popeye has memory search, but not a first-class “what have we already done about this?” recall surface over runs/receipts/messages/interventions/sessions.
- **Does Hermes help?** **Directly**
- **Why it matters:** this is the shortest path to real personal-agent continuity without memory pollution
- **Priority:** **Highest**

### Priority 2 — First-class procedural memory / playbooks
- **Gap:** Popeye has instruction files and procedural memory types, but not a product-level reusable procedure artifact.
- **Does Hermes help?** **Directly**
- **Why it matters:** repeated workflows will otherwise stay trapped in transcripts or giant prompts
- **Priority:** **Highest**

### Priority 3 — Explicit capability / policy profiles
- **Gap:** Popeye has ingredients (`agent_profiles`, side-effect profiles, instruction scopes), but not yet a clearly composable operator-facing model for connector/use-case policies.
- **Does Hermes help?** **Indirectly**
- **Why it matters:** future email/calendar/repo/file access needs explicit run shapes
- **Priority:** **High**

### Priority 4 — Connector architecture for personal systems
- **Gap:** the end-state calls for email, calendar, todo, repo, and file access, but those are not yet first-class Popeye subsystems.
- **Does Hermes help?** **Indirectly / mostly no**
- **Why it matters:** this is core to Popeye’s product future
- **Priority:** **High**
- **Important note:** Hermes is not the solution here. Its gateway/tool openness is not the right substitute for deliberate Popeye connectors.

### Priority 5 — File/content ingress safety model
- **Gap:** Popeye has message-ingress scanning and redaction, but future permitted-folder / external-content ingestion will need a general content safety pipeline.
- **Does Hermes help?** **Indirectly**
- **Why it matters:** future sensitive local data access makes this essential
- **Priority:** **High**

### Priority 6 — Delegation with audit and lineage
- **Gap:** Popeye does not yet appear to have first-class child-run delegation semantics.
- **Does Hermes help?** **Directly**
- **Why it matters:** complex workflows will need decomposition
- **Priority:** **Medium-High**

### Priority 7 — Better continuity / session UX
- **Gap:** Popeye’s runtime semantics are strong, but its operator surfaces around history/session continuity are still thinner than Hermes’s.
- **Does Hermes help?** **Directly**
- **Why it matters:** an always-on personal agent must be inspectable and steerable
- **Priority:** **Medium**

### Priority 8 — Structured observability and correlation IDs
- **Gap:** Popeye’s own phase audit calls this out.
- **Does Hermes help?** **Not really**
- **Why it matters:** before adding more connectors and delegation, Popeye needs better internal traceability
- **Priority:** **Medium**
- **Important note:** this is not a Hermes lesson; it is a Popeye prerequisite.

## 8. Recommended adoption roadmap

### Phase 0: prerequisites / architectural cleanup

**Objectives**
- finish the runtime observability story
- make future recall/delegation/playbook work debuggable
- strengthen the already-good Popeye ↔ pi-mono boundary before feature expansion

**Exact areas likely affected**
- `@popeye/observability`
- `runtime-core`
- `contracts`
- `control-api`
- docs around Pi boundary and profile semantics

**Work**
- implement structured JSON logging with correlation IDs (`workspaceId`, `projectId`, `taskId`, `jobId`, `runId`, `sessionRootId`, future `parentRunId`)
- formalize run lineage IDs in contracts before delegation exists
- enrich `agent_profiles` / side-effect policy metadata rather than inventing another parallel concept later
- add missing tests around hybrid search and failure / recovery paths
- clarify any naming/documentation mismatch between `pi` and `pi-mono`

**Expected benefits**
- makes later adoption auditable
- reduces risk of feature growth turning runtime state opaque
- preserves architecture discipline

**Dependency ordering**
- do this before delegation and before major connector expansion
- can partially overlap with recall service groundwork

**Risk level**
- **Low to Medium**

### Phase 1: highest-leverage adoptions

**Objectives**
- make Popeye meaningfully better at continuity and reusable behavior
- adopt Hermes’s strongest ideas without architecture drift

**Exact areas likely affected**
- `runtime-core`
- `memory`
- `instructions`
- `contracts`
- `control-api`
- `web-inspector`
- `cli`

**Work**
1. **Unified recall service**
   - search runs / receipts / messages / interventions / session roots
   - merge with memory search results
   - provenance-first result model
   - optional summarization on top

2. **Playbooks / procedural memory**
   - versioned playbooks with scope and activation state
   - compile playbook content into instruction bundles
   - optionally index playbooks into procedural memory
   - record playbook usage in receipts

3. **Generalized content scanning**
   - extend current ingress/safety logic to doc indexing and future file/content ingestion

**Expected benefits**
- immediate improvement in “always-on personal agent” value
- lowers repeated operator explanation burden
- creates durable reusable procedures without plugin sprawl

**Dependency ordering**
- logging/correlation improvements from Phase 0 first
- recall and playbooks can proceed largely in parallel
- scanning should land before broader file/folder ingestion

**Risk level**
- **Medium**

### Phase 2: secondary improvements

**Objectives**
- add controlled autonomy and future connector readiness
- improve operator control surfaces

**Exact areas likely affected**
- `runtime-core`
- `contracts`
- `control-api`
- `web-inspector`
- `cli`
- possibly `engine-pi` for small generic support

**Work**
1. **Capability / policy profiles**
   - formalize connector/tool/memory/instruction/side-effect bundles
   - assign them to tasks and future connectors

2. **Child-run delegation**
   - explicit parent/child run lineage
   - inherited policy and budgets
   - visible receipts and cancellation

3. **Session / lineage UX**
   - sessions view in inspector
   - linked related-run navigation
   - child-run tree inspection
   - CLI recall / resume workflows

**Expected benefits**
- better decomposition for complex tasks
- safer future expansion into mail/calendar/repo access
- operator can actually manage continuity rather than merely trust it

**Dependency ordering**
- recall and playbook primitives from Phase 1 first
- profile model should exist before delegation uses it
- delegation should ship before any broad autonomous connector workflows

**Risk level**
- **Medium to High**

### Phase 3: optional / later-stage ideas

**Objectives**
- adopt only the parts of Hermes-style openness that still make sense after Popeye has matured

**Exact areas likely affected**
- maybe `engine-pi`
- maybe a future connector or local tool-bus layer
- interface layers

**Work**
- consider a narrow local-only generic tool bus if native connectors become too numerous
- consider tighter local sandboxing for risky automation
- consider optional additional operator surfaces only when justified
- optionally expose operator-approved playbook proposals rather than direct playbook mutation

**Expected benefits**
- future flexibility without early overengineering

**Dependency ordering**
- only after the core runtime/recall/playbook/profile story is solid
- should not block the real product roadmap

**Risk level**
- **High if done too early, Low if deferred until justified**

## 9. Concrete implementation guidance

### A. Introduce a `RecallService` in `runtime-core`

Create a dedicated service instead of burying this in memory search.

Likely responsibilities:
- FTS over `app.db` text-bearing artifacts
- structured result merging with `memory.db` search
- grouping by artifact type (`receipt`, `run`, `message`, `intervention`, `memory`, later `email`, `calendar`, `repo`)
- optional summarization of top hits
- provenance packaging
- budget-aware result shaping

Likely new API/contracts:
- `RecallQuery`
- `RecallHit`
- `RecallArtifactRef`
- `RecallSummary`
- `RelatedArtifactGraph`

Likely endpoints:
- `GET /v1/recall/search`
- `GET /v1/recall/:artifactType/:id`
- `GET /v1/runs/:id/related`
- `GET /v1/session-roots/:id/history`

Do **not** overload `/v1/memory/search` for this.

### B. Reinterpret Hermes skills as Popeye playbooks

Add a product-level subsystem, not a free-form plugin feature.

Likely runtime modules:
- `PlaybookService`
- `PlaybookResolver`
- `PlaybookIndexing`
- `PlaybookApprovalWorkflow`

Likely storage:
- `playbooks`
- `playbook_revisions`
- `playbook_bindings`
- `playbook_usage`

Possible binding targets:
- global
- workspace
- project
- agent profile
- task type / trigger type

Likely instruction integration:
- `packages/instructions` should compile playbook references into `CompiledInstructionBundle`
- `instruction_snapshots` should capture the resolved playbook set for auditability
- receipts should record active playbook IDs / revision IDs

Recommended operator policy:
- low-risk read-only playbooks can be activated directly
- side-effectful or sensitive playbooks require operator activation
- agent may propose playbook drafts, but not silently activate or mutate protected ones

### C. Expand `agent_profiles` into real capability profiles

Popeye already has an `agent_profiles` table and endpoint. Reuse that.

Suggested fields:
- allowed runtime tools
- allowed connector scopes
- side-effect class
- memory scopes
- instruction overlays / playbook bindings
- default session policy
- approval / intervention thresholds
- max delegation depth
- allowed child profiles

Example profiles:
- `interactive/general`
- `background/heartbeat`
- `mail/triage`
- `calendar/assistant`
- `repo/reviewer`
- `files/read_sensitive`
- `files/write_guarded`

This should become the main way future connectors are attached safely to runs.

### D. Implement delegation as parent/child runs, not hidden subagents

Add runtime-level lineage.

Likely schema additions:
- `runs.parent_run_id`
- maybe `runs.delegation_reason`
- maybe `runs.delegation_depth`
- maybe `run_lineage` if you want many-to-many lineage metadata later

Likely runtime behavior:
1. parent run requests delegation
2. runtime validates profile/policy
3. runtime creates child task/job/run (or direct child run when appropriate)
4. child gets restricted profile/tool/memory scope
5. child receipt / usage / events persist normally
6. parent receives only the summarized or selected result
7. operator can inspect/cancel child independently

Important design choice:
- budgeting should be runtime-owned, not left to the model alone
- shared iteration/token/time budgets should be enforced by runtime policy, even if pi-mono provides helper primitives

### E. Keep pi-mono generic

If Phase 2 requires engine support, keep the additions generic.

Reasonable pi-mono additions:
- fresh child session support
- generic inherited cancellation hooks
- generic custom tool restriction hooks
- generic run metadata passthrough
- better host-tool cancellation semantics

Avoid pushing these into pi-mono:
- receipts
- interventions
- playbook semantics
- connector permissions
- personal memory policy
- mail/calendar/repo logic
- operator approvals

### F. Generalize content-ingress security checks

Create a shared scanning module that can be used by:
- message ingress
- workspace doc indexing
- future permitted-file ingestion
- playbook proposal review
- mail / repo content ingestion before durable storage or prompt inclusion

Possible outputs:
- allow
- allow_with_warning
- block
- escalate_to_intervention

Always record findings in `security_audit`.

### G. Make recall and continuity visible in the interfaces

For the web inspector:
- add a Sessions / History view
- add Related Artifacts panels on runs and receipts
- show active playbooks and profile on run detail pages
- add child-run lineage trees
- show why a result was recalled (artifact + score + summary)

For CLI:
- add commands such as:
  - `pop recall search ...`
  - `pop run related <id>`
  - `pop playbook list`
  - `pop playbook diff`
  - `pop session history`
- make intervention and lineage inspection easy from the terminal

### H. Connector direction: native Popeye connectors, not borrowed Hermes gateway abstractions

For future mail/calendar/repo support, introduce native connector modules with explicit contracts, for example:
- `@popeye/mail`
- `@popeye/calendar`
- `@popeye/repo`
- `@popeye/files`

Each connector should expose runtime tools through Popeye policy, not as a generic third-party tool import mechanism.

Each connector should integrate with:
- capability profiles
- receipts
- interventions
- audit
- recall
- memory promotion rules

That is much more aligned with Popeye than importing Hermes’s broad gateway/toolset worldview.

## 10. Final verdict

### What you should definitely adopt

1. **Hermes’s separation of history recall, durable fact memory, and procedure**
2. **A session-search-like recall pattern, adapted into a stronger Popeye recall service**
3. **A procedure artifact model, adapted into operator-reviewable Popeye playbooks**
4. **Capability/policy bundles inspired by Hermes toolsets, but implemented as stricter Popeye profiles**
5. **Delegation as a product capability, but implemented through Popeye child runs**
6. **Broader content-ingress scanning before prompt inclusion or durable storage**

### What you should probably ignore

1. Hermes’s broad gateway/platform sprawl
2. agent-mutable skill/package ecosystems
3. MCP-first / dynamic third-party tool openness as an early roadmap answer
4. broad remote/container/backend execution matrix
5. two-file memory as a replacement for Popeye’s richer memory architecture
6. LLM smart approvals as a primary trust boundary
7. any drift toward “the agent loop is the product core”

### What gives the highest leverage for Popeye’s real future

The single highest-leverage translation from Hermes into Popeye is this:

> **Make Popeye excellent at continuity by cleanly separating recall, durable memory, and reusable procedure — and implement all of that inside Popeye’s existing runtime-centered architecture.**

That means:
- recall over **real operational history**
- playbooks as **reviewable reusable procedure**
- profiles as **explicit policy bundles**
- delegation as **audited child runs**

Hermes is a very useful reference implementation for the *experience* and *pattern language* of a personal agent system.

Popeye already has the better skeleton for the product you actually want:
- local-first
- operator-controlled
- durable
- auditable
- sensitive-data-ready
- maintainable over the long term

So the right move is not “make Popeye more like Hermes.”

It is:

**keep Popeye’s architecture, import Hermes’s best personal-agent patterns, and reject the parts of Hermes that would weaken Popeye’s trust boundary or bloat its scope.**
