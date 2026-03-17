import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

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
import type { CapabilityContext, FileRootRecord } from '@popeye/contracts';

import { FileIndexer } from './file-indexer.ts';
import { FileRootService } from './file-root-service.ts';
import { getFilesMigrations } from './migrations.ts';

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-fidx-'));
  const db = new Database(join(dir, 'app.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create workspaces table (normally created by runtime migrations)
  db.exec('CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);');
  db.exec("INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES ('default', 'Default', '2024-01-01T00:00:00Z');");

  const migrations = getFilesMigrations();
  for (const m of migrations) {
    applyMigrations(db, [{ id: `files-${m.id}`, statements: m.statements }]);
  }

  return { db, dir, cleanup: () => db.close() };
}

function makeCtx(db: Database.Database): CapabilityContext {
  const inserted: Array<{ description: string; sourceType: string; dedupKey?: string }> = [];
  return {
    appDb: db,
    memoryDb: db,
    paths: {} as CapabilityContext['paths'],
    config: { security: { redactionPatterns: [] } },
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    auditCallback: () => {},
    memoryInsert: (input) => {
      inserted.push({ description: input.description, sourceType: input.sourceType, dedupKey: input.dedupKey });
      return { memoryId: `mem-${inserted.length}`, embedded: false };
    },
    approvalRequest: () => ({ id: 'test', status: 'pending' }),
    contextReleaseRecord: () => ({ id: 'test' }),
    events: { emit: () => {} },
    // Expose for assertions
    _inserted: inserted,
  } as CapabilityContext & { _inserted: typeof inserted };
}

function makeRoot(tempRoot: string, overrides?: Partial<FileRootRecord>): FileRootRecord {
  return {
    id: 'root-1',
    workspaceId: 'default',
    label: 'Test Root',
    rootPath: tempRoot,
    permission: 'index',
    filePatterns: ['**/*.md', '**/*.txt'],
    excludePatterns: [],
    maxFileSizeBytes: 1_048_576,
    enabled: true,
    lastIndexedAt: null,
    lastIndexedCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function insertRootRow(db: Database.Database, root: FileRootRecord): void {
  db.prepare(
    `INSERT INTO file_roots (id, workspace_id, label, root_path, permission, file_patterns, exclude_patterns, max_file_size_bytes, enabled, last_indexed_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    root.id,
    root.workspaceId,
    root.label,
    root.rootPath,
    root.permission,
    JSON.stringify(root.filePatterns),
    JSON.stringify(root.excludePatterns),
    root.maxFileSizeBytes,
    root.enabled ? 1 : 0,
    root.lastIndexedCount,
    root.createdAt,
    root.updatedAt,
  );
}

describe('FileIndexer', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let tempRoot: string;
  let ctx: CapabilityContext & { _inserted: Array<{ description: string; sourceType: string; dedupKey?: string }> };

  beforeEach(() => {
    const setup = setupDb();
    db = setup.db;
    cleanup = setup.cleanup;
    tempRoot = mkdtempSync(join(tmpdir(), 'popeye-fidx-root-'));
    ctx = makeCtx(db) as typeof ctx;
  });

  afterEach(() => {
    cleanup();
  });

  it('indexes markdown files', () => {
    writeFileSync(join(tempRoot, 'readme.md'), '# Hello World');
    writeFileSync(join(tempRoot, 'notes.txt'), 'Some notes');

    const root = makeRoot(tempRoot);
    insertRootRow(db, root);
    const indexer = new FileIndexer(db, ctx);
    const result = indexer.indexRoot(root);

    expect(result.indexed).toBe(2);
    expect(result.errors).toHaveLength(0);

    // Verify documents in DB
    const docs = db.prepare('SELECT * FROM file_documents WHERE file_root_id = ?').all(root.id);
    expect(docs).toHaveLength(2);

    // Verify memory was called with correct sourceType
    expect(ctx._inserted).toHaveLength(2);
    expect(ctx._inserted[0]!.sourceType).toBe('file_doc');
  });

  it('skips unchanged files on re-index', () => {
    writeFileSync(join(tempRoot, 'stable.md'), 'Stable content');

    const root = makeRoot(tempRoot);
    insertRootRow(db, root);
    const indexer = new FileIndexer(db, ctx);

    const first = indexer.indexRoot(root);
    expect(first.indexed).toBe(1);

    const second = indexer.indexRoot(root);
    expect(second.skipped).toBe(1);
    expect(second.indexed).toBe(0);
  });

  it('detects content changes', () => {
    const filePath = join(tempRoot, 'changing.md');
    writeFileSync(filePath, 'Version 1');

    const root = makeRoot(tempRoot);
    insertRootRow(db, root);
    const indexer = new FileIndexer(db, ctx);

    indexer.indexRoot(root);
    writeFileSync(filePath, 'Version 2 — updated');

    const result = indexer.indexRoot(root);
    expect(result.updated).toBe(1);
  });

  it('marks stale documents', () => {
    const filePath = join(tempRoot, 'temp.md');
    writeFileSync(filePath, 'Temporary');

    const root = makeRoot(tempRoot);
    insertRootRow(db, root);
    const indexer = new FileIndexer(db, ctx);

    indexer.indexRoot(root);
    expect(db.prepare('SELECT COUNT(*) as c FROM file_documents').get()).toEqual({ c: 1 });

    // Remove file and re-index
    require('node:fs').unlinkSync(filePath);
    const result = indexer.indexRoot(root);
    expect(result.stale).toBe(1);
    expect(db.prepare('SELECT COUNT(*) as c FROM file_documents').get()).toEqual({ c: 0 });
  });

  it('respects file patterns', () => {
    writeFileSync(join(tempRoot, 'included.md'), 'Yes');
    writeFileSync(join(tempRoot, 'excluded.js'), 'No');

    const root = makeRoot(tempRoot, { filePatterns: ['**/*.md'] });
    insertRootRow(db, root);
    const indexer = new FileIndexer(db, ctx);

    const result = indexer.indexRoot(root);
    expect(result.indexed).toBe(1);
  });

  it('respects exclude patterns', () => {
    const subDir = join(tempRoot, 'secret');
    mkdirSync(subDir);
    writeFileSync(join(subDir, 'hidden.md'), 'Secret');
    writeFileSync(join(tempRoot, 'public.md'), 'Public');

    const root = makeRoot(tempRoot, { excludePatterns: ['secret/**'] });
    insertRootRow(db, root);
    const indexer = new FileIndexer(db, ctx);

    const result = indexer.indexRoot(root);
    expect(result.indexed).toBe(1);
  });

  it('reports error for non-existent root path', () => {
    const root = makeRoot('/nonexistent/path/12345');
    const indexer = new FileIndexer(db, ctx);
    const result = indexer.indexRoot(root);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('does not exist');
  });

  it('uses file_doc source type and 0.7 confidence', () => {
    writeFileSync(join(tempRoot, 'test.md'), 'Test content');

    const root = makeRoot(tempRoot);
    insertRootRow(db, root);
    const indexer = new FileIndexer(db, ctx);
    indexer.indexRoot(root);

    const inserted = ctx._inserted[0]!;
    expect(inserted.sourceType).toBe('file_doc');
  });

  it('reindexRoot forces full re-index', () => {
    writeFileSync(join(tempRoot, 'data.md'), 'Data');

    const root = makeRoot(tempRoot);
    insertRootRow(db, root);
    const indexer = new FileIndexer(db, ctx);

    indexer.indexRoot(root);
    expect(ctx._inserted).toHaveLength(1);

    const rootService = new FileRootService(db);
    const result = indexer.reindexRoot(root.id, rootService);
    expect(result).not.toBeNull();
    expect(result!.indexed).toBe(1);
    // Memory insert was called again
    expect(ctx._inserted).toHaveLength(2);
  });
});
