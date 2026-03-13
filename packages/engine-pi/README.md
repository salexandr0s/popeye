# @popeye/engine-pi

Pi engine adapter -- the single integration point between the Popeye runtime and
the Pi agent engine. Spawns Pi as a child process and normalizes its NDJSON event
stream into typed Popeye domain events. All Pi interaction flows through this
package; no other package imports Pi directly.

## Key exports

- `EngineAdapter` -- interface for engine lifecycle (spawn, stream events, stop)
- `PiEngineAdapter` -- production implementation using child_process
- `FakeEngineAdapter` -- deterministic test double with scripted event sequences
- `createEngineAdapter(config)` -- factory that returns the appropriate adapter
- Pi checkout and version utilities

## Dependencies

- `@popeye/contracts`

## Layer

Pi integration. Wraps engine internals behind a stable owned interface.
