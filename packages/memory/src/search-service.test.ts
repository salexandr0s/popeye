import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDisabledEmbeddingClient } from './embedding-client.js';
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
      created_at TEXT NOT NULL
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
        description: 'Repeated memory',
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: 'Same content',
        confidence: 0.5,
        scope: 'workspace',
      });

      const second = service.storeMemory({
        description: 'Repeated memory',
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: 'Same content',
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
        description: 'Sourced memory',
        classification: 'embeddable',
        sourceType: 'receipt',
        content: 'From a run',
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
        description: 'Evented memory',
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: 'Content',
        confidence: 0.8,
        scope: 'workspace',
      });

      const events = db.prepare('SELECT * FROM memory_events WHERE memory_id = ?').all(result.memoryId) as Array<{ type: string }>;
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('created');
    });

    it('records reinforcement event for duplicates', () => {
      const first = service.storeMemory({
        description: 'Dup',
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: 'Same',
        confidence: 0.5,
        scope: 'workspace',
      });

      service.storeMemory({
        description: 'Dup',
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: 'Same',
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
        content: 'API key is sk-1234567890abcdefghij',
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
        description: 'Override test',
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: 'Content',
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
          content: `Testing content number ${i}`,
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
        description: 'Full record',
        classification: 'embeddable',
        sourceType: 'curated_memory',
        content: 'Full content here',
        confidence: 0.8,
        scope: 'workspace',
      });

      const record = service.getMemoryContent(memoryId);
      expect(record).not.toBeNull();
      expect(record!.id).toBe(memoryId);
      expect(record!.description).toBe('Full record');
      expect(record!.classification).toBe('embeddable');
      expect(record!.sourceType).toBe('curated_memory');
      expect(record!.content).toBe('Full content here');
      expect(record!.confidence).toBe(0.8);
      expect(record!.scope).toBe('workspace');
      expect(record!.memoryType).toBe('semantic');
      expect(record!.createdAt).toBeTruthy();
    });
  });
});
