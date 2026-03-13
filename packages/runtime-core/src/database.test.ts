import { chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { initAuthStore } from './auth.js';
import { openRuntimeDatabases } from './database.js';

describe('openRuntimeDatabases', () => {
  it('creates and migrates app/memory databases', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-db-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'config', 'auth.json');
    initAuthStore(authFile);
    const databases = openRuntimeDatabases({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: undefined, maxMessagesPerMinute: 10, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: true, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const appTables = databases.app.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'").get() as { name: string };
    const memoryTables = databases.memory.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories'").get() as { name: string };
    expect(appTables.name).toBe('tasks');
    expect(memoryTables.name).toBe('memories');
    databases.app.close();
    databases.memory.close();
  });
});
