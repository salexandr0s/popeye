import { chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AppConfig } from '../../../../packages/contracts/src/index.ts';
import { createControlApi } from '../../../../packages/control-api/src/index.ts';
import { createRuntimeService, initAuthStore, readAuthStore } from '../../../../packages/runtime-core/src/index.ts';

import { buildInstructionPreviewPath, buildMemorySearchPath } from './routes';

function makeConfig(dir: string): AppConfig {
  const authFile = join(dir, 'config', 'auth.json');
  initAuthStore(authFile);
  return {
    runtimeDataDir: dir,
    authFile,
    security: { bindHost: '127.0.0.1', bindPort: 0, redactionPatterns: [], promptScanQuarantinePatterns: [], promptScanSanitizePatterns: [] },
    telegram: { enabled: false, allowedUserId: undefined, maxMessagesPerMinute: 10, rateLimitWindowSeconds: 60 },
    embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
    memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
    engine: { kind: 'fake', command: 'node', args: [] },
    workspaces: [
      {
        id: 'default',
        name: 'Default workspace',
        rootPath: null,
        heartbeatEnabled: false,
        heartbeatIntervalSeconds: 3600,
        projects: [{ id: 'proj-1', name: 'Project 1', path: null, workspaceId: 'default' }],
      },
    ],
  };
}

const runningApps: Array<{ close: () => Promise<unknown>; runtimeClose: () => Promise<void> }> = [];

afterEach(async () => {
  while (runningApps.length > 0) {
    const entry = runningApps.pop();
    if (!entry) continue;
    await entry.close();
    await entry.runtimeClose();
  }
});

describe('web inspector route helpers', () => {
  it('instruction preview path hits the live control API route with optional project query', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-web-routes-'));
    chmodSync(dir, 0o700);
    const config = makeConfig(dir);
    const runtime = createRuntimeService(config);
    const app = await createControlApi({ runtime });
    await app.listen({ host: '127.0.0.1', port: 0 });
    runningApps.push({ close: () => app.close(), runtimeClose: () => runtime.close() });

    const address = app.addresses()[0];
    const baseUrl = `http://${address.address}:${address.port}`;
    const token = readAuthStore(config.authFile).current.token;

    const response = await fetch(`${baseUrl}${buildInstructionPreviewPath('default', 'proj-1')}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as { id: string; sources: unknown[] };
    expect(payload.id).toBeTruthy();
    expect(Array.isArray(payload.sources)).toBe(true);
  });

  it('memory search path hits the live control API GET route', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-web-routes-'));
    chmodSync(dir, 0o700);
    const config = makeConfig(dir);
    const runtime = createRuntimeService(config);
    const app = await createControlApi({ runtime });
    await app.listen({ host: '127.0.0.1', port: 0 });
    runningApps.push({ close: () => app.close(), runtimeClose: () => runtime.close() });

    const address = app.addresses()[0];
    const baseUrl = `http://${address.address}:${address.port}`;
    const token = readAuthStore(config.authFile).current.token;

    const response = await fetch(`${baseUrl}${buildMemorySearchPath({ query: 'hello', includeContent: true, limit: 20 })}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as { query: string; results: unknown[] };
    expect(payload.query).toBe('hello');
    expect(Array.isArray(payload.results)).toBe(true);
  });
});
