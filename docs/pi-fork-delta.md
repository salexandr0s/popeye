# Pi fork delta

## Baseline
- Expected sibling checkout: `../pi`
- Popeye points to that checkout through `config.engine.piPath`
- Real Pi mode is selected with `config.engine.kind = "pi"`
- Engine version is pinned via `config.engine.piVersion` — the runtime reads `package.json` from the Pi checkout and warns on mismatch (does not block startup)
- `security-audit` reports `pi_version_not_pinned` (warn) when no piVersion is set, and `pi_version_mismatch` (warn) when the checkout version differs

## Current integration shape
- Popeye owns all runtime orchestration, receipts, scheduling, auth, CSRF, and backup/restore.
- Pi is invoked only through `@popeye/engine-pi`.
- If the sibling Pi checkout is missing, the adapter fails closed at startup with a clear configuration error.
- Real Pi smoke coverage lives in `packages/engine-pi/src/pi.smoke.test.ts`, is gated behind `POPEYE_ENABLE_PI_SMOKE=1`, and accepts `POPEYE_PI_SMOKE_PATH`, `POPEYE_PI_SMOKE_COMMAND`, and `POPEYE_PI_SMOKE_ARGS`.

## Current child-process contract
- Popeye starts the configured Pi command from `config.engine.piPath`.
- Popeye writes a single JSON request on stdin.
- Pi returns newline-delimited JSON events on stdout.
- Popeye preserves stderr as diagnostic evidence and maps it into runtime failures when needed.
- Session refs are taken from Pi `session` events.
- Usage is taken from Pi `usage` events, with runtime defaults when usage is absent.
- Malformed stdout is classified as `protocol_error`.

## What Popeye expects from Pi
- A runnable command configured by `config.engine.command` + `config.engine.args`
- A working directory rooted at `config.engine.piPath`
- Child-process execution with streamed stdout events
- Cancellation via process signal

## Not yet implemented
- Detailed fork patch inventory
- Compatibility matrix by upstream tag
- Smoke suite against a real local `../pi` checkout in CI


## CI/manual smoke workflow
- Local smoke is available via `pop pi smoke` or `pnpm test:pi-smoke`
- GitHub Actions manual smoke lives in `.github/workflows/pi-smoke.yml`
- The workflow checks out the Popeye repo plus a separate Pi repo checkout into `external-pi` and points the smoke test at that path
- Private Pi repos require the `PI_CHECKOUT_TOKEN` repository secret
