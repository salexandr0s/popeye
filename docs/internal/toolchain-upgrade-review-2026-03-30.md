# Toolchain Upgrade Review — 2026-03-30

**Date:** 2026-03-30
**Context:** Follow-up planning after conservative dependency cleanup waves
**Classification:** New platform implementation maintenance
**Scope:** Tooling only — no intended runtime, API, receipt, or memory behavior changes

---

## Executive Summary

The conservative cleanup waves address the immediate backlog safely. The remaining **major** upgrades should be handled as separate follow-up branches because they touch shared build/test/lint infrastructure.

Current recommendation:

1. **TypeScript 6** as its own branch
2. **Vite 8 + Vitest 4 + related web/test tooling** as one coordinated branch
3. **ESLint 10 + lint ecosystem** as its own branch
4. **`@types/node` 25 + `globals` 17** as final cleanup once the above are green

The key repo surfaces affected are:

- `tsconfig.base.json`
- `eslint.config.mjs`
- `vitest.config.ts`
- `apps/web-inspector/vite.config.ts`

---

## Upgrade Matrix

| Package | Current | Latest seen | Recommendation | Main risk surface |
|---|---:|---:|---|---|
| `typescript` | 5.9.3 | 6.0.2 | Separate branch | project references, NodeNext resolution, generated contracts |
| `vite` | 6.4.1 | 8.0.3 | Group with Vitest/web tooling | web-inspector build/dev server |
| `@vitejs/plugin-react` | 4.7.0 | 6.0.1 | Group with Vite | React transform/HMR/build integration |
| `vitest` | 3.2.4 | 4.1.2 | Group with Vite/web tooling | test runner, vite-node, jsdom suite |
| `@vitest/coverage-v8` | 3.2.4 | 4.1.2 | Group with Vitest | coverage pipeline |
| `jsdom` | 26.1.0 | 29.0.1 | Group with Vitest/web tooling | web-inspector DOM tests |
| `eslint` | 9.39.4 | 10.1.0 | Separate branch after TS/web toolchain | flat config + `@typescript-eslint` compatibility |
| `@eslint/js` | 9.39.4 | 10.0.1 | Upgrade with ESLint | rule preset compatibility |
| `globals` | 15.15.0 | 17.4.0 | Upgrade with ESLint or final cleanup | lint globals surface |
| `@types/node` | 22.19.15 | 25.5.0 | Final cleanup branch | ambient type changes |

---

## Recommended Follow-up Order

### 1) `chore/toolchain-typescript-6`

Upgrade only `typescript` first.

Success criteria:

- `pnpm typecheck` passes
- generated artifact checks stay green
- `pnpm build` passes
- `pnpm dev-verify` passes

### 2) `chore/toolchain-vite-vitest-4`

Upgrade together:

- `vite`
- `@vitejs/plugin-react`
- `vitest`
- `@vitest/coverage-v8`
- `jsdom`

Reason: these packages already move together through `vite-node`, jsdom test environments, and the web-inspector build/test path.

Success criteria:

- `apps/web-inspector` build passes
- web-inspector test files remain green
- root `pnpm test` remains green
- `pnpm dev-verify` passes

### 3) `chore/toolchain-eslint-10`

Upgrade together:

- `eslint`
- `@eslint/js`
- `globals`
- recheck `@typescript-eslint/*` compatibility before changing them again

Reason: the repo uses a single flat config with type-aware rules, so lint upgrades should be isolated and easy to revert.

Success criteria:

- `pnpm lint` passes without weakening existing rules
- `pnpm security:sast` passes unchanged
- `pnpm dev-verify` passes

### 4) `chore/toolchain-node-types`

Upgrade `@types/node` last, once compile and lint surfaces are stable.

Success criteria:

- no new ambient-type regressions
- `pnpm typecheck` and `pnpm dev-verify` pass

---

## Repo-specific notes

- `apps/web-inspector` is the only Vite surface in the repo, so Vite changes can stay tightly scoped.
- The repo's flat ESLint config uses `projectService: true` and type-aware `@typescript-eslint` rules, so lint major upgrades should not be mixed with other work.
- `pnpm audit --audit-level=high` is currently sensitive enough that transitive security issues can block a branch; keep an eye on audit output while doing future toolchain work.
- Generated contract files are part of the green path. Any toolchain branch that changes generation behavior must commit regenerated artifacts in the same branch.
