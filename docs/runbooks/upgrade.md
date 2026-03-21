# Upgrade runbook

## Prerequisites

- No active runs: `pop runs tail` — wait for completion or cancel
- Current backup exists: `pop backup create`
- Daemon stopped: `pop daemon stop`
- Current version noted: `pop --version`

## Standard upgrade

1. Stop daemon — `pop daemon stop`
2. Create backup — `pop backup create`
3. Pull or checkout target version
4. Install dependencies — `pnpm install --frozen-lockfile`
5. Build — `pnpm build`
6. Verify contracts — `pnpm generate:contracts && pnpm verify:generated-artifacts`
7. Run full test suite — `dev-verify`
8. Start daemon — `pop daemon start`
9. Verify — `bash scripts/verify-upgrade.sh`
10. Run security audit — `pop security audit`

## Database migration

Migrations run automatically on daemon start. The `MigrationManager` in
`@popeye/runtime-core`:

1. Creates a pre-migration backup (timestamped copy of the DB + WAL + SHM files)
2. Applies pending migrations in version order, each in a transaction
3. Records each migration in `schema_migrations` (version, timestamp, status, backup_path)
4. Skips already-applied migrations
5. Runs post-migration verification (checks for duplicates and error records)

For manual migration control:

1. Stop daemon — `pop daemon stop`
2. Create pre-migration backup — the runtime does this automatically, or run `pop backup create` manually
3. Start daemon — migrations apply on startup
4. Verify — `pop daemon health`

### Migration verification

After migration, confirm:

```bash
pop daemon health                    # daemon responds
pop upgrade verify                   # checks schema_migrations table
pop runs tail                        # recent runs still visible
pop backup verify <latest-backup>    # pre-migration backup is valid
```

For JSON output (useful in CI): `pop upgrade verify --json`

## Pi engine upgrade isolation

Pi upgrades must be isolated from unrelated runtime changes:

1. Create a dedicated branch: `git checkout -b chore/pi-upgrade`
2. Update the Pi fork version in `@popeye/engine-pi`
3. Run Pi smoke test: `bash scripts/smoke-test.sh` (or CI `pi-smoke.yml` workflow)
4. Update `docs/pi-fork-delta.md` with: what changed upstream, what was adopted, what was not
5. Merge only after Pi-specific tests pass
6. Do not bundle Pi upgrades with runtime feature work

## Rollback

### If the daemon starts successfully but behaves incorrectly

1. Stop daemon — `pop daemon stop`
2. Checkout previous version — `git checkout <previous-tag>`
3. Install dependencies — `pnpm install --frozen-lockfile`
4. Build — `pnpm build`
5. Restore backup — `pop backup restore <path>`
6. Start daemon — `pop daemon start`
7. Verify — `bash scripts/verify-upgrade.sh`

### If the daemon fails to start after migration

1. Identify the backup path from daemon logs or `~/Library/Application Support/Popeye/backups/`
2. Stop any daemon process: `pop daemon stop` (may fail; use `pkill -f popeyed` if needed)
3. Checkout previous version — `git checkout <previous-tag>`
4. Install dependencies — `pnpm install --frozen-lockfile`
5. Build — `pnpm build`
6. Manually restore the database:
   ```bash
   pop backup restore <path-from-logs>
   # or manually:
   cp <backup>/app.db ~/Library/Application\ Support/Popeye/state/app.db
   ```
7. Start daemon — `pop daemon start`
8. Verify — `pop daemon health`

### CLI-based rollback

```bash
pop upgrade rollback <backup-path>   # restores DB from pre-migration backup
```

This copies the backup database files back to the runtime state directory.

## Recovery for stuck migrations

If `schema_migrations` shows a migration with `status = 'error'`:

1. Stop daemon
2. Inspect the migration record: `sqlite3 ~/Library/Application\ Support/Popeye/state/app.db "SELECT * FROM schema_migrations ORDER BY version DESC LIMIT 5;"`
3. If the backup path is recorded, restore from it: `pop backup restore <backup_path>`
4. If no backup path, restore from the latest manual backup
5. Fix the migration code, rebuild, and retry

## Common failures

| Failure | Diagnosis | Resolution |
|---------|-----------|------------|
| Migration SQL error | Check daemon logs for the failing statement | Restore from pre-migration backup, fix migration, retry |
| Daemon fails to start | `config.json` incompatible with new version | Compare config against `config/example.json`; add missing fields |
| Schema mismatch | Packages built from different versions | `pnpm clean && pnpm install --frozen-lockfile && pnpm build` |
| Stuck migration record | `schema_migrations` has `status = 'error'` | See "Recovery for stuck migrations" above |
| Post-upgrade data missing | Migration dropped or renamed a table | Restore backup; file a bug against the migration |

## Migration verification evidence

### Verification script

Run the upgrade path verification script to gather evidence:

```bash
bash scripts/verify-upgrade-path.sh          # human-readable output
bash scripts/verify-upgrade-path.sh --json   # structured JSON for CI
```

### What the script checks

| Check | What it verifies |
|-------|-----------------|
| `pop-binary` | `pop` CLI is on PATH and executable |
| `node` | Node.js is available (required: v22 LTS) |
| `pnpm` | pnpm is available (required for builds) |
| `current-version` | Records the current `pop --version` output |
| `backup-create` | `pop backup create` successfully produces a backup |
| `backup-verify` | `pop backup verify` confirms the backup is valid |
| `daemon-health` | Daemon is running and responsive (skipped if daemon is stopped) |
| `upgrade-verify` | `pop upgrade verify` reports healthy state (requires running daemon) |
| `node-modules` | `node_modules` directory exists in the project |

### What constitutes passing

The script exits with code `0` when all non-skipped checks pass. A check may be
skipped when its prerequisite is unavailable (e.g., daemon not running), which
does not count as a failure.

For **CI**, use the `--json` flag and check:

```json
{
  "overall": "pass",
  "failed": 0
}
```

Any `"overall": "fail"` result or non-zero exit code means the upgrade path is
not verified and the release gate must not be passed.

### Required evidence for the release gate

Before cutting a release, the following evidence must be collected and attached
to the release checklist:

1. **Script output** -- Full JSON output from `bash scripts/verify-upgrade-path.sh --json` with `"overall": "pass"`.
2. **Migration test results** -- Output from `pnpm vitest run packages/runtime-core/src/migration-manager.test.ts` showing all migration lifecycle tests pass (create, backup, migrate, verify, rollback).
3. **Type and lint check** -- Output from `dev-verify --quick` showing zero errors.
4. **Full test suite** -- Output from `dev-verify` showing all tests pass.
5. **Manual smoke test** (for major releases) -- Operator confirms: daemon starts, `pop daemon health` responds, `pop runs tail` returns data, a test run completes end to end.

If any of these items cannot be produced, document the gap and get explicit sign-off before proceeding.
