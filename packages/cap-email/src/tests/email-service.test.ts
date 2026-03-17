import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { EmailService } from '../email-service.js';
import { getEmailMigrations } from '../migrations.js';

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-capemail-'));
  const db = new Database(join(dir, 'email.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Apply migrations
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

describe('EmailService', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let svc: EmailService;

  beforeEach(() => {
    const setup = setupDb();
    db = setup.db;
    cleanup = setup.cleanup;
    svc = new EmailService(db as unknown as import('@popeye/contracts').CapabilityContext['appDb']);
  });

  afterEach(() => {
    cleanup();
  });

  // --- Accounts ---

  it('registers and retrieves an account', () => {
    const account = svc.registerAccount({
      connectionId: 'conn-1',
      emailAddress: 'user@example.com',
      displayName: 'Test User',
    });
    expect(account.emailAddress).toBe('user@example.com');
    expect(account.displayName).toBe('Test User');
    expect(account.connectionId).toBe('conn-1');
    expect(account.messageCount).toBe(0);

    const fetched = svc.getAccount(account.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.emailAddress).toBe('user@example.com');
  });

  it('lists accounts', () => {
    svc.registerAccount({ connectionId: 'c1', emailAddress: 'a@test.com', displayName: 'A' });
    svc.registerAccount({ connectionId: 'c2', emailAddress: 'b@test.com', displayName: 'B' });
    const all = svc.listAccounts();
    expect(all.length).toBe(2);
  });

  it('finds account by connection ID', () => {
    svc.registerAccount({ connectionId: 'conn-x', emailAddress: 'x@test.com', displayName: 'X' });
    const found = svc.getAccountByConnection('conn-x');
    expect(found).not.toBeNull();
    expect(found!.emailAddress).toBe('x@test.com');
  });

  // --- Threads ---

  it('upserts and retrieves threads', () => {
    const account = svc.registerAccount({ connectionId: 'c1', emailAddress: 'u@t.com', displayName: 'U' });
    const thread = svc.upsertThread(account.id, {
      gmailThreadId: 'gthread-1',
      subject: 'Test Subject',
      snippet: 'Preview text',
      lastMessageAt: '2024-01-15T10:00:00Z',
      messageCount: 3,
      labelIds: ['INBOX', 'UNREAD'],
      isUnread: true,
      isStarred: false,
    });

    expect(thread.subject).toBe('Test Subject');
    expect(thread.isUnread).toBe(true);
    expect(thread.labelIds).toEqual(['INBOX', 'UNREAD']);

    // Upsert same thread
    const updated = svc.upsertThread(account.id, {
      gmailThreadId: 'gthread-1',
      subject: 'Updated Subject',
      snippet: 'New preview',
      lastMessageAt: '2024-01-15T11:00:00Z',
      messageCount: 4,
      labelIds: ['INBOX'],
      isUnread: false,
      isStarred: true,
    });
    expect(updated.id).toBe(thread.id);
    expect(updated.subject).toBe('Updated Subject');
    expect(updated.isUnread).toBe(false);
    expect(updated.isStarred).toBe(true);
  });

  it('lists threads with unread filter', () => {
    const account = svc.registerAccount({ connectionId: 'c1', emailAddress: 'u@t.com', displayName: 'U' });
    svc.upsertThread(account.id, {
      gmailThreadId: 't1', subject: 'Read', snippet: '', lastMessageAt: '2024-01-01T00:00:00Z',
      messageCount: 1, labelIds: [], isUnread: false, isStarred: false,
    });
    svc.upsertThread(account.id, {
      gmailThreadId: 't2', subject: 'Unread', snippet: '', lastMessageAt: '2024-01-02T00:00:00Z',
      messageCount: 1, labelIds: ['UNREAD'], isUnread: true, isStarred: false,
    });

    const all = svc.listThreads(account.id);
    expect(all.length).toBe(2);

    const unread = svc.listThreads(account.id, { unreadOnly: true });
    expect(unread.length).toBe(1);
    expect(unread[0]!.subject).toBe('Unread');
  });

  // --- Messages ---

  it('upserts and retrieves messages', () => {
    const account = svc.registerAccount({ connectionId: 'c1', emailAddress: 'u@t.com', displayName: 'U' });
    const thread = svc.upsertThread(account.id, {
      gmailThreadId: 'gt1', subject: 'Test', snippet: '', lastMessageAt: '2024-01-01T00:00:00Z',
      messageCount: 1, labelIds: [], isUnread: false, isStarred: false,
    });

    const msg = svc.upsertMessage(account.id, thread.id, {
      gmailMessageId: 'gm1',
      from: 'sender@test.com',
      to: ['user@test.com'],
      cc: ['cc@test.com'],
      subject: 'Test',
      snippet: 'hello',
      bodyPreview: 'Hello world body preview',
      receivedAt: '2024-01-01T00:00:00Z',
      sizeEstimate: 1234,
      labelIds: ['INBOX'],
    });

    expect(msg.from).toBe('sender@test.com');
    expect(msg.to).toEqual(['user@test.com']);
    expect(msg.cc).toEqual(['cc@test.com']);

    const messages = svc.listMessages(thread.id);
    expect(messages.length).toBe(1);
    expect(messages[0]!.gmailMessageId).toBe('gm1');
  });

  // --- Digests ---

  it('inserts and retrieves digests', () => {
    const account = svc.registerAccount({ connectionId: 'c1', emailAddress: 'u@t.com', displayName: 'U' });
    const digest = svc.insertDigest({
      accountId: account.id,
      workspaceId: 'default',
      date: '2024-01-15',
      unreadCount: 5,
      highSignalCount: 2,
      summaryMarkdown: '# Digest\n- 5 unread',
    });

    expect(digest.unreadCount).toBe(5);
    expect(digest.highSignalCount).toBe(2);

    const latest = svc.getLatestDigest(account.id);
    expect(latest).not.toBeNull();
    expect(latest!.date).toBe('2024-01-15');
  });

  // --- Stats ---

  it('counts threads and unread', () => {
    const account = svc.registerAccount({ connectionId: 'c1', emailAddress: 'u@t.com', displayName: 'U' });
    svc.upsertThread(account.id, {
      gmailThreadId: 't1', subject: 'A', snippet: '', lastMessageAt: '2024-01-01T00:00:00Z',
      messageCount: 1, labelIds: [], isUnread: false, isStarred: false,
    });
    svc.upsertThread(account.id, {
      gmailThreadId: 't2', subject: 'B', snippet: '', lastMessageAt: '2024-01-02T00:00:00Z',
      messageCount: 1, labelIds: [], isUnread: true, isStarred: false,
    });

    expect(svc.getThreadCount(account.id)).toBe(2);
    expect(svc.getUnreadCount(account.id)).toBe(1);
  });

  // --- Sync cursor ---

  it('updates sync cursor', () => {
    const account = svc.registerAccount({ connectionId: 'c1', emailAddress: 'u@t.com', displayName: 'U' });
    svc.updateSyncCursor(account.id, 'token-123', 'history-456');

    const updated = svc.getAccount(account.id);
    expect(updated!.syncCursorPageToken).toBe('token-123');
    expect(updated!.syncCursorHistoryId).toBe('history-456');
    expect(updated!.lastSyncAt).not.toBeNull();
  });
});
