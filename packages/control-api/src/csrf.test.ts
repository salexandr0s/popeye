import { chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AUTH_COOKIE_NAME,
  clearBearerCsrfCache,
  createRuntimeService,
  initAuthStore,
  issueCsrfToken,
} from '@popeye/runtime-core';

import { createControlApi } from './index.js';

describe('CSRF token issuance and validation', () => {
  it('issues a CSRF token and sets an HttpOnly cookie', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-csrf-'));
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

    const response = await app.inject({
      method: 'GET',
      url: '/v1/security/csrf-token',
      headers: { authorization: `Bearer ${store.current.token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { token: string };
    expect(body.token).toBeTruthy();
    expect(typeof body.token).toBe('string');

    const setCookie = response.headers['set-cookie'] as string;
    expect(setCookie).toContain(`popeye_csrf=${body.token}`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/');

    // Valid token allows mutation
    const created = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: {
        authorization: `Bearer ${store.current.token}`,
        'x-popeye-csrf': body.token,
        'sec-fetch-site': 'same-origin',
      },
      payload: {
        workspaceId: 'default',
        projectId: null,
        title: 't',
        prompt: 'hello',
        source: 'manual',
        autoEnqueue: false,
      },
    });
    expect(created.statusCode).toBe(200);

    // Wrong token is rejected
    const rejected = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: {
        authorization: `Bearer ${store.current.token}`,
        'x-popeye-csrf': 'wrong-csrf-token',
        'sec-fetch-site': 'same-origin',
      },
      payload: {
        workspaceId: 'default',
        projectId: null,
        title: 't',
        prompt: 'hello',
        source: 'manual',
        autoEnqueue: false,
      },
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json()).toMatchObject({ error: 'csrf_invalid' });

    await runtime.close();
    await app.close();
  });

  it('bearer CSRF token is random and stable per session', async () => {
    clearBearerCsrfCache();
    const dir = mkdtempSync(join(tmpdir(), 'popeye-csrf-match-'));
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

    const response = await app.inject({
      method: 'GET',
      url: '/v1/security/csrf-token',
      headers: { authorization: `Bearer ${store.current.token}` },
    });

    const body = response.json() as { token: string };
    // Random CSRF token matches what issueCsrfToken returns (same cache)
    expect(body.token).toBe(issueCsrfToken(store));

    // Second request returns same token (stable)
    const response2 = await app.inject({
      method: 'GET',
      url: '/v1/security/csrf-token',
      headers: { authorization: `Bearer ${store.current.token}` },
    });
    expect((response2.json() as { token: string }).token).toBe(body.token);

    await runtime.close();
    await app.close();
  });

  it('accepts same-origin browser session auth for web clients', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-csrf-cookie-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    initAuthStore(authFile);
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
    const session = runtime.createBrowserSession();

    const csrfResponse = await app.inject({
      method: 'GET',
      url: '/v1/security/csrf-token',
      headers: { cookie: `${AUTH_COOKIE_NAME}=${encodeURIComponent(session.id)}` },
    });

    expect(csrfResponse.statusCode).toBe(200);
    const body = csrfResponse.json() as { token: string };
    expect(body.token).toBe(session.csrfToken);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: {
        cookie: `${AUTH_COOKIE_NAME}=${encodeURIComponent(session.id)}`,
        'x-popeye-csrf': body.token,
        'sec-fetch-site': 'same-origin',
      },
      payload: {
        workspaceId: 'default',
        projectId: null,
        title: 'cookie-auth-task',
        prompt: 'hello',
        source: 'manual',
        autoEnqueue: false,
      },
    });

    expect(created.statusCode).toBe(200);

    await runtime.close();
    await app.close();
  });

  // Timing-safe comparison for browser session CSRF is structural (uses constantTimeEquals).
  // This test exercises the code path to ensure correct accept/reject behavior.
  it('browser session CSRF rejects wrong token of same length', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-csrf-timing-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    initAuthStore(authFile);
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
    const session = runtime.createBrowserSession();

    // Wrong token of same length as the real CSRF token — must be rejected
    const wrongCsrf = 'x'.repeat(session.csrfToken.length);

    const rejected = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: {
        cookie: `${AUTH_COOKIE_NAME}=${encodeURIComponent(session.id)}`,
        'x-popeye-csrf': wrongCsrf,
        'sec-fetch-site': 'same-origin',
      },
      payload: {
        workspaceId: 'default',
        projectId: null,
        title: 'timing-test',
        prompt: 'hello',
        source: 'manual',
        autoEnqueue: false,
      },
    });

    expect(rejected.statusCode).toBe(403);

    await runtime.close();
    await app.close();
  });
});
