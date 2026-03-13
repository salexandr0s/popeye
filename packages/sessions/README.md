# @popeye/sessions

Deterministic session root ID generation for the Popeye runtime. Produces stable,
reproducible session identifiers so that related runs share a session lineage
without relying on random IDs.

## Purpose

Given a session kind (interactive, telegram, heartbeat, scheduled) and a scope
(workspace or project identifier), computes a deterministic session root ID.
This ensures that runs from the same source and scope are grouped under the same
session tree, enabling session continuity and compaction.

## Layer

Runtime domain. Pure logic with no I/O or side effects.

## Provenance

New platform implementation.

## Key exports

| Export                | Description                                                  |
| --------------------- | ------------------------------------------------------------ |
| `selectSessionRoot()` | Compute a deterministic `SessionRootRecord` from kind+scope  |
| `SessionSelectionInput` | Input type: `{ kind: SessionRootKind; scope: string }`     |

## Dependencies

- `@popeye/contracts` -- `SessionRootKind`, `SessionRootRecord` types

## Usage

```ts
import { selectSessionRoot } from '@popeye/sessions';

const root = selectSessionRoot({ kind: 'interactive_main', scope: 'workspace:default' });
// root.id => 'interactive_main:workspace:default'
```

See `src/index.test.ts` for determinism and kind-mapping tests.
