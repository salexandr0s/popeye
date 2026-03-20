# Current State Matrix

Date: 2026-03-20

This document is the canonical repo-truth snapshot for Popeye. It supersedes
older "current state" claims in:

- `docs/phase-audit-2026-03-14.md`
- `docs/internal/personal-assistant-current-state-audit.md`
- `docs/internal/popeye_roadmap.md`

## Status legend

- **Substrate-complete**: the platform foundation exists, is tested, and is
  intended to be extended rather than replaced.
- **Product-complete**: operator-facing behavior is complete enough to count
  toward the polished end-state.
- **Experimental**: real code exists, but provider choice, UX, or policy is
  still transitional.
- **Deferred**: intentionally not part of the current delivery bar.

## Matrix

| Area | Status | Notes |
|---|---|---|
| Runtime orchestration (`task`/`job`/`run`, scheduler, receipts, recovery) | **Substrate-complete** | Core runtime foundation is in place and already powers the daemon, CLI, API, and web inspector. |
| Control API (loopback auth, role auth, CSRF, SSE) | **Substrate-complete** | `/v1/*` remains the required client boundary. Approvals, security policy, and vault routes are now first-class surfaces. |
| CLI operator surface (`pop`) | **Substrate-complete** | Daemon lifecycle, runs, receipts, auth, backups, security audit, approvals, vaults, and daemon health exist. |
| Web inspector | **Substrate-complete** | Runtime/operator views are real. Domain-complete assistant workflows are not yet all represented. |
| Generated contracts | **Substrate-complete** | Verified generated artifacts now include Swift models, TypeScript models, and a JSON Schema bundle. `pnpm verify:generated-artifacts` is part of `dev-verify`. |
| Files domain | **Substrate-complete** | File-root registration, search, indexing, and policy checks exist. Full polished safe-write/review workflows are still incomplete. |
| Email domain | **Experimental** | `@popeye/cap-email` exists with Gmail and Proton provider support, sync/search/digest primitives, and runtime wiring. The polished provider contract is not yet locked to a single blessed path in operator UX. |
| Calendar domain | **Experimental** | `@popeye/cap-calendar` exists with sync/search/digest primitives, but the current provider story is still CLI-backed (`gcalcli`) rather than the polished direct-provider target. |
| Todos domain | **Experimental** | `@popeye/cap-todos` exists with local and Todoist-backed models, sync/search/digest primitives, and runtime integration. |
| GitHub domain | **Experimental** | `@popeye/cap-github` exists with sync/search/digest primitives and runtime integration. |
| People domain | **Experimental** | Domain vocabulary exists in contracts and memory entity extraction exists, but there is no first-class `cap-people` package or canonical people graph yet. |
| Finance domain | **Experimental** | Domain policy and vault substrate exist, but there is no `cap-finance` product package or import/review workflow yet. |
| Medical domain | **Experimental** | Domain policy and vault substrate exist, but there is no `cap-medical` product package or import/review workflow yet. |
| Approvals and security policy | **Substrate-complete** | Approval records, central action-policy evaluation, context-release posture, standing approvals, automation grants, CLI commands, API routes, and web views exist. Domain-specific policy/product completeness is still ahead. |
| Vaults and restricted storage substrate | **Substrate-complete** | Vault manager, audit trail, policy-gated open flow, CLI/API/web visibility, and runtime path isolation exist. Restricted-domain product workflows are still missing. |
| Telegram bridge | **Product-complete** | Thin bridge behavior is implemented and aligned with the control-plane boundary. It remains intentionally non-administrative. |
| Backup and restore | **Substrate-complete** | Backup/restore exists for the current runtime footprint. Restricted-domain encrypted backup posture is not yet product-complete. |
| Packaging and installer | **Experimental** | Source/bundle install flows exist. Signed/notarized macOS `.pkg`, migration drills, and clean-machine installer CI are still missing. |
| Native macOS app | **Deferred** | The web inspector is the primary GUI. The native client remains intentionally deferred. |

## What counts as still missing for "fully polished"

The polished bar is not "the runtime works." It is all of the following:

- one blessed provider path per domain
- policy-driven autonomy via standing approvals and automation grants
- first-class operator surfaces for approvals, vaults, policies, connections,
  backups, upgrades, and domain workflows
- bounded finance and medical products with restricted-domain controls
- distribution-grade macOS install, upgrade, rollback, and recovery

The canonical acceptance bar for that end-state lives in
`docs/fully-polished-release-gate.md`.
