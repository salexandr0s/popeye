import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import { describe, expect, it } from 'vitest';

import {
  AgentProfileRecordSchema,
  AuthExchangeResponseSchema,
  ConnectionRecordSchema,
  CsrfTokenResponseSchema,
  DaemonStatusResponseSchema,
  EngineCapabilitiesResponseSchema,
  ExecutionEnvelopeResponseSchema,
  FileRootRecordSchema,
  JobRecordSchema,
  MemoryPromotionResponseSchema,
  ProjectRecordSchema,
  RecallDetailResponseSchema,
  RecallSearchResponseApiSchema,
  ReceiptRecordSchema,
  RunRecordSchema,
  SchedulerStatusResponseSchema,
  SecretRefRecordSchema,
  TaskRecordSchema,
  UsageSummarySchema,
  WorkspaceRecordSchema,
} from '@popeye/contracts';
import { createRuntimeService, initAuthStore, issueCsrfToken } from '@popeye/runtime-core';

import { createControlApi } from './index.js';

function insertMemoryForPromotion(runtime: ReturnType<typeof createRuntimeService>): string {
  const now = new Date().toISOString();
  const memoryId = 'memory-contract-promote';
  runtime.databases.memory
    .prepare('INSERT OR IGNORE INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('ns-promote', 'workspace', 'default', 'Workspace default', now, now);
  runtime.databases.memory
    .prepare(
      `INSERT INTO memory_facts (
        id, namespace_id, scope, classification, source_type, memory_type, fact_kind,
        text, confidence, source_reliability, extraction_confidence, created_at, domain
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(memoryId, 'ns-promote', 'default', 'embeddable', 'compaction_flush', 'semantic', 'event', 'Promoted content', 0.8, 0.8, 0.8, now, 'general');
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

  function createInstructionPreviewEnv() {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-contract-instructions-'));
    chmodSync(dir, 0o700);
    const workspaceRoot = join(dir, 'workspace-a');
    const projectRoot = join(workspaceRoot, 'project-a');
    const otherWorkspaceRoot = join(dir, 'workspace-b');
    const otherProjectRoot = join(otherWorkspaceRoot, 'project-b');
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(otherProjectRoot, { recursive: true });
    writeFileSync(join(workspaceRoot, 'WORKSPACE.md'), 'workspace contract instructions');
    writeFileSync(join(projectRoot, 'PROJECT.md'), 'project contract instructions');
    writeFileSync(join(otherWorkspaceRoot, 'WORKSPACE.md'), 'workspace B instructions');
    writeFileSync(join(otherProjectRoot, 'PROJECT.md'), 'project B instructions');

    const authFile = join(dir, 'auth.json');
    const store = initAuthStore(authFile);
    const runtime = createRuntimeService({
      runtimeDataDir: dir,
      authFile,
      security: { bindHost: '127.0.0.1', bindPort: 3210, redactionPatterns: [] },
      telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, rateLimitWindowSeconds: 60 },
      embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'] },
      memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: false, compactionFlushConfidence: 0.7 },
      engine: { kind: 'fake', command: 'node', args: [] },
      workspaces: [
        {
          id: 'default',
          name: 'Default workspace',
          rootPath: workspaceRoot,
          projects: [{ id: 'proj-1', name: 'Project One', path: projectRoot }],
          heartbeatEnabled: true,
          heartbeatIntervalSeconds: 3600,
        },
        {
          id: 'other',
          name: 'Other workspace',
          rootPath: otherWorkspaceRoot,
          projects: [{ id: 'proj-2', name: 'Project Two', path: otherProjectRoot }],
          heartbeatEnabled: true,
          heartbeatIntervalSeconds: 3600,
        },
      ],
    });
    return { store, runtime };
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

  it('GET /v1/engine/capabilities conforms to EngineCapabilitiesResponseSchema', async () => {
    const { store, runtime } = createTestEnv();
    const app = await createControlApi({ runtime });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/engine/capabilities',
      headers: { authorization: `Bearer ${store.current.token}` },
    });

    expect(response.statusCode).toBe(200);
    const parsed = EngineCapabilitiesResponseSchema.parse(response.json());
    expect(parsed.engineKind).toBe('fake');

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

  it('GET /v1/jobs/:id conforms to JobRecordSchema', async () => {
    const { store, runtime } = createTestEnv();
    const app = await createControlApi({ runtime });
    const created = runtime.createTask({ workspaceId: 'default', projectId: null, title: 'job-contract', prompt: 'hello', source: 'manual', autoEnqueue: true });

    const response = await app.inject({
      method: 'GET',
      url: `/v1/jobs/${created.job!.id}`,
      headers: { authorization: `Bearer ${store.current.token}` },
    });

    expect(response.statusCode).toBe(200);
    JobRecordSchema.parse(response.json());

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

  it('GET /v1/runs/:id/envelope conforms to ExecutionEnvelopeResponseSchema', async () => {
    const { store, runtime } = createTestEnv();
    runtime.startScheduler();
    const created = runtime.createTask({
      workspaceId: 'default',
      projectId: null,
      title: 'envelope-contract',
      prompt: 'hello',
      source: 'manual',
      autoEnqueue: true,
    });
    const terminal = await runtime.waitForJobTerminalState(created.job!.id, 5_000);
    const app = await createControlApi({ runtime });

    const response = await app.inject({
      method: 'GET',
      url: `/v1/runs/${terminal!.run!.id}/envelope`,
      headers: { authorization: `Bearer ${store.current.token}` },
    });

    expect(response.statusCode).toBe(200);
    const parsed = ExecutionEnvelopeResponseSchema.parse(response.json());
    expect(parsed.runId).toBe(terminal!.run!.id);
    expect(parsed.profileId).toBe('default');

    await runtime.close();
    await app.close();
  });

  it('POST /v1/tasks returns invalid_profile for unknown profiles', async () => {
    const { store, runtime } = createTestEnv();
    const app = await createControlApi({ runtime });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: {
        authorization: `Bearer ${store.current.token}`,
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
        'x-popeye-csrf': issueCsrfToken(store),
      },
      payload: {
        workspaceId: 'default',
        projectId: null,
        profileId: 'missing-profile',
        title: 'bad task',
        prompt: 'hello',
        source: 'manual',
        autoEnqueue: false,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual(
      expect.objectContaining({
        error: 'invalid_profile',
      }),
    );

    await runtime.close();
    await app.close();
  });

  it('GET /v1/runs/:id/receipt conforms to ReceiptRecordSchema', async () => {
    const { store, runtime } = createTestEnv();
    const app = await createControlApi({ runtime });
    const created = runtime.createTask({ workspaceId: 'default', projectId: null, title: 'run-receipt-contract', prompt: 'hello', source: 'manual', autoEnqueue: true });
    const terminal = await runtime.waitForJobTerminalState(created.job!.id, 5_000);

    const response = await app.inject({
      method: 'GET',
      url: `/v1/runs/${terminal!.run!.id}/receipt`,
      headers: { authorization: `Bearer ${store.current.token}` },
    });

    expect(response.statusCode).toBe(200);
    const parsed = ReceiptRecordSchema.parse(response.json());
    expect(parsed.runtime?.execution).toEqual(
      expect.objectContaining({
        mode: 'interactive',
        memoryScope: 'workspace',
        recallScope: 'workspace',
      }),
    );
    expect(parsed.runtime?.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: expect.stringMatching(/^engine_/),
          source: 'run_event',
        }),
      ]),
    );

    await runtime.close();
    await app.close();
  });

  it('GET /v1/recall/search and GET /v1/recall/:kind/:id conform to recall schemas', async () => {
    const { store, runtime } = createTestEnv();
    const app = await createControlApi({ runtime });
    const now = new Date().toISOString();

    runtime.databases.app.prepare(
      'INSERT INTO tasks (id, workspace_id, project_id, profile_id, title, prompt, source, status, retry_policy_json, side_effect_profile, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('task-recall-contract', 'default', null, 'default', 'Recall contract', 'noop', 'manual', 'completed', JSON.stringify({ maxAttempts: 1 }), 'read_only', now);
    runtime.databases.app.prepare(
      'INSERT INTO jobs (id, task_id, workspace_id, status, retry_count, available_at, last_run_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('job-recall-contract', 'task-recall-contract', 'default', 'completed', 0, now, 'run-recall-contract', now, now);
    runtime.databases.app.prepare(
      'INSERT INTO runs (id, job_id, task_id, workspace_id, profile_id, session_root_id, engine_session_ref, state, started_at, finished_at, error, iterations_used, parent_run_id, delegation_depth) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('run-recall-contract', 'job-recall-contract', 'task-recall-contract', 'default', 'default', 'session-recall-contract', null, 'completed', now, now, null, null, null, 0);
    runtime.databases.app.prepare(
      'INSERT INTO receipts (id, run_id, job_id, task_id, workspace_id, status, summary, details, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('receipt-recall-contract', 'run-recall-contract', 'job-recall-contract', 'task-recall-contract', 'default', 'failed', 'Recall contract summary', 'Recall contract details mention credentials.', '{}', now);
    runtime.databases.app.prepare(
      'INSERT INTO receipts_fts (receipt_id, run_id, workspace_id, status, summary, details) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('receipt-recall-contract', 'run-recall-contract', 'default', 'failed', 'Recall contract summary', 'Recall contract details mention credentials.');

    const searchResponse = await app.inject({
      method: 'GET',
      url: '/v1/recall/search?q=credentials&workspaceId=default',
      headers: { authorization: `Bearer ${store.current.token}` },
    });
    expect(searchResponse.statusCode).toBe(200);
    const parsedSearch = RecallSearchResponseApiSchema.parse(searchResponse.json());
    expect(parsedSearch.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKind: 'receipt',
          sourceId: 'receipt-recall-contract',
        }),
      ]),
    );

    const detailResponse = await app.inject({
      method: 'GET',
      url: '/v1/recall/receipt/receipt-recall-contract',
      headers: { authorization: `Bearer ${store.current.token}` },
    });
    expect(detailResponse.statusCode).toBe(200);
    const parsedDetail = RecallDetailResponseSchema.parse(detailResponse.json());
    expect(parsedDetail).toMatchObject({
      sourceKind: 'receipt',
      sourceId: 'receipt-recall-contract',
      workspaceId: 'default',
    });

    await runtime.close();
    await app.close();
  });

  it('POST /v1/connections and GET /v1/connections conform to ConnectionRecordSchema[]', async () => {
    const { store, runtime } = createTestEnv();
    const app = await createControlApi({ runtime });
    const csrf = issueCsrfToken(store);
    const secret = runtime.setSecret({
      key: 'proton-token',
      value: 'top-secret-value',
      description: 'Proton test token',
    });

    const created = await app.inject({
      method: 'POST',
      url: '/v1/connections',
      headers: {
        authorization: `Bearer ${store.current.token}`,
        'x-popeye-csrf': csrf,
        'sec-fetch-site': 'same-origin',
      },
      payload: {
        domain: 'email',
        providerKind: 'proton',
        label: 'Contract Proton mailbox',
        secretRefId: secret.id,
      },
    });
    expect(created.statusCode).toBe(200);
    ConnectionRecordSchema.parse(created.json());

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/connections',
      headers: { authorization: `Bearer ${store.current.token}` },
    });
    expect(listed.statusCode).toBe(200);
    z.array(ConnectionRecordSchema).parse(listed.json());

    await runtime.close();
    await app.close();
  });

  it('POST /v1/files/roots conforms to FileRootRecordSchema', async () => {
    const { store, runtime } = createTestEnv();
    const app = await createControlApi({ runtime });
    const csrf = issueCsrfToken(store);
    const externalRoot = mkdtempSync(join(tmpdir(), 'popeye-contract-file-root-'));
    chmodSync(externalRoot, 0o700);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/files/roots',
      headers: {
        authorization: `Bearer ${store.current.token}`,
        'x-popeye-csrf': csrf,
        'sec-fetch-site': 'same-origin',
      },
      payload: {
        workspaceId: 'default',
        label: 'Contract root',
        rootPath: externalRoot,
      },
    });

    expect(response.statusCode).toBe(200);
    FileRootRecordSchema.parse(response.json());

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

  it('POST /v1/auth/exchange conforms to AuthExchangeResponseSchema', async () => {
    const { store, runtime } = createTestEnv();
    const app = await createControlApi({
      runtime,
      validateAuthExchangeNonce: (nonce) => nonce === 'contract-bootstrap-nonce' ? 'accepted' : 'invalid',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/exchange',
      headers: { authorization: `Bearer ${store.current.token}` },
      payload: { nonce: 'contract-bootstrap-nonce' },
    });

    expect(response.statusCode).toBe(200);
    AuthExchangeResponseSchema.parse(response.json());

    await runtime.close();
    await app.close();
  });

  it('POST /v1/secrets conforms to SecretRefRecordSchema', async () => {
    const { store, runtime } = createTestEnv();
    const app = await createControlApi({ runtime });
    const csrf = issueCsrfToken(store);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/secrets',
      headers: {
        authorization: `Bearer ${store.current.token}`,
        'x-popeye-csrf': csrf,
        'sec-fetch-site': 'same-origin',
      },
      payload: { key: 'github-token', value: 'super-secret-token', description: 'GitHub PAT' },
    });

    expect(response.statusCode).toBe(200);
    SecretRefRecordSchema.parse(response.json());

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

  it('GET /v1/profiles conforms to AgentProfileRecord array', async () => {
    const { store, runtime } = createTestEnv();
    const app = await createControlApi({ runtime });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/profiles',
      headers: { authorization: `Bearer ${store.current.token}` },
    });

    expect(response.statusCode).toBe(200);
    const parsed = z.array(AgentProfileRecordSchema).parse(response.json());
    expect(parsed[0]).toMatchObject({
      id: 'default',
      mode: 'interactive',
    });

    await runtime.close();
    await app.close();
  });

  it('GET /v1/profiles/:id conforms to AgentProfileRecordSchema', async () => {
    const { store, runtime } = createTestEnv();
    const app = await createControlApi({ runtime });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/profiles/default',
      headers: { authorization: `Bearer ${store.current.token}` },
    });

    expect(response.statusCode).toBe(200);
    const parsed = AgentProfileRecordSchema.parse(response.json());
    expect(parsed.id).toBe('default');

    await runtime.close();
    await app.close();
  });

  it('GET /v1/instruction-previews/:scope supports optional projectId context', async () => {
    const { store, runtime } = createInstructionPreviewEnv();
    const app = await createControlApi({ runtime });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/instruction-previews/default?projectId=proj-1',
      headers: { authorization: `Bearer ${store.current.token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.compiledText).toContain('workspace contract instructions');
    expect(body.compiledText).toContain('project contract instructions');

    await runtime.close();
    await app.close();
  });

  it('GET /v1/instruction-previews/:scope returns 404 for an unknown workspace', async () => {
    const { store, runtime } = createInstructionPreviewEnv();
    const app = await createControlApi({ runtime });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/instruction-previews/missing?projectId=proj-1',
      headers: { authorization: `Bearer ${store.current.token}` },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });

    await runtime.close();
    await app.close();
  });

  it('GET /v1/instruction-previews/:scope returns 404 for an unknown project', async () => {
    const { store, runtime } = createInstructionPreviewEnv();
    const app = await createControlApi({ runtime });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/instruction-previews/default?projectId=missing-project',
      headers: { authorization: `Bearer ${store.current.token}` },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });

    await runtime.close();
    await app.close();
  });

  it('GET /v1/instruction-previews/:scope returns 400 for a project from another workspace and does not write a snapshot', async () => {
    const { store, runtime } = createInstructionPreviewEnv();
    const app = await createControlApi({ runtime });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/instruction-previews/default?projectId=proj-2',
      headers: { authorization: `Bearer ${store.current.token}` },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_context' });
    const snapshotCount = runtime.databases.app.prepare('SELECT COUNT(*) AS count FROM instruction_snapshots').get() as {
      count: number;
    };
    expect(snapshotCount.count).toBe(0);

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
