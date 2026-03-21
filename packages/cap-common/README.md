# @popeye/cap-common

Shared utilities for capability packages (`cap-*`).

## Exports

- `applyCapabilityMigrations(db, migrations)` — Run schema migrations on a capability SQLite database
- `openCapabilityDb(storesDir, dbFileName, migrations)` — Open and initialize a capability database (WAL mode, FK enabled, migrations applied)
- `prepareGet<T>`, `prepareAll<T>`, `prepareRun` — Typed SQLite prepared statement wrappers
- `authorizeContextRelease(ctx, taskContext, input)` — Shared context-release authorization for capability tools
- `CapabilityDb` — Type alias for the capability database handle
- `CapabilityMigration` — Interface for migration definitions
