import { chmodSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import type { AppConfig } from '@popeye/contracts';

import { ContextReleaseService } from './context-release-service.js';
import { openRuntimeDatabases } from './database.js';

function makeAppDb(): Database.Database {
  const root = mkdtempSync(join(tmpdir(), 'popeye-ctx-'));
  chmodSync(root, 0o700);
  const authDir = join(root, 'auth');
  mkdirSync(authDir, { recursive: true, mode: 0o700 });
  const config: AppConfig = {
    runtimeDataDir: root,
    authFile: join(authDir, 'auth.json'),
    security: {
      bindHost: '127.0.0.1',
      bindPort: 3210,
      redactionPatterns: [],
      promptScanQuarantinePatterns: [],
      promptScanSanitizePatterns: [],
      useSecureCookies: false,
      tokenRotationDays: 30,
    },
    telegram: {
      enabled: false,
      allowedUserId: undefined,
      maxMessagesPerMinute: 10,
      globalMaxMessagesPerMinute: 30,
      rateLimitWindowSeconds: 60,
      maxConcurrentPreparations: 4,
    },
    embeddings: {
      provider: 'disabled',
      model: 'text-embedding-3-small',
      dimensions: 1536,
      allowedClassifications: ['embeddable'],
    },
    engine: { kind: 'fake', command: 'node', args: [], timeoutMs: 300000, runtimeToolTimeoutMs: 30000 },
    memory: {
      confidenceHalfLifeDays: 30,
      archiveThreshold: 0.1,
      consolidationEnabled: true,
      compactionFlushConfidence: 0.7,
      dailySummaryHour: 2,
      docIndexEnabled: true,
      docIndexIntervalHours: 6,
      budgetAllocation: { enabled: false, minPerType: 1, maxPerType: 10 },
      qualitySweepEnabled: false,
      compactionFanout: 8,
      compactionFreshTailCount: 4,
      compactionMaxLeafTokens: 2000,
      compactionMaxCondensedTokens: 4000,
      compactionMaxRetries: 1,
      expandTokenCap: 8000,
    },
    workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600, projects: [] }],
    approvalPolicy: { rules: [], defaultRiskClass: 'ask', pendingExpiryMinutes: 60 },
    vaults: { restrictedVaultDir: 'vaults', capabilityStoreDir: 'capabilities', backupEncryptedVaults: true },
  };
  const dbs = openRuntimeDatabases(config);
  dbs.memory.close();
  return dbs.app;
}

function makeFixture() {
  const db = makeAppDb();
  const log = { info: () => {}, warn: () => {}, error: () => {} };
  const auditEvents: { eventType: string; details: Record<string, unknown>; severity: string }[] =
    [];
  const auditCallback = (event: {
    eventType: string;
    details: Record<string, unknown>;
    severity: string;
  }) => auditEvents.push(event);
  const svc = new ContextReleaseService(db, log, auditCallback);

  // Insert prerequisite rows for FK: workspace, task, job, run
  db.prepare("INSERT INTO workspaces (id, name, created_at) VALUES ('ws1', 'test', '2024-01-01T00:00:00Z')").run();
  db.prepare("INSERT INTO tasks (id, workspace_id, title, prompt, source, status, retry_policy_json, side_effect_profile, created_at) VALUES ('t1', 'ws1', 'test', 'test', 'api', 'pending', '{}', 'none', '2024-01-01T00:00:00Z')").run();
  db.prepare("INSERT INTO jobs (id, task_id, workspace_id, status, retry_count, available_at, created_at, updated_at) VALUES ('j1', 't1', 'ws1', 'pending', 0, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')").run();
  db.prepare("INSERT INTO session_roots (id, kind, scope, created_at) VALUES ('sr1', 'fresh', 'workspace:ws1', '2024-01-01T00:00:00Z')").run();
  db.prepare("INSERT INTO runs (id, job_id, task_id, workspace_id, session_root_id, state, started_at) VALUES ('run1', 'j1', 't1', 'ws1', 'sr1', 'running', '2024-01-01T00:00:00Z')").run();
  db.prepare("INSERT INTO runs (id, job_id, task_id, workspace_id, session_root_id, state, started_at) VALUES ('run2', 'j1', 't1', 'ws1', 'sr1', 'running', '2024-01-01T00:00:00Z')").run();

  return { db, svc, auditEvents };
}

describe('ContextReleaseService', () => {
  it('recordRelease inserts and returns correct record', () => {
    const { svc } = makeFixture();
    const result = svc.recordRelease({
      domain: 'general',
      sourceRef: 'memory:abc',
      releaseLevel: 'full',
      runId: 'run1',
      tokenEstimate: 100,
    });
    expect(result.id).toBeTruthy();
    expect(result.domain).toBe('general');
    expect(result.sourceRef).toBe('memory:abc');
    expect(result.releaseLevel).toBe('full');
    expect(result.runId).toBe('run1');
    expect(result.tokenEstimate).toBe(100);
    expect(result.redacted).toBe(false);
    expect(result.vaultId).toBeNull();
    expect(result.approvalId).toBeNull();
  });

  it('listReleasesForRun returns only that run releases', () => {
    const { svc } = makeFixture();
    svc.recordRelease({ domain: 'general', sourceRef: 'a', releaseLevel: 'full', runId: 'run1' });
    svc.recordRelease({ domain: 'email', sourceRef: 'b', releaseLevel: 'summary', runId: 'run1' });
    svc.recordRelease({ domain: 'general', sourceRef: 'c', releaseLevel: 'full', runId: 'run2' });

    const run1Releases = svc.listReleasesForRun('run1');
    expect(run1Releases).toHaveLength(2);
    expect(run1Releases[0].sourceRef).toBe('a');
    expect(run1Releases[1].sourceRef).toBe('b');

    const run2Releases = svc.listReleasesForRun('run2');
    expect(run2Releases).toHaveLength(1);
  });

  it('summarizeRunReleases aggregates correctly by domain', () => {
    const { svc } = makeFixture();
    svc.recordRelease({
      domain: 'general',
      sourceRef: 'a',
      releaseLevel: 'full',
      runId: 'run1',
      tokenEstimate: 50,
    });
    svc.recordRelease({
      domain: 'general',
      sourceRef: 'b',
      releaseLevel: 'full',
      runId: 'run1',
      tokenEstimate: 30,
    });
    svc.recordRelease({
      domain: 'email',
      sourceRef: 'c',
      releaseLevel: 'summary',
      runId: 'run1',
      tokenEstimate: 20,
    });

    const summary = svc.summarizeRunReleases('run1');
    expect(summary.totalReleases).toBe(3);
    expect(summary.totalTokenEstimate).toBe(100);
    expect(summary.byDomain['general'].count).toBe(2);
    expect(summary.byDomain['general'].tokens).toBe(80);
    expect(summary.byDomain['email'].count).toBe(1);
    expect(summary.byDomain['email'].tokens).toBe(20);
  });

  it('summarizeRunReleases returns empty for unknown run', () => {
    const { svc } = makeFixture();
    const summary = svc.summarizeRunReleases('nonexistent');
    expect(summary.totalReleases).toBe(0);
    expect(summary.totalTokenEstimate).toBe(0);
    expect(Object.keys(summary.byDomain)).toHaveLength(0);
  });

  it('previewRelease returns correct policy for general domain', () => {
    const { svc } = makeFixture();
    const preview = svc.previewRelease({ domain: 'general', sourceRef: 'test-ref' });
    expect(preview.domain).toBe('general');
    expect(preview.releaseLevel).toBe('full');
    expect(preview.requiresApproval).toBe(false);
    expect(preview.redactionApplied).toBe(false);
  });

  it('previewRelease returns correct policy for finance domain (restricted)', () => {
    const { svc } = makeFixture();
    const preview = svc.previewRelease({ domain: 'finance', sourceRef: 'account-data' });
    expect(preview.domain).toBe('finance');
    expect(preview.releaseLevel).toBe('none');
    expect(preview.requiresApproval).toBe(true);
  });

  it('previewRelease returns correct policy for email domain (summary)', () => {
    const { svc } = makeFixture();
    const preview = svc.previewRelease({ domain: 'email', sourceRef: 'inbox' });
    expect(preview.domain).toBe('email');
    expect(preview.releaseLevel).toBe('summary');
    expect(preview.requiresApproval).toBe(false);
  });

  it('audit events emitted for recordRelease', () => {
    const { svc, auditEvents } = makeFixture();
    svc.recordRelease({
      domain: 'general',
      sourceRef: 'audit-test',
      releaseLevel: 'full',
      runId: 'run1',
    });
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].eventType).toBe('context_released');
    expect(auditEvents[0].details.domain).toBe('general');
    expect(auditEvents[0].details.releaseLevel).toBe('full');
  });

  it('recordRelease with redacted=true stores correctly', () => {
    const { svc } = makeFixture();
    const result = svc.recordRelease({
      domain: 'medical',
      sourceRef: 'patient-data',
      releaseLevel: 'none',
      runId: 'run1',
      redacted: true,
    });
    expect(result.redacted).toBe(true);

    const fetched = svc.listReleasesForRun('run1');
    expect(fetched[0].redacted).toBe(true);
  });

  // B5: Finance/medical context-release approval tiers
  describe('context-release approval tiers for restricted domains', () => {
    it('finance default context release policy is none (restricted)', () => {
      const { svc } = makeFixture();
      const preview = svc.previewRelease({ domain: 'finance', sourceRef: 'account-summary' });
      expect(preview.releaseLevel).toBe('none');
      expect(preview.requiresApproval).toBe(true);
    });

    it('medical default context release policy is none (restricted)', () => {
      const { svc } = makeFixture();
      const preview = svc.previewRelease({ domain: 'medical', sourceRef: 'patient-chart' });
      expect(preview.releaseLevel).toBe('none');
      expect(preview.requiresApproval).toBe(true);
    });

    it('general domain allows full release without approval', () => {
      const { svc } = makeFixture();
      const preview = svc.previewRelease({ domain: 'general', sourceRef: 'notes' });
      expect(preview.releaseLevel).toBe('full');
      expect(preview.requiresApproval).toBe(false);
    });

    it('summary release for non-restricted domain does not require approval', () => {
      const { svc } = makeFixture();
      const preview = svc.previewRelease({ domain: 'email', sourceRef: 'inbox-summary' });
      expect(preview.releaseLevel).toBe('summary');
      expect(preview.requiresApproval).toBe(false);
    });

    it('finance context release records the release level correctly', () => {
      const { svc } = makeFixture();
      // Record a finance release without an approval (no FK constraint issue).
      // In production the approval would exist; here we verify the stored level.
      const result = svc.recordRelease({
        domain: 'finance',
        sourceRef: 'account-data',
        releaseLevel: 'summary',
        runId: 'run1',
        tokenEstimate: 200,
      });
      expect(result.domain).toBe('finance');
      expect(result.releaseLevel).toBe('summary');
      expect(result.approvalId).toBeNull();
      expect(result.tokenEstimate).toBe(200);
    });

    it('medical context release records the release level correctly', () => {
      const { svc } = makeFixture();
      const result = svc.recordRelease({
        domain: 'medical',
        sourceRef: 'patient-data',
        releaseLevel: 'excerpt',
        runId: 'run1',
        tokenEstimate: 150,
        redacted: true,
      });
      expect(result.domain).toBe('medical');
      expect(result.releaseLevel).toBe('excerpt');
      expect(result.approvalId).toBeNull();
      expect(result.redacted).toBe(true);
    });
  });
});
