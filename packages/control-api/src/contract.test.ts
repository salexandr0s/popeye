import { chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import { describe, expect, it } from 'vitest';

import {
  AgentProfileRecordSchema,
  CsrfTokenResponseSchema,
  DaemonStatusResponseSchema,
  JobRecordSchema,
  MemoryPromotionResponseSchema,
  ProjectRecordSchema,
  RunRecordSchema,
  SchedulerStatusResponseSchema,
  TaskRecordSchema,
  UsageSummarySchema,
  WorkspaceRecordSchema,
} from '@popeye/contracts';
import { createRuntimeService, initAuthStore } from '@popeye/runtime-core';

import { createControlApi } from './index.js';

function insertMemoryForPromotion(runtime: ReturnType<typeof createRuntimeService>): string {
  const now = new Date().toISOString();
  const memoryId = 'memory-contract-promote';
  runtime.databases.memory
    .prepare(
      `INSERT INTO memories (
        id, description, classification, source_type, content, confidence, scope, memory_type,
        dedup_key, last_reinforced_at, archived_at, created_at, source_run_id, source_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      memoryId,
      'Promotable memory',
      'embeddable',
      'compaction_flush',
      'Promoted content',
      0.8,
      'default',
      'semantic',
      null,
      null,
      null,
      now,
      'run-promote',
      now,
    );
  return memoryId;
}

describe('API contract tests', () => {
  function createTestEnv() {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-contract-'));
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
    return { dir, authFile, store, runtime };
  }

  it('GET /v1/status conforms to DaemonStatusResponseSchema', async () => {
    const { store, runtime } = createTestEnv();
    const app = await createControlApi({ runtime });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/status',
      headers: { authorization: `Bearer ${store.current.token}` },
    });

    expect(response.statusCode).toBe(200);
    const parsed = DaemonStatusResponseSchema.parse(response.json());
    expect(parsed.ok).toBe(true);

    await runtime.close();
    await app.close();
  });

  it('GET /v1/daemon/scheduler conforms to SchedulerStatusResponseSchema', async () => {
    const { store, runtime } = createTestEnv();
    const app = await createControlApi({ runtime });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/daemon/scheduler',
      headers: { authorization: `Bearer ${store.current.token}` },
    });

    expect(response.statusCode).toBe(200);
    SchedulerStatusResponseSchema.parse(response.json());

    await runtime.close();
    await app.close();
  });

  it('GET /v1/tasks conforms to TaskRecord array', async () => {
    const { store, runtime } = createTestEnv();
    const app = await createControlApi({ runtime });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/tasks',
      headers: { authorization: `Bearer ${store.current.token}` },
    });

    expect(response.statusCode).toBe(200);
    const parsed = z.array(TaskRecordSchema).parse(response.json());
    expect(Array.isArray(parsed)).toBe(true);

    await runtime.close();
    await app.close();
  });

  it('GET /v1/jobs conforms to JobRecord array', async () => {
    const { store, runtime } = createTestEnv();
    const app = await createControlApi({ runtime });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/jobs',
      headers: { authorization: `Bearer ${store.current.token}` },
    });

    expect(response.statusCode).toBe(200);
    z.array(JobRecordSchema).parse(response.json());

    await runtime.close();
    await app.close();
  });

  it('GET /v1/runs conforms to RunRecord array', async () => {
    const { store, runtime } = createTestEnv();
    const app = await createControlApi({ runtime });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/runs',
      headers: { authorization: `Bearer ${store.current.token}` },
    });

    expect(response.statusCode).toBe(200);
    z.array(RunRecordSchema).parse(response.json());

    await runtime.close();
    await app.close();
  });

  it('GET /v1/usage/summary conforms to UsageSummarySchema', async () => {
    const { store, runtime } = createTestEnv();
    const app = await createControlApi({ runtime });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/usage/summary',
      headers: { authorization: `Bearer ${store.current.token}` },
    });

    expect(response.statusCode).toBe(200);
    UsageSummarySchema.parse(response.json());

    await runtime.close();
    await app.close();
  });

  it('GET /v1/security/csrf-token conforms to CsrfTokenResponseSchema', async () => {
    const { store, runtime } = createTestEnv();
    const app = await createControlApi({ runtime });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/security/csrf-token',
      headers: { authorization: `Bearer ${store.current.token}` },
    });

    expect(response.statusCode).toBe(200);
    const parsed = CsrfTokenResponseSchema.parse(response.json());
    expect(parsed.token).toBeTruthy();

    await runtime.close();
    await app.close();
  });

  it('GET /v1/workspaces conforms to WorkspaceRecord array', async () => {
    const { store, runtime } = createTestEnv();
    const app = await createControlApi({ runtime });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/workspaces',
      headers: { authorization: `Bearer ${store.current.token}` },
    });

    expect(response.statusCode).toBe(200);
    const parsed = z.array(WorkspaceRecordSchema).parse(response.json());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0]).toHaveProperty('id');
    expect(parsed[0]).toHaveProperty('name');
    expect(parsed[0]).toHaveProperty('createdAt');

    await runtime.close();
    await app.close();
  });

  it('GET /v1/projects conforms to ProjectRecord array', async () => {
    const { store, runtime } = createTestEnv();
    const app = await createControlApi({ runtime });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { authorization: `Bearer ${store.current.token}` },
    });

    expect(response.statusCode).toBe(200);
    const parsed = z.array(ProjectRecordSchema).parse(response.json());
    expect(Array.isArray(parsed)).toBe(true);

    await runtime.close();
    await app.close();
  });

  it('GET /v1/agent-profiles conforms to AgentProfileRecord array', async () => {
    const { store, runtime } = createTestEnv();
    const app = await createControlApi({ runtime });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/agent-profiles',
      headers: { authorization: `Bearer ${store.current.token}` },
    });

    expect(response.statusCode).toBe(200);
    const parsed = z.array(AgentProfileRecordSchema).parse(response.json());
    expect(Array.isArray(parsed)).toBe(true);

    await runtime.close();
    await app.close();
  });

  it('POST /v1/memory/:id/promote/propose conforms to MemoryPromotionResponseSchema', async () => {
    const { store, runtime } = createTestEnv();
    const app = await createControlApi({ runtime });
    const memoryId = insertMemoryForPromotion(runtime);
    const csrfResponse = await app.inject({
      method: 'GET',
      url: '/v1/security/csrf-token',
      headers: { authorization: `Bearer ${store.current.token}` },
    });
    const csrf = CsrfTokenResponseSchema.parse(csrfResponse.json()).token;

    const response = await app.inject({
      method: 'POST',
      url: `/v1/memory/${memoryId}/promote/propose`,
      headers: { authorization: `Bearer ${store.current.token}`, 'x-popeye-csrf': csrf, 'sec-fetch-site': 'same-origin' },
      payload: { targetPath: join(runtime.databases.paths.memoryDailyDir, 'contract-promoted.md') },
    });

    expect(response.statusCode).toBe(200);
    MemoryPromotionResponseSchema.parse(response.json());

    await runtime.close();
    await app.close();
  });
});
