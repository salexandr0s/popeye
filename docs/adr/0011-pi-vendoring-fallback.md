# ADR 0011: Pi vendoring fallback must remain a whole-fork boundary

- Status: Accepted
- Date: 2026-03-14

## Context

Popeye currently keeps the Pi fork in a separate sibling repository and talks to
it only through `@popeye/engine-pi`. This preserves the rule that Pi is the
engine and Popeye is the product.

Separate-repo workflow can still create practical friction:

- local bootstrap needs a second checkout
- CI/manual smoke needs an external Pi build
- version pinning must stay aligned with the Pi `packages/coding-agent` package

That friction does not justify dissolving the engine/product boundary. The risk
is accidental drift: scattered Pi knowledge in runtime or interface packages,
piecemeal copied Pi modules, and Pi config/path shapes becoming Popeye public
API by accident.

## Decision

If Popeye ever needs to stop using a separate Pi repository for operational
reasons, the only allowed fallback is to **vendor the entire Pi fork as an
isolated whole-fork subtree/module/package** while preserving the existing
adapter boundary.

That means:

- `@popeye/engine-pi` remains the only Pi-aware package
- runtime/interface packages still consume only Popeye-owned interfaces
- Pi internals are still not imported directly outside `@popeye/engine-pi`
- vendoring changes packaging only, not ownership boundaries

## Explicit non-goals

The fallback does **not** allow:

- copying selected Pi modules into `@popeye/runtime-core` or interface packages
- re-exporting Pi internal config shapes as Popeye control/API contracts
- treating a vendored Pi tree as a shared implementation toolbox for unrelated packages

## Triggers to revisit packaging

Consider vendoring the whole fork only when at least one is true:

- multi-repo bootstrap or CI overhead materially slows delivery
- Pi pin management becomes error-prone despite version checks and smoke coverage
- isolated fork updates are operationally harder than carrying the fork in-tree

## Consequences

- Popeye keeps the current separate-repo topology today.
- Future vendoring remains compatible with ADR 0001 and ADR 0002 because the
  engine boundary does not move.
- Any future vendoring change still requires an isolated ADR- and
  compatibility-tested change.
