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
  const content = overrides.content ?? 'test content';
  const now = new Date().toISOString();
  // Ensure namespace exists
  db.prepare('INSERT OR IGNORE INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('ns-test', 'workspace', 'workspace', 'Test workspace', now, now);
  db.prepare(
    `INSERT INTO memory_facts (id, namespace_id, scope, classification, source_type, memory_type, fact_kind, text, confidence, source_reliability, extraction_confidence, created_at, archived_at, domain)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    'ns-test',
    overrides.scope ?? 'workspace',
    overrides.classification ?? 'internal',
    overrides.source_type ?? 'receipt',
    overrides.memory_type ?? 'episodic',
    'event',
    content,
    overrides.confidence ?? 0.8,
    0.8,
    0.8,
    overrides.created_at ?? now,
    overrides.archived_at ?? null,
    'general',
  );
  return id;
}

function _insertFactRow(
  db: Database.Database,
  overrides: Partial<{
    id: string;
    text: string;
    classification: string;
    source_type: string;
    confidence: number;
    scope: string;
    memory_type: string;
    archived_at: string | null;
    created_at: string;
  }> = {},
): string {
  const id = overrides.id ?? randomUUID();
  const text = overrides.text ?? 'test fact content';
  const now = new Date().toISOString();
  const nsId = `ns-${randomUUID()}`;
  db.prepare(
    'INSERT OR IGNORE INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(nsId, 'workspace', 'workspace', 'Test namespace', now, now);
  db.prepare(
    `INSERT INTO memory_facts (id, namespace_id, scope, classification, source_type, memory_type, fact_kind, text, confidence, source_reliability, extraction_confidence, created_at, domain)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    nsId,
    overrides.scope ?? 'workspace',
    overrides.classification ?? 'internal',
    overrides.source_type ?? 'receipt',
    overrides.memory_type ?? 'episodic',
    'event',
    text,
    overrides.confidence ?? 0.8,
    0.8,
    0.8,
    overrides.created_at ?? now,
    'general',
  );
  db.prepare('INSERT INTO memory_facts_fts (fact_id, text) VALUES (?, ?)').run(id, text);
  return id;
}

function _daysAgo(n: number): string {
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
  // reinforceMemory, runConfidenceDecay, runConsolidation, quality sweep
  // -----------------------------------------------------------------------
  // These methods were removed as part of the legacy memory code cleanup.
  // Tests for them have been deleted.

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

    it('creates structured artifact for daily summary', () => {
      appDb.prepare(
        'INSERT INTO receipts (id, run_id, job_id, task_id, workspace_id, status, summary, details, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('r1', 'run-1', 'job-1', 'task-1', 'default', 'succeeded', 'ok', '{}', '{}', '2026-03-13T10:00:00.000Z');

      const result = service.generateDailySummary('2026-03-13', 'default');
      expect(result!.memoryId).toBeTruthy();

      // insertMemory now writes to structured tables (memory_artifacts), not the legacy memories table.
      const artifact = memoryDb.prepare('SELECT source_type, scope FROM memory_artifacts WHERE id = ?').get(result!.memoryId) as { source_type: string; scope: string } | undefined;
      expect(artifact).toBeTruthy();
      expect(artifact!.source_type).toBe('daily_summary');
      expect(artifact!.scope).toBe('default');
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

      // insertMemory now writes to structured tables (memory_artifacts), not the legacy memories table.
      const artifact = memoryDb.prepare('SELECT source_type FROM memory_artifacts WHERE id = ?').get(results[0].id) as { source_type: string } | undefined;
      expect(artifact).toBeTruthy();
      expect(artifact!.source_type).toBe('compaction_flush');
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

    it('creates structured artifacts for compaction flushes', async () => {
      const results = await service.processCompactionFlush('run-evt', 'Some compacted content', 'default');
      expect(results.length).toBeGreaterThanOrEqual(1);

      // Verify artifacts were created with correct source_run_id
      for (const result of results) {
        const artifact = memoryDb.prepare('SELECT source_run_id, source_type FROM memory_artifacts WHERE id = ?').get(result.id) as { source_run_id: string; source_type: string } | undefined;
        expect(artifact).toBeTruthy();
        expect(artifact!.source_run_id).toBe('run-evt');
        expect(artifact!.source_type).toBe('compaction_flush');
      }
    });

    it('stores provenance in structured artifacts', async () => {
      const results = await service.processCompactionFlush('run-prov', 'Provenance content from a compacted session with important context', 'default');
      expect(results).toHaveLength(1);

      // Provenance is stored in the memory_artifacts table via captureStructuredMemory.
      const artifact = memoryDb.prepare('SELECT source_run_id, source_ref FROM memory_artifacts WHERE id = ?').get(results[0].id) as { source_run_id: string; source_ref: string } | undefined;
      expect(artifact).toBeTruthy();
      expect(artifact!.source_run_id).toBe('run-prov');
      expect(artifact!.source_ref).toBe('run-prov');
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

    it('executes promotion and writes file', () => {
      const id = insertMemoryRow(memoryDb, { content: 'Promote me' });
      const targetPath = join(tmpDir, 'memory', 'promoted-event.md');
      const proposal = service.proposePromotion(id, targetPath);
      proposal.approved = true;

      const result = service.executePromotion(proposal);
      expect(result.promoted).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // insertMemory
  // -----------------------------------------------------------------------

  describe('insertMemory', () => {
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

      // insertMemory now writes to structured tables (memory_artifacts/memory_facts), not the legacy memories table.
      const artifacts = memoryDb.prepare("SELECT source_type FROM memory_artifacts WHERE source_type = 'workspace_doc'").all() as Array<Record<string, unknown>>;
      expect(artifacts.length).toBeGreaterThanOrEqual(2);
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

      // Check structured tables for updated content
      const facts = memoryDb
        .prepare("SELECT text FROM memory_facts WHERE source_type = 'workspace_doc' AND archived_at IS NULL")
        .all() as Array<{ text: string }>;
      expect(facts.length).toBeGreaterThanOrEqual(1);
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

      // Verify artifacts were created for the indexed files (structured tables)
      const artifacts = memoryDb
        .prepare("SELECT source_ref FROM memory_artifacts WHERE source_type = 'workspace_doc'")
        .all() as Array<{ source_ref: string }>;
      expect(artifacts.length).toBeGreaterThanOrEqual(3);
    });

    it('redacts sensitive content before storing', () => {
      const redactConfig = makeConfig({ redactionPatterns: ['sk-[a-zA-Z0-9]{20,}'] });
      const svc = new MemoryLifecycleService(databases, redactConfig, searchService);

      writeFileSync(join(docsDir, 'secrets.md'), 'API key: sk-abcdefghijklmnopqrstuvwxyz should not appear'); // secret-scan: allow

      svc.indexWorkspaceDocs('ws-1', docsDir);

      const rows = memoryDb
        .prepare("SELECT content FROM memory_artifacts WHERE source_type = 'workspace_doc'")
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
  // C1: Full consolidation cycle — DELETED
  // reinforceMemory, runConfidenceDecay, runConsolidation were removed.
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // C2: Memory maintenance scheduling — DELETED
  // runConfidenceDecay and runConsolidation were removed.
  // Structured governance is tested via runStructuredGovernance.
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // C4: Provenance preservation — DELETED
  // reinforceMemory was removed. Provenance is now tracked in structured
  // tables (memory_artifacts, memory_facts) via captureStructuredMemory.
  // The dual-write test in insertMemory covers structured provenance.
  // -----------------------------------------------------------------------
});
