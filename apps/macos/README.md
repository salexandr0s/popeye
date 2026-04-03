# Popeye macOS Client

Native Swift macOS operator console for the Popeye agent platform.

## Status

**Active development** — the native shell now includes Home, Setup, Brain, Automations, a native curated-markdown editor, and the first full set of life-domain surfaces, all backed by the control API.

## Requirements

- macOS 15+ (Sequoia)
- Swift 6.0+
- Xcode 16+

## Build

```bash
cd apps/macos/PopeyeMac
swift build
```

## Test

```bash
cd apps/macos/PopeyeMac
swift test
```

## Package app bundle

From the repo root:

```bash
bash scripts/build-macos-app.sh
```

That produces `dist/pkg/PopeyeMac.app` with the bundled companion CLI at `Contents/Resources/Bootstrap/pop`.
The packaged bootstrap closure now includes only runtime dependency files, not test/docs/build-source extras.

To sign/notarize the packaged macOS artifacts after building them:

```bash
bash scripts/sign-pkg.sh
```

This upgrades `dist/pkg/PopeyeMac.app`, `dist/pkg/popeye-<version>-darwin.tar.gz`, and `dist/pkg/popeye-<version>-darwin.pkg` to the final signed artifact set when Developer ID credentials are available.

For local/dev packaging, missing signing identities leave the artifacts marked as local-only in `dist/pkg/SIGNING-STATUS.md`. The GitHub release workflow is stricter and now requires signing identities before it will publish release artifacts.

## Open in Xcode

```bash
cd apps/macos/PopeyeMac
open Package.swift
```

## Architecture

- **PopeyeAPI** — reusable library: `ControlAPIClient` actor, DTOs, services, auth, SSE
- **PopeyeMac** — SwiftUI app: `NavigationSplitView` shell, feature stores, views
- All data flows through the loopback control API (`http://127.0.0.1:3210/v1/`)
- No direct SQLite or runtime file access
- Bearer auth + CSRF for mutations
- `@Observable` + Swift Concurrency throughout

## Scope (current foundation)

- Home landing page
- Dashboard
- Command Center (live operational cockpit)
- Runs / Jobs / Receipts investigation
- Interventions / Approvals
- Setup hub with provider readiness, bootstrap visibility, and drill-through into connection details
- In-app GitHub / Gmail / Google Calendar Start Setup / Reconnect / Reauthorize actions
- Connections overview
- Brain overview for active identity, soul, instruction composition, and playbook visibility
- Native curated markdown editing for instruction and curated-memory documents, with rendered preview, diff/propose/apply save flow, revision conflict handling, and receipts
- Automations hub with workspace-aware heartbeat/scheduled visibility, week projection, enable/disable + supported cadence editing, pause/resume/run-now controls, and inline “why won’t this run?” context
- Mail / Calendar / Todos read surfaces built as native split views on top of the existing control API
- People repair actions for merge, split, and identity attach/detach
- Files root management and write-intent review actions
- Finance and Medical high-trust surfaces with vault open/close, import, digest, and record-entry actions
- Usage & Security summary
- Recent control-plane change visibility in Usage & Security
- Memory with Search / Browse / Daily timeline modes
- Instructions / Agent Profiles / Telegram / Scheduler
- App-wide workspace picker that retargets Home / Brain / Memory / Instructions / Automations / workspace-scoped read surfaces to the selected workspace
- Telegram control-plane visibility for persisted vs applied config, apply-now, restart, and recent mutation receipts
- Narrow mutation set: retry/cancel run, pause/resume/enqueue job, resolve intervention, approve/deny, automation enable/disable, supported automation cadence editing, automation pause/resume/run-now

## Product direction

The current app is the foundation, not the end state.

This slice keeps the existing operator-console routes intact while moving the app toward a more Mac-native personal control center shape:
- **Setup** becomes the onboarding and readiness hub for the daemon session and connected providers
- **Brain** becomes the overview surface for identity, soul, instruction composition, and related assistant context
- **Home** becomes the calm daily landing page for setup health, pending operator attention, automations, upcoming work, memory, and recent control changes, now backed by a dedicated summary API
- **Memory Daily** adds a calm day-grouped review mode instead of only raw operational browsing
- **Workspace selection** is app-wide so Brain, Memory, Instructions, and Automations stay aligned to one current context
- **Telegram setup** is now honest and control-plane-driven: token storage + config save/apply can happen from the app, but bridge activity still determines whether setup is truly complete
- **Automations** is now a product-facing scheduler overview rather than forcing users into raw jobs tables first
- **Instructions + curated memory docs** now use a proper native markdown editor with preview, save review, and revision-safe apply flow
- **Mail / Calendar / Todos** remain read-first daily-use surfaces
- **People / Files / Finance / Medical** now include narrow operator-safe mutations on top of their native read surfaces
- **Automation editing** remains intentionally narrow, but now includes heartbeat cadence editing in addition to interval-backed scheduled automations with a real persisted schedule row


The next product direction is to evolve the macOS app from an operator console into the primary personal-assistant control center for setup, brain/memory management, automations, domain surfaces, and system health.

See:
- `docs/internal/dashboard/product_direction.md`
- `docs/internal/dashboard/personal_control_center_roadmap.md`
- `docs/internal/dashboard/personal_control_center_agent_prompt.md`

The architectural constraints in `docs/internal/dashboard/architecture.md` still apply.
