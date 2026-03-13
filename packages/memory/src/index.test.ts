import { describe, expect, it } from 'vitest';

import {
  buildFts5MatchExpression,
  classifyMemoryType,
  computeConfidenceDecay,
  computeDedupKey,
  computeRecencyScore,
  computeReinforcedConfidence,
  computeScopeMatchScore,
  computeTextOverlap,
  decideEmbeddingEligibility,
  normalizeRelevanceScore,
  renderDailySummaryMarkdown,
  shouldArchive,
  shouldPersistClassification,
} from './index.js';

describe('memory policy', () => {
  it('denies embedding for receipt sources', () => {
    expect(decideEmbeddingEligibility({
      id: '1',
      description: 'receipt',
      classification: 'embeddable',
      sourceType: 'receipt',
      content: 'content',
      confidence: 1,
      scope: 'workspace',
      memoryType: 'episodic',
      dedupKey: null,
      lastReinforcedAt: null,
      archivedAt: null,
      createdAt: '2026-01-01T00:00:00Z',
    })).toBe('deny');
  });

  it('decays confidence over time', () => {
    expect(computeConfidenceDecay(1, 30)).toBeCloseTo(0.5, 5);
  });

  it('never persists secrets', () => {
    expect(shouldPersistClassification('secret')).toBe(false);
  });
});

describe('classifyMemoryType', () => {
  it('classifies receipt as episodic', () => {
    expect(classifyMemoryType('receipt', 'anything')).toBe('episodic');
  });

  it('classifies daily_summary as episodic', () => {
    expect(classifyMemoryType('daily_summary', 'anything')).toBe('episodic');
  });

  it('classifies curated_memory as semantic', () => {
    expect(classifyMemoryType('curated_memory', 'anything')).toBe('semantic');
  });

  it('classifies workspace_doc as semantic', () => {
    expect(classifyMemoryType('workspace_doc', 'anything')).toBe('semantic');
  });

  it('classifies compaction_flush with procedural keywords', () => {
    expect(classifyMemoryType('compaction_flush', 'follow this step by step workflow')).toBe('procedural');
  });

  it('classifies compaction_flush with semantic keywords', () => {
    expect(classifyMemoryType('compaction_flush', 'I learned a fact about decisions')).toBe('semantic');
  });

  it('classifies compaction_flush with no keywords as episodic', () => {
    expect(classifyMemoryType('compaction_flush', 'something happened today')).toBe('episodic');
  });

  it('defaults to episodic for unknown source types', () => {
    expect(classifyMemoryType('unknown', 'anything')).toBe('episodic');
  });
});

describe('computeDedupKey', () => {
  it('produces a consistent hash', () => {
    const key1 = computeDedupKey('Desc', 'Content here', 'workspace');
    const key2 = computeDedupKey('Desc', 'Content here', 'workspace');
    expect(key1).toBe(key2);
  });

  it('normalizes description case and whitespace', () => {
    const key1 = computeDedupKey('  Hello World  ', 'content', 'ws');
    const key2 = computeDedupKey('hello world', 'content', 'ws');
    expect(key1).toBe(key2);
  });

  it('differs for different scopes', () => {
    const key1 = computeDedupKey('desc', 'content', 'workspace-a');
    const key2 = computeDedupKey('desc', 'content', 'workspace-b');
    expect(key1).not.toBe(key2);
  });

  it('truncates content at 500 chars', () => {
    const longContent = 'x'.repeat(1000);
    const key1 = computeDedupKey('desc', longContent, 'ws');
    const key2 = computeDedupKey('desc', 'x'.repeat(500) + 'DIFFERENT', 'ws');
    expect(key1).toBe(key2);
  });
});

describe('computeReinforcedConfidence', () => {
  it('boosts confidence by default', () => {
    expect(computeReinforcedConfidence(0.5)).toBeCloseTo(0.6, 5);
  });

  it('caps at 1.0', () => {
    expect(computeReinforcedConfidence(0.95)).toBe(1);
  });

  it('supports custom boost', () => {
    expect(computeReinforcedConfidence(0.5, 0.3)).toBeCloseTo(0.8, 5);
  });
});

describe('shouldArchive', () => {
  it('archives when below threshold', () => {
    expect(shouldArchive(0.05)).toBe(true);
  });

  it('does not archive when above threshold', () => {
    expect(shouldArchive(0.5)).toBe(false);
  });

  it('does not archive at exactly the threshold', () => {
    expect(shouldArchive(0.1)).toBe(false);
  });

  it('supports custom threshold', () => {
    expect(shouldArchive(0.3, 0.5)).toBe(true);
  });
});

describe('computeTextOverlap', () => {
  it('returns 1 for identical strings', () => {
    expect(computeTextOverlap('hello world', 'hello world')).toBe(1);
  });

  it('returns 0 for completely different strings', () => {
    expect(computeTextOverlap('hello world', 'foo bar')).toBe(0);
  });

  it('returns partial overlap', () => {
    // tokens: {hello, world} vs {hello, there}
    // intersection = 1, union = 3
    expect(computeTextOverlap('hello world', 'hello there')).toBeCloseTo(1 / 3, 5);
  });

  it('returns 1 for two empty strings', () => {
    expect(computeTextOverlap('', '')).toBe(1);
  });

  it('returns 0 when one string is empty', () => {
    expect(computeTextOverlap('hello', '')).toBe(0);
  });
});

describe('renderDailySummaryMarkdown', () => {
  it('renders a complete summary', () => {
    const md = renderDailySummaryMarkdown({
      date: '2026-03-13',
      workspaceId: 'default',
      runsCompleted: 5,
      runsFailed: 1,
      discoveries: ['Found a bug'],
      errors: ['Connection timeout'],
      followUps: ['Investigate timeout'],
    });

    expect(md).toContain('# Daily Summary — 2026-03-13');
    expect(md).toContain('**Workspace:** default');
    expect(md).toContain('**Runs completed:** 5');
    expect(md).toContain('**Runs failed:** 1');
    expect(md).toContain('## Discoveries');
    expect(md).toContain('- Found a bug');
    expect(md).toContain('## Errors');
    expect(md).toContain('- Connection timeout');
    expect(md).toContain('## Follow-ups');
    expect(md).toContain('- Investigate timeout');
  });

  it('omits empty sections', () => {
    const md = renderDailySummaryMarkdown({
      date: '2026-03-13',
      workspaceId: 'ws',
      runsCompleted: 0,
      runsFailed: 0,
      discoveries: [],
      errors: [],
      followUps: [],
    });

    expect(md).not.toContain('## Discoveries');
    expect(md).not.toContain('## Errors');
    expect(md).not.toContain('## Follow-ups');
  });
});

describe('buildFts5MatchExpression', () => {
  it('wraps tokens in quotes joined by OR', () => {
    expect(buildFts5MatchExpression('hello world')).toBe('"hello" OR "world"');
  });

  it('strips FTS5 special characters', () => {
    expect(buildFts5MatchExpression('test{query}')).toBe('"test" OR "query"');
  });

  it('returns empty match for empty input', () => {
    expect(buildFts5MatchExpression('')).toBe('""');
  });

  it('handles single token', () => {
    expect(buildFts5MatchExpression('search')).toBe('"search"');
  });
});

describe('normalizeRelevanceScore', () => {
  it('returns 1 for rank 0', () => {
    expect(normalizeRelevanceScore(0)).toBe(1);
  });

  it('returns 0.5 for rank -1', () => {
    expect(normalizeRelevanceScore(-1)).toBeCloseTo(0.5, 5);
  });

  it('returns value between 0 and 1 for negative ranks', () => {
    const score = normalizeRelevanceScore(-5);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

describe('computeRecencyScore', () => {
  it('returns 1 for just-created items', () => {
    const now = new Date('2026-03-13T00:00:00Z');
    expect(computeRecencyScore('2026-03-13T00:00:00Z', now)).toBeCloseTo(1, 5);
  });

  it('decays over 90 days', () => {
    const now = new Date('2026-03-13T00:00:00Z');
    const score = computeRecencyScore('2025-12-13T00:00:00Z', now);
    expect(score).toBeCloseTo(Math.exp(-1), 2);
  });

  it('is lower for older items', () => {
    const now = new Date('2026-03-13T00:00:00Z');
    const recent = computeRecencyScore('2026-03-01T00:00:00Z', now);
    const old = computeRecencyScore('2025-01-01T00:00:00Z', now);
    expect(recent).toBeGreaterThan(old);
  });
});

describe('computeScopeMatchScore', () => {
  it('returns 1.0 for exact match', () => {
    expect(computeScopeMatchScore('workspace-1', 'workspace-1')).toBe(1.0);
  });

  it('returns 0.5 for undefined query scope', () => {
    expect(computeScopeMatchScore('workspace-1', undefined)).toBe(0.5);
  });

  it('returns 0.7 for global scope', () => {
    expect(computeScopeMatchScore('global', 'workspace-1')).toBe(0.7);
  });

  it('returns 0.1 for mismatched scopes', () => {
    expect(computeScopeMatchScore('workspace-1', 'workspace-2')).toBe(0.1);
  });
});
