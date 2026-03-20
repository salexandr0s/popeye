# Upgrade runbook

## Prerequisites

- No active runs (`pop run list`)
- Current backup exists (`pop backup create`)
- Daemon stopped (`pop daemon stop`)

## Standard upgrade

1. Stop daemon -- `pop daemon stop`
2. Create backup -- `pop backup create`
3. Pull or checkout target version
4. Install dependencies -- `pnpm install --frozen-lockfile`
5. Build -- `pnpm build`
6. Verify contracts -- `pnpm generate:contracts && pnpm verify:generated-artifacts`
7. Run full test suite -- `dev-verify`
8. Start daemon -- `pop daemon start`
9. Verify -- `bash scripts/verify-upgrade.sh`
10. Run security audit -- `pop security audit`

## Database migration

Database migrations run automatically on daemon start. The `MigrationManager` in
`@popeye/runtime-core` applies pending migrations in order and records each in
the `schema_migrations` table.

For manual migration control:

1. Stop daemon -- `pop daemon stop`
2. Create pre-migration backup -- the runtime does this automatically when configured, or run `pop backup create` manually
3. Start daemon -- migrations apply on startup
4. Verify -- `pop daemon health`

## Rollback

### If the daemon starts successfully but behaves incorrectly

1. Stop daemon -- `pop daemon stop`
2. Checkout previous version -- `git checkout <previous-tag>`
3. Install dependencies -- `pnpm install --frozen-lockfile`
4. Restore backup -- `pop backup restore <path>`
5. Start daemon -- `pop daemon start`
6. Verify -- `bash scripts/verify-upgrade.sh`

### If the daemon fails to start after migration

1. Identify the backup path from logs or `~/Library/Application Support/Popeye/backups/`
2. Checkout previous version -- `git checkout <previous-tag>`
3. Install dependencies -- `pnpm install --frozen-lockfile`
4. Manually restore the database file from the backup
5. Start daemon -- `pop daemon start`

## Common failures

- **Migration fails** -- check logs for the failing SQL statement; restore from pre-migration backup
- **Daemon fails to start** -- verify `config.json` compatibility with the new version
- **Schema mismatch** -- ensure all packages are built from the same version; run `pnpm build`
- **Reconciliation errors** -- check `schema_migrations` table in `app.db` for stuck entries
