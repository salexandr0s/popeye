import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { TodoService } from '../todo-service.js';
import { getTodoMigrations } from '../migrations.js';

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-captodos-'));
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

describe('TodoService', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let svc: TodoService;

  beforeEach(() => {
    const setup = setupDb();
    db = setup.db;
    cleanup = setup.cleanup;
    svc = new TodoService(db as unknown as import('@popeye/contracts').CapabilityContext['appDb']);
  });

  afterEach(() => {
    cleanup();
  });

  // --- Accounts ---

  it('registers and retrieves an account', () => {
    const account = svc.registerAccount({
      providerKind: 'local',
      displayName: 'My Todos',
    });
    expect(account.providerKind).toBe('local');
    expect(account.displayName).toBe('My Todos');
    expect(account.connectionId).toBeNull();
    expect(account.todoCount).toBe(0);

    const fetched = svc.getAccount(account.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.displayName).toBe('My Todos');
  });

  it('lists accounts', () => {
    svc.registerAccount({ providerKind: 'local', displayName: 'Alice Todos' });
    svc.registerAccount({ providerKind: 'todoist', displayName: 'Bob Todoist', connectionId: 'conn-1' });
    const all = svc.listAccounts();
    expect(all.length).toBe(2);
  });

  it('updates sync cursor', () => {
    const acct = svc.registerAccount({ providerKind: 'local', displayName: 'Test' });
    svc.updateSyncCursor(acct.id, '2025-01-01T00:00:00Z');
    const updated = svc.getAccount(acct.id)!;
    expect(updated.syncCursorSince).toBe('2025-01-01T00:00:00Z');
    expect(updated.lastSyncAt).not.toBeNull();
  });

  // --- Projects ---

  it('upserts and lists projects', () => {
    const acct = svc.registerAccount({ providerKind: 'local', displayName: 'Test' });
    const project = svc.upsertProject(acct.id, {
      externalId: 'ext-1',
      name: 'Work',
      color: '#ff0000',
    });
    expect(project.name).toBe('Work');
    expect(project.color).toBe('#ff0000');

    // Upsert again (update)
    const updated = svc.upsertProject(acct.id, {
      externalId: 'ext-1',
      name: 'Work Updated',
      color: '#00ff00',
    });
    expect(updated.name).toBe('Work Updated');
    expect(updated.id).toBe(project.id);

    const all = svc.listProjects(acct.id);
    expect(all.length).toBe(1);
  });

  it('gets a project by ID', () => {
    const acct = svc.registerAccount({ providerKind: 'local', displayName: 'Test' });
    const project = svc.upsertProject(acct.id, { externalId: null, name: 'Personal', color: null });
    const fetched = svc.getProject(project.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe('Personal');
  });

  // --- Items ---

  it('creates a local item and retrieves it', () => {
    const acct = svc.registerAccount({ providerKind: 'local', displayName: 'Test' });
    const item = svc.createItem(acct.id, {
      title: 'Buy groceries',
      description: 'Milk, eggs, bread',
      priority: 2,
      dueDate: '2025-03-20',
      labels: ['shopping'],
      projectName: 'Personal',
    });

    expect(item.title).toBe('Buy groceries');
    expect(item.description).toBe('Milk, eggs, bread');
    expect(item.priority).toBe(2);
    expect(item.status).toBe('pending');
    expect(item.dueDate).toBe('2025-03-20');
    expect(item.labels).toEqual(['shopping']);
    expect(item.projectName).toBe('Personal');
    expect(item.completedAt).toBeNull();

    const fetched = svc.getItem(item.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.title).toBe('Buy groceries');
  });

  it('lists items with filters', () => {
    const acct = svc.registerAccount({ providerKind: 'local', displayName: 'Test' });
    svc.createItem(acct.id, { title: 'Task 1', priority: 1, dueDate: '2025-03-20', projectName: 'Work' });
    svc.createItem(acct.id, { title: 'Task 2', priority: 3, dueDate: '2025-03-21', projectName: 'Personal' });
    svc.createItem(acct.id, { title: 'Task 3', priority: 1, dueDate: '2025-03-20', projectName: 'Work' });

    const allPending = svc.listItems(acct.id, { status: 'pending' });
    expect(allPending.length).toBe(3);

    const p1Only = svc.listItems(acct.id, { priority: 1 });
    expect(p1Only.length).toBe(2);

    const workOnly = svc.listItems(acct.id, { projectName: 'Work' });
    expect(workOnly.length).toBe(2);

    const dateOnly = svc.listItems(acct.id, { dueDate: '2025-03-21' });
    expect(dateOnly.length).toBe(1);
  });

  it('lists overdue items', () => {
    const acct = svc.registerAccount({ providerKind: 'local', displayName: 'Test' });
    const yesterday = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 10);

    svc.createItem(acct.id, { title: 'Overdue', dueDate: yesterday });
    svc.createItem(acct.id, { title: 'Future', dueDate: tomorrow });

    const overdue = svc.listOverdue(acct.id);
    expect(overdue.length).toBe(1);
    expect(overdue[0]!.title).toBe('Overdue');
  });

  it('lists due today items', () => {
    const acct = svc.registerAccount({ providerKind: 'local', displayName: 'Test' });
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 10);

    svc.createItem(acct.id, { title: 'Today task', dueDate: today });
    svc.createItem(acct.id, { title: 'Tomorrow task', dueDate: tomorrow });

    const dueToday = svc.listDueToday(acct.id);
    expect(dueToday.length).toBe(1);
    expect(dueToday[0]!.title).toBe('Today task');
  });

  it('completes an item', () => {
    const acct = svc.registerAccount({ providerKind: 'local', displayName: 'Test' });
    const item = svc.createItem(acct.id, { title: 'Complete me' });
    expect(item.status).toBe('pending');

    const completed = svc.completeItem(item.id);
    expect(completed).not.toBeNull();
    expect(completed!.status).toBe('completed');
    expect(completed!.completedAt).not.toBeNull();
  });

  it('gets item by external ID', () => {
    const acct = svc.registerAccount({ providerKind: 'todoist', displayName: 'Todoist', connectionId: 'c1' });
    svc.upsertItem(acct.id, {
      externalId: 'ext-123',
      title: 'External todo',
      description: '',
      priority: 4,
      status: 'pending',
      dueDate: null,
      dueTime: null,
      labels: [],
      projectName: null,
      parentId: null,
      completedAt: null,
      createdAtExternal: null,
      updatedAtExternal: null,
    });

    const found = svc.getItemByExternalId(acct.id, 'ext-123');
    expect(found).not.toBeNull();
    expect(found!.title).toBe('External todo');
  });

  // --- Digests ---

  it('inserts and retrieves digests', () => {
    const acct = svc.registerAccount({ providerKind: 'local', displayName: 'Test' });

    const digest = svc.insertDigest({
      accountId: acct.id,
      workspaceId: 'default',
      date: '2025-03-15',
      pendingCount: 5,
      overdueCount: 2,
      completedTodayCount: 3,
      summaryMarkdown: '# Digest',
    });
    expect(digest.pendingCount).toBe(5);

    const latest = svc.getLatestDigest(acct.id);
    expect(latest).not.toBeNull();
    expect(latest!.date).toBe('2025-03-15');

    // Upsert same date
    const updated = svc.insertDigest({
      accountId: acct.id,
      workspaceId: 'default',
      date: '2025-03-15',
      pendingCount: 6,
      overdueCount: 1,
      completedTodayCount: 4,
      summaryMarkdown: '# Updated Digest',
    });
    expect(updated.id).toBe(digest.id); // Same ID preserved
    expect(updated.pendingCount).toBe(6);
  });

  // --- Stats ---

  it('counts pending, overdue, completed today', () => {
    const acct = svc.registerAccount({ providerKind: 'local', displayName: 'Test' });
    const yesterday = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);

    svc.createItem(acct.id, { title: 'Pending 1' });
    svc.createItem(acct.id, { title: 'Overdue', dueDate: yesterday });
    const toComplete = svc.createItem(acct.id, { title: 'Done today' });
    svc.completeItem(toComplete.id);

    expect(svc.getPendingCount(acct.id)).toBe(2);
    expect(svc.getOverdueCount(acct.id)).toBe(1);
    expect(svc.getCompletedTodayCount(acct.id)).toBe(1);
  });

  it('returns null for nonexistent entities', () => {
    expect(svc.getAccount('nope')).toBeNull();
    expect(svc.getProject('nope')).toBeNull();
    expect(svc.getItem('nope')).toBeNull();
    expect(svc.getDigest('nope')).toBeNull();
    expect(svc.getLatestDigest('nope')).toBeNull();
  });

  it('updates todo count', () => {
    const acct = svc.registerAccount({ providerKind: 'local', displayName: 'Test' });
    svc.createItem(acct.id, { title: 'Item 1' });
    svc.createItem(acct.id, { title: 'Item 2' });
    svc.updateTodoCount(acct.id);
    const updated = svc.getAccount(acct.id)!;
    expect(updated.todoCount).toBe(2);
  });
});
