import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createBackup, restoreBackup, verifyBackup } from './backup.js';
import { deriveRuntimePaths } from './config.js';

describe('backup and restore', () => {
  it('creates and verifies a backup', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-backup-'));
    chmodSync(dir, 0o700);
    const paths = deriveRuntimePaths(dir);
    mkdirSync(paths.configDir, { recursive: true, mode: 0o700 });
    mkdirSync(paths.stateDir, { recursive: true, mode: 0o700 });
    mkdirSync(paths.receiptsDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(paths.configDir, 'config.json'), '{"ok":true}');
    writeFileSync(paths.appDbPath, 'app');
    writeFileSync(paths.memoryDbPath, 'memory');
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
});
