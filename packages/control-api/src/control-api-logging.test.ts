import { chmodSync, mkdtempSync } from 'node:fs';
import { Writable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createRuntimeService, initAuthStore, issueCsrfToken } from '@popeye/runtime-core';
import { createLogger } from '@popeye/observability';

import { createControlApi } from './index.js';

function createCapture(): { stream: Writable; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return {
    stream,
    lines: () =>
      chunks
        .join('')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

function makeTestEnv() {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-api-log-'));
  chmodSync(dir, 0o700);
  const authFile = join(dir, 'auth.json');
  const store = initAuthStore(authFile);
  const runtime = createRuntimeService({
    runtimeDataDir: dir,
    authFile,
    security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
    telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, rateLimitWindowSeconds: 60 },
    embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'] },
    memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
    engine: { kind: 'fake', command: 'node', args: [] },
    workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: false, heartbeatIntervalSeconds: 3600 }],
  });
  return { dir, store, runtime };
}

describe('Control API structured logging', () => {
  it('logs bearer auth failure', async () => {
    const { runtime, store: _store } = makeTestEnv();
    const { stream, lines } = createCapture();
    const logger = createLogger('control-api', { destination: stream });
    const app = await createControlApi({ runtime, logger });

    await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { authorization: 'Bearer wrong-token' },
    });

    const output = lines();
    const authLog = output.find((l) => l.msg === 'bearer auth failed');
    expect(authLog).toBeDefined();
    expect(authLog).toHaveProperty('path', '/v1/health');
    expect(authLog).toHaveProperty('method', 'GET');

    await runtime.close();
  });

  it('logs CSRF validation failure on mutating request', async () => {
    const { runtime, store } = makeTestEnv();
    const { stream, lines } = createCapture();
    const logger = createLogger('control-api', { destination: stream });
    const app = await createControlApi({ runtime, logger });

    await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: {
        authorization: `Bearer ${store.current.token}`,
        'x-popeye-csrf': 'invalid-csrf',
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ workspaceId: 'default', title: 'test', prompt: 'hello', source: 'manual' }),
    });

    const output = lines();
    const csrfLog = output.find((l) => l.msg === 'csrf validation failed');
    expect(csrfLog).toBeDefined();
    expect(csrfLog).toHaveProperty('path', '/v1/tasks');
    expect(csrfLog).toHaveProperty('method', 'POST');

    await runtime.close();
  });

  it('logs cross-site request block', async () => {
    const { runtime, store } = makeTestEnv();
    const { stream, lines } = createCapture();
    const logger = createLogger('control-api', { destination: stream });
    const csrfToken = issueCsrfToken(store);
    const app = await createControlApi({ runtime, logger });

    await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: {
        authorization: `Bearer ${store.current.token}`,
        'x-popeye-csrf': csrfToken,
        'sec-fetch-site': 'cross-site',
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ workspaceId: 'default', title: 'test', prompt: 'hello', source: 'manual' }),
    });

    const output = lines();
    const crossSiteLog = output.find((l) => l.msg === 'cross-site request blocked');
    expect(crossSiteLog).toBeDefined();
    expect(crossSiteLog).toHaveProperty('path', '/v1/tasks');
    expect(crossSiteLog).toHaveProperty('secFetchSite', 'cross-site');

    await runtime.close();
  });

  it('logs browser session missing on cookie-only auth', async () => {
    const { runtime } = makeTestEnv();
    const { stream, lines } = createCapture();
    const logger = createLogger('control-api', { destination: stream });
    const app = await createControlApi({ runtime, logger });

    // Request with no auth header and no cookie — should log session missing
    await app.inject({
      method: 'GET',
      url: '/v1/health',
    });

    const output = lines();
    const sessionLog = output.find((l) => l.msg === 'browser session missing');
    expect(sessionLog).toBeDefined();
    expect(sessionLog).toHaveProperty('path', '/v1/health');

    await runtime.close();
  });
});
