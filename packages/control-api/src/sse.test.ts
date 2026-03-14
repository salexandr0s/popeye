import { chmodSync, mkdtempSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createRuntimeService, initAuthStore } from '@popeye/runtime-core';

import { createControlApi } from './index.js';

function makeConfig(dir: string) {
  const authFile = join(dir, 'auth.json');
  const store = initAuthStore(authFile);
  return {
    store,
    config: {
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1' as const, bindPort: 0, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled' as const, allowedClassifications: ['embeddable' as const] },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake' as const, command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    },
  };
}

describe('SSE event stream', () => {
  it('streams events in SSE format over a real HTTP connection', { timeout: 15_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-sse-'));
    chmodSync(dir, 0o700);
    const { store, config } = makeConfig(dir);
    const runtime = createRuntimeService(config);
    const app = await createControlApi({ runtime });

    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const url = new URL('/v1/events/stream', address);

    const receivedData = await new Promise<string>((resolve, reject) => {
      const req = http.get(
        url,
        { headers: { authorization: `Bearer ${store.current.token}` } },
        (res) => {
          expect(res.statusCode).toBe(200);
          expect(res.headers['content-type']).toBe('text/event-stream');

          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
            // Wait for a complete SSE frame (ends with \n\n)
            if (data.includes('\n\n') && data.includes('test_event')) {
              res.destroy();
              resolve(data);
            }
          });
          res.on('error', () => {
            // expected — we destroy the response after receiving data
            if (data.includes('test_event')) {
              resolve(data);
            }
          });
        },
      );

      req.on('error', reject);

      // Emit events after the connection is established
      setTimeout(() => {
        const emitTimer = setInterval(() => {
          runtime.events.emit('event', { event: 'test_event', data: '{"key":"val"}' });
        }, 50);
        setTimeout(() => clearInterval(emitTimer), 10_000);
      }, 100);

      setTimeout(() => reject(new Error('SSE test timed out')), 12_000);
    });

    expect(receivedData).toContain('event: test_event');
    expect(receivedData).toContain('data: {"key":"val"}');

    await runtime.close();
    await app.close();
  });

  it('requires auth for SSE endpoint', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-sse-auth-'));
    chmodSync(dir, 0o700);
    const { config } = makeConfig(dir);
    const runtime = createRuntimeService(config);
    const app = await createControlApi({ runtime });

    const unauthorized = await app.inject({
      method: 'GET',
      url: '/v1/events/stream',
    });
    expect(unauthorized.statusCode).toBe(401);

    await runtime.close();
    await app.close();
  });

  it('rejects SSE connections beyond maxSseConnections with 429', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-sse-limit-'));
    chmodSync(dir, 0o700);
    const { store, config } = makeConfig(dir);
    const runtime = createRuntimeService(config);
    // Set limit to 0 so the very first inject() hits 429
    const app = await createControlApi({ runtime, maxSseConnections: 0 });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/events/stream',
      headers: { authorization: `Bearer ${store.current.token}` },
    });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'too_many_sse_connections' });

    await runtime.close();
    await app.close();
  });
});
