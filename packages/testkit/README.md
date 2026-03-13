# @popeye/testkit

Test doubles for Popeye development. Provides fake implementations of core
interfaces so that packages and integration tests can exercise runtime behavior
without spawning real engine processes or requiring external services.

## Purpose

Re-exports the `FakeEngineAdapter` and its associated types from
`@popeye/engine-pi`. Test code imports from `@popeye/testkit` instead of
directly depending on the engine package, keeping test dependencies clean and
making it easy to add additional test doubles in the future.

## Layer

Testing. Not shipped in production builds.

## Provenance

New platform implementation.

## Key exports

| Export                | Description                                            |
| --------------------- | ------------------------------------------------------ |
| `FakeEngineAdapter`   | Deterministic engine adapter with configurable modes   |
| `EngineAdapter`       | Interface type (re-export)                             |
| `EngineRunHandle`     | Handle type for in-flight runs (re-export)             |
| `EngineRunResult`     | Result type for completed runs (re-export)             |
| `EngineRunCompletion` | Completion type for awaited handles (re-export)        |
| `FakeEngineConfig`    | Configuration for fake adapter modes (re-export)       |

## Dependencies

- `@popeye/engine-pi` -- source of the fake adapter implementation

## Usage

```ts
import { FakeEngineAdapter } from '@popeye/testkit';

const engine = new FakeEngineAdapter({ mode: 'success' });
const result = await engine.run('test input');
expect(result.failureClassification).toBeNull();
```
