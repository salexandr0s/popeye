# Popeye macOS Client (Deferred)

Native Swift macOS client for the Popeye agent platform. **Deferred until the web inspector validates the API boundary.**

## Planned Approach

- `ControlAPIClient` using `URLSession` + `Codable` structs
- Generated from JSON Schema once the API is stable
- Daemon management (start/stop/restart via control API)
- Read-only views matching web inspector scope

## Architecture

- Separate API client layer (`Sources/PopeyeAPI/`)
- No business logic in views
- No direct file or DB reads — all data flows through the control API
- SwiftUI views matching the web inspector's 8 view areas

## Prerequisites

- Phase 9 web inspector validated and stable
- API contracts finalized with response schemas
- OpenAPI or JSON Schema export available

## Status

Not started. See `docs/ui-surface.md` for the web inspector that ships first.
