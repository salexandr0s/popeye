# Backup, restore, and retention

## Backup scope

Include:
- runtime config metadata
- `app.db`
- `memory.db`
- receipts
- workspace files

Exclude:
- raw Keychain secrets
- unredacted secrets discovered during runtime

## Integrity

- Every backup includes a manifest with version and SHA-256 checksums.
- Restore validates manifest integrity and schema compatibility before import.

## Retention

- Working memory is never persisted.
- Episodic memory may be aged out or archived by policy.
- Semantic/procedural memory must retain provenance and support deletion.
- Receipts remain the canonical audit artifact for completed runs.
