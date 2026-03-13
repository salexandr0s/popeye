# @popeye/runtime-core

Core runtime services for the Popeye platform. Provides the central
`PopeyeRuntimeService` that orchestrates tasks, jobs, and runs. Manages
SQLite databases (WAL mode, foreign keys), authentication, CSRF protection,
prompt injection detection, configuration loading, backup, security audit,
and macOS integration (Keychain, launchd).

## Key exports

- `PopeyeRuntimeService` -- main runtime orchestrator
- `loadConfig(path)` / `resolveConfigPaths()` -- configuration loading with Zod validation
- `createAuthStore()` / `validateBearerToken()` -- token-based authentication
- `validateCsrf()` -- CSRF protection for state-changing endpoints
- `detectPromptInjection(text)` -- prompt injection detection on untrusted input
- `openRuntimeDatabases(paths)` -- SQLite database initialization and migration
- `runSecurityAudit(config)` -- scan config, permissions, ports, and secret storage
- `registerLaunchd()` / `queryKeychain()` -- macOS platform integration
- `backupDatabases(paths, dest)` -- database backup utility

## Dependencies

- `@popeye/contracts`, `@popeye/engine-pi`, `@popeye/instructions`
- `@popeye/memory`, `@popeye/observability`, `@popeye/receipts`
- `@popeye/scheduler`, `@popeye/sessions`
- `better-sqlite3`

## Layer

Runtime core. Central service layer between domain packages and interfaces.
