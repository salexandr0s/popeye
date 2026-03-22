import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  runTtlExpiry,
  runStalenessMarking,
  runSourceDeletionCascade,
  pinFact,
  protectFact,
  forgetFact,
  unpinFact,
  pinSynthesis,
} from './memory-governance.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE memory_facts (
      id TEXT PRIMARY KEY, namespace_id TEXT NOT NULL, scope TEXT NOT NULL,
      workspace_id TEXT, project_id TEXT, classification TEXT NOT NULL,
      source_type TEXT NOT NULL, memory_type TEXT NOT NULL, fact_kind TEXT NOT NULL,
      text TEXT NOT NULL, confidence REAL NOT NULL, source_reliability REAL NOT NULL DEFAULT 0.9,
      extraction_confidence REAL NOT NULL DEFAULT 0.85, human_confirmed INTEGER NOT NULL DEFAULT 0,
      occurred_at TEXT, valid_from TEXT, valid_to TEXT, source_run_id TEXT,
      source_timestamp TEXT, dedup_key TEXT, last_reinforced_at TEXT, archived_at TEXT,
      created_at TEXT NOT NULL, durable INTEGER NOT NULL DEFAULT 0,
      revision_status TEXT NOT NULL DEFAULT 'active', domain TEXT DEFAULT 'general',
      root_fact_id TEXT, parent_fact_id TEXT, is_latest INTEGER NOT NULL DEFAULT 1,
      claim_key TEXT, salience REAL NOT NULL DEFAULT 0.5,
      support_count INTEGER NOT NULL DEFAULT 1, source_trust_score REAL NOT NULL DEFAULT 0.7,
      context_release_policy TEXT NOT NULL DEFAULT 'full',
      forget_after TEXT, stale_after TEXT, expired_at TEXT, invalidated_at TEXT,
      operator_status TEXT NOT NULL DEFAULT 'normal'
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
      language TEXT, classification TEXT NOT NULL,
      context_release_policy TEXT NOT NULL DEFAULT 'full',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, invalidated_at TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE VIRTUAL TABLE memory_artifact_chunks_fts USING fts5(chunk_id UNINDEXED, section_path, text);
    CREATE TABLE memory_fact_sources (
      id TEXT PRIMARY KEY, fact_id TEXT NOT NULL, artifact_id TEXT NOT NULL,
      excerpt TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE memory_syntheses (
      id TEXT PRIMARY KEY, namespace_id TEXT NOT NULL, scope TEXT NOT NULL,
      workspace_id TEXT, project_id TEXT, classification TEXT NOT NULL,
      synthesis_kind TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL,
      confidence REAL NOT NULL, refresh_policy TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT,
      domain TEXT NOT NULL DEFAULT 'general', subject_kind TEXT, subject_id TEXT,
      refresh_due_at TEXT, salience REAL NOT NULL DEFAULT 0.5,
      quality_score REAL NOT NULL DEFAULT 0.7,
      context_release_policy TEXT NOT NULL DEFAULT 'full',
      invalidated_at TEXT, operator_status TEXT NOT NULL DEFAULT 'normal'
    );
    CREATE TABLE memory_synthesis_sources (
      id TEXT PRIMARY KEY, synthesis_id TEXT NOT NULL, fact_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE memory_operator_actions (
      id TEXT PRIMARY KEY, action_kind TEXT NOT NULL, target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
    );
  `);
  return db;
}

function insertFact(db: Database.Database, id: string, opts: { forgetAfter?: string; staleAfter?: string; confidence?: number } = {}): void {
  db.prepare(
    `INSERT INTO memory_facts (id, namespace_id, scope, classification, source_type, memory_type,
      fact_kind, text, confidence, created_at, forget_after, stale_after, is_latest)
     VALUES (?, 'ns-1', 'workspace', 'internal', 'receipt', 'semantic', 'preference', 'test', ?, ?, ?, ?, 1)`,
  ).run(id, opts.confidence ?? 0.8, new Date().toISOString(), opts.forgetAfter ?? null, opts.staleAfter ?? null);
}

describe('runTtlExpiry', () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('expires facts with forget_after in the past', () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    insertFact(db, 'f1', { forgetAfter: past });
    insertFact(db, 'f2'); // no TTL

    const result = runTtlExpiry(db);
    expect(result.expired).toBe(1);

    const row = db.prepare('SELECT expired_at, archived_at FROM memory_facts WHERE id = ?').get('f1') as Record<string, string | null>;
    expect(row.expired_at).toBeTruthy();
    expect(row.archived_at).toBeTruthy();

    const f2 = db.prepare('SELECT expired_at FROM memory_facts WHERE id = ?').get('f2') as Record<string, string | null>;
    expect(f2.expired_at).toBeNull();
  });

  it('skips already expired facts', () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    insertFact(db, 'f1', { forgetAfter: past });
    runTtlExpiry(db);

    const result = runTtlExpiry(db);
    expect(result.expired).toBe(0);
  });

  it('returns 0 when no facts have TTL', () => {
    insertFact(db, 'f1');
    expect(runTtlExpiry(db).expired).toBe(0);
  });
});

describe('runStalenessMarking', () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('halves confidence for stale facts and clears stale_after', () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    insertFact(db, 'f1', { staleAfter: past, confidence: 0.8 });

    const result = runStalenessMarking(db);
    expect(result.marked).toBe(1);

    const row = db.prepare('SELECT confidence, stale_after FROM memory_facts WHERE id = ?').get('f1') as { confidence: number; stale_after: string | null };
    expect(row.confidence).toBeCloseTo(0.4, 5);
    expect(row.stale_after).toBeNull();
  });

  it('does not re-process after stale_after cleared', () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    insertFact(db, 'f1', { staleAfter: past, confidence: 0.8 });
    runStalenessMarking(db);

    const result = runStalenessMarking(db);
    expect(result.marked).toBe(0);
  });
});

describe('runSourceDeletionCascade', () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('cascades from source → artifacts → chunks → facts', () => {
    // Set up: artifact from source, chunk from artifact, fact linked to artifact
    db.prepare(
      `INSERT INTO memory_artifacts (id, source_type, classification, scope, namespace_id, captured_at, content, content_hash, source_stream_id)
       VALUES ('a1', 'receipt', 'internal', 'workspace', 'ns-1', ?, 'content', 'hash', 'stream-1')`,
    ).run(new Date().toISOString());

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO memory_artifact_chunks (id, artifact_id, chunk_index, chunk_kind, text, text_hash, token_count, classification, created_at, updated_at)
       VALUES ('c1', 'a1', 0, 'paragraph', 'chunk text', 'hash', 5, 'internal', ?, ?)`,
    ).run(now, now);
    db.prepare('INSERT INTO memory_artifact_chunks_fts (chunk_id, section_path, text) VALUES (?, NULL, ?)').run('c1', 'chunk text');

    insertFact(db, 'f1');
    db.prepare('INSERT INTO memory_fact_sources (id, fact_id, artifact_id, created_at) VALUES (?, ?, ?, ?)').run('fs1', 'f1', 'a1', now);

    const result = runSourceDeletionCascade(db, 'stream-1');
    expect(result.artifactsInvalidated).toBe(1);
    expect(result.chunksInvalidated).toBe(1);
    expect(result.factsInvalidated).toBe(1);

    const artifact = db.prepare('SELECT invalidated_at FROM memory_artifacts WHERE id = ?').get('a1') as Record<string, string | null>;
    expect(artifact.invalidated_at).toBeTruthy();

    const fact = db.prepare('SELECT invalidated_at FROM memory_facts WHERE id = ?').get('f1') as Record<string, string | null>;
    expect(fact.invalidated_at).toBeTruthy();
  });

  it('does not invalidate facts with other valid evidence', () => {
    const now = new Date().toISOString();
    // Two artifacts from different sources
    db.prepare(
      `INSERT INTO memory_artifacts (id, source_type, classification, scope, namespace_id, captured_at, content, content_hash, source_stream_id)
       VALUES ('a1', 'receipt', 'internal', 'workspace', 'ns-1', ?, 'c1', 'h1', 'stream-1'),
              ('a2', 'receipt', 'internal', 'workspace', 'ns-1', ?, 'c2', 'h2', 'stream-2')`,
    ).run(now, now);

    insertFact(db, 'f1');
    db.prepare('INSERT INTO memory_fact_sources (id, fact_id, artifact_id, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)').run('fs1', 'f1', 'a1', now, 'fs2', 'f1', 'a2', now);

    const result = runSourceDeletionCascade(db, 'stream-1');
    expect(result.artifactsInvalidated).toBe(1);
    expect(result.factsInvalidated).toBe(0); // f1 still has valid evidence from a2
  });
});

describe('operator actions', () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('pins a fact and records the action', () => {
    insertFact(db, 'f1');
    const action = pinFact(db, 'f1', 'Important fact');

    expect(action.actionKind).toBe('pin');
    expect(action.targetKind).toBe('fact');
    expect(action.targetId).toBe('f1');

    const row = db.prepare('SELECT operator_status FROM memory_facts WHERE id = ?').get('f1') as { operator_status: string };
    expect(row.operator_status).toBe('pinned');

    const actions = db.prepare('SELECT * FROM memory_operator_actions WHERE target_id = ?').all('f1') as Array<Record<string, unknown>>;
    expect(actions).toHaveLength(1);
  });

  it('protects a fact', () => {
    insertFact(db, 'f1');
    protectFact(db, 'f1', 'Keep this');

    const row = db.prepare('SELECT operator_status FROM memory_facts WHERE id = ?').get('f1') as { operator_status: string };
    expect(row.operator_status).toBe('protected');
  });

  it('forgets a fact (archives + expires)', () => {
    insertFact(db, 'f1');
    forgetFact(db, 'f1', 'No longer relevant');

    const row = db.prepare('SELECT operator_status, archived_at, expired_at FROM memory_facts WHERE id = ?').get('f1') as Record<string, string>;
    expect(row.operator_status).toBe('rejected');
    expect(row.archived_at).toBeTruthy();
    expect(row.expired_at).toBeTruthy();
  });

  it('unpins a fact back to normal', () => {
    insertFact(db, 'f1');
    pinFact(db, 'f1', 'Pin');
    unpinFact(db, 'f1', 'No longer critical');

    const row = db.prepare('SELECT operator_status FROM memory_facts WHERE id = ?').get('f1') as { operator_status: string };
    expect(row.operator_status).toBe('normal');

    const actions = db.prepare('SELECT * FROM memory_operator_actions WHERE target_id = ?').all('f1') as Array<Record<string, unknown>>;
    expect(actions).toHaveLength(2); // pin + unpin
  });

  it('pins a synthesis', () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO memory_syntheses (id, namespace_id, scope, classification, synthesis_kind, title, text, confidence, created_at, updated_at, domain)
       VALUES ('s1', 'ns-1', 'workspace', 'internal', 'profile_static', 'Static Profile', 'content', 0.8, ?, ?, 'general')`,
    ).run(now, now);

    const action = pinSynthesis(db, 's1', 'Keep this profile');

    expect(action.actionKind).toBe('pin');
    expect(action.targetKind).toBe('synthesis');
    expect(action.targetId).toBe('s1');

    const row = db.prepare('SELECT operator_status FROM memory_syntheses WHERE id = ?').get('s1') as { operator_status: string };
    expect(row.operator_status).toBe('pinned');

    const actions = db.prepare('SELECT * FROM memory_operator_actions WHERE target_id = ?').all('s1') as Array<Record<string, unknown>>;
    expect(actions).toHaveLength(1);
  });
});
