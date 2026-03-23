import { describe, it, expect } from 'vitest';

import { mapRunEventDetail, mapRunEventTitle } from './row-mappers.js';

function makeEvent(type: string, payload: Record<string, unknown>) {
  return {
    id: 'evt-1',
    runId: 'run-1',
    type,
    payload: JSON.stringify(payload),
    createdAt: '2026-03-23T00:00:00Z',
  };
}

describe('mapRunEventTitle', () => {
  it('returns title for compaction events', () => {
    expect(mapRunEventTitle('compaction')).toBe('Compaction captured');
  });
});

describe('mapRunEventDetail', () => {
  describe('compaction case', () => {
    it('shows token counts when both tokensBefore and tokensAfter are present', () => {
      const event = makeEvent('compaction', {
        content: 'summary text',
        tokensBefore: 50000,
        tokensAfter: 12000,
      });
      expect(mapRunEventDetail(event)).toBe(
        'Context compacted: 50000 \u2192 12000 tokens (12 chars captured)',
      );
    });

    it('shows char count when only content is present', () => {
      const event = makeEvent('compaction', { content: 'some compacted text' });
      expect(mapRunEventDetail(event)).toBe('Compaction flush captured (19 chars)');
    });

    it('returns empty string when content is missing', () => {
      const event = makeEvent('compaction', {});
      expect(mapRunEventDetail(event)).toBe('');
    });

    it('falls back to char count when only one token field is present', () => {
      const event = makeEvent('compaction', {
        content: 'partial info',
        tokensBefore: 50000,
      });
      expect(mapRunEventDetail(event)).toBe('Compaction flush captured (12 chars)');
    });
  });
});
