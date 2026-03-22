import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { searchFts5, searchChunksFts5, syncFtsDelete, syncFtsInsert } from './fts5-search.js';

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
      workspace_id TEXT,
      project_id TEXT,
      memory_type TEXT NOT NULL DEFAULT 'episodic',
      dedup_key TEXT,
      last_reinforced_at TEXT,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      durable INTEGER NOT NULL DEFAULT 0,
      domain TEXT DEFAULT 'general'
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
    brokenDb.exec('CREATE TABLE memories (id TEXT, description TEXT, content TEXT, confidence REAL, scope TEXT, workspace_id TEXT, project_id TEXT, memory_type TEXT, source_type TEXT, created_at TEXT, last_reinforced_at TEXT, archived_at TEXT, classification TEXT, durable INTEGER NOT NULL DEFAULT 0, domain TEXT DEFAULT \'general\')');
    brokenDb.exec('CREATE VIRTUAL TABLE memories_fts USING fts5(memory_id UNINDEXED, description, content)');
    // Insert with invalid MATCH expression won't reach our try/catch since buildFts5MatchExpression sanitizes.
    // Drop the FTS virtual table to force a runtime error on the FTS path;
    // the LIKE fallback still needs the base `memories` table.
    brokenDb.exec('DROP TABLE memories_fts');
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
          workspace_id TEXT,
          project_id TEXT,
          memory_type TEXT NOT NULL DEFAULT 'episodic',
          dedup_key TEXT,
          last_reinforced_at TEXT,
          archived_at TEXT,
          created_at TEXT NOT NULL,
          durable INTEGER NOT NULL DEFAULT 0,
          domain TEXT DEFAULT 'general'
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

describe('domain filtering', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    // Insert memories with different domains
    db.prepare(
      'INSERT INTO memories (id, description, classification, source_type, content, confidence, scope, memory_type, created_at, domain) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('coding-1', 'vitest mock pattern', 'embeddable', 'coding_session', 'Use in-memory SQLite for testing', 0.8, 'workspace', 'procedural', new Date().toISOString(), 'coding');
    syncFtsInsert(db, 'coding-1', 'vitest mock pattern', 'Use in-memory SQLite for testing');

    db.prepare(
      'INSERT INTO memories (id, description, classification, source_type, content, confidence, scope, memory_type, created_at, domain) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('general-1', 'project goals', 'embeddable', 'curated_memory', 'Build a testing framework', 0.8, 'workspace', 'semantic', new Date().toISOString(), 'general');
    syncFtsInsert(db, 'general-1', 'project goals', 'Build a testing framework');
  });

  afterEach(() => {
    db.close();
  });

  it('filters by single domain', () => {
    const results = searchFts5(db, 'testing', { domains: ['coding'] });
    expect(results.length).toBe(1);
    expect(results[0].memoryId).toBe('coding-1');
    expect(results[0].domain).toBe('coding');
  });

  it('filters by multiple domains', () => {
    const results = searchFts5(db, 'testing', { domains: ['coding', 'general'] });
    expect(results.length).toBe(2);
  });

  it('returns all domains when no domain filter', () => {
    const results = searchFts5(db, 'testing', {});
    expect(results.length).toBe(2);
  });

  it('returns domain field in results', () => {
    const results = searchFts5(db, 'vitest', {});
    expect(results.length).toBe(1);
    expect(results[0].domain).toBe('coding');
  });
});

describe('searchChunksFts5', () => {
  let db: Database.Database;

  function createChunkDb(): Database.Database {
    const chunkDb = new Database(':memory:');
    chunkDb.exec(`
      CREATE TABLE memory_artifacts (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        classification TEXT NOT NULL,
        scope TEXT NOT NULL,
        workspace_id TEXT,
        project_id TEXT,
        namespace_id TEXT NOT NULL,
        source_run_id TEXT,
        source_ref TEXT,
        source_ref_type TEXT,
        captured_at TEXT NOT NULL,
        occurred_at TEXT,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        domain TEXT NOT NULL DEFAULT 'general',
        source_stream_id TEXT,
        artifact_version INTEGER NOT NULL DEFAULT 1,
        context_release_policy TEXT NOT NULL DEFAULT 'full',
        trust_score REAL NOT NULL DEFAULT 0.7,
        invalidated_at TEXT
      );
      CREATE TABLE memory_artifact_chunks (
        id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        source_stream_id TEXT,
        chunk_index INTEGER NOT NULL,
        section_path TEXT,
        chunk_kind TEXT NOT NULL,
        text TEXT NOT NULL,
        text_hash TEXT NOT NULL,
        token_count INTEGER NOT NULL,
        language TEXT,
        classification TEXT NOT NULL,
        context_release_policy TEXT NOT NULL DEFAULT 'full',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        invalidated_at TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE VIRTUAL TABLE memory_artifact_chunks_fts USING fts5(chunk_id UNINDEXED, section_path, text);
    `);
    return chunkDb;
  }

  function insertArtifact(d: Database.Database, id: string, opts: { scope?: string; workspaceId?: string | null; domain?: string; trustScore?: number; invalidatedAt?: string | null } = {}): void {
    d.prepare(
      `INSERT INTO memory_artifacts (id, source_type, classification, scope, workspace_id, project_id, namespace_id, captured_at, content, content_hash, domain, trust_score, invalidated_at)
       VALUES (?, 'workspace_doc', 'internal', ?, ?, NULL, 'ns-1', ?, 'full content', 'hash', ?, ?, ?)`,
    ).run(id, opts.scope ?? 'workspace', opts.workspaceId ?? 'ws-1', new Date().toISOString(), opts.domain ?? 'general', opts.trustScore ?? 0.7, opts.invalidatedAt ?? null);
  }

  function insertChunk(d: Database.Database, id: string, artifactId: string, text: string, opts: { invalidatedAt?: string | null } = {}): void {
    const now = new Date().toISOString();
    d.prepare(
      `INSERT INTO memory_artifact_chunks (id, artifact_id, chunk_index, chunk_kind, text, text_hash, token_count, classification, created_at, updated_at, invalidated_at)
       VALUES (?, ?, 0, 'paragraph', ?, 'hash', 10, 'internal', ?, ?, ?)`,
    ).run(id, artifactId, text, now, now, opts.invalidatedAt ?? null);
    d.prepare('INSERT INTO memory_artifact_chunks_fts (chunk_id, section_path, text) VALUES (?, NULL, ?)').run(id, text);
  }

  beforeEach(() => { db = createChunkDb(); });
  afterEach(() => { db.close(); });

  it('finds chunks matching query text', () => {
    insertArtifact(db, 'a1');
    insertChunk(db, 'c1', 'a1', 'TypeScript migration to strict mode');
    insertChunk(db, 'c2', 'a1', 'Python setup instructions');

    const results = searchChunksFts5(db, 'TypeScript', {});
    expect(results).toHaveLength(1);
    expect(results[0]!.memoryId).toBe('c1');
    expect(results[0]!.layer).toBe('artifact');
    expect(results[0]!.content).toContain('TypeScript');
  });

  it('excludes invalidated chunks', () => {
    insertArtifact(db, 'a1');
    insertChunk(db, 'c1', 'a1', 'Active chunk about databases');
    insertChunk(db, 'c2', 'a1', 'Invalidated chunk about databases', { invalidatedAt: new Date().toISOString() });

    const results = searchChunksFts5(db, 'databases', {});
    expect(results).toHaveLength(1);
    expect(results[0]!.memoryId).toBe('c1');
  });

  it('excludes chunks from invalidated artifacts', () => {
    insertArtifact(db, 'a1', { invalidatedAt: new Date().toISOString() });
    insertChunk(db, 'c1', 'a1', 'Chunk from invalidated artifact about testing');

    const results = searchChunksFts5(db, 'testing', {});
    expect(results).toHaveLength(0);
  });

  it('respects scope filter', () => {
    insertArtifact(db, 'a1', { scope: 'workspace-a' });
    insertArtifact(db, 'a2', { scope: 'workspace-b' });
    insertChunk(db, 'c1', 'a1', 'Shared content about APIs');
    insertChunk(db, 'c2', 'a2', 'Shared content about APIs');

    const results = searchChunksFts5(db, 'APIs', { scope: 'workspace-a' });
    expect(results).toHaveLength(1);
    expect(results[0]!.scope).toBe('workspace-a');
  });

  it('respects domain filter', () => {
    insertArtifact(db, 'a1', { domain: 'coding' });
    insertArtifact(db, 'a2', { domain: 'general' });
    insertChunk(db, 'c1', 'a1', 'Vitest testing patterns');
    insertChunk(db, 'c2', 'a2', 'General testing methodology');

    const results = searchChunksFts5(db, 'testing', { domains: ['coding'] });
    expect(results).toHaveLength(1);
    expect(results[0]!.domain).toBe('coding');
  });

  it('uses artifact trust_score as confidence', () => {
    insertArtifact(db, 'a1', { trustScore: 0.95 });
    insertChunk(db, 'c1', 'a1', 'High trust chunk about architecture');

    const results = searchChunksFts5(db, 'architecture', {});
    expect(results).toHaveLength(1);
    expect(results[0]!.confidence).toBe(0.95);
  });

  it('returns empty for empty query', () => {
    insertArtifact(db, 'a1');
    insertChunk(db, 'c1', 'a1', 'some content');
    const results = searchChunksFts5(db, '', {});
    expect(results).toHaveLength(0);
  });
});
