import { describe, expect, it } from 'vitest';

import {
  buildRetryPrompt,
  buildSummarizePrompt,
  injectTimestamps,
  selectPromptTier,
} from './summarize-prompts.js';

describe('selectPromptTier', () => {
  it('returns leaf for depth 0', () => {
    expect(selectPromptTier(0)).toBe('leaf');
  });

  it('returns condensed_d1 for depth 1', () => {
    expect(selectPromptTier(1)).toBe('condensed_d1');
  });

  it('returns condensed_d2 for depth 2', () => {
    expect(selectPromptTier(2)).toBe('condensed_d2');
  });

  it('returns condensed_d3_plus for depth 3 and above', () => {
    expect(selectPromptTier(3)).toBe('condensed_d3_plus');
    expect(selectPromptTier(5)).toBe('condensed_d3_plus');
    expect(selectPromptTier(10)).toBe('condensed_d3_plus');
  });
});

describe('buildSummarizePrompt', () => {
  it('builds leaf prompt for depth 0', () => {
    const result = buildSummarizePrompt({
      content: 'User asked about deployment. Agent deployed v2.1.',
      depth: 0,
    });

    expect(result.systemPrompt).toContain('precise summarizer');
    expect(result.userPrompt).toContain('conversation segment');
    expect(result.userPrompt).toContain('deployment');
    expect(result.maxTokens).toBe(500);
  });

  it('builds D1 condensed prompt', () => {
    const result = buildSummarizePrompt({
      content: 'Summary 1...\nSummary 2...',
      depth: 1,
    });

    expect(result.systemPrompt).toContain('narrative consolidator');
    expect(result.userPrompt).toContain('Consolidate');
    expect(result.maxTokens).toBe(800);
  });

  it('builds D2 synthesis prompt', () => {
    const result = buildSummarizePrompt({
      content: 'Grouped summaries...',
      depth: 2,
    });

    expect(result.systemPrompt).toContain('synthesis engine');
    expect(result.userPrompt).toContain('Synthesize');
    expect(result.maxTokens).toBe(1000);
  });

  it('builds D3+ arc prompt', () => {
    const result = buildSummarizePrompt({
      content: 'Top-level arcs...',
      depth: 4,
    });

    expect(result.systemPrompt).toContain('arc summarizer');
    expect(result.userPrompt).toContain('high-level arc');
    expect(result.maxTokens).toBe(1200);
  });

  it('injects timestamps when startTime provided', () => {
    const result = buildSummarizePrompt({
      content: 'Some content',
      depth: 0,
      startTime: '2025-03-15T14:30:00.000Z',
    });

    expect(result.userPrompt).toContain('[2025-03-15 14:30 UTC]');
  });

  it('works without startTime', () => {
    const result = buildSummarizePrompt({
      content: 'Some content',
      depth: 0,
    });

    expect(result.userPrompt).not.toContain('UTC');
    expect(result.userPrompt).toContain('Some content');
  });
});

describe('buildRetryPrompt', () => {
  it('returns stricter system prompt', () => {
    const normal = buildSummarizePrompt({ content: 'test', depth: 0 });
    const retry = buildRetryPrompt({ content: 'test', depth: 0 });

    expect(retry.systemPrompt).toContain('strict');
    expect(retry.systemPrompt).not.toBe(normal.systemPrompt);
    expect(retry.maxTokens).toBeLessThan(normal.maxTokens);
  });

  it('uses same user prompt template', () => {
    const retry = buildRetryPrompt({ content: 'test content', depth: 1 });

    // User prompt contains the same content and template text as the normal prompt
    expect(retry.userPrompt).toContain('test content');
    expect(retry.userPrompt).toContain('Consolidate');
  });

  it('reduces max tokens for retry', () => {
    for (let depth = 0; depth <= 4; depth++) {
      const normal = buildSummarizePrompt({ content: 'test', depth });
      const retry = buildRetryPrompt({ content: 'test', depth });
      expect(retry.maxTokens).toBeLessThan(normal.maxTokens);
    }
  });
});

describe('injectTimestamps', () => {
  it('prepends UTC timestamp tag', () => {
    const result = injectTimestamps('Hello world', '2025-06-15T08:45:00.000Z');
    expect(result).toBe('[2025-06-15 08:45 UTC]\nHello world');
  });

  it('handles midnight correctly', () => {
    const result = injectTimestamps('Content', '2025-01-01T00:00:00.000Z');
    expect(result).toBe('[2025-01-01 00:00 UTC]\nContent');
  });

  it('returns content unchanged for invalid date', () => {
    const result = injectTimestamps('Content', 'not-a-date');
    expect(result).toBe('Content');
  });

  it('pads single-digit months and days', () => {
    const result = injectTimestamps('Content', '2025-03-05T09:05:00.000Z');
    expect(result).toBe('[2025-03-05 09:05 UTC]\nContent');
  });
});
