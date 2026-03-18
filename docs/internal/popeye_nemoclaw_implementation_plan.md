# Popeye ← NemoClaw Implementation Plan

Audience: coding agent working on **Popeye** and the separate **Pi foundation/fork**.

Purpose: implement the small set of **NemoClaw-inspired patterns** that actually improve Popeye’s long-term design, without dragging in OpenShell/OpenClaw/NVIDIA assumptions that do not fit a local-first, single-operator personal agent.

This plan is intentionally **implementation-first**, not idea-first. It assumes Popeye already has a real runtime shape (`@popeye/runtime-core`, `@popeye/engine-pi`, `@popeye/control-api`, `pop`, `popeyed`, memory, receipts, interventions, scheduler, Telegram adapter) and that Pi remains the engine foundation rather than the product.

---

## 1. Executive direction

### Copy these ideas from NemoClaw

1. **Thin product shim, thicker execution substrate**
   - Keep the Popeye-facing integration narrow.
   - Let environment/policy/enforcement evolve behind that boundary.

2. **Versioned environment profile**
   - Treat the execution envelope as a versioned object with identity, diffs, validation, and status.

3. **Default-deny network posture**
   - Unknown outbound network should become visible and eventually blocked.
   - Approval should be explicit, inspectable, and receipted.

4. **Filesystem scope as a first-class concept**
   - Runs should execute with an explicit read/write/protected path envelope.

5. **Operator-visible environment lifecycle**
   - Resolve / plan / apply / status / doctor are good patterns.

6. **Environment health and denied-action observability**
   - Surface policy, profile, health, blocked actions, and pending approvals to the operator.

### Do **not** copy these things from NemoClaw

1. OpenShell itself.
2. Docker/K3s/OCI/blueprint release machinery.
3. NVIDIA cloud inference coupling.
4. OpenClaw plugin compatibility as an architectural goal.
5. Session-only, TUI-only approval as the main permission model.
6. Remote-GPU / Brev / tunnel / cloud deployment assumptions.
7. YAML policy as a default format.

### Core rule

**Copy the posture, not the stack.**

Popeye should borrow NemoClaw’s approach to containment and operator control, then express it through Popeye’s existing local runtime, receipts, interventions, API, CLI, and workspace model.

---

## 2. Hard architectural rules for the coding agent

1. **Do not move product semantics into Pi.**
   - Popeye keeps tasks, jobs, runs, receipts, memory, interventions, workspaces, projects, schedules, approval history, and operator-facing policy semantics.

2. **Do not move low-level enforcement into Popeye business logic unless there is no substrate hook yet.**
   - Low-level egress control, execution envelopes, host-tool mediation, and process/file/network restrictions belong in the Pi foundation or an adjacent substrate layer.

3. **Do not replace the current subprocess/RPC boundary during this work.**
   - Keep Popeye talking to Pi through a narrow owned adapter while hardening. The subprocess boundary is currently helpful.

4. **Do not build a generic platform DSL.**
   - Keep policy types small, typed, and use-case driven.

5. **Do not import NemoClaw/OpenShell code.**
   - Transfer concepts. Reimplement in Popeye/Pi-native ways.

6. **Do not widen Popeye’s trust boundary by accident.**
   - No automatic third-party package install.
   - No arbitrary extension loading in always-on mode.
   - No donor-compatibility shims that reopen the surface NemoClaw was trying to constrain.

7. **Keep JSON + Zod for new Popeye-owned config/profile artifacts.**
   - NemoClaw’s YAML is a donor pattern, not a format requirement.

---

## 3. What to copy, and how to translate it

| NemoClaw pattern | What it means there | Popeye translation | Repo lane |
|---|---|---|---|
| Thin plugin + versioned blueprint | Small stable CLI/plugin surface; orchestration lives elsewhere | Keep `@popeye/engine-pi` narrow; add a richer owned substrate contract behind it | Both |
| Blueprint lifecycle: resolve → verify → plan → apply → status | Managed environment lifecycle | `RuntimeProfileManifest` + `pop env plan/apply/status/doctor` | Popeye |
| Strict baseline policy | Default-deny network/filesystem posture | Capability packs + egress groups + filesystem scopes | Both |
| Operator approval of unknown egress | Unknown outbound access is blocked and surfaced | Reuse Popeye interventions and receipts, not a TUI-only flow | Popeye |
| Sandbox filesystem policy | Read/write scope is explicit | Derive per-run `FilesystemScope` from workspace/project/control-file rules | Both |
| Health/status/logs surfaces | Operator can inspect environment state | Extend existing control API + CLI + inspector with environment views | Popeye |
| Inference routing profile | Agent traffic goes through managed provider policy | Keep Popeye on Pi’s provider abstraction; only expose named provider profiles | Pi lane + Popeye display |

---

## 4. The biggest immediate gap to fix before anything else

NemoClaw assumes a constrained execution substrate.

Pi, by contrast, is a powerful agent toolkit whose package/extension model is intentionally open. In a general coding-agent context that is fine. In **Popeye’s always-on personal-agent context** it is too open.

### Therefore the first change is not network policy.

The first change is:

## **Introduce a Popeye execution mode in the Pi fork that disables untrusted extensibility by default.**

That mode should:

- ignore project-level package auto-installation
- disable arbitrary third-party extension/package discovery unless allowlisted
- disable package mutation flows (`install`, `update`, etc.) in unattended Popeye mode
- load only the extensions/tools explicitly enabled by Popeye
- expose its effective extension/tool set back to Popeye for audit/status display

This is the closest equivalent to NemoClaw’s “controlled environment” that can be implemented immediately without dragging in containers or OpenShell.

### Why this comes first

Because otherwise:

- a workspace-level `.pi` config can silently widen the runtime surface
- third-party extensions can execute with full host permissions
- policy work added at the Popeye layer can be bypassed by Pi-level behavior

Do this before adding “secure always-on” claims.

---

## 5. Target architecture delta

### Keep the current big split

- **Popeye** = product runtime and operator control plane
- **Pi** = engine and execution substrate

### Add one missing concept between them

Add a first-class **execution envelope**.

```ts
export type RuntimeProfileManifest = {
  id: string;
  version: number;
  label: string;
  mode: 'restricted' | 'interactive' | 'elevated';
  capabilityPacks: string[];
  providerProfile: string;
  egressGroups: EgressGroup[];
  filesystem: FilesystemProfile;
  extensionPolicy: {
    allowProjectExtensions: boolean;
    allowThirdPartyPackages: boolean;
    allowPackageMutation: boolean;
    allowlistedExtensions: string[];
  };
};

export type ExecutionEnvelope = {
  profileId: string;
  workspaceId: string;
  projectId?: string;
  readRoots: string[];
  writeRoots: string[];
  protectedPaths: string[];
  scratchRoot: string;
  allowedEgressGroupIds: string[];
  escalationPolicy: 'deny' | 'intervention';
  runLabel: string;
};
```

### The runtime call should become conceptually closer to this

```ts
export interface SubstrateAdapter {
  run(request: EngineRunRequest, envelope: ExecutionEnvelope): Promise<EngineRunResult>;
  getHealth(): Promise<SubstrateHealth>;
  getActiveProfile(): Promise<RuntimeProfileState>;
  getCapabilities(): Promise<SubstrateCapabilities>;
}
```

Implementation note:
- keep the package name `@popeye/engine-pi` for now unless the abstraction pressure becomes real
- do **not** create a new package just because the concept exists

---

## 6. Workstreams by repo

## 6.1 Popeye repo workstream

Own here:

- profile selection
- mapping capability packs to product semantics
- deriving execution envelopes from workspace/project/task context
- durable approvals and policy overlays
- interventions for denied actions
- receipts for approvals/denials
- environment status / doctor / plan / apply operator surfaces
- profile visibility in CLI / API / web inspector
- protected-file semantics for `WORKSPACE.md`, `PROJECT.md`, `IDENTITY.md`, `HEARTBEAT.md`, curated memory targets, etc.

Likely files/modules to touch:

- `packages/contracts/*`
- `packages/runtime-core/src/runtime-service.ts`
- `packages/runtime-core/src/security-audit.ts`
- `packages/control-api/src/index.ts`
- `apps/cli/src/index.ts`
- `packages/receipts/*`
- `packages/observability/*`

Likely new files in `packages/runtime-core/src/`:

- `environment-service.ts`
- `approval-service.ts`
- `execution-envelope.ts`
- `policy-service.ts`
- `substance-event-bridge.ts` or `subtrate-event-bridge.ts` (pick one name and spell it correctly in code)
- `environment-doctor.ts`

## 6.2 Pi foundation repo workstream

Own here:

- Popeye execution mode / restricted runtime mode
- extension/package lockdown behavior
- first-class host/runtime tool RPC (replace the current carrier hack)
- substrate-side policy evaluation hooks
- known egress mediation for Popeye-owned integrations/tools
- filesystem scope enforcement hooks where technically feasible
- health/capabilities/profile reporting back to Popeye

Do **not** attempt to turn Pi into OpenShell.

Do **not** implement Popeye’s approval UX here.

---

## 7. Phase plan

## Phase 0 — Lock down the Pi surface for Popeye mode

### Objective

Stop Popeye from inheriting Pi’s open extension/package model in unattended always-on operation.

### Tasks

#### Pi lane

1. Add a **Popeye mode** or equivalent config flag to the Pi fork.
2. In that mode:
   - disable project package auto-install
   - disable loading unallowlisted project/global extensions
   - disable package install/update/remove operations
   - expose a machine-readable summary of effective tools/extensions/providers
3. Make the mode selectable by `@popeye/engine-pi` when spawning Pi.
4. Emit a clear diagnostic if Popeye mode is requested but the Pi checkout does not support it.

#### Popeye lane

1. Extend `@popeye/engine-pi` config to request restricted Popeye mode.
2. Make `pop pi smoke` and startup checks verify that restricted mode is active.
3. Add a security audit finding when the Pi checkout is too permissive.

### Acceptance criteria

- Popeye runs do **not** auto-load arbitrary `.pi` project packages/extensions.
- Popeye can display the exact active tool/extension set.
- Startup fails closed or warns loudly if the Pi checkout is not in Popeye-safe mode.

### Risk

Low-to-medium. High leverage.

---

## Phase 1 — Introduce runtime profiles and environment status

### Objective

Make the execution envelope a visible, typed, versioned object before trying to enforce it.

### Tasks

#### Popeye lane

1. Add new shared contract types:
   - `RuntimeProfileManifest`
   - `RuntimeProfileState`
   - `CapabilityPack`
   - `EgressGroup`
   - `FilesystemProfile`
   - `ExecutionEnvelope`
   - `SubstrateHealth`
   - `SubstrateCapabilities`
   - `SubstrateEvent`
   - `ApprovalRequest`
   - `ApprovalDecision`
2. Store profile manifests under a Popeye-owned JSON path, for example:
   - `config/profiles/default.local.json`
   - `config/profiles/telegram.json`
   - `config/profiles/github-read.json`
3. Build `EnvironmentService` in runtime-core.
4. Derive an `ExecutionEnvelope` from workspace/project/task context.
5. Extend `security-audit.ts` into a broader **environment doctor**.
6. Add control API endpoints:
   - `GET /v1/environment/status`
   - `GET /v1/environment/doctor`
   - `GET /v1/environment/profile`
   - `GET /v1/environment/policy`
7. Add CLI commands:
   - `pop env status`
   - `pop env doctor`
   - `pop env profile show`
   - `pop env policy show`

#### Pi lane

1. Extend the engine adapter-facing side to report:
   - health
   - current profile id
   - effective capabilities
2. No blocking enforcement yet.

### Acceptance criteria

- Operator can inspect the active execution profile.
- Every run can be associated with a profile id and envelope summary.
- Environment doctor reports extension policy, active provider profile, and known substrate limitations.

### Risk

Medium.

---

## Phase 2 — Replace the temporary runtime-tool bridge with a first-class contract

### Objective

Stop routing Popeye-owned privileged runtime tools through a temporary UI-carrier mechanism.

### Why now

Policy work becomes unreliable if privileged runtime tools are hidden behind a workaround channel.

### Tasks

#### Pi lane

1. Add a first-class host/runtime tool bridge for Popeye.
2. Each runtime tool call must carry:
   - stable `toolId`
   - `toolName`
   - capability pack ids
   - declared intent(s), such as:
     - `network:github_read`
     - `filesystem:workspace_write`
     - `sensitive:calendar_write`
3. Emit structured events for:
   - tool call
   - tool result
   - tool deny
   - tool timeout
   - tool escalation requested
4. Keep cancellation semantics explicit.

#### Popeye lane

1. Update `@popeye/engine-pi` to use the new bridge.
2. In runtime-core, add a `SubstrateEventBridge` that converts those events into:
   - run events
   - receipts
   - security audit findings
   - interventions when needed
3. Update receipt rendering to show denied/escalated actions.

### Acceptance criteria

- Runtime-owned tools no longer depend on the current carrier hack.
- Every privileged tool call is identifiable and policy-evaluable.
- Denied/escalated tool calls show up in receipts and the event log.

### Risk

Medium-to-high.

---

## Phase 3 — Egress policy in audit-first mode

### Objective

Adopt NemoClaw’s default-deny network posture, but roll it out honestly and incrementally.

### Important reality check

NemoClaw/OpenShell can mediate network at a stronger layer than Popeye currently can on local macOS.

So the first enforcement target is:

- Popeye-owned runtime tools and integrations
- Pi-side host tool bridge where Popeye controls the HTTP client path

Not yet:

- arbitrary shell commands
- arbitrary third-party binaries
- generic project code execution outside Popeye-owned integrations

### Tasks

#### Popeye lane

1. Define named egress groups, not raw host allowlists sprinkled everywhere.
2. Define initial capability packs, for example:
   - `base_local`
   - `telegram_bridge`
   - `github_read`
   - `github_write`
   - `gmail_read`
   - `gmail_send`
   - `calendar_read`
   - `calendar_write`
3. Store the selected capability packs in the active profile.
4. Extend receipts and run events to carry `would_deny` network findings.
5. Show recent denied/would-deny activity in CLI/API.

#### Pi lane

1. Add an egress policy evaluator for Popeye-owned network paths.
2. In **audit mode**, do not block yet; emit `would_deny` events with:
   - target host/port
   - binary or tool id
   - HTTP method/path when known
   - matching group (if any)
   - reason for non-match

### Acceptance criteria

- Popeye can show the operator exactly what outbound calls would have been denied.
- The denied-event model is stable enough to build approvals on top of it.
- No silent outbound access by Popeye-owned integrations.

### Risk

Medium.

---

## Phase 4 — Durable approvals and real enforcement

### Objective

Turn denied-action visibility into a durable operator control model.

### Rule

Do **not** copy NemoClaw’s session-only approval as Popeye’s main model.

Popeye should prefer:

- durable approval records
- explicit policy overlays/diffs
- receipts of who approved what and why
- optional temporary approvals only when clearly marked

### Tasks

#### Popeye lane

1. Add `ApprovalService` in runtime-core.
2. Reuse the existing intervention system for blocked actions.
3. Store approval records in the runtime DB.
4. Add policy overlays that can be:
   - temporary with TTL
   - durable until revoked
5. Add control API endpoints:
   - `GET /v1/approvals`
   - `POST /v1/approvals/:id/approve`
   - `POST /v1/approvals/:id/deny`
   - `GET /v1/environment/policy/diff`
6. Add CLI commands:
   - `pop approvals list`
   - `pop approvals approve <id>`
   - `pop approvals deny <id>`
   - `pop env policy diff`
7. Include approvals in receipts and audit logs.

#### Pi lane

1. Support real block/allow decisions from the current running overlay.
2. Apply approved overlays without requiring a full runtime restart when technically possible.
3. Emit a structured `policy_denied` event when enforcement blocks an action.

### Acceptance criteria

- A denied network action creates an intervention/approval request.
- Approving it creates a durable or temporary overlay.
- Re-running the action succeeds only when policy now allows it.
- Denials and approvals are visible in receipts and status.

### Risk

High.

---

## Phase 5 — Filesystem scopes and protected paths

### Objective

Translate NemoClaw’s filesystem boundary into Popeye’s workspace/project semantics.

### Tasks

#### Popeye lane

1. Build a canonical path resolver and normalization layer.
2. Define:
   - read roots
   - write roots
   - protected paths
   - scratch root
3. Derive these from:
   - workspace root
   - project root
   - memory target directories
   - control files (`WORKSPACE.md`, `PROJECT.md`, `IDENTITY.md`, `HEARTBEAT.md`, etc.)
4. Reuse the same protected-path rules for memory promotion and curated writes.
5. Add API/CLI inspection of the resolved filesystem scope for a run.

#### Pi lane

1. Make Popeye-owned file tools consume the filesystem scope.
2. Deny out-of-scope writes.
3. Deny writes to protected paths unless explicitly approved.
4. Perform symlink and traversal checks.

### Important limitation

Until there is a stronger local isolation backend, **generic shell / arbitrary process execution remains a gap**.

Therefore:

- always-on Popeye mode should run with a **restricted tool preset** by default
- generic shell / coding-agent powers should be opt-in, scoped, and visibly marked

### Acceptance criteria

- Out-of-scope writes are blocked and receipted.
- Protected files cannot be silently modified.
- Memory promotion and instruction-file protection share the same path policy machinery.

### Risk

High.

---

## Phase 6 — Environment lifecycle and bootstrap UX

### Objective

Borrow NemoClaw’s “onboard/status/logs” operator feel without copying its stack.

### Tasks

#### Popeye lane

1. Add an environment lifecycle command group:
   - `pop env init`
   - `pop env plan`
   - `pop env apply`
   - `pop env status`
   - `pop env doctor`
2. `pop env init` should:
   - validate config
   - initialize runtime paths
   - initialize auth/keychain state
   - verify restricted Pi mode
   - install/start `popeyed` if requested
   - select a default runtime profile
3. `pop env plan` should show diffs for:
   - profile changes
   - capability pack changes
   - provider profile changes
   - approval overlay changes
4. `pop env apply` should execute those changes.

### Acceptance criteria

- New-machine bootstrap is reproducible.
- Profile changes are inspectable before application.
- Operator can understand the current environment without reading internal files.

### Risk

Medium.

---

## Phase 7 — Optional later: stronger isolation backend

### Objective

Provide an escape hatch if Popeye’s local-first macOS posture eventually needs stronger containment than application-level mediation can offer.

### This is optional and later-stage

Only consider this after Phases 0–6 are working.

Possible directions:

- optional Linux sidecar/VM for high-risk automations
- optional OpenShell-like contained backend for a subset of workloads
- optional task classes that must execute in the stronger backend

### Rule

Do not make this the default developer path.

Popeye’s core value is local ownership and maintainability. Stronger containment can become an **optional mode**, not the baseline dependency story.

---

## 8. Exact changes to make in the Popeye repo

## 8.1 Shared contracts

Add types for:

- `RuntimeProfileManifest`
- `RuntimeProfileState`
- `CapabilityPack`
- `EgressGroup`
- `FilesystemProfile`
- `ExecutionEnvelope`
- `SubstrateCapabilities`
- `SubstrateHealth`
- `SubstrateEvent`
- `ApprovalRequest`
- `ApprovalDecision`
- `ApprovalRecord`
- `PolicyOverlay`

## 8.2 Runtime core

Add or extract services:

- `EnvironmentService`
- `ApprovalService`
- `PolicyService`
- `SubstrateEventBridge`
- `EnvironmentDoctor`
- `ExecutionEnvelopeResolver`

`PopeyeRuntimeService` should coordinate these services, not implement all their internals directly.

## 8.3 Engine adapter

Extend `@popeye/engine-pi` with:

- restricted Popeye mode negotiation
- profile/capabilities/health reporting
- execution envelope input
- structured deny/escalation events
- first-class runtime tool bridge

## 8.4 Control API

Add environment/approval endpoints.

Do **not** let clients infer state from SQLite or session files.

## 8.5 CLI

Add:

- `pop env *`
- `pop approvals *`
- `pop policy *` if needed, but keep verbs under `env` if possible

## 8.6 Receipts and observability

A receipt for a run should eventually include:

- profile id
- capability pack set
- envelope summary
- denied actions
- approvals consumed
- operator interventions created/resolved

---

## 9. Exact changes to make in the Pi foundation repo

1. Add a Popeye-safe mode that disables untrusted extensibility.
2. Keep subprocess/RPC compatibility.
3. Add first-class host/runtime tool mediation for Popeye runtime tools.
4. Emit machine-readable capability and health summaries.
5. Add policy evaluation hooks for network/file actions that Popeye-owned integrations perform.
6. Keep model/provider abstraction; do **not** hardcode NemoClaw/NVIDIA provider concepts into Pi for Popeye.

If you need a name for this internally, use something boring like:

- `restrictedHostMode`
- `popeyeRuntimeMode`
- `executionProfile`

Do **not** call it “blueprint” unless the implementation is genuinely blueprint-shaped.

---

## 10. Suggested PR sequence

1. **Pi fork: Popeye-safe restricted mode**
2. **Popeye: contracts + env status/doctor skeleton**
3. **Pi fork + engine-pi: first-class runtime tool bridge**
4. **Popeye + Pi: audit-only egress events**
5. **Popeye: durable approvals + policy overlays**
6. **Popeye + Pi: filesystem scopes and protected paths**
7. **Popeye: env init/plan/apply UX**
8. **Optional later: stronger isolation backend**

Keep these PRs small. Do not mix “Pi lockdown mode” with “UI polish” in the same change.

---

## 11. Tests required by phase

## Phase 0 tests

- Popeye mode ignores arbitrary project `.pi` package/extension configuration.
- Restricted mode summary is visible to Popeye.

## Phase 1 tests

- Profile schema validation.
- Envelope derivation golden tests.
- `env status` and `env doctor` contract tests.

## Phase 2 tests

- Runtime tool bridge protocol tests.
- Cancellation/timeout tests.
- Structured deny/escalation event tests.

## Phase 3 tests

- Egress matcher tests (host/port/method/path/tool).
- Audit-only event generation tests.
- Receipt/audit integration tests.

## Phase 4 tests

- Approval creation/resolution tests.
- Policy overlay persistence tests.
- Re-run after approval succeeds; deny remains blocked.

## Phase 5 tests

- Path normalization tests.
- Symlink escape tests.
- Protected-file deny tests.
- Memory-promotion path policy tests.

## End-to-end scenarios

1. Unknown GitHub API write attempt → denied event → intervention created → approval granted → rerun succeeds.
2. Attempt to modify `IDENTITY.md` directly → blocked → receipted.
3. Popeye daemon startup → env status shows restricted Pi mode, active profile, capability packs, and no policy drift.

---

## 12. Capability-pack starter set

Use named packs instead of raw one-off hostnames.

Recommended initial set:

- `base_local`
  - no arbitrary external network
  - workspace read
  - scratch write
  - memory DB access

- `telegram_bridge`
  - Telegram Bot API only
  - only when Telegram adapter enabled

- `github_read`
  - repo metadata / issue / PR read operations
  - separate from write

- `github_write`
  - explicit write paths only
  - likely approval-gated

- `gmail_read`
  - read/list/search/summarize only

- `gmail_send`
  - separate from read
  - approval-gated by default

- `calendar_read`
  - read availability/events only

- `calendar_write`
  - create/update/respond actions
  - approval-gated by default

- `workspace_write`
  - only inside approved write roots

- `operator_shell`
  - explicit interactive/elevated mode only
  - not part of unattended always-on default

Do not pre-allow broad generic web access just because NemoClaw has broad GitHub/registry rules for OpenClaw bootstrapping.

---

## 13. Anti-patterns to avoid

1. **Recreating OpenShell inside Popeye.**
2. **Adding Docker as a baseline requirement.**
3. **Building a new plugin ecosystem.**
4. **Letting runtime-core absorb every new environment concern directly.**
5. **Using prompt text instead of code for policy.**
6. **Relying on session-only approvals as the main security model.**
7. **Leaving generic shell/code-exec enabled in always-on mode while claiming strict policy.**
8. **Loading arbitrary Pi project settings in unattended Popeye mode.**
9. **Using YAML or OCI artifacts because NemoClaw does, without a local need.**
10. **Conflating provider profile selection with personal-agent permission semantics.**

---

## 14. Definition of done

This adaptation is successful when all of the following are true:

1. Popeye can report its **active runtime profile** and effective capability packs.
2. Popeye runs in a **restricted Pi mode** that does not auto-load arbitrary packages/extensions.
3. Popeye-owned privileged tools use a **first-class host/runtime tool contract**.
4. Unknown outbound actions become **visible**, then **approval-gated**, then **enforced**.
5. Filesystem read/write scope is explicit and protected files cannot be silently mutated.
6. Approvals are durable, receipted, and inspectable through the existing Popeye operator surfaces.
7. Popeye still feels like Popeye:
   - local-first
   - single-operator
   - maintainable
   - not vendor-coupled
   - not a clone of NemoClaw

---

## 15. Final instruction to the coding agent

Implement this plan in the following priority order:

1. **Reduce trust surface first** (Pi restricted mode).
2. **Make the execution envelope visible** (profiles, status, doctor).
3. **Replace provisional privileged-tool plumbing** (runtime tool bridge).
4. **Add audit-only policy events**.
5. **Only then add approvals and enforcement**.
6. **Only later add stronger containment backends**.

If a change makes Popeye feel more like a remote hosted platform, a plugin marketplace, or an OpenClaw compatibility shell, it is probably the wrong change.

If a change makes Popeye more like an owned local appliance with explicit boundaries, operator-readable policy, and durable audit, it is probably the right one.
