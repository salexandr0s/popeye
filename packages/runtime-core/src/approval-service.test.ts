import { chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { initAuthStore } from './auth.js';
import { openRuntimeDatabases } from './database.js';
import { ApprovalService } from './approval-service.js';

function makeConfig(dir: string) {
  const authFile = join(dir, 'config', 'auth.json');
  initAuthStore(authFile);
  return {
    runtimeDataDir: dir,
    authFile,
    security: { bindHost: '127.0.0.1' as const, bindPort: 3210, redactionPatterns: [] },
    telegram: { enabled: false, allowedUserId: undefined, maxMessagesPerMinute: 10, globalMaxMessagesPerMinute: 30, rateLimitWindowSeconds: 60 },
    embeddings: { provider: 'disabled' as const, allowedClassifications: ['embeddable' as const], model: 'text-embedding-3-small', dimensions: 1536 },
    memory: { confidenceHalfLifeDays: 30, archiveThreshold: 0.1, dailySummaryHour: 23, consolidationEnabled: true, compactionFlushConfidence: 0.7 },
    engine: { kind: 'fake' as const, command: 'node', args: [] },
    workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
  };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-approval-'));
  chmodSync(dir, 0o700);
  const config = makeConfig(dir);
  const databases = openRuntimeDatabases(config);
  const auditEvents: Array<{ eventType: string; details: Record<string, unknown>; severity: string }> = [];
  const emittedEvents: Array<{ event: string; data: unknown }> = [];
  const log = {
    info: (..._args: unknown[]) => {},
    warn: (..._args: unknown[]) => {},
    error: (..._args: unknown[]) => {},
  };
  const service = new ApprovalService(
    databases.app,
    log,
    (event) => { auditEvents.push(event); },
    (event, data) => { emittedEvents.push({ event, data }); },
    { pendingExpiryMinutes: 60 },
  );
  return { databases, service, auditEvents, emittedEvents, dir };
}

function seedRunContext(appDb: ReturnType<typeof openRuntimeDatabases>['app'], input?: { workspaceId?: string; taskSource?: 'manual' | 'heartbeat' | 'schedule' | 'telegram' | 'api' }) {
  const now = new Date().toISOString();
  const workspaceId = input?.workspaceId ?? 'default';
  const taskSource = input?.taskSource ?? 'schedule';
  appDb.prepare('INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES (?, ?, ?)').run(workspaceId, 'Default workspace', now);
  appDb.prepare('INSERT OR IGNORE INTO agent_profiles (id, name, created_at) VALUES (?, ?, ?)').run('default', 'Default profile', now);
  appDb.prepare(
    'INSERT INTO tasks (id, workspace_id, project_id, profile_id, title, prompt, source, status, retry_policy_json, side_effect_profile, coalesce_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    'job-automation-task',
    workspaceId,
    null,
    'default',
    'automation task',
    'do work',
    taskSource,
    'active',
    JSON.stringify({ maxAttempts: 3, baseDelaySeconds: 5, multiplier: 2, maxDelaySeconds: 900 }),
    'read_only',
    null,
    now,
  );
  appDb.prepare(
    'INSERT INTO jobs (id, task_id, workspace_id, status, retry_count, available_at, last_run_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('job-automation', 'job-automation-task', workspaceId, 'running', 0, now, 'run-automation', now, now);
  appDb.prepare(
    'INSERT INTO runs (id, job_id, task_id, workspace_id, profile_id, session_root_id, engine_session_ref, state, started_at, finished_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('run-automation', 'job-automation', 'job-automation-task', workspaceId, 'default', 'session-automation', null, 'running', now, null, null);
  return { runId: 'run-automation' };
}

describe('ApprovalService', () => {
  it('request creates pending approval', () => {
    const { databases, service } = setup();
    try {
      const approval = service.requestApproval({
        scope: 'secret_access',
        domain: 'general',
        riskClass: 'ask',
        resourceType: 'secret',
        resourceId: 'secret-1',
        requestedBy: 'agent-1',
      });

      expect(approval.id).toBeDefined();
      expect(approval.status).toBe('pending');
      expect(approval.scope).toBe('secret_access');
      expect(approval.domain).toBe('general');
      expect(approval.riskClass).toBe('ask');
      expect(approval.resourceType).toBe('secret');
      expect(approval.resourceId).toBe('secret-1');
      expect(approval.requestedBy).toBe('agent-1');
      expect(approval.createdAt).toBeDefined();
      expect(approval.expiresAt).toBeDefined();
    } finally {
      databases.app.close();
      databases.memory.close();
    }
  });

  it('request with riskClass ask creates linked intervention', () => {
    const { databases, service } = setup();
    try {
      const approval = service.requestApproval({
        scope: 'vault_open',
        domain: 'email',
        riskClass: 'ask',
        resourceType: 'vault',
        resourceId: 'vault-1',
        requestedBy: 'agent-1',
      });

      expect(approval.interventionId).not.toBeNull();

      const intervention = databases.app
        .prepare('SELECT * FROM interventions WHERE id = ?')
        .get(approval.interventionId!) as Record<string, unknown>;
      expect(intervention['status']).toBe('pending');
      expect(intervention['code']).toBe('needs_policy_decision');
      expect((intervention['reason'] as string)).toContain('vault_open');
    } finally {
      databases.app.close();
      databases.memory.close();
    }
  });

  it('request with riskClass auto auto-approves', () => {
    const { databases, service } = setup();
    try {
      const approval = service.requestApproval({
        scope: 'secret_access',
        domain: 'general',
        riskClass: 'auto',
        resourceType: 'secret',
        resourceId: 'secret-1',
        requestedBy: 'agent-1',
      });

      expect(approval.status).toBe('approved');
      expect(approval.resolvedBy).toBe('policy');
      expect(approval.decisionReason).toBe('Auto-approved by policy');
      expect(approval.resolvedAt).toBeDefined();
    } finally {
      databases.app.close();
      databases.memory.close();
    }
  });

  it('resolve approved updates status and resolves intervention', () => {
    const { databases, service } = setup();
    try {
      const approval = service.requestApproval({
        scope: 'secret_access',
        domain: 'general',
        riskClass: 'ask',
        resourceType: 'secret',
        resourceId: 'secret-1',
        requestedBy: 'agent-1',
      });

      const resolved = service.resolveApproval(approval.id, {
        decision: 'approved',
        decisionReason: 'Operator approved',
      });

      expect(resolved.status).toBe('approved');
      expect(resolved.resolvedBy).toBe('operator');
      expect(resolved.decisionReason).toBe('Operator approved');
      expect(resolved.resolvedAt).not.toBeNull();

      // Check linked intervention was resolved
      const intervention = databases.app
        .prepare('SELECT * FROM interventions WHERE id = ?')
        .get(approval.interventionId!) as Record<string, unknown>;
      expect(intervention['status']).toBe('resolved');
      expect(intervention['resolution_note']).toContain('approved');
    } finally {
      databases.app.close();
      databases.memory.close();
    }
  });

  it('resolve denied updates status', () => {
    const { databases, service } = setup();
    try {
      const approval = service.requestApproval({
        scope: 'context_release',
        domain: 'finance',
        riskClass: 'ask',
        resourceType: 'context',
        resourceId: 'ctx-1',
        requestedBy: 'agent-1',
      });

      const resolved = service.resolveApproval(approval.id, {
        decision: 'denied',
        decisionReason: 'Too risky',
      });

      expect(resolved.status).toBe('denied');
      expect(resolved.resolvedBy).toBe('operator');
    } finally {
      databases.app.close();
      databases.memory.close();
    }
  });

  it('double-resolve throws error', () => {
    const { databases, service } = setup();
    try {
      const approval = service.requestApproval({
        scope: 'secret_access',
        domain: 'general',
        riskClass: 'ask',
        resourceType: 'secret',
        resourceId: 'secret-1',
        requestedBy: 'agent-1',
      });

      service.resolveApproval(approval.id, { decision: 'approved' });

      expect(() => {
        service.resolveApproval(approval.id, { decision: 'denied' });
      }).toThrow(/already resolved/);
    } finally {
      databases.app.close();
      databases.memory.close();
    }
  });

  it('expiration sweep marks stale approvals as expired', () => {
    const { databases, service } = setup();
    try {
      // Insert an approval that has already expired
      const pastDate = new Date(Date.now() - 3600_000).toISOString();
      service.requestApproval({
        scope: 'secret_access',
        domain: 'general',
        riskClass: 'ask',
        resourceType: 'secret',
        resourceId: 'stale-1',
        requestedBy: 'agent-1',
        expiresAt: pastDate,
      });

      // Non-expired approval
      service.requestApproval({
        scope: 'secret_access',
        domain: 'general',
        riskClass: 'ask',
        resourceType: 'secret',
        resourceId: 'fresh-1',
        requestedBy: 'agent-1',
      });

      const expiredCount = service.expireStaleApprovals();
      expect(expiredCount).toBe(1);

      const all = service.listApprovals();
      const expired = all.filter((a) => a.status === 'expired');
      const pending = all.filter((a) => a.status === 'pending');
      expect(expired).toHaveLength(1);
      expect(pending).toHaveLength(1);
      expect(expired[0].resolvedBy).toBe('expiry');
    } finally {
      databases.app.close();
      databases.memory.close();
    }
  });

  it('idempotency key returns existing approval', () => {
    const { databases, service } = setup();
    try {
      const first = service.requestApproval({
        scope: 'secret_access',
        domain: 'general',
        riskClass: 'ask',
        resourceType: 'secret',
        resourceId: 'secret-1',
        requestedBy: 'agent-1',
        idempotencyKey: 'idem-key-1',
      });

      const second = service.requestApproval({
        scope: 'secret_access',
        domain: 'general',
        riskClass: 'ask',
        resourceType: 'secret',
        resourceId: 'secret-1',
        requestedBy: 'agent-1',
        idempotencyKey: 'idem-key-1',
      });

      expect(second.id).toBe(first.id);

      // Only one approval should exist
      const all = service.listApprovals();
      expect(all).toHaveLength(1);
    } finally {
      databases.app.close();
      databases.memory.close();
    }
  });

  it('list filters by status, domain, scope', () => {
    const { databases, service } = setup();
    try {
      service.requestApproval({
        scope: 'secret_access',
        domain: 'general',
        riskClass: 'auto',
        resourceType: 'secret',
        resourceId: 's-1',
        requestedBy: 'a',
      });
      service.requestApproval({
        scope: 'vault_open',
        domain: 'email',
        riskClass: 'ask',
        resourceType: 'vault',
        resourceId: 'v-1',
        requestedBy: 'a',
      });
      service.requestApproval({
        scope: 'secret_access',
        domain: 'email',
        riskClass: 'ask',
        resourceType: 'secret',
        resourceId: 's-2',
        requestedBy: 'a',
      });

      const byStatus = service.listApprovals({ status: 'approved' });
      expect(byStatus).toHaveLength(1);
      expect(byStatus[0].scope).toBe('secret_access');

      const byDomain = service.listApprovals({ domain: 'email' });
      expect(byDomain).toHaveLength(2);

      const byScope = service.listApprovals({ scope: 'vault_open' });
      expect(byScope).toHaveLength(1);

      const combined = service.listApprovals({ domain: 'email', scope: 'secret_access' });
      expect(combined).toHaveLength(1);
    } finally {
      databases.app.close();
      databases.memory.close();
    }
  });

  it('hasActiveApproval returns correct results', () => {
    const { databases, service } = setup();
    try {
      expect(service.hasActiveApproval('secret_access', 'secret', 'x')).toBe(false);

      service.requestApproval({
        scope: 'secret_access',
        domain: 'general',
        riskClass: 'ask',
        resourceType: 'secret',
        resourceId: 'x',
        requestedBy: 'a',
      });

      expect(service.hasActiveApproval('secret_access', 'secret', 'x')).toBe(true);
      expect(service.hasActiveApproval('vault_open', 'secret', 'x')).toBe(false);
    } finally {
      databases.app.close();
      databases.memory.close();
    }
  });

  it('all operations emit audit events', () => {
    const { databases, service, auditEvents } = setup();
    try {
      const approval = service.requestApproval({
        scope: 'secret_access',
        domain: 'general',
        riskClass: 'ask',
        resourceType: 'secret',
        resourceId: 'secret-1',
        requestedBy: 'agent-1',
      });
      expect(auditEvents.some((e) => e.eventType === 'approval_requested')).toBe(true);

      service.resolveApproval(approval.id, { decision: 'approved' });
      expect(auditEvents.some((e) => e.eventType === 'approval_resolved')).toBe(true);
    } finally {
      databases.app.close();
      databases.memory.close();
    }
  });

  it('all operations emit runtime events via emitCallback', () => {
    const { databases, service, emittedEvents } = setup();
    try {
      const approval = service.requestApproval({
        scope: 'secret_access',
        domain: 'general',
        riskClass: 'ask',
        resourceType: 'secret',
        resourceId: 'secret-1',
        requestedBy: 'agent-1',
      });
      expect(emittedEvents.some((e) => e.event === 'approval_requested')).toBe(true);

      service.resolveApproval(approval.id, { decision: 'approved' });
      expect(emittedEvents.some((e) => e.event === 'approval_resolved')).toBe(true);
    } finally {
      databases.app.close();
      databases.memory.close();
    }
  });

  it('getApproval returns null for non-existent id', () => {
    const { databases, service } = setup();
    try {
      expect(service.getApproval('non-existent')).toBeNull();
    } finally {
      databases.app.close();
      databases.memory.close();
    }
  });

  it('getApprovalByIntervention finds approval by intervention id', () => {
    const { databases, service } = setup();
    try {
      const approval = service.requestApproval({
        scope: 'vault_open',
        domain: 'general',
        riskClass: 'ask',
        resourceType: 'vault',
        resourceId: 'v-1',
        requestedBy: 'a',
      });

      const found = service.getApprovalByIntervention(approval.interventionId!);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(approval.id);
    } finally {
      databases.app.close();
      databases.memory.close();
    }
  });

  it('resolve non-existent approval throws', () => {
    const { databases, service } = setup();
    try {
      expect(() => {
        service.resolveApproval('non-existent', { decision: 'approved' });
      }).toThrow(/not found/);
    } finally {
      databases.app.close();
      databases.memory.close();
    }
  });

  it('standing approvals auto-resolve eligible approval requests', () => {
    const { databases, service } = setup();
    try {
      const standing = service.createStandingApproval({
        scope: 'external_write',
        domain: 'todos',
        actionKind: 'write',
        resourceScope: 'resource',
        resourceType: 'todo',
        resourceId: null,
        requestedBy: 'popeye_todo_add',
        workspaceId: null,
        projectId: null,
        note: 'allow todo writes',
        expiresAt: null,
        createdBy: 'operator:test',
      });

      const approval = service.requestApproval({
        scope: 'external_write',
        domain: 'todos',
        riskClass: 'ask',
        actionKind: 'write',
        resourceScope: 'resource',
        resourceType: 'todo',
        resourceId: 'new',
        requestedBy: 'popeye_todo_add',
        standingApprovalEligible: true,
        automationGrantEligible: true,
      });

      expect(approval.status).toBe('approved');
      expect(approval.resolvedBy).toBe('standing_approval');
      expect(approval.resolvedByGrantId).toBe(standing.id);
      expect(approval.decisionReason).toContain(standing.id);
    } finally {
      databases.app.close();
      databases.memory.close();
    }
  });

  it('automation grants auto-resolve eligible automated approvals', () => {
    const { databases, service } = setup();
    try {
      const { runId } = seedRunContext(databases.app, { taskSource: 'schedule' });
      const grant = service.createAutomationGrant({
        scope: 'external_write',
        domain: 'todos',
        actionKind: 'write',
        resourceScope: 'resource',
        resourceType: 'todo',
        resourceId: null,
        requestedBy: 'popeye_todo_complete',
        workspaceId: null,
        projectId: null,
        taskSources: ['schedule'],
        note: 'allow scheduled todo writes',
        expiresAt: null,
        createdBy: 'operator:test',
      });

      const approval = service.requestApproval({
        scope: 'external_write',
        domain: 'todos',
        riskClass: 'ask',
        actionKind: 'write',
        resourceScope: 'resource',
        resourceType: 'todo',
        resourceId: 'todo-1',
        requestedBy: 'popeye_todo_complete',
        runId,
        standingApprovalEligible: false,
        automationGrantEligible: true,
      });

      expect(approval.status).toBe('approved');
      expect(approval.resolvedBy).toBe('automation_grant');
      expect(approval.resolvedByGrantId).toBe(grant.id);
      expect(approval.runId).toBe(runId);
    } finally {
      databases.app.close();
      databases.memory.close();
    }
  });
});
