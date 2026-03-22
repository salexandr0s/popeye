import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildRetrievalTrace,
  hashQueryText,
  logRetrievalTrace,
  pruneRetrievalLogs,
  queryRetrievalLogs,
} from './retrieval-logging.js';
import { GOLDEN_QUERY_FIXTURES, GOLDEN_SEED_MEMORIES } from './__fixtures__/golden-queries.js';
import { classifyQueryStrategy } from './strategy.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE memory_retrieval_logs (
      id TEXT PRIMARY KEY,
      query_hash TEXT NOT NULL,
      query_text_redacted TEXT,
      strategy TEXT NOT NULL,
      filters_json TEXT NOT NULL DEFAULT '{}',
      candidate_counts_json TEXT NOT NULL DEFAULT '{}',
      selected_json TEXT NOT NULL DEFAULT '[]',
      feature_traces_json TEXT NOT NULL DEFAULT '{}',
      latency_ms REAL NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_retrieval_logs_created ON memory_retrieval_logs(created_at);
    CREATE INDEX idx_retrieval_logs_strategy ON memory_retrieval_logs(strategy);
  `);
  return db;
}

describe('hashQueryText', () => {
  it('returns a deterministic 16-char hex string', () => {
    const hash = hashQueryText('test query');
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]+$/);
    expect(hashQueryText('test query')).toBe(hash);
  });

  it('produces different hashes for different inputs', () => {
    expect(hashQueryText('query A')).not.toBe(hashQueryText('query B'));
  });
});

describe('buildRetrievalTrace', () => {
  it('builds a complete trace with traceId and queryHash', () => {
    const trace = buildRetrievalTrace({
      queryText: 'test query',
      strategy: 'factual',
      filters: { scope: 'global' },
      candidateCounts: { total: 10, fact: 5, synthesis: 3 },
      selected: [
        { id: 'r1', layer: 'fact', score: 0.9, scoreBreakdown: { relevance: 0.8, recency: 0.1 } },
        { id: 'r2', layer: 'synthesis', score: 0.7, scoreBreakdown: { relevance: 0.5, recency: 0.2 } },
      ],
      latencyMs: 42.5,
    });

    expect(trace.traceId).toBeTruthy();
    expect(trace.queryHash).toBe(hashQueryText('test query'));
    expect(trace.strategy).toBe('factual');
    expect(trace.candidateCounts).toEqual({ total: 10, fact: 5, synthesis: 3 });
    expect(trace.selected).toHaveLength(2);
    expect(trace.selected[0]).toEqual({ id: 'r1', layer: 'fact', score: 0.9 });
    expect(trace.featureTraces['r1']).toEqual({ relevance: 0.8, recency: 0.1 });
    expect(trace.latencyMs).toBe(42.5);
    expect(trace.createdAt).toBeTruthy();
  });

  it('does not include scoreBreakdown in selected entries', () => {
    const trace = buildRetrievalTrace({
      queryText: 'x',
      strategy: 'exploratory',
      filters: {},
      candidateCounts: { total: 1 },
      selected: [{ id: 'a', score: 0.5, scoreBreakdown: { relevance: 0.5 } }],
      latencyMs: 1,
    });
    // selected entries should not have scoreBreakdown — that goes in featureTraces
    expect(trace.selected[0]).not.toHaveProperty('scoreBreakdown');
  });
});

describe('logRetrievalTrace', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('persists a trace and retrieves it', () => {
    const trace = buildRetrievalTrace({
      queryText: 'sqlite indexing',
      strategy: 'factual',
      filters: { scope: 'workspace/test' },
      candidateCounts: { total: 5, fact: 3 },
      selected: [{ id: 'f1', layer: 'fact', score: 0.85, scoreBreakdown: { relevance: 0.7, confidence: 0.15 } }],
      latencyMs: 33,
    });

    logRetrievalTrace(db, trace);

    const logs = queryRetrievalLogs(db);
    expect(logs).toHaveLength(1);
    expect(logs[0].id).toBe(trace.traceId);
    expect(logs[0].queryHash).toBe(trace.queryHash);
    expect(logs[0].strategy).toBe('factual');
    expect(logs[0].candidateCountsJson).toEqual({ total: 5, fact: 3 });
    expect(logs[0].selectedJson).toHaveLength(1);
    expect(logs[0].selectedJson[0].id).toBe('f1');
    expect(logs[0].featureTracesJson['f1']).toEqual({ relevance: 0.7, confidence: 0.15 });
    expect(logs[0].latencyMs).toBe(33);
  });

  it('stores null for queryTextRedacted by default', () => {
    const trace = buildRetrievalTrace({
      queryText: 'sensitive query',
      strategy: 'factual',
      filters: {},
      candidateCounts: { total: 0 },
      selected: [],
      latencyMs: 1,
    });
    logRetrievalTrace(db, trace);

    const logs = queryRetrievalLogs(db);
    expect(logs[0].queryTextRedacted).toBeNull();
  });

  it('stores redacted text when provided', () => {
    const trace = buildRetrievalTrace({
      queryText: 'sensitive query',
      queryTextRedacted: '[REDACTED] query',
      strategy: 'factual',
      filters: {},
      candidateCounts: { total: 0 },
      selected: [],
      latencyMs: 1,
    });
    logRetrievalTrace(db, trace);

    const logs = queryRetrievalLogs(db);
    expect(logs[0].queryTextRedacted).toBe('[REDACTED] query');
  });
});

describe('queryRetrievalLogs', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  function insertTrace(strategy: string, createdAt: string): void {
    const trace = buildRetrievalTrace({
      queryText: `q-${strategy}`,
      strategy,
      filters: {},
      candidateCounts: { total: 1 },
      selected: [],
      latencyMs: 1,
    });
    trace.createdAt = createdAt;
    logRetrievalTrace(db, trace);
  }

  it('filters by strategy', () => {
    insertTrace('factual', '2026-03-20T10:00:00Z');
    insertTrace('temporal', '2026-03-20T11:00:00Z');
    insertTrace('factual', '2026-03-20T12:00:00Z');

    const factual = queryRetrievalLogs(db, { strategy: 'factual' });
    expect(factual).toHaveLength(2);
    factual.forEach((log) => expect(log.strategy).toBe('factual'));
  });

  it('filters by time range', () => {
    insertTrace('factual', '2026-03-19T10:00:00Z');
    insertTrace('factual', '2026-03-20T10:00:00Z');
    insertTrace('factual', '2026-03-21T10:00:00Z');

    const logs = queryRetrievalLogs(db, {
      after: '2026-03-19T12:00:00Z',
      before: '2026-03-21T00:00:00Z',
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].createdAt).toBe('2026-03-20T10:00:00Z');
  });

  it('respects limit', () => {
    for (let i = 0; i < 10; i++) {
      insertTrace('exploratory', `2026-03-20T${String(i).padStart(2, '0')}:00:00Z`);
    }
    const logs = queryRetrievalLogs(db, { limit: 3 });
    expect(logs).toHaveLength(3);
  });

  it('returns results in descending created_at order', () => {
    insertTrace('factual', '2026-03-20T08:00:00Z');
    insertTrace('factual', '2026-03-20T12:00:00Z');
    insertTrace('factual', '2026-03-20T10:00:00Z');

    const logs = queryRetrievalLogs(db);
    expect(logs[0].createdAt).toBe('2026-03-20T12:00:00Z');
    expect(logs[1].createdAt).toBe('2026-03-20T10:00:00Z');
    expect(logs[2].createdAt).toBe('2026-03-20T08:00:00Z');
  });
});

describe('pruneRetrievalLogs', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('deletes logs older than the cutoff', () => {
    const old = buildRetrievalTrace({
      queryText: 'old',
      strategy: 'factual',
      filters: {},
      candidateCounts: { total: 0 },
      selected: [],
      latencyMs: 1,
    });
    old.createdAt = '2026-01-01T00:00:00Z';
    logRetrievalTrace(db, old);

    const recent = buildRetrievalTrace({
      queryText: 'recent',
      strategy: 'factual',
      filters: {},
      candidateCounts: { total: 0 },
      selected: [],
      latencyMs: 1,
    });
    recent.createdAt = '2026-03-20T00:00:00Z';
    logRetrievalTrace(db, recent);

    const deleted = pruneRetrievalLogs(db, '2026-02-01T00:00:00Z');
    expect(deleted).toBe(1);

    const remaining = queryRetrievalLogs(db);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].createdAt).toBe('2026-03-20T00:00:00Z');
  });
});

describe('golden query fixtures — strategy classification', () => {
  for (const fixture of GOLDEN_QUERY_FIXTURES) {
    it(`${fixture.name}: classifies as "${fixture.expectedStrategy}"`, () => {
      const strategy = classifyQueryStrategy(fixture.query);
      expect(strategy).toBe(fixture.expectedStrategy);
    });
  }
});

describe('golden seed memories — structural integrity', () => {
  it('all seed memories have required fields', () => {
    for (const seed of GOLDEN_SEED_MEMORIES) {
      expect(seed.id).toBeTruthy();
      expect(seed.description).toBeTruthy();
      expect(seed.content).toBeTruthy();
      expect(seed.sourceType).toBeTruthy();
      expect(seed.memoryType).toBeTruthy();
      expect(seed.scope).toBeTruthy();
      expect(seed.confidence).toBeGreaterThan(0);
      expect(seed.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('has at least one seed per expected golden layer', () => {
    const layers = new Set(GOLDEN_SEED_MEMORIES.map((s) => s.layer).filter(Boolean));
    expect(layers.has('fact')).toBe(true);
    expect(layers.has('synthesis')).toBe(true);
  });

  it('has unique IDs', () => {
    const ids = GOLDEN_SEED_MEMORIES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
