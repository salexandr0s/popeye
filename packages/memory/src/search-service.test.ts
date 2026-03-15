import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDisabledEmbeddingClient } from './embedding-client.js';
import type { EmbeddingClient } from './embedding-client.js';
import { loadSqliteVec } from './extension-loader.js';
import { MemorySearchService } from './search-service.js';

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
      memory_type TEXT NOT NULL DEFAULT 'episodic',
      dedup_key TEXT,
      last_reinforced_at TEXT,
      archived_at TEXT,
      source_run_id TEXT,
      source_timestamp TEXT,
      created_at TEXT NOT NULL,
      durable INTEGER NOT NULL DEFAULT 0
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
