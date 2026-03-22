import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { searchChunksFts5 } from './fts5-search.js';

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
