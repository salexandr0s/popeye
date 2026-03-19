# ADR 0013: Role-scoped local auth store

- Status: Accepted
- Date: 2026-03-18
- Supersedes: ADR 0003

## Decision

Use a **role-scoped local bearer auth store** in `auth.json` with `0600`
permissions. The store contains independent rotating token records for:

- `operator`
- `service`
- `readonly`

Each role keeps its own `current` token plus optional `next` overlap token for
rotation. Browser-session auth remains **operator-only** and is bootstrapped
through `POST /v1/auth/exchange` using an operator bearer token plus a daemon-issued nonce.

## Why

The single-token model was too coarse once Popeye exposed:

- automation routes that should be callable by local integrations
- read-only observability surfaces that should not have mutation authority
- operator-only security, memory-maintenance, and policy routes

The new model keeps the platform local-first and single-operator while
providing safer least-privilege access for local clients.

## Details

- Legacy single-record auth files are still accepted and normalize to an
  `operator` role store.
- Route authorization is role-based:
  - `readonly` for non-mutating observability and event-stream access
  - `service` for local automation mutations such as task enqueue/retry/ingest
  - `operator` for everything, including browser-session minting, memory maintenance,
    profiles, approvals, and security surfaces
- CSRF stays required for all mutating routes.
- No remote auth, OAuth, SSO, or multi-user identity is introduced.

## Consequences

- Popeye still does **not** support multi-user RBAC or tenant management.
- Local integrations can use narrower tokens instead of the operator token.
- Security audit records can now distinguish invalid-token failures from
  valid-token-but-insufficient-role failures.
