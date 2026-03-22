import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDisabledEmbeddingClient } from './embedding-client.js';
import { MemorySearchService } from './search-service.js';

/**
 * Insert a fact row into `memory_facts` and sync `memory_facts_fts`.
 * Returns the generated fact id.
 */
function insertTestFact(db: Database.Database, opts: {
  text: string;
  scope?: string;
  workspaceId?: string | null;
  projectId?: string | null;
  factKind?: string;
  confidence?: number;
  domain?: string;
  memoryType?: string;
  sourceType?: string;
  classification?: string;
  durable?: boolean;
  createdAt?: string;
}): string {
  const id = `f-${Math.random().toString(36).slice(2, 8)}`;
  const now = opts.createdAt ?? new Date().toISOString();
  const scope = opts.scope ?? 'workspace';
  const workspaceId = opts.workspaceId !== undefined ? opts.workspaceId : (scope === 'global' ? null : 'workspace');
  const projectId = opts.projectId !== undefined ? opts.projectId : null;
  db.prepare(
    `INSERT INTO memory_facts (id, namespace_id, scope, workspace_id, project_id, classification, source_type, memory_type, fact_kind, text, confidence, source_reliability, extraction_confidence, created_at, durable, domain)
     VALUES (?, 'ns-1', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.8, 0.8, ?, ?, ?)`,
  ).run(
    id,
    scope,
    workspaceId,
    projectId,
    opts.classification ?? 'internal',
    opts.sourceType ?? 'receipt',
    opts.memoryType ?? 'semantic',
    opts.factKind ?? 'event',
    opts.text,
    opts.confidence ?? 0.8,
    now,
    opts.durable ? 1 : 0,
    opts.domain ?? 'general',
  );
  // Sync FTS
  db.prepare('INSERT INTO memory_facts_fts (fact_id, text) VALUES (?, ?)').run(id, opts.text);
  return id;
}

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
      domain TEXT NOT NULL DEFAULT 'general',
      source_stream_id TEXT,
      artifact_version INTEGER NOT NULL DEFAULT 1,
      context_release_policy TEXT NOT NULL DEFAULT 'full',
      trust_score REAL NOT NULL DEFAULT 0.7,
      invalidated_at TEXT
    );
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
      is_latest INTEGER NOT NULL DEFAULT 1,
      salience REAL NOT NULL DEFAULT 0.5,
      support_count INTEGER NOT NULL DEFAULT 1,
      source_trust_score REAL NOT NULL DEFAULT 0.7,
      operator_status TEXT NOT NULL DEFAULT 'normal'
    );
    CREATE TABLE memory_fact_sources (
      id TEXT PRIMARY KEY,
      fact_id TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      excerpt TEXT,
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
      domain TEXT DEFAULT 'general'
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
  `);
  // Seed default namespace used by insertTestFact
  db.prepare(
    `INSERT INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('ns-1', 'workspace', 'workspace', 'Default test namespace', '2026-03-18T10:00:00.000Z', '2026-03-18T10:00:00.000Z');
  return db;
}

describe('MemorySearchService', () => {
  let db: Database.Database;
  let service: MemorySearchService;

  beforeEach(() => {
    db = createTestDb();
    service = new MemorySearchService({
      db,
      embeddingClient: createDisabledEmbeddingClient(),
      vecAvailable: false,
    });
  });

  afterEach(() => {
    db.close();
  });

  describe('search', () => {
    it('finds stored facts via FTS5', async () => {
      insertTestFact(db, { text: 'We migrated the entire codebase from JavaScript to TypeScript' });

      const response = await service.search({
        query: 'TypeScript migration',
      });

      expect(response.searchMode).toBe('fts_only');
      expect(response.results).toHaveLength(1);
      expect(response.results[0]!.content).toBeNull(); // includeContent defaults to false
      expect(response.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('includes content when requested', async () => {
      insertTestFact(db, { text: 'The actual content here for content test' });

      const response = await service.search({
        query: 'content test',
        includeContent: true,
      });

      expect(response.results[0]!.content).toContain('actual content here');
    });

    it('filters by workspaceId', async () => {
      insertTestFact(db, { text: 'Data for workspace A about deployment', workspaceId: 'workspace-a', scope: 'workspace' });
      insertTestFact(db, { text: 'Data for workspace B about deployment', workspaceId: 'workspace-b', scope: 'workspace' });

      const response = await service.search({
        query: 'deployment',
        workspaceId: 'workspace-a',
      });

      expect(response.results).toHaveLength(1);
      expect(response.results[0]!.workspaceId).toBe('workspace-a');
    });

    it('returns score breakdown', async () => {
      insertTestFact(db, { text: 'This is scored content for scoring test' });

      const response = await service.search({
        query: 'scored',
      });

      const result = response.results[0]!;
      expect(result.scoreBreakdown).toBeDefined();
      expect(result.scoreBreakdown.relevance).toBeGreaterThan(0);
      expect(result.scoreBreakdown.recency).toBeGreaterThan(0);
      expect(result.scoreBreakdown.confidence).toBeGreaterThan(0);
      expect(typeof result.scoreBreakdown.scopeMatch).toBe('number');
      expect(result.score).toBeGreaterThan(0);
    });

    it('respects limit', async () => {
      for (let i = 0; i < 10; i++) {
        insertTestFact(db, { text: `Testing content number ${i} with detailed information about the test scenario` });
      }

      const response = await service.search({
        query: 'testing',
        limit: 3,
      });

      expect(response.results.length).toBeLessThanOrEqual(3);
    });
  });

  describe('getMemoryContent', () => {
    it('returns null for non-existent memory', () => {
      const result = service.getMemoryContent('non-existent');
      expect(result).toBeNull();
    });

    it('returns full record for existing fact', () => {
      const factId = insertTestFact(db, {
        text: 'Full content here with enough detail for quality gate',
        confidence: 0.8,
        scope: 'workspace',
        sourceType: 'receipt',
        memoryType: 'semantic',
      });

      const record = service.getMemoryContent(factId);
      expect(record).not.toBeNull();
      expect(record!.id).toBe(factId);
      expect(record!.sourceType).toBe('receipt');
      expect(record!.content).toBe('Full content here with enough detail for quality gate');
      expect(record!.confidence).toBe(0.8);
      expect(record!.scope).toBe('workspace');
      expect(record!.memoryType).toBe('semantic');
      expect(record!.createdAt).toBeTruthy();
    });
  });

  describe('totalCandidates', () => {
    it('reports pre-limit candidate count', async () => {
      for (let i = 0; i < 5; i++) {
        insertTestFact(db, { text: `Deployment details and configuration for environment number ${i}` });
      }

      const response = await service.search({
        query: 'deployment',
        limit: 2,
      });

      expect(response.results.length).toBeLessThanOrEqual(2);
      expect(response.totalCandidates).toBeGreaterThanOrEqual(response.results.length);
    });
  });

  describe('query in response', () => {
    it('returns the original query, not the sanitized version', async () => {
      insertTestFact(db, { text: 'The user birthday is March 15th according to their profile' });

      const queryWithInjection = '[Memory: some old context] birthday';
      const response = await service.search({ query: queryWithInjection });

      expect(response.query).toBe(queryWithInjection);
    });
  });
});


// ---------------------------------------------------------------------------
// budgetFit tests
// ---------------------------------------------------------------------------

describe('budgetFit', () => {
  let db: Database.Database;
  let service: MemorySearchService;

  beforeEach(() => {
    db = createTestDb();
    service = new MemorySearchService({
      db,
      embeddingClient: createDisabledEmbeddingClient(),
      vecAvailable: false,
    });
  });

  afterEach(() => {
    db.close();
  });

  it('fits results within token budget', async () => {
    for (let i = 0; i < 5; i++) {
      insertTestFact(db, { text: `Content for budget test ${i} with some detail about the scenario` });
    }

    const result = await service.budgetFit({
      query: 'budget test',
      maxTokens: 50, // Very small budget
    });

    expect(result.totalTokensUsed).toBeLessThanOrEqual(result.totalTokensBudget);
    expect(result.totalTokensBudget).toBe(50);
  });

  it('drops results that exceed budget', async () => {
    for (let i = 0; i < 10; i++) {
      insertTestFact(db, { text: `Detailed content for overflow test ${i} with enough text to consume tokens` });
    }

    const result = await service.budgetFit({
      query: 'overflow test',
      maxTokens: 30, // Tiny budget
    });

    expect(result.droppedCount + result.results.length + result.truncatedCount).toBeGreaterThan(0);
    expect(result.totalTokensUsed).toBeLessThanOrEqual(30);
  });

  it('includes expansion policy metadata', async () => {
    insertTestFact(db, { text: 'Content for expansion policy test with details' });

    const result = await service.budgetFit({
      query: 'policy test',
      maxTokens: 8000,
    });

    expect(result.expansionPolicy).toBeDefined();
    expect(result.expansionPolicy!.risk).toBe('low');
    expect(result.expansionPolicy!.route).toBe('answer_directly');
  });

  it('warns on high-risk queries', async () => {
    insertTestFact(db, { text: 'Content for high risk test about everything' });

    const result = await service.budgetFit({
      query: 'everything from last month',
      maxTokens: 8000,
    });

    expect(result.expansionPolicy!.risk).toBe('high');
    expect(result.expansionPolicy!.warning).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// structured recall tests
// ---------------------------------------------------------------------------

describe('structured recall', () => {
  let db: Database.Database;
  let service: MemorySearchService;

  beforeEach(() => {
    db = createTestDb();
    service = new MemorySearchService({
      db,
      embeddingClient: createDisabledEmbeddingClient(),
      vecAvailable: false,
    });
  });

  afterEach(() => {
    db.close();
  });

  it('searches fact records and exposes their layer', async () => {
    db.prepare('INSERT OR IGNORE INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('ns-1', 'workspace', 'workspace', 'Workspace workspace', '2026-03-18T10:00:00.000Z', '2026-03-18T10:00:00.000Z');
    db.prepare('INSERT INTO memory_artifacts (id, source_type, classification, scope, workspace_id, project_id, namespace_id, source_run_id, source_ref, source_ref_type, captured_at, occurred_at, content, content_hash, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('artifact-1', 'receipt', 'internal', 'workspace', 'workspace', null, 'ns-1', 'run-1', 'receipt-1', 'receipt', '2026-03-18T10:00:00.000Z', '2026-03-18T10:00:00.000Z', 'The deployment failed because credentials were missing.', 'hash-1', '{}');
    db.prepare('INSERT INTO memory_facts (id, namespace_id, scope, workspace_id, project_id, classification, source_type, memory_type, fact_kind, text, confidence, source_reliability, extraction_confidence, human_confirmed, occurred_at, valid_from, valid_to, source_run_id, source_timestamp, dedup_key, last_reinforced_at, archived_at, created_at, durable, revision_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('fact-1', 'ns-1', 'workspace', 'workspace', null, 'internal', 'receipt', 'episodic', 'state', 'Deployment failed because credentials were missing from the environment.', 0.9, 0.9, 0.9, 0, '2026-03-18T10:00:00.000Z', null, null, 'run-1', '2026-03-18T10:00:00.000Z', 'dedup-1', '2026-03-18T10:00:00.000Z', null, '2026-03-18T10:00:00.000Z', 0, 'active');
    db.prepare('INSERT INTO memory_fact_sources (id, fact_id, artifact_id, excerpt, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('fact-source-1', 'fact-1', 'artifact-1', 'credentials were missing', '2026-03-18T10:00:00.000Z');
    db.prepare('INSERT INTO memory_facts_fts (fact_id, text) VALUES (?, ?)').run('fact-1', 'Deployment failed because credentials were missing from the environment.');

    const response = await service.search({ query: 'missing credentials', includeContent: true });

    expect(response.results[0]?.id).toBe('fact-1');
    expect(response.results[0]?.layer).toBe('fact');
    expect(response.results[0]?.evidenceCount).toBe(1);
  });

  it('explains recall with evidence links for structured facts', async () => {
    db.prepare('INSERT OR IGNORE INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('ns-1', 'workspace', 'workspace', 'Workspace workspace', '2026-03-18T10:00:00.000Z', '2026-03-18T10:00:00.000Z');
    db.prepare('INSERT INTO memory_artifacts (id, source_type, classification, scope, workspace_id, project_id, namespace_id, source_run_id, source_ref, source_ref_type, captured_at, occurred_at, content, content_hash, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('artifact-1', 'receipt', 'internal', 'workspace', 'workspace', null, 'ns-1', 'run-1', 'receipt-1', 'receipt', '2026-03-18T10:00:00.000Z', '2026-03-18T10:00:00.000Z', 'The deployment failed because credentials were missing.', 'hash-1', '{}');
    db.prepare('INSERT INTO memory_facts (id, namespace_id, scope, workspace_id, project_id, classification, source_type, memory_type, fact_kind, text, confidence, source_reliability, extraction_confidence, human_confirmed, occurred_at, valid_from, valid_to, source_run_id, source_timestamp, dedup_key, last_reinforced_at, archived_at, created_at, durable, revision_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('fact-1', 'ns-1', 'workspace', 'workspace', null, 'internal', 'receipt', 'episodic', 'state', 'Deployment failed because credentials were missing from the environment.', 0.9, 0.9, 0.9, 0, '2026-03-18T10:00:00.000Z', null, null, 'run-1', '2026-03-18T10:00:00.000Z', 'dedup-1', '2026-03-18T10:00:00.000Z', null, '2026-03-18T10:00:00.000Z', 0, 'active');
    db.prepare('INSERT INTO memory_fact_sources (id, fact_id, artifact_id, excerpt, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('fact-source-1', 'fact-1', 'artifact-1', 'credentials were missing', '2026-03-18T10:00:00.000Z');
    db.prepare('INSERT INTO memory_facts_fts (fact_id, text) VALUES (?, ?)').run('fact-1', 'Deployment failed because credentials were missing from the environment.');

    const explanation = await service.explainRecall({ query: 'missing credentials', memoryId: 'fact-1' });

    expect(explanation).not.toBeNull();
    expect(explanation?.memoryId).toBe('fact-1');
    expect(explanation?.layer).toBe('fact');
    expect(explanation?.evidence).toHaveLength(1);
    expect(explanation?.evidence[0]?.targetKind).toBe('artifact');
  });

  it('filters syntheses by explicit project/workspace/global location rules', async () => {
    db.prepare('INSERT OR IGNORE INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('ns-workspace', 'workspace', 'default', 'Workspace default', '2026-03-18T10:00:00.000Z', '2026-03-18T10:00:00.000Z');
    db.prepare('INSERT OR IGNORE INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('ns-project', 'project', 'default/proj-1', 'Project default/proj-1', '2026-03-18T10:00:00.000Z', '2026-03-18T10:00:00.000Z');
    db.prepare('INSERT OR IGNORE INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('ns-global', 'global', null, 'Global', '2026-03-18T10:00:00.000Z', '2026-03-18T10:00:00.000Z');

    db.prepare('INSERT INTO memory_syntheses (id, namespace_id, scope, workspace_id, project_id, classification, synthesis_kind, title, text, confidence, refresh_policy, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('syn-project', 'ns-project', 'default/proj-1', 'default', 'proj-1', 'embeddable', 'project_state', 'Project guide', 'Project guide for credentials in proj-1.', 0.9, 'manual', '2026-03-18T10:00:00.000Z', '2026-03-18T10:00:00.000Z', null);
    db.prepare('INSERT INTO memory_syntheses_fts (synthesis_id, title, text) VALUES (?, ?, ?)')
      .run('syn-project', 'Project guide', 'Project guide for credentials in proj-1.');

    db.prepare('INSERT INTO memory_syntheses (id, namespace_id, scope, workspace_id, project_id, classification, synthesis_kind, title, text, confidence, refresh_policy, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('syn-workspace', 'ns-workspace', 'default', 'default', null, 'embeddable', 'workspace_summary', 'Workspace guide', 'Workspace guide for shared credentials.', 0.9, 'manual', '2026-03-18T10:00:00.000Z', '2026-03-18T10:00:00.000Z', null);
    db.prepare('INSERT INTO memory_syntheses_fts (synthesis_id, title, text) VALUES (?, ?, ?)')
      .run('syn-workspace', 'Workspace guide', 'Workspace guide for shared credentials.');

    db.prepare('INSERT INTO memory_syntheses (id, namespace_id, scope, workspace_id, project_id, classification, synthesis_kind, title, text, confidence, refresh_policy, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('syn-global', 'ns-global', 'global', null, null, 'embeddable', 'workspace_summary', 'Global guide', 'Global guide for shared credentials everywhere.', 0.9, 'manual', '2026-03-18T10:00:00.000Z', '2026-03-18T10:00:00.000Z', null);
    db.prepare('INSERT INTO memory_syntheses_fts (synthesis_id, title, text) VALUES (?, ?, ?)')
      .run('syn-global', 'Global guide', 'Global guide for shared credentials everywhere.');

    const projectScoped = await service.search({
      query: 'guide credentials',
      layers: ['synthesis'],
      workspaceId: 'default',
      projectId: 'proj-1',
      includeGlobal: false,
    });
    expect(projectScoped.results.map((result) => result.id)).toEqual(
      expect.arrayContaining(['syn-project', 'syn-workspace']),
    );
    expect(projectScoped.results.map((result) => result.id)).not.toContain('syn-global');

    const withGlobal = await service.search({
      query: 'guide credentials',
      layers: ['synthesis'],
      workspaceId: 'default',
      projectId: 'proj-1',
      includeGlobal: true,
    });
    expect(withGlobal.results.map((result) => result.id)).toEqual(
      expect.arrayContaining(['syn-project', 'syn-workspace', 'syn-global']),
    );
  });
});

// ---------------------------------------------------------------------------
// describeMemory tests
// ---------------------------------------------------------------------------

describe('describeMemory', () => {
  let db: Database.Database;
  let service: MemorySearchService;

  beforeEach(() => {
    db = createTestDb();
    service = new MemorySearchService({
      db,
      embeddingClient: createDisabledEmbeddingClient(),
      vecAvailable: false,
    });
  });

  afterEach(() => {
    db.close();
  });

  it('returns null for non-existent memory', () => {
    expect(service.describeMemory('non-existent')).toBeNull();
  });

  it('returns metadata without content for a fact', () => {
    const factId = insertTestFact(db, {
      text: 'Full content here for describe test with details',
      confidence: 0.9,
      scope: 'workspace',
      memoryType: 'semantic',
    });

    const desc = service.describeMemory(factId);
    expect(desc).not.toBeNull();
    expect(desc!.id).toBe(factId);
    expect(desc!.type).toBe('semantic');
    expect(desc!.confidence).toBe(0.9);
    expect(desc!.contentLength).toBeGreaterThan(0);
    expect(desc!.layer).toBe('fact');
    expect(desc!.sourceCount).toBe(0);
    // No 'content' field in the result
    expect(desc).not.toHaveProperty('content');
  });

  it('describes artifacts by id', () => {
    db.prepare('INSERT OR IGNORE INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('ns-artifact', 'workspace', 'default', 'Workspace default', '2026-03-18T10:00:00.000Z', '2026-03-18T10:00:00.000Z');
    db.prepare('INSERT INTO memory_artifacts (id, source_type, classification, scope, workspace_id, project_id, namespace_id, source_run_id, source_ref, source_ref_type, captured_at, occurred_at, content, content_hash, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('artifact-1', 'workspace_doc', 'embeddable', 'default/proj-1', 'default', 'proj-1', 'ns-artifact', null, '/tmp/doc.md', 'file', '2026-03-18T10:00:00.000Z', null, 'Artifact body', 'hash-artifact', '{}');

    const desc = service.describeMemory('artifact-1');

    expect(desc).toMatchObject({
      id: 'artifact-1',
      layer: 'artifact',
      scope: 'default/proj-1',
      workspaceId: 'default',
      projectId: 'proj-1',
    });
  });

  it('denies artifact descriptions outside the supplied location filter', () => {
    db.prepare('INSERT OR IGNORE INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('ns-artifact', 'project', 'default/proj-2', 'Project default/proj-2', '2026-03-18T10:00:00.000Z', '2026-03-18T10:00:00.000Z');
    db.prepare('INSERT INTO memory_artifacts (id, source_type, classification, scope, workspace_id, project_id, namespace_id, source_run_id, source_ref, source_ref_type, captured_at, occurred_at, content, content_hash, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('artifact-2', 'workspace_doc', 'embeddable', 'default/proj-2', 'default', 'proj-2', 'ns-artifact', null, '/tmp/doc.md', 'file', '2026-03-18T10:00:00.000Z', null, 'Artifact body', 'hash-artifact', '{}');

    const desc = service.describeMemory('artifact-2', {
      workspaceId: 'default',
      projectId: 'proj-1',
    });

    expect(desc).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// expandMemory tests
// ---------------------------------------------------------------------------

describe('expandMemory', () => {
  let db: Database.Database;
  let service: MemorySearchService;

  beforeEach(() => {
    db = createTestDb();
    service = new MemorySearchService({
      db,
      embeddingClient: createDisabledEmbeddingClient(),
      vecAvailable: false,
    });
  });

  afterEach(() => {
    db.close();
  });

  it('returns null for non-existent memory', () => {
    expect(service.expandMemory('non-existent')).toBeNull();
  });

  it('returns full content when under token cap', () => {
    const factId = insertTestFact(db, { text: 'Short content for expand test' });

    const expanded = service.expandMemory(factId, 8000);
    expect(expanded).not.toBeNull();
    expect(expanded!.truncated).toBe(false);
    expect(expanded!.content).toBe('Short content for expand test');
    expect(expanded!.tokenEstimate).toBeGreaterThan(0);
  });

  it('truncates content when over token cap', () => {
    const longContent = Array.from({ length: 200 }, (_, i) =>
      `Decision ${i}: We decided to use approach ${i} for the deployment pipeline migration task.`,
    ).join('\n');
    const factId = insertTestFact(db, { text: longContent });

    const expanded = service.expandMemory(factId, 100); // 100 tokens = 400 chars
    expect(expanded).not.toBeNull();
    expect(expanded!.truncated).toBe(true);
    expect(expanded!.content.length).toBeLessThan(longContent.length);
    expect(expanded!.content).toContain('...');
  });

  it('denies artifact expansion outside the supplied location filter', () => {
    db.prepare('INSERT OR IGNORE INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('ns-artifact', 'project', 'default/proj-2', 'Project default/proj-2', '2026-03-18T10:00:00.000Z', '2026-03-18T10:00:00.000Z');
    db.prepare('INSERT INTO memory_artifacts (id, source_type, classification, scope, workspace_id, project_id, namespace_id, source_run_id, source_ref, source_ref_type, captured_at, occurred_at, content, content_hash, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('artifact-2', 'workspace_doc', 'embeddable', 'default/proj-2', 'default', 'proj-2', 'ns-artifact', null, '/tmp/doc.md', 'file', '2026-03-18T10:00:00.000Z', null, 'Artifact body that should stay hidden.', 'hash-artifact', '{}');

    const expanded = service.expandMemory('artifact-2', 8000, {
      workspaceId: 'default',
      projectId: 'proj-1',
    });

    expect(expanded).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// C3: FTS5-only search path tests
// ---------------------------------------------------------------------------

describe('FTS5-only search path', () => {
  let db: Database.Database;
  let service: MemorySearchService;

  beforeEach(() => {
    db = createTestDb();
    service = new MemorySearchService({
      db,
      embeddingClient: createDisabledEmbeddingClient(),
      vecAvailable: false,
    });
  });

  afterEach(() => {
    db.close();
  });

  it('FTS5 search returns ranked results by relevance', async () => {
    insertTestFact(db, { text: 'Complete database migration from MySQL to PostgreSQL with zero downtime' });
    insertTestFact(db, { text: 'RESTful API versioning strategy with endpoint documentation' });
    insertTestFact(db, { text: 'Regular database backups and migration testing for data safety' });

    const response = await service.search({
      query: 'database migration',
      includeContent: true,
    });

    expect(response.searchMode).toBe('fts_only');
    expect(response.results.length).toBeGreaterThanOrEqual(2);
    // All returned results should have positive scores
    for (const result of response.results) {
      expect(result.score).toBeGreaterThan(0);
    }
    // Results should be sorted by score descending
    for (let i = 1; i < response.results.length; i++) {
      expect(response.results[i - 1]!.score).toBeGreaterThanOrEqual(response.results[i]!.score);
    }
  });

  it('scope filtering: workspace-scoped fact returned, global included when requested', async () => {
    insertTestFact(db, { text: 'Deployment configuration for the alpha workspace environment', workspaceId: 'alpha', scope: 'workspace' });
    insertTestFact(db, { text: 'Deployment configuration for the beta workspace environment', workspaceId: 'beta', scope: 'workspace' });
    insertTestFact(db, { text: 'Deployment standards that apply globally to all environments', scope: 'global', workspaceId: null });

    // With explicit workspaceId: only alpha results
    const alphaOnly = await service.search({
      query: 'deployment',
      workspaceId: 'alpha',
    });
    expect(alphaOnly.results.length).toBeGreaterThanOrEqual(1);
    expect(alphaOnly.results.every(r => r.workspaceId === 'alpha')).toBe(true);

    // With explicit workspaceId + includeGlobal: workspace + global
    const withGlobal = await service.search({
      query: 'deployment',
      workspaceId: 'alpha',
      includeGlobal: true,
    });
    const workspaceIds = withGlobal.results.map(r => r.workspaceId);
    expect(workspaceIds).toContain('alpha');
    expect(withGlobal.results.some(r => r.scope === 'global')).toBe(true);
    expect(workspaceIds).not.toContain('beta');
  });

  it('LIKE fallback activates when FTS5 match expression has special chars', async () => {
    insertTestFact(db, { text: 'Configuration settings for the production server environment setup' });

    // Queries with special FTS5 chars (e.g., brackets, quotes) that would
    // cause FTS5 MATCH to fail should fall back to LIKE and still return results
    const response = await service.search({
      query: 'config [production]',
      includeContent: true,
    });

    // The LIKE fallback should still find results matching the tokens
    expect(response.results.length).toBeGreaterThanOrEqual(1);
    expect(response.searchMode).toBe('fts_only');
  });

  it('searchFactsFts5 returns results from structured facts table', async () => {
    // Set up namespace and fact
    db.prepare('INSERT OR IGNORE INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('ns-fact-test', 'workspace', 'workspace', 'Workspace workspace', '2026-03-18T10:00:00.000Z', '2026-03-18T10:00:00.000Z');

    db.prepare('INSERT INTO memory_artifacts (id, source_type, classification, scope, workspace_id, project_id, namespace_id, source_run_id, source_ref, source_ref_type, captured_at, occurred_at, content, content_hash, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('artifact-fact-test', 'receipt', 'internal', 'workspace', 'workspace', null, 'ns-fact-test', 'run-1', 'receipt-fact', 'receipt', '2026-03-18T10:00:00.000Z', '2026-03-18T10:00:00.000Z', 'Terraform apply succeeded.', 'hash-fact', '{}');

    db.prepare('INSERT INTO memory_facts (id, namespace_id, scope, workspace_id, project_id, classification, source_type, memory_type, fact_kind, text, confidence, source_reliability, extraction_confidence, human_confirmed, occurred_at, valid_from, valid_to, source_run_id, source_timestamp, dedup_key, last_reinforced_at, archived_at, created_at, durable, revision_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('fact-search-test', 'ns-fact-test', 'workspace', 'workspace', null, 'internal', 'receipt', 'episodic', 'state', 'Terraform apply succeeded and infrastructure was provisioned correctly.', 0.9, 0.9, 0.9, 0, '2026-03-18T10:00:00.000Z', null, null, 'run-1', '2026-03-18T10:00:00.000Z', 'dedup-fact-test', '2026-03-18T10:00:00.000Z', null, '2026-03-18T10:00:00.000Z', 0, 'active');
    db.prepare('INSERT INTO memory_fact_sources (id, fact_id, artifact_id, excerpt, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('fs-fact-test', 'fact-search-test', 'artifact-fact-test', 'Terraform apply succeeded', '2026-03-18T10:00:00.000Z');
    db.prepare('INSERT INTO memory_facts_fts (fact_id, text) VALUES (?, ?)').run('fact-search-test', 'Terraform apply succeeded and infrastructure was provisioned correctly.');

    const response = await service.search({
      query: 'Terraform infrastructure',
      layers: ['fact'],
      includeContent: true,
    });

    expect(response.results.length).toBeGreaterThanOrEqual(1);
    expect(response.results[0]?.layer).toBe('fact');
    expect(response.results[0]?.id).toBe('fact-search-test');
    expect(response.results[0]?.evidenceCount).toBe(1);
  });

  it('searchSynthesesFts5 returns results from structured syntheses table', async () => {
    db.prepare('INSERT OR IGNORE INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('ns-synth-test', 'workspace', 'workspace', 'Workspace workspace', '2026-03-18T10:00:00.000Z', '2026-03-18T10:00:00.000Z');

    db.prepare('INSERT INTO memory_syntheses (id, namespace_id, scope, workspace_id, project_id, classification, synthesis_kind, title, text, confidence, refresh_policy, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('synth-search-test', 'ns-synth-test', 'workspace', 'workspace', null, 'embeddable', 'daily', 'Daily summary for infrastructure work', 'Today we completed the Kubernetes cluster migration and updated monitoring dashboards.', 0.85, 'automatic_daily', '2026-03-18T10:00:00.000Z', '2026-03-18T10:00:00.000Z', null);
    db.prepare('INSERT INTO memory_syntheses_fts (synthesis_id, title, text) VALUES (?, ?, ?)')
      .run('synth-search-test', 'Daily summary for infrastructure work', 'Today we completed the Kubernetes cluster migration and updated monitoring dashboards.');

    const response = await service.search({
      query: 'Kubernetes cluster migration',
      layers: ['synthesis'],
      includeContent: true,
    });

    expect(response.results.length).toBeGreaterThanOrEqual(1);
    expect(response.results[0]?.layer).toBe('synthesis');
    expect(response.results[0]?.id).toBe('synth-search-test');
    expect(response.results[0]?.content).toContain('Kubernetes cluster migration');
  });

  it('minConfidence filters out low-confidence results', async () => {
    insertTestFact(db, { text: 'Testing patterns using Vitest with comprehensive coverage reporting', confidence: 0.9 });
    insertTestFact(db, { text: 'Some vague testing patterns with minimal detail about coverage', confidence: 0.2 });

    const response = await service.search({
      query: 'testing patterns',
      minConfidence: 0.5,
    });

    // Only high confidence result should pass the filter
    for (const result of response.results) {
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('memoryTypes filter restricts search to specified types', async () => {
    insertTestFact(db, { text: 'The deployment to staging completed at 14:00 with all checks passing', memoryType: 'episodic', sourceType: 'receipt' });
    insertTestFact(db, { text: 'Our deployment strategy uses blue-green deployments for zero downtime', memoryType: 'semantic' });

    const response = await service.search({
      query: 'deployment',
      memoryTypes: ['episodic'],
    });

    for (const result of response.results) {
      expect(result.type).toBe('episodic');
    }
  });
});


// Legacy hybrid vec search tests removed with legacy code
