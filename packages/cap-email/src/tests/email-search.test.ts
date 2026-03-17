import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { EmailService } from '../email-service.js';
import { EmailSearchService } from '../email-search.js';
import { getEmailMigrations } from '../migrations.js';
import type { CapabilityContext } from '@popeye/contracts';

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-capemail-search-'));
  const db = new Database(join(dir, 'email.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);');
  const getMigration = db.prepare('SELECT id FROM schema_migrations WHERE id = ?');
  const addMigration = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');
  for (const migration of getEmailMigrations()) {
    if (getMigration.get(migration.id)) continue;
    const tx = db.transaction(() => {
      for (const statement of migration.statements) db.exec(statement);
      addMigration.run(migration.id, new Date().toISOString());
    });
    tx();
  }

  return { db, dir, cleanup: () => db.close() };
}

describe('EmailSearchService', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let emailService: EmailService;
  let searchService: EmailSearchService;

  beforeEach(() => {
    const setup = setupDb();
    db = setup.db;
    cleanup = setup.cleanup;
    const dbHandle = db as unknown as CapabilityContext['appDb'];
    emailService = new EmailService(dbHandle);
    searchService = new EmailSearchService(dbHandle);
  });

  afterEach(() => {
    cleanup();
  });

  it('finds threads by subject match', () => {
    const account = emailService.registerAccount({
      connectionId: 'c1', emailAddress: 'u@t.com', displayName: 'U',
    });

    emailService.upsertThread(account.id, {
      gmailThreadId: 't1', subject: 'Meeting notes from Monday', snippet: 'Team standup',
      lastMessageAt: '2024-01-15T10:00:00Z', messageCount: 1, labelIds: [], isUnread: false, isStarred: false,
    });
    emailService.upsertThread(account.id, {
      gmailThreadId: 't2', subject: 'Invoice for January', snippet: 'Please review',
      lastMessageAt: '2024-01-16T10:00:00Z', messageCount: 1, labelIds: [], isUnread: false, isStarred: false,
    });
    emailService.upsertThread(account.id, {
      gmailThreadId: 't3', subject: 'Weekly meeting agenda', snippet: 'Topics for discussion',
      lastMessageAt: '2024-01-17T10:00:00Z', messageCount: 1, labelIds: [], isUnread: false, isStarred: false,
    });

    const results = searchService.search({ query: 'meeting', limit: 10 });
    expect(results.results.length).toBe(2);
    expect(results.results.map((r) => r.subject)).toContain('Meeting notes from Monday');
    expect(results.results.map((r) => r.subject)).toContain('Weekly meeting agenda');
  });

  it('filters by account ID', () => {
    const account1 = emailService.registerAccount({
      connectionId: 'c1', emailAddress: 'a@t.com', displayName: 'A',
    });
    const account2 = emailService.registerAccount({
      connectionId: 'c2', emailAddress: 'b@t.com', displayName: 'B',
    });

    emailService.upsertThread(account1.id, {
      gmailThreadId: 't1', subject: 'Project update', snippet: 'Status report',
      lastMessageAt: '2024-01-15T10:00:00Z', messageCount: 1, labelIds: [], isUnread: false, isStarred: false,
    });
    emailService.upsertThread(account2.id, {
      gmailThreadId: 't2', subject: 'Project deadline', snippet: 'Due date',
      lastMessageAt: '2024-01-16T10:00:00Z', messageCount: 1, labelIds: [], isUnread: false, isStarred: false,
    });

    const filtered = searchService.search({ query: 'project', accountId: account1.id, limit: 10 });
    expect(filtered.results.length).toBe(1);
    expect(filtered.results[0]!.subject).toBe('Project update');
  });

  it('returns empty for no matches', () => {
    const account = emailService.registerAccount({
      connectionId: 'c1', emailAddress: 'u@t.com', displayName: 'U',
    });
    emailService.upsertThread(account.id, {
      gmailThreadId: 't1', subject: 'Hello', snippet: 'World',
      lastMessageAt: '2024-01-15T10:00:00Z', messageCount: 1, labelIds: [], isUnread: false, isStarred: false,
    });

    const results = searchService.search({ query: 'nonexistent', limit: 10 });
    expect(results.results.length).toBe(0);
  });

  it('respects limit', () => {
    const account = emailService.registerAccount({
      connectionId: 'c1', emailAddress: 'u@t.com', displayName: 'U',
    });

    for (let i = 0; i < 5; i++) {
      emailService.upsertThread(account.id, {
        gmailThreadId: `t${i}`, subject: `Report #${i}`, snippet: `Report details ${i}`,
        lastMessageAt: `2024-01-${String(15 + i).padStart(2, '0')}T10:00:00Z`,
        messageCount: 1, labelIds: [], isUnread: false, isStarred: false,
      });
    }

    const results = searchService.search({ query: 'report', limit: 3 });
    expect(results.results.length).toBe(3);
  });
});
