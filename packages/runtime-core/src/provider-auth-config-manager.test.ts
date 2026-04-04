import { chmodSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RuntimeConflictError } from './errors.js';
import { loadAppConfig } from './config.js';
import { loadProviderAuthConfigFromFile, updateProviderAuthConfigFile } from './provider-auth-config-manager.js';

function writeConfigFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-provider-auth-config-'));
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
    providerAuth: { google: {}, github: {} },
    workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
  }, null, 2));
  return configPath;
}

describe('provider-auth-config-manager', () => {
  it('updates provider auth fields and reports readiness from secret refs', () => {
    const configPath = writeConfigFile();
    const secretValues = new Map<string, string>([['secret-google-client', 'google-secret']]);

    const result = updateProviderAuthConfigFile(
      configPath,
      'google',
      { clientId: 'google-client-id', clientSecretRefId: 'secret-google-client' },
      (id) => secretValues.get(id) ?? null,
    );
    const reloaded = loadAppConfig(configPath);
    const snapshot = loadProviderAuthConfigFromFile(configPath, (id) => secretValues.get(id) ?? null);

    expect(result.changedFields).toEqual(['clientId', 'clientSecretRefId']);
    expect(result.record).toMatchObject({
      provider: 'google',
      clientId: 'google-client-id',
      clientSecretRefId: 'secret-google-client',
      secretAvailability: 'available',
      status: 'ready',
    });
    expect(reloaded.providerAuth.google).toEqual({
      clientId: 'google-client-id',
      clientSecretRefId: 'secret-google-client',
    });
    expect(snapshot.find((record) => record.provider === 'google')).toMatchObject({
      status: 'ready',
      secretAvailability: 'available',
    });
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it('reports missing stored secrets when the ref is present but unavailable', () => {
    const configPath = writeConfigFile();

    updateProviderAuthConfigFile(
      configPath,
      'github',
      { clientId: 'github-client-id', clientSecretRefId: 'secret-github-client' },
      () => null,
    );

    const snapshot = loadProviderAuthConfigFromFile(configPath, () => null);
    expect(snapshot.find((record) => record.provider === 'github')).toMatchObject({
      status: 'missing_client_secret',
      secretAvailability: 'missing',
    });
  });

  it('rejects overlapping provider auth config updates when the lock file already exists', () => {
    const configPath = writeConfigFile();
    writeFileSync(`${configPath}.lock`, 'locked');

    expect(() => updateProviderAuthConfigFile(
      configPath,
      'google',
      { clientId: 'google-client-id', clientSecretRefId: null },
      () => null,
    )).toThrowError(RuntimeConflictError);
  });
});
