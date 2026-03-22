import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runIntegrityChecks } from './integrity-checker.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF'); // Allow testing orphaned references
  db.exec(`
    CREATE TABLE memory_summaries (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      parent_id TEXT,
      depth INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL,
      token_estimate INTEGER NOT NULL DEFAULT 0,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE memory_summary_sources (
      id TEXT PRIMARY KEY,
      summary_id TEXT NOT NULL,
      memory_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE memory_artifacts (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      classification TEXT NOT NULL,
      scope TEXT NOT NULL,
      workspace_id TEXT,
      project_id TEXT,
      namespace_id TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      domain TEXT NOT NULL DEFAULT 'general',
      trust_score REAL NOT NULL DEFAULT 0.7,
      invalidated_at TEXT
    );
    CREATE TABLE memory_artifact_chunks (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      chunk_kind TEXT NOT NULL,
      text TEXT NOT NULL,
      text_hash TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      classification TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      invalidated_at TEXT
    );
    CREATE TABLE memory_facts (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      memory_type TEXT NOT NULL DEFAULT 'semantic',
      confidence REAL NOT NULL DEFAULT 0.8,
      scope TEXT NOT NULL DEFAULT 'workspace',
      workspace_id TEXT,
      project_id TEXT,
      source_type TEXT NOT NULL DEFAULT 'curated_memory',
      namespace_id TEXT NOT NULL DEFAULT 'ns-default',
      created_at TEXT NOT NULL,
      last_reinforced_at TEXT,
      durable INTEGER NOT NULL DEFAULT 0,
      domain TEXT DEFAULT 'general',
      is_latest INTEGER NOT NULL DEFAULT 1,
      revision_status TEXT NOT NULL DEFAULT 'active',
      archived_at TEXT,
      invalidated_at TEXT,
      forget_after TEXT,
      expired_at TEXT
    );
    CREATE TABLE memory_fact_sources (
      id TEXT PRIMARY KEY,
      fact_id TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE memory_syntheses (
      id TEXT PRIMARY KEY,
      synthesis_kind TEXT NOT NULL,
      title TEXT NOT NULL,
      text TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.8,
      scope TEXT NOT NULL DEFAULT 'workspace',
      workspace_id TEXT,
      project_id TEXT,
      namespace_id TEXT NOT NULL DEFAULT 'ns-default',
      domain TEXT DEFAULT 'general',
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      refresh_due_at TEXT
    );
  `);
  return db;
}

describe('runIntegrityChecks', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('returns clean report for empty database', () => {
    const report = runIntegrityChecks(db);
    expect(report.violations).toEqual([]);
    expect(report.checksRun).toHaveLength(5);
    expect(report.fixesApplied).toBe(0);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  describe('summary_dag_integrity', () => {
    it('detects summaries with invalid parent_id', () => {
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO memory_summaries (id, run_id, workspace_id, parent_id, depth, content, token_estimate, start_time, end_time, created_at)
        VALUES ('s1', 'run-1', 'ws-1', 'non-existent-parent', 0, 'content', 10, ?, ?, ?)`).run(now, now, now);

      const report = runIntegrityChecks(db, { checks: ['summary_dag_integrity'] });
      expect(report.violations).toHaveLength(1);
      expect(report.violations[0]!.check).toBe('summary_dag_integrity');
    });

    it('fixes orphaned summaries by nulling parent_id', () => {
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO memory_summaries (id, run_id, workspace_id, parent_id, depth, content, token_estimate, start_time, end_time, created_at)
        VALUES ('s1', 'run-1', 'ws-1', 'non-existent-parent', 0, 'content', 10, ?, ?, ?)`).run(now, now, now);

      runIntegrityChecks(db, { checks: ['summary_dag_integrity'], fix: true });

      const row = db.prepare('SELECT parent_id FROM memory_summaries WHERE id = ?').get('s1') as { parent_id: string | null };
      expect(row.parent_id).toBeNull();
    });
  });

  describe('orphan_chunks', () => {
    it('detects chunks belonging to invalidated artifacts', () => {
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO memory_artifacts (id, source_type, classification, scope, namespace_id, captured_at, content, content_hash, invalidated_at)
        VALUES ('a1', 'workspace_doc', 'internal', 'workspace', 'ns-1', ?, 'content', 'hash', ?)`).run(now, now);
      db.prepare(`INSERT INTO memory_artifact_chunks (id, artifact_id, chunk_index, chunk_kind, text, text_hash, token_count, classification, created_at, updated_at)
        VALUES ('c1', 'a1', 0, 'paragraph', 'chunk text', 'hash', 10, 'internal', ?, ?)`).run(now, now);

      const report = runIntegrityChecks(db, { checks: ['orphan_chunks'] });
      expect(report.violations).toHaveLength(1);
      expect(report.violations[0]!.check).toBe('orphan_chunks');
    });
  });

  describe('unsupported_facts', () => {
    it('detects facts with no valid evidence artifacts', () => {
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO memory_facts (id, text, created_at) VALUES ('f1', 'some fact', ?)`).run(now);
      db.prepare(`INSERT INTO memory_artifacts (id, source_type, classification, scope, namespace_id, captured_at, content, content_hash, invalidated_at)
        VALUES ('a1', 'workspace_doc', 'internal', 'workspace', 'ns-1', ?, 'content', 'hash', ?)`).run(now, now);
      db.prepare(`INSERT INTO memory_fact_sources (id, fact_id, artifact_id, created_at) VALUES ('fs1', 'f1', 'a1', ?)`).run(now);

      const report = runIntegrityChecks(db, { checks: ['unsupported_facts'] });
      expect(report.violations).toHaveLength(1);
      expect(report.violations[0]!.check).toBe('unsupported_facts');
    });

    it('fixes unsupported facts by invalidating them', () => {
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO memory_facts (id, text, created_at) VALUES ('f1', 'some fact', ?)`).run(now);
      db.prepare(`INSERT INTO memory_artifacts (id, source_type, classification, scope, namespace_id, captured_at, content, content_hash, invalidated_at)
        VALUES ('a1', 'workspace_doc', 'internal', 'workspace', 'ns-1', ?, 'content', 'hash', ?)`).run(now, now);
      db.prepare(`INSERT INTO memory_fact_sources (id, fact_id, artifact_id, created_at) VALUES ('fs1', 'f1', 'a1', ?)`).run(now);

      runIntegrityChecks(db, { checks: ['unsupported_facts'], fix: true });

      const row = db.prepare('SELECT invalidated_at FROM memory_facts WHERE id = ?').get('f1') as { invalidated_at: string | null };
      expect(row.invalidated_at).not.toBeNull();
    });
  });

  describe('profile_refresh_debt', () => {
    it('detects syntheses with overdue refresh', () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      db.prepare(`INSERT INTO memory_syntheses (id, synthesis_kind, title, text, updated_at, refresh_due_at)
        VALUES ('syn1', 'profile', 'Test Profile', 'profile text', ?, ?)`).run(pastDate, pastDate);

      const report = runIntegrityChecks(db, { checks: ['profile_refresh_debt'] });
      expect(report.violations).toHaveLength(1);
      expect(report.violations[0]!.check).toBe('profile_refresh_debt');
    });
  });

  describe('ttl_consistency', () => {
    it('detects facts with expired TTL but not marked expired', () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO memory_facts (id, text, created_at, forget_after) VALUES ('f1', 'ephemeral fact', ?, ?)`).run(now, pastDate);

      const report = runIntegrityChecks(db, { checks: ['ttl_consistency'] });
      expect(report.violations).toHaveLength(1);
      expect(report.violations[0]!.check).toBe('ttl_consistency');
    });

    it('fixes expired TTL facts', () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO memory_facts (id, text, created_at, forget_after) VALUES ('f1', 'ephemeral fact', ?, ?)`).run(now, pastDate);

      runIntegrityChecks(db, { checks: ['ttl_consistency'], fix: true });

      const row = db.prepare('SELECT expired_at, archived_at FROM memory_facts WHERE id = ?').get('f1') as { expired_at: string | null; archived_at: string | null };
      expect(row.expired_at).not.toBeNull();
      expect(row.archived_at).not.toBeNull();
    });
  });

  describe('selective checks', () => {
    it('runs only specified checks', () => {
      const report = runIntegrityChecks(db, { checks: ['summary_dag_integrity', 'ttl_consistency'] });
      expect(report.checksRun).toEqual(['summary_dag_integrity', 'ttl_consistency']);
    });
  });

  describe('performance', () => {
    it('completes within 100ms for empty database', () => {
      const report = runIntegrityChecks(db);
      expect(report.durationMs).toBeLessThan(100);
      expect(report.violations).toEqual([]);
    });
  });
});
