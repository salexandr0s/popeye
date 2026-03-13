# Daemon runbook

## Start prerequisites
- `POPEYE_CONFIG_PATH` points at a valid config JSON
- `pop auth init` has created `auth.json`
- Runtime data directory is writable by the current macOS user

## CLI flows
- Start foreground daemon: `pop daemon start`
- Install LaunchAgent plist: `pop daemon install`
- Load LaunchAgent into launchd: `pop daemon load`
- Stop launchd-managed daemon: `pop daemon stop`
- Restart launchd-managed daemon: `pop daemon restart`
- Uninstall LaunchAgent plist: `pop daemon uninstall`
- Inspect launchd status: `pop daemon status`
- Print LaunchAgent plist: `pop daemon plist`

## Startup behavior
On startup the daemon:
1. loads config
2. ensures runtime paths exist
3. opens SQLite databases and applies migrations
4. reconciles stale `starting` / `running` runs left behind by a prior crash or forced stop
5. clears or requeues stale leased jobs
6. initializes the runtime service
7. starts the scheduler tick + lease sweep loop
8. binds the control API on `127.0.0.1`

## Scheduler behavior
- task creation is enqueue-only; the daemon scheduler owns actual execution
- queued jobs are picked up when `available_at <= now`
- one workspace lock is held per active run
- leases refresh every 15 seconds with a 60 second TTL
- waiting-retry jobs become queued again when their backoff expires
- heartbeat scheduling is seeded per configured workspace and uses dedicated heartbeat continuity

## Shutdown behavior
- `SIGINT`, `SIGTERM`, `uncaughtException`, and `unhandledRejection` trigger coordinated shutdown.
- Shutdown stops scheduler timers before closing SQLite handles.
- Active workers are cancelled before shutdown completes.
- Shutdown updates `daemon_state.last_shutdown_at` before closing SQLite handles.
- Runs that were still in progress after an unclean exit are marked `abandoned` during the next startup reconciliation pass.

## Common failures
- `POPEYE_CONFIG_PATH is required` → export the config path before starting
- auth file missing → run `pop auth init`
- Pi repo missing in real mode → switch to fake mode or check out `../pi`
- port bind failure → another local process is already bound to the configured port
- abandoned receipts after restart → inspect `/v1/interventions`, `/v1/daemon/state`, or `pop daemon status` and retry the affected run intentionally


## Pi smoke workflow
- Local manual smoke: `pop pi smoke`
- Test runner smoke: `POPEYE_ENABLE_PI_SMOKE=1 POPEYE_PI_SMOKE_PATH=/path/to/pi POPEYE_PI_SMOKE_COMMAND=node POPEYE_PI_SMOKE_ARGS='["bin/pi.js"]' pnpm test:pi-smoke`
- CI/manual smoke: run `.github/workflows/pi-smoke.yml` with the Pi repo/ref and command args
