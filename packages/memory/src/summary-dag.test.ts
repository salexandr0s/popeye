import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  deleteSummaryChain,
  estimateTokens,
  getLatestSummary,
  getLeafSummaries,
  getSummariesByDepth,
  getSummaryAncestors,
  getSummaryChildren,
  getSummaryTree,
  insertSummary,
  linkSummarySource,
} from './summary-dag.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE memory_summaries (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      parent_id TEXT REFERENCES memory_summaries(id),
      depth INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL,
      token_estimate INTEGER NOT NULL DEFAULT 0,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_memory_summaries_run ON memory_summaries(run_id);
    CREATE INDEX idx_memory_summaries_parent ON memory_summaries(parent_id);
    CREATE INDEX idx_memory_summaries_depth ON memory_summaries(run_id, depth);

    CREATE TABLE memory_summary_sources (
      id TEXT PRIMARY KEY,
      summary_id TEXT NOT NULL REFERENCES memory_summaries(id),
      memory_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_memory_summary_sources_summary ON memory_summary_sources(summary_id);
  `);
  return db;
}

describe('estimateTokens', () => {
  it('estimates tokens as ceil(chars / 4)', () => {
    expect(estimateTokens('hello')).toBe(2); // 5 / 4 = 1.25 -> 2
    expect(estimateTokens('abcd')).toBe(1); // 4 / 4 = 1
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a')).toBe(1); // 1 / 4 = 0.25 -> 1
  });
});

describe('insertSummary', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('inserts a root summary', () => {
    const id = insertSummary(db, {
      runId: 'run-1',
      workspaceId: 'ws-1',
      depth: 0,
      content: 'Leaf summary of conversation segment',
      startTime: '2025-01-01T00:00:00Z',
      endTime: '2025-01-01T01:00:00Z',
    });

    expect(id).toBeTruthy();
    const row = db.prepare('SELECT * FROM memory_summaries WHERE id = ?').get(id) as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.run_id).toBe('run-1');
    expect(row.workspace_id).toBe('ws-1');
    expect(row.parent_id).toBeNull();
    expect(row.depth).toBe(0);
    expect(row.token_estimate).toBeGreaterThan(0);
  });

  it('inserts a child summary with parent_id', () => {
    const parentId = insertSummary(db, {
      runId: 'run-1',
      workspaceId: 'ws-1',
      depth: 0,
      content: 'Parent summary',
      startTime: '2025-01-01T00:00:00Z',
      endTime: '2025-01-01T01:00:00Z',
    });

    const childId = insertSummary(db, {
      runId: 'run-1',
      workspaceId: 'ws-1',
      parentId,
      depth: 1,
      content: 'Condensed from parent',
      startTime: '2025-01-01T00:00:00Z',
      endTime: '2025-01-01T01:00:00Z',
    });

    const row = db.prepare('SELECT parent_id FROM memory_summaries WHERE id = ?').get(childId) as { parent_id: string };
    expect(row.parent_id).toBe(parentId);
  });

  it('computes token estimate', () => {
    const content = 'A'.repeat(100);
    const id = insertSummary(db, {
      runId: 'run-1',
      workspaceId: 'ws-1',
      depth: 0,
      content,
      startTime: '2025-01-01T00:00:00Z',
      endTime: '2025-01-01T01:00:00Z',
    });

    const row = db.prepare('SELECT token_estimate FROM memory_summaries WHERE id = ?').get(id) as { token_estimate: number };
    expect(row.token_estimate).toBe(25); // 100 / 4
  });
});

describe('linkSummarySource', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('creates a link between summary and memory', () => {
    const summaryId = insertSummary(db, {
      runId: 'run-1',
      workspaceId: 'ws-1',
      depth: 0,
      content: 'Summary',
      startTime: '2025-01-01T00:00:00Z',
      endTime: '2025-01-01T01:00:00Z',
    });

    const linkId = linkSummarySource(db, summaryId, 'memory-abc');
    expect(linkId).toBeTruthy();

    const row = db.prepare('SELECT * FROM memory_summary_sources WHERE id = ?').get(linkId) as Record<string, unknown>;
    expect(row.summary_id).toBe(summaryId);
    expect(row.memory_id).toBe('memory-abc');
  });
});

describe('getSummaryChildren', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('returns direct children ordered by start_time', () => {
    const parentId = insertSummary(db, {
      runId: 'run-1', workspaceId: 'ws-1', depth: 1,
      content: 'Root', startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T03:00:00Z',
    });
    insertSummary(db, {
      runId: 'run-1', workspaceId: 'ws-1', parentId, depth: 0,
      content: 'Child B', startTime: '2025-01-01T02:00:00Z', endTime: '2025-01-01T03:00:00Z',
    });
    insertSummary(db, {
      runId: 'run-1', workspaceId: 'ws-1', parentId, depth: 0,
      content: 'Child A', startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T01:00:00Z',
    });

    const children = getSummaryChildren(db, parentId);
    expect(children).toHaveLength(2);
    expect(children[0]!.content).toBe('Child A');
    expect(children[1]!.content).toBe('Child B');
  });

  it('returns empty array for leaf node', () => {
    const leafId = insertSummary(db, {
      runId: 'run-1', workspaceId: 'ws-1', depth: 0,
      content: 'Leaf', startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T01:00:00Z',
    });
    expect(getSummaryChildren(db, leafId)).toEqual([]);
  });
});

describe('getSummaryAncestors', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('returns ancestors from root to parent (excluding self)', () => {
    const rootId = insertSummary(db, {
      runId: 'run-1', workspaceId: 'ws-1', depth: 2,
      content: 'Root', startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T03:00:00Z',
    });
    const midId = insertSummary(db, {
      runId: 'run-1', workspaceId: 'ws-1', parentId: rootId, depth: 1,
      content: 'Mid', startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T02:00:00Z',
    });
    const leafId = insertSummary(db, {
      runId: 'run-1', workspaceId: 'ws-1', parentId: midId, depth: 0,
      content: 'Leaf', startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T01:00:00Z',
    });

    const ancestors = getSummaryAncestors(db, leafId);
    expect(ancestors).toHaveLength(2);
    expect(ancestors[0]!.content).toBe('Root'); // depth DESC
    expect(ancestors[1]!.content).toBe('Mid');
  });

  it('returns empty for root node', () => {
    const rootId = insertSummary(db, {
      runId: 'run-1', workspaceId: 'ws-1', depth: 0,
      content: 'Root', startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T01:00:00Z',
    });
    expect(getSummaryAncestors(db, rootId)).toEqual([]);
  });
});

describe('getSummaryTree', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('builds full tree from root', () => {
    const rootId = insertSummary(db, {
      runId: 'run-1', workspaceId: 'ws-1', depth: 1,
      content: 'Root summary', startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T03:00:00Z',
    });
    insertSummary(db, {
      runId: 'run-1', workspaceId: 'ws-1', parentId: rootId, depth: 0,
      content: 'Leaf 1', startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T01:00:00Z',
    });
    insertSummary(db, {
      runId: 'run-1', workspaceId: 'ws-1', parentId: rootId, depth: 0,
      content: 'Leaf 2', startTime: '2025-01-01T01:00:00Z', endTime: '2025-01-01T02:00:00Z',
    });

    const tree = getSummaryTree(db, rootId);
    expect(tree).not.toBeNull();
    expect(tree!.summary.content).toBe('Root summary');
    expect(tree!.children).toHaveLength(2);
    expect(tree!.children[0]!.summary.content).toBe('Leaf 1');
    expect(tree!.children[1]!.summary.content).toBe('Leaf 2');
  });

  it('returns null for non-existent root', () => {
    expect(getSummaryTree(db, 'non-existent')).toBeNull();
  });

  it('builds single-node tree for leaf', () => {
    const leafId = insertSummary(db, {
      runId: 'run-1', workspaceId: 'ws-1', depth: 0,
      content: 'Solo leaf', startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T01:00:00Z',
    });

    const tree = getSummaryTree(db, leafId);
    expect(tree).not.toBeNull();
    expect(tree!.children).toEqual([]);
  });
});

describe('getLeafSummaries', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('returns only depth-0 summaries for a run', () => {
    const rootId = insertSummary(db, {
      runId: 'run-1', workspaceId: 'ws-1', depth: 1,
      content: 'Root', startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T02:00:00Z',
    });
    insertSummary(db, {
      runId: 'run-1', workspaceId: 'ws-1', parentId: rootId, depth: 0,
      content: 'Leaf 1', startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T01:00:00Z',
    });
    insertSummary(db, {
      runId: 'run-1', workspaceId: 'ws-1', parentId: rootId, depth: 0,
      content: 'Leaf 2', startTime: '2025-01-01T01:00:00Z', endTime: '2025-01-01T02:00:00Z',
    });

    const leaves = getLeafSummaries(db, 'run-1');
    expect(leaves).toHaveLength(2);
    expect(leaves.every((l) => l.depth === 0)).toBe(true);
  });

  it('does not return summaries from other runs', () => {
    insertSummary(db, {
      runId: 'run-1', workspaceId: 'ws-1', depth: 0,
      content: 'Run 1 leaf', startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T01:00:00Z',
    });
    insertSummary(db, {
      runId: 'run-2', workspaceId: 'ws-1', depth: 0,
      content: 'Run 2 leaf', startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T01:00:00Z',
    });

    const leaves = getLeafSummaries(db, 'run-1');
    expect(leaves).toHaveLength(1);
    expect(leaves[0]!.runId).toBe('run-1');
  });
});

describe('getSummariesByDepth', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('filters by depth', () => {
    const rootId = insertSummary(db, {
      runId: 'run-1', workspaceId: 'ws-1', depth: 2,
      content: 'D2', startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T03:00:00Z',
    });
    const midId = insertSummary(db, {
      runId: 'run-1', workspaceId: 'ws-1', parentId: rootId, depth: 1,
      content: 'D1', startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T02:00:00Z',
    });
    insertSummary(db, {
      runId: 'run-1', workspaceId: 'ws-1', parentId: midId, depth: 0,
      content: 'D0', startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T01:00:00Z',
    });

    expect(getSummariesByDepth(db, 'run-1', 0)).toHaveLength(1);
    expect(getSummariesByDepth(db, 'run-1', 1)).toHaveLength(1);
    expect(getSummariesByDepth(db, 'run-1', 2)).toHaveLength(1);
    expect(getSummariesByDepth(db, 'run-1', 3)).toHaveLength(0);
  });
});

describe('getLatestSummary', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('returns highest-depth summary', () => {
    const rootId = insertSummary(db, {
      runId: 'run-1', workspaceId: 'ws-1', depth: 1,
      content: 'Root', startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T02:00:00Z',
    });
    insertSummary(db, {
      runId: 'run-1', workspaceId: 'ws-1', parentId: rootId, depth: 0,
      content: 'Leaf', startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T01:00:00Z',
    });

    const latest = getLatestSummary(db, 'run-1');
    expect(latest).not.toBeNull();
    expect(latest!.depth).toBe(1);
    expect(latest!.content).toBe('Root');
  });

  it('returns null for non-existent run', () => {
    expect(getLatestSummary(db, 'non-existent')).toBeNull();
  });
});

describe('deleteSummaryChain', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('deletes root and all descendants', () => {
    const rootId = insertSummary(db, {
      runId: 'run-1', workspaceId: 'ws-1', depth: 1,
      content: 'Root', startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T02:00:00Z',
    });
    const leafId = insertSummary(db, {
      runId: 'run-1', workspaceId: 'ws-1', parentId: rootId, depth: 0,
      content: 'Leaf', startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T01:00:00Z',
    });
    linkSummarySource(db, leafId, 'memory-1');

    const deleted = deleteSummaryChain(db, rootId);
    expect(deleted).toBe(2);

    // Verify all gone
    const remaining = db.prepare('SELECT COUNT(*) as c FROM memory_summaries').get() as { c: number };
    expect(remaining.c).toBe(0);

    // Sources also gone
    const sources = db.prepare('SELECT COUNT(*) as c FROM memory_summary_sources').get() as { c: number };
    expect(sources.c).toBe(0);
  });

  it('returns 0 for non-existent root', () => {
    expect(deleteSummaryChain(db, 'non-existent')).toBe(0);
  });

  it('only deletes the targeted chain, not siblings', () => {
    const root1 = insertSummary(db, {
      runId: 'run-1', workspaceId: 'ws-1', depth: 0,
      content: 'Chain 1', startTime: '2025-01-01T00:00:00Z', endTime: '2025-01-01T01:00:00Z',
    });
    insertSummary(db, {
      runId: 'run-1', workspaceId: 'ws-1', depth: 0,
      content: 'Chain 2', startTime: '2025-01-01T01:00:00Z', endTime: '2025-01-01T02:00:00Z',
    });

    deleteSummaryChain(db, root1);

    const remaining = db.prepare('SELECT COUNT(*) as c FROM memory_summaries').get() as { c: number };
    expect(remaining.c).toBe(1);
  });
});
