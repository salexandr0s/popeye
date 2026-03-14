import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { searchFts5, syncFtsDelete, syncFtsInsert } from './fts5-search.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      classification TEXT NOT NULL,
      source_type TEXT NOT NULL,
      content TEXT NOT NULL,
      confidence REAL NOT NULL,
      scope TEXT NOT NULL,
      memory_type TEXT NOT NULL DEFAULT 'episodic',
      dedup_key TEXT,
      last_reinforced_at TEXT,
      archived_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE memories_fts USING fts5(memory_id UNINDEXED, description, content);
  `);
  return db;
}

function insertMemory(db: Database.Database, opts: {
  id: string;
  description: string;
  content: string;
  confidence?: number;
  scope?: string;
  memoryType?: string;
  sourceType?: string;
  archivedAt?: string | null;
}): string {
  db.prepare(
    'INSERT INTO memories (id, description, classification, source_type, content, confidence, scope, memory_type, created_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    opts.id,
    opts.description,
    'embeddable',
    opts.sourceType ?? 'curated_memory',
    opts.content,
    opts.confidence ?? 0.8,
    opts.scope ?? 'workspace',
    opts.memoryType ?? 'semantic',
    new Date().toISOString(),
    opts.archivedAt ?? null,
  );
  syncFtsInsert(db, opts.id, opts.description, opts.content);
  return opts.id;
}

describe('fts5-search', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('finds memories matching query', () => {
    insertMemory(db, { id: 'm1', description: 'TypeScript migration', content: 'We migrated from JavaScript to TypeScript' });
    insertMemory(db, { id: 'm2', description: 'Python setup', content: 'We set up a Python project' });

    const results = searchFts5(db, 'TypeScript', {});
    expect(results).toHaveLength(1);
    expect(results[0]!.memoryId).toBe('m1');
  });

  it('returns empty for no matches', () => {
    insertMemory(db, { id: 'm1', description: 'something', content: 'unrelated content' });
    const results = searchFts5(db, 'nonexistent', {});
    expect(results).toHaveLength(0);
  });

  it('filters by scope', () => {
    insertMemory(db, { id: 'm1', description: 'test', content: 'test content', scope: 'workspace-a' });
    insertMemory(db, { id: 'm2', description: 'test', content: 'test content too', scope: 'workspace-b' });

    const results = searchFts5(db, 'test', { scope: 'workspace-a' });
    expect(results).toHaveLength(1);
    expect(results[0]!.memoryId).toBe('m1');
  });

  it('filters by minConfidence', () => {
    insertMemory(db, { id: 'm1', description: 'low confidence', content: 'test data', confidence: 0.05 });
    insertMemory(db, { id: 'm2', description: 'high confidence', content: 'test data', confidence: 0.9 });

    const results = searchFts5(db, 'test', { minConfidence: 0.5 });
    expect(results).toHaveLength(1);
    expect(results[0]!.memoryId).toBe('m2');
  });

  it('filters by memoryTypes', () => {
    insertMemory(db, { id: 'm1', description: 'episodic thing', content: 'test data', memoryType: 'episodic' });
    insertMemory(db, { id: 'm2', description: 'semantic thing', content: 'test data', memoryType: 'semantic' });

    const results = searchFts5(db, 'test', { memoryTypes: ['semantic'] });
    expect(results).toHaveLength(1);
    expect(results[0]!.memoryId).toBe('m2');
  });

  it('excludes archived memories', () => {
    insertMemory(db, { id: 'm1', description: 'active memory', content: 'test data' });
    insertMemory(db, { id: 'm2', description: 'archived memory', content: 'test data', archivedAt: new Date().toISOString() });

    const results = searchFts5(db, 'test', {});
    expect(results).toHaveLength(1);
    expect(results[0]!.memoryId).toBe('m1');
  });

  it('respects limit', () => {
    for (let i = 0; i < 10; i++) {
      insertMemory(db, { id: `m${i}`, description: `memory ${i}`, content: 'shared content' });
    }

    const results = searchFts5(db, 'shared', { limit: 3 });
    expect(results).toHaveLength(3);
  });

  it('returns empty for empty query', () => {
    insertMemory(db, { id: 'm1', description: 'test', content: 'content' });
    const results = searchFts5(db, '', {});
    expect(results).toHaveLength(0);
  });

  it('returns empty array on FTS5 query error', () => {
    // Close the db to force an error on the next query
    db.close();
    const brokenDb = new Database(':memory:');
    // No FTS table exists — query will throw
    brokenDb.exec('CREATE TABLE memories (id TEXT, description TEXT, content TEXT, confidence REAL, scope TEXT, memory_type TEXT, source_type TEXT, created_at TEXT, last_reinforced_at TEXT, archived_at TEXT, classification TEXT)');
    brokenDb.exec('CREATE VIRTUAL TABLE memories_fts USING fts5(memory_id UNINDEXED, description, content)');
    // Insert with invalid MATCH expression won't reach our try/catch since buildFts5MatchExpression sanitizes.
    // Instead, drop the table to force a runtime error:
    brokenDb.exec('DROP TABLE memories');
    const results = searchFts5(brokenDb, 'test', {});
    expect(results).toHaveLength(0);
    brokenDb.close();
    // Re-create db for afterEach
    db = createTestDb();
  });
});

describe('syncFtsDelete', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('removes entry from FTS index', () => {
    const memoryId = insertMemory(db, { id: 'm1', description: 'deletable', content: 'deletable content' });

    let results = searchFts5(db, 'deletable', {});
    expect(results).toHaveLength(1);

    syncFtsDelete(db, memoryId, 'deletable', 'deletable content');

    results = searchFts5(db, 'deletable', {});
    expect(results).toHaveLength(0);
  });
});

describe('stable memory_id FTS linkage', () => {
  it('does not misjoin after rowid reuse', () => {
    const db = new Database(':memory:');
    try {
      db.exec(`
        CREATE TABLE memories (
          id TEXT PRIMARY KEY,
          description TEXT NOT NULL,
          classification TEXT NOT NULL,
          source_type TEXT NOT NULL,
          content TEXT NOT NULL,
          confidence REAL NOT NULL,
          scope TEXT NOT NULL,
          memory_type TEXT NOT NULL DEFAULT 'episodic',
          dedup_key TEXT,
          last_reinforced_at TEXT,
          archived_at TEXT,
          created_at TEXT NOT NULL
        );
        CREATE VIRTUAL TABLE memories_fts USING fts5(memory_id UNINDEXED, description, content);
      `);

      insertMemory(db, { id: 'm1', description: 'alpha', content: 'alpha content' });
      db.prepare('DELETE FROM memories WHERE id = ?').run('m1');
      insertMemory(db, { id: 'm2', description: 'beta', content: 'beta content' });

      const rows = db.prepare(`
        SELECT m.id, memories_fts.memory_id
        FROM memories_fts
        JOIN memories m ON m.id = memories_fts.memory_id
        WHERE memories_fts MATCH ?
        ORDER BY m.id
      `).all('alpha OR beta') as Array<{ id: string; memory_id: string }>;

      expect(rows).toEqual([
        { id: 'm2', memory_id: 'm2' },
      ]);
    } finally {
      db.close();
    }
  });
});
