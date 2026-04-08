# Current State Matrix

Date: 2026-04-08

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
| Unified recall surface | **Experimental** | Additive runtime/API/tooling slice now searches receipts, run events, accepted messages, ingress decisions, interventions, and durable memory references through a normalized recall contract. Durable memory remains the truth substrate. |
| Playbooks | **Experimental** | File-backed global/workspace/project playbooks are now a first-class Popeye concept. Active playbooks compile deterministically into instruction bundles, remain operator-controlled, and are recorded in receipts and normalized usage rows. DB-backed proposal/review/apply lifecycle now exists via runtime tool, control API, CLI, web inspector, and the native macOS review/apply surface; operators can author draft/patch proposals, edit `drafting` proposals, review/apply canonical changes, inspect effectiveness/usage drilldowns, and receive auto-drafted stale-repair patch suggestions from the hourly maintenance loop. Only applied + activated canonical playbooks affect runs. Active revisions are also indexed as derivative procedural memory, and canonical playbook search now runs through a SQLite FTS mirror while markdown files remain the source of truth. |
| CLI operator surface (`pop`) | **Substrate-complete** | Daemon lifecycle, runs, receipts, auth, backups, security audit, approvals, vaults, and daemon health exist. Finance, medical, files review, upgrade verify/rollback commands added. Playbook list/show/usage inspection now surfaces effectiveness metrics and recent compiled-run usage. |
| Web inspector | **Substrate-complete** | Runtime/operator views are real, including dedicated playbook/proposal authoring and review surfaces plus connections, email/calendar/GitHub pages. Playbook pages now expose server-side search/pagination, effectiveness metrics, usage drilldowns, assisted patch drafting, and editable `drafting` proposal review. Finance, medical, and files views added. It remains a first-class companion surface, not the only GUI. |
| Generated contracts | **Substrate-complete** | Verified generated artifacts now include Swift models, TypeScript models, and a JSON Schema bundle. `pnpm verify:generated-artifacts` is part of `dev-verify`. |
| Files domain | **Product-complete** | File-root registration, search, indexing, policy checks, write-posture model, and write-intent review queue now exist with full API/CLI/web surfaces. |
| Email domain | **Product-complete** | Gmail is now the blessed provider path with browser OAuth, direct API sync/search/digest flows, and policy-gated draft creation/update. Proton remains available but is not part of the polished operator path. |
| Calendar domain | **Product-complete** | Google Calendar is now the blessed provider path with browser OAuth, direct REST sync/search/digest/availability flows, and policy-gated create/update on allowlisted calendars. `gcalcli` remains experimental. |
| Todos domain | **Product-complete** | Google Tasks is the blessed remote provider path with shared Google OAuth, project/list mapping, sync, create, complete, reschedule, move, reconcile, project list, digest, and search across API/CLI/web surfaces. Resource-rule enforcement applies to provider-backed todo mutations. Native priority, labels, and due times remain intentionally unsupported. |
| GitHub domain | **Product-complete** | Direct GitHub REST integration is now the blessed path with browser OAuth, sync/search/digest primitives, notification triage, and policy-gated low-risk writes on allowlisted repos. Native macOS now has a dedicated GitHub surface for digest/search/repo/PR/issue review plus sync, mark-read, and comment actions. |
| People domain | **Product-complete** | Canonical local people graph with merge/split/attach/detach, merge-event history, merge suggestions, activity rollups, enhanced policy (email send policy, calendar allowlist), and full API/CLI/web surfaces. |
| Finance domain | **Product-complete** | Full CRUD, FTS5 search, import/transaction/document/digest flows, CLI/API/web surfaces, restricted vault encryption. |
| Medical domain | **Product-complete** | Full CRUD, search, import/appointment/medication/document/digest flows, CLI/API/web surfaces, restricted vault storage. |
| Approvals and security policy | **Product-complete** | Domain-specific action defaults, standing approvals, and automation grants are now fully tuned. Approval records, central action-policy evaluation, context-release posture, CLI commands, API routes, web views, and native Usage & Security create/revoke flows now exist. |
| Vaults and restricted storage substrate | **Product-complete** | Vault manager, audit trail, policy-gated open flow, CLI/API/web visibility, runtime path isolation, crypto metadata schema, backup/restore/verify contracts, and context-release fidelity levels exist. AES-256-GCM encryption implemented with KEK/DEK envelope pattern. |
| Telegram bridge | **Product-complete** | Thin bridge behavior is implemented and aligned with the control-plane boundary. It remains intentionally non-administrative. |
| Backup and restore | **Product-complete** | Vault backup/restore/verify with SHA-256 manifests. Migration manager integrated into DB open path. |
| Packaging and installer | **Substrate-complete** | Build-pkg, uninstall, smoke-test, and verify-upgrade scripts exist. Migration manager with backup-before-migrate, versioned apply, verify, and rollback is implemented. |
| Connections provider hardening | **Product-complete** | Resource-rule CRUD, diagnostics rollup, reconnect flows, and typed enforcement on calendar/github/todo write paths with API/CLI/web surfaces. |
| Native macOS app | **Experimental** | The native client is now a real operator surface with setup, dashboard, command-center/runtime views, memory, knowledge, files, people, finance, medical, email/calendar/todos, GitHub, playbook review flows, full connection admin/remediation, and native governance parity for standing approvals, automation grants, read-only security policy, and vault summary. It still trails the web inspector for policy authoring, destructive vault administration, and some authoring-heavy operator flows, but it is no longer deferred. |

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
