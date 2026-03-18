# Upgrades runbook

## Pi engine upgrade

### Prerequisites

- Read the Pi changelog for the target version
- No active runs (`pop run list`)
- Current backup exists (`pop backup create`)

### Steps

1. Stop daemon — `pop daemon stop`
2. Update `../pi` checkout to target version
3. Rebuild Pi — `cd ../pi && npm ci && npm run build && cd ../popeye`
4. Update the repo pin in `config/example.json` so `engine.piVersion` matches `../pi/packages/coding-agent/package.json`
5. Verify checkout + version — `pnpm verify:pi-checkout -- --pi-path ../pi`
6. Run Pi smoke tests — `pnpm test:pi-smoke`
7. Review Pi RPC contract (`get_state` / `prompt` / `abort`, JSONL responses + session events)
8. Update `docs/pi-fork-delta.md` with changes
9. Run full test suite — `dev-verify`
10. Start daemon — `pop daemon start`
11. Verify reconciliation in logs
12. Commit as isolated changeset

### Rollback

1. Stop daemon — `pop daemon stop`
2. Restore previous Pi checkout — `cd ../pi && git checkout <previous-tag>`
3. Restore backup — `pop backup restore <path>`
4. Start daemon — `pop daemon start`

## Runtime upgrade

### Prerequisites

- No active runs
- Current backup exists

### Steps

1. Stop daemon — `pop daemon stop`
2. Create backup — `pop backup create`
3. Pull or checkout target version
4. Install dependencies — `pnpm install`
5. Run `pnpm verify:src-build-artifacts` to confirm no source-adjacent build artifacts reappeared
6. Start daemon — `pop daemon start`
7. Verify reconciliation
8. Run security audit — `pop security audit`
9. Verify scheduler — `pop task list`

### Rollback

1. Stop daemon — `pop daemon stop`
2. Checkout previous version
3. Install dependencies — `pnpm install`
4. Restore backup — `pop backup restore <path>`
5. Start daemon — `pop daemon start`

## Common failures

- **Pi smoke tests fail** — check `docs/pi-fork-delta.md` for incompatibilities
- **Pi version check fails** — compare `config/example.json` `engine.piVersion` against `../pi/packages/coding-agent/package.json`
- **Reconciliation errors** — check for schema changes in `app.db`
- **Scheduler not running** — verify `daemon_state` table; check logs
- **Security audit fails** — new checks may flag pre-existing issues
