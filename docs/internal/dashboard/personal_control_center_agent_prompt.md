# Worker Prompt — Evolve Popeye Mac App into the Personal Control Center

You are working in the Popeye repo.

Before doing anything else, read and follow:
- `AGENTS.md`
- `apps/macos/README.md`
- `docs/internal/dashboard/architecture.md`
- `docs/internal/dashboard/product_direction.md`
- `docs/internal/dashboard/personal_control_center_roadmap.md`

Treat those docs as the source of truth.

## Required workflow
Follow exactly:
1. inspect
2. classify
3. plan
4. implement
5. test
6. document
7. report

Before any execution, explicitly state:
- Layer
- Provenance
- Scope
- Security impact
- Memory impact

## Mission
The current macOS app is a real operator console, but it is still too operations-heavy.

Your mission is to move it toward the product direction defined in:
- `docs/internal/dashboard/product_direction.md`
- `docs/internal/dashboard/personal_control_center_roadmap.md`

### Do not try to build the whole roadmap at once.
Implement only the **next slice**:

## Target slice
**Setup + Brain foundation**

Build the smallest correct, shippable slice that adds:
1. a **Setup hub** for connection/bootstrap visibility
2. improved **Brain** surfaces for identity / soul / instruction visibility
3. the foundation of a **daily memory calendar/timeline** view

## Scope for this slice

### MUST include
- a new or expanded Setup surface in the mac app
- clear provider setup/health cards for currently supported providers
- distinction between connected / missing / degraded / reauth-required states
- better in-app visibility into:
  - active identity
  - soul
  - instruction composition
- a first daily-memory browsing mode:
  - timeline or calendar-backed daily grouping
- preserve current working operator-console routes

### SHOULD include
- setup checklist/progress indicator
- friendly explanations for incomplete setup
- drill-through from setup cards into existing connection details
- stronger Brain navigation grouping so the app feels less like a raw ops shell

### MUST NOT do
- no direct SQLite or runtime-file reads
- no bypass of control API/auth/CSRF
- no broad rewrite of the app shell
- no provider feature invention outside existing API support
- no giant visual redesign disconnected from the current app foundation
- no hidden mutation of instruction files

## Important repo truth
The current app already has:
- app shell
- connect/auth screen
- dashboard
- command center
- runs/jobs/receipts/interventions/approvals
- connections overview
- memory view
- instruction preview
- agent profiles
- telegram
- scheduler

You are extending that foundation, not replacing it.

## Likely files to inspect first
- `apps/macos/PopeyeMac/Sources/PopeyeMac/App/*`
- `apps/macos/PopeyeMac/Sources/PopeyeMac/Navigation/*`
- `apps/macos/PopeyeMac/Sources/PopeyeMac/Features/Connections/*`
- `apps/macos/PopeyeMac/Sources/PopeyeMac/Features/Memory/*`
- `apps/macos/PopeyeMac/Sources/PopeyeMac/Features/InstructionPreview/*`
- `apps/macos/PopeyeMac/Sources/PopeyeMac/Features/AgentProfiles/*`
- `apps/macos/PopeyeMac/Sources/PopeyeAPI/*`

Also inspect the existing API DTOs/services before inventing new client-side models.

## Deliverables
- code for the Setup + Brain slice
- tests for the new behavior
- docs updates where needed
- keep the current app bootable and useful at the end of the change

## Testing expectations
At minimum run:
- `cd apps/macos/PopeyeMac && swift test`
- any repo-level checks needed for touched code/docs

If you add or change API-facing DTO/service usage, add tests.

## Report format
End with:
- Intent
- Layer
- Provenance
- Files changed
- Tests run
- Docs updated
- Risks / follow-ups
