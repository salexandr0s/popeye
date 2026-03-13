# ADR 0002: Pi fork strategy

- Status: Accepted
- Date: 2026-03-13

## Decision

Maintain a minimal, separately versioned Pi fork with exact pinning and explicit delta tracking.

## Rules

- Prefer runtime wrappers over fork changes.
- Only fork for engine-level hooks, blocking bugs, safety fixes, or branding/config defaults.
- Record every adopted or rejected upstream change in `docs/pi-fork-delta.md`.
- Never combine Pi upgrades with unrelated Popeye runtime changes.

## Consequences

- `@popeye/engine-pi` is the only package allowed to know Pi details.
- Compatibility tests against a real Pi instance are required before upgrading the pin.
