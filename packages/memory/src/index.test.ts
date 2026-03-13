import { describe, expect, it } from 'vitest';

import { computeConfidenceDecay, decideEmbeddingEligibility, shouldPersistClassification } from './index.js';

describe('memory policy', () => {
  it('denies embedding for receipt sources', () => {
    expect(decideEmbeddingEligibility({
      id: '1',
      description: 'receipt',
      classification: 'embeddable',
      sourceType: 'receipt',
      content: 'content',
      confidence: 1,
    })).toBe('deny');
  });

  it('decays confidence over time', () => {
    expect(computeConfidenceDecay(1, 30)).toBeCloseTo(0.5, 5);
  });

  it('never persists secrets', () => {
    expect(shouldPersistClassification('secret')).toBe(false);
  });
});
