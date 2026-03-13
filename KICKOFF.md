# Popeye Build Kickoff Prompt

Give this prompt to a coding agent to start the build from Phase 0.

---

You are building Popeye — an always-on agent orchestration platform for macOS.

## Context

All design documentation is in `~/GitHub/popeye/`. Read these files IN ORDER before doing anything:

1. `CLAUDE.md` (symlink to `agents.md`) — your operating contract. Follow every rule.
2. `architecture.md` — full technical architecture with domain model, state machines, type definitions, and invariants.
3. `buildplan.md` — phased execution plan. You are starting at Phase 0.
4. `open_questions.md` — locked decision record. All 20 decisions are final. Do not revisit.

## Your mission

Execute the build plan starting from **Phase 0**, then **Phase 1**. Do not skip phases. Do not start Phase 2 until Phase 1 exit criteria pass.

### Phase 0 — Discovery and donor analysis

Produce these docs in `~/GitHub/popeye/docs/`:

- `current-openclaw-inventory.md` — inventory current OpenClaw usage by examining `~/openclaw/` (config, workspace files, memory, schedules, tools, integrations). Classify each as: required, optional, or baggage.
- `pi-capability-map.md` — examine the Pi repo at https://github.com/anthropics/claude-code (this is the upstream). Map its capabilities: sessions, context files, event streaming, tools, providers, SDK embedding, compaction. Note what Popeye can reuse directly vs what needs wrapping.
- `openclaw-donor-map.md` — for each donor concept (heartbeat, recurring jobs, workspace structure, durable memory, receipts), identify: concrete need, Pi equivalent check, proposed layer, decision (reuse/wrap/thin-port/rewrite/omit), contamination risks.
- `omissions.md` — explicitly list everything being excluded (channel ecosystem, media pipeline, plugin marketplace, donor UI, gateway abstractions, ACP) with rationale.
- `domain-model.md` — define every domain noun (Workspace, Project, Task, Schedule, Job, Run, Receipt, SessionRoot, Intervention, Memory) with relationships, cardinality, and lifecycle. Use the type definitions from architecture.md as the source of truth.
- `pi-fork-strategy.md` — document: what to fork, upstream baseline, minimal patches needed, branding/config changes, upgrade cadence, compatibility testing approach.

### Phase 1 — Fork freeze and repo bootstrap

After Phase 0 docs are written:

1. Fork `anthropics/claude-code` to `salexandr0s/pi` (private repo). Tag the upstream baseline.
2. Scaffold the Popeye monorepo at `~/GitHub/popeye/` with:
   - `pnpm-workspace.yaml` and `turbo.json`
   - Strict TypeScript config (`strict: true`, no `any`)
   - ESLint 9 + Prettier
   - Vitest setup
   - All `@popeye/*` package skeletons per buildplan Section 5.3
3. Base config loader: JSON + Zod validation at startup
4. Keychain integration for secret storage (`security` CLI on macOS)
5. File permissions enforcement: 700 dirs, 600 files on runtime data paths
6. ADR directory with templates + first two ADRs:
   - `docs/adr/0001-repo-topology.md`
   - `docs/adr/0002-pi-fork-strategy.md`
7. Verify: `dev-verify` must pass (lint + typecheck + tests)

## Rules

- Follow the agent workflow in CLAUDE.md Section 16: Inspect → Classify → Plan → Implement → Test → Document → Report.
- Every file change must be classified: Pi reuse / Pi wrapper / donor concept / donor thin-port / new / intentional omission.
- Run `dev-verify --quick` after every 3-5 file changes.
- Run full `dev-verify` before marking any phase complete.
- Commit logical units with conventional format: `type(scope): description`.
- Do not invent architecture beyond what the docs specify.
- Do not port OpenClaw code — port concepts only.
- Ask before any destructive git operation.

## Exit criteria

Phase 0 is done when: every desired feature is classified, an omission list exists, and domain nouns are defined clearly enough to start implementation.

Phase 1 is done when: Pi fork builds, Popeye repo builds/tests/lints cleanly, engine dependency pinning is in place, keychain integration works, file permissions are enforced, and fork strategy doc exists.

When both phases are complete, report what was done, what was deferred, and any risks discovered.
