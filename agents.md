# agents.md — Popeye Operating Contract

**Product:** Popeye (CLI: `pop`, daemon: `popeyed`, scope: `@popeye/`)
**Audience:** coding agents, planning agents, human reviewers
**Rule zero:** Pi is the engine. Popeye is the product. OpenClaw is a donor, not the architecture.

---

## 1. Mission

Build a long-term owned agent platform on a controlled Pi fork. Three layers, hard boundaries:

1. **Pi layer** — engine: model/provider abstraction, agent loop, tool calling, session mechanics, compaction, event streaming.
2. **Popeye runtime** — product: daemon (`popeyed`), scheduler, heartbeat, session orchestration, instruction resolution, memory, receipts, audit, recovery, security, control API.
3. **Interfaces** — replaceable surfaces: CLI (`pop`), Telegram adapter, web inspector, Swift macOS client.

Values: ownership, bounded complexity, clear layering, operational visibility, deterministic behavior, boring upgrades.

---

## 2. Non-negotiable rules

These outrank convenience. No exceptions without an ADR.

1. **Do not recreate OpenClaw wholesale.**
2. **Prefer thin integration over broad porting.**
3. **Check Pi first before reimplementing.**
4. **Port concepts intentionally, never by drift.**
5. **Keep interfaces stable, explicit, and versioned.**
6. **UI must remain decoupled from runtime internals.**
7. **Every subsystem must justify its existence.**
8. **Operational records stay outside the workspace.**
9. **Every run must be receipted, including failures and cancellations.**
10. **Critical instruction files are operator-owned by default.**
11. **Pinned versions only for core engine dependencies.**
12. **Prefer deletion and omission over speculative complexity.**
13. **Loopback-only API binding. Auth token required. CSRF on mutations.**
14. **Secrets never persist in workspace files, logs, or receipts. Redact on write.**
15. **Memory writes to curated files require explicit promotion with diff and receipt.**
16. **Telegram adapter is a thin bridge to the control API, not a channel ecosystem.**
17. **sqlite-vec + FTS5 for memory retrieval. No external search services.**
18. **Cost/usage data is a required field in every receipt.**

---

## 3. Resolved technical stack

All locked. Do not revisit without an ADR.

| Layer | Choice |
|---|---|
| Language | TypeScript (strict mode) |
| Node | 22 LTS |
| Package manager | pnpm |
| Monorepo | pnpm workspaces + Turborepo |
| Config | JSON + Zod validation at startup |
| API framework | Fastify with Zod schema validation |
| Database | SQLite (WAL mode, foreign keys enabled) |
| Memory search | FTS5 + sqlite-vec (hybrid, two-stage) |
| Embeddings | OpenAI text-embedding-3-small, stored in sqlite-vec |
| Testing | Vitest (unit) + Playwright (E2E) |
| Linting | ESLint 9 + Prettier |
| macOS data path | ~/Library/Application Support/Popeye/ |
| Pi integration | Child process with streamed events |
| Package scope | `@popeye/` |

---

## 4. Layering guide

Before placing code, ask in order:

1. Is this an engine capability independent of Popeye? → **Pi layer**
2. Is this product semantics, orchestration, policy, memory, or security? → **Runtime layer**
3. Is this presentation or operator workflow? → **Interface layer**
4. Does moving it lower create coupling to a specific client? → Move up.
5. Does moving it higher duplicate an engine capability? → Move down or wrap.

### Pi layer owns

Model/provider integration, agent-loop mechanics, tool calling infrastructure, session tree / compaction, engine event streaming, generic coding-agent capability.

### Runtime layer owns

Daemon lifecycle, scheduling, heartbeat, task/job/run orchestration, session policy, instruction resolution, workspace/project routing, **memory DB (sqlite-vec, FTS5)**, receipts and audit, recovery and supervision, runtime-owned tools, control API, **security enforcement (auth, CSRF, redaction, audit)**, platform invariants.

### Interface layer owns

Presentation, operator workflows, client caching, navigation, view models, rendering. **Telegram adapter belongs here** — it is a thin bridge, not a runtime component.

### Interface layer must NOT

- Parse Pi session files directly
- Read runtime SQLite directly
- Infer state from log file names
- Reimplement instruction resolution
- Bypass the control API

---

## 5. Security rules

### Network

- Bind to **127.0.0.1 only**. No remote access in v1.
- **Auth token required** on every endpoint, even loopback. Fail-closed.
- Long random tokens (`openssl rand -hex 32`).
- **CSRF protection** (Sec-Fetch-Site validation + CSRF tokens) on all state-changing endpoints.

### Secrets

- Sources: env vars, file-based, exec providers, macOS Keychain.
- File permissions: **700 dirs, 600 files** on runtime data.
- Never store secrets in workspace docs, config files, logs, or receipts.
- **Redact-on-write** for sensitive patterns (API keys, tokens, PEM blocks, JWTs) — not read-path filtering.
- Configurable redaction patterns per deployment.

### Trust boundaries

- All external content is untrusted data.
- Prompt injection detection on all inbound messages (including allowlisted Telegram users).
- Critical instruction files (`WORKSPACE.md`, `PROJECT.md`, `IDENTITY.md`, `HEARTBEAT.md`) are operator-owned and read-only by default.
- Retrieved content claims no elevated authority.

### Tool execution

- **Default-deny** for dangerous operations.
- Explicit approval gates for irreversible actions.
- **Single policy enforcement point** — no bypass paths.
- Auth failures are never retried — escalate immediately.

### Audit

- Every run receipted, including failures.
- `security_audit` table records auth failures, policy violations, redaction events.
- `pop security audit` command scans config, permissions, exposed ports, secret storage.

---

## 6. Memory system rules

### Architecture

Two layers: **markdown** (human-readable) + **SQLite** (machine-queryable).

- Markdown: `MEMORY.md` (curated), `memory/daily/YYYY-MM-DD.md` (daily notes), workspace knowledge docs.
- SQLite (`memory.db`): `memories`, `memory_events`, `memory_embeddings` (sqlite-vec), `memory_sources`, `memory_consolidations`.

### Memory types

| Type | Description | Storage |
|---|---|---|
| Episodic | what happened — receipts, run events, conversation snapshots | SQLite |
| Semantic | what is known — extracted facts, preferences, decisions | SQLite + markdown |
| Procedural | how to do things — learned workflows, correction patterns | SQLite + markdown |
| Working | current context — compiled instructions, retrieved snippets | in-memory only |

### Retrieval

Two-stage, target latency **<200ms**:

1. **Fast index:** FTS5 (lexical) + sqlite-vec (semantic) in parallel, union results.
2. **Rerank:** relevance + recency + confidence + scope match.
3. **Filter:** workspace/project scope, memory type, minimum confidence.
4. **Package:** descriptions first (progressive disclosure), full content on demand.

### Lifecycle

1. **Capture** — automatic extraction from receipts and conversation at run end.
2. **Daily notes** — automatic human-readable log of activity.
3. **Promotion** — explicit promotion to curated memory requires diff + receipt.
4. **Consolidation** — periodic merge of redundant memories, confidence decay, archive stale.
5. **Compaction flush** — runtime intercepts Pi compaction events, extracts memories before context loss.

### Key properties

- Every memory has **provenance** (source run, timestamp, confidence).
- **Confidence decay** without reinforcement (configurable half-life).
- **Dedup keys** prevent redundant storage.
- Sensitive data is redacted before memory storage.
- Scope: workspace, project, or global.

---

## 7. Telegram adapter rules

- **Thin bridge** to the control API. Routes through `/v1/messages/ingest`, never directly to Pi.
- **Allowlist-only** DM policy. No pairing flow, no open registration.
- All messages are **untrusted input** — apply prompt injection detection.
- **Rate limiting** on message ingress.
- Stateless adapter — all state lives in the Popeye runtime.
- Belongs in the **interface layer** (`@popeye/telegram`).
- NOT a port of OpenClaw's channel ecosystem.

---

## 8. OpenClaw rules

### Do not port

- Broad channel ecosystems
- Media pipelines
- Node/device/pairing systems
- Donor UI stack
- Donor config schemas as architecture
- Plugin marketplaces
- Gateway-wide routing abstractions

### When adapting a donor concept

1. Identify the concrete need.
2. Check Pi for an equivalent first.
3. Extract the principle, keep the smallest viable slice.
4. Restate in Popeye's contracts and naming.
5. Hide donor details behind owned interfaces.
6. Create a decision record: need, Pi check, layer, decision (reuse/wrap/thin-port/rewrite/omit), contamination risks, omissions.

### Contamination warning signs — stop and reassess

- Donor file names becoming required everywhere
- Donor config shapes becoming canonical API
- Whole donor directories copied into core
- Runtime naming following donor naming without justification
- UI requirements driven by donor patterns instead of control plane

---

## 9. Pi fork rules

### Check Pi first

Before adding engine-like capability, answer: (1) does Pi already do this? (2) does Pi expose a hook? (3) can the runtime wrap Pi? (4) is changing Pi cleaner than wrapping?

### Integration

- All Pi interaction flows through `@popeye/engine-pi`. No scattered Pi imports.
- Pin exact engine versions. No floating ranges.
- Pi fork lives in a separate `pi` repo.

### Upgrades

- Upgrade deliberately. Never mix Pi upgrades with unrelated runtime changes.
- Every upgrade updates `docs/pi-fork-delta.md` with: what changed upstream, what was adopted, what was not adopted, compatibility tests run.

### Allowed fork modifications

At least one must be true:
- Runtime needs a stable hook Pi does not expose
- A bug blocks the platform
- An upstream fix is required for stability/safety
- Fork branding/config must be set
- Change is cleaner in Pi than in runtime wrappers and will remain engine-level

If the change is only for convenience, prefer a runtime wrapper.

---

## 10. Coding conventions

### General

- Small modules with one job.
- `strict: true` in tsconfig. No `any` — use `unknown` + type guards.
- Side effects at system edges only.
- Zod for all schema-validated boundaries.
- No hidden global mutable state.
- No magic strings for shared states and events.
- Explicit names over clever abstraction.
- Named exports over default exports.
- Files: `kebab-case.ts`. Components: `PascalCase` in code. Hooks: `use-` prefix file.

### Packages

- All packages use `@popeye/` scope.
- pnpm for package management, Turborepo for build orchestration.
- Fastify for HTTP, Zod for validation.
- JSON config validated with Zod at startup.
- sqlite-vec for vector operations.

### Runtime conventions

- Model Task, Job, Run, SessionRoot, Receipt, and Intervention explicitly.
- Persist state transitions deliberately.
- Append-only event logging for audit trails.
- Enforce invariants in code, not just prompts.
- Keep orchestration logic out of UI code.

### API conventions

- Version routes from day one.
- Zod schemas for all requests, responses, and events.
- Document breaking changes.
- Do not leak raw DB or file layout in the API.

### Swift conventions

- Separate API client layer.
- No business logic in views.
- No direct file or DB reads that bypass the control API.

---

## 11. Source classification

Every meaningful change must be classified. Unclassified work is not ready.

| Classification | Meaning |
|---|---|
| Pi reuse | Using Pi capability directly |
| Pi wrapper | Runtime wrapping a Pi primitive |
| OpenClaw donor concept | Adapted idea from donor |
| OpenClaw thin port | Minimal code adapted from donor |
| New platform implementation | Built fresh for Popeye |
| Intentional omission | Explicitly excluded |

---

## 12. Testing expectations

### Test layers

- **Unit** — pure logic (Vitest)
- **Integration** — orchestration
- **Smoke** — real Pi interaction
- **Contract** — API schemas
- **Failure-injection** — recovery paths
- **Golden** — deterministic output comparison

### Mandatory test coverage

Add or update tests when changing any of: scheduler, run coordinator, session policy, instruction resolver, recovery logic, critical file write policy, engine adapter, control API schemas.

Additionally, these areas require dedicated tests:

- Memory retrieval (sqlite-vec + FTS5 hybrid)
- Memory consolidation and confidence decay
- Telegram adapter integration (allowlist, rate limiting)
- Security audit (`pop security audit`)
- CSRF protection on mutations
- Redaction (sensitive patterns removed before write)
- Cost/usage tracking in receipts

### Golden tests

Use for: instruction precedence, receipt rendering, session selection, run state transitions, API event payloads.

---

## 13. Documentation and file discipline

A change is not complete until the future operator can understand it.

Update docs when changing: architecture, domain model, workspace conventions, instruction resolution, receipt schema, API contracts, Pi fork delta, runbooks.

- Every new package needs a README.
- Every donor-derived file needs provenance notes.
- Every Pi fork change updates `docs/pi-fork-delta.md`.
- Every migration helper must state whether it is temporary or long-term.
- Do not create new top-level folders casually.

---

## 14. Logging and observability

- Structured JSON logs with correlation IDs (`workspaceId`, `projectId`, `taskId`, `jobId`, `runId`, `sessionRootId`).
- Log state transitions, not just final errors.
- Preserve raw engine events.
- Every failure must leave enough evidence to diagnose later.
- Human-readable CLI output is derived from structured records, never replaces them.

---

## 15. Change management

- Significant boundary changes require an ADR.
- Breaking API changes require a migration note.
- Runtime storage changes require migrations and migration tests.
- Receipt/log changes must preserve or improve operator visibility.
- Instruction logic changes must preserve preview/debug support.
- Session policy changes must preserve determinism.
- Donor adoptions and Pi fork upgrades must be isolated in their own changesets.

---

## 16. Agent workflow

All agents follow this order. No shortcuts.

### 16.1 Inspect

Read: relevant docs, relevant code, nearby tests, previous ADRs, fork delta notes, donor notes if applicable.

### 16.2 Classify

State explicitly:

- **Layer:** Pi / runtime / interface
- **Provenance:** Pi reuse / Pi wrapper / donor / new / omit
- **Scope:** bugfix / feature / refactor / migration
- **Security impact:** does this change affect auth, secrets, trust boundaries, or redaction?
- **Memory impact:** does this change affect memory storage, retrieval, lifecycle, or consolidation?

### 16.3 Plan

Write:

- Goal
- Files to touch
- Invariants to preserve
- Tests to add or update
- Docs to update

### 16.4 Implement

Make the smallest correct change that satisfies the plan.

### 16.5 Test

Run tests and record what passed. Run `dev-verify` before marking complete.

### 16.6 Document

Update docs, ADRs, provenance notes, or runbooks as needed.

### 16.7 Report

End with:

- **Intent**
- **Layer**
- **Provenance**
- **Files changed**
- **Tests run**
- **Docs updated**
- **Risks / follow-ups**

---

## 17. Porting decision checklist

For every candidate feature from OpenClaw, answer in order:

1. **Need it now?** Is there a concrete operator workflow that requires it? If no → omit.
2. **Pi equivalent?** Classify: exact / partial / close-with-wrapper / none. If Pi covers it → reuse or wrap.
3. **Thin slice?** Can you port only the minimal contract or workflow rule? If yes → thin port.
4. **Rewrite cleaner?** Is donor code entangled with donor-only assumptions? If yes → rewrite.
5. **Omit entirely?** Is value weak, maintenance high, or does it drag in channel/gateway complexity? If yes → omit.

Record the decision with: candidate name, source location, concrete need, Pi check, proposed layer, decision, contamination risks, tests/docs required.

---

## 18. Anti-patterns

Do not do any of the following without a documented exception:

- Import Pi internals directly across multiple runtime packages
- Make UI read SQLite or Pi session files directly
- Copy donor code without provenance
- Add undocumented config compatibility layers
- Let agents silently mutate critical instruction files
- Implement hidden state transitions without receipts or logs
- Expand platform surface because a donor already has that surface
- Skip tests on scheduler, sessions, instructions, recovery, or security
- Weaken security controls to make tests pass
- Store secrets in workspace files, logs, or receipts

---

## 19. Verification

### During development

Run `dev-verify --quick` after every 3-5 file changes.

### Before commit or marking complete

Run full `dev-verify` (lint + typecheck + tests). All must pass.

### Review checklist

Before returning work, confirm all:

- [ ] Checked Pi first?
- [ ] Avoided broad donor porting?
- [ ] Kept UI decoupled from runtime internals?
- [ ] Preserved receipts and observability?
- [ ] Kept critical instruction files protected?
- [ ] Added or updated tests?
- [ ] Updated docs?
- [ ] Classified provenance and layer?
- [ ] Security impact assessed?
- [ ] Memory impact assessed?
- [ ] No secrets in workspace files, logs, or receipts?
- [ ] Cost/usage data present in receipts?

If any answer is "no", the work is not ready.
