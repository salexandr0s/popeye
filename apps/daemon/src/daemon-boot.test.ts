import { chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AppConfig } from '@popeye/contracts';
import { createControlApi } from '@popeye/control-api';
import { initAuthStore, readAuthStore, createRuntimeService } from '@popeye/runtime-core';
import { WebBootstrapNonceStore } from './web-bootstrap.js';

function makeConfig(dir: string): AppConfig {
  const authFile = join(dir, 'config', 'auth.json');
  initAuthStore(authFile);
  return {
    runtimeDataDir: dir,
    authFile,
    security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
    telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, rateLimitWindowSeconds: 60 },
    embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
    memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: true, compactionFlushConfidence: 0.7 },
    engine: { kind: 'fake', command: 'node', args: [] },
    workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
  };
}

describe('daemon boot integration', () => {
  it('config -> runtime -> scheduler -> control-api serves health', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-boot-'));
    chmodSync(dir, 0o700);
    const config = makeConfig(dir);
    const runtime = createRuntimeService(config);
    const app = await createControlApi({ runtime });
    const store = readAuthStore(config.authFile);
    const headers = { authorization: `Bearer ${store.current.token}` };
    const health = await app.inject({ method: 'GET', url: '/v1/health', headers });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ ok: true });
    const status = await app.inject({ method: 'GET', url: '/v1/status', headers });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ schedulerRunning: true });
    const daemonState = await app.inject({ method: 'GET', url: '/v1/daemon/state', headers });
    expect(daemonState.statusCode).toBe(200);
    expect(daemonState.json().lastSchedulerTickAt).toBeTruthy();
    await runtime.close();
    await app.close();
  });

  it('boot with multiple workspaces serves all via API', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-boot-multi-'));
    chmodSync(dir, 0o700);
    const config = makeConfig(dir);
    config.workspaces = [
      { id: 'alpha', name: 'Alpha', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 },
      { id: 'beta', name: 'Beta', heartbeatEnabled: true, heartbeatIntervalSeconds: 1800 },
      { id: 'gamma', name: 'Gamma', heartbeatEnabled: false, heartbeatIntervalSeconds: 900 },
    ];
    const runtime = createRuntimeService(config);
    const app = await createControlApi({ runtime });
    const store = readAuthStore(config.authFile);
    const headers = { authorization: `Bearer ${store.current.token}` };
    const workspaces = await app.inject({ method: 'GET', url: '/v1/workspaces', headers });
    expect(workspaces.statusCode).toBe(200);
    expect(workspaces.json().map((w: { id: string }) => w.id)).toEqual(expect.arrayContaining(['alpha', 'beta', 'gamma']));
    const scheduler = await app.inject({ method: 'GET', url: '/v1/daemon/scheduler', headers });
    expect(scheduler.statusCode).toBe(200);
    expect(scheduler.json().nextHeartbeatDueAt).toBeTruthy();
    await runtime.close();
    await app.close();
  });

  it('bootstrap nonce store expires and rejects stale nonces', () => {
    let now = 10_000;
    const store = new WebBootstrapNonceStore(1_000, () => now);

    const nonce = store.issue();
    expect(store.size()).toBe(1);
    expect(store.consume(nonce)).toBe('accepted');
    expect(store.consume(nonce)).toBe('invalid');

    const expiringNonce = store.issue();
    now += 1_001;
    expect(store.consume(expiringNonce)).toBe('expired');
    expect(store.size()).toBe(0);
  });
});
