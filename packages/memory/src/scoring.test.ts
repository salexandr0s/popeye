import { describe, expect, it } from 'vitest';

import type { FtsCandidate } from './fts5-search.js';
import type { VecCandidate } from './vec-search.js';
import { rerankAndMerge } from './scoring.js';

function makeFtsCandidate(overrides: Partial<FtsCandidate> & { memoryId: string }): FtsCandidate {
  return {
    description: 'test memory',
    content: 'test content',
    memoryType: 'semantic',
    confidence: 0.8,
    scope: 'workspace',
    sourceType: 'curated_memory',
    createdAt: new Date().toISOString(),
    lastReinforcedAt: null,
    durable: false,
    ftsRank: -1,
    ...overrides,
  };
}

describe('rerankAndMerge', () => {
  it('ranks FTS candidates with score breakdown', () => {
    const ftsCandidates: FtsCandidate[] = [
      makeFtsCandidate({ memoryId: 'm1', ftsRank: -0.5 }),
      makeFtsCandidate({ memoryId: 'm2', ftsRank: -2 }),
    ];

    const results = rerankAndMerge(ftsCandidates, [], { halfLifeDays: 30 });

    expect(results).toHaveLength(2);
    // m1 has better rank (-0.5 vs -2), so higher relevance
    expect(results[0]!.memoryId).toBe('m1');
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
    expect(results[0]!.scoreBreakdown.relevance).toBeGreaterThan(results[1]!.scoreBreakdown.relevance);
  });

  it('merges FTS and vec candidates without duplicates', () => {
    const ftsCandidates: FtsCandidate[] = [
      makeFtsCandidate({ memoryId: 'both', ftsRank: -1 }),
      makeFtsCandidate({ memoryId: 'fts-only', ftsRank: -2 }),
    ];
    const vecCandidates: VecCandidate[] = [
      { memoryId: 'both', distance: 0.3 },
      { memoryId: 'vec-only', distance: 0.1 },
    ];

    const results = rerankAndMerge(ftsCandidates, vecCandidates, { halfLifeDays: 30 });

    // 'both' and 'fts-only' should be in results; 'vec-only' skipped (no FTS metadata)
    const ids = results.map((r) => r.memoryId);
    expect(ids).toContain('both');
    expect(ids).toContain('fts-only');
    expect(ids).not.toContain('vec-only');
  });

  it('uses vec distance to boost relevance', () => {
    const ftsCandidates: FtsCandidate[] = [
      makeFtsCandidate({ memoryId: 'boosted', ftsRank: -5 }),
    ];
    const vecCandidates: VecCandidate[] = [
      { memoryId: 'boosted', distance: 0.1 }, // 1-0.1 = 0.9 relevance
    ];

    const results = rerankAndMerge(ftsCandidates, vecCandidates, { halfLifeDays: 30 });
    expect(results[0]!.scoreBreakdown.relevance).toBeCloseTo(0.9, 1); // vec relevance beats FTS
  });

  it('applies scope match scoring', () => {
    const ftsCandidates: FtsCandidate[] = [
      makeFtsCandidate({ memoryId: 'match', scope: 'ws-1', ftsRank: -1 }),
      makeFtsCandidate({ memoryId: 'no-match', scope: 'ws-2', ftsRank: -1 }),
    ];

    const results = rerankAndMerge(ftsCandidates, [], { halfLifeDays: 30, queryScope: 'ws-1' });

    const matchResult = results.find((r) => r.memoryId === 'match')!;
    const noMatchResult = results.find((r) => r.memoryId === 'no-match')!;
    expect(matchResult.scoreBreakdown.scopeMatch).toBe(1.0);
    expect(noMatchResult.scoreBreakdown.scopeMatch).toBe(0.1);
  });

  it('computes effective confidence with decay', () => {
    const old = new Date();
    old.setDate(old.getDate() - 60); // 60 days ago

    const ftsCandidates: FtsCandidate[] = [
      makeFtsCandidate({ memoryId: 'old', confidence: 1.0, createdAt: old.toISOString(), ftsRank: -1 }),
    ];

    const results = rerankAndMerge(ftsCandidates, [], { halfLifeDays: 30 });
    // 60 days with 30-day half-life: 1.0 * 0.5^2 = 0.25
    expect(results[0]!.effectiveConfidence).toBeCloseTo(0.25, 1);
  });

  it('sorts by descending score', () => {
    const ftsCandidates: FtsCandidate[] = [
      makeFtsCandidate({ memoryId: 'low', ftsRank: -10, confidence: 0.1 }),
      makeFtsCandidate({ memoryId: 'high', ftsRank: -0.1, confidence: 0.9 }),
    ];

    const results = rerankAndMerge(ftsCandidates, [], { halfLifeDays: 30 });
    expect(results[0]!.memoryId).toBe('high');
  });

  it('returns empty for empty input', () => {
    const results = rerankAndMerge([], [], { halfLifeDays: 30 });
    expect(results).toHaveLength(0);
  });
});
