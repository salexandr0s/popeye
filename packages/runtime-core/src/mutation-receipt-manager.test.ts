import { chmodSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createRuntimeService, initAuthStore } from './index.js';

describe('mutation receipt manager', () => {
  it('writes redacted mutation receipts with zero usage and persists an artifact', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-mutation-receipts-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    initAuthStore(authFile);

    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: ['sk-[A-Za-z0-9]{20,}'] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const secretLike = 'sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234'; // secret-scan: allow

    const record = runtime.writeMutationReceipt({
      kind: 'telegram_config_update',
      component: 'telegram',
      status: 'succeeded',
      summary: `Saved Telegram config ${secretLike}`,
      details: `secret value ${secretLike} was redacted before receipt write`,
      actorRole: 'operator',
    });

    const fetched = runtime.getMutationReceipt(record.id);
    const listed = runtime.listMutationReceipts('telegram');
    const artifactPath = join(dir, 'receipts', 'mutations', `${record.id}.json`);
    const artifact = readFileSync(artifactPath, 'utf8');

    expect(record.usage).toEqual({
      provider: 'control-plane',
      model: 'mutation',
      tokensIn: 0,
      tokensOut: 0,
      estimatedCostUsd: 0,
    });
    expect(record.summary).not.toContain(secretLike);
    expect(record.details).not.toContain(secretLike);
    expect(fetched?.id).toBe(record.id);
    expect(listed[0]?.id).toBe(record.id);
    expect(existsSync(artifactPath)).toBe(true);
    expect(artifact).not.toContain(secretLike);
    expect(runtime.getSecurityAuditFindings().some((event) => event.code === 'redaction_applied')).toBe(true);

    await runtime.close();
  });
});
