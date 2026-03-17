import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import type { CapabilityContext } from '@popeye/contracts';
import { GithubService } from '../github-service.js';
import { GithubSyncService } from '../github-sync.js';
import { getGithubMigrations } from '../migrations.js';
import type { GithubProviderAdapter } from '../providers/adapter-interface.js';

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-capgithub-sync-'));
  const db = new Database(join(dir, 'github.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);');
  const getMigration = db.prepare('SELECT id FROM schema_migrations WHERE id = ?');
  const addMigration = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');
  for (const migration of getGithubMigrations()) {
    if (getMigration.get(migration.id)) continue;
    const tx = db.transaction(() => {
      for (const statement of migration.statements) db.exec(statement);
      addMigration.run(migration.id, new Date().toISOString());
    });
    tx();
  }

  return { db, dir, cleanup: () => db.close() };
}

function makeCtx(): CapabilityContext {
  return {
    appDb: {} as CapabilityContext['appDb'],
    memoryDb: {} as CapabilityContext['appDb'],
    paths: { capabilityStoresDir: '', runtimeDataDir: '', logsDir: '', cacheDir: '' } as CapabilityContext['paths'],
    config: { security: { redactionPatterns: [] } },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    auditCallback: vi.fn(),
    memoryInsert: vi.fn(() => ({ memoryId: 'mem-1', embedded: false })),
    approvalRequest: () => ({ id: 'test', status: 'pending' }),
    contextReleaseRecord: () => ({ id: 'test' }),
    events: { emit: () => {} },
  };
}

function createFakeAdapter(): GithubProviderAdapter {
  return {
    getProfile: async () => ({ username: 'testuser', name: 'Test User', id: 1 }),
    listRepos: async () => [
      {
        id: 100, owner: 'testuser', name: 'my-repo', fullName: 'testuser/my-repo',
        description: 'A repo', isPrivate: false, isFork: false, defaultBranch: 'main',
        language: 'TypeScript', starsCount: 5, openIssuesCount: 2, lastPushedAt: '2025-01-01T00:00:00Z',
      },
    ],
    listPullRequests: async () => [
      {
        number: 1, title: 'Fix bug', bodyPreview: 'Fixes issue #10', author: 'alice',
        state: 'open', isDraft: false, reviewDecision: null, ciStatus: 'success',
        headBranch: 'fix/bug', baseBranch: 'main', additions: 5, deletions: 2, changedFiles: 1,
        labels: ['bug'], requestedReviewers: ['testuser'],
        createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-02T00:00:00Z', mergedAt: null,
      },
    ],
    listIssues: async () => [
      {
        number: 10, title: 'Bug report', bodyPreview: 'Something broken', author: 'bob',
        state: 'open', labels: ['bug'], assignees: ['testuser'], milestone: 'v1.0',
        createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z', closedAt: null,
      },
    ],
    listNotifications: async () => [
      {
        id: 'notif-1', repoFullName: 'testuser/my-repo', subjectTitle: 'New PR',
        subjectType: 'PullRequest', reason: 'review_requested', isUnread: true,
        updatedAt: '2025-01-02T00:00:00Z',
      },
    ],
  };
}

describe('GithubSyncService', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let svc: GithubService;

  beforeEach(() => {
    const setup = setupDb();
    db = setup.db;
    cleanup = setup.cleanup;
    svc = new GithubService(db as unknown as CapabilityContext['appDb']);
  });

  afterEach(() => {
    cleanup();
  });

  it('syncs repos, PRs, issues, and notifications from fake adapter', async () => {
    const acct = svc.registerAccount({ connectionId: 'c1', githubUsername: 'testuser', displayName: 'Test' });
    const ctx = makeCtx();
    const syncSvc = new GithubSyncService(svc, ctx);
    const adapter = createFakeAdapter();

    const result = await syncSvc.syncAccount(acct, adapter);

    expect(result.reposSynced).toBe(1);
    expect(result.prsSynced).toBe(1);
    expect(result.issuesSynced).toBe(1);
    expect(result.notificationsSynced).toBe(1);
    expect(result.errors.length).toBe(0);

    // Verify data stored
    const repos = svc.listRepos(acct.id);
    expect(repos.length).toBe(1);
    expect(repos[0]!.fullName).toBe('testuser/my-repo');

    const prs = svc.listPullRequests(acct.id);
    expect(prs.length).toBe(1);
    expect(prs[0]!.title).toBe('Fix bug');

    const issues = svc.listIssues(acct.id);
    expect(issues.length).toBe(1);
    expect(issues[0]!.isAssignedToMe).toBe(true);

    const notifs = svc.listNotifications(acct.id);
    expect(notifs.length).toBe(1);
  });

  it('emits audit event on success', async () => {
    const acct = svc.registerAccount({ connectionId: 'c1', githubUsername: 'testuser', displayName: 'Test' });
    const ctx = makeCtx();
    const syncSvc = new GithubSyncService(svc, ctx);
    const adapter = createFakeAdapter();

    await syncSvc.syncAccount(acct, adapter);

    expect(ctx.auditCallback).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'github_sync_completed', severity: 'info' }),
    );
  });

  it('derives collaborator memories', async () => {
    const acct = svc.registerAccount({ connectionId: 'c1', githubUsername: 'testuser', displayName: 'Test' });
    const ctx = makeCtx();
    const syncSvc = new GithubSyncService(svc, ctx);

    // Adapter that returns multiple PRs from same author
    const adapter: GithubProviderAdapter = {
      ...createFakeAdapter(),
      listPullRequests: async () => [
        { number: 1, title: 'PR 1', bodyPreview: '', author: 'alice', state: 'open', isDraft: false, reviewDecision: null, ciStatus: null, headBranch: 'a', baseBranch: 'main', additions: 0, deletions: 0, changedFiles: 0, labels: [], requestedReviewers: [], createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z', mergedAt: null },
        { number: 2, title: 'PR 2', bodyPreview: '', author: 'alice', state: 'open', isDraft: false, reviewDecision: null, ciStatus: null, headBranch: 'b', baseBranch: 'main', additions: 0, deletions: 0, changedFiles: 0, labels: [], requestedReviewers: [], createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z', mergedAt: null },
        { number: 3, title: 'PR 3', bodyPreview: '', author: 'alice', state: 'open', isDraft: false, reviewDecision: null, ciStatus: null, headBranch: 'c', baseBranch: 'main', additions: 0, deletions: 0, changedFiles: 0, labels: [], requestedReviewers: [], createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z', mergedAt: null },
      ],
      listIssues: async () => [],
    };

    await syncSvc.syncAccount(acct, adapter);

    // Should have called memoryInsert for 'alice' as a frequent collaborator
    expect(ctx.memoryInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'github',
        sourceRefType: 'github_collaborator',
      }),
    );
  });

  it('emits audit event on adapter failure', async () => {
    const acct = svc.registerAccount({ connectionId: 'c1', githubUsername: 'testuser', displayName: 'Test' });
    const ctx = makeCtx();
    const syncSvc = new GithubSyncService(svc, ctx);

    const failingAdapter: GithubProviderAdapter = {
      getProfile: async () => { throw new Error('gh not found'); },
      listRepos: async () => { throw new Error('gh not found'); },
      listPullRequests: async () => [],
      listIssues: async () => [],
      listNotifications: async () => [],
    };

    const result = await syncSvc.syncAccount(acct, failingAdapter);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(ctx.auditCallback).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'github_sync_failed', severity: 'error' }),
    );
  });
});
