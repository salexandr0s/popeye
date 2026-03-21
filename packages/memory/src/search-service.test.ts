import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDisabledEmbeddingClient } from './embedding-client.js';
import type { EmbeddingClient } from './embedding-client.js';
import { loadSqliteVec } from './extension-loader.js';
import { MemorySearchService } from './search-service.js';
import { insertVecEmbedding } from './vec-search.js';

// Detect sqlite-vec availability at module level so describe.skipIf can use it synchronously.
let vecAvailable = false;
try {
  const probeDb = new Database(':memory:');
  // loadSqliteVec is async — we await it in a top-level block evaluated before tests run.
  // Vitest supports top-level await in test files.
  vecAvailable = await loadSqliteVec(probeDb, 4);
  probeDb.close();
} catch {
  vecAvailable = false;
}

function createTestDb(): Database.Database {
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
      source_run_id TEXT,
      source_timestamp TEXT,
      created_at TEXT NOT NULL,
      durable INTEGER NOT NULL DEFAULT 0,
      domain TEXT DEFAULT 'general'
    );
    CREATE UNIQUE INDEX idx_memories_dedup_key ON memories(dedup_key) WHERE dedup_key IS NOT NULL;
    CREATE VIRTUAL TABLE memories_fts USING fts5(memory_id UNINDEXED, description, content);
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
      domain TEXT NOT NULL DEFAULT 'general'
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
      domain TEXT DEFAULT 'general'
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

  describe('storeMemory', () => {
    it('stores a new memory', () => {
      const result = service.storeMemory({
        description: 'Test memory',
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: 'This is test content',
        confidence: 0.8,
        scope: 'workspace',
      });

      expect(result.memoryId).toBeTruthy();
      expect(result.embedded).toBe(false);

      const record = service.getMemoryContent(result.memoryId);
      expect(record).not.toBeNull();
      expect(record!.description).toBe('Test memory');
      expect(record!.content).toBe('This is test content');
      expect(record!.memoryType).toBe('semantic'); // curated_memory -> semantic
    });

    it('canonicalizes scope from explicit location fields', () => {
      const result = service.storeMemory({
        description: 'Canonical location',
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: 'Stored using explicit location.',
        confidence: 0.8,
        scope: 'legacy-mismatch',
        workspaceId: 'ws-1',
        projectId: 'proj-1',
      });

      const record = service.getMemoryContent(result.memoryId);
      expect(record?.scope).toBe('ws-1/proj-1');
      expect(record?.workspaceId).toBe('ws-1');
      expect(record?.projectId).toBe('proj-1');
    });

    it('reinforces existing memory with same dedup key', () => {
      const first = service.storeMemory({
        description: 'Repeated memory about preferences',
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: 'Same content that is long enough to pass quality checks',
        confidence: 0.5,
        scope: 'workspace',
      });

      const second = service.storeMemory({
        description: 'Repeated memory about preferences',
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: 'Same content that is long enough to pass quality checks',
        confidence: 0.5,
        scope: 'workspace',
      });

      // Same memory, reinforced
      expect(second.memoryId).toBe(first.memoryId);

      const record = service.getMemoryContent(first.memoryId);
      expect(record!.confidence).toBeCloseTo(0.6, 5); // 0.5 + 0.1 boost
    });

    it('stores memory_sources when sourceRef provided', () => {
      service.storeMemory({
        description: 'Sourced memory from run execution',
        classification: 'embeddable',
        sourceType: 'receipt',
        content: 'From a run that completed the database migration task successfully',
        confidence: 0.7,
        scope: 'workspace',
        sourceRef: 'run-123',
        sourceRefType: 'run',
      });

      const sources = db.prepare('SELECT * FROM memory_sources').all() as Array<{ source_ref: string; source_type: string }>;
      expect(sources).toHaveLength(1);
      expect(sources[0]!.source_ref).toBe('run-123');
      expect(sources[0]!.source_type).toBe('run');
    });

    it('records creation event', () => {
      const result = service.storeMemory({
        description: 'Evented memory for lifecycle tracking',
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: 'Content that records a creation event in the memory system',
        confidence: 0.8,
        scope: 'workspace',
      });

      const events = db.prepare('SELECT * FROM memory_events WHERE memory_id = ?').all(result.memoryId) as Array<{ type: string }>;
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('created');
    });

    it('records reinforcement event for duplicates', () => {
      const first = service.storeMemory({
        description: 'Duplicate memory for reinforcement test',
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: 'Same duplicate content repeated for testing reinforcement tracking',
        confidence: 0.5,
        scope: 'workspace',
      });

      service.storeMemory({
        description: 'Duplicate memory for reinforcement test',
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: 'Same duplicate content repeated for testing reinforcement tracking',
        confidence: 0.5,
        scope: 'workspace',
      });

      const events = db.prepare('SELECT * FROM memory_events WHERE memory_id = ? ORDER BY created_at').all(first.memoryId) as Array<{ type: string }>;
      expect(events).toHaveLength(2);
      expect(events[1]!.type).toBe('reinforced');
    });

    it('redacts sensitive content before storing', () => {
      const result = service.storeMemory({
        description: 'Has secret',
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: 'API key is sk-1234567890abcdefghij', // secret-scan: allow
        confidence: 0.8,
        scope: 'workspace',
      });

      const record = service.getMemoryContent(result.memoryId);
      expect(record!.content).not.toContain('sk-1234567890abcdefghij');
      expect(record!.content).toContain('[REDACTED:');
    });

    it('classifies memory type automatically', () => {
      const result = service.storeMemory({
        description: 'A step by step workflow',
        classification: 'embeddable',
        sourceType: 'compaction_flush',
        content: 'Step 1: do this. Step 2: do that.',
        confidence: 0.7,
        scope: 'workspace',
      });

      const record = service.getMemoryContent(result.memoryId);
      expect(record!.memoryType).toBe('procedural');
    });

    it('respects explicit memoryType override', () => {
      const result = service.storeMemory({
        description: 'Override test for memory type classification',
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: 'Content for testing explicit memory type override behavior',
        confidence: 0.8,
        scope: 'workspace',
        memoryType: 'episodic',
      });

      const record = service.getMemoryContent(result.memoryId);
      expect(record!.memoryType).toBe('episodic');
    });
  });

  describe('search', () => {
    it('finds stored memories', async () => {
      service.storeMemory({
        description: 'TypeScript migration',
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: 'We migrated the entire codebase from JavaScript to TypeScript',
        confidence: 0.8,
        scope: 'workspace',
      });

      const response = await service.search({
        query: 'TypeScript migration',
      });

      expect(response.searchMode).toBe('fts_only');
      expect(response.results).toHaveLength(1);
      expect(response.results[0]!.description).toBe('TypeScript migration');
      expect(response.results[0]!.content).toBeNull(); // includeContent defaults to false
      expect(response.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('includes content when requested', async () => {
      service.storeMemory({
        description: 'Content test',
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: 'The actual content here',
        confidence: 0.8,
        scope: 'workspace',
      });

      const response = await service.search({
        query: 'content test',
        includeContent: true,
      });

      expect(response.results[0]!.content).toBe('The actual content here');
    });

    it('filters by scope', async () => {
      service.storeMemory({
        description: 'Workspace A data',
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: 'Data for workspace A',
        confidence: 0.8,
        scope: 'workspace-a',
      });
      service.storeMemory({
        description: 'Workspace B data',
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: 'Data for workspace B',
        confidence: 0.8,
        scope: 'workspace-b',
      });

      const response = await service.search({
        query: 'data',
        scope: 'workspace-a',
      });

      expect(response.results).toHaveLength(1);
      expect(response.results[0]!.scope).toBe('workspace-a');
    });

    it('uses explicit location filters as the authority when scope disagrees', async () => {
      service.storeMemory({
        description: 'Workspace A explicit',
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: 'alpha result stored for workspace A',
        confidence: 0.8,
        scope: 'workspace-a',
      });
      service.storeMemory({
        description: 'Workspace B scope alias',
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: 'alpha result stored for workspace B',
        confidence: 0.8,
        scope: 'workspace-b',
      });

      const response = await service.search({
        query: 'alpha',
        scope: 'workspace-b',
        workspaceId: 'workspace-a',
      });

      expect(response.results).toHaveLength(1);
      expect(response.results[0]?.scope).toBe('workspace-a');
    });

    it('returns score breakdown', async () => {
      service.storeMemory({
        description: 'Scored memory',
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: 'This is scored content',
        confidence: 0.8,
        scope: 'workspace',
      });

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
        service.storeMemory({
          description: `Memory ${i} about testing`,
          classification: 'embeddable',
          sourceType: 'curated_memory',
          content: `Testing content number ${i} with detailed information about the test scenario`,
          confidence: 0.8,
          scope: 'workspace',
        });
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

    it('returns full record for existing memory', () => {
      const { memoryId } = service.storeMemory({
        description: 'Full record for content retrieval test',
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: 'Full content here with enough detail for quality gate',
        confidence: 0.8,
        scope: 'workspace',
      });

      const record = service.getMemoryContent(memoryId);
      expect(record).not.toBeNull();
      expect(record!.id).toBe(memoryId);
      expect(record!.description).toBe('Full record for content retrieval test');
      expect(record!.classification).toBe('embeddable');
      expect(record!.sourceType).toBe('curated_memory');
      expect(record!.content).toBe('Full content here with enough detail for quality gate');
      expect(record!.confidence).toBe(0.8);
      expect(record!.scope).toBe('workspace');
      expect(record!.memoryType).toBe('semantic');
      expect(record!.createdAt).toBeTruthy();
    });
  });

  describe('entity extraction on store and search', () => {
    it('creates entity records when storing memory with entity mentions', () => {
      service.storeMemory({
        description: 'Person preference for Alex',
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: 'My name is Alex Smith and I prefer TypeScript over JavaScript for all projects',
        confidence: 0.9,
        scope: 'workspace',
      });

      const entities = db.prepare('SELECT name, entity_type, canonical_name FROM memory_entities').all() as Array<{ name: string; entity_type: string; canonical_name: string }>;
      expect(entities.length).toBeGreaterThanOrEqual(1);

      const tools = entities.filter((e) => e.entity_type === 'tool');
      expect(tools.some((t) => t.canonical_name === 'typescript')).toBe(true);

      const mentions = db.prepare('SELECT * FROM memory_entity_mentions').all();
      expect(mentions.length).toBeGreaterThanOrEqual(1);
    });

    it('boosts search results when query matches stored entities', async () => {
      // Store two memories — one mentioning TypeScript, one not
      service.storeMemory({
        description: 'TypeScript migration decision',
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: 'We decided to use TypeScript for the entire codebase migration project',
        confidence: 0.7,
        scope: 'workspace',
      });
      service.storeMemory({
        description: 'Generic coding standards document',
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: 'Our coding standards require strict linting and comprehensive test coverage',
        confidence: 0.7,
        scope: 'workspace',
      });

      // Search with entity that matches first memory
      const response = await service.search({
        query: 'what is the TypeScript migration plan',
        includeContent: true,
      });

      expect(response.results.length).toBeGreaterThanOrEqual(1);
      // The TypeScript-mentioning memory should appear (entity + text relevance)
      expect(response.results.some((r) => r.description === 'TypeScript migration decision')).toBe(true);
    });
  });

  describe('totalCandidates', () => {
    it('reports pre-limit candidate count', async () => {
      for (let i = 0; i < 5; i++) {
        service.storeMemory({
          description: `Memory about deployment number ${i}`,
          classification: 'embeddable',
          sourceType: 'curated_memory',
          content: `Deployment details and configuration for environment number ${i}`,
          confidence: 0.8,
          scope: 'workspace',
        });
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
      service.storeMemory({
        description: 'Birthday fact about the user',
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: 'The user birthday is March 15th according to their profile',
        confidence: 0.9,
        scope: 'workspace',
      });

      const queryWithInjection = '[Memory: some old context] birthday';
      const response = await service.search({ query: queryWithInjection });

      expect(response.query).toBe(queryWithInjection);
    });
  });
});

// ---------------------------------------------------------------------------
// Hybrid search integration tests
// ---------------------------------------------------------------------------

function createFakeEmbeddingClient(dimensions: number): EmbeddingClient {
  // Returns deterministic embeddings: a unit vector based on text length mod dimensions
  return {
    dimensions,
    model: 'fake-test',
    enabled: true,
    async embed(texts: string[]): Promise<Float32Array[]> {
      return texts.map((text) => {
        const vec = new Float32Array(dimensions);
        const idx = text.length % dimensions;
        vec[idx] = 1.0;
        return vec;
      });
    },
  };
}

describe('hybrid search', () => {
  let db: Database.Database;
  let vecLoaded: boolean;

  beforeEach(async () => {
    db = createTestDb();
    vecLoaded = await loadSqliteVec(db, 4);
  });

  afterEach(() => {
    db.close();
  });

  it('returns results with hybrid mode when vec is available', async () => {
    if (!vecLoaded) {
      // Graceful skip — test the FTS-only path instead (covered below)
      return;
    }

    const embeddingClient = createFakeEmbeddingClient(4);
    const service = new MemorySearchService({
      db,
      embeddingClient,
      vecAvailable: true,
    });

    // Store memories with embeddings
    await service.storeMemoryWithEmbedding({
      description: 'Database migration plan',
      classification: 'embeddable',
      sourceType: 'curated_memory',
      content: 'Migrate from MySQL to PostgreSQL with zero downtime strategy',
      confidence: 0.9,
      scope: 'workspace',
    });
    await service.storeMemoryWithEmbedding({
      description: 'API design notes',
      classification: 'embeddable',
      sourceType: 'curated_memory',
      content: 'RESTful API design with versioned endpoints and Zod validation',
      confidence: 0.8,
      scope: 'workspace',
    });
    await service.storeMemoryWithEmbedding({
      description: 'Testing strategy',
      classification: 'embeddable',
      sourceType: 'curated_memory',
      content: 'Unit tests with Vitest and E2E tests with Playwright for coverage',
      confidence: 0.7,
      scope: 'workspace',
    });

    const response = await service.search({
      query: 'database migration',
      includeContent: true,
    });

    expect(response.searchMode).toBe('hybrid');
    expect(response.results.length).toBeGreaterThanOrEqual(1);

    // Score breakdown should have all four components
    const first = response.results[0]!;
    expect(first.scoreBreakdown).toBeDefined();
    expect(typeof first.scoreBreakdown.relevance).toBe('number');
    expect(typeof first.scoreBreakdown.recency).toBe('number');
    expect(typeof first.scoreBreakdown.confidence).toBe('number');
    expect(typeof first.scoreBreakdown.scopeMatch).toBe('number');
    expect(first.score).toBeGreaterThan(0);
  });

  it('falls back to fts_only mode when vec is unavailable', async () => {
    const embeddingClient = createFakeEmbeddingClient(4);
    const service = new MemorySearchService({
      db,
      embeddingClient,
      vecAvailable: false,
    });

    service.storeMemory({
      description: 'Fallback test memory',
      classification: 'embeddable',
      sourceType: 'curated_memory',
      content: 'This memory tests the FTS5 fallback search path',
      confidence: 0.8,
      scope: 'workspace',
    });

    const response = await service.search({
      query: 'fallback search',
      includeContent: true,
    });

    expect(response.searchMode).toBe('fts_only');
    expect(response.results.length).toBeGreaterThanOrEqual(1);
    expect(response.results[0]!.content).toContain('FTS5 fallback');
    expect(response.results[0]!.score).toBeGreaterThan(0);

    // Score breakdown still present in FTS-only mode
    const breakdown = response.results[0]!.scoreBreakdown;
    expect(typeof breakdown.relevance).toBe('number');
    expect(typeof breakdown.recency).toBe('number');
    expect(typeof breakdown.confidence).toBe('number');
    expect(typeof breakdown.scopeMatch).toBe('number');
  });

  it('ranks results by composite score', async () => {
    const service = new MemorySearchService({
      db,
      embeddingClient: createFakeEmbeddingClient(4),
      vecAvailable: vecLoaded,
    });

    // Store with different confidence levels — higher confidence should rank higher
    // for the same text relevance
    const storeOp = vecLoaded
      ? service.storeMemoryWithEmbedding.bind(service)
      : async (input: Parameters<typeof service.storeMemory>[0]) => service.storeMemory(input);

    await storeOp({
      description: 'High confidence deployment guide',
      classification: 'embeddable',
      sourceType: 'curated_memory',
      content: 'Deployment guide for the production environment',
      confidence: 0.95,
      scope: 'workspace',
    });
    await storeOp({
      description: 'Low confidence deployment note',
      classification: 'embeddable',
      sourceType: 'curated_memory',
      content: 'Deployment note about the production setup',
      confidence: 0.3,
      scope: 'workspace',
    });

    const response = await service.search({ query: 'deployment production' });

    expect(response.results.length).toBe(2);
    // Higher-confidence result should score higher (all else being roughly equal)
    expect(response.results[0]!.score).toBeGreaterThanOrEqual(response.results[1]!.score);
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
      service.storeMemory({
        description: `Budget memory ${i} about testing`,
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: `Content for budget test ${i} with some detail about the scenario`,
        confidence: 0.8,
        scope: 'workspace',
      });
    }

    const result = await service.budgetFit({
      query: 'budget testing',
      maxTokens: 50, // Very small budget
    });

    expect(result.totalTokensUsed).toBeLessThanOrEqual(result.totalTokensBudget);
    expect(result.totalTokensBudget).toBe(50);
  });

  it('drops results that exceed budget', async () => {
    for (let i = 0; i < 10; i++) {
      service.storeMemory({
        description: `Overflow memory ${i} about topics`,
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: `Detailed content for overflow test ${i} with enough text to consume tokens`,
        confidence: 0.8,
        scope: 'workspace',
      });
    }

    const result = await service.budgetFit({
      query: 'overflow topics',
      maxTokens: 30, // Tiny budget
    });

    expect(result.droppedCount + result.results.length + result.truncatedCount).toBeGreaterThan(0);
    expect(result.totalTokensUsed).toBeLessThanOrEqual(30);
  });

  it('includes expansion policy metadata', async () => {
    service.storeMemory({
      description: 'Policy test memory',
      classification: 'embeddable',
      sourceType: 'curated_memory',
      content: 'Content for expansion policy test with details',
      confidence: 0.8,
      scope: 'workspace',
    });

    const result = await service.budgetFit({
      query: 'policy test',
      maxTokens: 8000,
    });

    expect(result.expansionPolicy).toBeDefined();
    expect(result.expansionPolicy!.risk).toBe('low');
    expect(result.expansionPolicy!.route).toBe('answer_directly');
  });

  it('warns on high-risk queries', async () => {
    service.storeMemory({
      description: 'Risk test memory',
      classification: 'embeddable',
      sourceType: 'curated_memory',
      content: 'Content for high risk test about everything',
      confidence: 0.8,
      scope: 'workspace',
    });

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
    db.prepare('INSERT INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
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
    db.prepare('INSERT INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
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
    db.prepare('INSERT INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('ns-workspace', 'workspace', 'default', 'Workspace default', '2026-03-18T10:00:00.000Z', '2026-03-18T10:00:00.000Z');
    db.prepare('INSERT INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('ns-project', 'project', 'default/proj-1', 'Project default/proj-1', '2026-03-18T10:00:00.000Z', '2026-03-18T10:00:00.000Z');
    db.prepare('INSERT INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
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

  it('returns metadata without content', () => {
    const { memoryId } = service.storeMemory({
      description: 'Describe test memory for metadata',
      classification: 'embeddable',
      sourceType: 'curated_memory',
      content: 'Full content here for describe test with details',
      confidence: 0.9,
      scope: 'workspace',
    });

    const desc = service.describeMemory(memoryId);
    expect(desc).not.toBeNull();
    expect(desc!.id).toBe(memoryId);
    expect(desc!.description).toBe('Describe test memory for metadata');
    expect(desc!.type).toBe('semantic');
    expect(desc!.confidence).toBe(0.9);
    expect(desc!.contentLength).toBeGreaterThan(0);
    expect(desc!.eventCount).toBeGreaterThanOrEqual(1); // 'created' event
    expect(desc!.sourceCount).toBe(0);
    // No 'content' field in the result
    expect(desc).not.toHaveProperty('content');
  });

  it('describes artifacts by id', () => {
    db.prepare('INSERT INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
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
    db.prepare('INSERT INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
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
    const { memoryId } = service.storeMemory({
      description: 'Expand test with short content',
      classification: 'embeddable',
      sourceType: 'curated_memory',
      content: 'Short content for expand test',
      confidence: 0.8,
      scope: 'workspace',
    });

    const expanded = service.expandMemory(memoryId, 8000);
    expect(expanded).not.toBeNull();
    expect(expanded!.truncated).toBe(false);
    expect(expanded!.content).toBe('Short content for expand test');
    expect(expanded!.tokenEstimate).toBeGreaterThan(0);
  });

  it('truncates content when over token cap', () => {
    // Insert long content directly to bypass quality gate
    const longContent = Array.from({ length: 200 }, (_, i) =>
      `Decision ${i}: We decided to use approach ${i} for the deployment pipeline migration task.`,
    ).join('\n');
    const memoryId = 'expand-long-test';
    db.prepare(
      'INSERT INTO memories (id, description, classification, source_type, content, confidence, scope, memory_type, created_at, durable) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'), 0)',
    ).run(memoryId, 'Long content test', 'embeddable', 'curated_memory', longContent, 0.8, 'workspace', 'semantic');

    const expanded = service.expandMemory(memoryId, 100); // 100 tokens = 400 chars
    expect(expanded).not.toBeNull();
    expect(expanded!.truncated).toBe(true);
    expect(expanded!.content.length).toBeLessThan(longContent.length);
    expect(expanded!.content).toContain('...');
  });

  it('denies artifact expansion outside the supplied location filter', () => {
    db.prepare('INSERT INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
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
    // Store memories with different levels of relevance to "database migration"
    service.storeMemory({
      description: 'Database migration plan for production',
      classification: 'embeddable',
      sourceType: 'curated_memory',
      content: 'Complete database migration from MySQL to PostgreSQL with zero downtime',
      confidence: 0.8,
      scope: 'workspace',
    });
    service.storeMemory({
      description: 'API design patterns and best practices',
      classification: 'embeddable',
      sourceType: 'curated_memory',
      content: 'RESTful API versioning strategy with endpoint documentation',
      confidence: 0.8,
      scope: 'workspace',
    });
    service.storeMemory({
      description: 'Database backup procedures for disaster recovery',
      classification: 'embeddable',
      sourceType: 'curated_memory',
      content: 'Regular database backups and migration testing for data safety',
      confidence: 0.8,
      scope: 'workspace',
    });

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

  it('scope filtering: workspace-scoped memory returned, global included when requested', async () => {
    service.storeMemory({
      description: 'Workspace alpha deployment config',
      classification: 'embeddable',
      sourceType: 'curated_memory',
      content: 'Deployment configuration for the alpha workspace environment',
      confidence: 0.8,
      scope: 'alpha',
    });
    service.storeMemory({
      description: 'Workspace beta deployment config',
      classification: 'embeddable',
      sourceType: 'curated_memory',
      content: 'Deployment configuration for the beta workspace environment',
      confidence: 0.8,
      scope: 'beta',
    });
    service.storeMemory({
      description: 'Global deployment standards',
      classification: 'embeddable',
      sourceType: 'curated_memory',
      content: 'Deployment standards that apply globally to all environments',
      confidence: 0.8,
      scope: 'global',
    });

    // Scope-only search: only alpha results
    const alphaOnly = await service.search({
      query: 'deployment',
      scope: 'alpha',
    });
    expect(alphaOnly.results.length).toBeGreaterThanOrEqual(1);
    expect(alphaOnly.results.every(r => r.scope === 'alpha')).toBe(true);

    // With explicit workspaceId + includeGlobal: workspace + global
    const withGlobal = await service.search({
      query: 'deployment',
      workspaceId: 'alpha',
      includeGlobal: true,
    });
    const scopes = withGlobal.results.map(r => r.scope);
    expect(scopes).toContain('alpha');
    expect(scopes).toContain('global');
    expect(scopes).not.toContain('beta');
  });

  it('LIKE fallback activates when FTS5 match expression has special chars', async () => {
    service.storeMemory({
      description: 'Config with special characters test',
      classification: 'embeddable',
      sourceType: 'curated_memory',
      content: 'Configuration settings for the production server environment setup',
      confidence: 0.8,
      scope: 'workspace',
    });

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
    db.prepare('INSERT INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
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
    db.prepare('INSERT INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
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
    service.storeMemory({
      description: 'High confidence memory about testing patterns',
      classification: 'embeddable',
      sourceType: 'curated_memory',
      content: 'Testing patterns using Vitest with comprehensive coverage reporting',
      confidence: 0.9,
      scope: 'workspace',
    });
    service.storeMemory({
      description: 'Low confidence memory about testing patterns',
      classification: 'embeddable',
      sourceType: 'curated_memory',
      content: 'Some vague testing patterns with minimal detail about coverage',
      confidence: 0.2,
      scope: 'workspace',
    });

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
    service.storeMemory({
      description: 'Episodic memory about a deployment event',
      classification: 'embeddable',
      sourceType: 'receipt',
      content: 'The deployment to staging completed at 14:00 with all checks passing',
      confidence: 0.8,
      scope: 'workspace',
      memoryType: 'episodic',
    });
    service.storeMemory({
      description: 'Semantic memory about deployment strategy',
      classification: 'embeddable',
      sourceType: 'curated_memory',
      content: 'Our deployment strategy uses blue-green deployments for zero downtime',
      confidence: 0.8,
      scope: 'workspace',
    });

    const response = await service.search({
      query: 'deployment',
      memoryTypes: ['episodic'],
    });

    for (const result of response.results) {
      expect(result.type).toBe('episodic');
    }
  });
});

// ---------------------------------------------------------------------------
// C4: Provenance preservation tests (search-service level)
// ---------------------------------------------------------------------------

describe('provenance preservation', () => {
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

  it('stored memories retain source_run_id and source_timestamp via direct insert', () => {
    const { memoryId } = service.storeMemory({
      description: 'Provenance tracking test memory',
      classification: 'embeddable',
      sourceType: 'curated_memory',
      content: 'Content for provenance test that verifies source tracking fields',
      confidence: 0.7,
      scope: 'workspace',
      sourceRef: 'run-provenance-test',
      sourceRefType: 'run',
    });

    // Source reference persisted in memory_sources
    const sources = db.prepare('SELECT source_type, source_ref FROM memory_sources WHERE memory_id = ?').all(memoryId) as Array<{
      source_type: string;
      source_ref: string;
    }>;
    expect(sources).toHaveLength(1);
    expect(sources[0]!.source_type).toBe('run');
    expect(sources[0]!.source_ref).toBe('run-provenance-test');
  });

  it('creation event records provenance timestamp', () => {
    const before = new Date();
    const { memoryId } = service.storeMemory({
      description: 'Event provenance timestamp test memory',
      classification: 'embeddable',
      sourceType: 'curated_memory',
      content: 'Content for verifying creation event provenance timestamp tracking',
      confidence: 0.8,
      scope: 'workspace',
    });

    const events = db.prepare('SELECT type, created_at FROM memory_events WHERE memory_id = ?').all(memoryId) as Array<{
      type: string;
      created_at: string;
    }>;
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('created');
    const eventTime = new Date(events[0]!.created_at);
    expect(eventTime.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });

  it('dedup key prevents duplicate insertion and reinforces existing memory', () => {
    const first = service.storeMemory({
      description: 'Dedup provenance test for duplicate prevention',
      classification: 'embeddable',
      sourceType: 'curated_memory',
      content: 'Unique content for dedup provenance verification test in search service',
      confidence: 0.5,
      scope: 'workspace',
    });

    const second = service.storeMemory({
      description: 'Dedup provenance test for duplicate prevention',
      classification: 'embeddable',
      sourceType: 'curated_memory',
      content: 'Unique content for dedup provenance verification test in search service',
      confidence: 0.5,
      scope: 'workspace',
    });

    // Same memory was reinforced, not duplicated
    expect(second.memoryId).toBe(first.memoryId);

    // Confidence boosted
    const row = db.prepare('SELECT confidence, last_reinforced_at FROM memories WHERE id = ?').get(first.memoryId) as {
      confidence: number;
      last_reinforced_at: string | null;
    };
    expect(row.confidence).toBeCloseTo(0.6, 5);
    expect(row.last_reinforced_at).toBeTruthy();

    // Reinforcement event recorded
    const events = db.prepare("SELECT type FROM memory_events WHERE memory_id = ? AND type = 'reinforced'").all(first.memoryId) as Array<{ type: string }>;
    expect(events).toHaveLength(1);
  });

  it('getMemoryContent returns all provenance fields', () => {
    const { memoryId } = service.storeMemory({
      description: 'Full provenance record test memory',
      classification: 'embeddable',
      sourceType: 'curated_memory',
      content: 'Full record content with provenance fields for getMemoryContent test',
      confidence: 0.75,
      scope: 'workspace',
    });

    const record = service.getMemoryContent(memoryId);
    expect(record).not.toBeNull();
    expect(record!.id).toBe(memoryId);
    expect(record!.confidence).toBe(0.75);
    expect(record!.scope).toBe('workspace');
    expect(record!.createdAt).toBeTruthy();
    expect(record!.memoryType).toBe('semantic');
    expect(record!.sourceType).toBe('curated_memory');
    expect(record!.classification).toBe('embeddable');
  });
});

// ---------------------------------------------------------------------------
// Hybrid search integration tests (FTS5 + sqlite-vec combined)
// ---------------------------------------------------------------------------

const HYBRID_DIM = 4;

/**
 * Create an embedding client that returns a predetermined vector for any query.
 * The vector is configured at construction so the test controls exactly which
 * stored embeddings will be "close" to the query.
 */
function createPredeterminedEmbeddingClient(queryVector: Float32Array): EmbeddingClient {
  return {
    dimensions: queryVector.length,
    model: 'predetermined-test',
    enabled: true,
    async embed(_texts: string[]): Promise<Float32Array[]> {
      return _texts.map(() => queryVector);
    },
  };
}

describe.skipIf(!vecAvailable)('hybrid search (FTS5 + sqlite-vec combined)', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = createTestDb();
    await loadSqliteVec(db, HYBRID_DIM);
  });

  afterEach(() => {
    db.close();
  });

  it('merged output contains results surfaced by both FTS5 and vec paths', async () => {
    const now = new Date().toISOString();

    // -- Memory A: matches FTS5 ("database migration") but has a distant embedding.
    const idFtsOnly = 'mem-fts-only';
    db.prepare(
      `INSERT INTO memories (id, description, classification, source_type, content, confidence, scope, memory_type, created_at, durable)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(idFtsOnly, 'Database migration plan', 'embeddable', 'curated_memory',
      'Migrate the production database from MySQL to PostgreSQL with zero downtime',
      0.9, 'workspace', 'semantic', now, 0);
    db.prepare('INSERT INTO memories_fts (memory_id, description, content) VALUES (?, ?, ?)')
      .run(idFtsOnly, 'Database migration plan',
        'Migrate the production database from MySQL to PostgreSQL with zero downtime');
    // Distant embedding — orthogonal to the query vector we will use.
    insertVecEmbedding(db, idFtsOnly, new Float32Array([0, 0, 0, 1]));

    // -- Memory B: does NOT match FTS5 text ("database migration") but has a very close embedding.
    const idVecOnly = 'mem-vec-only';
    db.prepare(
      `INSERT INTO memories (id, description, classification, source_type, content, confidence, scope, memory_type, created_at, durable)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(idVecOnly, 'Infrastructure scaling notes', 'embeddable', 'curated_memory',
      'Horizontal pod autoscaler tuning and replica count thresholds for peak traffic',
      0.85, 'workspace', 'semantic', now, 0);
    db.prepare('INSERT INTO memories_fts (memory_id, description, content) VALUES (?, ?, ?)')
      .run(idVecOnly, 'Infrastructure scaling notes',
        'Horizontal pod autoscaler tuning and replica count thresholds for peak traffic');
    // Close embedding — nearly identical to the query vector.
    insertVecEmbedding(db, idVecOnly, new Float32Array([1, 0, 0, 0]));

    // -- Memory C: matches BOTH FTS5 and vec.
    const idBoth = 'mem-both';
    db.prepare(
      `INSERT INTO memories (id, description, classification, source_type, content, confidence, scope, memory_type, created_at, durable)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(idBoth, 'Database migration execution log', 'embeddable', 'curated_memory',
      'Executed the database migration script and verified data integrity across all tables',
      0.95, 'workspace', 'semantic', now, 0);
    db.prepare('INSERT INTO memories_fts (memory_id, description, content) VALUES (?, ?, ?)')
      .run(idBoth, 'Database migration execution log',
        'Executed the database migration script and verified data integrity across all tables');
    insertVecEmbedding(db, idBoth, new Float32Array([0.9, 0.1, 0, 0]));

    // Query vector points towards [1,0,0,0] — close to idVecOnly and idBoth, far from idFtsOnly.
    const queryVec = new Float32Array([1, 0, 0, 0]);
    const embeddingClient = createPredeterminedEmbeddingClient(queryVec);

    const service = new MemorySearchService({
      db,
      embeddingClient,
      vecAvailable: true,
    });

    const response = await service.search({
      query: 'database migration',
      includeContent: true,
    });

    // --- Assertion (a): results from both FTS5 AND vec paths appear
    expect(response.searchMode).toBe('hybrid');
    const resultIds = response.results.map((r) => r.id);

    // FTS-matched memory should be present (matched text "database migration").
    expect(resultIds).toContain(idFtsOnly);
    // Vec-only memory should be present (close embedding, no text overlap with query).
    expect(resultIds).toContain(idVecOnly);
    // Memory matching both paths should also be present.
    expect(resultIds).toContain(idBoth);
    expect(response.results.length).toBe(3);
  });

  it('latencyMs is tracked and greater than zero', async () => {
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO memories (id, description, classification, source_type, content, confidence, scope, memory_type, created_at, durable)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('mem-latency', 'Latency probe memory', 'embeddable', 'curated_memory',
      'Content for latency measurement in hybrid search integration test',
      0.8, 'workspace', 'semantic', now, 0);
    db.prepare('INSERT INTO memories_fts (memory_id, description, content) VALUES (?, ?, ?)')
      .run('mem-latency', 'Latency probe memory',
        'Content for latency measurement in hybrid search integration test');
    insertVecEmbedding(db, 'mem-latency', new Float32Array([0.5, 0.5, 0.5, 0.5]));

    const embeddingClient = createPredeterminedEmbeddingClient(new Float32Array([0.5, 0.5, 0.5, 0.5]));
    const service = new MemorySearchService({
      db,
      embeddingClient,
      vecAvailable: true,
    });

    const response = await service.search({ query: 'latency measurement' });

    // --- Assertion (b): latencyMs is tracked and positive
    expect(typeof response.latencyMs).toBe('number');
    expect(response.latencyMs).toBeGreaterThan(0);
  });

  it('results are properly reranked by composite score', async () => {
    const now = new Date().toISOString();

    // Memory with high confidence + strong FTS match + close vec match → should rank first.
    db.prepare(
      `INSERT INTO memories (id, description, classification, source_type, content, confidence, scope, memory_type, created_at, durable)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('mem-high', 'Server deployment pipeline', 'embeddable', 'curated_memory',
      'Complete server deployment pipeline with CI/CD automation and rollback procedures',
      0.95, 'workspace', 'semantic', now, 0);
    db.prepare('INSERT INTO memories_fts (memory_id, description, content) VALUES (?, ?, ?)')
      .run('mem-high', 'Server deployment pipeline',
        'Complete server deployment pipeline with CI/CD automation and rollback procedures');
    insertVecEmbedding(db, 'mem-high', new Float32Array([1, 0, 0, 0]));

    // Memory with low confidence + weak FTS match + distant vec match → should rank lower.
    db.prepare(
      `INSERT INTO memories (id, description, classification, source_type, content, confidence, scope, memory_type, created_at, durable)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('mem-low', 'Server configuration notes', 'embeddable', 'curated_memory',
      'Miscellaneous server notes about the old deployment environment and legacy setup',
      0.3, 'workspace', 'semantic', now, 0);
    db.prepare('INSERT INTO memories_fts (memory_id, description, content) VALUES (?, ?, ?)')
      .run('mem-low', 'Server configuration notes',
        'Miscellaneous server notes about the old deployment environment and legacy setup');
    insertVecEmbedding(db, 'mem-low', new Float32Array([0, 0, 0, 1]));

    // Query: text matches both ("server" + "deployment"), vec close to mem-high.
    const embeddingClient = createPredeterminedEmbeddingClient(new Float32Array([1, 0, 0, 0]));
    const service = new MemorySearchService({
      db,
      embeddingClient,
      vecAvailable: true,
    });

    const response = await service.search({
      query: 'server deployment',
      includeContent: true,
    });

    // --- Assertion (c): reranking produces descending composite scores
    expect(response.searchMode).toBe('hybrid');
    expect(response.results.length).toBe(2);

    const [first, second] = response.results;
    expect(first!.score).toBeGreaterThan(second!.score);
    expect(first!.id).toBe('mem-high');
    expect(second!.id).toBe('mem-low');

    // Both results must have score breakdown components
    for (const result of response.results) {
      expect(result.scoreBreakdown).toBeDefined();
      expect(typeof result.scoreBreakdown.relevance).toBe('number');
      expect(typeof result.scoreBreakdown.recency).toBe('number');
      expect(typeof result.scoreBreakdown.confidence).toBe('number');
      expect(typeof result.scoreBreakdown.scopeMatch).toBe('number');
      expect(result.score).toBeGreaterThan(0);
    }
  });
});
