# Popeye macOS Dashboard/Client Build Plan

## Purpose

This document defines the phased implementation plan for Popeye’s native macOS dashboard/client.

It assumes the design and architecture documents in this folder are the source of truth for scope and structure. The plan is explicitly incremental and non-destructive: every phase should leave the repo in a working state without forcing broad rewrites later.

---

## Scope recommendation summary

### What should be built first

Build a **read-heavy native operator console** with:

- connect/bootstrap flow
- dashboard home
- command-center-grade live operational visibility
- runs/jobs/receipts investigation
- interventions/approvals visibility
- a small set of explicit operator mutations later

### What should not be built first

Do not begin with:

- full parity with every web inspector route
- provider setup/OAuth wizardry
- daemon lifecycle controls without explicit API support
- deep admin CRUD across every domain surface
- a giant generalized Swift codegen project before the first useful views exist

---

## Workstream principles

1. **Start with a vertical slice that proves the boundary.**
2. **Preserve the control API as the sole runtime boundary.**
3. **Use hand-authored DTOs for the first subset; do not block on fixing global Swift codegen.**
4. **Keep the app useful at the end of every phase.**
5. **Defer wide write surfaces until read paths are stable.**
6. **Prefer additive backend refinements over client-side hacks.**
7. **Treat the web inspector as the parity reference, not the implementation pattern to copy blindly.**

---

## Suggested repo/app structure target

Target layout during implementation:

```text
apps/macos/
  README.md
  PopeyeMac.xcodeproj/
  PopeyeMac/
    App/
    Core/
      API/
      Auth/
      LiveUpdates/
      Services/
      Diagnostics/
      Formatting/
      PreviewSupport/
    Features/
      Connect/
      Dashboard/
      CommandCenter/
      Runs/
      Jobs/
      Receipts/
      Interventions/
      Approvals/
      Connections/
      UsageSecurity/
      Shared/
  PopeyeMacTests/
  PopeyeMacUITests/
```

This should be introduced gradually, not all at once.

---

## What to prototype first

Before any broad feature work, prototype these three things together:

1. **Connect screen** with token/base URL storage
2. **Dashboard snapshot service** calling real loopback endpoints
3. **Command-center list/inspector layout** fed by fixtures

Why this prototype first:

- it proves the auth boundary
- it proves the control API is comfortable from Swift
- it proves the chosen Mac layout is worth the native investment

---

## What must be stabilized before broad UI expansion

These items do **not** all block Phase 1, but they should be resolved before late Phase 3 / Phase 4 expansion:

- final decision on token bootstrap UX
- auth-role introspection strategy
- ATS/local-network app configuration
- decode strategy for dates and additive payloads
- decision on whether to add command-center summary endpoints
- written decision on daemon lifecycle controls (API later vs web/CLI only)
- direction for generated Swift models / schema export repair

---

## Phase 0 — repo audit and client-boundary verification

## Objective

Confirm the exact current truth of the repo and remove ambiguity before Swift implementation starts.

## Deliverables

- this `docs/macos-dashboard/` planning set
- explicit decision that native uses control API only
- explicit decision on initial scope
- endpoint shortlist for native v1
- codegen/generation risk called out
- discrepancy log for historical docs vs current code

## Concrete tasks

### Repo truth verification

- inspect `README.md`, `architecture.md`, `buildplan.md`, `agents.md`, `KICKOFF.md`, `open_questions.md`, `known_bugs.md`
- inspect canonical docs (`control-api`, `api-contracts`, `ui-surface`, `domain-model`, `memory-model`, `session-model`, `instruction-resolution`, etc.)
- inspect `apps/macos/README.md`
- inspect `apps/web-inspector`
- inspect `packages/control-api`, `packages/api-client`, `packages/contracts`, `packages/runtime-core`
- inspect generated Swift / schema artifacts

### Resolve key planning questions

- confirm that the current native app is still deferred / unimplemented
- confirm browser-session auth is web-specific
- confirm control API bearer+CSRF flow for native
- confirm which endpoints are read-only/service/operator
- confirm command-center heuristics and data sources
- confirm which web views are stable enough to port first

### Produce decisions

- v1 is dashboard-first entry + read-heavy operator console
- native uses no direct SQLite/file truth
- current generated Swift models are not the primary v1 model layer
- web remains the broader admin surface initially

## File/folder targets

No app code required in this phase.  
Primary outputs live under:

- `docs/macos-dashboard/design.md`
- `docs/macos-dashboard/architecture.md`
- `docs/macos-dashboard/buildplan.md`
- `docs/macos-dashboard/api_surface_map.md`
- `docs/macos-dashboard/component_inventory.md`
- `docs/macos-dashboard/checklist.md`
- `docs/macos-dashboard/open_questions.md`
- `docs/macos-dashboard/agent_prompt.md`

## Acceptance criteria

- planning docs exist and are implementation-grade
- current native status is documented accurately
- initial scope is explicitly recommended, not left ambiguous
- unsupported/non-v1 surfaces are named explicitly
- required backend refinements are tracked

## Verification

- manual review against repo files
- cross-check docs against code, not docs against docs only

---

## Phase 1 — native app shell and API client foundation

## Objective

Create a bootable macOS app shell that can authenticate to the loopback control API and render real data without architectural drift.

## Milestone outcome

A developer can launch a real SwiftUI app, connect it to a local Popeye daemon with a bearer token, and see a working dashboard backed by live API calls.

## Concrete tasks

### App target and shell

- create `apps/macos/PopeyeMac.xcodeproj`
- add app target, unit-test target, UI-test target
- add `PopeyeMacApp.swift`
- add root split-view shell with placeholder sidebar items
- add settings scene for base URL/token/preferences

### Auth/bootstrap

- implement `CredentialStore` using Keychain for token and app prefs for base URL
- implement connect/bootstrap screen
- validate base URL/token with `GET /v1/health` and `GET /v1/status`
- handle invalid token / unreachable daemon states clearly
- add explicit sign-out / replace-token path

### Low-level API client

- implement `ControlAPIClient`
- implement JSON decoder/encoder conventions
- implement CSRF fetch/cache for mutations
- implement normalized error type
- implement request diagnostics capture

### First DTO subset

Hand-author DTOs for:
- health
- status
- scheduler status
- engine capabilities
- usage summary
- security audit summary (if included in dashboard)
- connection summary/list (if included in early dashboard)

### Preview/mocking foundation

- add mock services
- add fixture JSON for system endpoints
- make dashboard previewable without a daemon

### App infrastructure

- add refresh command
- add shared formatters
- add connection status banner pattern
- add minimal tests around auth storage and client request building

## File/folder targets

Create:

- `apps/macos/PopeyeMac/App/*`
- `apps/macos/PopeyeMac/Core/API/*`
- `apps/macos/PopeyeMac/Core/Auth/*`
- `apps/macos/PopeyeMac/Core/Diagnostics/*`
- `apps/macos/PopeyeMac/Core/Formatting/*`
- `apps/macos/PopeyeMac/Core/PreviewSupport/*`
- `apps/macos/PopeyeMac/Features/Connect/*`
- `apps/macos/PopeyeMac/Features/Shared/*`
- `apps/macos/PopeyeMacTests/*`
- `apps/macos/PopeyeMacUITests/*`

## Dependencies

Requires Phase 0 decisions. Does **not** require:
- command center summary endpoint
- write-path support
- fixed global Swift codegen

## Acceptance criteria

- app launches
- operator can enter base URL/token and connect
- dashboard can load from live daemon
- auth failures and daemon-unavailable states are clear
- no direct runtime file/db access exists
- tests cover request auth/CSRF behavior

## Verification

### Automated

- unit tests for `ControlAPIClient`
- unit tests for `CredentialStore`
- UI smoke test for bootstrap flow

### Manual

- connect to a running local daemon
- disconnect daemon and verify unavailable state
- use bad token and verify unauthorized state
- reconnect successfully without reinstalling the app

---

## Phase 2 — dashboard MVP

## Objective

Deliver a useful read-only home view that immediately communicates Popeye’s status and attention level.

## Milestone outcome

The app is useful even if the operator never leaves the dashboard.

## Concrete tasks

### Dashboard data composition

- create `SystemService` / `DashboardSnapshot`
- load:
  - `/v1/status`
  - `/v1/daemon/scheduler`
  - `/v1/engine/capabilities`
  - `/v1/usage/summary`
  - optionally `/v1/security/audit`
  - optionally `/v1/connections` summary if operator token is expected

### Dashboard UI

- implement dashboard summary strip
- implement attention section
- implement active-work summary panel
- implement connection health summary panel
- implement security findings summary panel
- add drill-down navigation into Runs / Jobs / Approvals / Connections

### Refresh behavior

- implement centralized polling for dashboard
- add explicit last-updated/freshness display
- preserve last-loaded dashboard snapshot during refresh failures

### State coverage

- empty states
- loading skeletons
- stale banner
- daemon unavailable
- unauthorized / forbidden
- decode failure / diagnostics hook

## File/folder targets

- `apps/macos/PopeyeMac/Core/Services/SystemService.swift`
- `apps/macos/PopeyeMac/Features/Dashboard/*`
- `apps/macos/PopeyeMac/Features/Shared/Components/*`

## Dependencies

Built on Phase 1 API foundation.

## Acceptance criteria

- dashboard renders real loopback data
- cards navigate into the right sections
- panel-level loading/error/stale states exist
- refresh behavior is visible and controlled
- dashboard remains readable at common Mac window sizes

## Verification

### Automated

- dashboard store tests with mock service snapshots
- formatter tests for dates/durations/currency
- UI preview coverage for healthy/stale/error states

### Manual

- run with active jobs/runs and verify counts
- run with no active work and verify empty/idle wording
- disconnect SSE/polling path and verify stale state

---

## Phase 3 — key drill-down and operator views

## Objective

Turn the app from a dashboard into a real operator console.

## Milestone outcome

The operator can supervise active work, inspect failure details, and move across runs/jobs/receipts/interventions without opening the web inspector for core runtime workflows.

## Concrete tasks

### Command center

- implement `CommandCenterStore`
- port layout concepts from web command center:
  - summary cards
  - active runs
  - jobs in motion
  - attention queue
  - detail inspector
- port key heuristics:
  - idle hint
  - stuck-risk
  - freshness/staleness
- add local layout persistence:
  - density mode
  - detail width
  - workspace filter
  - visible panels

### Runs

- implement runs table with filters/sorting
- implement run detail inspector
- implement run event timeline
- implement execution envelope section
- implement run reply surface
- link to related receipt/job/task ids

### Jobs

- implement jobs table and inspector
- show lease/retry context when available
- show related task/run relationships

### Receipts

- implement receipts table
- implement receipt detail view
- include runtime additive section:
  - execution summary
  - context releases
  - timeline

### Interventions / Approvals

- implement read-only interventions view
- implement read-only approvals view
- inspector detail surfaces for both
- include related run links and decision context

### Event stream foundation

- implement `EventStreamService`
- show stream connected/disconnected state
- trigger targeted invalidation on relevant events
- keep polling as the canonical consistency path

## File/folder targets

- `apps/macos/PopeyeMac/Core/LiveUpdates/*`
- `apps/macos/PopeyeMac/Core/Services/OperationsService.swift`
- `apps/macos/PopeyeMac/Core/Services/GovernanceService.swift`
- `apps/macos/PopeyeMac/Features/CommandCenter/*`
- `apps/macos/PopeyeMac/Features/Runs/*`
- `apps/macos/PopeyeMac/Features/Jobs/*`
- `apps/macos/PopeyeMac/Features/Receipts/*`
- `apps/macos/PopeyeMac/Features/Interventions/*`
- `apps/macos/PopeyeMac/Features/Approvals/*`

## Dependencies

- Phase 1 client foundation
- Phase 2 dashboard infrastructure
- enough DTO coverage for execution/governance endpoints

## Acceptance criteria

- operator can navigate between dashboard, command center, runs, jobs, receipts, approvals
- selection drives inspector detail
- command-center heuristics match documented behavior
- run detail includes envelope/events/reply/receipt linkage
- receipt detail includes usage and runtime policy context
- live freshness is visible

## Verification

### Automated

- command-center derivation tests
- run-detail decoding tests
- SSE parser tests
- selection/navigation tests in stores

### Manual

- active run shows recent activity and stale/idle heuristics
- failed run links to receipt and error details
- approvals/interventions show related context
- resizing window does not break core workflows

---

## Phase 4 — write paths and controlled mutations

## Objective

Add a narrow, high-value set of explicit operator actions without widening scope into general admin parity.

## Milestone outcome

The native app supports the first meaningful write operations while respecting role/CSRF/audit boundaries.

## Recommended mutation set for this phase

### Core runtime

- retry run
- cancel run
- pause job
- resume job
- enqueue job

### Governance

- resolve intervention
- approve approval
- deny approval

### Optional, only if implementation stays clean

- connection sync/reconnect
- basic vault close/seal actions

## Concrete tasks

### Mutation infrastructure

- reusable confirmation sheet pattern
- mutation progress/error state pattern
- CSRF token refresh/retry logic
- post-mutation invalidation / refresh path
- role-forbidden UX

### Screen integration

- add action buttons in inspectors, not scattered everywhere
- show action availability based on record state
- hide or disable unsafe actions when context makes them irrelevant
- surface outcome toast/banner or inline status updates

### Auditability UX

- show what will happen before confirmation
- keep related record visible after mutation
- refetch canonical state immediately after success

## File/folder targets

- mutation actions within existing feature folders
- shared confirmation components under `Features/Shared/Components`
- client/service updates under `Core/API` and `Core/Services`

## Dependencies

- Phase 3 read paths must be stable
- CSRF flow must already be proven
- ideally auth-role introspection endpoint exists by now, but if not, 403 handling must be robust

## Acceptance criteria

- each mutation works against live loopback API
- each mutation fetches or reuses CSRF correctly
- 403/401/error states are distinct and understandable
- post-mutation views refresh into canonical state
- no mutation bypasses service/client layers

## Verification

### Automated

- request-building tests for each mutation path
- feature-store mutation state tests
- 401/403/409 failure-path tests

### Manual

- retry a failed run
- cancel an active run
- pause and resume a job
- approve and deny a real or fixture-based approval
- verify UI reflects resulting state after server response

---

## Phase 5 — polish, testing, packaging, and hardening

## Objective

Prepare the app for sustained repo life and possible distribution.

## Milestone outcome

The native client is stable, testable, and packaged in a way that fits Popeye’s release discipline.

## Concrete tasks

### UX polish

- keyboard shortcuts across main surfaces
- better toolbar actions
- inspector toggle behavior
- state restoration
- copy-id / copy-command affordances
- improved empty-state copy
- accessibility pass

### Diagnostics

- optional in-app diagnostics panel
- improved logging categories
- request timing visibility
- SSE connectivity history

### Testing hardening

- broaden unit coverage
- add UI smoke coverage for main nav
- add manual verification checklist to repo docs
- consider macOS CI runner integration for `xcodebuild test`

### Packaging/signing

- finalize ATS/local networking configuration
- finalize entitlements
- decide sandbox posture
- integrate app target into release packaging path
- sign and notarize in the same discipline as the main Popeye package

### Optional late additions

- lightweight menu bar extra
- web-inspector handoff links
- connections sync/reconnect if not already done
- limited instructions preview or memory search if stable and needed

## File/folder targets

- app command definitions
- settings/preferences polish
- diagnostics UI
- release/build scripts as needed
- repo docs updates for packaging and testing

## Dependencies

- prior phases complete
- release engineering path chosen
- backend/API refinements for any deferred capabilities resolved

## Acceptance criteria

- app is stable under normal operator usage
- no critical path requires direct runtime coupling
- packaging story is clear
- tests run consistently
- unsupported surfaces are clearly documented rather than half-built

## Verification

### Automated

- unit + UI tests pass locally
- packaging build completes
- if CI is added, macOS runner passes

### Manual

- fresh install or fresh checkout build works
- connect/disconnect/reconnect works
- live monitoring works over extended use
- mutations remain safe and explicit
- unsupported workflows hand off cleanly

---

## Risks and mitigations

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Current Swift codegen is too weak | Can cause rework if adopted too early | Hand-author first DTO subset; fix codegen in parallel |
| Auth role is not introspectable | Hard to present role-aware UI cleanly | Add `GET /v1/auth/context`; until then handle 403 clearly |
| Historical docs mention daemon control that current API lacks | Can cause scope drift into process management hacks | Keep daemon lifecycle out of v1 unless explicit endpoints land |
| Polling fan-out becomes noisy | Dashboard + command center can hit many routes | Central refresh scheduler; consider additive summary endpoints |
| Broad web parity pressure | Can bloat native before it proves value | Hold scope to dashboard/command center/core drill-downs first |
| Sensitive domain surfaces expand too fast | Security and maintenance burden rises | Keep persistent cache minimal; defer domain-heavy admin flows |
| Xcode project integration in a JS-heavy repo | Tooling friction and repo complexity | Keep native app self-contained under `apps/macos`; add only necessary release hooks |

---

## Dependencies between phases

- **Phase 0 -> Phase 1:** planning and boundary decisions must be stable
- **Phase 1 -> Phase 2:** dashboard needs auth/client/foundation
- **Phase 2 -> Phase 3:** command center and drill-downs need shared shell/formatters/polling
- **Phase 3 -> Phase 4:** mutations only after strong read surfaces exist
- **Phase 4 -> Phase 5:** hardening only after core workflows prove out

---

## How to keep the work incremental and non-destructive

1. Add app infrastructure before adding breadth.
2. Keep endpoint DTO coverage limited to features being built.
3. Use service wrappers so endpoint changes do not cascade through views.
4. Never land a feature that only works by violating the control API boundary.
5. Prefer hidden/disabled unsupported menu items over placeholder dead ends.
6. Leave the web inspector as the escape hatch rather than cramming parity into every phase.
7. Update `apps/macos/README.md` as the app transitions from deferred to active development.

---

## Recommended implementation order inside the phases

If one coding agent is doing the work, the concrete build order should be:

1. project scaffold
2. connect screen
3. auth/keychain
4. low-level API client
5. dashboard snapshot + dashboard UI
6. command-center shell with fixtures
7. runs/jobs/receipts read paths
8. SSE invalidation
9. interventions/approvals read paths
10. core mutations
11. polish/testing/packaging

That order minimizes wasted work and keeps the app useful from the earliest moment.
