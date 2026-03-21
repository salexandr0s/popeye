# Backup and restore runbook

## Pre-backup checklist

1. Confirm no active runs: `pop runs tail` — wait for in-progress runs to complete or cancel them
2. Stop the daemon: `pop daemon stop` — prevents writes during backup
3. Verify disk space: backups include full SQLite files (app.db, memory.db) plus receipt artifacts
4. Note the current version: `pop --version` — record this for rollback reference

## Create a backup

```bash
pop backup create                              # default: <runtimeDataDir>/backups/<timestamp>
pop backup create /path/to/backup-dir          # custom destination
pop backup create /path/to/backup-dir ws-001   # include workspace snapshot
```

Backups include:
- `config/` — runtime configuration (config.json, auth store)
- `state/` — SQLite databases (app.db, memory.db, WAL/SHM files)
- `receipts/` — receipt artifacts (by-run, by-day)
- Vault databases — both `.db` and `.enc` (encrypted at rest) files

Backups do **not** include:
- macOS Keychain secrets (these must be backed up separately via Keychain Access or `security` CLI)
- Workspace source files (only indexed metadata is backed up)
- Log files

## Verify a backup

```bash
pop backup verify /path/to/backup-dir
```

Verification checks:
- Manifest file (`*.manifest.json`) exists and is valid JSON
- SHA-256 checksums match for every file listed in the manifest
- No unexpected missing files

## Restore a backup

```bash
pop backup restore /path/to/backup-dir
```

**Pre-restore checklist:**

1. Stop the daemon: `pop daemon stop`
2. Verify the backup first: `pop backup verify /path/to/backup-dir`
3. Note the current state in case you need to undo the restore
4. If restoring after a failed migration, checkout the matching code version first

Restore copies `config/`, `state/`, and `receipts/` back into the runtime data path. WAL and SHM files are restored alongside their SQLite databases for consistency.

**Post-restore steps:**

1. Start the daemon: `pop daemon start`
2. Verify health: `pop daemon health`
3. Spot-check data: `pop runs tail`, `pop receipts search --limit 5`

## Vault backups

Vaults are backed up individually with dedicated commands:

```bash
# Via CLI
pop backup create                   # includes all vault files automatically

# Via API (per-vault)
POST /v1/vaults/:id/backup          # { destinationDir?: string }
GET  /v1/vaults/:id/backup/verify
POST /v1/vaults/:id/restore         # { backupPath: string }
```

Vault backup details:
- Encrypted vaults (`.enc` files) are backed up in encrypted form — no decryption occurs during backup
- Each vault backup produces a `*.manifest.json` with `vaultId`, `backupPath`, `checksum` (SHA-256), and `createdAt`
- Restore writes the vault file back to the target path; the runtime decrypts on open using the KEK

## Manifest format

Each backup directory contains a manifest JSON file:

```json
{
  "vaultId": "vault-abc123",
  "backupPath": "/path/to/vault-abc12345-2026-03-20T10-30-00-000Z-vault.db.enc",
  "checksum": "e3b0c44298fc1c149afbf4c8996fb...",
  "algorithm": "sha256",
  "createdAt": "2026-03-20T10:30:00.000Z"
}
```

## Troubleshooting

| Problem | Cause | Resolution |
|---------|-------|------------|
| Checksum mismatch on verify | Backup file was modified or corrupted | Re-create from a known-good state |
| Missing WAL/SHM files | Backup was created while DB was idle (normal) | Safe to proceed — SQLite recreates these on open |
| Permission denied on restore | Runtime data dir has wrong permissions | `chmod 700 ~/Library/Application\ Support/Popeye` |
| Vault restore fails | KEK not available or vault sealed | Ensure vault KEK is set via `pop vaults set-kek` before opening |
| Daemon won't start after restore | Config version mismatch | Ensure code version matches the backup version; check `config.json` |
