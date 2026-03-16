import { describe, expect, it } from 'vitest';

import { classifyExpansionPolicy } from './expansion-policy.js';

describe('classifyExpansionPolicy', () => {
  describe('low risk (specific queries)', () => {
    it('classifies normal search queries as low risk', () => {
      const result = classifyExpansionPolicy('TypeScript migration plan');
      expect(result.risk).toBe('low');
      expect(result.route).toBe('answer_directly');
      expect(result.recommendedLimit).toBe(20);
      expect(result.warning).toBeUndefined();
    });

    it('classifies queries with identifiers as low risk', () => {
      const result = classifyExpansionPolicy('what happened in run-abc123');
      expect(result.risk).toBe('low');
      expect(result.route).toBe('answer_directly');
    });

    it('classifies date-specific queries as low risk', () => {
      const result = classifyExpansionPolicy('what was decided on 2025-03-15');
      expect(result.risk).toBe('low');
    });
  });

  describe('moderate risk (multi-hop)', () => {
    it('detects "how did X relate to Y"', () => {
      const result = classifyExpansionPolicy('how did the auth migration relate to the API redesign');
      expect(result.risk).toBe('moderate');
      expect(result.route).toBe('expand_shallow');
      expect(result.recommendedLimit).toBe(5);
    });

    it('detects "trace history"', () => {
      const result = classifyExpansionPolicy('trace the history of deployment failures');
      expect(result.risk).toBe('moderate');
    });

    it('detects "connection between"', () => {
      const result = classifyExpansionPolicy('connection between memory system and search');
      expect(result.risk).toBe('moderate');
    });

    it('detects "what led to"', () => {
      const result = classifyExpansionPolicy('what led to the decision to use SQLite');
      expect(result.risk).toBe('moderate');
    });

    it('detects "timeline of"', () => {
      const result = classifyExpansionPolicy('timeline of changes to the scheduler');
      expect(result.risk).toBe('moderate');
    });

    it('detects "evolution of"', () => {
      const result = classifyExpansionPolicy('evolution of the memory system');
      expect(result.risk).toBe('moderate');
    });
  });

  describe('high risk (broad/exhaustive)', () => {
    it('detects "everything from" patterns', () => {
      const result = classifyExpansionPolicy('everything from last week');
      expect(result.risk).toBe('high');
      expect(result.route).toBe('expand_deep');
      expect(result.recommendedLimit).toBe(5);
      expect(result.warning).toBeDefined();
    });

    it('detects "all of last month"', () => {
      const result = classifyExpansionPolicy('all of last month');
      expect(result.risk).toBe('high');
    });

    it('detects "all memories"', () => {
      const result = classifyExpansionPolicy('show me all memories');
      expect(result.risk).toBe('high');
    });

    it('detects "every record"', () => {
      const result = classifyExpansionPolicy('every record about the project');
      expect(result.risk).toBe('high');
    });

    it('detects "since January" time ranges', () => {
      const result = classifyExpansionPolicy('since March');
      expect(result.risk).toBe('high');
    });

    it('detects "history of" patterns', () => {
      const result = classifyExpansionPolicy('give me the history of all changes');
      expect(result.risk).toBe('high');
    });

    it('detects very short queries', () => {
      const result = classifyExpansionPolicy('db');
      expect(result.risk).toBe('high');
      expect(result.warning).toContain('short query');
    });

    it('detects wildcard queries', () => {
      const result = classifyExpansionPolicy('*');
      expect(result.risk).toBe('high');
    });

    it('detects bare "all"', () => {
      const result = classifyExpansionPolicy('all');
      expect(result.risk).toBe('high');
    });

    it('detects bare "everything"', () => {
      const result = classifyExpansionPolicy('everything');
      expect(result.risk).toBe('high');
    });
  });

  describe('custom limits', () => {
    it('respects custom low limit', () => {
      const result = classifyExpansionPolicy('specific query', { lowLimit: 50 });
      expect(result.recommendedLimit).toBe(50);
    });

    it('respects custom moderate limit', () => {
      const result = classifyExpansionPolicy('how did X relate to Y', { moderateLimit: 10 });
      expect(result.recommendedLimit).toBe(10);
    });

    it('respects custom high limit', () => {
      const result = classifyExpansionPolicy('everything from last year', { highLimit: 3 });
      expect(result.recommendedLimit).toBe(3);
    });
  });

  describe('edge cases', () => {
    it('handles empty query as low risk', () => {
      const result = classifyExpansionPolicy('');
      expect(result.risk).toBe('low');
    });

    it('handles whitespace-only query as low risk', () => {
      const result = classifyExpansionPolicy('   ');
      expect(result.risk).toBe('low');
    });

    it('is case-insensitive', () => {
      const result = classifyExpansionPolicy('EVERYTHING FROM LAST MONTH');
      expect(result.risk).toBe('high');
    });
  });
});
