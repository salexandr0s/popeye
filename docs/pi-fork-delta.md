# Pi fork delta

## Baseline
- Expected sibling checkout: `../pi`
- Popeye points to that checkout through `config.engine.piPath`
- Real Pi mode is selected with `config.engine.kind = "pi"`
- Engine version is pinned via `config.engine.piVersion` against `packages/coding-agent/package.json`
- `config/example.json` is the repo-visible Pi pin and must match the Pi `packages/coding-agent/package.json` version
- Current local upstream shape observed during this rebuild:
  - repo root version: `0.0.3`
  - `packages/coding-agent` version: `0.57.1`
- `security-audit` reports `pi_version_not_pinned` (warn) when no `piVersion` is set, and `pi_version_mismatch` (warn) when the configured coding-agent version differs

## Current integration shape
- Popeye owns all runtime orchestration, receipts, scheduling, auth, CSRF, and backup/restore.
- Pi is invoked only through `@popeye/engine-pi`.
- If the configured Pi checkout is missing, the adapter fails closed at startup with a clear configuration error.
- Real Pi smoke coverage lives in `packages/engine-pi/src/pi.smoke.test.ts`, is gated behind `POPEYE_ENABLE_PI_SMOKE=1`, and accepts `POPEYE_PI_SMOKE_PATH`, `POPEYE_PI_SMOKE_COMMAND`, and `POPEYE_PI_SMOKE_ARGS`.

## Current child-process contract
- Popeye starts the configured Pi command from `config.engine.piPath` and appends `--mode rpc`.
- If `engine.command === "node"` and `engine.args` is empty, `@popeye/engine-pi` defaults to `packages/coding-agent/dist/cli.js` inside the Pi checkout.
- The runtime now passes a structured `EngineRunRequest` into `@popeye/engine-pi`, but the Pi RPC bridge still submits a prompt-oriented RPC flow underneath.
- Structured request execution controls currently honored by `@popeye/engine-pi`: `cwd`, `modelOverride`, and `runtimeTools`.
- Runtime metadata fields such as `workspaceId`, `projectId`, `sessionPolicy`, `instructionSnapshotId`, and `trigger` are accepted but not yet forwarded into Pi RPC semantics.
- Popeye speaks strict JSONL over stdin/stdout.
- Popeye sends:
  - `{"id":"popeye:get_state","type":"get_state"}`
  - `{"id":"popeye:prompt","type":"prompt","message":"..."}`
  - `{"id":"popeye:abort","type":"abort"}` on cancellation
- Pi returns JSONL `response` envelopes plus streamed `AgentSessionEvent` objects.
- When runtime-owned tools are supplied, `@popeye/engine-pi` generates a temporary Pi extension, loads it with `--extension`, and tunnels tool calls through `extension_ui_request(method:"editor", title:"popeye.runtime_tool")` / `extension_ui_response(value)`.
- That path is explicitly a Popeye-owned workaround over Pi's extension UI carrier, not a first-class Pi host-tool RPC protocol.
- Popeye bounds each bridged runtime-tool call with `config.engine.runtimeToolTimeoutMs` (default `30000`) and emits structured bridge diagnostics through normalized `tool_call` / `tool_result` events.
- That timeout is a Popeye-side wait bound only; it does not cancel the underlying host tool execution.
- When a timed-out host tool settles later, `@popeye/engine-pi` suppresses the late settlement and records a diagnostic warning when it is observed before run completion.
- Popeye preserves stderr as diagnostic evidence and maps it into runtime failures when needed.
- Session refs are taken from `get_state.sessionId` and normalized into Popeye `session` events.
- Usage is derived from the latest assistant message usage and normalized into Popeye `usage` events, with zero-value defaults when Pi provides none.
- Pi `agent_end`, tool, and compaction events are normalized into Popeye `completed`, `tool_call`, `tool_result`, and `compaction` events.
- Interactive RPC UI requests are classified as `protocol_error` unless they are Popeye's runtime-tool bridge carrier; passive UI notifications are ignored.
- Malformed stdout is classified as `protocol_error`.

## What Popeye expects from Pi
- A runnable command configured by `config.engine.command` + `config.engine.args`
- A working directory rooted at `config.engine.piPath` unless a run-level `cwd` override is supplied
- Child-process execution with Pi RPC JSONL on stdin/stdout
- `get_state`, `prompt`, and `abort` RPC commands
- Session events that include assistant message usage on completion
- Cancellation via RPC `abort` with process-signal fallback

## Known limitations
- The runtime-tool bridge is a host-owned workaround over Pi RPC editor dialogs, not a first-class upstream host-tool callback protocol.
- Runtime-tool calls are request/response only; no host-side streaming updates are surfaced back into Pi today.
- Malformed bridge payloads, tool exceptions, timeouts, and cancellation are handled defensively in `@popeye/engine-pi`, but the carrier still inherits UI-channel awkwardness.
- Timeout hardening improves observability, but it does not change the underlying limitation that the host tool promise keeps running unless Pi gains native host-tool cancellation semantics.
- Long-term recommendation: replace the workaround with a proper Pi-side host-tool RPC protocol in a future isolated change. See `docs/adr/0010-pi-host-tool-rpc-boundary.md`.
- If packaging ever changes, ADR 0011 requires vendoring the whole Pi fork behind the same `@popeye/engine-pi` boundary instead of piecemeal copying.
- Detailed fork patch inventory
- Compatibility matrix by upstream tag
- Continuous smoke suite against a real local Pi checkout in CI beyond the manual workflow

## CI/manual smoke workflow
- Local smoke is available via `pop pi smoke` or `pnpm test:pi-smoke`
- GitHub Actions manual smoke lives in `.github/workflows/pi-smoke.yml`
- The workflow checks out the Popeye repo plus a separate Pi repo checkout into `external-pi`, installs/builds Pi, and points the smoke test at that path
- Private Pi repos require the `PI_CHECKOUT_TOKEN` repository secret
