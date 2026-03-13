# @popeye/daemon (`popeyed`)

Long-running daemon process for the Popeye platform. Loads configuration,
boots the `PopeyeRuntimeService`, starts the task scheduler, and mounts the
Fastify control API on the configured loopback port. Handles graceful shutdown
on SIGINT/SIGTERM, ensuring in-flight runs are drained and databases are
closed cleanly.

## Usage

```
popeyed                 # start with default config
popeyed --config path   # start with explicit config file
```

## Dependencies

- `@popeye/control-api`
- `@popeye/runtime-core`

## Layer

Interface. Process entry point that wires runtime services together.
