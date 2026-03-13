# @popeye/cli (`pop`)

Operator CLI for the Popeye platform. Provides commands for day-to-day
management of authentication, security, the Pi engine, the daemon lifecycle,
database backups, task execution, and operational inspection.

## Purpose

Entry point for human operators. Parses positional arguments and the `--json`
flag, then either connects to a running `popeyed` daemon via `@popeye/api-client`
or boots an ephemeral `PopeyeRuntimeService` for offline operation. All output
defaults to human-readable text unless `--json` is specified.

## Layer

Interface. Thin CLI surface over runtime services and the API client.

## Provenance

New platform implementation.

## Commands

| Command                        | Description                                      |
| ------------------------------ | ------------------------------------------------ |
| `pop auth init`                | Initialize bearer token auth store               |
| `pop auth rotate`              | Rotate the authentication token                  |
| `pop security audit`           | Scan config, permissions, ports, secret storage  |
| `pop pi smoke`                 | Verify Pi engine integration (compatibility check)|
| `pop daemon install`           | Install launchd agent plist                      |
| `pop daemon start`             | Start the daemon process                         |
| `pop daemon status`            | Show daemon process status                       |
| `pop daemon load/stop/restart` | Manage the launchd agent                         |
| `pop daemon uninstall`         | Remove the launchd agent plist                   |
| `pop daemon plist`             | Print the generated launchd plist XML            |
| `pop backup create [dest]`     | Back up runtime databases                        |
| `pop backup verify <path>`     | Verify a backup archive                          |
| `pop backup restore <path>`    | Restore from a backup archive                    |
| `pop task run [title] [prompt]`| Create and execute a task                        |
| `pop run show <id>`            | Inspect a run record                             |
| `pop runs tail`                | Show recent runs                                 |
| `pop runs failures`            | Show failed runs                                 |
| `pop receipt show <id>`        | Display a rendered receipt                       |
| `pop receipt search <query>`   | Search episodic memories                         |
| `pop memory search <query>`    | Hybrid memory search (FTS5 + sqlite-vec)         |
| `pop memory list [type]`       | List memories by type                            |
| `pop memory show <id>`         | Show a single memory record                      |
| `pop memory audit`             | Display memory subsystem audit info              |
| `pop memory maintenance`       | Trigger memory consolidation and cleanup         |
| `pop knowledge search <query>` | Search semantic and procedural memories          |
| `pop jobs list/pause/resume`   | Manage job lifecycle                             |
| `pop sessions list`            | List session roots                               |
| `pop interventions list`       | List pending interventions                       |
| `pop recovery retry <runId>`   | Retry a failed run                               |

## Dependencies

- `@popeye/api-client` -- HTTP client for daemon communication
- `@popeye/contracts` -- domain types
- `@popeye/engine-pi` -- Pi smoke test adapter
- `@popeye/receipts` -- human-readable receipt rendering
- `@popeye/runtime-core` -- offline runtime service, config, auth, backup, launchd

## Configuration

Requires `POPEYE_CONFIG_PATH` environment variable pointing to a JSON config
file validated by `AppConfigSchema`.
