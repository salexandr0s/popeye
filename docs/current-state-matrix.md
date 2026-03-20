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
| Web inspector | **Substrate-complete** | Runtime/operator views are real, including dedicated connections plus email/calendar/GitHub operator pages. Not every planned domain/workflow is represented yet. |
| Generated contracts | **Substrate-complete** | Verified generated artifacts now include Swift models, TypeScript models, and a JSON Schema bundle. `pnpm verify:generated-artifacts` is part of `dev-verify`. |
| Files domain | **Product-complete** | File-root registration, search, indexing, policy checks, write-posture model, and write-intent review queue now exist with full API/CLI/web surfaces. |
| Email domain | **Product-complete** | Gmail is now the blessed provider path with browser OAuth, direct API sync/search/digest flows, and policy-gated draft creation/update. Proton remains available but is not part of the polished operator path. |
| Calendar domain | **Product-complete** | Google Calendar is now the blessed provider path with browser OAuth, direct REST sync/search/digest/availability flows, and policy-gated create/update on allowlisted calendars. `gcalcli` remains experimental. |
| Todos domain | **Product-complete** | Full Todoist connect, reprioritize, reschedule, move, reconcile, project list, digest, and search with API/CLI/web surfaces. Resource-rule enforcement on todo mutations. |
| GitHub domain | **Product-complete** | Direct GitHub REST integration is now the blessed path with browser OAuth, sync/search/digest primitives, notification triage, and policy-gated low-risk writes on allowlisted repos. |
| People domain | **Product-complete** | Canonical local people graph with merge/split/attach/detach, merge-event history, merge suggestions, activity rollups, enhanced policy (email send policy, calendar allowlist), and full API/CLI/web surfaces. |
| Finance domain | **Substrate-complete** | `@popeye/cap-finance` now exists with restricted vault storage, import/transaction/document/digest models, search, anomaly detection, and reminder candidate extraction. Full operator workflows and context-release integration are next. |
| Medical domain | **Substrate-complete** | `@popeye/cap-medical` now exists with restricted vault storage, appointment/medication/document/digest models, search, and reminder candidate extraction. Full operator workflows and context-release integration are next. |
| Approvals and security policy | **Substrate-complete** | Approval records, central action-policy evaluation, context-release posture, standing approvals, automation grants, CLI commands, API routes, and web views exist. Domain-specific policy/product completeness is still ahead. |
| Vaults and restricted storage substrate | **Product-complete** | Vault manager, audit trail, policy-gated open flow, CLI/API/web visibility, runtime path isolation, crypto metadata schema, backup/restore/verify contracts, and context-release fidelity levels exist. |
| Telegram bridge | **Product-complete** | Thin bridge behavior is implemented and aligned with the control-plane boundary. It remains intentionally non-administrative. |
| Backup and restore | **Substrate-complete** | Backup/restore exists for the current runtime footprint. Vault backup/restore API contracts are defined. |
| Packaging and installer | **Substrate-complete** | Build-pkg, uninstall, smoke-test, and verify-upgrade scripts exist. Migration manager with backup-before-migrate, versioned apply, verify, and rollback is implemented. |
| Connections provider hardening | **Product-complete** | Resource-rule CRUD, diagnostics rollup, reconnect flows, and typed enforcement on calendar/github/todo write paths with API/CLI/web surfaces. |
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
