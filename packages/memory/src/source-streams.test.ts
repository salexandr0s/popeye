import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sha256 } from '@popeye/observability';
import {
  resolveOrCreateSourceStream,
  hasContentChanged,
  updateSourceStreamStatus,
  markSourceStreamDeleted,
  buildStableKey,
} from './source-streams.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE memory_namespaces (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      external_ref TEXT,
      label TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE memory_source_streams (
      id TEXT PRIMARY KEY,
      stable_key TEXT NOT NULL,
      provider_kind TEXT NOT NULL,
      source_type TEXT NOT NULL,
      external_id TEXT,
      namespace_id TEXT NOT NULL,
      workspace_id TEXT,
      project_id TEXT,
      title TEXT,
      canonical_uri TEXT,
      classification TEXT NOT NULL,
      context_release_policy TEXT NOT NULL DEFAULT 'full',
      trust_tier INTEGER NOT NULL DEFAULT 3,
      trust_score REAL NOT NULL DEFAULT 0.7,
      ingestion_status TEXT NOT NULL DEFAULT 'ready',
      last_processed_hash TEXT,
      last_sync_cursor TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE UNIQUE INDEX idx_source_streams_stable_key ON memory_source_streams(stable_key);
  `);
  return db;
}

describe('resolveOrCreateSourceStream', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('creates a new source stream', () => {
    const result = resolveOrCreateSourceStream(db, {
      stableKey: 'file:ws1:docs/readme.md',
      providerKind: 'runtime',
      sourceType: 'workspace_doc',
      scope: 'workspace/ws1',
      classification: 'embeddable',
    });

    expect(result.id).toBeTruthy();
    expect(result.stableKey).toBe('file:ws1:docs/readme.md');
    expect(result.providerKind).toBe('runtime');
    expect(result.sourceType).toBe('workspace_doc');
    expect(result.ingestionStatus).toBe('ready');
    expect(result.lastProcessedHash).toBeNull();
  });

  it('returns existing stream for same stable key', () => {
    const first = resolveOrCreateSourceStream(db, {
      stableKey: 'file:ws1:docs/readme.md',
      providerKind: 'runtime',
      sourceType: 'workspace_doc',
      scope: 'workspace/ws1',
      classification: 'embeddable',
    });

    const second = resolveOrCreateSourceStream(db, {
      stableKey: 'file:ws1:docs/readme.md',
      providerKind: 'runtime',
      sourceType: 'workspace_doc',
      scope: 'workspace/ws1',
      classification: 'embeddable',
    });

    expect(second.id).toBe(first.id);
  });

  it('creates separate streams for different stable keys', () => {
    const a = resolveOrCreateSourceStream(db, {
      stableKey: 'file:ws1:a.md',
      providerKind: 'runtime',
      sourceType: 'workspace_doc',
      scope: 'workspace/ws1',
      classification: 'embeddable',
    });

    const b = resolveOrCreateSourceStream(db, {
      stableKey: 'file:ws1:b.md',
      providerKind: 'runtime',
      sourceType: 'workspace_doc',
      scope: 'workspace/ws1',
      classification: 'embeddable',
    });

    expect(a.id).not.toBe(b.id);
  });

  it('marks stream as deleted', () => {
    const stream = resolveOrCreateSourceStream(db, {
      stableKey: 'file:ws1:a.md',
      providerKind: 'runtime',
      sourceType: 'workspace_doc',
      scope: 'workspace/ws1',
      classification: 'embeddable',
    });

    markSourceStreamDeleted(db, stream.id);

    const row = db.prepare('SELECT ingestion_status, deleted_at FROM memory_source_streams WHERE id = ?').get(stream.id) as {
      ingestion_status: string;
      deleted_at: string | null;
    };
    expect(row.ingestion_status).toBe('deleted');
    expect(row.deleted_at).toBeTruthy();
  });
});

describe('hasContentChanged', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('returns true when no hash is stored', () => {
    const stream = resolveOrCreateSourceStream(db, {
      stableKey: 'test:1',
      providerKind: 'runtime',
      sourceType: 'workspace_doc',
      scope: 'global',
      classification: 'embeddable',
    });
    expect(hasContentChanged(db, stream.id, 'hello world')).toBe(true);
  });

  it('returns false when hash matches', () => {
    const stream = resolveOrCreateSourceStream(db, {
      stableKey: 'test:2',
      providerKind: 'runtime',
      sourceType: 'workspace_doc',
      scope: 'global',
      classification: 'embeddable',
    });

    updateSourceStreamStatus(db, stream.id, 'done', sha256('hello'));

    expect(hasContentChanged(db, stream.id, 'hello')).toBe(false);
  });

  it('returns true when content differs', () => {
    const stream = resolveOrCreateSourceStream(db, {
      stableKey: 'test:3',
      providerKind: 'runtime',
      sourceType: 'workspace_doc',
      scope: 'global',
      classification: 'embeddable',
    });

    updateSourceStreamStatus(db, stream.id, 'done', sha256('hello'));

    expect(hasContentChanged(db, stream.id, 'world')).toBe(true);
  });
});

describe('updateSourceStreamStatus', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('updates status and hash', () => {
    const stream = resolveOrCreateSourceStream(db, {
      stableKey: 'test:status',
      providerKind: 'runtime',
      sourceType: 'workspace_doc',
      scope: 'global',
      classification: 'embeddable',
    });

    updateSourceStreamStatus(db, stream.id, 'done', 'abc123');

    const row = db.prepare('SELECT ingestion_status, last_processed_hash FROM memory_source_streams WHERE id = ?').get(stream.id) as {
      ingestion_status: string;
      last_processed_hash: string | null;
    };
    expect(row.ingestion_status).toBe('done');
    expect(row.last_processed_hash).toBe('abc123');
  });
});

describe('buildStableKey', () => {
  it('builds a deterministic key from parts', () => {
    const key = buildStableKey('workspace_doc', { workspace: 'ws1', ref: 'docs/readme.md' });
    expect(key).toBe('workspace_doc:workspace:ws1:ref:docs/readme.md');
  });

  it('skips null/undefined parts', () => {
    const key = buildStableKey('receipt', { workspace: null, ref: 'run-123' });
    expect(key).toBe('receipt:ref:run-123');
  });
});
