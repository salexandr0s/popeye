import { chmodSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RuntimeConflictError, RuntimeValidationError } from './errors.js';
import { loadAppConfig } from './config.js';
import { toTelegramConfigRecord, updateTelegramConfigFile } from './telegram-config-manager.js';

function writeConfigFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-telegram-config-'));
  chmodSync(dir, 0o700);
  const configPath = join(dir, 'config.json');
  writeFileSync(configPath, JSON.stringify({
    runtimeDataDir: join(dir, 'runtime'),
    authFile: join(dir, 'auth.json'),
    security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
    telegram: {
      enabled: false,
      maxMessagesPerMinute: 10,
      globalMaxMessagesPerMinute: 30,
      rateLimitWindowSeconds: 60,
      maxConcurrentPreparations: 4,
    },
    embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
    memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
    engine: { kind: 'fake', command: 'node', args: [] },
    workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
  }, null, 2));
  return configPath;
}

describe('telegram-config-manager', () => {
  it('updates only Telegram fields, preserves other config, and writes secure permissions', () => {
    const configPath = writeConfigFile();

    const result = updateTelegramConfigFile(configPath, {
      enabled: true,
      allowedUserId: '5315323298',
      secretRefId: 'secret-telegram-bot',
    });
    const reloaded = loadAppConfig(configPath);

    expect(result.changedFields).toEqual(['enabled', 'allowedUserId', 'secretRefId']);
    expect(result.telegram).toEqual({
      enabled: true,
      allowedUserId: '5315323298',
      secretRefId: 'secret-telegram-bot',
    });
    expect(toTelegramConfigRecord(reloaded)).toEqual(result.telegram);
    expect(reloaded.security.bindPort).toBe(3210);
    expect(reloaded.workspaces[0]?.id).toBe('default');
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it('rejects enabled Telegram config without an allowed user id', () => {
    const configPath = writeConfigFile();

    expect(() => updateTelegramConfigFile(configPath, {
      enabled: true,
      allowedUserId: null,
      secretRefId: 'secret-telegram-bot',
    })).toThrowError(RuntimeValidationError);
  });

  it('rejects overlapping Telegram config updates when the lock file already exists', () => {
    const configPath = writeConfigFile();
    writeFileSync(`${configPath}.lock`, 'locked');

    expect(() => updateTelegramConfigFile(configPath, {
      enabled: false,
      allowedUserId: null,
      secretRefId: null,
    })).toThrowError(RuntimeConflictError);
  });
});
