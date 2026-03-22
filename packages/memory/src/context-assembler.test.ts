import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { MemorySearchResponse } from '@popeye/contracts';

import { recallContext } from './context-assembler.js';

/** estimateTokens = Math.ceil(text.length / 4) */
function tokensFor(text: string): number {
  return Math.ceil(text.length / 4);
}

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE memory_syntheses (
      id TEXT PRIMARY KEY, namespace_id TEXT NOT NULL, scope TEXT NOT NULL,
      workspace_id TEXT, project_id TEXT, classification TEXT NOT NULL,
      synthesis_kind TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL,
      confidence REAL NOT NULL, refresh_policy TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT,
      domain TEXT NOT NULL DEFAULT 'general', subject_kind TEXT, subject_id TEXT,
      refresh_due_at TEXT, salience REAL NOT NULL DEFAULT 0.5,
      quality_score REAL NOT NULL DEFAULT 0.7,
      context_release_policy TEXT NOT NULL DEFAULT 'full',
      invalidated_at TEXT, operator_status TEXT NOT NULL DEFAULT 'normal'
    );
  `);
  return db;
}

function insertSynthesis(db: Database.Database, kind: string, text: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO memory_syntheses (id, namespace_id, scope, classification, synthesis_kind, title, text, confidence, created_at, updated_at, domain)
     VALUES (?, 'ns-1', 'workspace', 'internal', ?, ?, ?, 0.8, ?, ?, 'general')`,
  ).run(`s-${Math.random().toString(36).slice(2, 8)}`, kind, `${kind} title`, text, now, now);
}

/** Creates a mock search service that returns canned results. */
function mockSearchService(results: MemorySearchResponse['results'], traceId?: string) {
  return {
    search: async () => ({
      results,
      query: 'test',
      totalCandidates: results.length,
      latencyMs: 1,
      searchMode: 'fts_only' as const,
      traceId,
    }),
  };
}

/** Build a minimal search result. */
function makeResult(id: string, opts: {
  layer?: 'fact' | 'synthesis' | 'artifact' | 'curated';
  content?: string;
  score?: number;
  type?: string;
}) {
  const content = opts.content ?? `Content for ${id}`;
  return {
    id,
    description: `desc-${id}`,
    content,
    type: opts.type ?? 'semantic',
    confidence: 0.8,
    effectiveConfidence: 0.8,
    scope: 'workspace',
    workspaceId: null,
    projectId: null,
    sourceType: 'run',
    createdAt: new Date().toISOString(),
    lastReinforcedAt: null,
    score: opts.score ?? 0.9,
    layer: opts.layer ?? 'fact',
    scoreBreakdown: {
      relevance: 0.5, recency: 0.3, confidence: 0.2,
      scopeMatch: 0.0,
    },
  };
}

describe('recallContext', () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('returns empty result when no search results and no profiles', async () => {
    const result = await recallContext({
      db,
      searchService: mockSearchService([]) as never,
      query: 'what is the architecture?',
    });

    expect(result.profileStatic).toBeNull();
    expect(result.profileDynamic).toBeNull();
    expect(result.layers).toHaveLength(0);
    expect(result.totalTokens).toBe(0);
    expect(result.budgetMax).toBe(4000);
    expect(result.query).toBe('what is the architecture?');
    expect(result.strategy).toBeDefined();
  });

  it('includes profile tokens in total and deducts from content budget', async () => {
    const profileText = 'A'.repeat(200); // 50 tokens
    insertSynthesis(db, 'profile_static', profileText);

    // One fact that would fill a lot of budget
    const factContent = 'B'.repeat(800); // 200 tokens
    const results = [makeResult('f1', { layer: 'fact', content: factContent })];

    const result = await recallContext({
      db,
      searchService: mockSearchService(results) as never,
      query: 'what are the facts?',
      maxTokens: 300,
    });

    // Profile budget = floor(300 * 0.2) = 60, profile uses 50
    // Remaining = 300 - 50 = 250, fact needs 200 → fits
    expect(result.profileStatic).toContain('A');
    expect(result.layers).toHaveLength(1);
    expect(result.totalTokens).toBe(tokensFor(profileText) + tokensFor(factContent));
  });

  it('enforces budget — stops adding when maxTokens reached', async () => {
    const contentA = 'A'.repeat(400); // 100 tokens
    const contentB = 'B'.repeat(400); // 100 tokens
    const contentC = 'C'.repeat(400); // 100 tokens
    const results = [
      makeResult('f1', { layer: 'fact', content: contentA }),
      makeResult('f2', { layer: 'fact', content: contentB }),
      makeResult('f3', { layer: 'fact', content: contentC }),
    ];

    const result = await recallContext({
      db,
      searchService: mockSearchService(results) as never,
      query: 'what are the facts?',
      maxTokens: 200, // budget after profile: 200 - 0 = 200, enough for 2 facts
    });

    // Should fit exactly 2 of 3 facts (100 + 100 = 200)
    expect(result.totalTokens).toBeLessThanOrEqual(200);
    const factLayer = result.layers.find(l => l.layer === 'fact');
    expect(factLayer).toBeDefined();
    expect(factLayer!.items.length).toBe(2);
  });

  it('fills layers in strategy-dependent order — factual prioritizes facts', async () => {
    const results = [
      makeResult('s1', { layer: 'synthesis', content: 'Synthesis text here' }),
      makeResult('f1', { layer: 'fact', content: 'Fact text here' }),
    ];

    const result = await recallContext({
      db,
      searchService: mockSearchService(results) as never,
      // "what is X" → factual strategy → facts first
      query: 'what is the database schema?',
      maxTokens: 2000,
    });

    expect(result.layers.length).toBeGreaterThanOrEqual(1);
    // Factual strategy: fact layer comes before synthesis
    const layerOrder = result.layers.map(l => l.layer);
    const factIdx = layerOrder.indexOf('fact');
    const synthIdx = layerOrder.indexOf('synthesis');
    if (factIdx !== -1 && synthIdx !== -1) {
      expect(factIdx).toBeLessThan(synthIdx);
    }
  });

  it('fills layers in strategy-dependent order — procedural prioritizes synthesis', async () => {
    const results = [
      makeResult('f1', { layer: 'fact', content: 'Fact text here' }),
      makeResult('s1', { layer: 'synthesis', content: 'Synthesis text here' }),
    ];

    const result = await recallContext({
      db,
      searchService: mockSearchService(results) as never,
      // "how do I" → procedural strategy → synthesis first
      query: 'how do I deploy the application?',
      maxTokens: 2000,
    });

    const layerOrder = result.layers.map(l => l.layer);
    const synthIdx = layerOrder.indexOf('synthesis');
    const factIdx = layerOrder.indexOf('fact');
    if (synthIdx !== -1 && factIdx !== -1) {
      expect(synthIdx).toBeLessThan(factIdx);
    }
  });

  it('truncates oversized items when budget allows >50 tokens', async () => {
    const bigContent = 'X'.repeat(2000); // 500 tokens
    const results = [makeResult('f1', { layer: 'fact', content: bigContent })];

    const result = await recallContext({
      db,
      searchService: mockSearchService(results) as never,
      query: 'what happened?',
      maxTokens: 200, // profile=0, remaining=200, item=500 > 200 but > 50 → truncate
    });

    expect(result.layers).toHaveLength(1);
    const item = result.layers[0]!.items[0]!;
    expect(item.text.length).toBeLessThan(bigContent.length);
    expect(result.totalTokens).toBeLessThanOrEqual(200);
  });

  it('returns traceId from search response', async () => {
    const result = await recallContext({
      db,
      searchService: mockSearchService([], 'trace-abc-123') as never,
      query: 'test query',
    });

    expect(result.traceId).toBe('trace-abc-123');
  });

  it('computes accurate per-layer token counts', async () => {
    const textA = 'A'.repeat(120); // 30 tokens
    const textB = 'B'.repeat(80);  // 20 tokens
    const results = [
      makeResult('f1', { layer: 'fact', content: textA }),
      makeResult('f2', { layer: 'fact', content: textB }),
      makeResult('s1', { layer: 'synthesis', content: 'C'.repeat(60) }), // 15 tokens
    ];

    const result = await recallContext({
      db,
      searchService: mockSearchService(results) as never,
      query: 'what are the facts?',
      maxTokens: 2000,
    });

    const factLayer = result.layers.find(l => l.layer === 'fact');
    expect(factLayer).toBeDefined();
    expect(factLayer!.totalTokens).toBe(tokensFor(textA) + tokensFor(textB));

    const synthLayer = result.layers.find(l => l.layer === 'synthesis');
    expect(synthLayer).toBeDefined();
    expect(synthLayer!.totalTokens).toBe(tokensFor('C'.repeat(60)));
  });
});
