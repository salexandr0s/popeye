# Popeye macOS Client

Native Swift macOS operator console for the Popeye agent platform.

## Status

**Active development** — Phase 1 (app shell + API client foundation) complete.

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

## Scope (v1)

- Dashboard home
- Command Center (live operational cockpit)
- Runs / Jobs / Receipts investigation
- Interventions / Approvals
- Connections overview (read-only)
- Usage & Security summary
- Narrow mutation set: retry/cancel run, pause/resume/enqueue job, resolve intervention, approve/deny

See `docs/internal/dashboard/` for detailed planning documents.
