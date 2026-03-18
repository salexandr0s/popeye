import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PopeyeApiClient } from '@popeye/api-client';
import type { AppConfig } from '@popeye/contracts';

import { tryConnectDaemon } from './api-client.js';

describe('tryConnectDaemon', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function createTestConfig(): AppConfig {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-cli-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    writeFileSync(
      authFile,
      JSON.stringify({
        current: {
          token: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          createdAt: new Date().toISOString(),
        },
      }),
      { mode: 0o600 },
    );

    return {
      runtimeDataDir: dir,
      authFile,
      security: {
        bindHost: '127.0.0.1',
        bindPort: 3210,
        redactionPatterns: [],
      },
      telegram: {
        enabled: false,
        maxMessagesPerMinute: 10,
        rateLimitWindowSeconds: 60,
      },
      embeddings: {
        provider: 'disabled',
        allowedClassifications: ['embeddable'],
      },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [
        {
          id: 'default',
          name: 'Default workspace',
          heartbeatEnabled: true,
          heartbeatIntervalSeconds: 3600,
        },
      ],
    };
  }

  it('returns PopeyeClient when daemon is reachable', async () => {
    const config = createTestConfig();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          ok: true,
          startedAt: '2026-01-01T00:00:00Z',
        }),
    });

    const client = await tryConnectDaemon(config);
    expect(client).toBeInstanceOf(PopeyeApiClient);
  });

  it('returns null when daemon is unreachable', async () => {
    const config = createTestConfig();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TypeError('fetch failed'),
    );

    const client = await tryConnectDaemon(config);
    expect(client).toBeNull();
  });

  it('returns null when auth file is missing', async () => {
    const config = createTestConfig();
    config.authFile = '/nonexistent/auth.json';

    const client = await tryConnectDaemon(config);
    expect(client).toBeNull();
  });
});
