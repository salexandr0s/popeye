import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { GithubService } from '../github-service.js';
import { GithubSearchService } from '../github-search.js';
import { getGithubMigrations } from '../migrations.js';

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-capgithub-search-'));
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

describe('GithubSearchService', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let svc: GithubService;
  let searchSvc: GithubSearchService;

  beforeEach(() => {
    const setup = setupDb();
    db = setup.db;
    cleanup = setup.cleanup;
    const dbHandle = db as unknown as import('@popeye/contracts').CapabilityContext['appDb'];
    svc = new GithubService(dbHandle);
    searchSvc = new GithubSearchService(dbHandle);

    // Seed data
    const acct = svc.registerAccount({ connectionId: 'c1', githubUsername: 'u1', displayName: 'U1' });
    const repo = svc.upsertRepo(acct.id, {
      githubRepoId: 1, owner: 'u1', name: 'r1', fullName: 'u1/r1',
      description: '', isPrivate: false, isFork: false, defaultBranch: 'main',
      language: null, starsCount: 0, openIssuesCount: 0, lastPushedAt: null,
    });

    svc.upsertPullRequest(acct.id, repo.id, {
      githubPrNumber: 1, title: 'Fix authentication bug', bodyPreview: 'Auth tokens expire too fast',
      author: 'alice', state: 'open', isDraft: false, reviewDecision: null, ciStatus: null,
      headBranch: 'fix/auth', baseBranch: 'main', additions: 10, deletions: 5, changedFiles: 2,
      labels: [], requestedReviewers: [],
      createdAtGh: '2025-01-01T00:00:00Z', updatedAtGh: '2025-01-02T00:00:00Z', mergedAt: null,
    });

    svc.upsertPullRequest(acct.id, repo.id, {
      githubPrNumber: 2, title: 'Add dashboard widget', bodyPreview: 'New dashboard component',
      author: 'bob', state: 'open', isDraft: false, reviewDecision: null, ciStatus: null,
      headBranch: 'feat/dashboard', baseBranch: 'main', additions: 50, deletions: 0, changedFiles: 5,
      labels: [], requestedReviewers: [],
      createdAtGh: '2025-01-03T00:00:00Z', updatedAtGh: '2025-01-04T00:00:00Z', mergedAt: null,
    });

    svc.upsertIssue(acct.id, repo.id, {
      githubIssueNumber: 10, title: 'Authentication fails on Safari', bodyPreview: 'Users cannot log in on Safari',
      author: 'carol', state: 'open', labels: ['bug'], assignees: [], milestone: null,
      isAssignedToMe: false, isMentioned: false,
      createdAtGh: '2025-01-01T00:00:00Z', updatedAtGh: '2025-01-01T00:00:00Z', closedAt: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('searches PRs by title', () => {
    const result = searchSvc.search({ query: 'authentication', limit: 10 });
    expect(result.results.length).toBeGreaterThanOrEqual(1);
    expect(result.results.some((r) => r.entityType === 'pr')).toBe(true);
  });

  it('searches issues by title', () => {
    const result = searchSvc.search({ query: 'Safari', limit: 10 });
    expect(result.results.length).toBe(1);
    expect(result.results[0]!.entityType).toBe('issue');
  });

  it('searches across both PRs and issues', () => {
    const result = searchSvc.search({ query: 'authentication', limit: 10 });
    const types = new Set(result.results.map((r) => r.entityType));
    expect(types.has('pr')).toBe(true);
    expect(types.has('issue')).toBe(true);
  });

  it('filters by entity type', () => {
    const prOnly = searchSvc.search({ query: 'authentication', entityType: 'pr', limit: 10 });
    expect(prOnly.results.every((r) => r.entityType === 'pr')).toBe(true);

    const issueOnly = searchSvc.search({ query: 'authentication', entityType: 'issue', limit: 10 });
    expect(issueOnly.results.every((r) => r.entityType === 'issue')).toBe(true);
  });

  it('returns empty on no match', () => {
    const result = searchSvc.search({ query: 'nonexistentxyz', limit: 10 });
    expect(result.results.length).toBe(0);
  });

  it('handles malformed FTS queries gracefully', () => {
    const result = searchSvc.search({ query: 'AND OR NOT', limit: 10 });
    // Should not throw — falls back to phrase quoting
    expect(result.results).toBeDefined();
  });
});
