# @popeye/testkit

Test doubles for Popeye development. Provides fake implementations of core
interfaces so that packages and integration tests can exercise runtime
behavior without spawning real engine processes or requiring external services.

## Key exports

- `FakeEngineAdapter` -- deterministic engine adapter with scripted event sequences

## Dependencies

- `@popeye/engine-pi`

## Layer

Testing. Not shipped in production builds.
