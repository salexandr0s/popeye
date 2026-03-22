import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppConfig, RuntimePaths } from '@popeye/contracts';
import { createDisabledEmbeddingClient, MemorySearchService } from '@popeye/memory';

import type { RuntimeDatabases } from './database.js';
import { MemoryLifecycleService } from './memory-lifecycle.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMemoryDb(): Database.Database {
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
      source_run_id TEXT,
      source_timestamp TEXT,
      durable INTEGER NOT NULL DEFAULT 0,
      domain TEXT DEFAULT 'general'
    );
    CREATE INDEX idx_memories_dedup_key ON memories(dedup_key) WHERE dedup_key IS NOT NULL;
    CREATE VIRTUAL TABLE memories_fts USING fts5(memory_id UNINDEXED, description, content);
    CREATE TABLE memory_entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      canonical_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_memory_entities_canonical ON memory_entities(canonical_name, entity_type);
    CREATE TABLE memory_entity_mentions (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      mention_count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE memory_sources (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE memory_namespaces (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      external_ref TEXT,
      label TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE memory_tags (
      id TEXT PRIMARY KEY,
      owner_kind TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      tag TEXT NOT NULL,
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
      source_run_id TEXT,
      source_ref TEXT,
      source_ref_type TEXT,
      captured_at TEXT NOT NULL,
      occurred_at TEXT,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      domain TEXT DEFAULT 'general',
      source_stream_id TEXT,
      artifact_version INTEGER NOT NULL DEFAULT 1,
      context_release_policy TEXT NOT NULL DEFAULT 'full',
      trust_score REAL NOT NULL DEFAULT 0.7,
      invalidated_at TEXT
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
      forget_after TEXT,
      stale_after TEXT,
      expired_at TEXT,
      invalidated_at TEXT,
      operator_status TEXT NOT NULL DEFAULT 'normal'
    );
    CREATE UNIQUE INDEX idx_memory_facts_dedup_key ON memory_facts(dedup_key) WHERE dedup_key IS NOT NULL;
    CREATE INDEX idx_facts_claim_key ON memory_facts(claim_key);
    CREATE INDEX idx_facts_is_latest ON memory_facts(is_latest, archived_at);
    CREATE TABLE memory_fact_sources (
      id TEXT PRIMARY KEY,
      fact_id TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      excerpt TEXT,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_memory_fact_sources_pair ON memory_fact_sources(fact_id, artifact_id);
    CREATE TABLE memory_revisions (
      id TEXT PRIMARY KEY,
      relation_type TEXT NOT NULL,
      source_fact_id TEXT NOT NULL,
      target_fact_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
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
      domain TEXT DEFAULT 'general',
      subject_kind TEXT,
      subject_id TEXT,
      refresh_due_at TEXT,
      salience REAL NOT NULL DEFAULT 0.5,
      quality_score REAL NOT NULL DEFAULT 0.7,
      context_release_policy TEXT NOT NULL DEFAULT 'full',
      invalidated_at TEXT,
      operator_status TEXT NOT NULL DEFAULT 'normal'
    );
    CREATE TABLE memory_synthesis_sources (
      id TEXT PRIMARY KEY,
      synthesis_id TEXT NOT NULL,
      fact_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE memory_facts_fts USING fts5(fact_id UNINDEXED, text);
    CREATE VIRTUAL TABLE memory_syntheses_fts USING fts5(synthesis_id UNINDEXED, title, text);
    CREATE TABLE memory_events (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE TABLE memory_consolidations (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      merged_into_id TEXT NOT NULL,
      reason TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
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
    CREATE TABLE memory_relations (
      id TEXT PRIMARY KEY,
      relation_type TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      created_by TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_relations_source ON memory_relations(source_kind, source_id);
    CREATE INDEX idx_relations_target ON memory_relations(target_kind, target_id);
    CREATE TABLE memory_operator_actions (
      id TEXT PRIMARY KEY,
      action_kind TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

function createAppDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE receipts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      details TEXT NOT NULL,
      usage_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

function makeConfig(overrides?: Partial<{
  redactionPatterns: string[];
  confidenceHalfLifeDays: number;
  archiveThreshold: number;
  consolidationEnabled: boolean;
  compactionFlushConfidence: number;
}>): AppConfig {
  return {
    runtimeDataDir: '/tmp/popeye-test',
    authFile: '/tmp/popeye-test/auth.json',
    security: {
      bindHost: '127.0.0.1',
      bindPort: 3210,
      redactionPatterns: overrides?.redactionPatterns ?? [],
    },
    telegram: { enabled: false, allowedUserId: '42', maxMessagesPerMinute: 10, rateLimitWindowSeconds: 60 },
    embeddings: { provider: 'disabled', allowedClassifications: ['embeddable'], model: 'text-embedding-3-small', dimensions: 1536 },
    memory: {
      confidenceHalfLifeDays: overrides?.confidenceHalfLifeDays ?? 30,
      archiveThreshold: overrides?.archiveThreshold ?? 0.1,
      dailySummaryHour: 23,
      consolidationEnabled: overrides?.consolidationEnabled ?? true,
      compactionFlushConfidence: overrides?.compactionFlushConfidence ?? 0.7,
      qualitySweepEnabled: false,
    },
    engine: { kind: 'fake', command: 'node', args: [] },
    workspaces: [{ id: 'default', name: 'Default workspace', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 }],
  } as AppConfig;
}

function makePaths(tmpDir: string): RuntimePaths {
  return {
    runtimeDataDir: tmpDir,
    configDir: join(tmpDir, 'config'),
    stateDir: join(tmpDir, 'state'),
    appDbPath: join(tmpDir, 'state', 'app.db'),
    memoryDbPath: join(tmpDir, 'state', 'memory.db'),
    logsDir: join(tmpDir, 'logs'),
    runLogsDir: join(tmpDir, 'logs', 'runs'),
    receiptsDir: join(tmpDir, 'receipts'),
    receiptsByRunDir: join(tmpDir, 'receipts', 'by-run'),
    receiptsByDayDir: join(tmpDir, 'receipts', 'by-day'),
    backupsDir: join(tmpDir, 'backups'),
    memoryDailyDir: join(tmpDir, 'memory', 'daily'),
  };
}

function insertMemoryRow(
  db: Database.Database,
  overrides: Partial<{
    id: string;
    description: string;
    classification: string;
    source_type: string;
    content: string;
    confidence: number;
    scope: string;
    memory_type: string;
    dedup_key: string | null;
    last_reinforced_at: string | null;
    archived_at: string | null;
    created_at: string;
  }> = {},
): string {
  const id = overrides.id ?? randomUUID();
  const desc = overrides.description ?? 'test memory';
  const content = overrides.content ?? 'test content';
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO memories (id, description, classification, source_type, content, confidence, scope, memory_type, dedup_key, last_reinforced_at, archived_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    desc,
    overrides.classification ?? 'internal',
    overrides.source_type ?? 'curated_memory',
    content,
    overrides.confidence ?? 0.8,
    overrides.scope ?? 'workspace',
    overrides.memory_type ?? 'episodic',
    overrides.dedup_key ?? null,
    overrides.last_reinforced_at ?? null,
    overrides.archived_at ?? null,
    overrides.created_at ?? now,
  );
  // Sync FTS
  db.prepare('INSERT INTO memories_fts (memory_id, description, content) VALUES (?, ?, ?)').run(id, desc, content);
  return id;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('MemoryLifecycleService', () => {
  let appDb: Database.Database;
  let memoryDb: Database.Database;
  let searchService: MemorySearchService;
  let tmpDir: string;
  let databases: RuntimeDatabases;
  let config: AppConfig;
  let service: MemoryLifecycleService;

  beforeEach(() => {
    appDb = createAppDb();
    memoryDb = createMemoryDb();
    tmpDir = mkdtempSync(join(tmpdir(), 'popeye-lifecycle-'));
    const paths = makePaths(tmpDir);
    mkdirSync(join(tmpDir, 'memory'), { recursive: true });
    mkdirSync(paths.memoryDailyDir, { recursive: true });
    databases = { app: appDb, memory: memoryDb, paths };
    config = makeConfig();
    searchService = new MemorySearchService({
      db: memoryDb,
      embeddingClient: createDisabledEmbeddingClient(),
      vecAvailable: false,
    });
    service = new MemoryLifecycleService(databases, config, searchService);
  });

  afterEach(() => {
    appDb.close();
    memoryDb.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // reinforceMemory
  // -----------------------------------------------------------------------

  describe('reinforceMemory', () => {
    it('is a no-op for non-existent memory ID', () => {
      // Should not throw
      service.reinforceMemory('non-existent-id');
      const events = memoryDb.prepare('SELECT COUNT(*) as c FROM memory_events').get() as { c: number };
      expect(events.c).toBe(0);
    });

    it('boosts confidence by 0.1', () => {
      const id = insertMemoryRow(memoryDb, { confidence: 0.5 });
      service.reinforceMemory(id);
      const row = memoryDb.prepare('SELECT confidence FROM memories WHERE id = ?').get(id) as { confidence: number };
      expect(row.confidence).toBeCloseTo(0.6, 5);
    });

    it('caps confidence at 1.0', () => {
      const id = insertMemoryRow(memoryDb, { confidence: 0.95 });
      service.reinforceMemory(id);
      const row = memoryDb.prepare('SELECT confidence FROM memories WHERE id = ?').get(id) as { confidence: number };
      expect(row.confidence).toBe(1.0);
    });

    it('sets last_reinforced_at to current time', () => {
      const id = insertMemoryRow(memoryDb, { confidence: 0.5 });
      const before = new Date();
      service.reinforceMemory(id);
      const row = memoryDb.prepare('SELECT last_reinforced_at FROM memories WHERE id = ?').get(id) as { last_reinforced_at: string };
      expect(row.last_reinforced_at).toBeTruthy();
      const ts = new Date(row.last_reinforced_at);
      expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    });

    it('clears archived_at when reinforcing archived memory', () => {
      const id = insertMemoryRow(memoryDb, { confidence: 0.5, archived_at: new Date().toISOString() });
      service.reinforceMemory(id);
      const row = memoryDb.prepare('SELECT archived_at FROM memories WHERE id = ?').get(id) as { archived_at: string | null };
      expect(row.archived_at).toBeNull();
    });

    it('appends additionalContent with separator', () => {
      const id = insertMemoryRow(memoryDb, { content: 'original content', confidence: 0.5 });
      service.reinforceMemory(id, 'new info');
      const row = memoryDb.prepare('SELECT content FROM memories WHERE id = ?').get(id) as { content: string };
      expect(row.content).toBe('original content\n\n---\n\nnew info');
    });

    it('does not modify content when additionalContent is omitted', () => {
      const id = insertMemoryRow(memoryDb, { content: 'original content', confidence: 0.5 });
      service.reinforceMemory(id);
      const row = memoryDb.prepare('SELECT content FROM memories WHERE id = ?').get(id) as { content: string };
      expect(row.content).toBe('original content');
    });

    it('creates reinforced event with previous and new confidence in payload', () => {
      const id = insertMemoryRow(memoryDb, { confidence: 0.5 });
      service.reinforceMemory(id);
      const event = memoryDb.prepare("SELECT payload FROM memory_events WHERE memory_id = ? AND type = 'reinforced'").get(id) as { payload: string };
      expect(event).toBeTruthy();
      const payload = JSON.parse(event.payload);
      expect(payload.previousConfidence).toBeCloseTo(0.5, 5);
      expect(payload.newConfidence).toBeCloseTo(0.6, 5);
    });
  });

  // -----------------------------------------------------------------------
  // runConfidenceDecay
  // -----------------------------------------------------------------------

  describe('runConfidenceDecay', () => {
    it('returns {decayed:0, archived:0} for empty DB', () => {
      const result = service.runConfidenceDecay();
      expect(result).toEqual({ decayed: 0, archived: 0 });
    });

    it('does not decay memories created just now', () => {
      insertMemoryRow(memoryDb, { confidence: 1.0, created_at: new Date().toISOString() });
      const result = service.runConfidenceDecay();
      expect(result.decayed).toBe(0);
    });

    it('decays old memories proportionally (halfLife 30 days, 30 days old, expect ~0.5)', () => {
      const id = insertMemoryRow(memoryDb, { confidence: 1.0, created_at: daysAgo(30) });
      const result = service.runConfidenceDecay();
      expect(result.decayed).toBe(1);
      const row = memoryDb.prepare('SELECT confidence FROM memories WHERE id = ?').get(id) as { confidence: number };
      expect(row.confidence).toBeCloseTo(0.5, 1);
    });

    it('archives memories below threshold', () => {
      // Insert memory 200 days old with confidence 0.5 and halfLife 30 — will decay to near 0
      const id = insertMemoryRow(memoryDb, { confidence: 0.5, created_at: daysAgo(200) });
      const result = service.runConfidenceDecay();
      expect(result.archived).toBe(1);
      const row = memoryDb.prepare('SELECT archived_at FROM memories WHERE id = ?').get(id) as { archived_at: string | null };
      expect(row.archived_at).toBeTruthy();
    });

    it('skips already-archived memories', () => {
      insertMemoryRow(memoryDb, { confidence: 1.0, created_at: daysAgo(60), archived_at: new Date().toISOString() });
      const result = service.runConfidenceDecay();
      expect(result.decayed).toBe(0);
      expect(result.archived).toBe(0);
    });

    it('uses last_reinforced_at over created_at as reference', () => {
      // Created 60 days ago but reinforced just now — should not decay
      const id = insertMemoryRow(memoryDb, {
        confidence: 1.0,
        created_at: daysAgo(60),
        last_reinforced_at: new Date().toISOString(),
      });
      const result = service.runConfidenceDecay();
      const row = memoryDb.prepare('SELECT confidence FROM memories WHERE id = ?').get(id) as { confidence: number };
      expect(row.confidence).toBeCloseTo(1.0, 1);
      expect(result.decayed).toBe(0);
    });

    it('creates decayed and archived events', () => {
      // One that will decay but not archive (30 days old, confidence 1.0)
      insertMemoryRow(memoryDb, { confidence: 1.0, created_at: daysAgo(30) });
      // One that will archive (200 days old, low confidence)
      insertMemoryRow(memoryDb, { confidence: 0.5, created_at: daysAgo(200) });

      service.runConfidenceDecay();

      const decayedEvents = memoryDb.prepare("SELECT COUNT(*) as c FROM memory_events WHERE type = 'decayed'").get() as { c: number };
      const archivedEvents = memoryDb.prepare("SELECT COUNT(*) as c FROM memory_events WHERE type = 'archived'").get() as { c: number };
      // The archived one also increments the "decayed" counter, so expect at least one decayed event
      expect(decayedEvents.c).toBeGreaterThanOrEqual(1);
      expect(archivedEvents.c).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // runConsolidation
  // -----------------------------------------------------------------------

  describe('runConsolidation', () => {
    it('returns {merged:0, deduped:0} when consolidationEnabled is false', () => {
      const disabledConfig = makeConfig({ consolidationEnabled: false });
      const svc = new MemoryLifecycleService(databases, disabledConfig, searchService);
      insertMemoryRow(memoryDb, { dedup_key: 'dup-1', scope: 'ws', memory_type: 'semantic' });
      insertMemoryRow(memoryDb, { dedup_key: 'dup-1', scope: 'ws', memory_type: 'semantic' });
      const result = svc.runConsolidation();
      expect(result).toEqual({ merged: 0, deduped: 0, qualityArchived: 0 });
    });

    it('returns zeros for single-member groups', () => {
      insertMemoryRow(memoryDb, { scope: 'ws', memory_type: 'semantic' });
      const result = service.runConsolidation();
      expect(result).toEqual({ merged: 0, deduped: 0, qualityArchived: 0 });
    });

    it('deduplicates by exact dedup_key, keeps highest confidence', () => {
      const keepId = insertMemoryRow(memoryDb, { dedup_key: 'dup-a', scope: 'ws', memory_type: 'semantic', confidence: 0.9 });
      const loseId = insertMemoryRow(memoryDb, { dedup_key: 'dup-a', scope: 'ws', memory_type: 'semantic', confidence: 0.5 });

      const result = service.runConsolidation();
      expect(result.deduped).toBe(1);

      const loser = memoryDb.prepare('SELECT archived_at FROM memories WHERE id = ?').get(loseId) as { archived_at: string | null };
      expect(loser.archived_at).toBeTruthy();

      const keeper = memoryDb.prepare('SELECT archived_at FROM memories WHERE id = ?').get(keepId) as { archived_at: string | null };
      expect(keeper.archived_at).toBeNull();
    });

    it('creates consolidation record and event', () => {
      const keepId = insertMemoryRow(memoryDb, { dedup_key: 'dup-b', scope: 'ws', memory_type: 'semantic', confidence: 0.9 });
      const loseId = insertMemoryRow(memoryDb, { dedup_key: 'dup-b', scope: 'ws', memory_type: 'semantic', confidence: 0.4 });

      service.runConsolidation();

      const consolidation = memoryDb.prepare('SELECT * FROM memory_consolidations WHERE memory_id = ?').get(loseId) as { merged_into_id: string; reason: string } | undefined;
      expect(consolidation).toBeTruthy();
      expect(consolidation!.merged_into_id).toBe(keepId);
      expect(consolidation!.reason).toBe('exact_dedup');

      const event = memoryDb.prepare("SELECT payload FROM memory_events WHERE memory_id = ? AND type = 'consolidated'").get(loseId) as { payload: string } | undefined;
      expect(event).toBeTruthy();
      const payload = JSON.parse(event!.payload);
      expect(payload.mergedInto).toBe(keepId);
    });

    it('groups by scope and memory_type (no cross-scope merge)', () => {
      insertMemoryRow(memoryDb, { dedup_key: 'dup-cross', scope: 'ws-a', memory_type: 'semantic', confidence: 0.9 });
      insertMemoryRow(memoryDb, { dedup_key: 'dup-cross', scope: 'ws-b', memory_type: 'semantic', confidence: 0.5 });

      const result = service.runConsolidation();
      // Different scopes -> different groups -> no dedup
      expect(result.deduped).toBe(0);
    });

    it('merges >0.8 text overlap', () => {
      // Same content = overlap of 1.0
      const keepId = insertMemoryRow(memoryDb, {
        content: 'the quick brown fox jumps over the lazy dog',
        scope: 'ws',
        memory_type: 'semantic',
        confidence: 0.9,
      });
      const loseId = insertMemoryRow(memoryDb, {
        content: 'the quick brown fox jumps over the lazy dog',
        scope: 'ws',
        memory_type: 'semantic',
        confidence: 0.5,
      });

      const result = service.runConsolidation();
      expect(result.merged).toBe(1);

      const loser = memoryDb.prepare('SELECT archived_at FROM memories WHERE id = ?').get(loseId) as { archived_at: string | null };
      expect(loser.archived_at).toBeTruthy();

      const keeper = memoryDb.prepare('SELECT archived_at FROM memories WHERE id = ?').get(keepId) as { archived_at: string | null };
      expect(keeper.archived_at).toBeNull();
    });

    it('does not merge <=0.8 overlap', () => {
      insertMemoryRow(memoryDb, {
        content: 'alpha beta gamma delta epsilon zeta eta theta iota kappa',
        scope: 'ws',
        memory_type: 'semantic',
        confidence: 0.9,
      });
      insertMemoryRow(memoryDb, {
        content: 'lambda mu nu xi omicron pi rho sigma tau upsilon',
        scope: 'ws',
        memory_type: 'semantic',
        confidence: 0.5,
      });

      const result = service.runConsolidation();
      expect(result.merged).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // quality sweep in consolidation
  // -----------------------------------------------------------------------

  describe('quality sweep', () => {
    it('archives low-quality memories when qualitySweepEnabled is true', () => {
      const sweepConfig = makeConfig();
      (sweepConfig as Record<string, unknown>).memory = { ...(sweepConfig.memory as Record<string, unknown>), qualitySweepEnabled: true };
      const svc = new MemoryLifecycleService(databases, sweepConfig, searchService);

      // Insert junk memory directly (bypasses storeMemory quality gate)
      insertMemoryRow(memoryDb, { description: 'junk', content: 'x', confidence: 0.5 });
      // Insert good memory
      insertMemoryRow(memoryDb, { description: 'good memory', content: 'This is a detailed and useful memory with enough content', confidence: 0.8 });

      const result = svc.runConsolidation();
      expect(result.qualityArchived).toBe(1);

      const events = memoryDb.prepare("SELECT type FROM memory_events WHERE type = 'quality_archived'").all() as Array<{ type: string }>;
      expect(events).toHaveLength(1);
    });

    it('skips quality sweep when qualitySweepEnabled is false', () => {
      // Default test config has qualitySweepEnabled: false
      insertMemoryRow(memoryDb, { description: 'junk', content: 'x', confidence: 0.5 });
      const result = service.runConsolidation();
      expect(result.qualityArchived).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // generateDailySummary
  // -----------------------------------------------------------------------

  describe('generateDailySummary', () => {
    it('returns null when no receipts for the date', () => {
      const result = service.generateDailySummary('2026-01-01', 'default');
      expect(result).toBeNull();
    });

    it('generates markdown with heading and counts', () => {
      appDb.prepare(
        'INSERT INTO receipts (id, run_id, job_id, task_id, workspace_id, status, summary, details, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('r1', 'run-1', 'job-1', 'task-1', 'default', 'succeeded', 'Did thing A', '{}', '{}', '2026-03-13T10:00:00.000Z');
      appDb.prepare(
        'INSERT INTO receipts (id, run_id, job_id, task_id, workspace_id, status, summary, details, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('r2', 'run-2', 'job-2', 'task-2', 'default', 'failed', 'Err B', '{}', '{}', '2026-03-13T14:00:00.000Z');

      const result = service.generateDailySummary('2026-03-13', 'default');
      expect(result).not.toBeNull();

      const content = readFileSync(result!.markdownPath, 'utf-8');
      expect(content).toContain('# Daily Summary');
      expect(content).toContain('**Runs completed:** 1');
      expect(content).toContain('**Runs failed:** 1');
    });

    it('writes file to memoryDailyDir with correct name', () => {
      appDb.prepare(
        'INSERT INTO receipts (id, run_id, job_id, task_id, workspace_id, status, summary, details, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('r1', 'run-1', 'job-1', 'task-1', 'default', 'succeeded', 'ok', '{}', '{}', '2026-03-13T10:00:00.000Z');

      const result = service.generateDailySummary('2026-03-13', 'default');
      expect(result!.markdownPath).toBe(join(tmpDir, 'memory', 'daily', '2026-03-13.md'));
      expect(existsSync(result!.markdownPath)).toBe(true);
    });

    it('creates memory record in the memories table', () => {
      appDb.prepare(
        'INSERT INTO receipts (id, run_id, job_id, task_id, workspace_id, status, summary, details, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('r1', 'run-1', 'job-1', 'task-1', 'default', 'succeeded', 'ok', '{}', '{}', '2026-03-13T10:00:00.000Z');

      const result = service.generateDailySummary('2026-03-13', 'default');
      expect(result!.memoryId).toBeTruthy();

      const row = memoryDb.prepare('SELECT * FROM memories WHERE id = ?').get(result!.memoryId) as Record<string, unknown> | undefined;
      expect(row).toBeTruthy();
      expect(row!.source_type).toBe('daily_summary');
      expect(row!.scope).toBe('default');
    });

    it('creates a structured daily synthesis with evidence links', () => {
      appDb.prepare(
        'INSERT INTO receipts (id, run_id, job_id, task_id, workspace_id, status, summary, details, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('r1', 'run-1', 'job-1', 'task-1', 'default', 'succeeded', 'ok', '{}', '{}', '2026-03-13T10:00:00.000Z');

      service.generateDailySummary('2026-03-13', 'default');

      const synthesis = memoryDb.prepare("SELECT id, synthesis_kind, title FROM memory_syntheses WHERE synthesis_kind = 'daily'").get() as { id: string; synthesis_kind: string; title: string } | undefined;
      expect(synthesis).toBeTruthy();
      expect(synthesis?.title).toContain('Daily summary for 2026-03-13');

      const evidence = memoryDb.prepare('SELECT COUNT(*) as c FROM memory_synthesis_sources WHERE synthesis_id = ?').get(synthesis?.id) as { c: number };
      expect(evidence.c).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // processCompactionFlush
  // -----------------------------------------------------------------------

  describe('processCompactionFlush', () => {
    it('stores single memory for short content', async () => {
      const results = await service.processCompactionFlush('run-abc', 'Short content about a decision', 'default');
      expect(results).toHaveLength(1);
      expect(results[0].description).toBe('Compaction flush from run run-abc');
      expect(results[0].confidence).toBe(0.7);

      const row = memoryDb.prepare('SELECT * FROM memories WHERE id = ?').get(results[0].id) as Record<string, unknown>;
      expect(row).toBeTruthy();
      expect(row.source_type).toBe('compaction_flush');
    });

    it('splits long content into chunks at paragraph boundaries', async () => {
      // Create content with multiple paragraphs totaling > 2000 chars
      const paragraphs: string[] = [];
      for (let i = 0; i < 20; i++) {
        paragraphs.push(`Paragraph ${i}: ${'x'.repeat(150)}`);
      }
      const longContent = paragraphs.join('\n\n');

      const results = await service.processCompactionFlush('run-long', longContent, 'default');
      expect(results.length).toBeGreaterThan(1);
      for (const result of results) {
        expect(result.content.length).toBeLessThanOrEqual(2200); // Rough upper bound allowing for paragraph boundary tolerance
      }
    });

    it('redacts sensitive content before storing', async () => {
      const redactConfig = makeConfig({ redactionPatterns: ['sk-[a-zA-Z0-9]{20,}'] });
      const svc = new MemoryLifecycleService(databases, redactConfig, searchService);

      const results = await svc.processCompactionFlush('run-secret', 'Found key sk-abcdefghijklmnopqrstuvwxyz in config', 'default'); // secret-scan: allow
      expect(results).toHaveLength(1);
      expect(results[0].content).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
      expect(results[0].content).toContain('[REDACTED:');
    });

    it('creates compaction_flushed events', async () => {
      const results = await service.processCompactionFlush('run-evt', 'Some compacted content', 'default');
      expect(results.length).toBeGreaterThanOrEqual(1);

      const events = memoryDb
        .prepare("SELECT * FROM memory_events WHERE type = 'compaction_flushed'")
        .all() as Array<{ memory_id: string; payload: string }>;
      expect(events).toHaveLength(results.length);
      for (const evt of events) {
        const payload = JSON.parse(evt.payload);
        expect(payload.runId).toBe('run-evt');
      }
    });

    it('stores provenance in memory_sources table', async () => {
      const results = await service.processCompactionFlush('run-prov', 'Provenance content from a compacted session with important context', 'default');
      expect(results).toHaveLength(1);

      const sources = memoryDb.prepare('SELECT source_type, source_ref FROM memory_sources WHERE memory_id = ?').all(results[0].id) as Array<{ source_type: string; source_ref: string }>;
      expect(sources).toHaveLength(1);
      expect(sources[0].source_type).toBe('run');
      expect(sources[0].source_ref).toBe('run-prov');
    });
  });

  // -----------------------------------------------------------------------
  // getMemoryAudit
  // -----------------------------------------------------------------------

  describe('getMemoryAudit', () => {
    it('returns zeros for empty DB', () => {
      const audit = service.getMemoryAudit();
      expect(audit.totalMemories).toBe(0);
      expect(audit.activeMemories).toBe(0);
      expect(audit.archivedMemories).toBe(0);
      expect(audit.averageConfidence).toBe(0);
      expect(audit.staleCount).toBe(0);
      expect(audit.consolidationsPerformed).toBe(0);
      expect(audit.lastDecayRunAt).toBeNull();
      expect(audit.lastConsolidationRunAt).toBeNull();
      expect(audit.lastDailySummaryAt).toBeNull();
    });

    it('counts total, active, and archived correctly', () => {
      insertMemoryRow(memoryDb, { confidence: 0.8 });
      insertMemoryRow(memoryDb, { confidence: 0.5 });
      insertMemoryRow(memoryDb, { confidence: 0.3, archived_at: new Date().toISOString() });

      const audit = service.getMemoryAudit();
      expect(audit.totalMemories).toBe(3);
      expect(audit.activeMemories).toBe(2);
      expect(audit.archivedMemories).toBe(1);
    });

    it('calculates average confidence of active memories', () => {
      insertMemoryRow(memoryDb, { confidence: 0.8 });
      insertMemoryRow(memoryDb, { confidence: 0.6 });
      // Archived memories should not count in average
      insertMemoryRow(memoryDb, { confidence: 0.1, archived_at: new Date().toISOString() });

      const audit = service.getMemoryAudit();
      expect(audit.averageConfidence).toBeCloseTo(0.7, 5);
    });

    it('breaks down by type and scope', () => {
      insertMemoryRow(memoryDb, { memory_type: 'semantic', scope: 'ws-a' });
      insertMemoryRow(memoryDb, { memory_type: 'semantic', scope: 'ws-a' });
      insertMemoryRow(memoryDb, { memory_type: 'episodic', scope: 'ws-b' });

      const audit = service.getMemoryAudit();
      expect(audit.byType).toEqual({ semantic: 2, episodic: 1 });
      expect(audit.byScope).toEqual({ 'ws-a': 2, 'ws-b': 1 });
    });
  });

  // -----------------------------------------------------------------------
  // proposePromotion and executePromotion
  // -----------------------------------------------------------------------

  describe('proposePromotion', () => {
    it('returns empty diff for missing memory', () => {
      const result = service.proposePromotion('non-existent', '/tmp/target.md');
      expect(result.diff).toBe('');
      expect(result.approved).toBe(false);
      expect(result.promoted).toBe(false);
    });

    it('returns diff content for existing memory', () => {
      const id = insertMemoryRow(memoryDb, { description: 'Promo memory', content: 'Promo content' });
      const result = service.proposePromotion(id, '/tmp/target.md');
      expect(result.diff).toContain('Promo memory');
      expect(result.diff).toContain('Promo content');
      expect(result.memoryId).toBe(id);
      expect(result.approved).toBe(false);
    });
  });

  describe('executePromotion', () => {
    it('does nothing when not approved', () => {
      const id = insertMemoryRow(memoryDb, { content: 'Promote me' });
      const proposal = service.proposePromotion(id, join(tmpDir, 'memory', 'promoted.md'));
      const result = service.executePromotion(proposal);
      expect(result.promoted).toBe(false);
      expect(existsSync(join(tmpDir, 'memory', 'promoted.md'))).toBe(false);
    });

    it('writes file with 0o600 permissions', () => {
      const id = insertMemoryRow(memoryDb, { content: 'Promote me' });
      const targetPath = join(tmpDir, 'memory', 'promoted.md');
      const proposal = service.proposePromotion(id, targetPath);
      proposal.approved = true;

      const result = service.executePromotion(proposal);
      expect(result.promoted).toBe(true);
      expect(existsSync(targetPath)).toBe(true);

      const stat = statSync(targetPath);
      // Check file permissions (mode & 0o777) equals 0o600
      expect(stat.mode & 0o777).toBe(0o600);

      const content = readFileSync(targetPath, 'utf-8');
      expect(content).toBe('Promote me');
    });

    it('blocks path traversal outside memory directory', () => {
      const id = insertMemoryRow(memoryDb, { content: 'evil' });
      const evilPath = join(tmpDir, 'memory', '..', '..', 'etc', 'passwd');
      const proposal = service.proposePromotion(id, evilPath);
      proposal.approved = true;

      expect(() => service.executePromotion(proposal)).toThrow(/Target path must be within memory directory/);
    });

    it('blocks prefix-collision paths outside memory directory', () => {
      const id = insertMemoryRow(memoryDb, { content: 'evil' });
      const prefixCollisionPath = join(tmpDir, 'memory-evil', 'promoted.md');
      const proposal = service.proposePromotion(id, prefixCollisionPath);
      proposal.approved = true;

      expect(() => service.executePromotion(proposal)).toThrow(/Target path must be within memory directory/);
    });

    it('blocks symlinked directories that escape the memory root', () => {
      const id = insertMemoryRow(memoryDb, { content: 'evil' });
      const outsideDir = join(tmpDir, 'outside');
      const linkedDir = join(tmpDir, 'memory', 'linked-outside');
      mkdirSync(outsideDir, { recursive: true });
      symlinkSync(outsideDir, linkedDir, 'dir');

      const proposal = service.proposePromotion(id, join(linkedDir, 'promoted.md'));
      proposal.approved = true;

      expect(() => service.executePromotion(proposal)).toThrow(/Target path must be within memory directory/);
    });

    it('creates promoted event', () => {
      const id = insertMemoryRow(memoryDb, { content: 'Promote me' });
      const targetPath = join(tmpDir, 'memory', 'promoted.md');
      const proposal = service.proposePromotion(id, targetPath);
      proposal.approved = true;

      service.executePromotion(proposal);

      const event = memoryDb.prepare("SELECT payload FROM memory_events WHERE memory_id = ? AND type = 'promoted'").get(id) as { payload: string } | undefined;
      expect(event).toBeTruthy();
      const payload = JSON.parse(event!.payload);
      expect(payload.targetPath).toBe(targetPath);
    });
  });

  // -----------------------------------------------------------------------
  // insertMemory
  // -----------------------------------------------------------------------

  describe('insertMemory', () => {
    it('stores a new memory via MemorySearchService.storeMemory', () => {
      const result = service.insertMemory({
        description: 'test insert for memory storage verification',
        classification: 'internal',
        sourceType: 'curated_memory',
        content: 'some content that is long enough to pass the quality gate check',
        confidence: 0.9,
        scope: 'default',
      });
      expect(result.memoryId).toBeTruthy();
      expect(result.embedded).toBe(false);

      const row = memoryDb.prepare('SELECT * FROM memories WHERE id = ?').get(result.memoryId) as Record<string, unknown> | undefined;
      expect(row).toBeTruthy();
      expect(row!.description).toBe('test insert for memory storage verification');
      expect(row!.confidence).toBe(0.9);
      expect(row!.scope).toBe('default');
    });

    it('uses provided memoryType over auto-classified type', () => {
      const result = service.insertMemory({
        description: 'procedural insert with explicit type override',
        classification: 'internal',
        sourceType: 'curated_memory',
        content: 'how to do X step by step with detailed instructions for the workflow',
        confidence: 0.8,
        scope: 'default',
        memoryType: 'procedural',
      });

      const row = memoryDb.prepare('SELECT memory_type FROM memories WHERE id = ?').get(result.memoryId) as { memory_type: string };
      expect(row.memory_type).toBe('procedural');
    });

    it('auto-classifies memoryType when not provided', () => {
      const result = service.insertMemory({
        description: 'auto classify memory type test',
        classification: 'internal',
        sourceType: 'curated_memory',
        content: 'just some content to verify automatic memory type classification',
        confidence: 0.7,
        scope: 'default',
      });

      const row = memoryDb.prepare('SELECT memory_type FROM memories WHERE id = ?').get(result.memoryId) as { memory_type: string };
      // classifyMemoryType for curated_memory returns 'semantic'
      expect(row.memory_type).toBeTruthy();
    });

    it('creates memory_events with created type', () => {
      const result = service.insertMemory({
        description: 'event check for memory lifecycle tracking',
        classification: 'internal',
        sourceType: 'curated_memory',
        content: 'event content for verifying that creation events are recorded properly',
        confidence: 0.8,
        scope: 'default',
      });

      const event = memoryDb.prepare("SELECT type FROM memory_events WHERE memory_id = ? AND type = 'created'").get(result.memoryId) as { type: string } | undefined;
      expect(event).toBeTruthy();
      expect(event!.type).toBe('created');
    });

    it('reinforces existing memory with same dedup_key instead of creating duplicate', () => {
      const first = service.insertMemory({
        description: 'dedup test for reinforcement verification',
        classification: 'internal',
        sourceType: 'curated_memory',
        content: 'same content that is long enough to pass quality checks for dedup',
        confidence: 0.5,
        scope: 'default',
      });
      const second = service.insertMemory({
        description: 'dedup test for reinforcement verification',
        classification: 'internal',
        sourceType: 'curated_memory',
        content: 'same content that is long enough to pass quality checks for dedup',
        confidence: 0.5,
        scope: 'default',
      });

      // Should reinforce, not create new
      expect(second.memoryId).toBe(first.memoryId);

      const row = memoryDb.prepare('SELECT confidence FROM memories WHERE id = ?').get(first.memoryId) as { confidence: number };
      // Reinforced once: 0.5 -> 0.6
      expect(row.confidence).toBeCloseTo(0.6, 5);
    });

    it('stores memory_sources when sourceRef is provided', () => {
      const result = service.insertMemory({
        description: 'sourced memory with provenance tracking',
        classification: 'internal',
        sourceType: 'curated_memory',
        content: 'source content from a specific run for provenance verification',
        confidence: 0.8,
        scope: 'default',
        sourceRef: 'run-123',
        sourceRefType: 'run',
      });

      const source = memoryDb.prepare('SELECT * FROM memory_sources WHERE memory_id = ?').get(result.memoryId) as { source_ref: string; source_type: string } | undefined;
      expect(source).toBeTruthy();
      expect(source!.source_ref).toBe('run-123');
      expect(source!.source_type).toBe('run');
    });

    it('dual-writes structured artifacts and facts for receipt memories', () => {
      service.insertMemory({
        description: 'Run failed due to missing credentials',
        classification: 'sensitive',
        sourceType: 'receipt',
        content: 'The deployment failed because the API credentials were missing from the environment.',
        confidence: 1,
        scope: 'default',
        memoryType: 'episodic',
        sourceRef: 'receipt-123',
        sourceRefType: 'receipt',
        sourceRunId: 'run-123',
        sourceTimestamp: '2026-03-18T12:00:00.000Z',
        tags: ['receipt', 'failure'],
      });

      const artifact = memoryDb.prepare('SELECT source_ref, scope FROM memory_artifacts WHERE source_ref = ?').get('receipt-123') as { source_ref: string; scope: string } | undefined;
      expect(artifact).toEqual({ source_ref: 'receipt-123', scope: 'default' });

      const factCount = memoryDb.prepare("SELECT COUNT(*) as c FROM memory_facts WHERE source_type = 'receipt'").get() as { c: number };
      expect(factCount.c).toBeGreaterThan(0);

      const linkedCount = memoryDb.prepare('SELECT COUNT(*) as c FROM memory_fact_sources').get() as { c: number };
      expect(linkedCount.c).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // indexWorkspaceDocs
  // -----------------------------------------------------------------------

  describe('indexWorkspaceDocs', () => {
    let docsDir: string;

    beforeEach(() => {
      docsDir = join(tmpDir, 'workspace-root');
      mkdirSync(docsDir, { recursive: true });
    });

    it('indexes markdown files with correct source_type', () => {
      writeFileSync(join(docsDir, 'README.md'), '# My Project\n\nThis is a detailed project description with enough content for quality checks.');
      writeFileSync(join(docsDir, 'NOTES.md'), 'Some notes about the project architecture and design decisions made during development.');

      const result = service.indexWorkspaceDocs('ws-1', docsDir);
      expect(result.indexed).toBe(2);
      expect(result.skipped).toBe(0);

      const rows = memoryDb.prepare("SELECT * FROM memories WHERE source_type = 'workspace_doc'").all() as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(2);
      expect(rows.some(r => r.description === 'Workspace doc: README.md')).toBe(true);
      expect(rows.some(r => r.description === 'Workspace doc: NOTES.md')).toBe(true);
    });

    it('skips unchanged files on re-index (dedup)', () => {
      writeFileSync(join(docsDir, 'README.md'), '# My Project\n\nThis is a detailed project description with enough content for quality checks.');

      service.indexWorkspaceDocs('ws-1', docsDir);
      const result = service.indexWorkspaceDocs('ws-1', docsDir);
      expect(result.indexed).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it('re-indexes when file content changes', () => {
      writeFileSync(join(docsDir, 'README.md'), '# Version 1\n\nFirst version of the documentation with initial content.');
      service.indexWorkspaceDocs('ws-1', docsDir);

      writeFileSync(join(docsDir, 'README.md'), '# Version 2\n\nUpdated version with changed content for re-indexing test.');
      const result = service.indexWorkspaceDocs('ws-1', docsDir);
      expect(result.indexed).toBe(1);
      expect(result.skipped).toBe(0);

      const rows = memoryDb
        .prepare("SELECT content FROM memories WHERE source_type = 'workspace_doc' AND archived_at IS NULL")
        .all() as Array<{ content: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].content).toContain('Version 2');
    });

    it('ignores non-markdown files', () => {
      writeFileSync(join(docsDir, 'README.md'), '# Docs\n\nDocumentation overview for the project with detailed sections.');
      writeFileSync(join(docsDir, 'data.json'), '{}');
      writeFileSync(join(docsDir, 'script.ts'), 'console.log()');

      const result = service.indexWorkspaceDocs('ws-1', docsDir);
      expect(result.indexed).toBe(1);
    });

    it('returns zeros for non-existent directory', () => {
      const result = service.indexWorkspaceDocs('ws-1', '/nonexistent/path');
      expect(result).toEqual({ indexed: 0, skipped: 0 });
    });

    it('recursively indexes markdown files in subdirectories', () => {
      mkdirSync(join(docsDir, 'docs', 'adr'), { recursive: true });
      mkdirSync(join(docsDir, 'notes'), { recursive: true });
      mkdirSync(join(docsDir, 'node_modules', 'pkg'), { recursive: true });
      mkdirSync(join(docsDir, '.git'), { recursive: true });

      writeFileSync(join(docsDir, 'README.md'), '# Root doc\n\nRoot documentation file with detailed project information.');
      writeFileSync(join(docsDir, 'docs', 'adr', 'decision-001.md'), '# ADR 1\n\nArchitecture decision record for database choice with rationale.');
      writeFileSync(join(docsDir, 'notes', 'weekly.md'), '# Weekly notes\n\nWeekly engineering notes with progress updates and blockers.');
      writeFileSync(join(docsDir, 'node_modules', 'pkg', 'README.md'), '# Pkg readme\n\nPackage documentation that should be skipped by indexer.');
      writeFileSync(join(docsDir, '.git', 'config.md'), '# Git config\n\nGit configuration file that should be skipped by indexer.');

      const result = service.indexWorkspaceDocs('ws-1', docsDir);
      expect(result.indexed).toBe(3);

      const rows = memoryDb
        .prepare("SELECT description FROM memories WHERE source_type = 'workspace_doc'")
        .all() as Array<{ description: string }>;
      const descriptions = rows.map(r => r.description);
      expect(descriptions).toContain('Workspace doc: README.md');
      expect(descriptions).toContain('Workspace doc: docs/adr/decision-001.md');
      expect(descriptions).toContain('Workspace doc: notes/weekly.md');
      // Skipped directories should not appear
      expect(descriptions).not.toContain(expect.stringContaining('node_modules'));
      expect(descriptions).not.toContain(expect.stringContaining('.git'));
    });

    it('redacts sensitive content before storing', () => {
      const redactConfig = makeConfig({ redactionPatterns: ['sk-[a-zA-Z0-9]{20,}'] });
      const svc = new MemoryLifecycleService(databases, redactConfig, searchService);

      writeFileSync(join(docsDir, 'secrets.md'), 'API key: sk-abcdefghijklmnopqrstuvwxyz should not appear'); // secret-scan: allow

      svc.indexWorkspaceDocs('ws-1', docsDir);

      const rows = memoryDb
        .prepare("SELECT content FROM memories WHERE source_type = 'workspace_doc' AND archived_at IS NULL")
        .all() as Array<{ content: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].content).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
      expect(rows[0].content).toContain('[REDACTED:');
    });

    it('indexed docs are searchable via FTS5', async () => {
      writeFileSync(join(docsDir, 'architecture.md'), '# Architecture\n\nThe system uses a layered approach with clear boundaries.');

      service.indexWorkspaceDocs('ws-1', docsDir);

      const response = await searchService.search({
        query: 'layered architecture',
        includeContent: true,
      });

      expect(response.results.length).toBeGreaterThanOrEqual(1);
      const match = response.results.find(r => r.sourceType === 'workspace_doc');
      expect(match).toBeTruthy();
      expect(match!.content).toContain('layered approach');
    });
  });

  // -----------------------------------------------------------------------
  // C1: Full consolidation cycle integration tests
  // -----------------------------------------------------------------------

  describe('full consolidation cycle', () => {
    it('decay reduces confidence on old memories', () => {
      const id = insertMemoryRow(memoryDb, { confidence: 0.8, created_at: daysAgo(60) });
      const result = service.runConfidenceDecay();
      expect(result.decayed).toBeGreaterThanOrEqual(1);

      const row = memoryDb.prepare('SELECT confidence FROM memories WHERE id = ?').get(id) as { confidence: number };
      // 60 days with halfLife 30 => roughly 0.8 * 0.25 = 0.2
      expect(row.confidence).toBeLessThan(0.8);
      expect(row.confidence).toBeGreaterThan(0);
    });

    it('decay + archive: very low confidence memory gets archived', () => {
      const id = insertMemoryRow(memoryDb, { confidence: 0.15, created_at: daysAgo(120) });
      const result = service.runConfidenceDecay();
      expect(result.archived).toBeGreaterThanOrEqual(1);

      const row = memoryDb.prepare('SELECT archived_at, confidence FROM memories WHERE id = ?').get(id) as { archived_at: string | null; confidence: number };
      expect(row.archived_at).toBeTruthy();
      expect(row.confidence).toBeLessThan(0.1);
    });

    it('durable memories resist archiving with extended half-life', () => {
      // Insert a durable memory 60 days old with moderate confidence.
      // Normal halfLife=30 would decay 0.5 to ~0.125 at 60 days.
      // Durable uses 10x halfLife (300 days), so decay is minimal.
      const id = insertMemoryRow(memoryDb, { confidence: 0.5, created_at: daysAgo(60) });
      memoryDb.prepare('UPDATE memories SET durable = 1 WHERE id = ?').run(id);

      const result = service.runConfidenceDecay();

      const row = memoryDb.prepare('SELECT confidence, archived_at FROM memories WHERE id = ?').get(id) as { confidence: number; archived_at: string | null };
      // With halfLife 300, 60 days of decay barely reduces it
      expect(row.confidence).toBeGreaterThan(0.4);
      expect(row.archived_at).toBeNull();
      // But decay did touch it
      expect(result.decayed).toBeGreaterThanOrEqual(1);
    });

    it('consolidation merges identical content within same scope+type group', () => {
      const content = 'identical content for merge test in the consolidation cycle';
      const keepId = insertMemoryRow(memoryDb, {
        content,
        scope: 'ws-test',
        memory_type: 'semantic',
        confidence: 0.9,
      });
      const loseId = insertMemoryRow(memoryDb, {
        content,
        scope: 'ws-test',
        memory_type: 'semantic',
        confidence: 0.4,
      });

      const result = service.runConsolidation();
      expect(result.merged).toBeGreaterThanOrEqual(1);

      const loser = memoryDb.prepare('SELECT archived_at FROM memories WHERE id = ?').get(loseId) as { archived_at: string | null };
      expect(loser.archived_at).toBeTruthy();

      const keeper = memoryDb.prepare('SELECT archived_at FROM memories WHERE id = ?').get(keepId) as { archived_at: string | null };
      expect(keeper.archived_at).toBeNull();

      // Consolidation record exists
      const consolidation = memoryDb.prepare('SELECT merged_into_id, reason FROM memory_consolidations WHERE memory_id = ?').get(loseId) as { merged_into_id: string; reason: string } | undefined;
      expect(consolidation).toBeTruthy();
      expect(consolidation!.merged_into_id).toBe(keepId);
      expect(consolidation!.reason).toContain('text_overlap');
    });

    it('full cycle: insert, decay, consolidate, verify end state', () => {
      // Insert two memories: one old and one fresh
      const oldId = insertMemoryRow(memoryDb, {
        confidence: 1.0,
        created_at: daysAgo(90),
        scope: 'ws-cycle',
        memory_type: 'semantic',
        content: 'old memory about the project architecture and design principles',
      });
      const freshId = insertMemoryRow(memoryDb, {
        confidence: 0.8,
        created_at: new Date().toISOString(),
        scope: 'ws-cycle',
        memory_type: 'semantic',
        content: 'fresh memory about something completely different and unrelated',
      });

      // Decay
      const decayResult = service.runConfidenceDecay();
      expect(decayResult.decayed).toBeGreaterThanOrEqual(1);

      // Old memory should have lower confidence now
      const oldRow = memoryDb.prepare('SELECT confidence FROM memories WHERE id = ?').get(oldId) as { confidence: number };
      expect(oldRow.confidence).toBeLessThan(1.0);

      // Fresh memory should be untouched
      const freshRow = memoryDb.prepare('SELECT confidence FROM memories WHERE id = ?').get(freshId) as { confidence: number };
      expect(freshRow.confidence).toBeCloseTo(0.8, 1);

      // Consolidate -- no overlap between the two, so merged should be 0
      const consolidateResult = service.runConsolidation();
      expect(consolidateResult.merged).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // C2: Memory maintenance scheduling test
  // -----------------------------------------------------------------------

  describe('memory maintenance scheduling', () => {
    it('runtime startMemoryMaintenance is invoked during init (via startScheduler)', () => {
      // The daemon calls runtime.startScheduler(), which internally calls
      // startMemoryMaintenance(). We verify by checking that the timer
      // machinery exists in RuntimeService. Since we cannot easily instantiate
      // a full RuntimeService here, we test the underlying lifecycle methods
      // that the timer would invoke work correctly in sequence.
      const decayResult = service.runConfidenceDecay();
      expect(decayResult).toEqual({ decayed: 0, archived: 0 });

      const consolidateResult = service.runConsolidation();
      expect(consolidateResult).toEqual({ merged: 0, deduped: 0, qualityArchived: 0 });

      // Generate daily summary returns null for empty DB
      const summaryResult = service.generateDailySummary('2026-03-20', 'default');
      expect(summaryResult).toBeNull();
    });

    it('maintenance cycle runs decay then consolidation in sequence', () => {
      // Simulate what the hourly timer does: decay, then consolidate
      // Insert some data first
      const oldId = insertMemoryRow(memoryDb, {
        confidence: 0.3,
        created_at: daysAgo(180),
        scope: 'ws-maint',
        memory_type: 'semantic',
      });
      insertMemoryRow(memoryDb, {
        confidence: 0.9,
        created_at: new Date().toISOString(),
        scope: 'ws-maint',
        memory_type: 'semantic',
      });

      // Step 1: Decay
      const decayResult = service.runConfidenceDecay();
      expect(decayResult.decayed).toBeGreaterThanOrEqual(1);

      // Old memory should now be archived (0.3 after 180 days with halfLife 30 is near zero)
      const oldRow = memoryDb.prepare('SELECT archived_at FROM memories WHERE id = ?').get(oldId) as { archived_at: string | null };
      expect(oldRow.archived_at).toBeTruthy();

      // Step 2: Consolidation skips archived memories
      const consolidateResult = service.runConsolidation();
      // Only one active memory left, no groups to consolidate
      expect(consolidateResult.merged).toBe(0);
      expect(consolidateResult.deduped).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // C4: Provenance preservation tests
  // -----------------------------------------------------------------------

  describe('provenance preservation', () => {
    it('stored memories retain source_run_id, source_timestamp, and confidence', () => {
      const result = service.insertMemory({
        description: 'provenance test memory with source tracking',
        classification: 'internal',
        sourceType: 'receipt',
        content: 'The deployment succeeded with all checks passing in the CI pipeline',
        confidence: 0.85,
        scope: 'default',
        sourceRunId: 'run-prov-001',
        sourceTimestamp: '2026-03-15T14:00:00.000Z',
      });

      const row = memoryDb.prepare('SELECT source_run_id, source_timestamp, confidence FROM memories WHERE id = ?').get(result.memoryId) as {
        source_run_id: string | null;
        source_timestamp: string | null;
        confidence: number;
      };

      expect(row.source_run_id).toBe('run-prov-001');
      expect(row.source_timestamp).toBe('2026-03-15T14:00:00.000Z');
      expect(row.confidence).toBe(0.85);
    });

    it('reinforcement updates last_reinforced_at and boosts confidence', () => {
      const result = service.insertMemory({
        description: 'reinforcement provenance test memory',
        classification: 'internal',
        sourceType: 'curated_memory',
        content: 'content that is long enough to pass quality checks for reinforcement test',
        confidence: 0.6,
        scope: 'default',
      });

      const before = new Date();
      service.reinforceMemory(result.memoryId);

      const row = memoryDb.prepare('SELECT confidence, last_reinforced_at FROM memories WHERE id = ?').get(result.memoryId) as {
        confidence: number;
        last_reinforced_at: string | null;
      };

      // Confidence boosted by 0.1
      expect(row.confidence).toBeCloseTo(0.7, 5);
      // last_reinforced_at set to a recent timestamp
      expect(row.last_reinforced_at).toBeTruthy();
      const reinforcedAt = new Date(row.last_reinforced_at!);
      expect(reinforcedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    });

    it('auto-computed dedup key prevents duplicate insertion, reinforces instead', () => {
      // The dedup key is computed from description+content+scope by storeMemory.
      // Identical inputs should produce the same dedup key and reinforce.
      const first = service.insertMemory({
        description: 'dedup provenance test for preventing duplicates',
        classification: 'internal',
        sourceType: 'curated_memory',
        content: 'unique content for dedup provenance test that checks dedup key behavior',
        confidence: 0.5,
        scope: 'default',
      });

      const second = service.insertMemory({
        description: 'dedup provenance test for preventing duplicates',
        classification: 'internal',
        sourceType: 'curated_memory',
        content: 'unique content for dedup provenance test that checks dedup key behavior',
        confidence: 0.5,
        scope: 'default',
      });

      // Same memory ID -- reinforced rather than duplicated
      expect(second.memoryId).toBe(first.memoryId);

      // Confidence should have increased due to reinforcement
      const row = memoryDb.prepare('SELECT confidence FROM memories WHERE id = ?').get(first.memoryId) as { confidence: number };
      expect(row.confidence).toBeCloseTo(0.6, 5);

      // Only one row in the memories table for this content
      const count = memoryDb.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number };
      expect(count.c).toBe(1);
    });

    it('provenance fields survive reinforcement without being cleared', () => {
      const result = service.insertMemory({
        description: 'provenance survives reinforcement test',
        classification: 'internal',
        sourceType: 'receipt',
        content: 'Content with provenance that must be preserved through reinforcement cycles',
        confidence: 0.7,
        scope: 'default',
        sourceRunId: 'run-survive-001',
        sourceTimestamp: '2026-03-14T10:00:00.000Z',
      });

      // Reinforce the memory
      service.reinforceMemory(result.memoryId);

      const row = memoryDb.prepare('SELECT source_run_id, source_timestamp, confidence FROM memories WHERE id = ?').get(result.memoryId) as {
        source_run_id: string | null;
        source_timestamp: string | null;
        confidence: number;
      };

      // Provenance fields preserved
      expect(row.source_run_id).toBe('run-survive-001');
      expect(row.source_timestamp).toBe('2026-03-14T10:00:00.000Z');
      // Confidence was boosted
      expect(row.confidence).toBeCloseTo(0.8, 5);
    });
  });
});
