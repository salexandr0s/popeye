# @popeye/sessions

Deterministic session root ID generation. Produces stable, reproducible session
identifiers based on the session kind (task, interactive, maintenance) and scope
(workspace, project). This ensures that related runs share a session lineage
without relying on random IDs.

## Key exports

- `selectSessionRoot(kind, scope)` -- compute a deterministic session root ID

## Dependencies

- `@popeye/contracts`

## Layer

Runtime domain. Pure logic with no I/O or side effects.
