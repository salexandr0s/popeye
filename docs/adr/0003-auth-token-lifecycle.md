# ADR 0003: Auth token lifecycle

- Status: Superseded by ADR 0013
- Date: 2026-03-13

## Decision

Originally: use a single operator-scoped bearer token in v1, stored in
`auth.json` with `0600` permissions, with optional `next` token overlap for
rotation.

## Details

- Bootstrap via CLI/runtime init.
- Validate on every control-plane request.
- Rotation creates `current` + `next` and an overlap deadline.
- Revocation is performed by replacing the store and reloading the daemon.
- Tokens never persist in workspace files, logs, receipts, or docs.

## Supersession note

This decision was later refined by ADR 0013 to keep the same local file-based
rotation model while introducing separate `operator`, `service`, and
`readonly` token roles. Telegram still uses the same local control-plane auth
boundary; it does not introduce separate runtime auth.
