# Fully Polished Release Gate

Date: 2026-03-20
Status: Canonical acceptance bar

This document defines when Popeye may be called **fully polished**. It is the
acceptance gate for the product end-state, not a progress note.

## Product contract

Popeye is considered fully polished only when it is a:

- distribution-grade
- macOS-first
- local-only
- single-operator
- policy-driven assistant product

The polished bar is explicitly broader than "the daemon and control plane are
solid."

## Locked defaults

- The native macOS app is a **first-class polished-bar surface** and is the primary desktop shell.
- The web inspector remains a **first-class companion operator surface**; it is not the only GUI.
- Pi remains the engine boundary; Pi changes are allowed only when a stable
  engine hook is cleaner there than in runtime wrappers.
- Restricted domains are **bounded** products, not general-purpose mutation
  surfaces.

## Blessed providers

The polished bar requires one blessed provider path per general domain:

| Domain | Blessed provider |
|---|---|
| Files | local file roots |
| Email | Gmail |
| Calendar | Google Calendar |
| Todos | Google Tasks |
| GitHub | direct GitHub API |
| People | local canonical people graph |
| Finance | local import-based vaults |
| Medical | local import-based vaults |

Additional adapters may exist, but they do not count toward the polished bar.

## Release gate

Popeye may be called **fully polished** only when all statements below are
true.

### 1. Product scope

- Files, email, calendar, todos, GitHub, people, finance, and medical are all
  first-class product domains.
- Each domain has a runtime contract, operator workflow, receipts, tests, and
  documentation.
- Provider selection is explicit and blessed; the product does not depend on
  multiple "maybe-supported" paths to satisfy the core experience.

### 2. Autonomy and approvals

- Runtime action policy is structured by domain, action kind, risk class,
  resource scope, idempotency key, and approval posture.
- Standing approvals and automation grants exist and are enforced by the
  runtime rather than prompt text.
- Sync, import, digest, classification, and triage actions may run unattended
  only when policy allows them.
- Email sends, calendar writes, GitHub writes, and non-agent-owned file writes
  require standing grants or explicit per-action approval.
- Finance and medical never perform external mutations.

### 3. Restricted-domain handling

- Finance and medical content use vault-backed stores and dedicated audit trails.
- Raw restricted content is not embedded by default.
- Context release defaults to summary or excerpt form unless a higher-fidelity
  release is explicitly approved.
- Restricted-domain access, import, export, backup, restore, and context
  release all leave operator-visible evidence.
- Restricted backups are encrypted and restore-tested.

### 4. Operator surfaces

- The native macOS app includes first-class views for setup, connections,
  home/dashboard, runtime investigation, knowledge, playbooks, GitHub, people,
  files, finance, medical, approvals, and security.
- The web inspector includes first-class views for connections, approvals,
  policies, playbooks, proposals, people, email, calendar, todos, GitHub,
  finance, medical, backups, upgrades, and security.
- The CLI provides parity for setup, sync, digest, approvals, vault access,
  backups, upgrades, recovery, and playbook inspection/review flows.
- Telegram remains a thin conversational surface and is not required to perform
  platform administration.

### 5. Contracts and client drift prevention

- Public contracts are exported as versioned JSON Schemas.
- Generated TypeScript and Swift model bundles are produced from the contracts
  and verified in CI/local verification.
- CLI, web, and future clients consume the same route and record contracts for
  approvals, policy, vaults, receipts, and domain APIs.

### 6. Release engineering

- The official release channel is a signed and notarized macOS `.pkg`.
- Install, upgrade, uninstall, rollback, and migration flows are documented and
  exercised on clean machines.
- Versioned storage migrations exist and are covered by tests.
- Upgrade flow performs backup-before-migration.
- Artifact checksums and reproducible build metadata exist.
- Pi compatibility is verified separately from unrelated runtime changes.

### 7. Verification

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm verify:generated-artifacts` pass.
- Playwright UI tests pass.
- Pi smoke tests pass when enabled for the target engine checkout.
- Secret scanning, dependency audit, packaging smoke, migration tests, and
  backup/restore drills pass.
- A clean macOS machine can install Popeye, connect the blessed providers,
  survive restart and upgrade, restore from backup, and run unattended for
  24 hours with complete operator-visible evidence.

## Exit evidence

The polished claim requires all of the following evidence:

- release notes for the candidate build
- passing verification logs
- installer artifact + checksum
- migration and restore drill results
- installed-instance playbook / proposal validation evidence
- operator-facing docs for setup, approvals, backups, upgrades, and recovery
- current-state matrix aligned with repo truth

If any item above is false, Popeye is not yet fully polished.
