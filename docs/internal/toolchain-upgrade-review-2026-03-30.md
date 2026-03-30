# Toolchain Upgrade Review — 2026-03-30

**Date:** 2026-03-30
**Context:** Follow-up planning after conservative dependency cleanup waves
**Classification:** New platform implementation maintenance
**Scope:** Tooling only — no intended runtime, API, receipt, or memory behavior changes

---

## Executive Summary

The conservative cleanup waves addressed the immediate backlog safely. Major toolchain work has been landing as separate follow-up branches because it touches shared build/test/lint infrastructure.

Current status / next order:

1. ✅ **TypeScript 6** landed on `chore/toolchain-typescript-6`
2. ✅ **ESLint 10 + lint ecosystem** landed on `chore/toolchain-eslint-10`
3. **Vite 8 + Vitest 4 + related web/test tooling** next as one coordinated branch
4. **`@types/node` 25** as final cleanup once the above are green

The key repo surfaces affected are:

- `tsconfig.base.json`
- `eslint.config.mjs`
- `vitest.config.ts`
- `apps/web-inspector/vite.config.ts`

---

## Upgrade Matrix

| Package | Current | Latest seen | Recommendation | Main risk surface |
|---|---:|---:|---|---|
| `typescript` | 6.0.2 | 6.0.2 | Landed on `chore/toolchain-typescript-6` | project references, NodeNext resolution, generated contracts |
| `vite` | 6.4.1 | 8.0.3 | Group with Vitest/web tooling | web-inspector build/dev server |
| `@vitejs/plugin-react` | 4.7.0 | 6.0.1 | Group with Vite | React transform/HMR/build integration |
| `vitest` | 3.2.4 | 4.1.2 | Group with Vite/web tooling | test runner, vite-node, jsdom suite |
| `@vitest/coverage-v8` | 3.2.4 | 4.1.2 | Group with Vitest | coverage pipeline |
| `jsdom` | 26.1.0 | 29.0.1 | Group with Vitest/web tooling | web-inspector DOM tests |
| `eslint` | 10.1.0 | 10.1.0 | Landed on `chore/toolchain-eslint-10` | flat config + `@typescript-eslint` compatibility |
| `@eslint/js` | 10.0.1 | 10.0.1 | Landed with ESLint | rule preset compatibility |
| `globals` | 17.4.0 | 17.4.0 | Landed with ESLint | lint globals surface |
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

Observed repo-specific adjustments while landing this branch:

- keep `baseUrl` for current repo-wide path aliasing, but add `ignoreDeprecations: "6.0"` in `tsconfig.base.json` because TypeScript 6 now errors on the deprecation
- add `types: ["vite/client"]` in `apps/web-inspector/tsconfig.json` so the CSS side-effect import in `src/main.tsx` remains typed
- the temporary `@typescript-eslint` TypeScript 6 bridge now lives in `chore/toolchain-eslint-10`, not in the TS6 branch itself

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

Observed repo-specific adjustments while landing this branch:

- upgrade `eslint` to `10.1.0`, `@eslint/js` to `10.0.1`, and `globals` to `17.4.0`
- fix newly enforced lint findings instead of disabling rules:
  - `no-useless-assignment` in `packages/memory/src/search-service.ts`
  - `preserve-caught-error` in `packages/runtime-core/src/runtime-service.ts`
- add `warnOnUnsupportedTypeScriptVersion: false` in the flat config as an explicit temporary bridge while `@typescript-eslint` still lacks official TypeScript 6 support
- add targeted `pnpm-workspace.yaml` `peerDependencyRules.allowedVersions` entries for the current `@typescript-eslint` 8.57.2 packages so fresh installs stay clean without pretending upstream has already shipped official support

### 4) `chore/toolchain-node-types`

Upgrade `@types/node` last, once compile and lint surfaces are stable.

Success criteria:

- no new ambient-type regressions
- `pnpm typecheck` and `pnpm dev-verify` pass

---

## Repo-specific notes

- `apps/web-inspector` is the only Vite surface in the repo, so Vite changes can stay tightly scoped.
- The repo's flat ESLint config uses `projectService: true` and type-aware `@typescript-eslint` rules, so lint major upgrades should not be mixed with other work.
- The `@typescript-eslint` TypeScript 6 bridge is intentionally temporary. Remove the local warning suppression and `peerDependencyRules.allowedVersions` entries once upstream ships an officially TS6-supported release.
- `pnpm audit --audit-level=high` is currently sensitive enough that transitive security issues can block a branch; keep an eye on audit output while doing future toolchain work.
- Generated contract files are part of the green path. Any toolchain branch that changes generation behavior must commit regenerated artifacts in the same branch.
