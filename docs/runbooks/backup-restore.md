# Backup and restore runbook

## Create a backup
- Default location: `<runtimeDataDir>/backups/<timestamp>`
- Command: `pop backup create`
- Optional destination: `pop backup create /path/to/backup-dir`

## Verify a backup
- Command: `pop backup verify /path/to/backup-dir`
- Validation checks the manifest and file checksums

## Restore a backup
- Command: `pop backup restore /path/to/backup-dir`
- Restore copies `config/`, `state/`, and `receipts/` back into the runtime data path
- Verify the backup before restore
- Stop the daemon before restoring over a live runtime directory

## Notes
- Backups include runtime config, SQLite state, and receipt artifacts
- Backups do not export Keychain secrets
- Workspace snapshots can be added by the backup API when explicit paths are supplied
