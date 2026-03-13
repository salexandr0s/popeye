# ADR 0001: Repo topology

- Status: Accepted
- Date: 2026-03-13

## Decision

Keep Popeye as a separate pnpm/Turborepo monorepo and keep the Pi fork in a separate `pi` repository.

## Rationale

- Preserves the boundary that Pi is the engine and Popeye is the product.
- Allows Popeye CI, releases, and storage migrations to evolve without Pi churn.
- Keeps Pi upgrades isolated and auditable.

## Consequences

- All Pi interaction flows through `@popeye/engine-pi`.
- Apps live under `apps/`; shared runtime/interface packages live under `packages/`.
- Docs, ADRs, and operator specs live under `docs/`.
