# PopeyeMac

Native macOS SwiftUI client for Popeye.

## Structure

- `Sources/PopeyeMac/App` — app shell, navigation, workspace context, connection/bootstrap state
- `Sources/PopeyeMac/Navigation` — split-view shell and route destination wiring
- `Sources/PopeyeMac/Features` — feature views and feature stores
- `Sources/PopeyeAPI` — typed control API client, DTOs, services, SSE support
- `Tests/PopeyeMacTests` / `Tests/PopeyeAPITests` — unit and integration-style package tests

## App-shell boundaries

- `AppModel` is the top-level environment container.
- `AppNavigationModel` owns persisted route selection.
- `WorkspaceContext` owns persisted workspace selection and current workspace metadata.
- `AppStoreRegistry` owns lazy feature-store creation and teardown.
- Runtime truth still lives behind `PopeyeAPI`; the app must not read runtime files or SQLite directly.

## Local verification

```bash
cd apps/macos/PopeyeMac
swift test
swift build
```
