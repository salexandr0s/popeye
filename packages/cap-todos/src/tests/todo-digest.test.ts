import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import type { CapabilityContext } from '@popeye/contracts';
import { TodoService } from '../todo-service.js';
import { TodoDigestService } from '../todo-digest.js';
import { getTodoMigrations } from '../migrations.js';

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-captodos-digest-'));
  const db = new Database(join(dir, 'todos.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);');
  const getMigration = db.prepare('SELECT id FROM schema_migrations WHERE id = ?');
  const addMigration = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');
  for (const migration of getTodoMigrations()) {
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

describe('TodoDigestService', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let svc: TodoService;

  beforeEach(() => {
    const setup = setupDb();
    db = setup.db;
    cleanup = setup.cleanup;
    svc = new TodoService(db as unknown as CapabilityContext['appDb']);
  });

  afterEach(() => {
    cleanup();
  });

  it('generates digest with summary counts', () => {
    const acct = svc.registerAccount({ providerKind: 'local', displayName: 'Test' });
    const yesterday = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    // Pending items
    svc.createItem(acct.id, { title: 'Pending 1', priority: 1 });
    svc.createItem(acct.id, { title: 'Pending 2', priority: 3 });

    // Overdue item
    svc.createItem(acct.id, { title: 'Overdue task', dueDate: yesterday, priority: 2 });

    // Due today item
    svc.createItem(acct.id, { title: 'Today task', dueDate: today, priority: 1 });

    // Completed today
    const toComplete = svc.createItem(acct.id, { title: 'Done today' });
    svc.completeItem(toComplete.id);

    const ctx = makeCtx();
    const digestSvc = new TodoDigestService(svc, ctx);
    const digest = digestSvc.generateDigest(acct, today);

    expect(digest.pendingCount).toBe(4); // 4 pending items (not counting completed)
    expect(digest.overdueCount).toBe(1);
    expect(digest.completedTodayCount).toBe(1);
    expect(digest.summaryMarkdown).toContain('Todo Digest');
    expect(digest.summaryMarkdown).toContain('Summary');
  });

  it('includes overdue section', () => {
    const acct = svc.registerAccount({ providerKind: 'local', displayName: 'Test' });
    const yesterday = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);

    svc.createItem(acct.id, { title: 'Late submission', dueDate: yesterday, priority: 1 });

    const ctx = makeCtx();
    const digestSvc = new TodoDigestService(svc, ctx);
    const digest = digestSvc.generateDigest(acct, '2025-03-15');

    expect(digest.summaryMarkdown).toContain('Overdue');
    expect(digest.summaryMarkdown).toContain('Late submission');
  });

  it('includes due today section', () => {
    const acct = svc.registerAccount({ providerKind: 'local', displayName: 'Test' });
    const today = new Date().toISOString().slice(0, 10);

    svc.createItem(acct.id, { title: 'Ship feature', dueDate: today, priority: 2 });

    const ctx = makeCtx();
    const digestSvc = new TodoDigestService(svc, ctx);
    const digest = digestSvc.generateDigest(acct, today);

    expect(digest.summaryMarkdown).toContain('Due Today');
    expect(digest.summaryMarkdown).toContain('Ship feature');
  });

  it('includes high priority section', () => {
    const acct = svc.registerAccount({ providerKind: 'local', displayName: 'Test' });

    svc.createItem(acct.id, { title: 'Critical bug', priority: 1 });
    svc.createItem(acct.id, { title: 'Important feature', priority: 2 });
    svc.createItem(acct.id, { title: 'Low priority', priority: 4 });

    const ctx = makeCtx();
    const digestSvc = new TodoDigestService(svc, ctx);
    const digest = digestSvc.generateDigest(acct, '2025-03-15');

    expect(digest.summaryMarkdown).toContain('High Priority');
    expect(digest.summaryMarkdown).toContain('Critical bug');
    expect(digest.summaryMarkdown).toContain('Important feature');
  });

  it('stores digest in memory and emits audit event', () => {
    const acct = svc.registerAccount({ providerKind: 'local', displayName: 'Test' });
    const ctx = makeCtx();
    const digestSvc = new TodoDigestService(svc, ctx);
    digestSvc.generateDigest(acct, '2025-03-15');

    expect(ctx.memoryInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'todos',
        sourceRefType: 'todo_digest',
        dedupKey: expect.stringContaining('todo-digest:'),
      }),
    );

    expect(ctx.auditCallback).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'todo_digest_generated', severity: 'info' }),
    );
  });

  it('generates empty digest when no data', () => {
    const acct = svc.registerAccount({ providerKind: 'local', displayName: 'Test' });
    const ctx = makeCtx();
    const digestSvc = new TodoDigestService(svc, ctx);
    const digest = digestSvc.generateDigest(acct, '2025-03-15');

    expect(digest.pendingCount).toBe(0);
    expect(digest.overdueCount).toBe(0);
    expect(digest.completedTodayCount).toBe(0);
  });
});
