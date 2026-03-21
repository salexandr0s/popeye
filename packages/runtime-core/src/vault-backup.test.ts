import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, it, expect } from 'vitest';

import { backupVault, restoreVault, verifyVaultBackup } from './vault-backup.js';

function createTestVaultDb(dir: string): string {
  const dbPath = join(dir, 'test-vault.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, value TEXT)');
  db.prepare('INSERT INTO items (id, value) VALUES (?, ?)').run('1', 'hello');
  db.close();
  return dbPath;
}

describe('vault backup/restore/verify', () => {
  it('backup creates file and manifest JSON', () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'popeye-vault-backup-src-'));
    const destDir = mkdtempSync(join(tmpdir(), 'popeye-vault-backup-dest-'));
    const dbPath = createTestVaultDb(srcDir);

    const result = backupVault(dbPath, 'test-vault-id', destDir);
    expect(result.success).toBe(true);
    expect(existsSync(result.manifest.backupPath)).toBe(true);

    const manifestPath = `${result.manifest.backupPath}.manifest.json`;
    expect(existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    expect(manifest.vaultId).toBe('test-vault-id');
    expect(typeof manifest.checksum).toBe('string');
    expect((manifest.checksum as string).length).toBeGreaterThan(0);
    expect(manifest.algorithm).toBe('sha256');
    expect(typeof manifest.createdAt).toBe('string');
  });

  it('verify passes on valid backup', () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'popeye-vault-verify-src-'));
    const destDir = mkdtempSync(join(tmpdir(), 'popeye-vault-verify-dest-'));
    const dbPath = createTestVaultDb(srcDir);

    const backupResult = backupVault(dbPath, 'verify-vault', destDir);
    const verifyResult = verifyVaultBackup(backupResult.manifest.backupPath);

    expect(verifyResult.valid).toBe(true);
    expect(verifyResult.manifest).not.toBeNull();
    expect(verifyResult.manifest!.vaultId).toBe('verify-vault');
    expect(verifyResult.error).toBeUndefined();
  });

  it('verify detects missing file', () => {
    const nonexistentPath = join(tmpdir(), 'popeye-vault-nonexistent-' + Date.now() + '.db');

    const verifyResult = verifyVaultBackup(nonexistentPath);
    expect(verifyResult.valid).toBe(false);
    expect(verifyResult.manifest).toBeNull();
    expect(verifyResult.error).toBeDefined();
    expect(verifyResult.error).toContain('not found');
  });

  it('verify detects checksum mismatch', () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'popeye-vault-corrupt-src-'));
    const destDir = mkdtempSync(join(tmpdir(), 'popeye-vault-corrupt-dest-'));
    const dbPath = createTestVaultDb(srcDir);

    const backupResult = backupVault(dbPath, 'corrupt-vault', destDir);
    // Corrupt the backup file by overwriting it with different content
    writeFileSync(backupResult.manifest.backupPath, 'corrupted-data-that-does-not-match');

    const verifyResult = verifyVaultBackup(backupResult.manifest.backupPath);
    expect(verifyResult.valid).toBe(false);
    expect(verifyResult.manifest).not.toBeNull();
    expect(verifyResult.error).toBeDefined();
    expect(verifyResult.error).toContain('Checksum mismatch');
  });

  it('restore copies to new path', () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'popeye-vault-restore-src-'));
    const destDir = mkdtempSync(join(tmpdir(), 'popeye-vault-restore-dest-'));
    const restoreDir = mkdtempSync(join(tmpdir(), 'popeye-vault-restore-target-'));
    const dbPath = createTestVaultDb(srcDir);

    const backupResult = backupVault(dbPath, 'restore-vault', destDir);
    const targetPath = join(restoreDir, 'restored-vault.db');

    const restoreResult = restoreVault(backupResult.manifest.backupPath, targetPath);
    expect(restoreResult.success).toBe(true);
    expect(existsSync(targetPath)).toBe(true);

    // Verify the restored file is a valid SQLite DB
    const restoredDb = new Database(targetPath);
    const rows = restoredDb.prepare('SELECT * FROM items').all() as { id: string; value: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe('hello');
    restoredDb.close();
  });
});
