import { chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createRuntimeService,
  initAuthStore,
  issueCsrfToken,
  readAuthStore,
} from '@popeye/runtime-core';

import { createControlApi } from './index.js';

describe('Sec-Fetch-Site validation', () => {
  it('blocks mutations with sec-fetch-site: cross-site', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-secfetch-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: {
        bindHost: '127.0.0.1',
        bindPort: 3210,
        redactionPatterns: [],
      },
      telegram: {
        enabled: false,
        allowedUserId: '42',
        maxMessagesPerMinute: 10,
        rateLimitWindowSeconds: 60,
      },
      embeddings: {
        provider: 'disabled',
        allowedClassifications: ['embeddable'],
      },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [
        {
          id: 'default',
          name: 'Default workspace',
          heartbeatEnabled: true,
          heartbeatIntervalSeconds: 3600,
        },
      ],
    });
    const app = await createControlApi({ runtime });
    const csrf = issueCsrfToken(readAuthStore(authFile));
    const payload = {
      workspaceId: 'default',
      projectId: null,
      title: 't',
      prompt: 'hello',
      source: 'manual',
      autoEnqueue: false,
    };

    // cross-site -> blocked
    const crossSite = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: {
        authorization: `Bearer ${store.current.token}`,
        'x-popeye-csrf': csrf,
        'sec-fetch-site': 'cross-site',
      },
      payload,
    });
    expect(crossSite.statusCode).toBe(403);
    expect(crossSite.json()).toMatchObject({
      error: 'csrf_cross_site_blocked',
    });

    // same-origin -> allowed
    const sameOrigin = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: {
        authorization: `Bearer ${store.current.token}`,
        'x-popeye-csrf': csrf,
        'sec-fetch-site': 'same-origin',
      },
      payload,
    });
    expect(sameOrigin.statusCode).toBe(200);

    // no sec-fetch-site header -> allowed (non-browser clients)
    const noHeader = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: {
        authorization: `Bearer ${store.current.token}`,
        'x-popeye-csrf': csrf,
      },
      payload,
    });
    expect(noHeader.statusCode).toBe(200);

    // sec-fetch-site: none -> allowed (same-origin navigation)
    const noneValue = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: {
        authorization: `Bearer ${store.current.token}`,
        'x-popeye-csrf': csrf,
        'sec-fetch-site': 'none',
      },
      payload,
    });
    expect(noneValue.statusCode).toBe(200);

    // sec-fetch-site: same-site -> blocked (not in allow list)
    const sameSite = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: {
        authorization: `Bearer ${store.current.token}`,
        'x-popeye-csrf': csrf,
        'sec-fetch-site': 'same-site',
      },
      payload,
    });
    expect(sameSite.statusCode).toBe(403);
    expect(sameSite.json()).toMatchObject({
      error: 'csrf_cross_site_blocked',
    });

    await runtime.close();
    await app.close();
  });
});
