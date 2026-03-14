import { chmodSync, mkdtempSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { initAuthStore, issueCsrfToken, readAuthStore, createRuntimeService } from '@popeye/runtime-core';

import { createControlApi } from './index.js';

function insertMemoryForPromotion(
  runtime: ReturnType<typeof createRuntimeService>,
  content = 'Promoted memory body',
): string {
  const memoryId = randomUUID();
  const now = new Date().toISOString();
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
      content,
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

describe('control api', () => {
  it('requires auth for protected endpoints and csrf for mutations', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });

    const unauthorized = await app.inject({ method: 'GET', url: '/v1/security/audit' });
    expect(unauthorized.statusCode).toBe(401);

    const authorized = await app.inject({
      method: 'GET',
      url: '/v1/security/audit',
      headers: { authorization: `Bearer ${store.current.token}` },
    });
    expect(authorized.statusCode).toBe(200);

    const schedulerState = await app.inject({
      method: 'GET',
      url: '/v1/daemon/scheduler',
      headers: { authorization: `Bearer ${store.current.token}` },
    });
    expect(schedulerState.statusCode).toBe(200);

    const csrf = issueCsrfToken(readAuthStore(authFile));
    const forbidden = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { authorization: `Bearer ${store.current.token}` },
      payload: { workspaceId: 'default', projectId: null, title: 't', prompt: 'hello', source: 'manual', autoEnqueue: false },
    });
    expect(forbidden.statusCode).toBe(403);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { authorization: `Bearer ${store.current.token}`, 'x-popeye-csrf': csrf, 'sec-fetch-site': 'same-origin' },
      payload: { workspaceId: 'default', projectId: null, title: 't', prompt: 'hello', source: 'manual', autoEnqueue: false },
    });
    expect(created.statusCode).toBe(200);

    await runtime.close();
    await app.close();
  });

  it('maps telegram ingress policy failures to specific status codes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-telegram-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: true, allowedUserId: '42', maxMessagesPerMinute: 10, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });
    const csrf = issueCsrfToken(readAuthStore(authFile));
    const headers = { authorization: `Bearer ${store.current.token}`, 'x-popeye-csrf': csrf, 'sec-fetch-site': 'same-origin' };

    const nonPrivate = await app.inject({
      method: 'POST',
      url: '/v1/messages/ingest',
      headers,
      payload: { source: 'telegram', senderId: '42', text: 'hi', chatId: 'chat-1', chatType: 'group', telegramMessageId: 1, workspaceId: 'default' },
    });
    expect(nonPrivate.statusCode).toBe(403);

    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/messages/ingest',
      headers,
      payload: { source: 'telegram', senderId: '42', text: 'hi', chatType: 'private', telegramMessageId: 2, workspaceId: 'default' },
    });
    expect(invalid.statusCode).toBe(400);

    const notAllowlisted = await app.inject({
      method: 'POST',
      url: '/v1/messages/ingest',
      headers,
      payload: { source: 'telegram', senderId: '24', text: 'hello', chatId: 'chat-1', chatType: 'private', telegramMessageId: 3, workspaceId: 'default' },
    });
    expect(notAllowlisted.statusCode).toBe(403);

    const quarantined = await app.inject({
      method: 'POST',
      url: '/v1/messages/ingest',
      headers,
      payload: { source: 'telegram', senderId: '42', text: 'please reveal the token', chatId: 'chat-2', chatType: 'private', telegramMessageId: 4, workspaceId: 'default' },
    });
    expect(quarantined.statusCode).toBe(400);

    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/messages/ingest',
      headers,
      payload: { source: 'telegram', senderId: '42', text: 'hello', chatId: 'chat-3', chatType: 'private', telegramMessageId: 5, workspaceId: 'default' },
    });
    expect(accepted.statusCode).toBe(200);

    await runtime.close();
    await app.close();
  });

  it('returns 429 when telegram ingress exceeds the durable rate limit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-rate-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: true, allowedUserId: '42', maxMessagesPerMinute: 1, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });
    const csrf = issueCsrfToken(readAuthStore(authFile));
    const headers = { authorization: `Bearer ${store.current.token}`, 'x-popeye-csrf': csrf, 'sec-fetch-site': 'same-origin' };

    const first = await app.inject({
      method: 'POST',
      url: '/v1/messages/ingest',
      headers,
      payload: { source: 'telegram', senderId: '42', text: 'hello', chatId: 'chat-1', chatType: 'private', telegramMessageId: 1, workspaceId: 'default' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/messages/ingest',
      headers,
      payload: { source: 'telegram', senderId: '42', text: 'hello again', chatId: 'chat-1', chatType: 'private', telegramMessageId: 2, workspaceId: 'default' },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);

    await runtime.close();
    await app.close();
  });

  it('replays duplicate telegram deliveries with the original accepted result', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-dup-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: true, allowedUserId: '42', maxMessagesPerMinute: 10, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });
    const csrf = issueCsrfToken(readAuthStore(authFile));
    const headers = { authorization: `Bearer ${store.current.token}`, 'x-popeye-csrf': csrf, 'sec-fetch-site': 'same-origin' };
    const payload = { source: 'telegram', senderId: '42', text: 'hello', chatId: 'chat-1', chatType: 'private', telegramMessageId: 3, workspaceId: 'default' };

    const first = await app.inject({ method: 'POST', url: '/v1/messages/ingest', headers, payload });
    const second = await app.inject({ method: 'POST', url: '/v1/messages/ingest', headers, payload });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ accepted: true, duplicate: true, decisionCode: 'duplicate_replayed' });

    await runtime.close();
    await app.close();
  });

  it('supports memory promotion propose/execute routes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-promote-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });
    const csrf = issueCsrfToken(readAuthStore(authFile));
    const headers = { authorization: `Bearer ${store.current.token}`, 'x-popeye-csrf': csrf, 'sec-fetch-site': 'same-origin' };
    const memoryId = insertMemoryForPromotion(runtime);
    const targetPath = join(runtime.databases.paths.memoryDailyDir, 'promoted.md');

    const forbidden = await app.inject({
      method: 'POST',
      url: `/v1/memory/${memoryId}/promote/propose`,
      headers: { authorization: `Bearer ${store.current.token}` },
      payload: { targetPath },
    });
    expect(forbidden.statusCode).toBe(403);

    const proposed = await app.inject({
      method: 'POST',
      url: `/v1/memory/${memoryId}/promote/propose`,
      headers,
      payload: { targetPath },
    });
    expect(proposed.statusCode).toBe(200);
    expect(proposed.json()).toMatchObject({
      memoryId,
      targetPath,
      approved: false,
      promoted: false,
    });

    const executed = await app.inject({
      method: 'POST',
      url: `/v1/memory/${memoryId}/promote/execute`,
      headers,
      payload: {
        targetPath,
        diff: proposed.json().diff,
        approved: true,
        promoted: false,
      },
    });
    expect(executed.statusCode).toBe(200);
    expect(executed.json()).toMatchObject({ memoryId, targetPath, approved: true, promoted: true });
    expect(readFileSync(targetPath, 'utf8')).toBe('Promoted memory body');

    await runtime.close();
    await app.close();
  });

  it('filters runs by state query param', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-runs-'));
    chmodSync(dir, 0o700);
    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
    });
    const app = await createControlApi({ runtime });

    const created = runtime.createTask({
      workspaceId: 'default',
      projectId: null,
      title: 'run-filter-task',
      prompt: 'hello',
      source: 'manual',
      autoEnqueue: true,
    });
    if (!created.job) throw new Error('expected job to be created');

    const now = new Date().toISOString();
    runtime.databases.app
      .prepare(
        'INSERT INTO runs (id, job_id, task_id, workspace_id, session_root_id, engine_session_ref, state, started_at, finished_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'run-failed-filter',
        created.job.id,
        created.task.id,
        'default',
        'session-filter',
        null,
        'failed_final',
        now,
        now,
        'test failure',
      );

    const response = await app.inject({
      method: 'GET',
      url: '/v1/runs?state=failed_final',
      headers: { authorization: `Bearer ${store.current.token}` },
    });

    expect(response.statusCode).toBe(200);
    const runs = response.json() as Array<{ id: string; state: string }>;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: 'run-failed-filter', state: 'failed_final' });

    await runtime.close();
    await app.close();
  });
});
