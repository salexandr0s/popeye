import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { insertChunks, getChunksByArtifact, invalidateChunksByArtifact } from './chunk-store.js';
import type { ChunkResult } from './chunkers/chunker-types.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
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
    CREATE UNIQUE INDEX idx_artifact_chunks_artifact_idx ON memory_artifact_chunks(artifact_id, chunk_index);
    CREATE VIRTUAL TABLE memory_artifact_chunks_fts USING fts5(chunk_id UNINDEXED, section_path, text);
  `);
  return db;
}

const SAMPLE_CHUNKS: ChunkResult[] = [
  { index: 0, sectionPath: '## Setup', chunkKind: 'paragraph', text: 'Install dependencies with npm.', tokenCount: 8, language: null },
  { index: 1, sectionPath: '## Setup', chunkKind: 'code_block', text: 'npm install', tokenCount: 3, language: 'bash' },
  { index: 2, sectionPath: '## Usage', chunkKind: 'paragraph', text: 'Run the application with the start command.', tokenCount: 10, language: null },
];

describe('insertChunks', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('inserts chunks and returns records', () => {
    const rows = insertChunks(db, {
      artifactId: 'art-1',
      sourceStreamId: 'stream-1',
      classification: 'embeddable',
      chunks: SAMPLE_CHUNKS,
    });

    expect(rows).toHaveLength(3);
    expect(rows[0]!.artifactId).toBe('art-1');
    expect(rows[0]!.sourceStreamId).toBe('stream-1');
    expect(rows[0]!.chunkIndex).toBe(0);
    expect(rows[0]!.sectionPath).toBe('## Setup');
    expect(rows[0]!.chunkKind).toBe('paragraph');
    expect(rows[1]!.chunkKind).toBe('code_block');
    expect(rows[1]!.language).toBe('bash');
  });

  it('syncs FTS index', () => {
    insertChunks(db, {
      artifactId: 'art-1',
      sourceStreamId: null,
      classification: 'embeddable',
      chunks: SAMPLE_CHUNKS,
    });

    const ftsResults = db.prepare(
      "SELECT chunk_id FROM memory_artifact_chunks_fts WHERE memory_artifact_chunks_fts MATCH 'dependencies'",
    ).all() as Array<{ chunk_id: string }>;
    expect(ftsResults).toHaveLength(1);
  });

  it('computes text hashes', () => {
    const rows = insertChunks(db, {
      artifactId: 'art-1',
      sourceStreamId: null,
      classification: 'embeddable',
      chunks: SAMPLE_CHUNKS,
    });

    expect(rows[0]!.textHash).toBeTruthy();
    expect(rows[0]!.textHash).toHaveLength(64); // SHA-256 hex
  });
});

describe('getChunksByArtifact', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('returns chunks in order', () => {
    insertChunks(db, {
      artifactId: 'art-1',
      sourceStreamId: null,
      classification: 'embeddable',
      chunks: SAMPLE_CHUNKS,
    });

    const chunks = getChunksByArtifact(db, 'art-1');
    expect(chunks).toHaveLength(3);
    expect(chunks[0]!.chunkIndex).toBe(0);
    expect(chunks[1]!.chunkIndex).toBe(1);
    expect(chunks[2]!.chunkIndex).toBe(2);
  });

  it('excludes invalidated chunks', () => {
    insertChunks(db, {
      artifactId: 'art-1',
      sourceStreamId: null,
      classification: 'embeddable',
      chunks: SAMPLE_CHUNKS,
    });

    invalidateChunksByArtifact(db, 'art-1');

    const chunks = getChunksByArtifact(db, 'art-1');
    expect(chunks).toHaveLength(0);
  });

  it('returns empty for unknown artifact', () => {
    const chunks = getChunksByArtifact(db, 'nonexistent');
    expect(chunks).toHaveLength(0);
  });
});

describe('invalidateChunksByArtifact', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('invalidates all chunks and removes from FTS', () => {
    insertChunks(db, {
      artifactId: 'art-1',
      sourceStreamId: null,
      classification: 'embeddable',
      chunks: SAMPLE_CHUNKS,
    });

    const count = invalidateChunksByArtifact(db, 'art-1');
    expect(count).toBe(3);

    // Check invalidated_at is set
    const rows = db.prepare('SELECT invalidated_at FROM memory_artifact_chunks WHERE artifact_id = ?').all('art-1') as Array<{ invalidated_at: string | null }>;
    for (const row of rows) {
      expect(row.invalidated_at).toBeTruthy();
    }

    // FTS should be empty
    const ftsResults = db.prepare(
      "SELECT chunk_id FROM memory_artifact_chunks_fts WHERE memory_artifact_chunks_fts MATCH 'dependencies'",
    ).all();
    expect(ftsResults).toHaveLength(0);
  });

  it('returns 0 for unknown artifact', () => {
    const count = invalidateChunksByArtifact(db, 'nonexistent');
    expect(count).toBe(0);
  });

  it('is idempotent — does not double-invalidate', () => {
    insertChunks(db, {
      artifactId: 'art-1',
      sourceStreamId: null,
      classification: 'embeddable',
      chunks: SAMPLE_CHUNKS,
    });

    invalidateChunksByArtifact(db, 'art-1');
    const count = invalidateChunksByArtifact(db, 'art-1');
    expect(count).toBe(0);
  });
});
