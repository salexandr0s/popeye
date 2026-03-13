# ADR 0003: Auth token lifecycle

- Status: Accepted
- Date: 2026-03-13

## Decision

Use a single operator-scoped bearer token in v1, stored in `auth.json` with `0600` permissions, with optional `next` token overlap for rotation.

## Details

- Bootstrap via CLI/runtime init.
- Validate on every control-plane request.
- Rotation creates `current` + `next` and an overlap deadline.
- Revocation is performed by replacing the store and reloading the daemon.
- Tokens never persist in workspace files, logs, receipts, or docs.

## Consequences

- Multi-user auth/RBAC is explicitly out of scope for phases 1-6.
- Telegram uses the same local control-plane auth boundary; it does not introduce separate runtime auth.
