# Popeye macOS Dashboard/Client Open Questions

## Purpose

This document captures the remaining decisions that could affect implementation. It is **not** a parking lot for avoiding choices. Each question includes a recommendation and a suggested path to resolution.

---

## Highest-priority recommendation summary

If only a few questions get resolved immediately, resolve these first:

1. How the native app obtains and understands auth context
2. Whether the schema/codegen export path will be fixed early or later
3. Whether daemon lifecycle controls are intentionally absent from the API
4. Whether the first native release stops at operator-console scope or pushes into broader domain parity
5. How the native app will be packaged with Popeye’s existing macOS distribution

---

## Product questions

## 1. Is the first native release dashboard-only, command-center-first, or broad parity?

### Recommendation

Ship a **read-heavy operator console**:
- dashboard home
- command center
- runs/jobs/receipts
- interventions/approvals
- usage/security
- connections overview

Do **not** aim for broad parity in the first release.

### Why

That is the highest-value slice already supported by the strongest API surfaces. It keeps the native app useful without forcing every web inspector surface into Swift prematurely.

### Resolution path

Treat this as decided unless repo leadership explicitly wants a larger surface area and accepts the cost.

---

## 2. Should the dashboard be the landing screen if Command Center is the main value?

### Recommendation

Yes. Land on **Dashboard**, but make **Command Center** the likely second click and the most used operational surface.

### Why

The dashboard is a better first-run and reconnection experience. Command Center is better for sustained monitoring.

### Resolution path

No blocker. Implement this directly.

---

## 3. Which surfaces should remain web-first for now?

### Recommendation

Keep these web-first or CLI-first initially:

- deep connection setup/remediation
- standing approvals and automation grants
- deep policy authoring
- people merge/split/identity repair
- files write-intent review/admin
- finance/medical import administration
- daemon lifecycle / upgrade / rollback

### Why

These are broader admin workflows, not the core native operator-console value.

### Resolution path

Document them clearly in the native app as unsupported or handoff flows rather than hiding them ambiguously.

---

## API and contract questions

## 4. Should the app rely on the current generated Swift models?

### Recommendation

No.

Use hand-authored transport DTOs for the first subset, and fix the generator/export path in parallel or later.

### Why

The current generated Swift output is not a trustworthy canonical model layer for a serious app.

### Resolution path

- Phase 1–3: hand-author subset DTOs
- parallel backend/tooling work: repair schema/codegen
- later: decide whether generated transport DTOs replace hand-authored ones behind adapters

---

## 5. Does the native app need an auth-role introspection endpoint?

### Recommendation

Yes. Add something like:

`GET /v1/auth/context`

returning at least:
- auth mode
- current role

### Why

The app should know whether it is connected as `readonly`, `service`, or `operator` without learning that only by failing mutations.

### Resolution path

Treat this as the highest-value additive backend refinement for native.

---

## 6. Does native need a command-center summary endpoint?

### Recommendation

Not to start.

Begin with existing endpoints and a centralized refresh scheduler. Add a summary endpoint only if:
- request fan-out becomes noisy
- both native and web want the same aggregation
- profiling shows a real problem

### Why

The existing API is already enough for Phase 1–3.

### Resolution path

Revisit after a real command-center implementation exists and can be profiled.

---

## 7. Should daemon start/stop/restart be available in native?

### Recommendation

Not until there are explicit control API routes for it.

### Why

Historical docs mention daemon lifecycle control via API, but current repo truth exposes daemon state/scheduler reads, not start/stop/restart routes. The native app should not invent process management or shell out around the architecture.

### Resolution path

One of two explicit choices should be made:
- add lifecycle endpoints later, or
- keep daemon lifecycle CLI/installer-first

Until then, native shows status only.

---

## UX questions

## 8. Should the app be a standard windowed app, a menu-bar app, or both?

### Recommendation

Start as a **standard windowed app** with split-view navigation. Consider a **status-only menu bar extra** later.

### Why

The native value is dense supervision and drill-down, not menu-bar minimalism.

### Resolution path

Treat menu bar as Phase 5 optional, not phase-1 scope.

---

## 9. What is the minimum supported macOS version?

### Recommendation

Target a modern baseline that supports SwiftUI comfortably and allows Observation/Concurrency-first architecture. If a concrete repo policy is needed, **recommend macOS 14+** unless product constraints say otherwise.

### Why

A lower minimum version complicates implementation without clear repo evidence that it is needed.

### Resolution path

Lock this before project creation so architecture choices (`@Observable`, table features, testing targets) do not churn.

---

## 10. Should unsupported native surfaces be hidden or shown with handoff affordances?

### Recommendation

Show them only if doing so adds clarity, and always with an honest handoff:
- “Open in Web Inspector”
- “Use CLI”
- or “Not in native yet”

Do not show dead placeholder routes with empty chrome.

### Why

The operator should understand product boundaries, not discover them by failure.

### Resolution path

Decide per screen, but use a standard callout component.

---

## Auth and security questions

## 11. How should the operator provide the bearer token?

### Recommendation

Use a direct, explicit token-entry flow in v1:
- base URL field
- token field
- store token in Keychain

Do not parse internal auth files in v1 unless the repo explicitly blesses that as a stable client contract.

### Why

Direct entry is simple, explicit, and architecture-safe. Parsing runtime auth storage risks coupling to internal formats and rotation behavior.

### Resolution path

Implement token entry in Phase 1. Later, if desired, add an official export/import path via CLI or a stable API/command.

---

## 12. Should the app support readonly tokens or operator-only tokens?

### Recommendation

Support whichever valid token the operator provides, but optimize UX for **operator** because many useful surfaces are operator-gated. When role introspection exists:
- enable full native scope for operator
- show reduced read-only mode for readonly/service principals

### Why

Repo truth supports multiple roles. The app should not artificially reject a valid readonly connection, but it should be honest about what that connection can do.

### Resolution path

Depends on auth-context endpoint or robust 403 handling.

---

## 13. Should the app persist fetched operational data to disk?

### Recommendation

No, not beyond small UI preferences. Keep domain snapshots in memory only.

### Why

Popeye runtime already owns durable truth. Persisting operational snapshots in the app adds security and consistency burden for little value.

### Resolution path

Treat “persistent local cache of runtime data” as out of scope unless there is a strong later reason.

---

## Packaging and distribution questions

## 14. Should the native app be bundled into the main Popeye `.pkg`?

### Recommendation

Yes, once the app is mature enough to ship. Do not invent a second installer story unless release engineering explicitly wants one.

### Why

Repo truth already points to a signed/notarized macOS `.pkg` as the official release channel. The app should fit that system.

### Resolution path

Phase 5 release-engineering work should determine:
- install location
- signing/notarization path
- whether the app ships by default or as an optional component initially

---

## 15. Should the app be sandboxed?

### Recommendation

Prefer a sandboxed posture if loopback networking and planned capabilities remain straightforward. If it becomes disproportionately painful, make an explicit security tradeoff rather than drifting silently.

### Why

Popeye is security-conscious. The app should start from least privilege.

### Resolution path

Resolve before packaging hardening in Phase 5. Do not let this block Phase 1 coding.

---

## 16. Should the app own provider OAuth flows later?

### Recommendation

Maybe later, but not in the first release.

### Why

Native can certainly launch browser-based OAuth and poll session status, but this is not where it should start. The web inspector already proves the broader UX.

### Resolution path

Revisit only after the core native operator console is stable and if there is strong user demand.

---

## Rollout and scope questions

## 17. How far should native write support go in the first serious release?

### Recommendation

Stop at:
- retry/cancel run
- pause/resume/enqueue job
- resolve intervention
- approve/deny approval

### Why

These are high-value, low-breadth operator actions directly tied to the core console.

### Resolution path

Any additional mutation should need an explicit scope decision, not casual creep.

---

## 18. Should later native work target broad domain parity or a curated set of native-worthy surfaces?

### Recommendation

Favor a **curated native set** rather than parity for parity’s sake.

Later candidates:
- instructions preview
- memory search
- people browser
- email/calendar/github/todo digests
- finance/medical digests

### Why

Some web inspector screens exist because the API exists, not because they are all equally valuable as native Mac workflows.

### Resolution path

Use real operator usage and pain points to choose the second-wave surfaces.

---

## 19. Should the app eventually support multiple windows for parallel inspection?

### Recommendation

Not initially. Start with one strong main window. Add dedicated run/receipt windows only if the selection-driven inspector proves limiting.

### Why

Multiwindow support increases complexity in state restoration, selection ownership, and testing.

### Resolution path

Revisit after Phase 3 or 4 based on actual usage.

---

## Recommended resolution order

Resolve these in this order:

1. auth token entry + Keychain posture
2. minimum macOS target
3. auth-context endpoint decision
4. daemon lifecycle strategy (status-only vs future lifecycle API)
5. packaging inclusion strategy
6. codegen repair timing
7. menu bar and later parity questions

---

## Default assumptions if no further decision is made

If implementation must start without more discussion, assume:

- operator-console scope, not parity
- dashboard home + command-center core
- bearer token entry + Keychain
- no direct auth-file parsing
- no daemon lifecycle controls
- hand-authored DTO subset
- one windowed split-view app
- no persistent domain cache
- no menu bar extra in v1
- web-first handoff for unsupported surfaces

These assumptions are the most repo-aligned and lowest-risk defaults.
