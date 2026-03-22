import { describe, expect, it } from 'vitest';

import type { FtsCandidate } from './fts5-search.js';
import type { VecCandidate } from './scoring.js';
import { rerankAndMerge } from './scoring.js';

function makeFtsCandidate(overrides: Partial<FtsCandidate> & { memoryId: string }): FtsCandidate {
  return {
    description: 'test memory',
    content: 'test content',
    memoryType: 'semantic',
    confidence: 0.8,
    scope: 'workspace',
    workspaceId: 'workspace',
    projectId: null,
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
      makeFtsCandidate({ memoryId: 'match', scope: 'ws-1', workspaceId: 'ws-1', ftsRank: -1 }),
      makeFtsCandidate({ memoryId: 'no-match', scope: 'ws-2', workspaceId: 'ws-2', ftsRank: -1 }),
    ];

    const results = rerankAndMerge(ftsCandidates, [], {
      halfLifeDays: 30,
      queryLocation: { workspaceId: 'ws-1', projectId: null },
    });

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

  it('applies factMetadata signals when weights are set', () => {
    const ftsCandidates: FtsCandidate[] = [
      makeFtsCandidate({ memoryId: 'f1', ftsRank: -1 }),
    ];

    const results = rerankAndMerge(ftsCandidates, [], {
      halfLifeDays: 30,
      weights: {
        relevance: 0.20, recency: 0.10, confidence: 0.10, scopeMatch: 0.10, entityBoost: 0,
        sourceTrust: 0.15, salience: 0.15, latestness: 0.10, evidenceDensity: 0.10,
      },
      factMetadata: new Map([['f1', {
        isLatest: true,
        salience: 0.9,
        supportCount: 4,
        sourceTrustScore: 0.95,
        operatorStatus: 'normal',
      }]]),
    });

    expect(results).toHaveLength(1);
    const bd = results[0]!.scoreBreakdown;
    expect(bd.sourceTrust).toBe(0.95);
    expect(bd.salience).toBe(0.9);
    expect(bd.latestness).toBe(1.0);
    expect(bd.evidenceDensity).toBeCloseTo(0.8, 5); // min(1, 4/5) = 0.8
  });

  it('latestness is 0 when fact is not latest', () => {
    const ftsCandidates: FtsCandidate[] = [
      makeFtsCandidate({ memoryId: 'old-ver', ftsRank: -1 }),
    ];

    const results = rerankAndMerge(ftsCandidates, [], {
      halfLifeDays: 30,
      weights: {
        relevance: 0.30, recency: 0.20, confidence: 0.20, scopeMatch: 0.10, entityBoost: 0,
        latestness: 0.20,
      },
      factMetadata: new Map([['old-ver', {
        isLatest: false,
        salience: 0.5,
        supportCount: 1,
        sourceTrustScore: 0.7,
        operatorStatus: 'normal',
      }]]),
    });

    expect(results[0]!.scoreBreakdown.latestness).toBe(0.0);
  });

  it('operatorBonus differentiates pinned vs protected vs normal', () => {
    const ftsCandidates: FtsCandidate[] = [
      makeFtsCandidate({ memoryId: 'pinned', ftsRank: -1 }),
      makeFtsCandidate({ memoryId: 'protected', ftsRank: -1 }),
      makeFtsCandidate({ memoryId: 'normal', ftsRank: -1 }),
    ];

    const results = rerankAndMerge(ftsCandidates, [], {
      halfLifeDays: 30,
      weights: {
        relevance: 0.30, recency: 0.10, confidence: 0.10, scopeMatch: 0.10, entityBoost: 0,
        operatorBonus: 0.40,
      },
      factMetadata: new Map([
        ['pinned', { isLatest: true, salience: 0.5, supportCount: 1, sourceTrustScore: 0.7, operatorStatus: 'pinned' }],
        ['protected', { isLatest: true, salience: 0.5, supportCount: 1, sourceTrustScore: 0.7, operatorStatus: 'protected' }],
        ['normal', { isLatest: true, salience: 0.5, supportCount: 1, sourceTrustScore: 0.7, operatorStatus: 'normal' }],
      ]),
    });

    const pinned = results.find((r) => r.memoryId === 'pinned')!;
    const protected_ = results.find((r) => r.memoryId === 'protected')!;
    const normal = results.find((r) => r.memoryId === 'normal')!;

    expect(pinned.scoreBreakdown.operatorBonus).toBe(1.0);
    expect(protected_.scoreBreakdown.operatorBonus).toBe(0.5);
    expect(normal.scoreBreakdown.operatorBonus).toBe(0.0);
    expect(pinned.score).toBeGreaterThan(protected_.score);
    expect(protected_.score).toBeGreaterThan(normal.score);
  });

  it('evidenceDensity saturates at supportCount >= 5', () => {
    const ftsCandidates: FtsCandidate[] = [
      makeFtsCandidate({ memoryId: 'dense', ftsRank: -1 }),
    ];

    const results = rerankAndMerge(ftsCandidates, [], {
      halfLifeDays: 30,
      weights: {
        relevance: 0.50, recency: 0.10, confidence: 0.10, scopeMatch: 0.10, entityBoost: 0,
        evidenceDensity: 0.20,
      },
      factMetadata: new Map([['dense', {
        isLatest: true, salience: 0.5, supportCount: 10, sourceTrustScore: 0.7, operatorStatus: 'normal',
      }]]),
    });

    expect(results[0]!.scoreBreakdown.evidenceDensity).toBe(1.0); // min(1, 10/5) = 1.0
  });

  it('new signals have zero impact when weights are not set', () => {
    const ftsCandidates: FtsCandidate[] = [
      makeFtsCandidate({ memoryId: 'f1', ftsRank: -1 }),
    ];

    // Default weights — no new signal weights set
    const results = rerankAndMerge(ftsCandidates, [], {
      halfLifeDays: 30,
      factMetadata: new Map([['f1', {
        isLatest: true, salience: 0.9, supportCount: 5, sourceTrustScore: 0.99, operatorStatus: 'pinned',
      }]]),
    });

    // Even with extreme factMetadata values, new signals should not appear in breakdown
    const bd = results[0]!.scoreBreakdown;
    expect(bd.sourceTrust).toBeUndefined();
    expect(bd.salience).toBeUndefined();
    expect(bd.latestness).toBeUndefined();
    expect(bd.evidenceDensity).toBeUndefined();
    expect(bd.operatorBonus).toBeUndefined();
  });
});
