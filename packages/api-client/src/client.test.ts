import { chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { PeopleService } from '../../cap-people/src/index.ts';
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

  it('connects Todoist and manages people through the API client', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-client-people-'));
    chmodSync(dir, 0o700);
    const config = makeConfig(dir);
    const runtime = createRuntimeService(config);
    await (runtime as any).capabilityInitPromise;
    const app = await createControlApi({ runtime });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.addresses()[0];
    const baseUrl = `http://${address.address}:${address.port}`;
    const store = readAuthStore(config.authFile);

    const client = new PopeyeApiClient({ baseUrl, token: store.current.token });
    const todoist = await client.connectTodoist({
      apiToken: 'todoist-client-token',
      label: 'Todoist',
      displayName: 'Client Todoist',
      mode: 'read_write',
      syncIntervalSeconds: 900,
    });
    expect(todoist.account.displayName).toBe('Client Todoist');

    const peopleDb = new Database(join(runtime.databases.paths.capabilityStoresDir, 'people.db'));
    const peopleService = new PeopleService(peopleDb as never);
    const projected = peopleService.projectSeed({
      provider: 'email',
      externalId: 'client@example.com',
      displayName: 'Client Person',
      email: 'client@example.com',
    });
    peopleDb.close();

    const listed = await client.listPeople();
    expect(listed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: projected.id,
          canonicalEmail: 'client@example.com',
        }),
      ]),
    );

    const searched = await client.searchPeople('client@example.com', { limit: 10 });
    expect(searched.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ personId: projected.id }),
      ]),
    );

    const updated = await client.updatePerson(projected.id, {
      notes: 'Managed through the API client',
      tags: ['vip'],
    });
    expect(updated).toMatchObject({
      id: projected.id,
      notes: 'Managed through the API client',
      tags: ['vip'],
    });

    const attached = await client.attachPersonIdentity({
      personId: projected.id,
      provider: 'github',
      externalId: 'client-gh',
      handle: 'client-gh',
      requestedBy: 'api-client-test',
    });
    const githubIdentity = attached.identities.find((identity) => identity.provider === 'github');
    expect(githubIdentity).toBeTruthy();

    const detached = await client.detachPersonIdentity(githubIdentity!.id, {
      requestedBy: 'api-client-test',
    });
    expect(detached.id).not.toBe(projected.id);
    expect(detached.githubLogin).toBe('client-gh');

    await runtime.close();
    await app.close();
  });

  it('manages approvals, policy reads, and vault lifecycle through the API client', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-client-policy-'));
    chmodSync(dir, 0o700);
    const config = makeConfig(dir);
    const runtime = createRuntimeService(config);
    const app = await createControlApi({ runtime });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.addresses()[0];
    const baseUrl = `http://${address.address}:${address.port}`;
    const store = readAuthStore(config.authFile);

    const client = new PopeyeApiClient({ baseUrl, token: store.current.token });
    const approval = await client.requestApproval({
      scope: 'vault_open',
      domain: 'general',
      riskClass: 'auto',
      actionKind: 'open_vault',
      resourceScope: 'resource',
      resourceType: 'vault',
      resourceId: 'vault-x',
      requestedBy: 'agent',
    });
    expect(approval.status).toBe('approved');

    const standing = await client.createStandingApproval({
      scope: 'external_write',
      domain: 'todos',
      actionKind: 'write',
      resourceScope: 'resource',
      resourceType: 'todo',
      createdBy: 'api-client-test',
    });
    expect(standing.status).toBe('active');

    const standingList = await client.listStandingApprovals();
    expect(standingList).toEqual([expect.objectContaining({ id: standing.id, actionKind: 'write' })]);

    const revokedStanding = await client.revokeStandingApproval(standing.id, { revokedBy: 'api-client-test' });
    expect(revokedStanding.status).toBe('revoked');

    const grant = await client.createAutomationGrant({
      scope: 'external_write',
      domain: 'todos',
      actionKind: 'write',
      resourceScope: 'resource',
      resourceType: 'todo',
      taskSources: ['schedule'],
      createdBy: 'api-client-test',
    });
    expect(grant.taskSources).toEqual(['schedule']);

    const grants = await client.listAutomationGrants();
    expect(grants).toEqual([expect.objectContaining({ id: grant.id, status: 'active' })]);

    const revokedGrant = await client.revokeAutomationGrant(grant.id, { revokedBy: 'api-client-test' });
    expect(revokedGrant.status).toBe('revoked');

    const policy = await client.getSecurityPolicy();
    expect(policy.domainPolicies.length).toBeGreaterThan(0);
    expect(policy.defaultRiskClass).toBe('ask');
    expect(policy.actionDefaults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: 'external_write', actionKind: 'write', riskClass: 'ask' }),
      ]),
    );

    const createdVault = await client.createVault({ domain: 'general', name: 'ops' });
    expect(createdVault.status).toBe('closed');

    const openedVault = await client.openVault(createdVault.id, { approvalId: approval.id });
    expect(openedVault.status).toBe('open');

    const closedVault = await client.closeVault(createdVault.id);
    expect(closedVault.status).toBe('closed');

    const sealedVault = await client.sealVault(createdVault.id);
    expect(sealedVault.status).toBe('sealed');

    const listedVaults = await client.listVaults();
    expect(listedVaults).toEqual([expect.objectContaining({ id: createdVault.id, status: 'sealed' })]);

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
    // Ensure namespace exists
    runtime.databases.memory
      .prepare('INSERT OR IGNORE INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('ns-1', 'workspace', 'workspace', 'Workspace workspace', now, now);
    runtime.databases.memory
      .prepare(
        `INSERT INTO memory_facts (id, namespace_id, scope, classification, source_type, memory_type, fact_kind, text, confidence, source_reliability, extraction_confidence, created_at, domain)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(inserted.id, 'ns-1', 'workspace', 'internal', 'receipt', 'semantic', 'event', 'semantic note', 0.9, 0.8, 0.8, now, 'general');
    runtime.databases.memory
      .prepare('INSERT INTO memory_facts_fts (fact_id, text) VALUES (?, ?)').run(inserted.id, 'semantic note');

    const app = await createControlApi({ runtime });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.addresses()[0];
    const baseUrl = `http://${address.address}:${address.port}`;
    const store = readAuthStore(config.authFile);

    const client = new PopeyeApiClient({ baseUrl, token: store.current.token });
    const audit = await client.memoryAudit();
    expect(audit.totalMemories).toBeGreaterThan(0);

    const maintenance = await client.triggerMemoryMaintenance();
    expect(maintenance).toMatchObject({
      ttlExpired: expect.any(Number),
      staleMarked: expect.any(Number),
    });

    await runtime.close();
    await app.close();
  });

  it('exercises finance and medical read routes (empty state)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-client-finmed-'));
    chmodSync(dir, 0o700);
    const config = makeConfig(dir);
    const runtime = createRuntimeService(config);
    await (runtime as any).capabilityInitPromise;
    const app = await createControlApi({ runtime });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.addresses()[0];
    const baseUrl = `http://${address.address}:${address.port}`;
    const store = readAuthStore(config.authFile);

    const client = new PopeyeApiClient({ baseUrl, token: store.current.token });

    expect(await client.listFinanceImports()).toEqual([]);
    expect(await client.listFinanceTransactions()).toEqual([]);
    expect(await client.searchFinance('test')).toMatchObject({ query: 'test', results: [] });
    expect(await client.listMedicalImports()).toEqual([]);
    expect(await client.listMedicalAppointments()).toEqual([]);
    expect(await client.searchMedical('test')).toMatchObject({ query: 'test', results: [] });

    await runtime.close();
    await app.close();
  });

  it('creates finance imports and transactions through the API', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-client-finwrite-'));
    chmodSync(dir, 0o700);
    const config = makeConfig(dir);
    const runtime = createRuntimeService(config);
    await (runtime as any).capabilityInitPromise;
    const app = await createControlApi({ runtime });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.addresses()[0];
    const baseUrl = `http://${address.address}:${address.port}`;
    const store = readAuthStore(config.authFile);

    const client = new PopeyeApiClient({ baseUrl, token: store.current.token });

    // Create a finance import
    const imp = await client.createFinanceImport({ vaultId: 'test-vault', fileName: 'test.csv' });
    expect(imp.fileName).toBe('test.csv');
    expect(imp.status).toBe('pending');
    expect(imp.id).toBeTruthy();

    // Insert a transaction
    const tx = await client.insertFinanceTransaction({
      importId: imp.id,
      date: '2025-01-15',
      description: 'Coffee shop',
      amount: -4.50,
      category: 'food',
    });
    expect(tx.description).toBe('Coffee shop');
    expect(tx.amount).toBe(-4.50);
    expect(tx.importId).toBe(imp.id);

    // Update import status
    await client.updateFinanceImportStatus(imp.id, 'completed', 1);
    const updated = await client.getFinanceImport(imp.id);
    expect(updated.status).toBe('completed');
    expect(updated.recordCount).toBe(1);

    // Verify list returns data
    const imports = await client.listFinanceImports();
    expect(imports).toHaveLength(1);
    const transactions = await client.listFinanceTransactions({ importId: imp.id });
    expect(transactions).toHaveLength(1);
    const digest = await client.generateFinanceDigest('2025-01');
    expect(digest.period).toBe('2025-01');
    expect(digest.totalExpenses).toBe(4.5);
    expect(digest.totalIncome).toBe(0);
    expect(await client.getFinanceDigest('2025-01')).toMatchObject({
      id: digest.id,
      period: '2025-01',
    });

    await runtime.close();
    await app.close();
  });

  it('creates medical imports and appointments through the API', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-api-client-medwrite-'));
    chmodSync(dir, 0o700);
    const config = makeConfig(dir);
    const runtime = createRuntimeService(config);
    await (runtime as any).capabilityInitPromise;
    const app = await createControlApi({ runtime });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.addresses()[0];
    const baseUrl = `http://${address.address}:${address.port}`;
    const store = readAuthStore(config.authFile);

    const client = new PopeyeApiClient({ baseUrl, token: store.current.token });

    // Create a medical import
    const imp = await client.createMedicalImport({ vaultId: 'test-vault', fileName: 'scan.pdf' });
    expect(imp.fileName).toBe('scan.pdf');
    expect(imp.status).toBe('pending');

    // Insert an appointment
    const appt = await client.insertMedicalAppointment({
      importId: imp.id,
      date: '2025-02-10',
      provider: 'Dr. Smith',
      specialty: 'cardiology',
    });
    expect(appt.provider).toBe('Dr. Smith');
    expect(appt.specialty).toBe('cardiology');

    // Insert a medication
    const med = await client.insertMedicalMedication({
      importId: imp.id,
      name: 'Aspirin',
      dosage: '81mg',
      frequency: 'daily',
    });
    expect(med.name).toBe('Aspirin');
    expect(med.dosage).toBe('81mg');

    const doc = await client.insertMedicalDocument({
      importId: imp.id,
      fileName: 'scan.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 128,
      redactedSummary: 'Imported medical document',
    });
    expect(doc.fileName).toBe('scan.pdf');
    expect(doc.mimeType).toBe('application/pdf');

    // Update import status
    await client.updateMedicalImportStatus(imp.id, 'completed');
    const updated = await client.getMedicalImport(imp.id);
    expect(updated.status).toBe('completed');

    const digest = await client.generateMedicalDigest('2025-02');
    expect(digest.period).toBe('2025-02');
    expect(digest.appointmentCount).toBe(1);
    expect(digest.activeMedications).toBe(1);

    // Verify lists return data
    expect(await client.listMedicalImports()).toHaveLength(1);
    expect(await client.listMedicalAppointments()).toHaveLength(1);
    expect(await client.listMedicalMedications()).toHaveLength(1);
    expect(await client.listMedicalDocuments()).toHaveLength(1);
    expect(await client.getMedicalDigest('2025-02')).toMatchObject({
      id: digest.id,
      period: '2025-02',
    });

    await runtime.close();
    await app.close();
  });
});
