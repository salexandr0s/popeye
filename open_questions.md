# Popeye Design Decisions

**Document status:** all questions resolved, decisions locked
**Purpose:** authoritative record of architectural and product decisions made during the design interview phase

---

## Phase 1 Foundations

### D1. Pi integration mode

**Decision:** Child process with streamed events.
**Rationale:** Better crash isolation, cleaner log separation, and easier restart semantics than in-process embedding. The SDK adapter option remains open behind the same interface boundary if needed later.
**Implementation:** Define a `PiAdapter` interface. First implementation spawns Pi as a child process, parses streamed events. Future SDK mode implements the same interface.

### D2. Repo topology

**Decision:** Two separate repos from day one -- `pi` (fork) and `popeye` (platform).
**Rationale:** Keeps the fork delta clean and auditable, gives each repo independent CI, and avoids the cost of a later split.
**Implementation:** `pi` repo tracks upstream with minimal patches. `popeye` depends on a pinned Pi version.

### D3. Authoritative instruction filenames

**Decision:** New platform-first names immediately -- WORKSPACE.md, PROJECT.md, HEARTBEAT.md, IDENTITY.md.
**Rationale:** Clean break avoids long-term confusion between donor and platform naming. Migration cost is one-time and bounded.
**Implementation:** Build a one-time migration import tool that converts existing donor files to the new names. No permanent compatibility layer.

### D4. Workspace count in v1

**Decision:** Support multiple workspaces in the data model, validate with one primary workspace first.
**Rationale:** Building multi-workspace into the model is cheap. Constraining validation to one workspace keeps the runtime simple while the core hardens.
**Implementation:** Workspace table and routing support N workspaces. CLI and UI default to the primary workspace. Multi-workspace activation gated behind config.

---

## Runtime Core

### D5. Session continuity

**Decision:** Persistent SessionRoots only where continuity is materially useful.
**Rationale:** Blanket persistence causes memory drift and makes debugging harder. Each run category gets the continuity policy that fits its purpose.
**Implementation:** Heartbeat gets a dedicated persistent SessionRoot. Interactive gets its own. Recurring tasks get one SessionRoot per task. One-shots are ephemeral. No sharing across categories by default.

### D6. Critical file mutability

**Decision:** Operator-owned and read-only by default. Agent writes blocked unless an explicit receipted workflow unlocks them.
**Rationale:** Instruction files define the agent's operating envelope. Allowing uncontrolled mutation breaks the trust model.
**Implementation:** Engine marks WORKSPACE.md, PROJECT.md, HEARTBEAT.md, and IDENTITY.md as read-only. A receipted mutation workflow (request -> operator approval -> write -> receipt) can be added if a real use case demands it.

### D7. Intervention model

**Decision:** Interventions block automatic progress for: missing credentials, instruction conflicts, workspace errors, policy violations, tool failures needing judgment, and retry budget exhaustion.
**Rationale:** The daemon must not silently proceed past conditions that could cause damage or produce wrong results. Blocking is the safe default.
**Implementation:** Each intervention type gets a typed event. The daemon pauses the run, emits the event, and waits for operator resolution via CLI, API, or UI.

### D8. Concurrency

**Decision:** One active run per workspace by default. Heartbeat runs at lower priority than manual or recovery runs.
**Rationale:** Single-run simplicity eliminates race conditions and locking complexity in v1. Multiple concurrent runs deferred to a later phase.
**Implementation:** Run scheduler enforces one-at-a-time per workspace. If a heartbeat is running and a manual run is requested, heartbeat yields. Concurrent run support is a future extension.

---

## Memory and Knowledge

### D9. Memory architecture

**Decision:** SQLite-native hybrid search using FTS5 + sqlite-vec with embedded vectors. No external services.
**Rationale:** Keeps the stack self-contained and portable. Two-stage retrieval (fast index search then LLM reranking) gives good recall without service dependencies. Replaces the external QMD tool with built-in retrieval.
**Implementation:** Markdown files serve as the human-readable layer. SQLite memory DB serves as the machine-queryable layer. Memory types: episodic, semantic, procedural, working. Features: confidence decay, consolidation, deduplication, provenance tracking.

### D10. Daily summaries vs curated memory

**Decision:** Daily summaries are automatic. Curated memory only by explicit promotion.
**Rationale:** Automatic curation causes drift and makes it hard to audit what the agent "knows." Promotion requires a diff and a receipt.
**Implementation:** End-of-day summarization runs automatically. Promotion to curated memory is a distinct action that records what changed and why.

### D11. Knowledge ingestion scope

**Decision:** Workspace and project docs only at first. External imports later.
**Rationale:** Constraining scope keeps the indexing pipeline simple and avoids pulling in uncontrolled content.
**Implementation:** Indexer walks workspace and project directories for markdown and config files. External repo import is a future feature.

---

## Interface Boundary

### D12. First UI surface

**Decision:** Minimal local web inspector first, then a Swift macOS app as the polished second surface.
**Rationale:** A web inspector is faster to build, validates the API contract, and works immediately. The Swift app comes after the API is stable.
**Implementation:** Web inspector served by the daemon on loopback. Read-only views of runs, receipts, memory, and config. Swift app built against the same API once the contract is proven.

### D13. API schema strategy

**Decision:** Code-first Zod schemas, exported as JSON Schema, with auto-generated client types for TypeScript and Swift.
**Rationale:** Zod gives runtime validation and TypeScript types from a single source. JSON Schema export enables cross-language client generation without manual duplication.
**Implementation:** Define all API shapes as Zod schemas. Generate JSON Schema for documentation and Swift codegen. TypeScript clients infer types directly from Zod.

### D14. Swift daemon management

**Decision:** Observe plus basic lifecycle (start, stop, restart). Canonical service logic stays in CLI/daemon.
**Rationale:** The Swift app should not duplicate service management logic. It calls the same API endpoints as the CLI.
**Implementation:** Swift app shows daemon status, recent runs, and logs. Start/stop/restart actions call the control API. No direct process management in the Swift layer.

---

## Deployment and Trust

### D15. Security envelope

**Decision:** Primary macOS user for v1. Paths designed for later isolation.
**Rationale:** Matches real single-user usage. A dedicated OS user, VM, or container can be added later without restructuring.
**Implementation:** All paths use `~/Library/Application Support/Popeye/` and are configurable. No hardcoded assumptions about the current user beyond v1 convenience.

### D16. Remote exposure

**Decision:** Loopback only in v1. Auth token required even on loopback. CSRF protection on mutations.
**Rationale:** No remote access eliminates a large threat surface. Auth on loopback prevents local privilege escalation from other processes.
**Implementation:** Fastify binds to 127.0.0.1 only. Bearer token auth on all endpoints. CSRF token required for state-changing requests.

### D17. Backup scope

**Decision:** Back up config, DB, receipts, and workspaces. Pi session continuity is nice-to-have but rebuildable.
**Rationale:** These four categories represent canonical state. Pi sessions can be reconstructed from receipts and memory if lost.
**Implementation:** Backup tool exports config, SQLite DB, receipt log, and workspace directories. Restore tool imports them. Pi session data optionally included.

---

## Migration from OpenClaw

### D18. Migration depth

**Decision:** Migrate instructions, memory, and schedules. Start fresh sessions.
**Rationale:** Durable knowledge transfers. Historical OpenClaw transcripts add complexity without proportional value.
**Implementation:** Migration tool reads existing instruction files, memory markdown, and cron definitions. Converts to Popeye formats. No transcript import.

### D19. Must-have donor concepts

**Decision:** The following donor concepts carry forward on day one:
- Heartbeat semantics and HEARTBEAT.md
- Recurring jobs / cron scheduling
- Workspace and project organization model
- Markdown durable memory with daily notes
- Receipts and operational visibility
- Memory write discipline (daily summaries, explicit promotion to curated)

**Rationale:** These are the proven patterns that define the product's value. Everything else is either replaced or deferred.

### D20. Must-not-port

**Decision:** The following are explicitly excluded from the roadmap:
- Full channel ecosystem (only a thin Telegram adapter)
- Media pipeline
- Plugin/skill marketplace
- Donor UI stack (Control UI, Canvas)
- Gateway multi-channel abstractions
- ACP agent dispatch protocol

**Rationale:** These represent donor complexity that does not serve the single-user local-first product. Porting them would dilute focus and bloat the codebase.

---

## Supplementary Decisions (from design interview)

These decisions were made during the interview process and are equally binding.

| Topic | Decision | Notes |
|---|---|---|
| Product name | **Popeye** (CLI: `pop`, daemon: `popeyed`) | |
| Pi fork repo name | **`pi`** | |
| Node version | **Node 22 LTS** | |
| Package manager | **pnpm** | |
| Monorepo tooling | **pnpm + Turborepo** | |
| Config format | **JSON with Zod validation** | |
| API framework | **Fastify** | |
| macOS data path | **~/Library/Application Support/Popeye/** | |
| Conversational surface | **Telegram** (allowlist-only, no pairing) as primary | Thin bridge to the control API. CLI/web/Swift for inspection and admin. |
| Heartbeat default interval | **1 hour**, configurable per-workspace | |
| Cost/usage tracking | **Baked into receipt schema from day one** | Real requirement, not deferred |
| Builder team model | **Primarily AI agents**, user reviews and decides | |
| Implementation-ready standard | **An agent can pick up docs cold and build without asking questions** | |
