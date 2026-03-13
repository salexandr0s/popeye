import { chmodSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AppConfig } from '@popeye/contracts';
import { describe, expect, it } from 'vitest';

import { createRuntimeService } from './runtime-service.js';
import { deriveRuntimePaths } from './config.js';
import { initAuthStore } from './auth.js';

function createTestConfig(dir: string): AppConfig {
  return {
    runtimeDataDir: dir,
    authFile: join(dir, 'config', 'auth.json'),
    security: { bindHost: '127.0.0.1', bindPort: 0, redactionPatterns: [] },
    telegram: { enabled: false, allowedUserId: undefined, maxMessagesPerMinute: 10, rateLimitWindowSeconds: 60 },
    embeddings: { provider: 'disabled', allowedClassifications: ['new_platform'], model: 'text-embedding-3-small', dimensions: 1536 },
    memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
    engine: { kind: 'fake' as const, command: 'node', args: [] },
    workspaces: [{ id: 'test', name: 'Test', heartbeatEnabled: false, heartbeatIntervalSeconds: 3600 }],
  } as AppConfig;
}

describe('startup profiling', () => {
  it('records startup timing breakdown', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-profile-'));
    chmodSync(dir, 0o700);
    const paths = deriveRuntimePaths(dir);
    for (const d of [paths.configDir, paths.stateDir, paths.logsDir, paths.receiptsDir, paths.backupsDir, paths.runLogsDir, paths.receiptsByRunDir, paths.receiptsByDayDir]) {
      mkdirSync(d, { recursive: true, mode: 0o700 });
    }
    initAuthStore(join(dir, 'config', 'auth.json'));

    const config = createTestConfig(dir);
    const start = performance.now();
    const service = createRuntimeService(config);
    const elapsed = performance.now() - start;

    expect(service.startupProfile).toBeDefined();
    expect(service.startupProfile.dbReadyMs).toBeGreaterThanOrEqual(0);
    expect(service.startupProfile.reconcileMs).toBeGreaterThanOrEqual(service.startupProfile.dbReadyMs);
    expect(service.startupProfile.schedulerReadyMs).toBeGreaterThanOrEqual(service.startupProfile.reconcileMs);

    // Regression guard: startup should complete in under 2000ms
    expect(elapsed).toBeLessThan(2000);

    await service.shutdown();
  });
});
