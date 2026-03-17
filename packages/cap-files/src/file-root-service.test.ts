import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

// Inline migration runner to avoid cross-package test dependency
function applyMigrations(db: Database.Database, migrations: Array<{ id: string; statements: string[] }>): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);');
  const getMigration = db.prepare('SELECT id FROM schema_migrations WHERE id = ?');
  const addMigration = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');
  for (const migration of migrations) {
    if (getMigration.get(migration.id)) continue;
    const tx = db.transaction(() => {
      for (const statement of migration.statements) db.exec(statement);
      addMigration.run(migration.id, new Date().toISOString());
    });
    tx();
  }
}

import { FileRootService } from './file-root-service.ts';
import { getFilesMigrations } from './migrations.ts';

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-frs-'));
  const db = new Database(join(dir, 'app.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create workspaces table (normally created by runtime migrations)
  db.exec('CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);');
  db.exec("INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES ('default', 'Default', '2024-01-01T00:00:00Z');");
  db.exec("INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES ('ws1', 'WS1', '2024-01-01T00:00:00Z');");

  // Apply migrations
  const migrations = getFilesMigrations();
  for (const m of migrations) {
    applyMigrations(db, [{ id: `files-${m.id}`, statements: m.statements }]);
  }

  return { db, dir, cleanup: () => db.close() };
}

describe('FileRootService', () => {
  let db: Database.Database;
  let service: FileRootService;
  let tempRoot: string;
  let cleanup: () => void;

  beforeEach(() => {
    const setup = setupDb();
    db = setup.db;
    cleanup = setup.cleanup;
    tempRoot = mkdtempSync(join(tmpdir(), 'popeye-frs-root-'));
    service = new FileRootService(db);
  });

  afterEach(() => {
    cleanup();
  });

  it('registers a file root', () => {
    const root = service.registerRoot({
      workspaceId: 'default',
      label: 'Test Root',
      rootPath: tempRoot,
      permission: 'index',
      filePatterns: ['**/*.md'],
      excludePatterns: [],
      maxFileSizeBytes: 1_048_576,
    });

    expect(root.id).toBeDefined();
    expect(root.label).toBe('Test Root');
    expect(root.rootPath).toBe(tempRoot);
    expect(root.permission).toBe('index');
    expect(root.enabled).toBe(true);
  });

  it('rejects invalid root path', () => {
    expect(() => service.registerRoot({
      workspaceId: 'default',
      label: 'Bad',
      rootPath: '/nonexistent/fake/path/123',
      permission: 'index',
      filePatterns: [],
      excludePatterns: [],
      maxFileSizeBytes: 1_048_576,
    })).toThrow('Invalid root path');
  });

  it('gets a root by id', () => {
    const root = service.registerRoot({
      workspaceId: 'default',
      label: 'Fetch',
      rootPath: tempRoot,
      permission: 'read',
      filePatterns: [],
      excludePatterns: [],
      maxFileSizeBytes: 1_048_576,
    });

    const fetched = service.getRoot(root.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.label).toBe('Fetch');
  });

  it('lists roots by workspace', () => {
    service.registerRoot({
      workspaceId: 'ws1',
      label: 'A',
      rootPath: tempRoot,
      permission: 'index',
      filePatterns: [],
      excludePatterns: [],
      maxFileSizeBytes: 1_048_576,
    });

    const roots = service.listRoots('ws1');
    expect(roots).toHaveLength(1);
    expect(roots[0]!.workspaceId).toBe('ws1');
  });

  it('updates a root', () => {
    const root = service.registerRoot({
      workspaceId: 'default',
      label: 'Original',
      rootPath: tempRoot,
      permission: 'index',
      filePatterns: [],
      excludePatterns: [],
      maxFileSizeBytes: 1_048_576,
    });

    const updated = service.updateRoot(root.id, { label: 'Updated', permission: 'index_and_derive' });
    expect(updated).not.toBeNull();
    expect(updated!.label).toBe('Updated');
    expect(updated!.permission).toBe('index_and_derive');
  });

  it('soft-disables a root via removeRoot', () => {
    const root = service.registerRoot({
      workspaceId: 'default',
      label: 'ToDisable',
      rootPath: tempRoot,
      permission: 'index',
      filePatterns: [],
      excludePatterns: [],
      maxFileSizeBytes: 1_048_576,
    });

    const removed = service.removeRoot(root.id);
    expect(removed).toBe(true);

    const fetched = service.getRoot(root.id);
    expect(fetched!.enabled).toBe(false);
  });

  it('returns null for non-existent root', () => {
    expect(service.getRoot('nonexistent')).toBeNull();
  });

  it('returns null for update on non-existent root', () => {
    expect(service.updateRoot('nonexistent', { label: 'x' })).toBeNull();
  });
});
