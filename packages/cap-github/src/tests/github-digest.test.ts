import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import type { CapabilityContext } from '@popeye/contracts';
import { GithubService } from '../github-service.js';
import { GithubDigestService } from '../github-digest.js';
import { getGithubMigrations } from '../migrations.js';

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-capgithub-digest-'));
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
    actionApprovalRequest: () => ({ id: 'test', status: 'pending' }),
    contextReleaseRecord: () => ({ id: 'test' }),
    events: { emit: () => {} },
  };
}

describe('GithubDigestService', () => {
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

  it('generates digest with summary counts', () => {
    const acct = svc.registerAccount({ connectionId: 'c1', githubUsername: 'testuser', displayName: 'Test' });
    const repo = svc.upsertRepo(acct.id, {
      githubRepoId: 1, owner: 'testuser', name: 'r1', fullName: 'testuser/r1',
      description: '', isPrivate: false, isFork: false, defaultBranch: 'main',
      language: null, starsCount: 0, openIssuesCount: 0, lastPushedAt: null,
    });

    // Add an open PR with review request
    svc.upsertPullRequest(acct.id, repo.id, {
      githubPrNumber: 1, title: 'Needs review', bodyPreview: '', author: 'alice', state: 'open',
      isDraft: false, reviewDecision: null, ciStatus: null, headBranch: 'a', baseBranch: 'main',
      additions: 0, deletions: 0, changedFiles: 0, labels: [],
      requestedReviewers: ['testuser'],
      createdAtGh: '2025-01-01T00:00:00Z', updatedAtGh: '2025-01-01T00:00:00Z', mergedAt: null,
    });

    // Add an assigned issue
    svc.upsertIssue(acct.id, repo.id, {
      githubIssueNumber: 1, title: 'Fix me', bodyPreview: '', author: 'bob', state: 'open',
      labels: ['bug'], assignees: ['testuser'], milestone: null, isAssignedToMe: true, isMentioned: false,
      createdAtGh: '2025-01-01T00:00:00Z', updatedAtGh: '2025-01-01T00:00:00Z', closedAt: null,
    });

    // Add unread notification
    svc.upsertNotification(acct.id, {
      githubNotificationId: 'n1', repoFullName: 'testuser/r1', subjectTitle: 'PR assigned',
      subjectType: 'PullRequest', reason: 'review_requested', isUnread: true,
      updatedAtGh: '2025-01-01T00:00:00Z',
    });

    const ctx = makeCtx();
    const digestSvc = new GithubDigestService(svc, ctx);
    const digest = digestSvc.generateDigest(acct, '2025-01-15');

    expect(digest.openPrsCount).toBe(1);
    expect(digest.reviewRequestsCount).toBe(1);
    expect(digest.assignedIssuesCount).toBe(1);
    expect(digest.unreadNotificationsCount).toBe(1);
    expect(digest.summaryMarkdown).toContain('GitHub Digest');
    expect(digest.summaryMarkdown).toContain('Review Requests');
    expect(digest.summaryMarkdown).toContain('Assigned Issues');
  });

  it('includes CI failures section', () => {
    const acct = svc.registerAccount({ connectionId: 'c1', githubUsername: 'testuser', displayName: 'Test' });
    const repo = svc.upsertRepo(acct.id, {
      githubRepoId: 1, owner: 'testuser', name: 'r1', fullName: 'testuser/r1',
      description: '', isPrivate: false, isFork: false, defaultBranch: 'main',
      language: null, starsCount: 0, openIssuesCount: 0, lastPushedAt: null,
    });

    svc.upsertPullRequest(acct.id, repo.id, {
      githubPrNumber: 1, title: 'Failing CI', bodyPreview: '', author: 'testuser', state: 'open',
      isDraft: false, reviewDecision: null, ciStatus: 'failure', headBranch: 'broken', baseBranch: 'main',
      additions: 0, deletions: 0, changedFiles: 0, labels: [], requestedReviewers: [],
      createdAtGh: '2025-01-01T00:00:00Z', updatedAtGh: '2025-01-01T00:00:00Z', mergedAt: null,
    });

    const ctx = makeCtx();
    const digestSvc = new GithubDigestService(svc, ctx);
    const digest = digestSvc.generateDigest(acct, '2025-01-15');

    expect(digest.summaryMarkdown).toContain('CI Failures');
    expect(digest.summaryMarkdown).toContain('Failing CI');
  });

  it('includes stale PRs section', () => {
    const acct = svc.registerAccount({ connectionId: 'c1', githubUsername: 'testuser', displayName: 'Test' });
    const repo = svc.upsertRepo(acct.id, {
      githubRepoId: 1, owner: 'testuser', name: 'r1', fullName: 'testuser/r1',
      description: '', isPrivate: false, isFork: false, defaultBranch: 'main',
      language: null, starsCount: 0, openIssuesCount: 0, lastPushedAt: null,
    });

    const staleDate = new Date(Date.now() - 10 * 24 * 3600_000).toISOString();
    svc.upsertPullRequest(acct.id, repo.id, {
      githubPrNumber: 1, title: 'Old stale PR', bodyPreview: '', author: 'alice', state: 'open',
      isDraft: false, reviewDecision: null, ciStatus: null, headBranch: 'old', baseBranch: 'main',
      additions: 0, deletions: 0, changedFiles: 0, labels: [], requestedReviewers: [],
      createdAtGh: staleDate, updatedAtGh: staleDate, mergedAt: null,
    });

    const ctx = makeCtx();
    const digestSvc = new GithubDigestService(svc, ctx);
    const digest = digestSvc.generateDigest(acct, '2025-01-15');

    expect(digest.summaryMarkdown).toContain('Stale PRs');
    expect(digest.summaryMarkdown).toContain('Old stale PR');
  });

  it('stores digest in memory and emits audit event', () => {
    const acct = svc.registerAccount({ connectionId: 'c1', githubUsername: 'testuser', displayName: 'Test' });
    const ctx = makeCtx();
    const digestSvc = new GithubDigestService(svc, ctx);
    digestSvc.generateDigest(acct, '2025-01-15');

    expect(ctx.memoryInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'github',
        sourceRefType: 'github_digest',
        dedupKey: expect.stringContaining('github-digest:'),
      }),
    );

    expect(ctx.auditCallback).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'github_digest_generated', severity: 'info' }),
    );
  });

  it('generates empty digest when no data', () => {
    const acct = svc.registerAccount({ connectionId: 'c1', githubUsername: 'testuser', displayName: 'Test' });
    const ctx = makeCtx();
    const digestSvc = new GithubDigestService(svc, ctx);
    const digest = digestSvc.generateDigest(acct, '2025-01-15');

    expect(digest.openPrsCount).toBe(0);
    expect(digest.reviewRequestsCount).toBe(0);
    expect(digest.assignedIssuesCount).toBe(0);
    expect(digest.unreadNotificationsCount).toBe(0);
  });
});
