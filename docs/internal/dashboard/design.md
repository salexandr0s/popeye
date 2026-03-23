# Popeye macOS Dashboard/Client Design

## Document purpose

This document defines the product and interaction design for Popeye’s native macOS dashboard/client. It is intentionally repo-first and control-plane-first. It does **not** invent a parallel product. It translates the current Popeye runtime, control API, CLI, and web inspector into a native operator console that fits the existing architecture.

This is a planning document for implementation. It assumes:

- Popeye remains local-first, single-operator, always-on, and operator-controlled.
- The native client stays behind the loopback control API.
- The web inspector remains the already-shipping primary GUI until the native app earns broader scope.
- The native client is a serious macOS control surface, not a consumer/mobile companion.

## Repo-truth audit findings that drive this design

### 1. True current status of the native macOS app

The native app is **not started**. `apps/macos/README.md` is a deferred placeholder, not an implementation. The repo’s current truth is that the web inspector validated the boundary first, and the native client was intentionally postponed until the product/runtime/API stabilized.

### 2. Generated Swift artifacts already present

The repo already ships generated artifacts under `generated/swift/` and `generated/json-schema/`. That matters because the native client was anticipated. However, the current generated Swift output is not implementation-grade enough to use as the view-layer model source:

- the generated Swift models are incomplete and stringly typed in places where the underlying Zod contracts are strongly typed
- the generated JSON Schema bundle appears too lossy to trust as the sole source for code generation
- the actual Zod contracts and the TypeScript API client are stronger than the current Swift codegen output

**Implication:** the app should be built against the control API boundary now, but it should not blindly consume the current generated Swift file as-is.

### 3. Is the control API already strong enough?

Yes for a **read-heavy native v1**.

The repo already has:

- a versioned loopback control API
- role-based bearer auth (`readonly`, `service`, `operator`)
- CSRF protection for mutations
- a web inspector already consuming the same boundary
- a broad TypeScript client with endpoint coverage across runtime, policy, connections, files, people, finance, medical, and more
- SSE for live update freshness

The API is strong enough to support a useful native command center today. It is **not yet pleasant enough** for broad Swift code generation without contract/codegen cleanup.

### 4. Which current web views should become native first?

The first native views should come from the most stable, most operator-critical, already-proven surfaces:

1. **Dashboard**
2. **Command Center**
3. **Runs**
4. **Run Detail**
5. **Jobs**
6. **Receipts**
7. **Receipt Detail**
8. **Interventions / Approvals**
9. **Usage + Security Summary**
10. **Connections Overview** (status-first, not full authoring)

### 5. Recommended initial native scope

**Recommendation:** start as a **read-heavy operator console with a dashboard-first entry point and command-center-first value**.

That means:

- not dashboard-only
- not full parity with the web inspector
- not a second backend
- not a configuration-heavy admin shell

The native app should open on a high-signal dashboard, but its real value is a persistent operator console for supervising live work, drilling into runs/jobs/receipts, and taking a narrow set of explicit operator actions.

### 6. Surfaces too broad or too unstable for first native release

These should **not** be first-wave native scope:

- full provider connection authoring and diagnostics workflows
- broad people merge/split/identity repair tooling
- full file root management and write-intent review queue
- finance and medical import administration
- full Todo mutation suite
- standing approval and automation grant authoring
- memory maintenance/import/promotion flows
- daemon install/start/stop/upgrade/rollback workflows
- vault lifecycle administration beyond basic read-only status
- security policy authoring

### 7. What should remain web-first for now

The following should remain web-first or CLI-first until the native client foundation is solid:

- browser-centric OAuth bootstrap flows
- deep connection remediation/resource-rule editing
- policy authoring forms
- domain-heavy admin surfaces (people/files/finance/medical/todos)
- operational packaging/upgrade/migration flows
- any workflow that currently depends more on breadth of forms than on dense supervision

### 8. Recommended app shape

**Recommendation:** a standard **windowed SwiftUI Mac app** built around a **split-view operator console**, with an optional menu bar extra later.

Not menu-bar-only.  
Not a document app.  
Not a modal wizard shell.

The right primary form is:

- sidebar navigation
- primary content pane
- detail / inspector pane for selection-driven investigation

### 9. How the dashboard should communicate intelligence, status, actionability, and control

The dashboard/home surface should always answer four questions immediately:

- **Status** — Is the daemon healthy? Is the scheduler alive? Are there active runs/jobs? Is the event stream fresh?
- **Intelligence** — What needs attention? Which runs look idle or stuck? What recently failed? Which connections are degraded?
- **Actionability** — Where should the operator go next? What can be retried, paused, resolved, or approved now?
- **Control** — Which actions are safe from native v1, and what is blocked behind operator confirmations, role checks, or web-first tooling?

### 10. Backend/contract refinements needed for a pleasant Swift build

The native app can start before these are done, but they should be planned early:

- fix the JSON Schema export so it preserves real field types
- improve Swift model generation (numbers, booleans, optionals, nested objects, enums, dates)
- add a small auth/principal introspection endpoint so the native app can display current role cleanly
- consider additive command-center summary endpoints if polling fan-out becomes noisy
- explicitly decide whether daemon lifecycle control will ever be exposed by API; current control API only exposes daemon state/scheduler reads

---

## Product role

The native app is **Popeye’s resident operator console** for macOS.

It exists to give the single operator a calm, high-density, always-available control surface for:

- watching the daemon
- understanding what the system is doing now
- drilling into what just happened
- resolving operator-blocking issues
- taking a small number of explicit, auditable actions

It is not a replacement for the runtime.  
It is not a hidden direct-db inspector.  
It is not a multi-user SaaS dashboard.  
It is not a “friendlier mobile app.”  
It is a native console for the operator of a local-first personal agent runtime.

## Who it is for

Primary user:

- the single Popeye operator running the local daemon on macOS

Secondary use cases:

- short-interval operational supervision while other work is happening
- forensic inspection of runs, receipts, and policy events
- fast intervention/approval handling
- quick health checks without opening a browser
- dense keyboard-driven investigation

It is **not** optimized for:

- casual read-only spectators
- cross-device monitoring
- remote multi-operator workflows
- consumer task management

## How it differs from the web inspector

The web inspector should remain the broadest operator GUI for now. The native app should differ by leaning into what Mac apps are best at.

### Native strengths the app should exploit

- persistent window presence
- denser tables and inspector panes
- superior keyboard navigation
- better split-view workflows
- stronger “ambient supervision” feel
- tighter local identity as the operator’s console
- eventual menu bar signal surface

### What the native app should **not** duplicate yet

- full surface parity just because the web view exists
- browser-session bootstrap mechanics
- large forms for every admin workflow
- broad provider setup/remediation flows if those are already working web-first

**Positioning:** web inspector is the broad admin UI; native is the high-signal operator console.

## Product recommendation

### Recommended framing

**Dashboard-first entry, command-center-first core value.**

Concretely:

- The app should **launch into Dashboard**.
- The operator will likely **spend most of their time in Command Center, Runs, Receipts, and Approvals**.
- Native v1 should be **read-heavy** with a **small, carefully selected mutation set**.

### Why this is the right scope

A dashboard-only app would be too shallow and not worth the maintenance cost.

A full parity app would be too broad, too easy to let drift from the API, and too likely to import web complexity into Swift before the foundation is stable.

A read-heavy operator console gives the best return because it directly matches the system’s core character:

- always-on
- auditability-first
- local operator control
- live operational state
- explicit interventions

## Design principles

1. **Operator-first, not audience-first.** Dense is acceptable when it improves clarity.
2. **Local runtime awareness over brand theater.** Show truth, not generic dashboards.
3. **Read-mostly by default.** Every mutation must feel intentional and accountable.
4. **Selection drives detail.** Avoid routing sprawl where a detail pane will do.
5. **Health and attention before configuration.** The operator should see what matters immediately.
6. **Native affordances should help focus.** Tables, split views, toolbar controls, keyboard shortcuts, inspector panes.
7. **No business logic in views.** Derived heuristics and state composition live below the view layer.
8. **Unsupported surfaces should degrade honestly.** Use “Open in Web Inspector” or “Use CLI” rather than half-implementing.

## What “dashboard” means for Popeye

In this product, “dashboard” does **not** mean a vanity metrics landing page.

It means a **situational awareness home view** showing:

- daemon health and scheduler status
- active runs/jobs/interventions
- live freshness
- recent failures / attention items
- usage / cost rollup
- connection health rollup
- links into the operator paths that matter right now

The dashboard is the home summary.  
The command center is the operational workbench.

That distinction should stay sharp.

---

## Information architecture

### Navigation groups

| Group | Screens | Purpose |
| --- | --- | --- |
| Overview | Dashboard, Command Center | High-level health, live supervision, attention routing |
| Operations | Runs, Jobs, Receipts | Core execution investigation |
| Governance | Interventions, Approvals, Usage & Security | Operator decisions, auditability, risk posture |
| Integrations | Connections | Provider health overview, browser handoff for deep setup/remediation |
| Later / optional | Instructions, Memory, People, Email, Calendar, GitHub, Todos, Finance, Medical, Files, Vaults, Policy | Broader parity surfaces after the core console is proven |

### v1 navigation order

1. Dashboard
2. Command Center
3. Runs
4. Jobs
5. Receipts
6. Interventions & Approvals
7. Connections
8. Usage & Security

This order matches priority, not backend taxonomy.

## Navigation model

### Primary container

Use a `NavigationSplitView`-style shell:

- **Sidebar:** product areas
- **Content column:** list, grid, or board view for the selected area
- **Detail/inspector column:** selected entity detail, quick actions, related context

### Rules

- Lists and tables own selection.
- Selection should persist while the view is visible.
- Detail should update in place when practical.
- Double-click may open a dedicated detail route/window later, but v1 should prefer inspector-based investigation.
- Mutation flows should use sheets/alerts only when confirmation or focused input is required.

### Toolbar model

Global toolbar items:

- connection state / live freshness
- manual refresh
- global search entry point later
- workspace filter where relevant
- density toggle where relevant
- “Open in Web Inspector” overflow for unsupported views

### Keyboard model

Native v1 should support:

- sidebar navigation shortcuts (`⌘1`, `⌘2`, etc.)
- refresh (`⌘R`)
- search/filter focus (`⌘F`)
- inspector toggle
- move selection up/down
- activate selected item
- copy IDs / CLI snippets from detail panes

---

## Primary screens and views

## 1. Connect / Bootstrap view

### Purpose

Handle first-run setup and reconnection when the app has no valid credentials or cannot reach the daemon.

### Contents

- Base URL field, defaulting to `http://127.0.0.1:3210`
- Bearer token input
- “Connect” action
- Optional “Test connection” inline feedback
- Role / permissions display once supported by API
- Help text for obtaining a token from Popeye’s operator auth tooling
- Link or instructions for opening the web inspector if needed

### Notes

- Do **not** use the browser bootstrap nonce/session-cookie flow here.
- Do **not** parse runtime databases.
- Avoid direct parsing of `auth.json` in v1 unless the repo explicitly blesses that as a stable client contract.

## 2. Dashboard (home)

### Purpose

Give the operator an immediate summary of whether Popeye is healthy and what needs attention.

### Top section: status strip

Show compact status cards for:

- Daemon health
- Scheduler state
- Running jobs
- Queued jobs
- Open interventions
- Active leases
- Total runs
- Estimated cost
- Event stream freshness

### Middle section: attention + live work

Two-column layout on wider windows:

- **Attention panel**
  - recent failures
  - open approvals
  - idle/stuck-risk runs
  - degraded connections
- **Active work panel**
  - active runs summary
  - jobs in motion
  - next heartbeat
  - recent receipts

### Lower section: context cards

- Engine capabilities summary
- Usage snapshot
- Connection health snapshot
- Security audit summary (findings count / severity summary)
- Quick links into Runs, Receipts, Approvals, Connections

### Dashboard widgets/cards for v1

- Health Card
- Scheduler Card
- Running vs Queued Card
- Open Interventions Card
- Usage Card
- Engine Capability Card
- Attention Card
- Active Runs Card
- Recent Failures Card
- Connections Health Card
- Security Findings Card

## 3. Command Center

### Purpose

Be the main operational cockpit.

This is the native surface that should most directly adapt the existing web command center into a better macOS experience.

### Layout

Three-part layout inside the main content area:

- **Summary rail** across the top
- **Operations columns** in the center:
  - Active Runs
  - Jobs in Motion
  - Attention Queue
- **Detail inspector** on the right

### Summary cards

Port the existing web command-center metrics:

- Active runs
- Queued jobs
- Blocked jobs
- Open interventions
- Estimated cost
- Recent failures

### Command-center heuristics

Preserve the existing repo-tested heuristics unless repo truth changes:

- idle hint at **10 minutes**
- stuck-risk hint at **30 minutes**
- panel freshness warning at around **20 seconds**

### Detail inspector contents

When a run is selected:

- run state and timestamps
- job/task/workspace/profile identity
- last activity time
- attention state / reason
- recent events
- receipt availability
- copyable CLI snippets
- safe run actions (later phase)

When a job is selected:

- job state, retry count, availability
- related task title
- last run reference
- related runs
- pause/resume/enqueue actions (later phase)

When an intervention is selected:

- intervention code, reason, run
- created/resolved state
- recommended next steps
- resolve action (later phase)

### Native adaptation choices

The command center should be **denser** and more keyboard-forward than the web version:

- macOS `Table`/row selection instead of card-heavy lists where that improves scanability
- persistent inspector pane rather than frequent route changes
- toolbar workspace filter
- density toggle
- copyable IDs and command snippets
- “stale” and “live” status baked into panel chrome

## 4. Runs

### Purpose

Browse and filter runs quickly.

### Main view

A sortable/filterable table with columns such as:

- state
- task title
- workspace
- profile
- started at
- finished at
- duration
- error summary

### Detail view / inspector

- run summary
- execution envelope summary
- run reply summary
- recent events
- related receipt link
- retry/cancel controls later

## 5. Run Detail

### Purpose

Full forensic view of a single run.

### Sections

- Identity and lifecycle
- Execution envelope
- Related task/job/profile/session root
- Error / terminal state
- Run reply
- Event timeline
- Related receipt summary
- Quick actions

### Important repo alignment

The execution envelope should be treated as a first-class native detail surface because it exposes effective runtime policy, capabilities, roots, warnings, and context-release posture. That is core Popeye material, not a secondary debug object.

## 6. Jobs

### Purpose

See queue health and job lifecycle.

### Main table

Columns:

- status
- task title
- workspace
- retry count
- available at
- created/updated at
- last run

### Inspector

- job state summary
- retry / backoff context
- lease info if present
- related runs / receipt
- pause/resume/enqueue actions later

## 7. Receipts

### Purpose

Browse completed work and costs.

### Main table

Columns:

- status
- summary
- workspace
- run id
- created at
- provider/model
- estimated cost

### Filters

- status
- workspace
- time range later
- text search later

## 8. Receipt Detail

### Purpose

Explain what happened, what it cost, and what execution policy was in force.

### Sections

- receipt summary/details
- usage breakdown
- runtime execution section
- context releases section
- policy/runtime timeline
- links to related run/job/task

### Why it matters natively

Receipt detail is one of the most valuable audit surfaces in Popeye. It should be a strong native view early, not an afterthought.

## 9. Interventions & Approvals

### Purpose

Show what is blocking or awaiting operator judgment.

### Structure

Use a segmented or sub-nav split between:

- Interventions
- Approvals

Standing approvals and automation grants should remain later/web-first in native v1.

### Interventions list

- code
- reason
- related run
- created at
- status

### Approvals list

- status
- scope
- domain
- action kind
- resource
- requester
- related run
- resolved by / resolved at

### Detail inspector

- full context
- decision state
- related run or receipt
- risk cues
- approve/deny or resolve actions in later phase

## 10. Connections Overview

### Purpose

Answer “are my major integrations healthy?” without importing the entire web inspector surface.

### v1 contents

- summary counts: total / healthy / degraded / disconnected
- per-connection rows:
  - provider/domain
  - status
  - enabled/disabled
  - last sync
  - health summary
- links/actions:
  - open in web inspector for deep remediation
  - reconnect / sync later only if the native scaffolding is clean

### What not to do in v1

Do not re-implement the full web connections surface immediately:
- OAuth start/poll UI
- resource rules CRUD
- secrets management UI
- detailed diagnostics form flows

## 11. Usage & Security

### Purpose

Give the operator a concise audit/risk summary.

### Sections

- usage summary
- cost totals
- security audit findings
- policy quick summary
- recent sensitive findings / redaction issues if present

This is a read-heavy page in v1.

---

## Operator workflows that matter most

These are the workflows the native app should optimize first.

### Priority 1 — live supervision

- open the app and immediately know if Popeye is healthy
- see active runs, queued jobs, blocked jobs, open interventions
- see whether live data is fresh or stale

### Priority 2 — drill into active or failed work

- select a run and inspect what is happening
- inspect run events, execution envelope, and reply/receipt
- move from job to run to receipt without losing context

### Priority 3 — resolve operator bottlenecks

- identify open interventions and approvals
- inspect context
- take a narrow set of explicit actions

### Priority 4 — connection sanity

- see whether Gmail / Calendar / GitHub / Todoist / other connections are healthy
- know when to hand off to the web inspector for deeper maintenance

### Priority 5 — cost and audit visibility

- understand estimated usage/cost
- inspect security audit findings
- connect receipts to policy/runtime context

## Workflows already in CLI/web but missing from native today

### CLI-first today

These exist operationally but should remain CLI-first until an explicit API/UI decision is made:

- daemon install/start/stop/status workflows
- upgrade verification / rollback
- migrations and repair commands
- some vault backup/restore and verification workflows

### Web-first today

These already exist in the web inspector and should remain there early:

- browser unlock/bootstrap exchange
- deep connections/OAuth/resource-rule flows
- standing approval and automation grant authoring
- full people repair tooling
- files admin and write-intent queue
- full domain vertical administration (email/calendar/github/todos/finance/medical)

---

## Dashboard widgets, cards, and panels

## v1 cards

| Card / panel | Purpose | Drill-down |
| --- | --- | --- |
| Daemon Health | Healthy/unhealthy, started time, engine kind | Dashboard only, link to Command Center |
| Scheduler | Running/stopped, next heartbeat | Command Center |
| Workload | Running, queued, blocked counts | Jobs / Runs |
| Open Interventions | Immediate operator load | Interventions |
| Usage Snapshot | Runs, tokens, estimated cost | Usage & Security / Receipts |
| Engine Capabilities | Host tools, session model, compaction support | Dashboard detail sheet later |
| Active Runs | Current execution focus | Runs / Command Center |
| Recent Failures | Surface failed runs/jobs quickly | Runs / Receipts |
| Connections Health | Healthy vs degraded connections | Connections |
| Security Findings | Count/severity overview | Usage & Security |

## Later cards

- Memory activity
- People merge suggestions
- Finance import freshness
- Medical import freshness
- File write review queue
- Vault state summary
- Calendar digest snapshot
- GitHub unread notification summary

These are later because they are useful, but not necessary to justify native v1.

---

## Drill-down patterns

### Pattern 1 — card to filtered table

Example:
- click “Open Interventions” card
- navigate to Interventions view with filter pre-applied

### Pattern 2 — list selection to inspector

Example:
- select a run row
- inspector shows envelope, events, related receipt, and actions

### Pattern 3 — cross-link context objects

Example:
- receipt detail links to run detail
- run detail links to job and task identity
- approval detail links to related run

### Pattern 4 — unsupported deep workflow handoff

Example:
- from a degraded connection row, choose “Open in Web Inspector”
- or copy a CLI command snippet if the repo already uses CLI for that workflow

### Pattern 5 — explicit mutation sheet

Example:
- approve/deny confirmation
- retry run confirmation
- resolve intervention action sheet

Mutations should feel controlled, not casual.

---

## Read vs write posture

## v1 posture

**Read-heavy with a narrow write lane.**

### Allowed in native v1 or v1.5

- refresh data
- inspect everything in scope
- cancel run
- retry run
- pause/resume/enqueue job
- resolve intervention
- approve/deny approval

### Possibly allowed later after the foundation is solid

- basic reconnect/sync actions for connections
- limited vault state actions
- low-risk domain writes already proven in web/CLI

### Explicitly not in v1

- broad CRUD across operator domains
- provider setup forms
- secrets management
- memory maintenance/import
- full files write review
- deep people record surgery
- policy authoring

Every write must show:

- target object
- action to be taken
- role requirement
- success/failure result
- refreshed post-action state

---

## Empty, loading, error, stale, and offline states

## Empty states

Every major view needs tailored empties:

- no runs yet
- no receipts yet
- no interventions
- no approvals
- no connections configured
- no security findings
- no active work

These should explain meaning, not just show blank chrome.

## Loading states

Use skeletons/placeholders at the panel level, not whole-window spinners whenever possible.

Dashboard and command center should populate progressively:
- health/status first
- then usage and connections
- then attention panels

## Error states

Differentiate these clearly:

- **daemon unreachable** — loopback API not reachable
- **unauthorized** — token invalid/expired
- **forbidden** — role lacks permission
- **transport failure** — transient network/SSE failure
- **decode/contract error** — API response shape unexpected
- **empty because unsupported** — feature intentionally not in native

## Offline / unavailable posture

“Offline” in this app means the loopback daemon/control API is unavailable.

When unreachable:
- preserve the last in-memory snapshot while clearly marking it stale
- show reconnect guidance
- avoid pretending stale data is current
- offer retry
- never silently auto-clear important operational context

## Freshness / stale state

The app should expose freshness explicitly:
- event stream connected/disconnected
- per-panel last updated time
- stale pill/banner when polling or SSE freshness slips beyond threshold

---

## Refresh and live-update behavior

## Strategy

Use **polling plus SSE**, not one or the other alone.

### Why

- Polling is simple and reliable for list/detail consistency.
- SSE provides liveness and targeted invalidation for the command center.
- The repo already uses SSE freshness for the web command center.

### Recommended behavior

- Dashboard summary polling: every 5 seconds while active
- Runs / Jobs active lists: 3–5 seconds while visible
- Receipts / usage / connections: 5–10 seconds depending on cost and visibility
- SSE connection maintained while connected to the daemon
- On relevant SSE event, mark affected views dirty and refetch targeted data

### Backgrounding

When the app is not frontmost:
- reduce polling rate
- keep lightweight health freshness if cheap
- suspend noisy view-specific polling
- reconnect SSE when returning active if needed

### Manual refresh

Always provide a manual refresh action.

---

## Layout behavior for Mac window sizes

## Small window / narrow width

- sidebar may collapse
- detail pane may move into push navigation or be hidden behind an inspector toggle
- command center should favor one main column plus a toggleable inspector

## Medium window

- sidebar + main content
- inspector optional but available
- dashboard cards wrap to two columns

## Large window

- full three-column experience
- dashboard can show multiple summary bands comfortably
- command center should keep inspector visible persistently

## Recommended minimum window size

The app should set a serious minimum size. This is not a tiny utility. A useful baseline is roughly:

- enough width for sidebar + main pane + inspector
- enough height to show at least one full summary band and one operational list without cramped scrolling

---

## Menu bar, sidebar, split-view, inspector choices

## Sidebar

Yes. The app should have a persistent sidebar.

## Split view

Yes. This is the correct primary shell.

## Inspector

Yes. Selection-driven inspector is one of the biggest advantages of native over the current web inspector.

## Menu bar extra

Not required for v1. Recommended later if and only if it adds real value:

- daemon health indicator
- active runs / interventions count
- “Open Popeye” action
- optional quick jump to command center

Do not make the product menu-bar-first.

---

## Visual tone and interaction principles

## Tone

- calm
- operational
- precise
- trustworthy
- not playful
- not enterprise-splashy

This is a console, not a marketing dashboard.

## Interaction principles

- state should be legible at a glance
- color should support meaning, not carry it alone
- badges/pills should be concise and semantically stable
- key ids and timestamps should be easy to copy
- technical language is fine when it is the repo’s real language
- avoid faux-natural-language fluff around system states

## Density

Use density intentionally:

- dashboard: moderate density
- command center: high density
- tables: compact
- detail panes: structured and scannable

---

## Native macOS affordances that should be used well

Use native affordances where they clearly improve the operator experience:

- `NavigationSplitView`
- `Table` for runs/jobs/receipts
- inspector pane
- toolbar controls
- keyboard shortcuts
- contextual menus for copy/open actions
- sheets for confirmations and focused mutations
- settings window for base URL/token/preferences
- state restoration for nav selection and panel layout

Do **not** use native affordances to justify new architecture:
- no direct SQLite browsing
- no file-based shortcuts around the API
- no hidden background manager that becomes a second backend

---

## What should intentionally NOT be in v1

- direct runtime file/db inspection
- parity with every web inspector route
- daemon install/start/stop controls unless explicit API support lands
- secrets editing
- full connection authoring/remediation
- deep policy authoring
- memory administration
- files write-intent queue management
- full people merge/split/attach/detach UI
- finance/medical import operators
- webview-embedded inspector as a shortcut to “native”
- custom design system detached from macOS conventions

---

## Final recommendation

Ship the native client as:

- a **standard macOS windowed SwiftUI app**
- with a **sidebar + content + inspector** shell
- landing on a **dashboard home**
- centered around a **command-center operational workflow**
- **read-heavy first**
- with a **small, explicit, high-value write surface**
- and with the **web inspector remaining the broader admin surface** until the native foundation proves itself

That is the most repo-aligned, implementation-friendly, and strategically sound first native scope.
