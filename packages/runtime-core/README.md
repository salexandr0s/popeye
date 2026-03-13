# @popeye/runtime-core

Core runtime services for the Popeye platform. This is the central orchestration
layer that wires together all domain packages into a cohesive runtime.

## Purpose

Provides `PopeyeRuntimeService`, the main service class that orchestrates tasks,
jobs, and runs. Manages SQLite databases (WAL mode, foreign keys), bearer token
authentication, CSRF protection, prompt injection detection, configuration
loading, database backup/restore, security audit, memory lifecycle, message
ingestion, and macOS platform integration (Keychain, launchd).

## Layer

Runtime core. Central service layer between domain packages and interfaces.

## Provenance

New platform implementation.

## Key exports

| Export                            | Description                                             |
| --------------------------------- | ------------------------------------------------------- |
| `PopeyeRuntimeService`           | Main runtime orchestrator (tasks, jobs, runs, scheduler)|
| `createRuntimeService(config)`   | Factory for the runtime service                         |
| `loadAppConfig(path)`            | Configuration loading with Zod validation               |
| `deriveRuntimePaths(dir)`        | Compute standard runtime directory layout               |
| `ensureRuntimePaths(config)`     | Create runtime directories with secure permissions      |
| `initAuthStore()` / `rotateAuthStore()` | Bearer token management                           |
| `validateBearerToken()`          | Token validation for API requests                       |
| `validateCsrfToken()` / `issueCsrfToken()` | CSRF protection for mutations                  |
| `detectPromptInjection(text)`    | Prompt injection detection on untrusted input           |
| `openRuntimeDatabases(paths)`    | SQLite initialization and migration                     |
| `runLocalSecurityAudit(config)`  | Security posture scan (config, permissions, secrets)    |
| `createBackup()` / `restoreBackup()` | Database backup and restore                         |
| `registerLaunchd()` / `queryKeychain()` | macOS platform integration                        |
| `MemoryLifecycleService`         | Memory consolidation, daily summaries, compaction flush |
| `MessageIngestionService`        | Message ingestion with redaction and rate limiting      |

## Dependencies

- `@popeye/contracts` -- domain types
- `@popeye/engine-pi` -- engine adapter
- `@popeye/instructions` -- instruction bundle compilation
- `@popeye/memory` -- memory search and storage
- `@popeye/observability` -- redaction utilities
- `@popeye/receipts` -- receipt I/O
- `@popeye/scheduler` -- retry delay calculation
- `@popeye/sessions` -- session root selection
- `better-sqlite3` -- SQLite driver

## Usage

```ts
import { loadAppConfig, createRuntimeService } from '@popeye/runtime-core';

const config = loadAppConfig('/path/to/config.json');
const runtime = createRuntimeService(config);
runtime.startScheduler();
const { task, job, run } = runtime.createTask({ ... });
await runtime.close();
```

See `src/*.test.ts` for tests covering auth, database, backup, launchd,
security audit, runtime service, and state guards.
