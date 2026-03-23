# Popeye macOS Dashboard/Client Build Checklist

This checklist is intended for an implementation agent. Every item should be treated as concrete and testable.

---

## Phase 0 — repo audit and boundary verification

### Planning and repo-truth validation

- [ ] Confirm `apps/macos/README.md` is still a deferred placeholder and no native scaffold exists
- [ ] Confirm native client will use the control API only
- [ ] Confirm browser bootstrap/session-cookie auth is web-specific and not the native auth model
- [ ] Confirm bearer + CSRF flow for native mutations against current control API
- [ ] Confirm which control API routes are `readonly`, `service`, and `operator`
- [ ] Confirm command-center data sources in `apps/web-inspector`
- [ ] Confirm command-center heuristics (idle, stuck-risk, stale thresholds) from current web code
- [ ] Confirm current generated Swift artifacts exist and document their limitations
- [ ] Confirm current generated JSON schema output limitations
- [ ] Confirm which web views are in scope for native first-wave implementation
- [ ] Confirm which surfaces remain web-first / CLI-first

### Documentation outputs

- [ ] `docs/macos-dashboard/design.md` exists and matches repo truth
- [ ] `docs/macos-dashboard/architecture.md` exists and matches repo truth
- [ ] `docs/macos-dashboard/buildplan.md` exists and includes phases 0–5
- [ ] `docs/macos-dashboard/api_surface_map.md` maps endpoints to native surfaces
- [ ] `docs/macos-dashboard/component_inventory.md` defines reusable SwiftUI primitives
- [ ] `docs/macos-dashboard/checklist.md` exists and is implementation-oriented
- [ ] `docs/macos-dashboard/open_questions.md` captures unresolved items and recommendations
- [ ] `docs/macos-dashboard/agent_prompt.md` gives a follow-on implementation prompt

### Decisions to lock before coding

- [ ] Initial native scope is explicitly documented as read-heavy operator console
- [ ] Dashboard-first entry and command-center-first value proposition are documented
- [ ] Non-v1 surfaces are named explicitly
- [ ] No-direct-db/no-direct-runtime-file rules are documented explicitly
- [ ] Generated Swift models are marked unsafe as the primary v1 model layer
- [ ] Need for auth introspection endpoint is documented
- [ ] Need for possible command-center summary endpoints is documented

---

## Phase 1 — native app shell and API client foundation

### Project scaffolding

- [ ] Create `apps/macos/PopeyeMac.xcodeproj`
- [ ] Add main app target
- [ ] Add unit test target
- [ ] Add UI test target
- [ ] Create app folder structure under `apps/macos/PopeyeMac/`
- [ ] Update `apps/macos/README.md` from deferred placeholder to active implementation status
- [ ] Add minimal app icon/asset placeholders
- [ ] Add `Info.plist` with local loopback networking/ATS configuration
- [ ] Decide and configure initial sandbox/entitlements posture

### App shell

- [ ] Implement `PopeyeMacApp.swift`
- [ ] Implement root split-view layout
- [ ] Implement placeholder sidebar navigation
- [ ] Implement settings scene or settings sheet
- [ ] Implement global refresh command
- [ ] Implement inspector toggle plumbing
- [ ] Implement app-wide connection status model

### Auth/bootstrap

- [ ] Implement `CredentialStore`
- [ ] Implement Keychain token storage
- [ ] Implement base URL preference storage
- [ ] Implement connect/bootstrap screen
- [ ] Implement connect action using live API validation
- [ ] Handle invalid URL cleanly
- [ ] Handle unreachable daemon cleanly
- [ ] Handle unauthorized token cleanly
- [ ] Implement replace-token / sign-out path
- [ ] Ensure token never appears in logs or previews

### Low-level client

- [ ] Implement `ControlAPIClient`
- [ ] Implement authenticated GET support
- [ ] Implement authenticated POST/PATCH/DELETE support
- [ ] Implement `GET /v1/security/csrf-token` fetch and cache
- [ ] Add `x-popeye-csrf` on mutations
- [ ] Normalize 401 / 403 / 404 / decode failures
- [ ] Implement request timing and diagnostics capture
- [ ] Add flexible ISO-8601 decoding utilities
- [ ] Add unit tests for bearer header injection
- [ ] Add unit tests for CSRF fetch-before-mutate behavior

### First DTO subset

- [ ] Add DTOs for `health`
- [ ] Add DTOs for `status`
- [ ] Add DTOs for `engine capabilities`
- [ ] Add DTOs for `scheduler status`
- [ ] Add DTOs for `usage summary`
- [ ] Add DTOs for `security audit` summary if included early
- [ ] Add DTOs for `connections` summary if included early
- [ ] Add fixtures matching those DTOs

### Preview/mocks

- [ ] Add mock service protocol(s) for system/dashboard
- [ ] Add fixture-based preview environment
- [ ] Add at least one healthy preview
- [ ] Add at least one stale/offline preview
- [ ] Add at least one auth-failure preview

### Phase 1 verification

- [ ] App launches locally from Xcode
- [ ] Connect screen accepts valid base URL/token
- [ ] Successful connect loads real dashboard data
- [ ] Bad token shows unauthorized state
- [ ] Daemon-unavailable state is distinct from unauthorized
- [ ] Unit tests for client/auth pass
- [ ] UI smoke test for bootstrap flow passes

---

## Phase 2 — dashboard MVP

### Dashboard data composition

- [ ] Implement `SystemService`
- [ ] Create `DashboardSnapshot` type
- [ ] Load `/v1/status`
- [ ] Load `/v1/daemon/scheduler`
- [ ] Load `/v1/engine/capabilities`
- [ ] Load `/v1/usage/summary`
- [ ] Decide whether to include `/v1/security/audit` in dashboard MVP
- [ ] Decide whether to include `/v1/connections` summary in dashboard MVP
- [ ] Fetch dashboard subrequests concurrently
- [ ] Retain prior snapshot while refreshing

### Dashboard UI

- [ ] Implement `DashboardView`
- [ ] Implement status strip
- [ ] Implement `HealthCard`
- [ ] Implement `SchedulerCard`
- [ ] Implement `WorkloadCard`
- [ ] Implement `OpenInterventionsCard`
- [ ] Implement `UsageCard`
- [ ] Implement `EngineCapabilitiesCard`
- [ ] Implement `AttentionCard`
- [ ] Implement `ConnectionsHealthCard` if in scope
- [ ] Implement `SecurityFindingsCard` if in scope
- [ ] Implement drill-down actions from cards to routes

### State handling

- [ ] Add dashboard loading skeletons
- [ ] Add empty/idle dashboard messaging
- [ ] Add stale-state banner or indicator
- [ ] Add error panel with retry
- [ ] Preserve old snapshot on refresh failure
- [ ] Distinguish role-forbidden data from missing data

### Refresh behavior

- [ ] Add dashboard polling
- [ ] Add last-updated tracking
- [ ] Stop or reduce polling when app is backgrounded
- [ ] Add manual refresh action from toolbar
- [ ] Ensure duplicate overlapping dashboard refreshes are avoided

### Phase 2 verification

- [ ] Dashboard renders correctly with real daemon data
- [ ] Dashboard previews cover healthy/loading/stale/error states
- [ ] Card drill-down routes work
- [ ] Refresh updates values without view glitches
- [ ] Window resizing keeps dashboard usable
- [ ] Unit tests for dashboard store pass

---

## Phase 3 — key drill-down and operator views

### Command Center foundation

- [ ] Implement `CommandCenterStore`
- [ ] Implement command-center snapshot composition
- [ ] Load runs, jobs, tasks, interventions, receipts, usage as needed
- [ ] Port idle/stuck-risk heuristics from web implementation
- [ ] Port panel stale/freshness logic
- [ ] Add workspace filter
- [ ] Add density toggle
- [ ] Add selection model (run/job/intervention)
- [ ] Persist layout prefs locally
- [ ] Implement summary strip
- [ ] Implement active runs panel
- [ ] Implement jobs in motion panel
- [ ] Implement attention queue panel
- [ ] Implement command-center inspector

### Event stream

- [ ] Implement `EventStreamService`
- [ ] Connect to `/v1/events/stream`
- [ ] Parse SSE frames reliably
- [ ] Surface connected/disconnected state
- [ ] Update last-event timestamp
- [ ] Trigger targeted invalidation for affected stores
- [ ] Reconnect with sensible backoff after disconnect
- [ ] Keep polling as fallback/canonical refresh path
- [ ] Add unit tests for SSE parsing
- [ ] Add unit tests for invalidation routing

### Runs

- [ ] Add DTOs for run list/detail
- [ ] Add DTOs for run events
- [ ] Add DTOs for execution envelope
- [ ] Add DTOs for run reply
- [ ] Implement `RunsView`
- [ ] Implement runs table with sorting/filtering
- [ ] Implement `RunInspectorView`
- [ ] Implement `RunEventsTimeline`
- [ ] Implement `ExecutionEnvelopeSection`
- [ ] Implement `RunReplySection`
- [ ] Link run detail to receipt if present
- [ ] Handle missing receipt gracefully

### Jobs

- [ ] Add DTOs for jobs and job lease
- [ ] Implement `JobsView`
- [ ] Implement jobs table
- [ ] Implement `JobInspectorView`
- [ ] Implement lease section
- [ ] Link job detail to related run/task ids

### Receipts

- [ ] Add DTOs for receipt list/detail including additive runtime section
- [ ] Implement `ReceiptsView`
- [ ] Implement receipts table
- [ ] Implement `ReceiptInspectorView`
- [ ] Implement usage breakdown section
- [ ] Implement runtime execution section
- [ ] Implement context releases section
- [ ] Implement receipt timeline section
- [ ] Link receipt detail back to run/job/task ids

### Interventions and approvals (read-only first)

- [ ] Add DTOs for interventions
- [ ] Add DTOs for approvals
- [ ] Implement `InterventionsView`
- [ ] Implement intervention inspector
- [ ] Implement `ApprovalsView`
- [ ] Implement approval inspector
- [ ] Add dashboard/command-center handoff to these views

### Usage & security

- [ ] Implement `UsageSecurityView`
- [ ] Show usage summary
- [ ] Show security audit findings
- [ ] Add severity badges and summaries
- [ ] Handle operator-only access explicitly

### Connections overview

- [ ] Add DTOs for connections summary/list
- [ ] Implement `ConnectionsOverviewView`
- [ ] Implement connections summary strip
- [ ] Implement connection row view
- [ ] Implement connection inspector summary
- [ ] Add “Open in Web Inspector” handoff

### Phase 3 verification

- [ ] Command Center updates live under active daemon use
- [ ] Selection drives inspector correctly
- [ ] Run detail shows envelope/events/reply
- [ ] Receipt detail shows runtime/timeline data
- [ ] Interventions/approvals views load correctly
- [ ] Connections overview shows current health accurately
- [ ] SSE disconnect displays stale/live status correctly
- [ ] Unit tests for derivations, filters, and view models pass

---

## Phase 4 — write paths and controlled mutations

### Mutation infrastructure

- [ ] Implement reusable confirmation sheet
- [ ] Implement reusable mutation progress state
- [ ] Implement reusable mutation error display
- [ ] Ensure CSRF token is fetched/reused correctly for mutations
- [ ] Add post-mutation invalidation/refetch hooks
- [ ] Add role-forbidden handling for mutations
- [ ] Add success feedback pattern (toast/banner/inline)

### Runs mutations

- [ ] Implement retry-run action
- [ ] Implement cancel-run action
- [ ] Only enable retry when run state makes sense
- [ ] Only enable cancel when run is active/cancellable
- [ ] Refetch run detail and related list after success

### Job mutations

- [ ] Implement pause-job action
- [ ] Implement resume-job action
- [ ] Implement enqueue-job action
- [ ] Only show actions that make sense for current job status
- [ ] Refetch job detail and related list after success

### Intervention and approval mutations

- [ ] Implement resolve-intervention action
- [ ] Implement approve-approval action
- [ ] Implement deny-approval action
- [ ] Require explicit confirmation for approval decisions
- [ ] Refetch approval/intervention and related summaries after success

### Optional later mutations in this phase

- [ ] Decide whether connection sync is in scope
- [ ] Decide whether reconnect action is in scope
- [ ] Decide whether any vault actions are in scope
- [ ] Do not add optional actions unless core mutation paths are stable

### Phase 4 verification

- [ ] Each mutation succeeds against a live daemon
- [ ] Each mutation sends valid CSRF header
- [ ] 401/403/409 failures surface correctly
- [ ] Post-mutation state refreshes to canonical server truth
- [ ] Unit tests cover request construction and error handling
- [ ] Manual tests cover retry/cancel/pause/resume/enqueue/approve/deny/resolve

---

## Phase 5 — polish, testing, packaging, and hardening

### UX polish

- [ ] Add keyboard shortcuts for major routes
- [ ] Add `⌘R` refresh behavior where appropriate
- [ ] Add `⌘F` filter/search focus where appropriate
- [ ] Add copy-id affordances in inspectors
- [ ] Add copy-command snippets where valuable
- [ ] Improve empty-state copy
- [ ] Improve stale/offline messaging
- [ ] Finalize window restoration behavior
- [ ] Finalize toolbar behavior for each major screen

### Accessibility and quality

- [ ] Review VoiceOver labels on controls
- [ ] Verify keyboard navigation works in tables and inspector
- [ ] Ensure color is not the sole status carrier
- [ ] Ensure loading/error states are announced clearly enough
- [ ] Verify compact/dense mode remains readable

### Diagnostics

- [ ] Finalize `DiagnosticsStore`
- [ ] Add optional diagnostics view or debug panel
- [ ] Record request timings and recent failures in-memory
- [ ] Record SSE connect/disconnect history
- [ ] Keep diagnostics redacted and non-persistent by default

### Testing hardening

- [ ] Increase unit-test coverage for stores/services/formatters
- [ ] Add UI smoke tests for main navigation
- [ ] Add UI smoke tests for mutation confirmations
- [ ] Add regression tests for SSE parsing
- [ ] Add regression tests for date decoding / additive runtime payloads
- [ ] Document manual QA steps in repo docs

### Packaging and release prep

- [ ] Finalize app entitlements
- [ ] Finalize loopback ATS configuration
- [ ] Decide final sandbox posture
- [ ] Integrate native app target into release/package workflow
- [ ] Ensure app signs successfully
- [ ] Ensure app notarizes successfully in the chosen release path
- [ ] Decide whether app ships inside main Popeye `.pkg`
- [ ] Update release/runbook docs if packaging changes

### Optional late additions

- [ ] Decide whether a menu bar extra adds enough value
- [ ] If yes, implement status-only menu bar extra
- [ ] Decide whether to add web-inspector direct-link helpers
- [ ] Decide whether instructions or memory read-only view should follow

### Phase 5 verification

- [ ] App remains stable during extended live monitoring
- [ ] App remains stable across disconnect/reconnect cycles
- [ ] Unit and UI tests pass consistently
- [ ] Packaging path works end-to-end
- [ ] Unsupported workflows clearly hand off to web/CLI
- [ ] No critical path violates the control API boundary

---

## Cross-phase guardrails

- [ ] Do not add direct SQLite reads
- [ ] Do not add direct runtime-log parsing for truth
- [ ] Do not parse internal runtime files as a shortcut around missing endpoints
- [ ] Do not use a WebView as a substitute for implementing native screens
- [ ] Do not spread HTTP logic into views
- [ ] Do not treat the current generated Swift file as the app’s canonical domain model
- [ ] Do not widen scope into broad admin parity before core operator-console value exists
- [ ] Do not add mutations before their read surfaces are stable
- [ ] Do not silently persist sensitive domain data to local caches

---

## Done definition for the first serious native release

- [ ] Connect/bootstrap flow is solid
- [ ] Dashboard is useful on its own
- [ ] Command Center is live and operator-relevant
- [ ] Runs/Jobs/Receipts investigation is strong
- [ ] Interventions/Approvals are visible and actionable
- [ ] Connection health is visible
- [ ] Usage/Security summary is visible
- [ ] Core mutations work safely
- [ ] App remains within Popeye’s control API boundary
- [ ] Repo docs and app README are updated to match reality
