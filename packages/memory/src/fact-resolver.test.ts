import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computeClaimKey, resolveFact } from './fact-resolver.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE memory_facts (
      id TEXT PRIMARY KEY,
      namespace_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      workspace_id TEXT,
      project_id TEXT,
      classification TEXT NOT NULL,
      source_type TEXT NOT NULL,
      memory_type TEXT NOT NULL,
      fact_kind TEXT NOT NULL,
      text TEXT NOT NULL,
      confidence REAL NOT NULL,
      source_reliability REAL NOT NULL,
      extraction_confidence REAL NOT NULL,
      human_confirmed INTEGER NOT NULL DEFAULT 0,
      occurred_at TEXT,
      valid_from TEXT,
      valid_to TEXT,
      source_run_id TEXT,
      source_timestamp TEXT,
      dedup_key TEXT,
      last_reinforced_at TEXT,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      durable INTEGER NOT NULL DEFAULT 0,
      revision_status TEXT NOT NULL DEFAULT 'active',
      domain TEXT DEFAULT 'general',
      root_fact_id TEXT,
      parent_fact_id TEXT,
      is_latest INTEGER NOT NULL DEFAULT 1,
      claim_key TEXT,
      salience REAL NOT NULL DEFAULT 0.5,
      support_count INTEGER NOT NULL DEFAULT 1,
      source_trust_score REAL NOT NULL DEFAULT 0.7,
      context_release_policy TEXT NOT NULL DEFAULT 'full',
      operator_status TEXT NOT NULL DEFAULT 'normal'
    );
    CREATE INDEX idx_facts_claim_key ON memory_facts(claim_key);
    CREATE INDEX idx_facts_is_latest ON memory_facts(is_latest, archived_at);
  `);
  return db;
}

function insertFact(db: Database.Database, overrides: Record<string, unknown> = {}): string {
  const id = `fact-${Math.random().toString(36).slice(2, 8)}`;
  const defaults = {
    id,
    namespace_id: 'ns-1',
    scope: 'workspace',
    classification: 'internal',
    source_type: 'receipt',
    memory_type: 'semantic',
    fact_kind: 'preference',
    text: 'User prefers dark mode',
    confidence: 0.8,
    source_reliability: 0.9,
    extraction_confidence: 0.85,
    dedup_key: 'dedup-1',
    created_at: new Date().toISOString(),
    claim_key: null,
    root_fact_id: null,
    is_latest: 1,
    archived_at: null,
  };
  const merged = { ...defaults, ...overrides };
  db.prepare(
    `INSERT INTO memory_facts (id, namespace_id, scope, classification, source_type, memory_type,
      fact_kind, text, confidence, source_reliability, extraction_confidence, dedup_key, created_at,
      claim_key, root_fact_id, is_latest, archived_at)
     VALUES (@id, @namespace_id, @scope, @classification, @source_type, @memory_type,
      @fact_kind, @text, @confidence, @source_reliability, @extraction_confidence, @dedup_key,
      @created_at, @claim_key, @root_fact_id, @is_latest, @archived_at)`,
  ).run(merged);
  return id;
}

describe('computeClaimKey', () => {
  it('produces deterministic keys', () => {
    const k1 = computeClaimKey('workspace', 'preference', 'User prefers dark mode');
    const k2 = computeClaimKey('workspace', 'preference', 'User prefers dark mode');
    expect(k1).toBe(k2);
  });

  it('produces different keys for different scopes', () => {
    const k1 = computeClaimKey('workspace', 'preference', 'User prefers dark mode');
    const k2 = computeClaimKey('project', 'preference', 'User prefers dark mode');
    expect(k1).not.toBe(k2);
  });

  it('produces different keys for different fact kinds', () => {
    const k1 = computeClaimKey('workspace', 'preference', 'User prefers dark mode');
    const k2 = computeClaimKey('workspace', 'identity', 'User prefers dark mode');
    expect(k1).not.toBe(k2);
  });

  it('uses first 100 chars for grouping', () => {
    const base = 'A'.repeat(100);
    const k1 = computeClaimKey('workspace', 'preference', base + ' suffix1');
    const k2 = computeClaimKey('workspace', 'preference', base + ' suffix2');
    expect(k1).toBe(k2); // Same first 100 chars → same claim key
  });

  it('is case-insensitive', () => {
    const k1 = computeClaimKey('workspace', 'preference', 'User Prefers Dark Mode');
    const k2 = computeClaimKey('workspace', 'preference', 'user prefers dark mode');
    expect(k1).toBe(k2);
  });
});

describe('resolveFact', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('returns insert when no claim_key match exists', () => {
    const result = resolveFact(db, { claimKey: 'no-match', dedupKey: 'no-match' });
    expect(result).toEqual({ action: 'insert' });
  });

  it('returns duplicate when claim_key and dedup_key both match', () => {
    const claimKey = computeClaimKey('workspace', 'preference', 'User prefers dark mode');
    insertFact(db, { claim_key: claimKey, dedup_key: 'dedup-exact' });

    const result = resolveFact(db, { claimKey, dedupKey: 'dedup-exact' });
    expect(result.action).toBe('duplicate');
    if (result.action === 'duplicate') {
      expect(result.existingFactId).toBeDefined();
    }
  });

  it('returns update when claim_key matches but dedup_key differs', () => {
    const claimKey = computeClaimKey('workspace', 'preference', 'User prefers dark mode');
    const existingId = insertFact(db, { claim_key: claimKey, dedup_key: 'dedup-old' });

    const result = resolveFact(db, { claimKey, dedupKey: 'dedup-new' });
    expect(result.action).toBe('update');
    if (result.action === 'update') {
      expect(result.existingFactId).toBe(existingId);
    }
  });

  it('skips archived facts', () => {
    const claimKey = computeClaimKey('workspace', 'preference', 'archived fact');
    insertFact(db, { claim_key: claimKey, dedup_key: 'dedup-archived', archived_at: new Date().toISOString() });

    const result = resolveFact(db, { claimKey, dedupKey: 'dedup-archived' });
    expect(result.action).toBe('insert');
  });

  it('skips non-latest facts', () => {
    const claimKey = computeClaimKey('workspace', 'preference', 'old version');
    insertFact(db, { claim_key: claimKey, dedup_key: 'dedup-old', is_latest: 0 });

    const result = resolveFact(db, { claimKey, dedupKey: 'dedup-old' });
    expect(result.action).toBe('insert');
  });

  it('returns root_fact_id from existing fact in update resolution', () => {
    const claimKey = computeClaimKey('workspace', 'preference', 'versioned fact');
    insertFact(db, { claim_key: claimKey, dedup_key: 'dedup-v1', root_fact_id: 'root-original' });

    const result = resolveFact(db, { claimKey, dedupKey: 'dedup-v2' });
    expect(result.action).toBe('update');
    if (result.action === 'update') {
      expect(result.existingRootFactId).toBe('root-original');
    }
  });
});
