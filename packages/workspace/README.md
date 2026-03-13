# @popeye/workspace

Critical file write policy for operator-owned files. Enforces that files like
WORKSPACE.md, PROJECT.md, IDENTITY.md, and HEARTBEAT.md are read-only by
default and require explicit operator approval for modifications. Prevents
agents from silently mutating instruction files.

## Key exports

- `WORKSPACE_CRITICAL_FILES` -- set of protected file paths
- `canWriteWorkspacePath(path, options)` -- policy check for write permission

## Dependencies

- `@popeye/contracts`
- `@popeye/runtime-core`

## Layer

Runtime domain. Policy enforcement for workspace file operations.
