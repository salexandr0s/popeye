import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import type { CapabilityContext } from '@popeye/contracts';
import { EmailService } from '../email-service.js';
import { EmailDigestService } from '../email-digest.js';
import { getEmailMigrations } from '../migrations.js';

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-capemail-digest-'));
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

function makeCtx(db: Database.Database): CapabilityContext {
  return {
    appDb: db,
    memoryDb: db,
    paths: {} as CapabilityContext['paths'],
    config: { security: { redactionPatterns: [] } },
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    auditCallback: () => {},
    memoryInsert: () => ({ memoryId: 'mem-1', embedded: false }),
    approvalRequest: () => ({ id: 'test', status: 'pending' }),
    actionApprovalRequest: () => ({ id: 'test', status: 'pending' }),
    contextReleaseRecord: () => ({ id: 'test' }),
    events: { emit: () => {} },
  };
}

describe('EmailDigestService', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let emailService: EmailService;
  let digestService: EmailDigestService;

  beforeEach(() => {
    const setup = setupDb();
    db = setup.db;
    cleanup = setup.cleanup;
    const dbHandle = db as unknown as CapabilityContext['appDb'];
    const ctx = makeCtx(db);
    emailService = new EmailService(dbHandle);
    digestService = new EmailDigestService(emailService, ctx);
  });

  afterEach(() => {
    cleanup();
  });

  it('generates a digest with unread count', () => {
    const account = emailService.registerAccount({
      connectionId: 'c1', emailAddress: 'user@test.com', displayName: 'User',
    });

    // Add unread threads
    emailService.upsertThread(account.id, {
      gmailThreadId: 't1', subject: 'Unread 1', snippet: '', lastMessageAt: '2024-01-15T10:00:00Z',
      messageCount: 1, labelIds: ['UNREAD'], isUnread: true, isStarred: false,
    });
    emailService.upsertThread(account.id, {
      gmailThreadId: 't2', subject: 'Unread 2', snippet: '', lastMessageAt: '2024-01-15T11:00:00Z',
      messageCount: 1, labelIds: ['UNREAD'], isUnread: true, isStarred: false,
    });
    emailService.upsertThread(account.id, {
      gmailThreadId: 't3', subject: 'Read', snippet: '', lastMessageAt: '2024-01-15T12:00:00Z',
      messageCount: 1, labelIds: [], isUnread: false, isStarred: false,
    });

    const digest = digestService.generateDigest(account, '2024-01-15');
    expect(digest.unreadCount).toBe(2);
    expect(digest.date).toBe('2024-01-15');
    expect(digest.summaryMarkdown).toContain('Unread:** 2');
  });

  it('detects high-signal threads (starred)', () => {
    const account = emailService.registerAccount({
      connectionId: 'c1', emailAddress: 'user@test.com', displayName: 'User',
    });

    emailService.upsertThread(account.id, {
      gmailThreadId: 't1', subject: 'Important starred', snippet: '', lastMessageAt: '2024-01-15T10:00:00Z',
      messageCount: 1, labelIds: ['STARRED'], isUnread: false, isStarred: true,
    });
    emailService.upsertThread(account.id, {
      gmailThreadId: 't2', subject: 'Normal', snippet: '', lastMessageAt: '2024-01-15T11:00:00Z',
      messageCount: 1, labelIds: [], isUnread: false, isStarred: false,
    });

    const digest = digestService.generateDigest(account, '2024-01-15');
    expect(digest.highSignalCount).toBe(1);
    expect(digest.summaryMarkdown).toContain('High-Signal Threads');
    expect(digest.summaryMarkdown).toContain('Important starred');
  });

  it('detects high-signal threads (long threads)', () => {
    const account = emailService.registerAccount({
      connectionId: 'c1', emailAddress: 'user@test.com', displayName: 'User',
    });

    emailService.upsertThread(account.id, {
      gmailThreadId: 't1', subject: 'Long discussion', snippet: '', lastMessageAt: '2024-01-15T10:00:00Z',
      messageCount: 8, labelIds: [], isUnread: false, isStarred: false,
    });

    const digest = digestService.generateDigest(account, '2024-01-15');
    expect(digest.highSignalCount).toBe(1);
    expect(digest.summaryMarkdown).toContain('Long discussion');
    expect(digest.summaryMarkdown).toContain('8 msgs');
  });

  it('detects stale follow-ups', () => {
    const account = emailService.registerAccount({
      connectionId: 'c1', emailAddress: 'user@test.com', displayName: 'User',
    });

    const thread = emailService.upsertThread(account.id, {
      gmailThreadId: 't1', subject: 'Waiting for reply', snippet: '', lastMessageAt: '2024-01-10T10:00:00Z',
      messageCount: 2, labelIds: [], isUnread: false, isStarred: false,
    });

    // User's reply was 5 days ago — should be stale
    emailService.upsertMessage(account.id, thread.id, {
      gmailMessageId: 'm1', from: 'other@test.com', to: ['user@test.com'], cc: [],
      subject: 'Waiting for reply', snippet: 'Question', bodyPreview: 'Can you check this?',
      receivedAt: '2024-01-09T10:00:00Z', sizeEstimate: 100, labelIds: [],
    });
    emailService.upsertMessage(account.id, thread.id, {
      gmailMessageId: 'm2', from: 'user@test.com', to: ['other@test.com'], cc: [],
      subject: 'Re: Waiting for reply', snippet: 'Done', bodyPreview: 'I checked it',
      receivedAt: '2024-01-10T10:00:00Z', sizeEstimate: 100, labelIds: [],
    });

    const digest = digestService.generateDigest(account, '2024-01-15');
    expect(digest.summaryMarkdown).toContain('Stale Follow-ups');
    expect(digest.summaryMarkdown).toContain('Waiting for reply');
  });

  it('stores digest in database', () => {
    const account = emailService.registerAccount({
      connectionId: 'c1', emailAddress: 'user@test.com', displayName: 'User',
    });

    digestService.generateDigest(account, '2024-01-15');

    const stored = emailService.getLatestDigest(account.id);
    expect(stored).not.toBeNull();
    expect(stored!.date).toBe('2024-01-15');
    expect(stored!.accountId).toBe(account.id);
  });
});
