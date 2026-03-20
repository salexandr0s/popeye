import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import type { CapabilityContext } from '@popeye/contracts';

import { createFilesCapability } from './index.ts';
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

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-capfiles-'));
  const db = new Database(join(dir, 'app.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Create workspaces table (normally created by runtime migrations)
  db.exec('CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);');
  db.exec("INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES ('default', 'Default', '2024-01-01T00:00:00Z');");
  return { db, dir, cleanup: () => db.close() };
}

function makeCtx(db: Database.Database, tempRoot: string): CapabilityContext {
  return {
    appDb: db,
    memoryDb: db,
    paths: {} as CapabilityContext['paths'],
    config: {
      security: { redactionPatterns: [] },
      workspaces: [{ id: 'default', name: 'Default', rootPath: tempRoot }],
    },
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    auditCallback: () => {},
    memoryInsert: () => ({ memoryId: 'mem-1', embedded: false }),
    approvalRequest: () => ({ id: 'test', status: 'pending' }),
    actionApprovalRequest: () => ({ id: 'test', status: 'pending' }),
    contextReleaseRecord: () => ({ id: 'test' }),
    events: { emit: () => {} },
  };
}

describe('createFilesCapability', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let tempRoot: string;

  beforeEach(() => {
    const setup = setupDb();
    db = setup.db;
    cleanup = setup.cleanup;
    tempRoot = mkdtempSync(join(tmpdir(), 'popeye-capfiles-root-'));
  });

  afterEach(() => {
    cleanup();
  });

  it('full lifecycle: register → init → tools → shutdown', async () => {
    const cap = createFilesCapability();

    expect(cap.descriptor.id).toBe('files');
    expect(cap.descriptor.domain).toBe('files');

    // Apply migrations
    const migrations = cap.getMigrations!();
    expect(migrations.length).toBeGreaterThan(0);
    for (const m of migrations) {
      applyMigrations(db, [{ id: `files-${m.id}`, statements: m.statements }]);
    }

    // Initialize
    const ctx = makeCtx(db, tempRoot);
    await cap.initialize(ctx);

    // Health check
    const health = cap.healthCheck();
    expect(health.healthy).toBe(true);

    // Get tools
    const tools = cap.getRuntimeTools!({ workspaceId: 'default' });
    expect(tools.length).toBe(3);
    expect(tools.map((t) => t.name)).toContain('popeye_file_search');
    expect(tools.map((t) => t.name)).toContain('popeye_file_read');
    expect(tools.map((t) => t.name)).toContain('popeye_file_list');

    // Get timers
    const timers = cap.getTimers!();
    expect(timers.length).toBe(2);
    expect(timers.map((t) => t.id)).toContain('files-reindex');
    expect(timers.map((t) => t.id)).toContain('files-stale-repair');

    // Shutdown
    await cap.shutdown();
    const postShutdownHealth = cap.healthCheck();
    expect(postShutdownHealth.healthy).toBe(false);
  });

  it('file_search tool returns results after indexing', async () => {
    const cap = createFilesCapability();
    const migrations = cap.getMigrations!();
    for (const m of migrations) {
      applyMigrations(db, [{ id: `files-${m.id}`, statements: m.statements }]);
    }

    writeFileSync(join(tempRoot, 'hello.md'), '# Hello');

    const ctx = makeCtx(db, tempRoot);
    await cap.initialize(ctx);

    // Register a root directly in DB
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO file_roots (id, workspace_id, label, root_path, permission, file_patterns, exclude_patterns, max_file_size_bytes, enabled, last_indexed_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
    ).run('root-test', 'default', 'Test', tempRoot, 'index', '["**/*.md"]', '[]', 1048576, now, now);

    // Index manually (normally done by timer)
    const { FileIndexer } = await import('./file-indexer.ts');
    const indexer = new FileIndexer(db, ctx);
    const root = {
      id: 'root-test',
      workspaceId: 'default',
      label: 'Test',
      rootPath: tempRoot,
      permission: 'index' as const,
      filePatterns: ['**/*.md'],
      excludePatterns: [],
      maxFileSizeBytes: 1_048_576,
      enabled: true,
      lastIndexedAt: null,
      lastIndexedCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    indexer.indexRoot(root);

    // Search
    const tools = cap.getRuntimeTools!({ workspaceId: 'default' });
    const searchTool = tools.find((t) => t.name === 'popeye_file_search')!;
    const result = await searchTool.execute({ query: 'hello' });
    expect(result.content[0]!.text).toContain('hello.md');

    await cap.shutdown();
  });
});
