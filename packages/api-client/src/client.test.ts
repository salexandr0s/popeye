import { chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createControlApi } from '@popeye/control-api';
import { createRuntimeService, initAuthStore, readAuthStore } from '@popeye/runtime-core';
import type { AppConfig } from '@popeye/contracts';

import { PopeyeApiClient } from './client.js';

function makeConfig(dir: string): AppConfig {
  const authFile = join(dir, 'config', 'auth.json');
  initAuthStore(authFile);
  return {
    runtimeDataDir: dir,
    authFile,
    security: { bindHost: '127.0.0.1', bindPort: 0, redactionPatterns: [] },
    telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, rateLimitWindowSeconds: 60 },
    embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'] },
    memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
    engine: { kind: 'fake', command: 'node', args: [] },
    workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
  } as AppConfig;
}

describe('PopeyeApiClient', () => {
  it('fetches health and status from a real Fastify instance', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-client-'));
    chmodSync(dir, 0o700);
    const config = makeConfig(dir);
    const runtime = createRuntimeService(config);
    const app = await createControlApi({ runtime });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.addresses()[0];
    const baseUrl = `http://${address.address}:${address.port}`;
    const store = readAuthStore(config.authFile);

    const client = new PopeyeApiClient({ baseUrl, token: store.current.token });
    const health = await client.health();
    expect(health.ok).toBe(true);
    expect(health.startedAt).toBeTruthy();

    const status = await client.status();
    expect(status.ok).toBe(true);
    expect(status.engineKind).toBe('fake');

    await runtime.close();
    await app.close();
  });

  it('creates a task through the API client', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-client-task-'));
    chmodSync(dir, 0o700);
    const config = makeConfig(dir);
    const runtime = createRuntimeService(config);
    const app = await createControlApi({ runtime });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.addresses()[0];
    const baseUrl = `http://${address.address}:${address.port}`;
    const store = readAuthStore(config.authFile);

    const client = new PopeyeApiClient({ baseUrl, token: store.current.token });
    const result = await client.createTask({
      workspaceId: 'default',
      projectId: null,
      title: 'test task',
      prompt: 'hello world',
      source: 'manual',
      autoEnqueue: false,
    });

    expect(result.task.title).toBe('test task');
    expect(result.task.prompt).toBe('hello world');
    expect(result.job).toBeNull();

    await runtime.close();
    await app.close();
  });

  it('handles 401 for invalid token', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-client-auth-'));
    chmodSync(dir, 0o700);
    const config = makeConfig(dir);
    const runtime = createRuntimeService(config);
    const app = await createControlApi({ runtime });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.addresses()[0];
    const baseUrl = `http://${address.address}:${address.port}`;

    const client = new PopeyeApiClient({ baseUrl, token: 'invalid-token-that-is-long-enough' });
    await expect(client.health()).rejects.toThrow('401');

    await runtime.close();
    await app.close();
  });
});
