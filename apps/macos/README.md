# Popeye macOS Client

Native Swift macOS operator console for the Popeye agent platform.

## Status

**Active development** — Phase 1 foundation is in place, with the first Setup + Brain product slice now added and the follow-up actionable Setup flow now wired through the control API.

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

- Dashboard home
- Command Center (live operational cockpit)
- Runs / Jobs / Receipts investigation
- Interventions / Approvals
- Setup hub with provider readiness, bootstrap visibility, and drill-through into connection details
- In-app GitHub / Gmail / Google Calendar Start Setup / Reconnect / Reauthorize actions
- Connections overview
- Brain overview for active identity, soul, instruction composition, and playbook visibility
- Usage & Security summary
- Memory with Search / Browse / Daily timeline modes
- Instructions / Agent Profiles / Telegram / Scheduler
- App-wide workspace picker that retargets Brain / Memory / Instructions to the selected workspace
- Telegram control-plane visibility for persisted vs applied config, apply-now, restart, and recent mutation receipts
- Narrow mutation set: retry/cancel run, pause/resume/enqueue job, resolve intervention, approve/deny

## Product direction

The current app is the foundation, not the end state.

This slice keeps the existing operator-console routes intact while moving the app toward a more Mac-native personal control center shape:
- **Setup** becomes the onboarding and readiness hub for the daemon session and connected providers
- **Brain** becomes the overview surface for identity, soul, instruction composition, and related assistant context
- **Memory Daily** adds a calm day-grouped review mode instead of only raw operational browsing
- **Workspace selection** is app-wide so Brain, Memory, and Instructions stay aligned to one current context
- **Telegram setup** is now honest and control-plane-driven: token storage + config save/apply can happen from the app, but bridge activity still determines whether setup is truly complete


The next product direction is to evolve the macOS app from an operator console into the primary personal-assistant control center for setup, brain/memory management, automations, domain surfaces, and system health.

See:
- `docs/internal/dashboard/product_direction.md`
- `docs/internal/dashboard/personal_control_center_roadmap.md`
- `docs/internal/dashboard/personal_control_center_agent_prompt.md`

The architectural constraints in `docs/internal/dashboard/architecture.md` still apply.
