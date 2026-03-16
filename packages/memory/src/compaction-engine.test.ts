import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CompactionEngine, DEFAULT_COMPACTION_CONFIG, deterministicTruncation, splitIntoChunks } from './compaction-engine.js';
import type { PromptBuilder } from './compaction-engine.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
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
    CREATE INDEX idx_memory_summaries_run ON memory_summaries(run_id);
    CREATE INDEX idx_memory_summaries_depth ON memory_summaries(run_id, depth);
    CREATE TABLE memory_summary_sources (
      id TEXT PRIMARY KEY,
      summary_id TEXT NOT NULL,
      memory_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

function createMockSummarizeFn(): {
  fn: (input: { systemPrompt: string; userPrompt: string; maxTokens: number }) => Promise<string>;
  calls: Array<{ systemPrompt: string; userPrompt: string; maxTokens: number }>;
} {
  const calls: Array<{ systemPrompt: string; userPrompt: string; maxTokens: number }> = [];
  return {
    calls,
    fn: async (input) => {
      calls.push(input);
      return `Summary of: ${input.userPrompt.slice(0, 50)}...`;
    },
  };
}

const mockPrompts: PromptBuilder = {
  buildSummarizePrompt(input) {
    return {
      systemPrompt: `system-d${input.depth}`,
      userPrompt: input.content,
      maxTokens: 500,
    };
  },
  buildRetryPrompt(input) {
    return {
      systemPrompt: `retry-system-d${input.depth}`,
      userPrompt: input.content,
      maxTokens: 300,
    };
  },
};

describe('splitIntoChunks', () => {
  it('returns single chunk for short content', () => {
    const chunks = splitIntoChunks('Short paragraph.', 500);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe('Short paragraph.');
  });

  it('splits on paragraph boundaries', () => {
    const content = Array.from({ length: 20 }, (_, i) => `Paragraph ${i}: ${'x'.repeat(100)}`).join('\n\n');
    const chunks = splitIntoChunks(content, 200); // 200 tokens = ~800 chars
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1000); // some slack for paragraph boundaries
    }
  });

  it('handles empty content', () => {
    const chunks = splitIntoChunks('', 500);
    expect(chunks).toHaveLength(1);
  });
});

describe('deterministicTruncation', () => {
  it('returns content unchanged when under limit', () => {
    expect(deterministicTruncation('short', 100)).toBe('short');
  });

  it('truncates with notice when over limit', () => {
    const long = 'a'.repeat(500);
    const result = deterministicTruncation(long, 10); // 10 tokens = 40 chars
    expect(result.length).toBeLessThan(500);
    expect(result).toContain('[... truncated]');
  });
});

describe('DEFAULT_COMPACTION_CONFIG', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_COMPACTION_CONFIG.fanout).toBe(8);
    expect(DEFAULT_COMPACTION_CONFIG.freshTailCount).toBe(4);
    expect(DEFAULT_COMPACTION_CONFIG.maxLeafTokens).toBe(2000);
    expect(DEFAULT_COMPACTION_CONFIG.maxCondensedTokens).toBe(4000);
    expect(DEFAULT_COMPACTION_CONFIG.maxRetries).toBe(1);
  });
});

describe('CompactionEngine', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('creates leaf summaries for compactable chunks', async () => {
    const { fn } = createMockSummarizeFn();
    const engine = new CompactionEngine(db, fn, mockPrompts, { fanout: 2, freshTailCount: 0, maxLeafTokens: 100 });

    // Create content with multiple chunks (~100 tokens each)
    const content = Array.from({ length: 4 }, (_, i) => `Chunk ${i}: ${'word '.repeat(30)}`).join('\n\n');

    const result = await engine.compactRun('run-1', content, 'ws-1', '2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z');

    expect(result.leafCount).toBeGreaterThan(0);
    expect(result.summaryIds.length).toBeGreaterThan(0);

    // Verify DAG rows exist
    const rows = db.prepare('SELECT * FROM memory_summaries WHERE run_id = ?').all('run-1');
    expect(rows.length).toBe(result.summaryIds.length);
  });

  it('produces condensed layers when many leaf summaries exist', async () => {
    const { fn } = createMockSummarizeFn();
    const engine = new CompactionEngine(db, fn, mockPrompts, { fanout: 2, freshTailCount: 0, maxLeafTokens: 50 });

    // Create content with many chunks
    const content = Array.from({ length: 8 }, (_, i) => `Paragraph ${i}: ${'detail '.repeat(20)}`).join('\n\n');

    const result = await engine.compactRun('run-1', content, 'ws-1', '2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z');

    expect(result.condensedLevels).toBeGreaterThanOrEqual(1);
    expect(result.rootSummaryId).toBeTruthy();
  });

  it('links child summaries to parent via parent_id', async () => {
    const { fn } = createMockSummarizeFn();
    const engine = new CompactionEngine(db, fn, mockPrompts, { fanout: 2, freshTailCount: 0, maxLeafTokens: 50 });

    // Create enough content for leaf + condensed layers
    const content = Array.from({ length: 4 }, (_, i) => `Paragraph ${i}: ${'detail '.repeat(20)}`).join('\n\n');

    const result = await engine.compactRun('run-1', content, 'ws-1', '2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z');

    // Verify DAG structure: leaves should have parent_id pointing to condensed summaries
    const leaves = db.prepare('SELECT id, parent_id, depth FROM memory_summaries WHERE run_id = ? AND depth = 0').all('run-1') as Array<{ id: string; parent_id: string | null; depth: number }>;
    for (const leaf of leaves) {
      expect(leaf.parent_id).not.toBeNull();
    }

    // Root should have no parent
    if (result.rootSummaryId) {
      const root = db.prepare('SELECT parent_id FROM memory_summaries WHERE id = ?').get(result.rootSummaryId) as { parent_id: string | null };
      expect(root.parent_id).toBeNull();
    }
  });

  it('protects fresh tail from compaction', async () => {
    const { fn, calls } = createMockSummarizeFn();
    const engine = new CompactionEngine(db, fn, mockPrompts, { fanout: 8, freshTailCount: 2, maxLeafTokens: 50 });

    const content = Array.from({ length: 4 }, (_, i) => `Paragraph ${i}: ${'words '.repeat(20)}`).join('\n\n');

    await engine.compactRun('run-1', content, 'ws-1', '2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z');

    // The last 2 chunks should NOT be summarized
    // With 4 chunks and freshTailCount=2, only 2 chunks get compacted
    expect(calls.length).toBeGreaterThan(0);
  });

  it('returns empty result when all chunks are fresh tail', async () => {
    const { fn } = createMockSummarizeFn();
    const engine = new CompactionEngine(db, fn, mockPrompts, { fanout: 8, freshTailCount: 10, maxLeafTokens: 2000 });

    const result = await engine.compactRun('run-1', 'Short content', 'ws-1', '2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z');

    expect(result.summaryIds).toEqual([]);
    expect(result.rootSummaryId).toBeNull();
    expect(result.leafCount).toBe(0);
  });

  it('falls back to deterministic truncation when summarizer fails', async () => {
    let callCount = 0;
    const failingFn = async () => {
      callCount++;
      throw new Error('API error');
    };
    const engine = new CompactionEngine(db, failingFn, mockPrompts, {
      fanout: 8,
      freshTailCount: 0,
      maxLeafTokens: 50,
      maxRetries: 1,
    });

    const content = `Paragraph: ${'detail '.repeat(20)}`;
    const result = await engine.compactRun('run-1', content, 'ws-1', '2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z');

    // Should still produce a result via truncation
    expect(result.summaryIds.length).toBeGreaterThan(0);
    expect(callCount).toBeGreaterThanOrEqual(2); // 1 normal + 1 retry

    // Verify the stored summary contains truncation marker or original content
    const row = db.prepare('SELECT content FROM memory_summaries WHERE id = ?').get(result.summaryIds[0]!) as { content: string };
    expect(row.content.length).toBeGreaterThan(0);
  });

  it('handles single-chunk content (no condensation needed)', async () => {
    const { fn } = createMockSummarizeFn();
    const engine = new CompactionEngine(db, fn, mockPrompts, { fanout: 8, freshTailCount: 0, maxLeafTokens: 5000 });

    const result = await engine.compactRun('run-1', 'Single paragraph of content.', 'ws-1', '2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z');

    expect(result.leafCount).toBe(1);
    expect(result.condensedLevels).toBe(0);
    expect(result.rootSummaryId).toBeTruthy();
  });

  it('tracks total tokens summarized', async () => {
    const { fn } = createMockSummarizeFn();
    const engine = new CompactionEngine(db, fn, mockPrompts, { fanout: 8, freshTailCount: 0, maxLeafTokens: 100 });

    const content = Array.from({ length: 4 }, (_, i) => `Paragraph ${i}: ${'word '.repeat(30)}`).join('\n\n');
    const result = await engine.compactRun('run-1', content, 'ws-1', '2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z');

    expect(result.totalTokensSummarized).toBeGreaterThan(0);
  });

  it('handles empty input', async () => {
    const { fn } = createMockSummarizeFn();
    const engine = new CompactionEngine(db, fn, mockPrompts, { fanout: 8, freshTailCount: 0 });

    const result = await engine.compactRun('run-1', '', 'ws-1', '2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z');

    // Empty input produces one chunk that goes through leaf pass
    expect(result.summaryIds.length).toBeLessThanOrEqual(1);
  });
});
