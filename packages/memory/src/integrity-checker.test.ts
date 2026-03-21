import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isVecTableAvailable, runIntegrityChecks } from './integrity-checker.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF'); // Allow testing orphaned references
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
      source_run_id TEXT,
      source_timestamp TEXT,
      created_at TEXT NOT NULL,
      durable INTEGER NOT NULL DEFAULT 0,
      domain TEXT DEFAULT 'general'
    );
    CREATE VIRTUAL TABLE memories_fts USING fts5(memory_id UNINDEXED, description, content);
    CREATE TABLE memory_events (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE TABLE memory_sources (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE memory_consolidations (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      merged_into_id TEXT NOT NULL,
      reason TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE memory_entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      canonical_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE memory_entity_mentions (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      mention_count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
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
  `);
  return db;
}

function insertMemory(db: Database.Database, id: string, opts?: { confidence?: number; archived?: boolean; classification?: string; dedupKey?: string }): void {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO memories (id, description, classification, source_type, content, confidence, scope, memory_type, created_at, durable, dedup_key, archived_at)
    VALUES (?, 'desc', ?, 'curated_memory', 'content', ?, 'workspace', 'semantic', ?, 0, ?, ?)`).run(
    id,
    opts?.classification ?? 'embeddable',
    opts?.confidence ?? 0.8,
    now,
    opts?.dedupKey ?? null,
    opts?.archived ? now : null,
  );
}

describe('isVecTableAvailable', () => {
  it('returns false when memory_vec does not exist', () => {
    const db = new Database(':memory:');
    expect(isVecTableAvailable(db)).toBe(false);
    db.close();
  });
});

describe('runIntegrityChecks', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('returns clean report for empty database', () => {
    const report = runIntegrityChecks(db);
    expect(report.violations).toEqual([]);
    expect(report.checksRun).toHaveLength(9);
    expect(report.fixesApplied).toBe(0);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns clean report for healthy database', () => {
    const now = new Date().toISOString();
    insertMemory(db, 'mem-1');
    db.prepare('INSERT INTO memories_fts(memory_id, description, content) VALUES (?, ?, ?)').run('mem-1', 'desc', 'content');
    db.prepare("INSERT INTO memory_events (id, memory_id, type, created_at) VALUES ('ev-1', 'mem-1', 'created', ?)").run(now);

    const report = runIntegrityChecks(db);
    expect(report.violations).toEqual([]);
  });

  describe('fts5_index_sync', () => {
    it('detects active memories missing from FTS5', () => {
      insertMemory(db, 'mem-1');
      // Don't insert into FTS

      const report = runIntegrityChecks(db, { checks: ['fts5_index_sync'] });
      expect(report.violations).toHaveLength(1);
      expect(report.violations[0]!.check).toBe('fts5_index_sync');
      expect(report.violations[0]!.memoryId).toBe('mem-1');
      expect(report.violations[0]!.autoFixable).toBe(true);
    });

    it('fixes missing FTS entries when fix=true', () => {
      insertMemory(db, 'mem-1');

      const report = runIntegrityChecks(db, { checks: ['fts5_index_sync'], fix: true });
      expect(report.fixesApplied).toBe(1);

      // Verify fix
      const ftsRow = db.prepare("SELECT memory_id FROM memories_fts WHERE memory_id = 'mem-1'").get();
      expect(ftsRow).toBeTruthy();
    });

    it('ignores archived memories', () => {
      insertMemory(db, 'mem-1', { archived: true });

      const report = runIntegrityChecks(db, { checks: ['fts5_index_sync'] });
      expect(report.violations).toEqual([]);
    });
  });

  describe('dedup_key_consistency', () => {
    it('detects duplicate dedup keys among active memories', () => {
      insertMemory(db, 'mem-1', { dedupKey: 'dup-key' });
      insertMemory(db, 'mem-2', { dedupKey: 'dup-key' });

      const report = runIntegrityChecks(db, { checks: ['dedup_key_consistency'] });
      expect(report.violations).toHaveLength(1);
      expect(report.violations[0]!.check).toBe('dedup_key_consistency');
    });

    it('ignores archived duplicates', () => {
      insertMemory(db, 'mem-1', { dedupKey: 'dup-key' });
      insertMemory(db, 'mem-2', { dedupKey: 'dup-key', archived: true });

      const report = runIntegrityChecks(db, { checks: ['dedup_key_consistency'] });
      expect(report.violations).toEqual([]);
    });
  });

  describe('entity_mention_consistency', () => {
    it('detects mentions pointing to deleted memories', () => {
      const now = new Date().toISOString();
      db.prepare("INSERT INTO memory_entities (id, name, entity_type, canonical_name, created_at) VALUES ('ent-1', 'test', 'tool', 'test', ?)").run(now);
      db.prepare("INSERT INTO memory_entity_mentions (id, memory_id, entity_id, created_at) VALUES ('em-1', 'non-existent', 'ent-1', ?)").run(now);

      const report = runIntegrityChecks(db, { checks: ['entity_mention_consistency'] });
      expect(report.violations.length).toBeGreaterThanOrEqual(1);
      expect(report.violations.some((v) => v.check === 'entity_mention_consistency')).toBe(true);
    });

    it('fixes orphaned mentions', () => {
      const now = new Date().toISOString();
      db.prepare("INSERT INTO memory_entity_mentions (id, memory_id, entity_id, created_at) VALUES ('em-1', 'non-existent', 'non-existent', ?)").run(now);

      runIntegrityChecks(db, { checks: ['entity_mention_consistency'], fix: true });

      const remaining = db.prepare('SELECT COUNT(*) as c FROM memory_entity_mentions').get() as { c: number };
      expect(remaining.c).toBe(0);
    });
  });

  describe('consolidation_chain_integrity', () => {
    it('detects broken merge chains', () => {
      const now = new Date().toISOString();
      insertMemory(db, 'mem-1');
      db.prepare("INSERT INTO memory_consolidations (id, memory_id, merged_into_id, created_at) VALUES ('mc-1', 'mem-1', 'non-existent', ?)").run(now);

      const report = runIntegrityChecks(db, { checks: ['consolidation_chain_integrity'] });
      expect(report.violations).toHaveLength(1);
      expect(report.violations[0]!.check).toBe('consolidation_chain_integrity');
    });
  });

  describe('confidence_bounds', () => {
    it('detects confidence outside [0, 1]', () => {
      insertMemory(db, 'mem-1', { confidence: 1.5 });
      insertMemory(db, 'mem-2', { confidence: -0.1 });

      const report = runIntegrityChecks(db, { checks: ['confidence_bounds'] });
      expect(report.violations).toHaveLength(2);
    });

    it('clamps confidence when fix=true', () => {
      insertMemory(db, 'mem-1', { confidence: 1.5 });

      runIntegrityChecks(db, { checks: ['confidence_bounds'], fix: true });

      const row = db.prepare('SELECT confidence FROM memories WHERE id = ?').get('mem-1') as { confidence: number };
      expect(row.confidence).toBe(1);
    });
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

  describe('event_log_completeness', () => {
    it('detects memories without created event', () => {
      insertMemory(db, 'mem-1');
      // No event inserted

      const report = runIntegrityChecks(db, { checks: ['event_log_completeness'] });
      expect(report.violations).toHaveLength(1);
      expect(report.violations[0]!.check).toBe('event_log_completeness');
      expect(report.violations[0]!.memoryId).toBe('mem-1');
    });
  });

  describe('selective checks', () => {
    it('runs only specified checks', () => {
      const report = runIntegrityChecks(db, { checks: ['fts5_index_sync', 'confidence_bounds'] });
      expect(report.checksRun).toEqual(['fts5_index_sync', 'confidence_bounds']);
    });
  });

  describe('performance', () => {
    it('completes within 100ms for 100 memories', () => {
      const now = new Date().toISOString();
      for (let i = 0; i < 100; i++) {
        insertMemory(db, `mem-${i}`);
        db.prepare('INSERT INTO memories_fts(memory_id, description, content) VALUES (?, ?, ?)').run(`mem-${i}`, 'desc', 'content');
        db.prepare("INSERT INTO memory_events (id, memory_id, type, created_at) VALUES (?, ?, 'created', ?)").run(`ev-${i}`, `mem-${i}`, now);
      }

      const report = runIntegrityChecks(db);
      expect(report.durationMs).toBeLessThan(100);
      expect(report.violations).toEqual([]);
    });
  });
});
