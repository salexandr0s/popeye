# @popeye/daemon (`popeyed`)

Long-running daemon process for the Popeye platform. The primary way to run
Popeye in production -- boots the runtime, starts the scheduler, and serves the
control API.

## Purpose

Loads configuration from `POPEYE_CONFIG_PATH`, ensures all runtime directories
exist with secure permissions, creates a `PopeyeRuntimeService`, starts the task
scheduler, and mounts the Fastify control API on the configured loopback address
and port. Optionally serves the web inspector static files with a one-time
bootstrap nonce; the browser exchanges that nonce with an operator bearer token
for an HttpOnly browser-session cookie before calling protected API routes.
Handles graceful shutdown on SIGTERM/SIGINT,
draining in-flight work and closing databases cleanly.

## Layer

Interface. Process entry point that wires runtime services together.

## Provenance

New platform implementation.

## Startup flow

1. Read and validate config from `POPEYE_CONFIG_PATH`
2. Ensure runtime directory tree exists (`ensureRuntimePaths`)
3. Create `PopeyeRuntimeService` (opens databases, initializes engine adapter)
4. Start the scheduler loop
5. Create the control API Fastify server
6. Optionally register web inspector static file serving and bootstrap nonce exchange
7. Verify `config.security.bindHost === 127.0.0.1` and bind to `config.security.bindHost:config.security.bindPort`
8. Register signal handlers for graceful shutdown

## Dependencies

- `@popeye/control-api` -- Fastify control API server
- `@popeye/runtime-core` -- runtime service, config loading, auth, path management
- `@fastify/static` -- static file serving for web inspector

## Usage

```bash
# Via the CLI
pop daemon start

# Directly
POPEYE_CONFIG_PATH=/path/to/config.json pnpm --filter @popeye/daemon start

# Via launchd (macOS)
pop daemon install
pop daemon load
```

## Configuration

Requires `POPEYE_CONFIG_PATH` environment variable. The daemon binds to
loopback only (`127.0.0.1`). API routes require auth; browser clients obtain
same-origin session access through the bootstrap nonce exchange plus operator
bearer auth, then continue on an HttpOnly browser-session cookie.
