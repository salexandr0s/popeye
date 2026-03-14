# Pi fork delta

## Baseline
- Expected sibling checkout: `../pi`
- Popeye points to that checkout through `config.engine.piPath`
- Real Pi mode is selected with `config.engine.kind = "pi"`
- Engine version is pinned via `config.engine.piVersion` — the runtime reads the Pi repo-root `package.json` and warns on mismatch (does not block startup)
- Current local upstream shape observed during this rebuild:
  - repo root version: `0.0.3`
  - `packages/coding-agent` version: `0.57.1`
- `security-audit` reports `pi_version_not_pinned` (warn) when no piVersion is set, and `pi_version_mismatch` (warn) when the checkout version differs

## Current integration shape
- Popeye owns all runtime orchestration, receipts, scheduling, auth, CSRF, and backup/restore.
- Pi is invoked only through `@popeye/engine-pi`.
- If the configured Pi checkout is missing, the adapter fails closed at startup with a clear configuration error.
- Real Pi smoke coverage lives in `packages/engine-pi/src/pi.smoke.test.ts`, is gated behind `POPEYE_ENABLE_PI_SMOKE=1`, and accepts `POPEYE_PI_SMOKE_PATH`, `POPEYE_PI_SMOKE_COMMAND`, and `POPEYE_PI_SMOKE_ARGS`.

## Current child-process contract
- Popeye starts the configured Pi command from `config.engine.piPath` and appends `--mode rpc`.
- If `engine.command === "node"` and `engine.args` is empty, `@popeye/engine-pi` defaults to `packages/coding-agent/dist/cli.js` inside the Pi checkout.
- Popeye speaks strict JSONL over stdin/stdout.
- Popeye sends:
  - `{"id":"popeye:get_state","type":"get_state"}`
  - `{"id":"popeye:prompt","type":"prompt","message":"..."}`
  - `{"id":"popeye:abort","type":"abort"}` on cancellation
- Pi returns JSONL `response` envelopes plus streamed `AgentSessionEvent` objects.
- Popeye preserves stderr as diagnostic evidence and maps it into runtime failures when needed.
- Session refs are taken from `get_state.sessionId` and normalized into Popeye `session` events.
- Usage is derived from the latest assistant message usage and normalized into Popeye `usage` events, with zero-value defaults when Pi provides none.
- Pi `agent_end`, tool, and compaction events are normalized into Popeye `completed`, `tool_call`, `tool_result`, and `compaction` events.
- Interactive RPC UI requests are classified as `protocol_error`; passive UI notifications are ignored.
- Malformed stdout is classified as `protocol_error`.

## What Popeye expects from Pi
- A runnable command configured by `config.engine.command` + `config.engine.args`
- A working directory rooted at `config.engine.piPath`
- Child-process execution with Pi RPC JSONL on stdin/stdout
- `get_state`, `prompt`, and `abort` RPC commands
- Session events that include assistant message usage on completion
- Cancellation via RPC `abort` with process-signal fallback

## Not yet implemented
- Host-owned runtime tool bridge over RPC
- Detailed fork patch inventory
- Compatibility matrix by upstream tag
- Continuous smoke suite against a real local Pi checkout in CI beyond the manual workflow


## CI/manual smoke workflow
- Local smoke is available via `pop pi smoke` or `pnpm test:pi-smoke`
- GitHub Actions manual smoke lives in `.github/workflows/pi-smoke.yml`
- The workflow checks out the Popeye repo plus a separate Pi repo checkout into `external-pi`, installs/builds Pi, and points the smoke test at that path
- Private Pi repos require the `PI_CHECKOUT_TOKEN` repository secret
