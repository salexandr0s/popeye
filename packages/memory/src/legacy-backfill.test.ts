import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { backfillLegacyMemories } from './legacy-backfill.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    -- Legacy memories table
    CREATE TABLE memories (
      id TEXT PRIMARY KEY, description TEXT NOT NULL, classification TEXT NOT NULL,
      source_type TEXT NOT NULL, content TEXT NOT NULL, confidence REAL NOT NULL,
      scope TEXT NOT NULL, created_at TEXT NOT NULL,
      memory_type TEXT DEFAULT 'episodic', dedup_key TEXT,
      last_reinforced_at TEXT, archived_at TEXT,
      source_run_id TEXT, source_timestamp TEXT,
      durable INTEGER NOT NULL DEFAULT 0,
      workspace_id TEXT, project_id TEXT, namespace_id TEXT,
      domain TEXT DEFAULT 'general'
    );

    -- Structured tables
    CREATE TABLE memory_namespaces (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, external_ref TEXT,
      label TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE memory_source_streams (
      id TEXT PRIMARY KEY, stable_key TEXT UNIQUE, provider_kind TEXT NOT NULL,
      source_type TEXT NOT NULL, external_id TEXT, namespace_id TEXT NOT NULL,
      workspace_id TEXT, project_id TEXT, title TEXT, canonical_uri TEXT,
      classification TEXT NOT NULL, context_release_policy TEXT NOT NULL DEFAULT 'full',
      trust_tier INTEGER NOT NULL DEFAULT 3, trust_score REAL NOT NULL DEFAULT 0.7,
      ingestion_status TEXT NOT NULL DEFAULT 'ready', last_processed_hash TEXT,
      last_sync_cursor TEXT, metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE TABLE memory_artifacts (
      id TEXT PRIMARY KEY, source_type TEXT NOT NULL, classification TEXT NOT NULL,
      scope TEXT NOT NULL, workspace_id TEXT, project_id TEXT, namespace_id TEXT NOT NULL,
      source_run_id TEXT, source_ref TEXT, source_ref_type TEXT, captured_at TEXT NOT NULL,
      occurred_at TEXT, content TEXT NOT NULL, content_hash TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}', domain TEXT NOT NULL DEFAULT 'general',
      source_stream_id TEXT, artifact_version INTEGER NOT NULL DEFAULT 1,
      context_release_policy TEXT NOT NULL DEFAULT 'full',
      trust_score REAL NOT NULL DEFAULT 0.7, invalidated_at TEXT
    );
    CREATE TABLE memory_artifact_chunks (
      id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, source_stream_id TEXT,
      chunk_index INTEGER NOT NULL, section_path TEXT, chunk_kind TEXT NOT NULL,
      text TEXT NOT NULL, text_hash TEXT NOT NULL, token_count INTEGER NOT NULL,
      language TEXT, classification TEXT NOT NULL, context_release_policy TEXT NOT NULL DEFAULT 'full',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, invalidated_at TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE UNIQUE INDEX idx_artifact_chunks_unique ON memory_artifact_chunks(artifact_id, chunk_index);
    CREATE VIRTUAL TABLE memory_artifact_chunks_fts USING fts5(chunk_id UNINDEXED, section_path, text);
    CREATE TABLE memory_facts (
      id TEXT PRIMARY KEY, namespace_id TEXT NOT NULL, scope TEXT NOT NULL,
      workspace_id TEXT, project_id TEXT, classification TEXT NOT NULL,
      source_type TEXT NOT NULL, memory_type TEXT NOT NULL, fact_kind TEXT NOT NULL,
      text TEXT NOT NULL, confidence REAL NOT NULL, source_reliability REAL NOT NULL,
      extraction_confidence REAL NOT NULL, human_confirmed INTEGER NOT NULL DEFAULT 0,
      occurred_at TEXT, valid_from TEXT, valid_to TEXT, source_run_id TEXT,
      source_timestamp TEXT, dedup_key TEXT, last_reinforced_at TEXT, archived_at TEXT,
      created_at TEXT NOT NULL, durable INTEGER NOT NULL DEFAULT 0,
      revision_status TEXT NOT NULL DEFAULT 'active', domain TEXT DEFAULT 'general',
      root_fact_id TEXT, parent_fact_id TEXT, is_latest INTEGER NOT NULL DEFAULT 1,
      claim_key TEXT, salience REAL NOT NULL DEFAULT 0.5,
      support_count INTEGER NOT NULL DEFAULT 1,
      source_trust_score REAL NOT NULL DEFAULT 0.7,
      context_release_policy TEXT NOT NULL DEFAULT 'full',
      forget_after TEXT, stale_after TEXT, expired_at TEXT, invalidated_at TEXT,
      operator_status TEXT NOT NULL DEFAULT 'normal'
    );
    CREATE UNIQUE INDEX idx_memory_facts_dedup_key ON memory_facts(dedup_key) WHERE dedup_key IS NOT NULL;
    CREATE INDEX idx_facts_claim_key ON memory_facts(claim_key);
    CREATE INDEX idx_facts_is_latest ON memory_facts(is_latest, archived_at);
    CREATE VIRTUAL TABLE memory_facts_fts USING fts5(fact_id UNINDEXED, text);
    CREATE TABLE memory_fact_sources (
      id TEXT PRIMARY KEY, fact_id TEXT NOT NULL, artifact_id TEXT NOT NULL,
      excerpt TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE memory_tags (
      id TEXT PRIMARY KEY, owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL,
      tag TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE memory_relations (
      id TEXT PRIMARY KEY, relation_type TEXT NOT NULL,
      source_kind TEXT NOT NULL, source_id TEXT NOT NULL,
      target_kind TEXT NOT NULL, target_id TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0, created_by TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '', metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

function insertLegacyMemory(db: Database.Database, id: string, content: string, opts: { archived?: boolean } = {}): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO memories (id, description, classification, source_type, content, confidence, scope, created_at, memory_type, archived_at)
     VALUES (?, ?, 'internal', 'curated_memory', ?, 0.8, 'workspace', ?, 'semantic', ?)`,
  ).run(id, `Description for ${id}`, content, now, opts.archived ? now : null);
}

describe('backfillLegacyMemories', () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('backfills a legacy memory into structured layers', () => {
    insertLegacyMemory(db, 'mem-1', 'The user prefers dark mode and vim keybindings for all editors.');

    const result = backfillLegacyMemories(db, {
      scope: 'workspace',
      namespaceId: 'ns-test',
      classification: 'internal',
    });

    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);

    // Source stream created
    const streams = db.prepare('SELECT * FROM memory_source_streams WHERE stable_key = ?').all('legacy:mem-1');
    expect(streams).toHaveLength(1);

    // Artifact created
    const artifacts = db.prepare('SELECT * FROM memory_artifacts').all();
    expect(artifacts.length).toBeGreaterThanOrEqual(1);

    // Facts extracted
    const facts = db.prepare('SELECT * FROM memory_facts').all();
    expect(facts.length).toBeGreaterThanOrEqual(1);
  });

  it('skips unchanged content on re-run', () => {
    insertLegacyMemory(db, 'mem-1', 'The user prefers dark mode and vim keybindings for all editors.');

    const first = backfillLegacyMemories(db, {
      scope: 'workspace',
      namespaceId: 'ns-test',
      classification: 'internal',
    });
    expect(first.processed).toBe(1);

    const second = backfillLegacyMemories(db, {
      scope: 'workspace',
      namespaceId: 'ns-test',
      classification: 'internal',
    });
    expect(second.skipped).toBe(1);
    expect(second.processed).toBe(0);
  });

  it('handles empty memories table gracefully', () => {
    const result = backfillLegacyMemories(db, {
      scope: 'workspace',
      namespaceId: 'ns-test',
      classification: 'internal',
    });

    expect(result.processed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
  });

  it('skips archived memories', () => {
    insertLegacyMemory(db, 'mem-1', 'Archived memory content that should not be processed.', { archived: true });

    const result = backfillLegacyMemories(db, {
      scope: 'workspace',
      namespaceId: 'ns-test',
      classification: 'internal',
    });

    expect(result.processed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
  });

  it('returns correct counts for mixed batch', () => {
    insertLegacyMemory(db, 'mem-1', 'First memory with enough content to extract facts from the system.');
    insertLegacyMemory(db, 'mem-2', 'Second memory with enough content to also extract facts from the system.');
    insertLegacyMemory(db, 'mem-3', 'Third memory that will be pre-processed so it gets skipped on re-run.');

    // Pre-process mem-3
    backfillLegacyMemories(db, {
      scope: 'workspace',
      namespaceId: 'ns-test',
      classification: 'internal',
      batchSize: 100,
    });

    // Re-run — all 3 should be skipped
    const result = backfillLegacyMemories(db, {
      scope: 'workspace',
      namespaceId: 'ns-test',
      classification: 'internal',
    });

    expect(result.skipped).toBe(3);
    expect(result.processed).toBe(0);
  });
});
