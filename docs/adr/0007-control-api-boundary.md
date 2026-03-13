# ADR 0007: Control API boundary

- Status: Accepted
- Date: 2026-03-13

## Decision

All operator clients (CLI, macOS app, web inspector, Telegram adapter) access runtime state exclusively through the versioned `/v1/*` HTTP API served by the daemon. No client may read SQLite databases, Pi session files, or runtime internals directly.

## Rules

- CLI uses the API when the daemon is reachable; falls back to direct `createRuntimeService()` when offline.
- Generated clients (`@popeye/api-client`, Swift models) are the reference bindings for the API surface.
- Interfaces must not import `@popeye/runtime-core` directly for data access — only for offline CLI fallback.
- The API is loopback-only, auth-required, and CSRF-protected per ADR 0006.
- All response shapes are defined as Zod schemas in `@popeye/contracts` and validated by contract tests.

## Consequences

- CLI gains a daemon-connectivity check; commands print `[daemon]` or `[direct]` to indicate which path was taken.
- Phase 9 clients (macOS, web) need only `@popeye/api-client` — no runtime dependency.
- API schema changes require contract test updates; breaking changes require a new version prefix.
- Offline fallback keeps the CLI useful without a running daemon but limits it to the subset of commands that can operate standalone.
