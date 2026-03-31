import { chmodSync, mkdtempSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createBackup, migrateBackupManifest, resolveAppDbBackupPath, restoreBackup, verifyBackup } from './backup.js';
import { deriveRuntimePaths } from './config.js';

function setupBackupFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-backup-'));
  chmodSync(dir, 0o700);
  const paths = deriveRuntimePaths(dir);
  mkdirSync(paths.configDir, { recursive: true, mode: 0o700 });
  mkdirSync(paths.stateDir, { recursive: true, mode: 0o700 });
  mkdirSync(paths.receiptsDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(paths.configDir, 'config.json'), '{"ok":true}');
  writeFileSync(paths.appDbPath, 'app');
  writeFileSync(paths.memoryDbPath, 'memory');
  return { dir, paths };
}

describe('backup and restore', () => {
  it('creates and verifies a backup', () => {
    const { dir, paths } = setupBackupFixture();
    const backupDir = createBackup({ destinationDir: join(dir, 'snapshot'), runtimePaths: paths });
    const verification = verifyBackup(backupDir);
    expect(verification.valid).toBe(true);
    const restoreDir = mkdtempSync(join(tmpdir(), 'popeye-restore-'));
    chmodSync(restoreDir, 0o700);
    const restorePaths = deriveRuntimePaths(restoreDir);
    restoreBackup(backupDir, restorePaths);
    const restoredVerification = verifyBackup(backupDir);
    expect(restoredVerification.valid).toBe(true);
  });

  it('resolves app.db from a backup root directory', () => {
    const { dir, paths } = setupBackupFixture();
    const backupDir = createBackup({ destinationDir: join(dir, 'snapshot'), runtimePaths: paths });
    expect(resolveAppDbBackupPath(backupDir)).toBe(join(backupDir, 'state', 'app.db'));
  });

  it('returns file backup paths unchanged', () => {
    const { dir, paths } = setupBackupFixture();
    const backupDir = createBackup({ destinationDir: join(dir, 'snapshot'), runtimePaths: paths });
    const appDbBackupPath = join(backupDir, 'state', 'app.db');
    expect(resolveAppDbBackupPath(appDbBackupPath)).toBe(appDbBackupPath);
  });

  it('rejects backup roots without state/app.db', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-backup-empty-'));
    chmodSync(dir, 0o700);
    expect(() => resolveAppDbBackupPath(dir)).toThrow('Backup root does not contain state/app.db');
  });

  it('detects corrupt checksum', () => {
    const { dir, paths } = setupBackupFixture();
    const backupDir = createBackup({ destinationDir: join(dir, 'snapshot'), runtimePaths: paths });
    writeFileSync(join(backupDir, 'config', 'config.json'), '{"corrupted":true}');
    const verification = verifyBackup(backupDir);
    expect(verification.valid).toBe(false);
    expect(verification.mismatches.some((m) => m.includes('Checksum mismatch'))).toBe(true);
  });

  it('detects missing file', () => {
    const { dir, paths } = setupBackupFixture();
    const backupDir = createBackup({ destinationDir: join(dir, 'snapshot'), runtimePaths: paths });
    unlinkSync(join(backupDir, 'config', 'config.json'));
    const verification = verifyBackup(backupDir);
    expect(verification.valid).toBe(false);
    expect(verification.mismatches.some((m) => m.includes('Missing file'))).toBe(true);
  });

  it('restore rejects corrupt backup', () => {
    const { dir, paths } = setupBackupFixture();
    const backupDir = createBackup({ destinationDir: join(dir, 'snapshot'), runtimePaths: paths });
    writeFileSync(join(backupDir, 'state', 'app.db'), 'corrupted-content');
    const restoreDir = mkdtempSync(join(tmpdir(), 'popeye-restore-'));
    chmodSync(restoreDir, 0o700);
    const restorePaths = deriveRuntimePaths(restoreDir);
    expect(() => restoreBackup(backupDir, restorePaths)).toThrow('Backup verification failed');
  });

  it('backs up workspace paths', () => {
    const { dir, paths } = setupBackupFixture();
    const workspaceDir = join(dir, 'my-workspace');
    mkdirSync(workspaceDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(workspaceDir, 'WORKSPACE.md'), '# My Workspace');
    writeFileSync(join(workspaceDir, 'notes.md'), 'Some notes');
    const backupDir = createBackup({
      destinationDir: join(dir, 'snapshot'),
      runtimePaths: paths,
      workspacePaths: [workspaceDir],
    });
    const workspaceBackupFiles = readdirSync(join(backupDir, 'workspaces', 'my-workspace'));
    expect(workspaceBackupFiles).toContain('WORKSPACE.md');
    expect(workspaceBackupFiles).toContain('notes.md');
    const verification = verifyBackup(backupDir);
    expect(verification.valid).toBe(true);
  });

  it('backs up and verifies files with binary content', () => {
    const { dir, paths } = setupBackupFixture();
    // SQLite magic header + some invalid UTF-8 bytes
    const binaryContent = Buffer.from([
      0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, // "SQLite"
      0xff, 0xfe, 0xfd, 0xfc, 0x00, 0x01, // invalid UTF-8
    ]);
    writeFileSync(paths.appDbPath, binaryContent);
    writeFileSync(paths.memoryDbPath, binaryContent);
    const backupDir = createBackup({ destinationDir: join(dir, 'snapshot'), runtimePaths: paths });
    const verification = verifyBackup(backupDir);
    expect(verification.valid).toBe(true);
    expect(verification.mismatches).toEqual([]);
  });

  it('migrateBackupManifest re-hashes and validates', () => {
    const { dir, paths } = setupBackupFixture();
    // Use binary content to ensure migration handles it correctly
    const binaryContent = Buffer.from([0xff, 0xfe, 0x00, 0x01]);
    writeFileSync(paths.appDbPath, binaryContent);
    const backupDir = createBackup({ destinationDir: join(dir, 'snapshot'), runtimePaths: paths });
    // Verify migration produces a valid result even on an already-correct backup
    const result = migrateBackupManifest(backupDir);
    expect(result.valid).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it('handles empty runtime dirs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-backup-'));
    chmodSync(dir, 0o700);
    const paths = deriveRuntimePaths(dir);
    mkdirSync(paths.configDir, { recursive: true, mode: 0o700 });
    mkdirSync(paths.stateDir, { recursive: true, mode: 0o700 });
    mkdirSync(paths.receiptsDir, { recursive: true, mode: 0o700 });
    const backupDir = createBackup({ destinationDir: join(dir, 'snapshot'), runtimePaths: paths });
    const verification = verifyBackup(backupDir);
    expect(verification.valid).toBe(true);
    const fileEntries = verification.manifest.entries.filter((e) => e.kind === 'file');
    expect(fileEntries.every((e) => e.path === 'manifest.json')).toBe(true);
  });
});
