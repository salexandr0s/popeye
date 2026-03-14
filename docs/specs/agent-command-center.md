# Agent Command Center

- Status: Proposed
- Date: 2026-03-14

## Problem statement

`tmux` grids are useful for raw parallelism, but they are poor at operator visibility. Popeye needs a maximizable, monitor-friendly command center for supervising multiple active agents, spotting idle/stuck work, opening related tools quickly, and understanding runtime usage without dropping into several terminals.

## Classification

- Layer: Interface
- Provenance: New platform implementation
- Scope: Feature
- Security impact: Indirect; the UI must continue to use only the control API and must not bypass auth/CSRF/token rules.
- Memory impact: None directly, except surfacing existing memory-related views/actions through the UI.

## Goals

- Provide a single “agent command center” view optimized for one full monitor.
- Show live status of active/queued/idle/stuck work across runs and jobs.
- Let operators show/hide detail panes and quickly open related tools/views.
- Surface high-value operational stats: usage, receipts, failures, interventions.
- Preserve Popeye’s boundary rule: interface only, control API only.

## Non-goals

- No direct terminal multiplexing inside the runtime.
- No multi-user remote collaboration in v1.
- No new channel/gateway abstraction.
- No direct SQLite/session-file reads from the UI.
- No speculative workflow automation beyond existing runtime actions.

## Personas

### Primary: Operator

Runs Popeye locally, supervises multiple active jobs/runs, and wants fast situational awareness.

### Secondary: Power user

Uses multiple monitors, wants a persistent command-center layout, and frequently pivots between runs, jobs, receipts, and memory.

## Primary user journeys

1. Operator opens the command center and immediately sees what is running, blocked, idle, or failed.
2. Operator notices an idle or stuck-looking agent and drills into the run, events, receipt, or intervention.
3. Operator wants to open a related tool quickly: run detail, jobs list, receipts, memory, or a local terminal.
4. Operator wants to hide noisy panes and focus one monitor on a single workspace’s active work.
5. Operator wants a quick usage snapshot to understand token/cost burn during active supervision.

## Functional requirements

### F1. Command center route and layout

- MUST add a dedicated command-center route in the web inspector.
- MUST support a full-monitor layout with resizable/toggleable panels.
- MUST persist panel visibility and layout locally in the browser.
- SHOULD support “focus mode” that hides secondary panels.

### F2. Active work overview

- MUST show active runs, queued jobs, paused jobs, blocked jobs, and recent terminal outcomes.
- MUST visually distinguish running, waiting, blocked, failed, cancelled, and idle states.
- MUST support filtering by workspace.
- SHOULD support sorting by recency, state, and workspace.

### F3. Idle/stuck detection

- MUST flag candidates for operator attention using existing runtime data only.
- MUST show “idle” when no new run events arrive for a configurable UI threshold.
- MUST show “stuck-risk” when a run remains active without event progress longer than a higher threshold.
- MUST present these as operator hints, not authoritative runtime states.

### F4. Detail panes

- MUST allow opening a selected item’s related detail pane without leaving the command center.
- MUST support at least: run details/events, job status, receipt summary, intervention summary, and memory search shortcut.
- SHOULD allow opening the existing full-page route for any selected resource.

### F5. Related tools

- MUST provide quick actions to open related Popeye views.
- SHOULD provide a configurable external terminal command launcher for a selected workspace/project.
- COULD support opening multiple detached detail windows/tabs.

### F6. Usage and stats

- MUST show aggregate usage summary from the control API.
- MUST show counts for active runs, queued jobs, blocked jobs, open interventions, and recent failures.
- SHOULD show lightweight trend cards for recent run outcomes and token/cost burn.

### F7. Refresh and liveliness

- MUST use the control API only.
- MUST prefer SSE where available and fall back to polling for summary cards/lists.
- MUST indicate stale/disconnected UI state clearly.

## Non-functional requirements

### Performance

- MUST render an initial useful view in under 1 second on a typical local dataset.
- MUST update live state without forcing full-page re-render churn.
- SHOULD keep command-center refresh overhead low enough for continuous use on a laptop.

### Reliability

- MUST degrade gracefully when SSE disconnects.
- MUST preserve last-known state during transient refresh failures.

### Accessibility

- MUST support keyboard navigation for major panes and lists.
- MUST preserve color-independent status meaning.

### Observability

- MUST log UI fetch/SSE failures in browser-visible diagnostics.
- SHOULD expose a lightweight “last updated” indicator per panel.

## Data and security requirements

- No new PII model beyond existing run/task/message data.
- MUST use daemon-served auth token flow already defined for the web inspector.
- MUST use only `/v1/*` control API routes.
- MUST not store secrets in browser local storage.
- MUST keep any persisted layout data local and non-sensitive.

## Required API/data contracts

The first slice SHOULD compose existing endpoints:

- `GET /v1/status`
- `GET /v1/daemon/scheduler`
- `GET /v1/runs`
- `GET /v1/jobs`
- `GET /v1/interventions`
- `GET /v1/usage/summary`
- `GET /v1/events/stream`

### Recommended additive API follow-ups

These are not required for the first UI slice, but SHOULD be considered if the command center becomes heavy:

1. `GET /v1/command-center/summary`
   - Returns pre-aggregated counts and freshness timestamps.
2. `GET /v1/runs/active`
   - Returns only active/non-terminal runs for cheaper rendering.
3. `GET /v1/jobs/active`
   - Returns queued/leased/running/waiting-retry/blocked jobs only.

If added, they MUST be versioned under `/v1/*`, Zod-defined in `@popeye/contracts`, and covered by contract tests.

## Rollout plan

### Phase 1: Read-only command center

- New `/command-center` route
- Summary cards
- Active runs/jobs lists
- Panel toggles
- SSE-backed freshness

### Phase 2: Drill-down workflow

- Embedded detail panes
- Quick-open links to existing views
- Idle/stuck-risk hints

Implementation note:

- Delivered with existing `/v1/*` endpoints. Run freshness now uses persisted run events plus SSE activity envelopes; no additive control API was required for this slice.

### Phase 3: Tooling shortcuts

- External terminal launcher configuration
- Multi-monitor/focus-mode refinements

Implementation note:

- This slice intentionally stops short of OS terminal launching. The inspector provides copyable `pop` command snippets and quick-open route shortcuts instead, which keeps terminal workflows inside current security and browser boundaries.

## Epics and stories

### Epic 1: Command-center shell

#### Story 1.1

As an operator, I want a dedicated command-center view, so that I can supervise Popeye from a single full-screen workspace.

Acceptance criteria:

- Given the web inspector is running, when I navigate to `/command-center`, then I see a dedicated command-center layout.
- Given I hide or show panes, when I refresh the page, then my layout choices persist locally.
- Given the command center is active, when no data has loaded yet, then I see loading states rather than a blank screen.

Definition of Done:

- [ ] Route added
- [ ] Layout state persisted
- [ ] UI tests added
- [ ] Docs updated
- [ ] Review completed

#### Story 1.2

As an operator, I want summary cards for key runtime counts, so that I can assess system state at a glance.

Acceptance criteria:

- Given the command center loads, when API responses succeed, then I see active runs, queued jobs, blocked jobs, open interventions, and usage summary.
- Given data refresh fails, when cards become stale, then the UI marks them as stale.

Definition of Done:

- [ ] Summary cards implemented
- [ ] API hooks tested
- [ ] Empty/error states added
- [ ] Docs updated

### Epic 2: Active agent supervision

#### Story 2.1

As an operator, I want active runs and jobs listed together, so that I can see what needs attention.

Acceptance criteria:

- Given active or queued work exists, when I open the command center, then I see lists grouped or filterable by state.
- Given multiple workspaces exist, when I apply a workspace filter, then only matching items remain visible.

Definition of Done:

- [ ] Lists implemented
- [ ] Workspace filter implemented
- [ ] Tests for filtering/sorting added
- [ ] Docs updated

#### Story 2.2

As an operator, I want idle/stuck-risk hints, so that I can notice silent failures or long pauses quickly.

Acceptance criteria:

- Given a run has no new events for longer than the idle threshold, when I view it in the command center, then it is marked idle.
- Given a run exceeds the stuck-risk threshold, when I view it, then it is marked stuck-risk.
- Given the mark is shown, when I inspect it, then the UI explains it is a heuristic.

Definition of Done:

- [ ] Heuristic rules implemented in UI
- [ ] Thresholds configurable in UI constants/settings
- [ ] Tests added
- [ ] Copy reviewed for clarity

### Epic 3: Drill-down and tools

#### Story 3.1

As an operator, I want inline detail panes, so that I can inspect related run/job/receipt data without losing context.

Acceptance criteria:

- Given I select a run, when the detail pane opens, then I can see run details and recent events.
- Given I select a job or intervention, when the detail pane opens, then I can inspect its relevant metadata.
- Given I want full detail, when I use quick-open, then I navigate to the existing dedicated route.

Definition of Done:

- [ ] Detail panes implemented
- [ ] Quick-open actions wired
- [ ] Tests added
- [ ] Docs updated

#### Story 3.2

As a power user, I want related tool shortcuts, so that I can pivot quickly from supervision to action.

Acceptance criteria:

- Given a selected resource, when I open quick actions, then I can navigate to related Popeye views.
- Given terminal integration is configured, when I choose “Open Terminal,” then the configured external terminal command is invoked for the relevant workspace/project context.

Definition of Done:

- [ ] Quick actions implemented
- [ ] Terminal integration guarded behind config
- [ ] Security review completed
- [ ] Docs/runbook updated

## Minimal Definition of Done for the feature

- [ ] Interface-only implementation; no runtime internals read directly
- [ ] Control API dependencies documented
- [ ] Tests added for routing, loading, empty, error, and live-update states
- [ ] Security review confirms auth token flow unchanged
- [ ] `dev-verify:quick` passes
- [ ] UI docs updated

## Recommended next implementation slice

Build Phase 1 only:

1. Add `/command-center`
2. Reuse existing API hooks/endpoints
3. Add summary cards + active runs/jobs panes
4. Add local panel visibility persistence
5. Add stale/idle indicators as UI-only heuristics

That is the smallest useful slice with low architecture risk.
