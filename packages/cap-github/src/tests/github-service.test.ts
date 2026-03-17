import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { GithubService } from '../github-service.js';
import { getGithubMigrations } from '../migrations.js';

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-capgithub-'));
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

describe('GithubService', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let svc: GithubService;

  beforeEach(() => {
    const setup = setupDb();
    db = setup.db;
    cleanup = setup.cleanup;
    svc = new GithubService(db as unknown as import('@popeye/contracts').CapabilityContext['appDb']);
  });

  afterEach(() => {
    cleanup();
  });

  // --- Accounts ---

  it('registers and retrieves an account', () => {
    const account = svc.registerAccount({
      connectionId: 'conn-1',
      githubUsername: 'testuser',
      displayName: 'Test User',
    });
    expect(account.githubUsername).toBe('testuser');
    expect(account.displayName).toBe('Test User');
    expect(account.connectionId).toBe('conn-1');
    expect(account.repoCount).toBe(0);

    const fetched = svc.getAccount(account.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.githubUsername).toBe('testuser');
  });

  it('lists accounts', () => {
    svc.registerAccount({ connectionId: 'c1', githubUsername: 'alice', displayName: 'Alice' });
    svc.registerAccount({ connectionId: 'c2', githubUsername: 'bob', displayName: 'Bob' });
    const all = svc.listAccounts();
    expect(all.length).toBe(2);
  });

  it('finds account by connection ID', () => {
    svc.registerAccount({ connectionId: 'conn-x', githubUsername: 'xuser', displayName: 'X' });
    const found = svc.getAccountByConnection('conn-x');
    expect(found).not.toBeNull();
    expect(found!.githubUsername).toBe('xuser');
  });

  it('updates sync cursor', () => {
    const acct = svc.registerAccount({ connectionId: 'c1', githubUsername: 'u1', displayName: 'U1' });
    svc.updateSyncCursor(acct.id, '2025-01-01T00:00:00Z');
    const updated = svc.getAccount(acct.id)!;
    expect(updated.syncCursorSince).toBe('2025-01-01T00:00:00Z');
    expect(updated.lastSyncAt).not.toBeNull();
  });

  // --- Repos ---

  it('upserts and lists repos', () => {
    const acct = svc.registerAccount({ connectionId: 'c1', githubUsername: 'u1', displayName: 'U1' });
    const repo = svc.upsertRepo(acct.id, {
      githubRepoId: 12345,
      owner: 'u1',
      name: 'my-repo',
      fullName: 'u1/my-repo',
      description: 'A test repo',
      isPrivate: false,
      isFork: false,
      defaultBranch: 'main',
      language: 'TypeScript',
      starsCount: 10,
      openIssuesCount: 3,
      lastPushedAt: '2025-01-01T00:00:00Z',
    });
    expect(repo.fullName).toBe('u1/my-repo');
    expect(repo.language).toBe('TypeScript');

    // Upsert again (update)
    const updated = svc.upsertRepo(acct.id, {
      githubRepoId: 12345,
      owner: 'u1',
      name: 'my-repo',
      fullName: 'u1/my-repo',
      description: 'Updated desc',
      isPrivate: false,
      isFork: false,
      defaultBranch: 'main',
      language: 'TypeScript',
      starsCount: 20,
      openIssuesCount: 5,
      lastPushedAt: '2025-02-01T00:00:00Z',
    });
    expect(updated.starsCount).toBe(20);
    expect(updated.description).toBe('Updated desc');

    const all = svc.listRepos(acct.id);
    expect(all.length).toBe(1);
  });

  it('updates repo count', () => {
    const acct = svc.registerAccount({ connectionId: 'c1', githubUsername: 'u1', displayName: 'U1' });
    svc.upsertRepo(acct.id, {
      githubRepoId: 1, owner: 'u1', name: 'r1', fullName: 'u1/r1',
      description: '', isPrivate: false, isFork: false, defaultBranch: 'main',
      language: null, starsCount: 0, openIssuesCount: 0, lastPushedAt: null,
    });
    svc.upsertRepo(acct.id, {
      githubRepoId: 2, owner: 'u1', name: 'r2', fullName: 'u1/r2',
      description: '', isPrivate: false, isFork: false, defaultBranch: 'main',
      language: null, starsCount: 0, openIssuesCount: 0, lastPushedAt: null,
    });
    svc.updateRepoCount(acct.id);
    const updated = svc.getAccount(acct.id)!;
    expect(updated.repoCount).toBe(2);
  });

  // --- Pull Requests ---

  it('upserts and queries pull requests', () => {
    const acct = svc.registerAccount({ connectionId: 'c1', githubUsername: 'u1', displayName: 'U1' });
    const repo = svc.upsertRepo(acct.id, {
      githubRepoId: 1, owner: 'u1', name: 'r1', fullName: 'u1/r1',
      description: '', isPrivate: false, isFork: false, defaultBranch: 'main',
      language: null, starsCount: 0, openIssuesCount: 0, lastPushedAt: null,
    });

    const pr = svc.upsertPullRequest(acct.id, repo.id, {
      githubPrNumber: 42,
      title: 'Fix the thing',
      bodyPreview: 'This fixes the thing',
      author: 'alice',
      state: 'open',
      isDraft: false,
      reviewDecision: 'approved',
      ciStatus: 'success',
      headBranch: 'fix/thing',
      baseBranch: 'main',
      additions: 10,
      deletions: 5,
      changedFiles: 3,
      labels: ['bug'],
      requestedReviewers: ['bob'],
      createdAtGh: '2025-01-01T00:00:00Z',
      updatedAtGh: '2025-01-02T00:00:00Z',
      mergedAt: null,
    });
    expect(pr.title).toBe('Fix the thing');
    expect(pr.state).toBe('open');
    expect(pr.labels).toEqual(['bug']);

    const byNumber = svc.getPullRequestByNumber(acct.id, repo.id, 42);
    expect(byNumber).not.toBeNull();
    expect(byNumber!.githubPrNumber).toBe(42);

    const list = svc.listPullRequests(acct.id, { state: 'open' });
    expect(list.length).toBe(1);

    const reviews = svc.listReviewRequests(acct.id, 'bob');
    expect(reviews.length).toBe(1);
  });

  // --- Issues ---

  it('upserts and queries issues', () => {
    const acct = svc.registerAccount({ connectionId: 'c1', githubUsername: 'u1', displayName: 'U1' });
    const repo = svc.upsertRepo(acct.id, {
      githubRepoId: 1, owner: 'u1', name: 'r1', fullName: 'u1/r1',
      description: '', isPrivate: false, isFork: false, defaultBranch: 'main',
      language: null, starsCount: 0, openIssuesCount: 0, lastPushedAt: null,
    });

    const issue = svc.upsertIssue(acct.id, repo.id, {
      githubIssueNumber: 7,
      title: 'Bug report',
      bodyPreview: 'Something is broken',
      author: 'carol',
      state: 'open',
      labels: ['bug', 'priority'],
      assignees: ['u1'],
      milestone: 'v1.0',
      isAssignedToMe: true,
      isMentioned: false,
      createdAtGh: '2025-01-01T00:00:00Z',
      updatedAtGh: '2025-01-02T00:00:00Z',
      closedAt: null,
    });
    expect(issue.title).toBe('Bug report');
    expect(issue.labels).toEqual(['bug', 'priority']);
    expect(issue.isAssignedToMe).toBe(true);

    const assigned = svc.listAssignedIssues(acct.id);
    expect(assigned.length).toBe(1);
  });

  // --- Notifications ---

  it('upserts and clears notifications', () => {
    const acct = svc.registerAccount({ connectionId: 'c1', githubUsername: 'u1', displayName: 'U1' });

    svc.upsertNotification(acct.id, {
      githubNotificationId: 'notif-1',
      repoFullName: 'u1/r1',
      subjectTitle: 'New PR',
      subjectType: 'PullRequest',
      reason: 'review_requested',
      isUnread: true,
      updatedAtGh: '2025-01-01T00:00:00Z',
    });

    const list = svc.listNotifications(acct.id, { unreadOnly: true });
    expect(list.length).toBe(1);
    expect(list[0]!.subjectTitle).toBe('New PR');

    svc.clearNotifications(acct.id);
    const afterClear = svc.listNotifications(acct.id, { unreadOnly: true });
    expect(afterClear.length).toBe(0);
  });

  // --- Digests ---

  it('inserts and retrieves digests', () => {
    const acct = svc.registerAccount({ connectionId: 'c1', githubUsername: 'u1', displayName: 'U1' });

    const digest = svc.insertDigest({
      accountId: acct.id,
      workspaceId: 'default',
      date: '2025-01-15',
      openPrsCount: 5,
      reviewRequestsCount: 2,
      assignedIssuesCount: 3,
      unreadNotificationsCount: 10,
      summaryMarkdown: '# Digest',
    });
    expect(digest.openPrsCount).toBe(5);

    const latest = svc.getLatestDigest(acct.id);
    expect(latest).not.toBeNull();
    expect(latest!.date).toBe('2025-01-15');

    // Upsert same date
    const updated = svc.insertDigest({
      accountId: acct.id,
      workspaceId: 'default',
      date: '2025-01-15',
      openPrsCount: 6,
      reviewRequestsCount: 3,
      assignedIssuesCount: 4,
      unreadNotificationsCount: 8,
      summaryMarkdown: '# Updated Digest',
    });
    expect(updated.id).toBe(digest.id); // Same ID preserved
    expect(updated.openPrsCount).toBe(6);
  });

  // --- Stats ---

  it('counts open PRs, assigned issues, unread notifications', () => {
    const acct = svc.registerAccount({ connectionId: 'c1', githubUsername: 'u1', displayName: 'U1' });
    const repo = svc.upsertRepo(acct.id, {
      githubRepoId: 1, owner: 'u1', name: 'r1', fullName: 'u1/r1',
      description: '', isPrivate: false, isFork: false, defaultBranch: 'main',
      language: null, starsCount: 0, openIssuesCount: 0, lastPushedAt: null,
    });

    svc.upsertPullRequest(acct.id, repo.id, {
      githubPrNumber: 1, title: 'PR 1', bodyPreview: '', author: 'alice', state: 'open',
      isDraft: false, reviewDecision: null, ciStatus: null, headBranch: 'a', baseBranch: 'main',
      additions: 0, deletions: 0, changedFiles: 0, labels: [], requestedReviewers: ['"u1"'],
      createdAtGh: '2025-01-01T00:00:00Z', updatedAtGh: '2025-01-01T00:00:00Z', mergedAt: null,
    });

    svc.upsertIssue(acct.id, repo.id, {
      githubIssueNumber: 1, title: 'Issue 1', bodyPreview: '', author: 'bob', state: 'open',
      labels: [], assignees: ['u1'], milestone: null, isAssignedToMe: true, isMentioned: false,
      createdAtGh: '2025-01-01T00:00:00Z', updatedAtGh: '2025-01-01T00:00:00Z', closedAt: null,
    });

    svc.upsertNotification(acct.id, {
      githubNotificationId: 'n1', repoFullName: 'u1/r1', subjectTitle: 'Test',
      subjectType: 'Issue', reason: 'assign', isUnread: true, updatedAtGh: '2025-01-01T00:00:00Z',
    });

    expect(svc.getOpenPrCount(acct.id)).toBe(1);
    expect(svc.getAssignedIssueCount(acct.id)).toBe(1);
    expect(svc.getUnreadNotificationCount(acct.id)).toBe(1);
  });

  it('returns null for nonexistent entities', () => {
    expect(svc.getAccount('nope')).toBeNull();
    expect(svc.getRepo('nope')).toBeNull();
    expect(svc.getPullRequest('nope')).toBeNull();
    expect(svc.getIssue('nope')).toBeNull();
    expect(svc.getDigest('nope')).toBeNull();
    expect(svc.getLatestDigest('nope')).toBeNull();
  });
});
