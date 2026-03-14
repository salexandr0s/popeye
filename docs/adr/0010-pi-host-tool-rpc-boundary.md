# ADR 0010: Pi host-tool RPC boundary

- Status: Accepted
- Date: 2026-03-14

## Context

Popeye currently supports runtime-owned tools when running against Pi, but Pi
does not yet expose a first-class host-tool callback protocol for Popeye to
bind to.

The current integration works by:

- generating a temporary Pi extension inside `@popeye/engine-pi`
- loading it with `--extension`
- tunneling runtime-tool requests through
  `extension_ui_request(method:"editor", title:"popeye.runtime_tool")`
- returning the host result through `extension_ui_response(value)`

This keeps all Pi-specific behavior inside `@popeye/engine-pi` and works for
basic request/response host tools, but it is still a workaround over Pi's
extension UI carrier rather than an engine-level tool RPC.

## Decision

Keep the current extension-UI bridge as the **temporary compatibility path**,
but do **not** treat it as the intended long-term architecture.

For the long term, Popeye should adopt a **proper Pi-side host-tool RPC
protocol** exposed by Pi itself and consumed only through `@popeye/engine-pi`.

## Limitations of the current workaround

- Popeye host tools are coupled to Pi's extension UI transport instead of a
  dedicated host-tool contract.
- Tool payloads are marshalled through JSON strings in an editor-dialog carrier,
  which is more fragile than a typed RPC envelope.
- Cancellation semantics are indirect: Popeye cancels the run, not the
  individual tool call.
- Timeout handling is also host-side only today: Popeye can stop waiting on a
  tool call and suppress late settlement, but it cannot actually cancel the
  underlying host tool execution.
- Host-side streaming progress and partial tool updates are not surfaced back
  into Pi.
- Error handling works, but only by emulating tool results over a UI response
  path rather than a real tool/protocol error channel.
- The workaround depends on UI-carrier behavior that Pi could reasonably evolve
  independently of host-tool needs.

## Options considered

### Option A — Keep the extension-UI bridge as the permanent architecture

**Rejected.**

Pros:

- no Pi fork work required now
- already works for basic request/response host tools

Cons:

- bakes a workaround into the product architecture
- leaves Popeye dependent on extension UI semantics for a core engine/runtime
  boundary
- limits future capabilities such as richer typed errors, progress, and
  explicit tool-call cancellation

### Option B — Add a proper Pi-side host-tool RPC protocol

**Accepted.**

Pros:

- gives Popeye an explicit engine-level contract for host-owned tools
- reduces coupling to UI-specific behavior
- creates a better place for typed payloads, explicit errors, progress, and
  cancellation semantics
- fits the rule that engine-level capabilities should live in Pi when they are
  truly engine-level

Cons:

- requires an isolated Pi fork change and deliberate compatibility testing
- adds a new protocol surface that must be versioned and documented

### Option C — Move runtime-owned tools fully out of Pi runs

**Rejected for now.**

Pros:

- avoids changing Pi

Cons:

- weakens the product goal of letting Pi-driven runs call controlled
  Popeye-owned runtime tools
- pushes orchestration complexity upward instead of cleaning up the engine
  boundary

## Recommendation for the future Pi protocol

When scheduled as an isolated Pi change, Pi should expose a dedicated RPC
mechanism for host tools with the following minimum properties:

- Pi emits a typed host-tool request event instead of a UI carrier message
- Popeye replies with a typed host-tool result envelope
- explicit success/error/cancel result states
- stable tool call IDs
- room for incremental progress or streaming updates later
- backward-compatible fallback so older Popeye/Pi combinations can still use the
  current workaround during migration

## Migration and compatibility notes

- Popeye keeps the current extension-UI bridge until Pi exposes the proper
  host-tool RPC.
- The future rollout should happen in two isolated steps:
  1. add the Pi protocol behind a compatibility gate
  2. update `@popeye/engine-pi` to prefer the native Pi protocol and fall back
     to the workaround when unavailable
- `docs/pi-fork-delta.md` must track the exact upstream/fork delta when that Pi
  protocol lands.
- Pi smoke and failure-injection coverage must be updated to exercise both the
  native path and any temporary fallback path during migration.

## Consequences

- No immediate Pi protocol change is required for this pass.
- The current bridge remains supported, tested, and explicitly documented as a
  workaround.
- Recent hardening improves timeout diagnostics and late-settlement suppression,
  but does not change the long-term architectural target.
- Future Pi work now has a clear architectural target and migration path.
