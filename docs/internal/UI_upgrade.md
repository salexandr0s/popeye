# UI Upgrade Analysis: ClawControl → Popeye macOS

**Date:** 2026-03-23
**Source:** [ClawControl](https://github.com/salexandr0s/clawcontrol) (Next.js/Electron mission control for OpenClaw)
**Target:** Popeye macOS SwiftUI operator console (`apps/macos/PopeyeMac/`)
**Classification:** New platform implementation (concepts adapted, no code ported)
**Governing rules:** CLAUDE.md §2 (non-negotiables), §4 (layering), §8 (OpenClaw rules), §17 (porting checklist)

---

## 1. Executive Summary

**ClawControl** is a 19+ screen mission control dashboard for multi-agent OpenClaw workflows. It covers workflow orchestration (kanban work orders), agent management (roster, provisioning, teams), governance (approvals, risk policies, typed confirmations), real-time visualization (crabwalk-style live view), marketplace integration (ClawHub), and extensive configuration.

**Popeye macOS** has ~10 operational views focused on execution visibility: Dashboard, Command Center, Runs, Jobs, Receipts, Interventions, Approvals, Connections, Usage/Security, and the Connect auth screen. All data flows through the control API on loopback.

**The gap** falls into two categories:

1. **Untapped API surface** — The Popeye runtime already exposes memory search, agent profiles, workspace/project management, domain-specific data (email, calendar, GitHub, todos, people, finance, medical, files), instruction previews, and standing approvals. The macOS app consumes none of these.

2. **Missing feature concepts** — ClawControl has screens for workflow management, agent roster, live visualization, chat console, cron scheduling, settings management, and a marketplace that Popeye has no equivalent for (some have API backing, some don't).

**Recommendation:** Prioritize the untapped API surface (backend-ready, low effort) before adapting ClawControl concepts (which require both design and sometimes backend work).

---

## 2. Current Popeye App State

### Existing Views (10 screens)

| Screen | Purpose | Mutations | SSE-backed |
|---|---|---|---|
| **Dashboard** | System overview — 10+ cards (health, scheduler, sessions, cost, interventions) | None | Polling |
| **Command Center** | Live operational cockpit — attention queue, active runs, jobs in motion | None | Yes |
| **Runs** | Searchable/filterable run table with inspector | Retry, Cancel | Yes |
| **Jobs** | Job table with inspector and lease details | Pause, Resume, Enqueue | Yes |
| **Receipts** | Receipt table with timeline, usage breakdown | None | Yes |
| **Interventions** | Intervention list with status filter | Resolve (with note) | Yes |
| **Approvals** | Approval list with scope and eligibility | Approve, Deny | Yes |
| **Connections** | Connection health overview | None | Yes |
| **Usage & Security** | Cost summary, security audit findings | None | No |
| **Connect** | Auth flow — URL + bearer token, Keychain storage | Auth | N/A |

### Architecture Strengths Already in Place
- `PopeyeAPI` library cleanly separated from `PopeyeMac` app
- `@Observable` stores per feature with `MutationExecutor` pattern
- `EventStreamService` + `InvalidationBus` for SSE live updates
- `ControlAPIClient` actor with CSRF handling
- Feature-based module structure ready for new screens

---

## 3. ClawControl Feature Inventory

### By Domain

**Execution & Workflow (5 screens)**
1. Dashboard — overview with work orders, approvals, activities, gateway status
2. Work Orders — kanban board with state machine transitions
3. Runs — operation execution tracking
4. Workflows — YAML workflow definition management
5. Cron — scheduled job management

**Agent & Team Management (3 screens)**
6. Agents — roster with status, capabilities, provisioning
7. Agent Templates — template definitions for agent creation
8. Live — crabwalk-style visualization of agent activity

**Governance (2 screens)**
9. Approvals — approval requests with work order associations
10. Security — security audits and compliance

**Knowledge & Data (3 screens)**
11. Memory — knowledge/memory management
12. Workspace — file browser and content management
13. Chat — operator chat console for agents

**Extensions (3 screens)**
14. Skills — skill management and assignment
15. Plugins — plugin system management
16. Models — AI model configuration and provider status

**Infrastructure (2 screens)**
17. Maintenance — gateway health and playbook execution
18. Gateway — live gateway status monitoring
19. Settings — profile, workspace config, remote access, auto-discovery
20. Usage — advanced analytics and cost tracking

---

## 4. Feature-by-Feature Analysis

### 4.1 Work Orders / Kanban Board

**ClawControl:** Kanban board with drag-drop columns (planned → active → review → blocked → shipped → archived/cancelled). Priority levels P0–P3, staleness detection, protected transitions requiring typed confirmation. State machine validation for all transitions.

**Popeye API support:** Partial. Popeye has Tasks → Jobs → Runs (a different execution model). Tasks can be created via `POST /v1/tasks`, jobs tracked via `/v1/jobs`. No kanban state machine — Popeye uses job states (queued, leased, running, paused, blocked_operator, succeeded, failed_final, cancelled).

**Effort:** High — would need a new abstraction layer or adaptation of task/job states to kanban columns.

**Recommendation: Defer.** Popeye's task→job→run model is fundamentally different from work orders. The Command Center already provides operational visibility into active work. A kanban overlay would add complexity without matching Popeye's execution semantics. Revisit only if operator workflows demand project-management-style tracking beyond what tasks provide.

---

### 4.2 Agent Roster & Management

**ClawControl:** Agent cards with avatar, status, role, station, model, WIP limit, capabilities, skills. Provision/test buttons. SOUL.md and Overlay.md file editors. Team hierarchy with delegation policies.

**Popeye API support:** Yes. `GET /v1/agent-profiles` returns `AgentProfileRecord[]` with name, description, mode, memory/recall scopes, filesystem policy. `GET /v1/profiles/:id` for detail.

**Effort:** Low–Medium — DTOs exist in the API. Need new `AgentProfileDTO`, `AgentProfilesStore`, `AgentProfilesView`, and detail inspector.

**Recommendation: Adopt (Tier 1).** Agent profiles are already served by the API. The macOS app should show who's configured, what mode they run in, and their scope. Skip ClawControl's provisioning, team hierarchy, and station concepts — those are OpenClaw-specific. Keep it read-only initially.

| Adapt from ClawControl | Omit |
|---|---|
| Card layout with name, role, status | Avatar/image management |
| Capabilities/permissions display | Station assignment UI |
| Mode indicator (restricted/interactive/elevated) | WIP limits |
| Memory/recall scope display | Team hierarchy |
| | SOUL.md/Overlay.md editors |
| | Provisioning to external gateway |

---

### 4.3 Live Visualization

**ClawControl:** "Crabwalk-style" animated visualization of gateway activity — sessions, turns, tool calls, subagent spawns, message deliveries. Real-time with node and lane components.

**Popeye API support:** Partial. `GET /v1/events/stream` (SSE) emits `run_started`, `run_state_change`, `job_state_change`, `intervention_opened`, `approval_requested`, `memory_updated`, etc. Run events (`GET /v1/runs/:id/events`) provide tool calls and state transitions within a run.

**Effort:** High — visualization is the most design-intensive feature. SwiftUI Canvas or SceneKit for animation, custom layout for session/run trees.

**Recommendation: Adapt (Tier 2).** The concept is valuable — a live activity view showing run events as they stream. But adapt heavily: instead of ClawControl's gateway-centric "crabwalk," build a run-centric timeline visualization using Popeye's SSE events. Start simple: a chronological event feed with type icons, then iterate toward a richer layout.

**Minimal viable version:** A "Live Feed" view that renders SSE events as a scrolling timeline with filtering by event type. No animation needed initially.

---

### 4.4 Chat / Operator Console

**ClawControl:** Real-time chat interface for communicating with OpenClaw agents. Uses Zustand store for chat state.

**Popeye API support:** Yes. `POST /v1/messages/ingest` accepts operator messages (source: operator). `GET /v1/messages/:id` retrieves messages. Run replies available via `GET /v1/runs/:id/reply`. Telegram relay endpoints exist for bridged messages.

**Effort:** Medium — chat UI is well-understood (message list + input), but threading, run association, and response rendering add complexity.

**Recommendation: Adapt (Tier 2).** An operator console for sending tasks and viewing responses is high-value. Adapt as a "Send Task" interface rather than a free-form chat — the operator writes a prompt, it creates a task (which may auto-enqueue), and the response appears when the run completes. This aligns with Popeye's task→job→run model rather than ClawControl's chat metaphor.

---

### 4.5 Memory Management

**ClawControl:** Knowledge/memory management interface (details limited in exploration).

**Popeye API support:** Extensive. Full memory CRUD + search:
- `GET /v1/memory/search?q=...` — hybrid FTS5 + sqlite-vec search
- `GET /v1/memory` — list with filters (type, scope, domain, tags)
- `GET /v1/memory/:id` — full record
- `GET /v1/memory/:id/describe` — summary (progressive disclosure)
- `GET /v1/memory/:id/expand` — full content
- `GET /v1/memory/:id/history` — revision history
- `POST /v1/memory/:id/pin` — protect from consolidation
- `POST /v1/memory/:id/forget` — soft delete
- `POST /v1/memory/:id/promote/propose` — promotion diff preview
- `POST /v1/memory/:id/promote/execute` — promote to curated
- `GET /v1/memory/audit` — counts by type/layer/source
- `POST /v1/memory/maintenance` — trigger consolidation

**Effort:** Low — the API is comprehensive. Need DTOs, store, and views. Search UI is the main design work.

**Recommendation: Adopt (Tier 1).** This is the highest-value untapped surface. The entire memory lifecycle is API-ready. Build:
1. Memory search view (text input → hybrid results)
2. Memory list with type/scope filters
3. Memory detail inspector (progressive disclosure: describe → expand)
4. Pin/forget mutations
5. Memory audit dashboard card
6. Promotion workflow (propose → review diff → execute)

---

### 4.6 Workflow Definitions

**ClawControl:** YAML-based workflow engine with built-in + custom workflows. Stage → operation decomposition. File editor (CodeMirror) for custom workflow YAML.

**Popeye API support:** No direct equivalent. Popeye's execution model is task→job→run, not workflow→stage→operation. No workflow definition endpoints exist.

**Effort:** High — would need backend work and a new execution model.

**Recommendation: Omit.** Popeye doesn't have a workflow engine and doesn't need one. The task→job→run model serves the single-agent execution pattern. Multi-step workflows would be a significant architectural addition that isn't justified by current operator needs. This is a ClawControl concept tied to its multi-agent team orchestration model.

---

### 4.7 Cron / Scheduling

**ClawControl:** OpenClaw cron job management UI — create, edit, enable/disable, view execution history.

**Popeye API support:** The scheduler exists (`GET /v1/daemon/scheduler`) and jobs have timing (availableAt, lease expiry), but there's no dedicated cron/recurring-task API surface yet.

**Effort:** Medium — would need backend cron endpoints before the UI can be built.

**Recommendation: Defer.** Scheduling is valuable but requires backend work first. The scheduler status is already shown on the Dashboard. When cron endpoints are added to the control API, build a simple schedule list view.

---

### 4.8 Skills Management

**ClawControl:** Skill CRUD with global/agent scope, version tracking, validation rules, installation approval gating. ClawHub marketplace integration for discovery and install.

**Popeye API support:** No skills API exists. Skills/tools are an engine-level concept (Pi layer), not runtime-managed.

**Effort:** High — would need new runtime API surface and design decisions about skill lifecycle.

**Recommendation: Omit.** Skills belong to the Pi engine layer. Exposing them through the Popeye runtime would create coupling between interface and engine. If skill management becomes needed, it should be added at the Pi layer first, then wrapped by the runtime per layering rules (CLAUDE.md §4).

---

### 4.9 Plugins

**ClawControl:** Plugin management with npm/git/local/tgz sources, health diagnostics, restart capability.

**Popeye API support:** No plugin system exists.

**Recommendation: Omit.** Popeye has no plugin architecture. This is an OpenClaw-specific extensibility pattern. Not needed.

---

### 4.10 Models / Provider Management

**ClawControl:** AI model configuration, provider authentication status, model listing from OpenClaw.

**Popeye API support:** Partial. `GET /v1/engine/capabilities` returns available models and tool info. Usage receipts include provider/model per run.

**Effort:** Low — capabilities are already fetched. Could expand the existing Dashboard card.

**Recommendation: Adopt (Tier 1).** Expand the existing engine capabilities Dashboard card into a dedicated "Models" section or inspector panel showing available models, their providers, and per-model usage statistics (aggregated from receipts).

---

### 4.11 Workspace / File Browser

**ClawControl:** File browser and workspace content management.

**Popeye API support:** Yes. `GET /v1/workspaces` and `GET /v1/projects` list configured workspaces/projects. `GET /v1/files/roots` lists registered file root paths. `GET /v1/files/documents` lists indexed documents. `GET /v1/files/search` provides full-text search.

**Effort:** Medium — workspace list is trivial, file browsing needs more UI work.

**Recommendation: Adopt workspace list (Tier 1), defer file browser (Tier 3).** A workspace/project picker is immediately useful — it scopes all other views. A full file browser is lower priority since operators interact with files through their editor, not the control app.

---

### 4.12 Settings / Configuration

**ClawControl:** Profile avatar, workspace path config, gateway URL testing, remote access toggle (local vs Tailscale), auto-discovery, version checking, power-user bypass toggle.

**Popeye API support:** Partial. The Connect screen handles URL + auth. No settings API for runtime configuration exists beyond health/status.

**Effort:** Low–Medium — expand the existing SettingsView.

**Recommendation: Adopt (Tier 1).** The existing Connect screen is minimal. Add:
- Connection diagnostics (test endpoint, latency)
- Version display (daemon version from status)
- Workspace selector (from `/v1/workspaces`)
- About/credits section
- Keyboard shortcut reference

Skip: avatar management, remote access toggle (Popeye is loopback-only in v1), auto-discovery (Popeye doesn't scan for installations).

---

### 4.13 Maintenance / Health

**ClawControl:** Gateway health monitoring, error notification, playbook management with severity levels.

**Popeye API support:** `GET /v1/health`, `GET /v1/status`, `GET /v1/daemon/state`, `POST /v1/security/audit`. No playbook concept.

**Effort:** Low — data is already used on Dashboard. Could be expanded.

**Recommendation: Adapt (Tier 2).** Create a "System Health" detail view accessible from the Dashboard health card. Show:
- Daemon state details (workers, last tick, last sweep)
- Engine capabilities and warnings
- Security audit findings (expanded from Usage/Security)
- Historical uptime (if tracked)

Skip: playbook execution (Popeye doesn't have playbooks).

---

### 4.14 Gateway Live Status

**ClawControl:** Dedicated gateway status page with real-time probe results, latency, connection state.

**Popeye API support:** `GET /v1/health` returns basic status.

**Recommendation: Omit.** Popeye is loopback-only — there's no remote gateway to monitor. The Dashboard health card is sufficient.

---

### 4.15 Agent Templates

**ClawControl:** Template definitions for creating agents with preset configurations.

**Popeye API support:** No template API. Agent profiles serve a similar purpose.

**Recommendation: Omit.** Agent profiles already capture the configuration. Templates are an OpenClaw provisioning concept.

---

### 4.16 Usage Analytics

**ClawControl:** Advanced analytics dashboard with daily rollups, session usage aggregation, tool invocation tracking, error signature aggregation.

**Popeye API support:** Yes. `GET /v1/usage/summary` returns aggregate cost/token data. Each receipt has `UsageMetrics` (provider, model, tokensIn, tokensOut, estimatedCostUsd). Historical data available through receipt queries.

**Effort:** Medium — need charting/visualization. SwiftUI Charts framework available on macOS 14+.

**Recommendation: Adopt (Tier 1).** Expand the existing Usage/Security view into a dedicated Usage screen with:
- Daily/weekly cost trends (SwiftUI Charts)
- Token usage by model
- Run count by outcome (succeeded/failed/cancelled)
- Most expensive runs (top-N by cost)
- Provider breakdown

This is high-value for operational awareness and cost control.

---

### 4.17 Marketplace (ClawHub)

**ClawControl:** Skill marketplace with install, uninstall, versioning, scanning, package artifacts.

**Recommendation: Omit.** Popeye has no marketplace. This is an OpenClaw ecosystem feature with no equivalent need.

---

## 5. Untapped API Surface (Backend-Ready, No ClawControl Needed)

These Popeye API endpoints have no macOS app UI yet. They are the easiest wins since they require only frontend work.

### 5.1 Domain-Specific Data (Personal Assistant Surface)

| Domain | Key Endpoints | UI Concept |
|---|---|---|
| **Email** | `/v1/email/threads`, `/v1/email/search`, `/v1/email/digest` | Inbox view, thread inspector, daily digest card |
| **Calendar** | `/v1/calendar/events`, `/v1/calendar/availability`, `/v1/calendar/digest` | Calendar view, event list, upcoming card |
| **GitHub** | `/v1/github/pulls`, `/v1/github/issues`, `/v1/github/digest` | PR list, issue tracker, activity digest card |
| **Todos** | `/v1/todos/items`, `/v1/todos/projects`, `/v1/todos/digest` | Todo list with project grouping, completion actions |
| **People** | `/v1/people`, `/v1/people/search`, `/v1/people/:id/activity` | Contact directory, search, activity timeline |
| **Finance** | `/v1/finance/transactions`, `/v1/finance/digest` | Transaction list, spending summary |
| **Medical** | `/v1/medical/appointments`, `/v1/medical/medications` | Appointment list, medication tracker |
| **Files** | `/v1/files/documents`, `/v1/files/search` | Document search, file index |

**Effort per domain:** Low–Medium (DTOs + store + list/detail views). These follow the same pattern as existing Runs/Jobs/Receipts views.

**Recommendation:** These are a separate product surface (personal assistant) vs. the operational console. Group them under a "Life" or "Personal" navigation section. Implement incrementally — start with the domains the operator actually uses.

### 5.2 Memory System

Already covered in §4.5. Full API exists, no UI.

### 5.3 Agent Profiles

Already covered in §4.2. API exists via `/v1/agent-profiles` and `/v1/profiles`.

### 5.4 Instruction Previews

**Endpoint:** `GET /v1/instruction-previews/:scope`
**Shows:** Resolved WORKSPACE.md, PROJECT.md, IDENTITY.md, task-specific overlays.
**UI concept:** A "Context Preview" inspector that shows what instructions an agent sees for a given workspace/project. Valuable for debugging unexpected agent behavior.
**Effort:** Low — single API call, rendered as markdown.

### 5.5 Standing Approvals & Policy Grants

**Endpoints:** `POST /v1/standing-approvals`, `POST /v1/policy/grants`, `POST /v1/policy/revoke`, `GET /v1/security/policy`
**UI concept:** A "Policy" section showing active standing approvals, domain policies, and the ability to grant/revoke automation permissions.
**Effort:** Low–Medium.

### 5.6 Message History

**Endpoints:** `GET /v1/messages/:id`, `POST /v1/messages/ingest`
**UI concept:** Message log showing ingested messages (from Telegram, API, operator) with associated run outcomes.
**Effort:** Low.

---

## 6. Priority Tiers

### Tier 1 — High Value, API-Ready (implement next)

| Feature | Source | Effort | Justification |
|---|---|---|---|
| **Memory Search & Management** | Popeye API | Low | Full lifecycle API exists. Highest untapped value. |
| **Usage Analytics (expanded)** | ClawControl concept + Popeye API | Medium | Cost visibility is critical for operations. SwiftUI Charts. |
| **Agent Profiles (read-only)** | ClawControl concept + Popeye API | Low | API exists. Operators need to see who's configured. |
| **Workspace/Project Selector** | Popeye API | Low | Scopes all other views. Foundation for multi-workspace. |
| **Settings (expanded)** | ClawControl concept | Low | Connection diagnostics, version info, workspace picker. |
| **Models / Capabilities (expanded)** | ClawControl concept + Popeye API | Low | Expand existing Dashboard card. |
| **Instruction Preview** | Popeye API | Low | Debug tool for agent context. Single API call. |
| **Memory Audit (Dashboard card)** | Popeye API | Low | `GET /v1/memory/audit` → new Dashboard card. |

**Estimated scope:** 8 features, mostly Low effort. ~6–8 new views/inspectors, ~8 new DTOs, ~6 new stores.

### Tier 2 — High Value, Needs Adaptation (next phase)

| Feature | Source | Effort | Justification |
|---|---|---|---|
| **Live Event Feed** | ClawControl concept (adapted) | Medium | SSE events as scrolling timeline. Simpler than crabwalk. |
| **Operator Console (Send Task)** | ClawControl concept (adapted) | Medium | Prompt input → task creation → response display. |
| **System Health Detail** | ClawControl concept | Low–Med | Expanded health view from Dashboard card. |
| **Standing Approvals / Policy** | Popeye API | Medium | Policy management UI for automation grants. |
| **Message History** | Popeye API | Low–Med | Log of ingested messages with run associations. |

**Estimated scope:** 5 features, Medium effort. New navigation section or expanded existing views.

### Tier 3 — Medium Value, Future Scope

| Feature | Source | Effort | Justification |
|---|---|---|---|
| **Domain dashboards (email, calendar, etc.)** | Popeye API | Medium each | Personal assistant surface. Implement per domain as needed. |
| **File browser** | ClawControl concept + Popeye API | Medium | File index and search. Lower priority than memory. |
| **Cron / Scheduling UI** | ClawControl concept | Medium | Needs backend cron API first. |

### Tier 4 — Omit

| Feature | Reason |
|---|---|
| **Work Orders / Kanban** | Different execution model. Command Center covers operational visibility. |
| **Workflow Definitions** | No workflow engine. Task→job→run model suffices. |
| **Skills Management** | Pi engine layer concern. Would violate layering rules. |
| **Plugins** | No plugin architecture exists. |
| **Agent Templates** | Agent profiles serve this purpose. |
| **Marketplace (ClawHub)** | No marketplace. OpenClaw ecosystem feature. |
| **Gateway Live Status** | Loopback-only in v1. Dashboard health card suffices. |
| **Team Hierarchy** | OpenClaw multi-agent concept. Popeye has profiles, not teams. |
| **Playbook Execution** | No playbook system. |

---

## 7. SwiftUI Implementation Notes

### Pattern Translations from ClawControl

| ClawControl (Web) | Popeye macOS (SwiftUI) | Notes |
|---|---|---|
| Zustand stores | `@Observable` classes | Already established pattern in PopeyeMac |
| React Context | SwiftUI `@Environment` | For layout state, workspace scope |
| SSE with EventSource | `EventStreamService` (AsyncStream) | Already implemented |
| Kanban drag-drop | `Table` with custom columns | Or `LazyVGrid` if visual kanban needed |
| CodeMirror editor | `TextEditor` or `NSTextView` wrapper | For markdown/YAML editing |
| React Markdown | `AttributedString` or `MarkdownUI` package | For rendering memory content, instruction previews |
| Tailwind CSS | SwiftUI modifiers + design tokens | Use Apple HIG spacing/colors |
| Next.js API routes | `ControlAPIClient` endpoints | Already established |
| localStorage | `UserDefaults` / `@AppStorage` | Already used for route persistence |
| Server components | N/A | No equivalent needed in native app |
| Protected action modal | `ConfirmationSheet` | Already implemented |
| SSE keepalive (30s) | `URLSession` stream with heartbeat | Already handled in `EventStreamService` |

### New SwiftUI Capabilities to Leverage

- **SwiftUI Charts** (macOS 14+) — For usage analytics, cost trends, token breakdown
- **Searchable modifier** — For memory search, contact search, file search
- **NavigationSplitView 3-column** — For domain screens (list → detail → inspector)
- **Swift Data** (optional) — For client-side caching of memory/domain data
- **Markdown rendering** — `Text` supports AttributedString with markdown

### Recommended New Navigation Structure

```
Sidebar
├── Overview
│   ├── Dashboard          (existing)
│   ├── Command Center     (existing)
│   └── Live Feed          (new — Tier 2)
├── Operations
│   ├── Runs               (existing)
│   ├── Jobs               (existing)
│   ├── Receipts           (existing)
│   └── Message History    (new — Tier 2)
├── Governance
│   ├── Interventions      (existing)
│   ├── Approvals          (existing)
│   └── Policy & Grants    (new — Tier 2)
├── Knowledge
│   ├── Memory             (new — Tier 1)
│   ├── Instruction Preview(new — Tier 1)
│   └── Files              (future — Tier 3)
├── Platform
│   ├── Agent Profiles     (new — Tier 1)
│   ├── Models             (new — Tier 1)
│   ├── Connections        (existing)
│   └── System Health      (new — Tier 2)
├── Usage                  (existing, expanded — Tier 1)
├── Life (optional)
│   ├── Email              (future — Tier 3)
│   ├── Calendar           (future — Tier 3)
│   ├── Todos              (future — Tier 3)
│   ├── GitHub             (future — Tier 3)
│   ├── People             (future — Tier 3)
│   └── Finance            (future — Tier 3)
└── Settings               (existing, expanded — Tier 1)
```

---

## 8. Maintenance & Usage Considerations

### Per-Tier Maintenance Impact

**Tier 1 (8 features):**
- **Code added:** ~15 new files (DTOs, stores, views, services)
- **API coupling:** All endpoints already exist and are stable
- **Test burden:** DTO decoding tests (fixture-based, low effort). Store tests for new mutation patterns.
- **Maintenance:** Low — read-heavy views over stable APIs. Memory search is the most complex (hybrid results rendering).
- **Risk:** Minimal — no backend changes needed. Views follow established patterns.

**Tier 2 (5 features):**
- **Code added:** ~12 new files
- **API coupling:** Mostly stable. Live Feed depends on SSE event schema stability. Operator Console introduces a new write path (task creation → run monitoring).
- **Test burden:** Medium — Operator Console needs integration testing for the create-task → monitor-run flow.
- **Maintenance:** Medium — Live Feed needs SSE reconnection handling. Operator Console needs response rendering.
- **Risk:** Moderate — Live Feed may need iteration on UX. Operator Console changes the app from read-heavy to interactive.

**Tier 3 (domain dashboards):**
- **Code added:** ~6–8 files per domain
- **API coupling:** Domain APIs may still be evolving
- **Test burden:** Low per domain (same list/detail pattern)
- **Maintenance:** Scales linearly with domains added. Each domain is independent.
- **Risk:** API stability — domain endpoints may not be finalized. Implement only for domains actively in use.

### Usage Patterns to Design For

| Pattern | Example | Design Implication |
|---|---|---|
| **Glance check** | "Is everything healthy?" | Dashboard cards must answer in <1 second |
| **Investigation** | "Why did run X fail?" | Inspector drill-down must be fast (detail on selection) |
| **Search** | "What do I know about auth decisions?" | Memory search must feel instant (<200ms target) |
| **Action** | "Approve this" / "Cancel that run" | Mutations need confirmation + toast feedback (already have this) |
| **Monitoring** | "What's happening right now?" | Live Feed / Command Center with SSE auto-refresh |
| **Cost review** | "How much did this week cost?" | Usage analytics with date range selection |

### Deprecation / Removal Candidates

None. All existing views remain valuable. The upgrade is additive.

---

## 9. Porting Decision Records (Summary)

Per CLAUDE.md §17, each candidate from ClawControl:

| Candidate | Need Now? | Pi Equivalent? | Thin Slice? | Rewrite Cleaner? | Decision |
|---|---|---|---|---|---|
| Kanban/Work Orders | No | N/A | No | N/A | **Omit** — different execution model |
| Agent Roster | Yes | Profiles API | Yes — read-only list | Yes | **Adopt** — thin read-only view |
| Live Visualization | Yes | SSE events | Yes — event feed | Yes | **Adapt** — simpler timeline, not crabwalk |
| Chat Console | Yes | Message ingest API | Yes — task creation | Yes | **Adapt** — as "Send Task" not chat |
| Memory UI | Yes | Full memory API | Yes — search + list | N/A | **Adopt** — API-ready |
| Workflow Definitions | No | N/A | No | N/A | **Omit** — no workflow engine |
| Cron Scheduling | Later | Scheduler exists | Yes — schedule list | N/A | **Defer** — needs backend API |
| Skills | No | Pi layer | No | N/A | **Omit** — layering violation |
| Plugins | No | None | No | N/A | **Omit** — no architecture |
| Models | Yes | Capabilities API | Yes — expand card | N/A | **Adopt** — low effort |
| File Browser | Later | Files API | Yes — search view | N/A | **Defer** — lower priority |
| Settings | Yes | Partial | Yes — expand existing | N/A | **Adopt** — low effort |
| Maintenance/Health | Yes | Health/status API | Yes — detail view | N/A | **Adapt** — expand Dashboard |
| Gateway Live | No | Loopback only | N/A | N/A | **Omit** — not applicable |
| Agent Templates | No | Profiles serve this | N/A | N/A | **Omit** — redundant |
| Usage Analytics | Yes | Usage/receipt API | Yes — charts | Yes | **Adopt** — high value |
| Marketplace | No | None | No | N/A | **Omit** — no ecosystem |

---

## 10. Next Steps

1. **Tier 1 implementation** — Start with Memory Search (highest value, API-ready) and Usage Analytics expansion (cost visibility)
2. **DTO scaffolding** — Add `MemoryRecordDTO`, `MemorySearchResultDTO`, `AgentProfileDTO`, `WorkspaceDTO`, `ProjectDTO` to PopeyeAPI
3. **Navigation restructure** — Adopt the expanded sidebar structure from §7 to accommodate new sections
4. **Tier 2 planning** — Design the Live Feed and Operator Console after Tier 1 ships
5. **Domain dashboards** — Evaluate which personal-assistant domains are actively used before building UI
