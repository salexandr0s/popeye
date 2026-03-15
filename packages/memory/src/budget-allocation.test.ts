import { describe, expect, it } from 'vitest';

import type { ScoredCandidate } from './scoring.js';
import { applyBudgetAllocation } from './budget-allocation.js';

function makeCandidate(id: string, memoryType: string, score: number): ScoredCandidate {
  return {
    memoryId: id,
    description: `Memory ${id}`,
    content: `Content for ${id}`,
    memoryType: memoryType as ScoredCandidate['memoryType'],
    confidence: 0.8,
    effectiveConfidence: 0.8,
    scope: 'workspace',
    sourceType: 'curated_memory',
    createdAt: new Date().toISOString(),
    lastReinforcedAt: null,
    durable: false,
    score,
    scoreBreakdown: { relevance: score, recency: 0.5, confidence: 0.8, scopeMatch: 0.5 },
  };
}

describe('applyBudgetAllocation', () => {
  const enabledConfig = { enabled: true, minPerType: 1, maxPerType: 5 };
  const disabledConfig = { enabled: false, minPerType: 1, maxPerType: 5 };

  it('passes through when disabled', () => {
    const results = [
      makeCandidate('m1', 'episodic', 0.9),
      makeCandidate('m2', 'episodic', 0.8),
    ];
    const allocated = applyBudgetAllocation(results, 5, disabledConfig);
    expect(allocated).toHaveLength(2);
  });

  it('passes through when under limit', () => {
    const results = [
      makeCandidate('m1', 'episodic', 0.9),
      makeCandidate('m2', 'semantic', 0.8),
    ];
    const allocated = applyBudgetAllocation(results, 5, enabledConfig);
    expect(allocated).toHaveLength(2);
  });

  it('ensures minPerType from each type', () => {
    const results = [
      makeCandidate('e1', 'episodic', 0.9),
      makeCandidate('e2', 'episodic', 0.88),
      makeCandidate('e3', 'episodic', 0.87),
      makeCandidate('e4', 'episodic', 0.86),
      makeCandidate('s1', 'semantic', 0.5),
      makeCandidate('p1', 'procedural', 0.4),
    ];
    const allocated = applyBudgetAllocation(results, 3, enabledConfig);
    expect(allocated).toHaveLength(3);
    const types = new Set(allocated.map((a) => a.memoryType));
    // With minPerType=1, all 3 types should be represented
    expect(types.size).toBe(3);
  });

  it('respects maxPerType', () => {
    const config = { enabled: true, minPerType: 0, maxPerType: 2 };
    const results = [
      makeCandidate('e1', 'episodic', 0.9),
      makeCandidate('e2', 'episodic', 0.8),
      makeCandidate('e3', 'episodic', 0.7),
      makeCandidate('e4', 'episodic', 0.6),
      makeCandidate('e5', 'episodic', 0.55),
      makeCandidate('s1', 'semantic', 0.5),
      makeCandidate('s2', 'semantic', 0.45),
    ];
    // 7 results, limit 4: should cap episodic at 2
    const allocated = applyBudgetAllocation(results, 4, config);
    const episodicCount = allocated.filter((a) => a.memoryType === 'episodic').length;
    expect(episodicCount).toBeLessThanOrEqual(2);
  });

  it('returns results sorted by score', () => {
    const results = [
      makeCandidate('e1', 'episodic', 0.9),
      makeCandidate('s1', 'semantic', 0.8),
      makeCandidate('p1', 'procedural', 0.7),
      makeCandidate('e2', 'episodic', 0.6),
    ];
    const allocated = applyBudgetAllocation(results, 4, enabledConfig);
    for (let i = 0; i < allocated.length - 1; i++) {
      expect(allocated[i]!.score).toBeGreaterThanOrEqual(allocated[i + 1]!.score);
    }
  });
});
