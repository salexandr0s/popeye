import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildProfileStatic, buildProfileDynamic, shouldRefreshProfile } from './profile-builder.js';

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
      source_reliability REAL NOT NULL DEFAULT 0.9,
      extraction_confidence REAL NOT NULL DEFAULT 0.85,
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
    CREATE TABLE memory_syntheses (
      id TEXT PRIMARY KEY,
      namespace_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      workspace_id TEXT,
      project_id TEXT,
      classification TEXT NOT NULL,
      synthesis_kind TEXT NOT NULL,
      title TEXT NOT NULL,
      text TEXT NOT NULL,
      confidence REAL NOT NULL,
      refresh_policy TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      domain TEXT NOT NULL DEFAULT 'general',
      subject_kind TEXT,
      subject_id TEXT,
      refresh_due_at TEXT,
      salience REAL NOT NULL DEFAULT 0.5,
      quality_score REAL NOT NULL DEFAULT 0.7,
      context_release_policy TEXT NOT NULL DEFAULT 'full',
      invalidated_at TEXT,
      operator_status TEXT NOT NULL DEFAULT 'normal'
    );
    CREATE VIRTUAL TABLE memory_syntheses_fts USING fts5(synthesis_id UNINDEXED, title, text);
    CREATE TABLE memory_synthesis_sources (
      id TEXT PRIMARY KEY,
      synthesis_id TEXT NOT NULL,
      fact_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE memory_tags (
      id TEXT PRIMARY KEY,
      owner_kind TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

function insertFact(db: Database.Database, kind: string, text: string, opts: { durable?: boolean; createdAt?: string } = {}): string {
  const id = `fact-${Math.random().toString(36).slice(2, 10)}`;
  db.prepare(
    `INSERT INTO memory_facts (id, namespace_id, scope, classification, source_type, memory_type,
      fact_kind, text, confidence, durable, created_at, is_latest)
     VALUES (?, 'ns-1', 'workspace', 'internal', 'receipt', 'semantic', ?, ?, 0.8, ?, ?, 1)`,
  ).run(id, kind, text, opts.durable ? 1 : 0, opts.createdAt ?? new Date().toISOString());
  return id;
}

const BASE_INPUT = {
  scope: 'workspace',
  namespaceId: 'ns-1',
  classification: 'internal' as const,
};

describe('buildProfileStatic', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('returns null when no durable facts exist', () => {
    const result = buildProfileStatic(db, BASE_INPUT);
    expect(result).toBeNull();
  });

  it('returns null when facts exist but are not durable', () => {
    insertFact(db, 'identity', 'Software engineer', { durable: false });
    const result = buildProfileStatic(db, BASE_INPUT);
    expect(result).toBeNull();
  });

  it('creates a profile synthesis from durable identity/preference facts', () => {
    insertFact(db, 'identity', 'Senior engineer at Acme', { durable: true });
    insertFact(db, 'preference', 'Prefers dark mode', { durable: true });
    insertFact(db, 'procedure', 'Always runs tests before committing', { durable: true });

    const result = buildProfileStatic(db, BASE_INPUT);
    expect(result).not.toBeNull();
    expect(result!.synthesisKind).toBe('profile_static');
    expect(result!.subjectKind).toBe('workspace');
    expect(result!.text).toContain('Identity');
    expect(result!.text).toContain('Preference');
    expect(result!.text).toContain('Procedure');
    expect(result!.text).toContain('Senior engineer');
    expect(result!.text).toContain('dark mode');
    expect(result!.qualityScore).toBeCloseTo(0.8, 1);
  });

  it('skips archived facts', () => {
    const id = insertFact(db, 'identity', 'Archived fact', { durable: true });
    db.prepare('UPDATE memory_facts SET archived_at = ? WHERE id = ?').run(new Date().toISOString(), id);

    const result = buildProfileStatic(db, BASE_INPUT);
    expect(result).toBeNull();
  });

  it('skips non-latest facts', () => {
    const id = insertFact(db, 'identity', 'Old version', { durable: true });
    db.prepare('UPDATE memory_facts SET is_latest = 0 WHERE id = ?').run(id);

    const result = buildProfileStatic(db, BASE_INPUT);
    expect(result).toBeNull();
  });

  it('updates existing profile on re-run', () => {
    insertFact(db, 'identity', 'Engineer v1', { durable: true });
    const first = buildProfileStatic(db, BASE_INPUT);
    expect(first).not.toBeNull();

    insertFact(db, 'preference', 'Likes TypeScript', { durable: true });
    const second = buildProfileStatic(db, BASE_INPUT);
    expect(second).not.toBeNull();
    // Same ID — upserted
    expect(second!.id).toBe(first!.id);
    expect(second!.text).toContain('TypeScript');
  });
});

describe('buildProfileDynamic', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('returns null when no recent event/state facts exist', () => {
    const result = buildProfileDynamic(db, BASE_INPUT);
    expect(result).toBeNull();
  });

  it('creates a dynamic profile from recent events', () => {
    insertFact(db, 'event', 'Deployed v2.1 to production');
    insertFact(db, 'state', 'Currently working on memory upgrade');
    insertFact(db, 'observation', 'Tests are running slowly');

    const result = buildProfileDynamic(db, BASE_INPUT);
    expect(result).not.toBeNull();
    expect(result!.synthesisKind).toBe('profile_dynamic');
    expect(result!.subjectKind).toBe('workspace');
    expect(result!.refreshDueAt).toBeDefined();
    expect(result!.text).toContain('Deployed v2.1');
    expect(result!.text).toContain('[event]');
    expect(result!.text).toContain('[state]');
  });

  it('excludes facts older than 7 days', () => {
    const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    insertFact(db, 'event', 'Old event from last week', { createdAt: oldDate });

    const result = buildProfileDynamic(db, BASE_INPUT);
    expect(result).toBeNull();
  });
});

describe('shouldRefreshProfile', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('returns true when no synthesis exists', () => {
    expect(shouldRefreshProfile(db, 'workspace', 'profile_static')).toBe(true);
  });

  it('returns false within cooldown period', () => {
    db.prepare(
      `INSERT INTO memory_syntheses (id, namespace_id, scope, classification, synthesis_kind, title, text, confidence, created_at, updated_at, domain)
       VALUES ('s1', 'ns-1', 'workspace', 'internal', 'profile_static', 'Static Profile', 'text', 0.8, ?, ?, 'general')`,
    ).run(new Date().toISOString(), new Date().toISOString());

    expect(shouldRefreshProfile(db, 'workspace', 'profile_static')).toBe(false);
  });

  it('returns true when cooldown has passed for static profiles', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO memory_syntheses (id, namespace_id, scope, classification, synthesis_kind, title, text, confidence, created_at, updated_at, domain)
       VALUES ('s1', 'ns-1', 'workspace', 'internal', 'profile_static', 'Static Profile', 'text', 0.8, ?, ?, 'general')`,
    ).run(twoHoursAgo, twoHoursAgo);

    expect(shouldRefreshProfile(db, 'workspace', 'profile_static')).toBe(true);
  });

  it('returns true when refresh_due_at has passed for dynamic profiles', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000 - 1000).toISOString();
    db.prepare(
      `INSERT INTO memory_syntheses (id, namespace_id, scope, classification, synthesis_kind, title, text, confidence, created_at, updated_at, domain, refresh_due_at)
       VALUES ('s1', 'ns-1', 'workspace', 'internal', 'profile_dynamic', 'Dynamic Profile', 'text', 0.8, ?, ?, 'general', ?)`,
    ).run(twoHoursAgo, twoHoursAgo, oneHourAgo);

    expect(shouldRefreshProfile(db, 'workspace', 'profile_dynamic')).toBe(true);
  });
});
