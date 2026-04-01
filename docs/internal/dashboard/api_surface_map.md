# Popeye macOS Dashboard/Client API Surface Map

## Purpose

This document maps Popeye’s existing backend/control-plane surfaces to the native macOS client.

It answers four questions:

1. Which endpoints power which native views?
2. Which ones are in native v1 versus later?
3. Which ones are read-only versus mutating?
4. Which surfaces are truly pleasant enough for Swift today, and which need refinement first?

This is intentionally a **native-client map**, not a full restatement of every backend contract in the repo.

---

## Readiness legend

| Rating | Meaning |
| --- | --- |
| **Ready** | Already proven in the web inspector / TypeScript client; clean enough for Swift via hand-authored DTOs now |
| **Ready with wrapper** | Useful and stable, but should be consumed through curated DTOs/adapters because current codegen or payload complexity would otherwise be awkward |
| **Defer** | Endpoint exists, but native v1 should not take on the UX/workflow yet |
| **Needs refinement** | Endpoint or surrounding contract would benefit from backend additions or cleanup before native can use it comfortably |

---

## Recommended Swift service groupings

| Swift service layer | Responsibilities | Initial native usage |
| --- | --- | --- |
| `SystemService` | health, status, scheduler, engine capabilities, usage, session roots, security audit | v1 |
| `OperationsService` | tasks, jobs, runs, run events, envelopes, receipts, interventions, instruction previews | v1 |
| `GovernanceService` | approvals, standing approvals, automation grants, security policy, vaults, mutation receipts | approvals + mutation receipts in v1; rest later |
| `ConnectionsService` | connections, OAuth start/poll, resource rules, diagnostics, reconnect, secrets, Telegram config/apply helpers | overview + provider setup in v1; deeper flows later |
| `UsageSecurityService` | usage + security summary composition | v1 |
| `InstructionsService` | instruction previews | later |
| `MemoryService` | memory search/audit/list/detail/maintenance | later |
| `PeopleService` | people search/detail/merge tooling | later |
| `FilesService` | file roots/search/documents/write intents | later |
| `DomainDigestService` | email/calendar/github/todos/finance/medical read-mostly digest/search surfaces | later |

---

## Auth/bootstrap/infrastructure endpoints

| Endpoint | Native view / use | Read/Write | Min role | Live update | Contract notes | Readiness | Service |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /v1/health` | Connect screen, top-level connectivity check | Read | `readonly` | Poll only | Minimal health payload; ideal bootstrap probe | Ready | `SystemService` |
| `GET /v1/status` | Connect screen, Dashboard, Command Center | Read | `readonly` | Poll + SSE invalidation | Core status card source | Ready | `SystemService` |
| `GET /v1/security/csrf-token` | Mutation infrastructure only | Read (infra) | `readonly` | On-demand | Required before mutations even for bearer clients | Ready | `ControlAPIClient` |
| `GET /v1/events/stream` | Command Center freshness, invalidation bus | Read | `readonly` | SSE | Native should use for freshness/invalidation, not state replication | Ready | `EventStreamService` |
| `POST /v1/auth/exchange` | **Not for native API auth** | Write | operator bearer only | None | Browser bootstrap only; keep web-only | Defer | none |
| `GET /v1/auth/context` *(recommended addition)* | Connection status, role-aware UI | Read | any authenticated principal | Poll on connect only | Additive endpoint recommended; not present today | Needs refinement | `AuthService` |

### Native decision

Native should use **bearer auth directly**.  
`/v1/auth/exchange` is not part of the native app’s primary auth flow.

---

## System and runtime status endpoints

| Endpoint | Native view / use | Read/Write | Min role | Live update | Contract/model dependencies | Readiness | Notes / gaps | Service |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /v1/engine/capabilities` | Dashboard engine capabilities card | Read | `readonly` | Poll 10s or dashboard-only refresh | Engine capabilities schema | Ready | Good dashboard material, no special risk | `SystemService` |
| `GET /v1/daemon/state` | Later diagnostics panel; possibly hidden debug section | Read | `readonly` | Poll on diagnostics screen | Daemon state schema | Ready | Not required for dashboard MVP | `SystemService` |
| `GET /v1/daemon/scheduler` | Dashboard / Command Center scheduler card | Read | `readonly` | Poll | Scheduler status schema | Ready | Strong v1 signal surface | `SystemService` |
| `GET /v1/usage/summary` | Dashboard, Usage & Security | Read | `readonly` | Poll | Usage summary schema | Ready | Stable and simple | `UsageSecurityService` |
| `GET /v1/security/audit` | Usage & Security, optional dashboard summary | Read | `operator` | Poll 10s–30s | Security audit response | Ready with wrapper | Operator-only; readonly tokens should show locked state | `UsageSecurityService` |
| `GET /v1/sessions` | Later session explorer / diagnostics | Read | `readonly` | Poll on demand | Session root records | Ready with wrapper | Useful later; not essential in v1 shell | `SystemService` |

### Native recommendation

These endpoints are enough to power a solid dashboard without any backend work.

---

## Execution / operator console endpoints

### Workspace, project, and profile metadata

| Endpoint | Native view / use | Read/Write | Min role | Live update | Contract/model dependencies | Readiness | Notes / gaps | Service |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /v1/workspaces` | App-wide workspace picker; Brain / Memory / Instructions context | Read | `operator` | Poll on connect or explicit refresh | Workspace list items | Ready with wrapper | Now part of the native app shell so workspace-sensitive surfaces stay aligned | `SystemService` |
| `GET /v1/projects` | Later label enrichment / filters | Read | `operator` | On demand | Project list items | Ready with wrapper | Same note as above | `OperationsService` |
| `GET /v1/profiles` | Later profile browser or label enrichment | Read | `operator` | On demand | Agent profile list items | Ready with wrapper | Useful later; not needed for first vertical slice | `OperationsService` |
| `GET /v1/profiles/:id` | Run/receipt enrichment later | Read | `operator` | On demand | Agent profile details | Defer | Nice-to-have, not core v1 | `OperationsService` |

### Tasks, jobs, runs, and receipts

| Endpoint | Native view / use | Read/Write | Min role | Live update | Contract/model dependencies | Readiness | Notes / gaps | Service |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /v1/tasks` | Command Center task-title mapping, later tasks browser | Read | `readonly` | Poll or load once per command-center refresh | Task records | Ready | Needed mainly to turn task ids into titles in command center | `OperationsService` |
| `GET /v1/tasks/:id` | Later task detail | Read | `readonly` | On demand | Task record | Ready | Nice later, not core v1 | `OperationsService` |
| `POST /v1/tasks` | Not in native v1 | Write | `service` | Refetch after success | Task create input/response | Defer | Task creation is broader than the initial operator-console mission | `OperationsService` |
| `GET /v1/jobs` | Jobs list, Command Center, Dashboard counts fallback | Read | `readonly` | Poll + SSE invalidation | Job records | Ready | Core v1 endpoint | `OperationsService` |
| `GET /v1/jobs/:id` | Job inspector / detail | Read | `readonly` | On demand + invalidation | Job record | Ready | Core v1 endpoint | `OperationsService` |
| `GET /v1/jobs/:id/lease` | Job inspector | Read | `readonly` | On demand | Job lease record | Ready with wrapper | Useful but secondary; load lazily | `OperationsService` |
| `POST /v1/jobs/:id/pause` | Job inspector action | Write | `service` | Refetch related job/runs after success | Job record nullable response | Ready | Good phase-4 mutation | `OperationsService` |
| `POST /v1/jobs/:id/resume` | Job inspector action | Write | `service` | Refetch related job/runs after success | Job record nullable response | Ready | Good phase-4 mutation | `OperationsService` |
| `POST /v1/jobs/:id/enqueue` | Job inspector action | Write | `service` | Refetch related job/runs after success | Job record nullable response | Ready | Good phase-4 mutation | `OperationsService` |
| `GET /v1/runs` | Runs list, Dashboard summaries, Command Center | Read | `readonly` | Poll + SSE invalidation | Run records | Ready | Core v1 endpoint | `OperationsService` |
| `GET /v1/runs/:id` | Run inspector/detail | Read | `readonly` | On demand + invalidation | Run record | Ready | Core v1 endpoint | `OperationsService` |
| `GET /v1/runs/:id/envelope` | Run detail execution policy section | Read | `readonly` | On demand | Execution envelope | Ready with wrapper | Very important native detail surface; nested and policy-heavy | `OperationsService` |
| `GET /v1/runs/:id/receipt` | Run detail linkage | Read | `readonly` | On demand + invalidation | Receipt record | Ready | 404 should map to “not yet available” | `OperationsService` |
| `GET /v1/runs/:id/reply` | Run detail reply summary | Read | `readonly` | On demand | Run reply | Ready | Strong operator value | `OperationsService` |
| `GET /v1/runs/:id/events` | Run timeline | Read | `readonly` | Poll while selected + invalidation | Run event records | Ready with wrapper | Essential for run forensics | `OperationsService` |
| `POST /v1/runs/:id/retry` | Run detail action | Write | `service` | Refetch job/run lists after success | Returns related job or null | Ready | Good phase-4 mutation | `OperationsService` |
| `POST /v1/runs/:id/cancel` | Run detail action | Write | `service` | Refetch run detail and lists after success | Returns run or null | Ready | Good phase-4 mutation | `OperationsService` |
| `GET /v1/receipts` | Receipts list | Read | `readonly` | Poll | Receipt records | Ready | Core v1 endpoint | `OperationsService` |
| `GET /v1/receipts/:id` | Receipt detail | Read | `readonly` | On demand | Receipt record with additive runtime section | Ready with wrapper | Runtime addendum is important; decode carefully | `OperationsService` |

### Interventions and instruction previews

| Endpoint | Native view / use | Read/Write | Min role | Live update | Contract/model dependencies | Readiness | Notes / gaps | Service |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /v1/interventions` | Dashboard counts, Command Center attention, Interventions list | Read | `readonly` | Poll + SSE invalidation | Intervention records | Ready | Core v1 endpoint | `OperationsService` |
| `POST /v1/interventions/:id/resolve` | Intervention detail action | Write | `operator` | Refetch after success | Intervention record or null | Ready | Good phase-4 mutation; operator token required | `OperationsService` |
| `GET /v1/instruction-previews/:scope` | Later Instructions screen | Read | `readonly` | On demand | Compiled instruction bundle | Ready with wrapper | Good later read-only native feature; not needed for first release | `OperationsService` |

### Native recommendation

This group is the heart of native v1.  
If the app only shipped Dashboard + Command Center + Runs + Jobs + Receipts + Interventions, it would already be meaningful.

---

## Governance and policy endpoints

### Approvals

| Endpoint | Native view / use | Read/Write | Min role | Live update | Contract/model dependencies | Readiness | Notes / gaps | Service |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /v1/approvals` | Approvals list, Dashboard attention summary | Read | `operator` | Poll + invalidation | Approval records | Ready with wrapper | Operator-only; central to governance view | `GovernanceService` |
| `GET /v1/approvals/:id` | Approval detail inspector | Read | `operator` | On demand | Approval record | Ready | Useful if list payload becomes slim later | `GovernanceService` |
| `POST /v1/approvals` | Not a native v1 workflow | Write | `operator` | N/A | Approval request input | Defer | Requesting approvals is not the first native operator workflow | `GovernanceService` |
| `POST /v1/approvals/:id/resolve` | Approval approve/deny action | Write | `operator` | Refetch after success | Approval resolve input | Ready | High-value phase-4 mutation | `GovernanceService` |

### Standing approvals, automation grants, security policy, vaults

| Endpoint | Native view / use | Read/Write | Min role | Live update | Contract/model dependencies | Readiness | Notes / gaps | Service |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /v1/policies/standing-approvals` | Later governance screen | Read | `operator` | Poll on screen | Standing approval records | Defer | Exists in web; not first native scope | `GovernanceService` |
| `POST /v1/policies/standing-approvals` | Later, if ever | Write | `operator` | Refetch after success | Create input | Defer | Form-heavy, web-first for now | `GovernanceService` |
| `POST /v1/policies/standing-approvals/:id/revoke` | Later | Write | `operator` | Refetch after success | Revoke input | Defer | Same reason | `GovernanceService` |
| `GET /v1/policies/automation-grants` | Later governance screen | Read | `operator` | Poll on screen | Automation grant records | Defer | Useful later; not needed early | `GovernanceService` |
| `POST /v1/policies/automation-grants` | Later | Write | `operator` | Refetch after success | Create input | Defer | Web-first | `GovernanceService` |
| `POST /v1/policies/automation-grants/:id/revoke` | Later | Write | `operator` | Refetch after success | Revoke input | Defer | Web-first | `GovernanceService` |
| `GET /v1/security/policy` | Later policy read-only page | Read | `operator` | Poll on screen | Security policy response | Ready with wrapper | Good later read view; not core v1 | `GovernanceService` |
| `GET /v1/vaults` | Later vault overview | Read | `operator` | Poll on screen | Vault records | Ready with wrapper | Sensitive but stable; later | `GovernanceService` |
| `GET /v1/vaults/:id` | Later vault detail | Read | `operator` | On demand | Vault record | Defer | Not first native need | `GovernanceService` |
| `POST /v1/vaults` | Not native v1 | Write | `operator` | Refetch after success | Vault create input | Defer | Too much admin breadth | `GovernanceService` |
| `POST /v1/vaults/:id/open` | Possibly later | Write | `operator` | Refetch after success | Vault open input | Defer | Sensitive workflow | `GovernanceService` |
| `POST /v1/vaults/:id/close` | Later maybe | Write | `operator` | Refetch after success | Vault record | Defer | Could be added after core console stabilizes | `GovernanceService` |
| `POST /v1/vaults/:id/seal` | Later maybe | Write | `operator` | Refetch after success | Vault record | Defer | Same reason | `GovernanceService` |

### Native recommendation

Only **Approvals** belongs in early native scope. The rest should wait.

---

## Connections and provider-management endpoints

### Connections overview

| Endpoint | Native view / use | Read/Write | Min role | Live update | Contract/model dependencies | Readiness | Notes / gaps | Service |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /v1/connections` | Connections overview page, dashboard health summary | Read | `operator` | Poll 5s–10s | Connection records incl. health/policy/sync/resource rules | Ready with wrapper | Good v1 read-only overview surface | `ConnectionsService` |
| `POST /v1/connections` | Not for early native | Write | `operator` | Refetch after success | Connection create input | Defer | Creation/setup is web-first | `ConnectionsService` |
| `PATCH /v1/connections/:id` | Not for early native | Write | `operator` | Refetch after success | Update input | Defer | Rich form flow; defer | `ConnectionsService` |
| `DELETE /v1/connections/:id` | Not for early native | Write | `operator` | Refetch after success | none | Defer | Destructive admin surface; web-first | `ConnectionsService` |

### OAuth sessions and deep remediation

| Endpoint | Native view / use | Read/Write | Min role | Live update | Contract/model dependencies | Readiness | Notes / gaps | Service |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `POST /v1/connections/oauth/start` | Setup hub Start Setup / Reconnect / Reauthorize for GitHub, Gmail, Calendar | Write | `operator` | Poll session after start | OAuth start request/response | Ready with wrapper | Native opens the default browser and refreshes in place after completion | `ConnectionsService` |
| `GET /v1/connections/oauth/sessions/:id` | Setup hub OAuth progress polling | Read | `operator` | Poll while flow active | OAuth session record | Ready with wrapper | Used only while the browser flow is active | `ConnectionsService` |
| `GET /v1/connections/:id/resource-rules` | Later resource-rule editor | Read | `operator` | Poll on screen | Resource rule records | Defer | Deep admin flow; web-first | `ConnectionsService` |
| `POST /v1/connections/:id/resource-rules` | Later resource-rule editor | Write | `operator` | Refetch after success | Create input | Defer | Deeper than v1 needs | `ConnectionsService` |
| `DELETE /v1/connections/:id/resource-rules` | Later resource-rule editor | Write | `operator` | Refetch after success | Delete input body | Defer | Same reason | `ConnectionsService` |
| `GET /v1/connections/:id/diagnostics` | Later diagnostics pane | Read | `operator` | On demand | Diagnostics response | Defer | Good later support surface | `ConnectionsService` |
| `POST /v1/connections/:id/reconnect` | Possible later quick action | Write | `operator` | Refetch after success | Reconnect input | Defer | Add only after read-only overview feels clean | `ConnectionsService` |
| `POST /v1/secrets` | Setup hub Telegram token storage | Write | `operator` | N/A | Secret reference record | Ready with wrapper | Used narrowly for Telegram bot-token handoff; app clears local token entry state immediately | `ConnectionsService` |

### Telegram control-plane and mutation receipt endpoints

| Endpoint | Native view / use | Read/Write | Min role | Live update | Contract/model dependencies | Readiness | Notes / gaps | Service |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /v1/config/telegram` | Setup hub Telegram detail pane | Read | `operator` | Poll on load / refresh | Telegram config snapshot | Ready with wrapper | Powers persisted vs applied truth, target workspace, warnings, and restart support | `ConnectionsService` |
| `POST /v1/config/telegram` | Save Telegram runtime settings from the app | Write | `operator` | Refetch after success | Telegram config update input/snapshot | Ready with wrapper | Narrow config mutation path; token values still go through `/v1/secrets` | `ConnectionsService` |
| `POST /v1/daemon/components/telegram/apply` | Apply saved Telegram config in-process | Write | `operator` | Refetch after success | Telegram apply response | Ready with wrapper | Preferred first step before a full daemon restart | `ConnectionsService` |
| `POST /v1/daemon/restart` | Setup hub restart action / remediation | Write | `operator` | Refetch after success or reconnect | Daemon restart response | Ready with wrapper | Returns `manual_required` when the daemon is not launchd-managed | `ConnectionsService` |
| `GET /v1/governance/mutation-receipts` | Setup hub Telegram mutation history | Read | `operator` | Poll on load / refresh | Mutation receipt list | Ready with wrapper | Supports recent save/apply/restart visibility in native Setup | `GovernanceService` |
| `GET /v1/governance/mutation-receipts/:id` | Later detailed mutation receipt inspector | Read | `operator` | On demand | Mutation receipt record | Ready with wrapper | Current native Setup only needs the list, but detail is available | `GovernanceService` |

### Native recommendation

v1 should use Setup + Connections together:
- **Setup** owns the quick-start provider actions and Telegram runtime guidance
- **Connections** remains the deeper diagnostics surface
- **Mutation receipts** make Telegram save/apply/restart actions observable without inventing hidden state

---

## Domain vertical endpoints

These surfaces exist and matter, but they are not where native should start.

### Email

| Endpoint(s) | Native view / use | Read/Write | Min role | Live update | Readiness | Notes / gaps | Service |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /v1/email/accounts`, `GET /v1/email/threads`, `GET /v1/email/threads/:id`, `GET /v1/email/messages/:id`, `GET /v1/email/search`, `GET /v1/email/digest`, `GET /v1/email/providers` | Later email browser/digest screen | Read | `operator` | Poll on screen | Ready with wrapper | Read paths exist and are stable enough, but not core operator-console scope | `DomainDigestService` |
| `POST /v1/email/accounts`, `POST /v1/email/sync`, `POST /v1/email/drafts`, `PATCH /v1/email/drafts/:id` | Later email account/draft tooling | Write | `operator` | Refetch after success | Defer | Web-first until native core is proven | `DomainDigestService` |

### Calendar

| Endpoint(s) | Native view / use | Read/Write | Min role | Live update | Readiness | Notes / gaps | Service |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /v1/calendar/accounts`, `GET /v1/calendar/events`, `GET /v1/calendar/events/:id`, `GET /v1/calendar/search`, `GET /v1/calendar/digest`, `GET /v1/calendar/availability` | Later calendar digest/search | Read | `operator` | Poll on screen | Ready with wrapper | Strong later candidate, but not core v1 | `DomainDigestService` |
| `POST /v1/calendar/accounts`, `POST /v1/calendar/sync`, `POST /v1/calendar/events`, `PATCH /v1/calendar/events/:id` | Later calendar tooling | Write | `operator` | Refetch after success | Defer | Leave web-first initially | `DomainDigestService` |

### GitHub

| Endpoint(s) | Native view / use | Read/Write | Min role | Live update | Readiness | Notes / gaps | Service |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /v1/github/accounts`, `GET /v1/github/repos`, `GET /v1/github/prs`, `GET /v1/github/prs/:id`, `GET /v1/github/issues`, `GET /v1/github/issues/:id`, `GET /v1/github/notifications`, `GET /v1/github/search`, `GET /v1/github/digest` | Later GitHub digest/search screen | Read | `operator` | Poll on screen | Ready with wrapper | Rich and useful, but not first native priority | `DomainDigestService` |
| `POST /v1/github/sync`, `POST /v1/github/comments`, `POST /v1/github/notifications/mark-read` | Later GitHub action flows | Write | `operator` | Refetch after success | Defer | Web-first | `DomainDigestService` |

### Todos

| Endpoint(s) | Native view / use | Read/Write | Min role | Live update | Readiness | Notes / gaps | Service |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /v1/todos/accounts`, `GET /v1/todos/items`, `GET /v1/todos/items/:id`, `GET /v1/todos/search`, `GET /v1/todos/digest`, `GET /v1/todos/projects` | Later todo dashboard | Read | `operator` | Poll on screen | Ready with wrapper | Could make a nice later native view, but not where to start | `DomainDigestService` |
| `POST /v1/todos/accounts`, `POST /v1/todos/items`, `POST /v1/todos/sync`, `POST /v1/todos/items/:id/complete`, `POST /v1/todos/items/:id/reprioritize`, `POST /v1/todos/items/:id/reschedule`, `POST /v1/todos/items/:id/move`, `POST /v1/todos/reconcile` | Later todo actions | Write | `operator` | Refetch after success | Defer | Broad, task-oriented admin UI; not native v1 | `DomainDigestService` |

### People

| Endpoint(s) | Native view / use | Read/Write | Min role | Live update | Readiness | Notes / gaps | Service |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /v1/people`, `GET /v1/people/:id`, `GET /v1/people/search`, `GET /v1/people/:id/merge-events`, `GET /v1/people/merge-suggestions`, `GET /v1/people/:id/activity` | Later people browser / suggestions / activity | Read | `operator` | Poll on screen | Ready with wrapper | Interesting later native read surface | `PeopleService` |
| `PATCH /v1/people/:id`, `POST /v1/people/merge`, `POST /v1/people/:id/split`, `POST /v1/people/identities/attach`, `POST /v1/people/identities/:id/detach` | Later people repair tooling | Write | `operator` | Refetch after success | Defer | Too much record surgery for v1 | `PeopleService` |

### Finance and medical

| Endpoint(s) | Native view / use | Read/Write | Min role | Live update | Readiness | Notes / gaps | Service |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /v1/finance/imports`, `GET /v1/finance/imports/:id`, `GET /v1/finance/transactions`, `GET /v1/finance/documents`, `GET /v1/finance/search`, `GET /v1/finance/digest` | Later finance digest/search | Read | `operator` | Poll on screen | Ready with wrapper | Read surfaces look viable later | `DomainDigestService` |
| `POST /v1/finance/imports`, `POST /v1/finance/transactions`, `POST /v1/finance/transactions/batch`, `POST /v1/finance/imports/:id/status` | Finance admin/import flows | Write | `service` | Refetch after success | Defer | Not core operator-console UX | `DomainDigestService` |
| `GET /v1/medical/imports`, `GET /v1/medical/imports/:id`, `GET /v1/medical/appointments`, `GET /v1/medical/medications`, `GET /v1/medical/documents`, `GET /v1/medical/search`, `GET /v1/medical/digest` | Later medical digest/search | Read | `operator` | Poll on screen | Ready with wrapper | Read surfaces viable later; sensitive | `DomainDigestService` |
| `POST /v1/medical/imports`, `POST /v1/medical/appointments`, `POST /v1/medical/medications`, `POST /v1/medical/imports/:id/status` | Medical admin/import flows | Write | `service` | Refetch after success | Defer | Not native v1 | `DomainDigestService` |

### Files and memory

| Endpoint(s) | Native view / use | Read/Write | Min role | Live update | Readiness | Notes / gaps | Service |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /v1/files/roots`, `GET /v1/files/roots/:id`, `GET /v1/files/search`, `GET /v1/files/documents/:id`, `GET /v1/files/write-intents`, `GET /v1/files/write-intents/:id` | Later files explorer / review queue | Read | `operator` | Poll on screen | Ready with wrapper | Good later native read surface, but broad | `FilesService` |
| `POST /v1/files/roots`, `PATCH /v1/files/roots/:id`, `DELETE /v1/files/roots/:id`, `POST /v1/files/roots/:id/reindex`, `POST /v1/files/write-intents`, `POST /v1/files/write-intents/:id/review` | Files admin/review | Write | `operator` | Refetch after success | Defer | Do not start native here | `FilesService` |
| `GET /v1/memory/search`, `GET /v1/memory`, `GET /v1/memory/:id`, `GET /v1/memory/audit` | Later memory explorer/search | Read | `operator` | Poll on screen or manual refresh | Ready with wrapper | Good later read-only native candidate | `MemoryService` |
| `POST /v1/memory/maintenance`, `POST /v1/memory/import` | Memory administration | Write | `operator` | Refetch after success | Defer | Not v1 native | `MemoryService` |

### Native recommendation

All of these domain surfaces are **possible later**, but they should not compete with the operator-console core during initial implementation.

---

## Web inspector to native mapping

| Web inspector view | Native equivalent | Native disposition | Why |
| --- | --- | --- | --- |
| Dashboard | Dashboard | **Mirror + adapt** | Strong home view for native |
| Command Center | Command Center | **Adapt heavily for split-view Mac UX** | This is the highest-value native operational surface |
| Runs | Runs | **Mirror + adapt** | Core runtime visibility |
| Run Detail | Runs inspector / dedicated detail route later | **Mirror + adapt** | Envelope/events/reply fit native inspector well |
| Jobs | Jobs | **Mirror + adapt** | Core runtime visibility |
| Receipts | Receipts | **Mirror + adapt** | Strong audit surface |
| Receipt Detail | Receipt inspector / dedicated detail route later | **Mirror + adapt** | Runtime/timeline data suits native detail panes |
| Instructions | Instructions | **Later, read-only** | Useful but secondary |
| Interventions | Interventions | **Mirror** | Key operator queue |
| Approvals | Approvals | **Mirror** | Key operator queue |
| Standing Approvals | Standing Approvals | **Defer** | Form-heavy admin flow |
| Automation Grants | Automation Grants | **Defer** | Same |
| Connections | Connections overview | **Adapt / narrow** | Use native for health summary, not full authoring first |
| Email | Email | **Defer** | Useful later, not first-wave |
| Calendar | Calendar | **Defer** | Same |
| GitHub | GitHub | **Defer** | Same |
| People | People | **Defer** | Too broad for v1 |
| Todos | Todos | **Defer** | Broad CRUD |
| Finance | Finance | **Later read-only** | Candidate later, not initial |
| Medical | Medical | **Later read-only** | Candidate later, not initial |
| Files | Files | **Defer** | Admin-heavy |
| Vaults | Vaults | **Defer / maybe later limited status** | Sensitive admin surface |
| Security Policy | Usage & Security (summary only) | **Adapt / narrow** | Native should show risk posture before editing policy |
| Memory | Memory search | **Later read-only** | Valuable later but not initial |
| Usage | Usage & Security | **Mirror + adapt** | Good v1 fit |

---

## Operator workflows already present elsewhere but missing from native today

| Workflow | Today’s surface | Native first-wave status | Recommendation |
| --- | --- | --- | --- |
| Live daemon + scheduler supervision | Web inspector | Bring native first | Core native value |
| Run/job/receipt investigation | Web inspector | Bring native first | Core native value |
| Interventions + approvals | Web inspector | Bring native first | Core native value |
| Deep connections/OAuth/remediation | Web inspector | Missing | Keep web-first initially |
| Daemon install/start/stop/status | CLI / installer | Missing | Keep CLI-first unless explicit API appears |
| Upgrade verify/rollback | CLI | Missing | Keep CLI-first |
| Files admin/write-intent review | Web inspector / CLI | Missing | Defer |
| People merge/split/identity repair | Web inspector / CLI | Missing | Defer |
| Finance/medical imports | CLI / web | Missing | Defer |
| Memory maintenance/import | Web inspector / CLI | Missing | Defer |

---

## Initial native scope recommendation by surface

### In native v1

- Dashboard
- Command Center
- Runs
- Jobs
- Receipts
- Interventions
- Approvals
- Usage & Security
- Connections overview (read-only / narrow)

### In native later, likely read-only first

- Instructions
- Memory search
- People browser
- Finance digest/search
- Medical digest/search
- Email / Calendar / GitHub digests

### Remain web-first or CLI-first initially

- connection setup/remediation
- policy authoring
- files admin/write review
- daemon lifecycle management
- upgrades/migrations
- broad domain CRUD

---

## API refinement recommendations

These are the backend changes most likely to improve native implementation quality.

### 1. Add auth-context endpoint

Needed for:
- role-aware UI
- write-surface gating
- better connection diagnostics

### 2. Repair schema/codegen output

Needed for:
- generated Swift transport types
- contract confidence at scale
- less hand-maintained DTO duplication

### 3. Consider command-center summary endpoints if needed

Only if polling fan-out becomes clumsy:
- `GET /v1/command-center/summary`
- `GET /v1/runs/active`
- `GET /v1/jobs/active`

### 4. Clarify daemon lifecycle route strategy

The native app should not invent process control because a historical doc once mentioned it.

---

## Final API surface recommendation

For the first native implementation, treat these as the **golden path**:

- `GET /v1/health`
- `GET /v1/status`
- `GET /v1/engine/capabilities`
- `GET /v1/daemon/scheduler`
- `GET /v1/usage/summary`
- `GET /v1/events/stream`
- `GET /v1/tasks`
- `GET /v1/jobs`
- `GET /v1/jobs/:id`
- `GET /v1/jobs/:id/lease`
- `GET /v1/runs`
- `GET /v1/runs/:id`
- `GET /v1/runs/:id/envelope`
- `GET /v1/runs/:id/events`
- `GET /v1/runs/:id/reply`
- `GET /v1/runs/:id/receipt`
- `GET /v1/receipts`
- `GET /v1/receipts/:id`
- `GET /v1/interventions`
- `GET /v1/approvals`
- `GET /v1/connections`
- `GET /v1/security/audit`
- `GET /v1/security/csrf-token`
- `POST /v1/runs/:id/retry`
- `POST /v1/runs/:id/cancel`
- `POST /v1/jobs/:id/pause`
- `POST /v1/jobs/:id/resume`
- `POST /v1/jobs/:id/enqueue`
- `POST /v1/interventions/:id/resolve`
- `POST /v1/approvals/:id/resolve`

That set is already enough to build a serious native operator console without crossing Popeye’s architectural boundaries.
