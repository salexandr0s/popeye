# Popeye macOS Dashboard/Client Component Inventory

## Purpose

This document defines the reusable SwiftUI building blocks for the native macOS client. It is intentionally implementation-oriented: each component exists to support the design and architecture in this folder.

The inventory is split into:

- app shell primitives
- dashboard/command-center components
- list/table row models
- inspector/detail sections
- state/feedback components
- formatting utilities
- later domain-specific cards

A component belongs in this inventory only if it is likely to be reused or is important enough to deserve an explicit contract.

---

## Scope legend

| Label | Meaning |
| --- | --- |
| **v1** | Should exist in the first useful native release |
| **v1.5** | Useful soon after the foundation is stable |
| **Later** | Deliberately out of first-wave scope |

---

## App shell components

| Component | Purpose | Data dependencies | Interaction model | Scope |
| --- | --- | --- | --- | --- |
| `MainWindowScene` | Root app scene with split-view container | global app model, connection state | owns window layout and scene wiring | v1 |
| `AppSidebar` | Top-level navigation between Dashboard / Command Center / Runs / Jobs / Receipts / Governance / Connections / Usage | current route, optional badge counts | selection-driven navigation | v1 |
| `AppToolbar` | Global refresh, inspector toggle, connection status, filter affordances | app connection state, current feature capabilities | toolbar buttons and segmented controls | v1 |
| `ConnectionStatusBanner` | Surface daemon unavailable / unauthorized / stale states globally | connection session, last error, last refresh | passive banner with retry / reconnect actions | v1 |
| `RoleBadge` | Show current auth role once introspection exists | auth context | passive display | v1.5 |
| `SettingsView` | Base URL, token management, app preferences | credential store, app prefs | form-based, modal/settings scene | v1 |
| `UnsupportedSurfaceCallout` | Honest handoff for screens left web-first/CLI-first | optional URL/CLI snippet | button to open web inspector or copy command | v1 |
| `SplitViewInspectorToggle` | Standardized inspector show/hide control | current split-view state | toolbar toggle | v1 |
| `WindowRestorationModel` | Persist selected route, filters, panel density, inspector width | app prefs / scene storage | passive restoration | v1.5 |

---

## Dashboard components

| Component | Purpose | Data dependencies | Interaction model | Scope |
| --- | --- | --- | --- | --- |
| `DashboardView` | Home screen summary | `DashboardSnapshot` | card navigation + refresh | v1 |
| `StatusStrip` | Top row of compact KPI cards | daemon status, scheduler, usage, freshness | click-through to related views | v1 |
| `HealthCard` | Healthy/unhealthy summary with engine kind and uptime | `DaemonStatus`, `HealthResponse` | navigates to Dashboard/Command Center context | v1 |
| `SchedulerCard` | Scheduler running state, next heartbeat | `SchedulerStatus` | click-through to Command Center | v1 |
| `WorkloadCard` | running / queued / blocked counts | status + jobs summary | navigates to Runs or Jobs | v1 |
| `OpenInterventionsCard` | urgent operator queue count | interventions count | navigates to Interventions | v1 |
| `UsageCard` | runs/tokens/estimated cost summary | `UsageSummary` | navigates to Usage & Security or Receipts | v1 |
| `EngineCapabilitiesCard` | host tool mode, session behavior, compaction support | `EngineCapabilities` | passive info, maybe detail sheet later | v1 |
| `AttentionCard` | recent failures, stuck-risk, approvals backlog, degraded connections | composed summary across services | click-through to Command Center or Approvals | v1 |
| `ActiveRunsCard` | concise active-run preview list | run records + task titles | select to open Runs/Command Center | v1 |
| `ConnectionsHealthCard` | connection health rollup | connection records summary | opens Connections overview | v1 |
| `SecurityFindingsCard` | security audit findings count/severity summary | security audit response | opens Usage & Security | v1 |
| `RecentFailuresCard` | latest failed runs/jobs/receipts summary | run/job/receipt summaries | opens filtered Runs or Receipts | v1.5 |

---

## Command Center components

| Component | Purpose | Data dependencies | Interaction model | Scope |
| --- | --- | --- | --- | --- |
| `CommandCenterView` | Operational cockpit | composite command-center snapshot | selection-driven, live-updating, keyboard-friendly | v1 |
| `CommandCenterSummaryStrip` | summary cards for active/queued/blocked/intervention/cost/failures | runs, jobs, interventions, usage | click-through + selection context | v1 |
| `PanelContainer` | Shared chrome for runs/jobs/attention/detail panels | title, lastUpdated, stale state | wraps panel content consistently | v1 |
| `FreshnessPill` | Visual live/stale signal | last updated, stale threshold | passive | v1 |
| `LiveStreamBadge` | Event-stream connected/disconnected signal | SSE connection state | passive | v1 |
| `WorkspaceFilterBar` | Filter command-center by workspace | run/job/task workspace ids | picker + persisted selection | v1 |
| `DensityToggle` | Compact vs comfortable row density | local layout prefs | segmented control | v1 |
| `PanelVisibilityMenu` | Show/hide summary/runs/jobs/attention/detail panels | local layout prefs | menu-based toggles | v1.5 |
| `ActiveRunsPanel` | Live list/table of runs in motion | runs + task title map + attention state | selection-driven | v1 |
| `JobsInMotionPanel` | Jobs list showing queue/running/blocked state | jobs + task title map | selection-driven | v1 |
| `AttentionQueuePanel` | Derived attention items (stuck-risk, open intervention, blocked job, recent failure) | runs, jobs, interventions, receipts | selection-driven with badges | v1 |
| `CommandCenterInspector` | Right-hand detail pane for selected run/job/intervention | selected entity + related context | selection-driven, mutation buttons later | v1 |
| `CommandSnippetsSection` | Copyable related CLI commands | selected entity ids/state | copy interaction | v1 |
| `LayoutPersistenceAdapter` | Persist focus mode, density mode, detail width, visible panels | local app prefs | passive | v1.5 |

---

## Shared table/list primitives

| Component | Purpose | Data dependencies | Interaction model | Scope |
| --- | --- | --- | --- | --- |
| `SelectionTable` | Shared wrapper around macOS `Table` with selection handling | generic row models | row select / sort / double-click | v1 |
| `RunRowView` | Dense run summary row | `RunDisplayModel` | select/open detail | v1 |
| `JobRowView` | Dense job summary row | `JobDisplayModel` | select/open detail | v1 |
| `ReceiptRowView` | Dense receipt summary row | `ReceiptDisplayModel` | select/open detail | v1 |
| `InterventionRowView` | Dense intervention summary row | `InterventionDisplayModel` | select/open detail | v1 |
| `ApprovalRowView` | Dense approval summary row | `ApprovalDisplayModel` | select/open detail | v1 |
| `ConnectionRowView` | Provider health row | `ConnectionDisplayModel` | select/open detail or handoff | v1 |
| `ClickableSummaryRow` | Compact row for cards/panels with title/meta/badges | generic display props | tap/click selects target | v1 |
| `SectionTableHeader` | Reusable header with sort/filter slots | local table state | button/menu actions | v1 |
| `ColumnVisibilityMenu` | Show/hide table columns where useful | local prefs | menu action | v1.5 |

---

## State badges and indicators

| Component | Purpose | Data dependencies | Interaction model | Scope |
| --- | --- | --- | --- | --- |
| `StatusBadge` | Generic badge for run/job/approval/intervention status | status enum/string | passive | v1 |
| `HealthIndicator` | Dot + label for healthy/degraded/error | health summary | passive | v1 |
| `AttentionBadge` | idle / stuck-risk / blocked labels | derived attention state | passive | v1 |
| `PolicyBadge` | domain/action/policy class badge | approval/policy data | passive | v1 |
| `ConnectionStateBadge` | connected/degraded/disconnected provider state | connection health | passive | v1 |
| `MutabilityBadge` | read-only / operator action available label | view or record actionability | passive | v1.5 |
| `FreshnessBadge` | explicit stale/fresh signal | lastUpdated + threshold | passive | v1 |
| `SecuritySeverityBadge` | audit severity | security finding | passive | v1 |

---

## Filter and search surfaces

| Component | Purpose | Data dependencies | Interaction model | Scope |
| --- | --- | --- | --- | --- |
| `FeatureFilterBar` | Standard row for feature-specific filters | local filter state | segmented controls, popups, search | v1 |
| `WorkspacePicker` | Workspace scoping | workspace ids / labels | picker | v1 |
| `StatusFilterMenu` | Filter by run/job/approval/intervention status | local filter state | menu | v1 |
| `SearchFieldBar` | Text search for lists where available | local query state + remote search if supported | text input | v1.5 |
| `DateRangeFilter` | Receipts / usage time filter later | local date state | date pickers/menu | later |
| `ScopePicker` | Instructions/memory scope selector | scopes, projects | picker | later |
| `ProviderFilter` | Connections/email/calendar/github provider scoping | provider/domain list | menu | later |

---

## Detail and inspector primitives

| Component | Purpose | Data dependencies | Interaction model | Scope |
| --- | --- | --- | --- | --- |
| `InspectorSection` | Standard title/body grouping in inspector panes | title + content | passive | v1 |
| `DetailKeyValueGrid` | Dense key/value layout for technical metadata | pairs of label/value | passive | v1 |
| `IdentifierField` | Display/copy run/job/task ids cleanly | id string | copy action | v1 |
| `RelatedLinkRow` | Link to related run/job/receipt/task | route + label | navigation | v1 |
| `MetadataWrapRow` | Wrap badges and metadata labels compactly | metadata tokens | passive | v1 |
| `MutationActionBar` | Standardized row of action buttons for inspector writes | action availability, loading/error | button taps + confirmation | v1.5 |
| `ConfirmationSheet` | Shared confirmation UI for mutating actions | title, body, consequences | confirm/cancel | v1.5 |
| `InlineMutationError` | Show mutation failure without losing context | mutation error | dismiss/retry | v1.5 |

---

## Run detail components

| Component | Purpose | Data dependencies | Interaction model | Scope |
| --- | --- | --- | --- | --- |
| `RunInspectorView` | Full run detail composition | run, events, envelope, reply, receipt summary | selection-driven | v1 |
| `RunHeaderSection` | State, timestamps, workspace/profile/session root | run record | passive + related navigation | v1 |
| `ExecutionEnvelopeSection` | Effective policy/capabilities/roots/warnings | execution envelope | passive, copy-friendly | v1 |
| `RunReplySection` | Terminal reply summary | run reply | passive, copy text | v1 |
| `RunEventsTimeline` | Chronological run events | run event records | scroll, select event, copy payload later | v1 |
| `RunAttentionSection` | Idle/stuck-risk explanation | derived attention state | passive | v1 |
| `RunQuickActions` | retry/cancel actions | run state + auth ability | buttons with confirmation | v1.5 |
| `RunReceiptSummarySection` | Link to related receipt | receipt summary | navigate to receipt | v1 |

---

## Job detail components

| Component | Purpose | Data dependencies | Interaction model | Scope |
| --- | --- | --- | --- | --- |
| `JobInspectorView` | Full job detail composition | job, task summary, lease, related runs | selection-driven | v1 |
| `JobHeaderSection` | Status, retry count, timestamps | job record | passive | v1 |
| `JobLeaseSection` | Active lease details | lease record | passive | v1 |
| `JobRelatedRunsSection` | Show most relevant associated run(s) | run summaries | navigation | v1 |
| `JobQuickActions` | pause/resume/enqueue | job state + auth ability | buttons with confirmation | v1.5 |

---

## Receipt detail components

| Component | Purpose | Data dependencies | Interaction model | Scope |
| --- | --- | --- | --- | --- |
| `ReceiptInspectorView` | Full receipt detail composition | receipt record | selection-driven | v1 |
| `ReceiptSummarySection` | summary/details/status/created at | receipt record | passive | v1 |
| `UsageBreakdownSection` | provider/model/token/cost breakdown | receipt usage | passive | v1 |
| `ReceiptRuntimeExecutionSection` | runtime.execution snapshot | receipt.runtime.execution | passive | v1 |
| `ContextReleasesSection` | release counts/breakdowns | receipt.runtime.contextReleases | passive | v1 |
| `ReceiptTimelineSection` | runtime.timeline events | receipt.runtime.timeline | scroll | v1 |
| `ReceiptRelatedObjectsSection` | links to run/job/task/workspace | receipt fields | navigation | v1 |

---

## Governance components

| Component | Purpose | Data dependencies | Interaction model | Scope |
| --- | --- | --- | --- | --- |
| `InterventionsView` | List/filter open and resolved interventions | intervention records | select row for inspector | v1 |
| `InterventionInspector` | Reason/run/context/resolution info | intervention + related run summary | selection-driven | v1 |
| `InterventionResolveButton` | Resolve open intervention | intervention state + auth ability | confirmation + mutation | v1.5 |
| `ApprovalsView` | List/filter approvals | approval records | select row for inspector | v1 |
| `ApprovalInspector` | Scope/domain/resource/requester/run/resolution detail | approval record | selection-driven | v1 |
| `ApprovalDecisionPanel` | Approve / deny controls | approval state + auth ability | confirmation + mutation | v1.5 |
| `SecuritySummaryView` | Usage + security page composition | usage summary + audit summary | passive, navigable | v1 |
| `AuditFindingRow` | Dense security finding row | security finding | passive | v1 |
| `AuditSeveritySummary` | Totals by severity | audit response | passive | v1 |

---

## Connections components

| Component | Purpose | Data dependencies | Interaction model | Scope |
| --- | --- | --- | --- | --- |
| `ConnectionsOverviewView` | Narrow native view of provider health | connection records summary | list selection + handoff | v1 |
| `ConnectionsSummaryStrip` | total / healthy / degraded / disconnected cards | connection summaries | click-through to filtered list | v1 |
| `ConnectionInspector` | Show provider, health, sync, policy summary | connection record | selection-driven | v1 |
| `OpenInWebInspectorButton` | Handoff to broader web flow | configured local web URL | open browser | v1 |
| `ConnectionSyncButton` | Manual sync action | connection/account id, auth ability | mutation with refresh | later |
| `ReconnectButton` | Quick remediation | connection id, auth ability | mutation with refresh | later |
| `ConnectionDiagnosticsSection` | Deep diagnostic details | diagnostics response | passive | later |
| `ResourceRulesEditor` | Manage connection resource rules | rules list + connection id | CRUD form flow | later |

---

## Feedback and state components

| Component | Purpose | Data dependencies | Interaction model | Scope |
| --- | --- | --- | --- | --- |
| `LoadingStateView` | General loading placeholder | optional title/context | passive | v1 |
| `SkeletonCard` | Dashboard placeholder card | none | passive | v1 |
| `EmptyStateView` | No-data states with explanation and next step | title/body/action | passive or action button | v1 |
| `ErrorStateView` | Screen/panel error with retry | user-facing error mapping | retry button | v1 |
| `StaleStateBanner` | Warn that visible data is not current | last updated, freshness state | retry action | v1 |
| `RoleLockedStateView` | Explain missing operator permissions | required role + current state | passive | v1.5 |
| `MutationToast` | Compact success/failure confirmation for writes | mutation outcome | auto-dismiss/manual dismiss | v1.5 |

---

## Reusable formatting utilities

| Utility | Purpose | Inputs | Output / behavior | Scope |
| --- | --- | --- | --- | --- |
| `formatDateTime` | Canonical absolute timestamp formatting | ISO-8601 string | localized date+time | v1 |
| `formatRelativeTime` | Human-readable recency | ISO-8601 string | “2m ago”, “1h ago” | v1 |
| `formatDuration` | Run/job durations and idle windows | two instants or milliseconds | concise duration text | v1 |
| `formatCurrencyUSD` | Cost summary display | numeric amount | stable currency string | v1 |
| `formatTokenCount` | Token count display | integer | grouped numeric string | v1 |
| `formatIdentifierShort` | Short run/job/receipt ids for dense lists | id string | clipped/copyable label | v1 |
| `formatOptionalPlaceholder` | Consistent placeholder for null values | optional string/value | `—` or given fallback | v1 |
| `formatStateLabel` | Map backend enum values to readable labels | state/status string | title-cased label | v1 |
| `decodeISO8601Flexible` | Decode with fractional-second tolerance | string | `Date` or failure | v1 |
| `staleThresholdExceeded` | Shared freshness logic | last updated + threshold | boolean | v1 |

---

## Later domain-specific card ideas

These are intentionally **not** first-wave requirements, but they should be named now so later work can reuse the same component vocabulary.

### Memory

| Component | Purpose | Data dependencies | Interaction model | Scope |
| --- | --- | --- | --- | --- |
| `MemorySearchView` | Query and browse memory results | memory search response | search + result selection | later |
| `MemoryResultRow` | Compact memory result summary | memory result | select/open detail | later |
| `MemoryAuditCard` | Surface memory health issues | memory audit response | navigate to memory screen | later |

### People

| Component | Purpose | Data dependencies | Interaction model | Scope |
| --- | --- | --- | --- | --- |
| `PeopleOverviewCard` | Count/merge-suggestion summary | people stats / suggestions | navigate to People screen | later |
| `PersonRowView` | Person summary row | person list item | select/open detail | later |
| `MergeSuggestionRow` | Highlight suggested merges | merge suggestion | open person compare flow | later |

### Finance

| Component | Purpose | Data dependencies | Interaction model | Scope |
| --- | --- | --- | --- | --- |
| `FinanceDigestCard` | Spending/import freshness summary | finance digest | navigate to Finance screen | later |
| `FinanceTransactionRow` | Transaction summary | finance transaction record | select/open detail | later |
| `ImportStatusRow` | Import state row | finance import record | select/open detail | later |

### Medical

| Component | Purpose | Data dependencies | Interaction model | Scope |
| --- | --- | --- | --- | --- |
| `MedicalDigestCard` | Upcoming appointments/medications summary | medical digest | navigate to Medical screen | later |
| `AppointmentRow` | Appointment summary | medical appointment record | select/open detail | later |
| `MedicationRow` | Medication summary | medical medication record | select/open detail | later |

### Connections / provider digests

| Component | Purpose | Data dependencies | Interaction model | Scope |
| --- | --- | --- | --- | --- |
| `EmailDigestCard` | Inbound mail summary | email digest | navigate to Email screen | later |
| `CalendarDigestCard` | Upcoming schedule summary | calendar digest | navigate to Calendar screen | later |
| `GitHubDigestCard` | PR/issue/notification summary | GitHub digest | navigate to GitHub screen | later |
| `TodoDigestCard` | Task summary | todo digest | navigate to Todos screen | later |

---

## Components that should *not* be built early

Avoid spending time on these before the core console exists:

- custom charting system
- embedded web views for parity
- designer-heavy card frameworks
- generalized CRUD form builders
- massive generic “entity detail” renderer
- separate domain design systems for finance/medical/people
- custom local database cache viewers

---

## Final component recommendation

Build the app from a small set of strong reusable pieces:

- split-view shell
- dashboard cards
- command-center panels
- dense table rows
- structured inspector sections
- clear state banners
- copy-friendly metadata views
- narrow mutation affordances

That inventory is enough to cover the serious operator-console scope without inventing a separate native product language.
