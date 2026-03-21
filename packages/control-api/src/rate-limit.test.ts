import { chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { initAuthStore, createRuntimeService } from '@popeye/runtime-core';

import { createControlApi } from './index.js';

describe('rate limiting', () => {
  it('returns 429 after exceeding rate limit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-rate-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: undefined, maxMessagesPerMinute: 10, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });

    const responses = [];
    for (let i = 0; i <= 100; i++) {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/health',
        headers: { authorization: `Bearer ${store.current.token}` },
      });
      responses.push(res.statusCode);
    }

    expect(responses.includes(429)).toBe(true);

    await runtime.close();
    await app.close();
  });

  it('OAuth callback has stricter rate limit than global', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-rate-oauth-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: undefined, maxMessagesPerMinute: 10, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });

    // OAuth callback should hit 429 after 10 requests (stricter than global 100)
    const responses = [];
    for (let i = 0; i <= 10; i++) {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/connections/oauth/callback?state=test&code=test',
      });
      responses.push(res.statusCode);
    }

    expect(responses.includes(429)).toBe(true);

    await runtime.close();
    await app.close();
  });
});
