# @popeye/workspace

Critical file write policy for operator-owned workspace files. Prevents agents
from silently mutating instruction files that define platform behavior.

## Purpose

Enforces that critical instruction files (`WORKSPACE.md`, `PROJECT.md`,
`IDENTITY.md`, `HEARTBEAT.md`) are read-only by default and require explicit
operator approval before any modification. This is a security boundary that
ensures operator-owned files remain under human control.

## Layer

Runtime domain. Policy enforcement for workspace file operations.

## Provenance

New platform implementation.

## Key exports

| Export                      | Description                                          |
| --------------------------- | ---------------------------------------------------- |
| `WORKSPACE_CRITICAL_FILES`  | Tuple of protected file names                        |
| `canWriteWorkspacePath()`   | Evaluate write policy: returns `true` only if the file is non-critical or explicitly approved |

## Dependencies

- `@popeye/contracts` -- shared types
- `@popeye/runtime-core` -- `evaluateCriticalFileMutation()` policy function

## Usage

```ts
import { canWriteWorkspacePath, WORKSPACE_CRITICAL_FILES } from '@popeye/workspace';

if (!canWriteWorkspacePath('WORKSPACE.md', false)) {
  console.log('Write denied -- operator approval required');
}
```
