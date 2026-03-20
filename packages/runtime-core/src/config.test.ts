import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_RUNTIME_DATA_DIR, defaultAuthFilePath, loadAppConfig } from './config.js';

function writeConfigFile(contents: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-config-'));
  chmodSync(dir, 0o700);
  const configPath = join(dir, 'config.json');
  writeFileSync(configPath, JSON.stringify(contents, null, 2));
  return configPath;
}

describe('loadAppConfig', () => {
  it('defaults runtimeDataDir and authFile when omitted from file config', () => {
    const path = writeConfigFile({
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60, maxConcurrentPreparations: 4 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'] },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });

    const config = loadAppConfig(path);
    expect(config.runtimeDataDir).toBe(DEFAULT_RUNTIME_DATA_DIR);
    expect(config.authFile).toBe(defaultAuthFilePath(DEFAULT_RUNTIME_DATA_DIR));
  });

  it('preserves explicit runtimeDataDir and authFile when configured', () => {
    const path = writeConfigFile({
      runtimeDataDir: '/tmp/popeye-custom',
      authFile: '/tmp/popeye-custom/config/auth.json',
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60, maxConcurrentPreparations: 4 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'] },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });

    const config = loadAppConfig(path);
    expect(config.runtimeDataDir).toBe('/tmp/popeye-custom');
    expect(config.authFile).toBe('/tmp/popeye-custom/config/auth.json');
  });
});
