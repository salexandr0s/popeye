import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildLikeQuery, searchLikeFallback, splitQueryTokens } from './like-fallback.js';
import { searchFts5 } from './fts5-search.js';

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
      source_run_id TEXT,
      source_timestamp TEXT,
      created_at TEXT NOT NULL,
      durable INTEGER NOT NULL DEFAULT 0
    );
    CREATE VIRTUAL TABLE memories_fts USING fts5(memory_id UNINDEXED, description, content);
  `);
  return db;
}

function insertMemory(db: Database.Database, overrides: Partial<{
  id: string; description: string; content: string; confidence: number;
  scope: string; memoryType: string; sourceType: string;
}> = {}): string {
  const id = overrides.id ?? `mem-${Math.random().toString(36).slice(2)}`;
  db.prepare(`INSERT INTO memories (id, description, classification, source_type, content, confidence, scope, memory_type, created_at, durable)
    VALUES (?, ?, 'embeddable', ?, ?, ?, ?, ?, datetime('now'), 0)`).run(
    id,
    overrides.description ?? 'Test memory',
    overrides.sourceType ?? 'curated_memory',
    overrides.content ?? 'Test content',
    overrides.confidence ?? 0.8,
    overrides.scope ?? 'workspace',
    overrides.memoryType ?? 'semantic',
  );
  // Also insert into FTS for integration tests
  db.prepare('INSERT INTO memories_fts(memory_id, description, content) VALUES (?, ?, ?)').run(
    id, overrides.description ?? 'Test memory', overrides.content ?? 'Test content',
  );
  return id;
}

describe('splitQueryTokens', () => {
  it('splits simple query into tokens', () => {
    expect(splitQueryTokens('hello world')).toEqual(['hello', 'world']);
  });

  it('removes FTS5 operators', () => {
    expect(splitQueryTokens('"exact phrase" OR fallback')).toEqual(['exact', 'phrase', 'fallback']);
  });

  it('removes single-char tokens', () => {
    expect(splitQueryTokens('a bc d ef')).toEqual(['bc', 'ef']);
  });

  it('lowercases tokens', () => {
    expect(splitQueryTokens('TypeScript Migration')).toEqual(['typescript', 'migration']);
  });

  it('returns empty array for empty query', () => {
    expect(splitQueryTokens('')).toEqual([]);
    expect(splitQueryTokens('   ')).toEqual([]);
  });

  it('handles special characters', () => {
    expect(splitQueryTokens('test* ^prefix (grouped)')).toEqual(['test', 'prefix', 'grouped']);
  });
});

describe('buildLikeQuery', () => {
  it('builds SQL with token LIKE conditions', () => {
    const { sql, params } = buildLikeQuery('hello world', {});
    expect(sql).toContain('LIKE');
    expect(sql).toContain('LIMIT');
    // 2 tokens x 2 patterns each = 4, plus limit param = 5
    expect(params).toHaveLength(5);
  });

  it('returns empty for empty query', () => {
    const { sql, params } = buildLikeQuery('', {});
    expect(sql).toBe('');
    expect(params).toEqual([]);
  });

  it('applies scope filter', () => {
    const { sql, params } = buildLikeQuery('test', { scope: 'workspace-a' });
    expect(sql).toContain('scope = ?');
    expect(params).toContain('workspace-a');
  });

  it('applies minConfidence filter', () => {
    const { sql, params } = buildLikeQuery('test', { minConfidence: 0.5 });
    expect(sql).toContain('confidence >= ?');
    expect(params).toContain(0.5);
  });

  it('applies memoryTypes filter', () => {
    const { sql, params } = buildLikeQuery('test', { memoryTypes: ['semantic', 'procedural'] });
    expect(sql).toContain('memory_type IN');
    expect(params).toContain('semantic');
    expect(params).toContain('procedural');
  });

  it('respects custom limit', () => {
    const { params } = buildLikeQuery('test', { limit: 10 });
    expect(params[params.length - 1]).toBe(10);
  });
});

describe('searchLikeFallback', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('finds memories by content LIKE match', () => {
    insertMemory(db, { description: 'TypeScript migration', content: 'We migrated to TypeScript' });
    insertMemory(db, { description: 'Python setup', content: 'Setting up Python env' });

    const results = searchLikeFallback(db, 'typescript', {});
    expect(results).toHaveLength(1);
    expect(results[0]!.description).toBe('TypeScript migration');
  });

  it('finds memories by description LIKE match', () => {
    insertMemory(db, { description: 'Database migration plan', content: 'Plan content here' });

    const results = searchLikeFallback(db, 'migration', {});
    expect(results).toHaveLength(1);
    expect(results[0]!.description).toBe('Database migration plan');
  });

  it('excludes archived memories', () => {
    const id = insertMemory(db, { description: 'Archived item', content: 'This is archived' });
    db.prepare("UPDATE memories SET archived_at = datetime('now') WHERE id = ?").run(id);

    const results = searchLikeFallback(db, 'archived', {});
    expect(results).toHaveLength(0);
  });

  it('computes synthetic rank with FTS5 polarity (closer to 0 = more relevant)', () => {
    insertMemory(db, { description: 'TypeScript migration guide', content: 'Complete migration from JS to TypeScript' });
    insertMemory(db, { description: 'Random note', content: 'This mentions typescript once' });

    const results = searchLikeFallback(db, 'typescript migration', {});
    expect(results.length).toBe(2);
    // All results should have negative ftsRank
    for (const r of results) {
      expect(r.ftsRank).toBeLessThan(0);
    }
    // First memory matches both "typescript" and "migration", second only "typescript"
    const twoMatch = results.find((r) => r.description === 'TypeScript migration guide')!;
    const oneMatch = results.find((r) => r.description === 'Random note')!;
    // FTS5 convention: closer to 0 = more relevant
    expect(twoMatch.ftsRank).toBeGreaterThan(oneMatch.ftsRank);
  });

  it('filters by scope', () => {
    insertMemory(db, { description: 'Workspace A data', content: 'Data for A', scope: 'ws-a' });
    insertMemory(db, { description: 'Workspace B data', content: 'Data for B', scope: 'ws-b' });

    const results = searchLikeFallback(db, 'data', { scope: 'ws-a' });
    expect(results).toHaveLength(1);
    expect(results[0]!.scope).toBe('ws-a');
  });

  it('filters by memoryTypes', () => {
    insertMemory(db, { description: 'Semantic mem', content: 'Semantic content here', memoryType: 'semantic' });
    insertMemory(db, { description: 'Episodic mem', content: 'Episodic content here', memoryType: 'episodic' });

    const results = searchLikeFallback(db, 'content', { memoryTypes: ['semantic'] });
    expect(results).toHaveLength(1);
    expect(results[0]!.memoryType).toBe('semantic');
  });

  it('returns empty for empty query', () => {
    insertMemory(db, { description: 'Some memory', content: 'Some content' });
    const results = searchLikeFallback(db, '', {});
    expect(results).toHaveLength(0);
  });

  it('respects limit parameter', () => {
    for (let i = 0; i < 10; i++) {
      insertMemory(db, { description: `Testing memory ${i}`, content: `Testing content ${i}` });
    }
    const results = searchLikeFallback(db, 'testing', {}, 3);
    expect(results).toHaveLength(3);
  });
});

describe('FTS5 -> LIKE fallback integration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('searchFts5 falls back to LIKE when FTS5 table is broken', () => {
    // Insert a memory directly into the memories table (skip FTS)
    db.prepare(`INSERT INTO memories (id, description, classification, source_type, content, confidence, scope, memory_type, created_at, durable)
      VALUES ('m1', 'Broken FTS test', 'embeddable', 'curated_memory', 'Content that should be found via LIKE fallback', 0.8, 'workspace', 'semantic', datetime('now'), 0)`).run();

    // Drop the FTS table entirely — any query referencing it will throw
    db.exec('DROP TABLE memories_fts');

    // searchFts5 should fall back to LIKE and still find the memory
    const results = searchFts5(db, 'broken', {});
    expect(results).toHaveLength(1);
    expect(results[0]!.memoryId).toBe('m1');
    expect(results[0]!.description).toBe('Broken FTS test');
  });
});
