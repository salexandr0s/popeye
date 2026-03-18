import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { TodoService } from '../todo-service.js';
import { TodoSearchService } from '../todo-search.js';
import { getTodoMigrations } from '../migrations.js';

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-captodos-search-'));
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

describe('TodoSearchService', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let svc: TodoService;
  let searchSvc: TodoSearchService;

  beforeEach(() => {
    const setup = setupDb();
    db = setup.db;
    cleanup = setup.cleanup;
    const dbHandle = db as unknown as import('@popeye/contracts').CapabilityContext['appDb'];
    svc = new TodoService(dbHandle);
    searchSvc = new TodoSearchService(dbHandle);

    // Seed data
    const acct = svc.registerAccount({ providerKind: 'local', displayName: 'Test' });
    svc.createItem(acct.id, { title: 'Buy groceries', description: 'Milk, eggs, and bread from the store', priority: 2 });
    svc.createItem(acct.id, { title: 'Fix authentication bug', description: 'Auth tokens expire too fast', priority: 1 });
    svc.createItem(acct.id, { title: 'Write documentation', description: 'Update API docs for v2', priority: 3 });
  });

  afterEach(() => {
    cleanup();
  });

  it('searches by title', () => {
    const result = searchSvc.search({ query: 'groceries', limit: 10 });
    expect(result.results.length).toBe(1);
    expect(result.results[0]!.title).toBe('Buy groceries');
  });

  it('searches by description', () => {
    const result = searchSvc.search({ query: 'tokens', limit: 10 });
    expect(result.results.length).toBe(1);
    expect(result.results[0]!.title).toBe('Fix authentication bug');
  });

  it('searches across title and description', () => {
    const result = searchSvc.search({ query: 'authentication', limit: 10 });
    expect(result.results.length).toBeGreaterThanOrEqual(1);
    expect(result.results.some((r) => r.title === 'Fix authentication bug')).toBe(true);
  });

  it('filters by accountId', () => {
    // Create a second account with items
    const acct2 = svc.registerAccount({ providerKind: 'local', displayName: 'Test 2' });
    svc.createItem(acct2.id, { title: 'Another groceries task', description: 'Bananas and apples' });

    const accounts = svc.listAccounts();
    const firstAccount = accounts[0]!;

    const result = searchSvc.search({ query: 'groceries', accountId: firstAccount.id, limit: 10 });
    expect(result.results.length).toBe(1);
    expect(result.results[0]!.title).toBe('Buy groceries');
  });

  it('filters by status', () => {
    const accounts = svc.listAccounts();
    const acct = accounts[0]!;
    const items = svc.listItems(acct.id);
    const groceryItem = items.find((i) => i.title === 'Buy groceries')!;
    svc.completeItem(groceryItem.id);

    const pendingOnly = searchSvc.search({ query: 'groceries OR documentation', status: 'pending', limit: 10 });
    expect(pendingOnly.results.every((r) => r.status === 'pending')).toBe(true);
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
