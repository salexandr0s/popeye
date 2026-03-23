# Follow-up Implementation Prompt for a Coding Agent

You are implementing the native Swift macOS dashboard/client for Popeye.

The repo has already been audited. Do **not** restart from generic assumptions. Use the planning documents in `docs/macos-dashboard/` as the implementation contract.

## Required source documents

Read and follow these before changing code:

- `docs/macos-dashboard/design.md`
- `docs/macos-dashboard/architecture.md`
- `docs/macos-dashboard/buildplan.md`
- `docs/macos-dashboard/api_surface_map.md`
- `docs/macos-dashboard/component_inventory.md`
- `docs/macos-dashboard/checklist.md`
- `docs/macos-dashboard/open_questions.md`

Also respect current repo truth from:
- `README.md`
- `architecture.md`
- `buildplan.md`
- `agents.md`
- `docs/control-api.md`
- `docs/api-contracts.md`
- `docs/ui-surface.md`
- `apps/macos/README.md`
- `apps/web-inspector/*`
- `packages/control-api/*`
- `packages/api-client/*`
- `packages/contracts/*`

## Non-negotiable constraints

1. The macOS app must remain behind the Popeye control API boundary.
2. No direct SQLite reads.
3. No runtime-file heuristics as a substitute for real endpoints.
4. No business logic smeared through SwiftUI views.
5. Do not invent a second backend or helper daemon.
6. Do not use a WebView to fake native implementation.
7. Do not widen scope into broad parity before the operator-console core is working.
8. Do not treat the current generated Swift models as the canonical app model layer unless you first fix the generation pipeline and keep the UI insulated behind adapters.

## Implementation posture

Follow the build plan phase order. Make the smallest clean slice that works end to end before moving on.

### Implementation order

1. app shell and connect/bootstrap flow
2. credential storage and low-level API client
3. dashboard MVP
4. command center
5. runs/jobs/receipts drill-downs
6. interventions/approvals read paths
7. controlled mutations
8. polish/testing/hardening

Do not jump to files/people/finance/medical/todos/connections parity early.

## Architecture expectations

Implement the structure described in `architecture.md`:

- app shell under `apps/macos/`
- low-level `ControlAPIClient`
- service layer grouped by backend concern
- feature stores/view models owning UI state and derived display models
- Swift Concurrency
- polling plus SSE invalidation
- Keychain-backed bearer token storage
- minimal local persistence (prefs only; no persistent runtime-data cache)

## Model strategy

For the first implementation slices:

- use hand-authored `Codable` DTOs for the subset of endpoints you actually need
- keep them close to current control API payloads
- map DTOs to display models/view models
- do not block on global Swift codegen fixes

If you improve the generation pipeline, keep the app insulated so generated churn does not spill into SwiftUI views.

## Scope boundaries

### In scope first

- Dashboard
- Command Center
- Runs
- Jobs
- Receipts
- Interventions
- Approvals
- Usage & Security
- Connections overview (narrow)

### Out of scope until later

- deep connection/OAuth setup/remediation
- files admin/write-intent review
- people merge/split/identity repair
- finance/medical import administration
- broad Todo CRUD
- daemon lifecycle controls without explicit API support
- broad policy/vault admin parity

## How to work

- Make incremental, reviewable changes.
- Keep the app buildable at the end of each step.
- Update `apps/macos/README.md` when the native client moves from deferred to active implementation.
- Prefer small, focused commits/patches over broad scaffolding dumps.
- Add tests as you add architecture, not at the very end.
- Keep fixtures/previews grounded in real repo contracts and actual API payload shapes.

## Verification requirements

For each implementation step, verify with both code-level tests and a real running daemon when possible.

Minimum expectations:

- unit tests for networking/auth/CSRF behavior
- unit tests for derived heuristics and formatting
- preview/mock coverage for major screens
- UI smoke tests for bootstrap and primary navigation
- manual live verification against loopback control API

Do not mark a phase complete without checking the acceptance criteria in `docs/macos-dashboard/buildplan.md` and the phase checkboxes in `docs/macos-dashboard/checklist.md`.

## Handling missing backend support

If implementation reveals a real backend gap:

1. confirm it is actually missing in current repo truth
2. prefer a small additive API/contract refinement
3. document the gap in `docs/macos-dashboard/open_questions.md`
4. do **not** workaround it by coupling the app to runtime internals

Examples of acceptable backend refinements:
- auth/principal introspection endpoint
- additive command-center summary endpoints if profiling justifies them
- codegen/schema export repair

Examples of unacceptable client workarounds:
- parsing auth store internals from runtime data dir
- reading SQLite directly for richer detail
- shelling out to hidden scripts to simulate missing API

## UI expectations

Lean into native macOS strengths:

- split-view shell
- tables for dense runtime lists
- inspector panes for detail
- keyboard-friendly navigation
- clear stale/live states
- copyable ids and CLI snippets where useful

Do not build a consumer-style mobile UI.

## Finish condition for the first serious milestone

The first serious milestone is reached when the app can:

- connect to a local Popeye daemon with a bearer token
- show a useful dashboard
- run a live command center
- inspect runs/jobs/receipts well
- show interventions/approvals
- perform the narrow approved mutation set safely
- remain fully inside the control API boundary

Implement toward that milestone without architectural drift.
