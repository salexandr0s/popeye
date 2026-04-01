import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RUNTIME_DATA_DIR,
  defaultAssistantWorkspacePath,
  defaultAuthFilePath,
  loadAppConfig,
  scaffoldAssistantWorkspace,
} from './config.js';

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
    expect(config.workspaces[0]?.rootPath).toBe(defaultAssistantWorkspacePath());
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

  it('preserves explicit workspace rootPath when configured', () => {
    const path = writeConfigFile({
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60, maxConcurrentPreparations: 4 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'] },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', rootPath: '/tmp/my-assistant', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });

    const config = loadAppConfig(path);
    expect(config.workspaces[0]?.rootPath).toBe('/tmp/my-assistant');
  });
});

describe('scaffoldAssistantWorkspace', () => {
  it('creates the default assistant workspace files without overwriting existing content', () => {
    const root = mkdtempSync(join(tmpdir(), 'popeye-assistant-'));

    scaffoldAssistantWorkspace(root);

    expect(existsSync(join(root, 'WORKSPACE.md'))).toBe(true);
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(root, 'SOUL.md'))).toBe(true);
    expect(existsSync(join(root, 'IDENTITY.md'))).toBe(true);
    expect(existsSync(join(root, 'identities', 'default.md'))).toBe(true);
    expect((statSync(root).mode & 0o777)).toBe(0o700);
    expect((statSync(join(root, 'identities')).mode & 0o777)).toBe(0o700);

    const workspacePath = join(root, 'WORKSPACE.md');
    const original = readFileSync(workspacePath, 'utf8');
    writeFileSync(workspacePath, 'operator-owned custom workspace\n');

    scaffoldAssistantWorkspace(root);

    expect(readFileSync(workspacePath, 'utf8')).toBe('operator-owned custom workspace\n');
    expect(original).toContain('default Popeye workspace');
  });
});
