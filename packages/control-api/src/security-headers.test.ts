import { chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { initAuthStore, createRuntimeService } from '@popeye/runtime-core';

import { createControlApi } from './index.js';

describe('security headers', () => {
  it('includes CSP header with nonce in responses', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-headers-'));
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
    const app = await createControlApi({ runtime, cspNonce: 'test-nonce-abc' });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { authorization: `Bearer ${store.current.token}` },
    });

    const csp = res.headers['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('nonce-test-nonce-abc');

    await runtime.close();
    await app.close();
  });
});
