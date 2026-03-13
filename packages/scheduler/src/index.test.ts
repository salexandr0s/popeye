import { describe, expect, it } from 'vitest';

import { calculateRetryAvailableAt, calculateRetryDelaySeconds, isDueAt } from './index.js';

describe('scheduler helpers', () => {
  it('caps retry delays', () => {
    expect(calculateRetryDelaySeconds(10, { maxAttempts: 3, baseDelaySeconds: 5, multiplier: 2, maxDelaySeconds: 30 })).toBe(30);
  });

  it('computes the next available timestamp', () => {
    expect(calculateRetryAvailableAt(2, { maxAttempts: 3, baseDelaySeconds: 5, multiplier: 2, maxDelaySeconds: 30 }, new Date('2026-03-13T00:00:00.000Z'))).toBe(
      '2026-03-13T00:00:10.000Z',
    );
  });

  it('detects due timestamps', () => {
    expect(isDueAt('2026-03-13T00:00:00.000Z', new Date('2026-03-13T00:00:01.000Z'))).toBe(true);
    expect(isDueAt('2026-03-13T00:00:02.000Z', new Date('2026-03-13T00:00:01.000Z'))).toBe(false);
  });
});
