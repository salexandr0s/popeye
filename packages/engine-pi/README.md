# @popeye/engine-pi

The single integration point between the Popeye runtime and the Pi agent engine.
All Pi interaction flows through this package -- no other package imports Pi
directly.

## Purpose

Spawns Pi as a child process in `--mode rpc`, performs a JSONL handshake
(`get_state` then `prompt`), and normalizes Pi RPC responses/session events
into typed Popeye domain events. Handles process lifecycle including timeout
enforcement, RPC abort on cancellation, and SIGTERM/SIGKILL fallback. Provides
deterministic test doubles for use in unit and integration tests.

## Layer

Pi integration. Wraps engine internals behind a stable owned interface.

## Provenance

Pi wrapper. Runtime wrapping of the Pi engine primitive.

## Key exports

| Export                        | Description                                                   |
| ----------------------------- | ------------------------------------------------------------- |
| `EngineAdapter`               | Interface for engine lifecycle (`startRun`, `run`)            |
| `PiEngineAdapter`             | Production implementation via `child_process.spawn`           |
| `FakeEngineAdapter`           | Configurable test double (success, transient/permanent fail, timeout, protocol error) |
| `FailingFakeEngineAdapter`    | Simplified always-failing adapter for targeted failure tests  |
| `createEngineAdapter(config)` | Factory returning the appropriate adapter based on `AppConfig`|
| `inspectPiCheckout()`         | Check Pi checkout availability and version                    |
| `checkPiVersion()`            | Verify Pi checkout matches expected version                   |
| `runPiCompatibilityCheck()`   | End-to-end smoke test of a Pi adapter                         |

## Dependencies

- `@popeye/contracts` -- shared domain types (`NormalizedEngineEvent`, `UsageMetrics`, `AppConfig`)

## Usage

```ts
import { createEngineAdapter } from '@popeye/engine-pi';

const adapter = createEngineAdapter(config);
const result = await adapter.run({
  prompt: 'hello',
  cwd: '/absolute/worktree/path',
  modelOverride: 'popeye/custom-model',
});
console.log(result.events, result.usage);
```

## Structured run request support

Current `EngineRunRequest` behavior:

- `EngineAdapter.run()` and `EngineAdapter.startRun()` accept
  `EngineRunRequest` only
- supported execution controls: `prompt`, `cwd`, `modelOverride`,
  `runtimeTools`
- accepted runtime metadata (not forwarded into Pi RPC semantics yet):
  `workspaceId`, `projectId`, `sessionPolicy`, `instructionSnapshotId`,
  `trigger`

Notes:

- `cwd` must be an absolute existing directory; otherwise startup fails clearly
- `modelOverride` overrides any configured `--model` in `engine.args`
- runtime tools are currently bridged through a temporary Pi extension and
  `extension_ui_request(method:"editor")` carrier messages
- that bridge is a Popeye-owned workaround over Pi's extension UI channel, not
  a first-class upstream host-tool RPC protocol
- Popeye bounds each bridged runtime-tool call with `engine.runtimeToolTimeoutMs`
  (default `30000`) and emits structured bridge `tool_call` / `tool_result` diagnostics
- adapter tests cover malformed bridge payloads, tool exceptions, cancellation
  during an in-flight bridge request, multiple tool calls in a single run, and timeout behavior

## Pi launch contract

- Popeye owns the subprocess lifecycle and always appends `--mode rpc`
- Popeye sends JSONL commands on stdin:
  - `{"id":"popeye:get_state","type":"get_state"}`
  - `{"id":"popeye:prompt","type":"prompt","message":"..."}`
  - `{"id":"popeye:abort","type":"abort"}` on cancellation
- Pi returns JSONL `response` envelopes plus streamed `AgentSessionEvent`
  objects on stdout
- `@popeye/engine-pi` synthesizes Popeye `session`, `completed`, and `usage`
  events from that stream as needed
- Interactive RPC UI requests (`select`, `confirm`, `input`, `editor`) are
  treated as `protocol_error`; passive UI notifications (`setWidget`,
  `setStatus`, `notify`, etc.) are ignored

## Configuration note

- `engine.command` and `engine.args` must resolve to a runnable Pi CLI
- If `command` is `node` and `args` is empty, the adapter defaults to
  `packages/coding-agent/dist/cli.js` inside the configured Pi checkout
- If `command` is `node` and `args` begins with Pi flags (for example
  `--extension` or `--model`), the adapter prepends the built Pi CLI path
- A request-level `modelOverride` replaces any configured `--model`
- A request-level `cwd` overrides the default Pi checkout working directory

See `src/index.test.ts` for adapter behavior and failure mode tests.
