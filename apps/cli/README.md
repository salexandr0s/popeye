# @popeye/cli (`pop`)

Operator CLI for the Popeye platform. Provides commands for day-to-day
management: authentication setup, security audit, Pi engine smoke tests,
daemon lifecycle (start/stop/status), database backup, task creation and
execution, and run/receipt inspection.

## Usage

```
pop auth setup          # configure auth token
pop security audit      # scan config, permissions, ports, secrets
pop pi smoke            # verify Pi engine integration
pop daemon start|stop   # manage the popeyed daemon
pop backup              # back up runtime databases
pop task run <id>       # execute a task
pop receipt show <id>   # inspect a run receipt
```

## Dependencies

- `@popeye/runtime-core`

## Layer

Interface. Thin CLI surface over runtime services.
