import { mkdtempSync, rmSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RuntimePaths } from '@popeye/contracts';

import { writeReceiptArtifact, readReceiptArtifact } from './receipt-artifacts.js';

function makePaths(receiptsByRunDir: string): RuntimePaths {
  return {
    runtimeDataDir: receiptsByRunDir,
    configDir: receiptsByRunDir,
    stateDir: receiptsByRunDir,
    appDbPath: join(receiptsByRunDir, 'app.db'),
    memoryDbPath: join(receiptsByRunDir, 'memory.db'),
    logsDir: receiptsByRunDir,
    runLogsDir: receiptsByRunDir,
    receiptsDir: receiptsByRunDir,
    receiptsByRunDir,
    receiptsByDayDir: receiptsByRunDir,
    backupsDir: receiptsByRunDir,
    memoryDailyDir: receiptsByRunDir,
  };
}

describe('receipt-artifacts', () => {
  let tempDir: string;
  let paths: RuntimePaths;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'popeye-test-'));
    mkdirSync(tempDir, { recursive: true });
    paths = makePaths(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('writeReceiptArtifact', () => {
    it('writes JSON to correct path', () => {
      const content = JSON.stringify({ id: 'rcpt-1', status: 'succeeded' });
      const filePath = writeReceiptArtifact(paths, 'rcpt-1', content);
      expect(filePath).toBe(join(tempDir, 'rcpt-1.json'));
    });

    it('sets 0o600 file permissions', () => {
      const content = JSON.stringify({ id: 'rcpt-2' });
      const filePath = writeReceiptArtifact(paths, 'rcpt-2', content);
      const mode = statSync(filePath).mode & 0o777;
      expect(mode).toBe(0o600);
    });
  });

  describe('readReceiptArtifact', () => {
    it('round-trips written content', () => {
      const content = JSON.stringify({ id: 'rcpt-3', summary: 'all good' });
      writeReceiptArtifact(paths, 'rcpt-3', content);
      const result = readReceiptArtifact(paths, 'rcpt-3');
      expect(result).toBe(content);
    });

    it('returns null for non-existent receipt', () => {
      const result = readReceiptArtifact(paths, 'does-not-exist');
      expect(result).toBeNull();
    });
  });
});
