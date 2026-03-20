import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import type { CapabilityContext } from '@popeye/contracts';
import { EmailService } from '../email-service.js';
import { EmailSyncService } from '../email-sync.js';
import { getEmailMigrations } from '../migrations.js';
import type { EmailProviderAdapter, NormalizedThread, NormalizedMessage, HistoryChange } from '../providers/adapter-interface.js';

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-capemail-sync-'));
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
    auditCallback: vi.fn(),
    memoryInsert: vi.fn(() => ({ memoryId: 'mem-1', embedded: false })),
    approvalRequest: () => ({ id: 'test', status: 'pending' }),
    actionApprovalRequest: () => ({ id: 'test', status: 'pending' }),
    contextReleaseRecord: () => ({ id: 'test' }),
    events: { emit: () => {} },
  };
}

function makeMessage(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    messageId: 'msg-1',
    threadId: 'thread-1',
    from: 'sender@test.com',
    to: ['user@test.com'],
    cc: [],
    subject: 'Test Subject',
    snippet: 'Preview',
    bodyPreview: 'Body content',
    receivedAt: '2024-01-15T10:00:00Z',
    sizeEstimate: 500,
    labelIds: ['INBOX'],
    ...overrides,
  };
}

function makeThread(overrides: Partial<NormalizedThread> = {}): NormalizedThread {
  return {
    threadId: 'thread-1',
    subject: 'Test Subject',
    snippet: 'Preview',
    lastMessageAt: '2024-01-15T10:00:00Z',
    messageCount: 1,
    labelIds: ['INBOX'],
    isUnread: false,
    isStarred: false,
    messages: [makeMessage()],
    ...overrides,
  };
}

function createFakeAdapter(threads: NormalizedThread[]): EmailProviderAdapter {
  return {
    getProfile: async () => ({
      emailAddress: 'user@test.com',
      historyId: '99999',
    }),
    listThreads: async () => ({
      threads,
      nextPageToken: undefined,
    }),
    getThread: async (threadId: string) => {
      const thread = threads.find((t) => t.threadId === threadId);
      if (!thread) throw new Error(`Thread ${threadId} not found`);
      return thread;
    },
    getMessage: async (messageId: string) => {
      for (const thread of threads) {
        const msg = thread.messages.find((m) => m.messageId === messageId);
        if (msg) return msg;
      }
      throw new Error(`Message ${messageId} not found`);
    },
    listHistory: async (): Promise<HistoryChange> => ({
      changedThreadIds: [],
      newHistoryId: '99999',
    }),
  };
}

describe('EmailSyncService', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let emailService: EmailService;
  let syncService: EmailSyncService;
  let ctx: CapabilityContext;

  beforeEach(() => {
    const setup = setupDb();
    db = setup.db;
    cleanup = setup.cleanup;
    ctx = makeCtx(db);
    const dbHandle = db as unknown as CapabilityContext['appDb'];
    emailService = new EmailService(dbHandle);
    syncService = new EmailSyncService(emailService, ctx);
  });

  afterEach(() => {
    cleanup();
  });

  it('performs full sync and stores threads/messages locally', async () => {
    const account = emailService.registerAccount({
      connectionId: 'c1', emailAddress: 'user@test.com', displayName: 'User',
    });

    const adapter = createFakeAdapter([
      makeThread({
        threadId: 'gt1',
        subject: 'Thread 1',
        messages: [makeMessage({ messageId: 'gm1', threadId: 'gt1', subject: 'Thread 1' })],
      }),
      makeThread({
        threadId: 'gt2',
        subject: 'Thread 2',
        messages: [makeMessage({ messageId: 'gm2', threadId: 'gt2', subject: 'Thread 2' })],
      }),
    ]);

    const result = await syncService.syncAccount(account, adapter);

    expect(result.synced).toBe(2);
    expect(result.errors.length).toBe(0);

    // Verify threads stored
    const threads = emailService.listThreads(account.id);
    expect(threads.length).toBe(2);

    // Verify messages stored
    const messages = emailService.listMessages(threads[0]!.id);
    expect(messages.length).toBe(1);

    // Verify sync cursor updated with history ID
    const updatedAccount = emailService.getAccount(account.id);
    expect(updatedAccount!.syncCursorHistoryId).toBe('99999');
    expect(updatedAccount!.lastSyncAt).not.toBeNull();
  });

  it('emits audit event on sync completion', async () => {
    const account = emailService.registerAccount({
      connectionId: 'c1', emailAddress: 'user@test.com', displayName: 'User',
    });

    const adapter = createFakeAdapter([makeThread()]);
    await syncService.syncAccount(account, adapter);

    expect(ctx.auditCallback).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'email_sync_completed',
      severity: 'info',
    }));
  });

  it('derives sender memories after sync', async () => {
    const account = emailService.registerAccount({
      connectionId: 'c1', emailAddress: 'user@test.com', displayName: 'User',
    });

    // Create multiple messages from same sender
    const messages = Array.from({ length: 5 }, (_, i) =>
      makeMessage({
        messageId: `gm${i}`,
        threadId: `gt${i}`,
        from: 'frequent@test.com',
        subject: `Message ${i}`,
      }),
    );

    const threads = messages.map((msg, i) =>
      makeThread({
        threadId: `gt${i}`,
        subject: `Message ${i}`,
        messages: [msg],
      }),
    );

    const adapter = createFakeAdapter(threads);
    await syncService.syncAccount(account, adapter);

    // Should have derived sender memory for frequent sender
    expect(ctx.memoryInsert).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: 'capability_sync',
      domain: 'email',
      dedupKey: expect.stringContaining('email-sender'),
    }));
  });

  it('handles sync errors gracefully', async () => {
    const account = emailService.registerAccount({
      connectionId: 'c1', emailAddress: 'user@test.com', displayName: 'User',
    });

    const adapter: EmailProviderAdapter = {
      getProfile: async () => { throw new Error('Network error'); },
      listThreads: async () => { throw new Error('Network error'); },
      getThread: async () => { throw new Error('Network error'); },
      getMessage: async () => { throw new Error('Network error'); },
      listHistory: async () => { throw new Error('Network error'); },
    };

    const result = await syncService.syncAccount(account, adapter);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Network error');
  });

  it('updates message count after sync', async () => {
    const account = emailService.registerAccount({
      connectionId: 'c1', emailAddress: 'user@test.com', displayName: 'User',
    });

    const adapter = createFakeAdapter([
      makeThread({
        threadId: 'gt1',
        messages: [
          makeMessage({ messageId: 'gm1', threadId: 'gt1' }),
          makeMessage({ messageId: 'gm2', threadId: 'gt1', receivedAt: '2024-01-15T11:00:00Z' }),
        ],
      }),
    ]);

    await syncService.syncAccount(account, adapter);

    const updated = emailService.getAccount(account.id);
    expect(updated!.messageCount).toBe(2);
  });
});
