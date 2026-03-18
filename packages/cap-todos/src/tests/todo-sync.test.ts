import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import type { CapabilityContext } from '@popeye/contracts';
import { TodoService } from '../todo-service.js';
import { TodoSyncService } from '../todo-sync.js';
import { getTodoMigrations } from '../migrations.js';
import type { TodoProviderAdapter } from '../providers/adapter-interface.js';

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-captodos-sync-'));
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
    contextReleaseRecord: () => ({ id: 'test' }),
    events: { emit: () => {} },
  };
}

function createFakeAdapter(): TodoProviderAdapter {
  return {
    getProjects: async () => [
      { id: 'proj-1', name: 'Work', color: '#ff0000' },
      { id: 'proj-2', name: 'Personal', color: '#00ff00' },
    ],
    listItems: async () => [
      {
        id: 'item-1', title: 'Fix the bug', description: 'Auth is broken',
        priority: 1, status: 'pending' as const, dueDate: '2025-03-20', dueTime: null,
        labels: ['urgent'], projectId: 'proj-1', projectName: null, parentId: null,
        createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-02T00:00:00Z',
      },
      {
        id: 'item-2', title: 'Buy groceries', description: 'Milk and eggs',
        priority: 3, status: 'pending' as const, dueDate: '2025-03-21', dueTime: '10:00',
        labels: ['shopping'], projectId: 'proj-2', projectName: null, parentId: null,
        createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-02T00:00:00Z',
      },
    ],
    createItem: async () => { throw new Error('Not expected'); },
    updateItem: async () => { throw new Error('Not expected'); },
    completeItem: async () => { throw new Error('Not expected'); },
  };
}

describe('TodoSyncService', () => {
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

  it('local account returns zeros (no-op)', async () => {
    const acct = svc.registerAccount({ providerKind: 'local', displayName: 'Local' });
    const ctx = makeCtx();
    const syncSvc = new TodoSyncService(svc, ctx);
    const adapter = createFakeAdapter();

    const result = await syncSvc.syncAccount(acct, adapter);
    expect(result.todosSynced).toBe(0);
    expect(result.todosUpdated).toBe(0);
    expect(result.errors.length).toBe(0);
  });

  it('syncs projects and items from external adapter', async () => {
    const acct = svc.registerAccount({ providerKind: 'todoist', displayName: 'Todoist', connectionId: 'c1' });
    const ctx = makeCtx();
    const syncSvc = new TodoSyncService(svc, ctx);
    const adapter = createFakeAdapter();

    const result = await syncSvc.syncAccount(acct, adapter);

    expect(result.todosSynced).toBe(2);
    expect(result.todosUpdated).toBe(0);
    expect(result.errors.length).toBe(0);

    // Verify projects stored
    const projects = svc.listProjects(acct.id);
    expect(projects.length).toBe(2);
    expect(projects.map((p) => p.name).sort()).toEqual(['Personal', 'Work']);

    // Verify items stored
    const items = svc.listItems(acct.id);
    expect(items.length).toBe(2);
    expect(items.map((i) => i.title).sort()).toEqual(['Buy groceries', 'Fix the bug']);
  });

  it('marks updated items as todosUpdated on re-sync', async () => {
    const acct = svc.registerAccount({ providerKind: 'todoist', displayName: 'Todoist', connectionId: 'c1' });
    const ctx = makeCtx();
    const syncSvc = new TodoSyncService(svc, ctx);
    const adapter = createFakeAdapter();

    // First sync
    await syncSvc.syncAccount(acct, adapter);

    // Second sync — same items
    const result2 = await syncSvc.syncAccount(acct, adapter);
    expect(result2.todosSynced).toBe(0);
    expect(result2.todosUpdated).toBe(2);
  });

  it('redacts descriptions during sync', async () => {
    const acct = svc.registerAccount({ providerKind: 'todoist', displayName: 'Todoist', connectionId: 'c1' });
    const ctx = makeCtx();
    // Add a redaction pattern
    (ctx.config as Record<string, unknown>)['security'] = { redactionPatterns: ['Auth'] };
    const syncSvc = new TodoSyncService(svc, ctx);
    const adapter = createFakeAdapter();

    await syncSvc.syncAccount(acct, adapter);

    const items = svc.listItems(acct.id);
    const authItem = items.find((i) => i.externalId === 'item-1')!;
    // The description should have 'Auth' redacted
    expect(authItem.description).not.toContain('Auth');
  });

  it('emits audit event on success', async () => {
    const acct = svc.registerAccount({ providerKind: 'todoist', displayName: 'Todoist', connectionId: 'c1' });
    const ctx = makeCtx();
    const syncSvc = new TodoSyncService(svc, ctx);
    const adapter = createFakeAdapter();

    await syncSvc.syncAccount(acct, adapter);

    expect(ctx.auditCallback).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'todo_sync_completed', severity: 'info' }),
    );
  });

  it('emits audit event on adapter failure', async () => {
    const acct = svc.registerAccount({ providerKind: 'todoist', displayName: 'Todoist', connectionId: 'c1' });
    const ctx = makeCtx();
    const syncSvc = new TodoSyncService(svc, ctx);

    const failingAdapter: TodoProviderAdapter = {
      getProjects: async () => { throw new Error('API down'); },
      listItems: async () => [],
      createItem: async () => { throw new Error('Not expected'); },
      updateItem: async () => { throw new Error('Not expected'); },
      completeItem: async () => { throw new Error('Not expected'); },
    };

    const result = await syncSvc.syncAccount(acct, failingAdapter);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
