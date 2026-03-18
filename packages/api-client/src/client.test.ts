import { chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createControlApi } from '@popeye/control-api';
import { createRuntimeService, initAuthStore, readAuthStore } from '@popeye/runtime-core';
import type { AppConfig } from '@popeye/contracts';

import { PopeyeApiClient } from './client.js';

function makeConfig(dir: string): AppConfig {
  const authFile = join(dir, 'config', 'auth.json');
  initAuthStore(authFile);
  return {
    runtimeDataDir: dir,
    authFile,
    security: { bindHost: '127.0.0.1', bindPort: 0, redactionPatterns: [] },
    telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, rateLimitWindowSeconds: 60 },
    embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'] },
    memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
    engine: { kind: 'fake', command: 'node', args: [] },
    workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
  } as AppConfig;
}

describe('PopeyeApiClient', () => {
  it('fetches health and status from a real Fastify instance', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-client-'));
    chmodSync(dir, 0o700);
    const config = makeConfig(dir);
    const runtime = createRuntimeService(config);
    const app = await createControlApi({ runtime });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.addresses()[0];
    const baseUrl = `http://${address.address}:${address.port}`;
    const store = readAuthStore(config.authFile);

    const client = new PopeyeApiClient({ baseUrl, token: store.current.token });
    const health = await client.health();
    expect(health.ok).toBe(true);
    expect(health.startedAt).toBeTruthy();

    const status = await client.status();
    expect(status.ok).toBe(true);
    expect(status.engineKind).toBe('fake');

    const capabilities = await client.engineCapabilities();
    expect(capabilities).toMatchObject({
      engineKind: 'fake',
      hostToolMode: 'none',
    });

    const profiles = await client.listProfiles();
    expect(profiles).toEqual([
      expect.objectContaining({
        id: 'default',
        mode: 'interactive',
      }),
    ]);

    const profile = await client.getProfile('default');
    expect(profile).toMatchObject({
      id: 'default',
      name: 'Default agent profile',
    });

    await runtime.close();
    await app.close();
  });

  it('creates a task through the API client', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-client-task-'));
    chmodSync(dir, 0o700);
    const config = makeConfig(dir);
    const runtime = createRuntimeService(config);
    const app = await createControlApi({ runtime });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.addresses()[0];
    const baseUrl = `http://${address.address}:${address.port}`;
    const store = readAuthStore(config.authFile);

    const client = new PopeyeApiClient({ baseUrl, token: store.current.token });
    const result = await client.createTask({
      workspaceId: 'default',
      projectId: null,
      title: 'test task',
      prompt: 'hello world',
      source: 'manual',
      autoEnqueue: false,
    });

    expect(result.task.title).toBe('test task');
    expect(result.task.prompt).toBe('hello world');
    expect(result.task.profileId).toBe('default');
    expect(result.job).toBeNull();

    await runtime.close();
    await app.close();
  });

  it('fetches a persisted run envelope through the API client', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-client-envelope-'));
    chmodSync(dir, 0o700);
    const config = makeConfig(dir);
    const runtime = createRuntimeService(config);
    runtime.startScheduler();

    const created = runtime.createTask({
      workspaceId: 'default',
      projectId: null,
      title: 'envelope task',
      prompt: 'hello envelope',
      source: 'manual',
      autoEnqueue: true,
    });
    const terminal = await runtime.waitForJobTerminalState(created.job!.id, 5_000);
    expect(terminal?.run?.id).toBeTruthy();

    const app = await createControlApi({ runtime });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.addresses()[0];
    const baseUrl = `http://${address.address}:${address.port}`;
    const store = readAuthStore(config.authFile);

    const client = new PopeyeApiClient({ baseUrl, token: store.current.token });
    const envelope = await client.getRunEnvelope(terminal!.run!.id);
    expect(envelope).toMatchObject({
      runId: terminal!.run!.id,
      profileId: 'default',
      workspaceId: 'default',
      filesystemPolicyClass: 'workspace',
      contextReleasePolicy: 'summary_only',
    });

    await runtime.close();
    await app.close();
  });

  it('handles 401 for invalid token', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-client-auth-'));
    chmodSync(dir, 0o700);
    const config = makeConfig(dir);
    const runtime = createRuntimeService(config);
    const app = await createControlApi({ runtime });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.addresses()[0];
    const baseUrl = `http://${address.address}:${address.port}`;

    const client = new PopeyeApiClient({ baseUrl, token: 'invalid-token-that-is-long-enough' });
    await expect(client.health()).rejects.toThrow('401');

    await runtime.close();
    await app.close();
  });

  it('lists filtered runs and session roots from the control API', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-client-runs-'));
    chmodSync(dir, 0o700);
    const config = makeConfig(dir);
    const runtime = createRuntimeService(config);

    const task = runtime.createTask({
      workspaceId: 'default',
      projectId: null,
      title: 'run-filter-task',
      prompt: 'hello',
      source: 'manual',
      autoEnqueue: true,
    });
    if (!task.job) throw new Error('expected job to be created');

    const now = new Date().toISOString();
    runtime.databases.app
      .prepare('INSERT INTO session_roots (id, kind, scope, created_at) VALUES (?, ?, ?, ?)')
      .run('session-filter', 'scheduled_task', 'workspace:default', now);
    runtime.databases.app
      .prepare(
        'INSERT INTO runs (id, job_id, task_id, workspace_id, session_root_id, engine_session_ref, state, started_at, finished_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'run-failed-filter',
        task.job.id,
        task.task.id,
        'default',
        'session-filter',
        null,
        'failed_final',
        now,
        now,
        'test failure',
      );

    const app = await createControlApi({ runtime });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.addresses()[0];
    const baseUrl = `http://${address.address}:${address.port}`;
    const store = readAuthStore(config.authFile);

    const client = new PopeyeApiClient({ baseUrl, token: store.current.token });
    const failedRuns = await client.listRuns({ state: ['failed_final'] });
    expect(failedRuns).toEqual([
      expect.objectContaining({ id: 'run-failed-filter', state: 'failed_final' }),
    ]);

    const sessions = await client.listSessionRoots();
    expect(Array.isArray(sessions)).toBe(true);

    await runtime.close();
    await app.close();
  });

  it('fetches memory audit/list/show/maintenance through the API client', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-client-memory-'));
    chmodSync(dir, 0o700);
    const config = makeConfig(dir);
    const runtime = createRuntimeService(config);
    const inserted = { id: 'memory-api-client-1' };
    const now = new Date().toISOString();
    runtime.databases.memory
      .prepare(
        'INSERT INTO memories (id, description, classification, source_type, content, confidence, scope, memory_type, dedup_key, last_reinforced_at, archived_at, created_at, source_run_id, source_timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        inserted.id,
        'remember this',
        'internal',
        'curated_memory',
        'semantic note',
        0.9,
        'workspace',
        'semantic',
        null,
        null,
        null,
        now,
        null,
        null,
      );

    const app = await createControlApi({ runtime });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.addresses()[0];
    const baseUrl = `http://${address.address}:${address.port}`;
    const store = readAuthStore(config.authFile);

    const client = new PopeyeApiClient({ baseUrl, token: store.current.token });
    const audit = await client.memoryAudit();
    expect(audit.totalMemories).toBeGreaterThan(0);

    const memories = await client.listMemories({ type: 'semantic', limit: 10 });
    expect(memories).toEqual([expect.objectContaining({ id: inserted.id, memoryType: 'semantic' })]);

    const memory = await client.getMemory(inserted.id);
    expect(memory).toEqual(expect.objectContaining({ id: inserted.id, description: 'remember this' }));

    const maintenance = await client.triggerMemoryMaintenance();
    expect(maintenance).toMatchObject({
      decayed: expect.any(Number),
      archived: expect.any(Number),
      merged: expect.any(Number),
      deduped: expect.any(Number),
    });

    await runtime.close();
    await app.close();
  });
});
