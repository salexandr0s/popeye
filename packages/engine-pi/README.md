# @popeye/engine-pi

The single integration point between the Popeye runtime and the Pi agent engine.
All Pi interaction flows through this package -- no other package imports Pi
directly.

## Purpose

Spawns Pi as a child process, streams its NDJSON events, and normalizes them
into typed Popeye domain events. Handles process lifecycle including timeout
enforcement with SIGTERM/SIGKILL escalation. Provides deterministic test
doubles for use in unit and integration tests.

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
const result = await adapter.run('hello');
console.log(result.events, result.usage);
```

See `src/index.test.ts` for adapter behavior and failure mode tests.
