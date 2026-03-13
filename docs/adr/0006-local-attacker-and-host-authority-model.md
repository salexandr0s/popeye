# ADR 0006: Local attacker and host authority model

- Status: Accepted
- Date: 2026-03-13

## Decision

Popeye v1 is a loopback-only, single-operator macOS service that defends against accidental exposure and untrusted local processes without operator credentials, but does not claim protection against full operator-account or admin compromise.

## Rules

- Bind to `127.0.0.1` only.
- Require bearer auth even on loopback.
- Enforce `0700` directories and `0600` files in runtime state.
- Keep secrets in Keychain or secure files outside workspaces.
- Record auth failures and policy violations in audit trails.

## Consequences

- Loopback binding is necessary but not sufficient; token and file-permission enforcement remain mandatory.
- Stronger isolation requires future OS-user, VM, or sandbox boundaries.
