import { describe, expect, it } from 'vitest';

import { sanitizeSearchQuery, assessMemoryQuality, isDurableMemory, computeJaccardRelevance } from './pure-functions.js';

describe('sanitizeSearchQuery', () => {
  it('strips [Memory: ...] blocks', () => {
    expect(sanitizeSearchQuery('hello [Memory: some context] world')).toBe('hello world');
  });

  it('strips [Memory: ...][/Memory] blocks', () => {
    expect(sanitizeSearchQuery('query [Memory: recalled fact][/Memory] more text')).toBe('query more text');
  });

  it('strips <!-- memory --> HTML comments', () => {
    expect(sanitizeSearchQuery('find this <!-- memory injected block --> please')).toBe('find this please');
  });

  it('strips <memory>...</memory> XML blocks', () => {
    expect(sanitizeSearchQuery('search <memory>injected context</memory> terms')).toBe('search terms');
  });

  it('strips <gigabrain-context>...</gigabrain-context> blocks', () => {
    expect(sanitizeSearchQuery('query <gigabrain-context>recalled</gigabrain-context> here')).toBe('query here');
  });

  it('strips [Retrieved Memory]...[/Retrieved Memory] blocks', () => {
    expect(sanitizeSearchQuery('find [Retrieved Memory]old data[/Retrieved Memory] now')).toBe('find now');
  });

  it('handles multiple injection blocks', () => {
    const input = '[Memory: a] query <!-- memory b --> text <memory>c</memory>';
    expect(sanitizeSearchQuery(input)).toBe('query text');
  });

  it('preserves normal text', () => {
    expect(sanitizeSearchQuery('what is the user birthday')).toBe('what is the user birthday');
  });

  it('handles empty input', () => {
    expect(sanitizeSearchQuery('')).toBe('');
  });

  it('handles whitespace-only after stripping', () => {
    expect(sanitizeSearchQuery('[Memory: everything][/Memory]')).toBe('');
  });

  it('collapses excess whitespace', () => {
    expect(sanitizeSearchQuery('hello   [Memory: x][/Memory]   world')).toBe('hello world');
  });
});

describe('assessMemoryQuality', () => {
  it('rejects empty description', () => {
    const result = assessMemoryQuality('', 'valid content here for testing');
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('empty_description');
  });

  it('rejects whitespace-only description', () => {
    const result = assessMemoryQuality('   ', 'valid content here for testing');
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('empty_description');
  });

  it('rejects content shorter than 20 chars', () => {
    const result = assessMemoryQuality('good description', 'too short');
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('content_too_short');
  });

  it('rejects whitespace-only content as too short', () => {
    const result = assessMemoryQuality('desc', '                              ');
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('content_too_short');
  });

  it('rejects repetitive content', () => {
    const result = assessMemoryQuality('desc', 'test test test test test test test test test test test test test test test test test test test test test');
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('repetitive_content');
  });

  it('rejects content identical to description', () => {
    const text = 'this is both the description and the content';
    const result = assessMemoryQuality(text, text);
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('content_equals_description');
  });

  it('rejects system prompt echoes', () => {
    const result = assessMemoryQuality('desc', 'You are a helpful assistant that answers questions about code');
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('system_prompt_echo');
  });

  it('accepts normal quality content', () => {
    const result = assessMemoryQuality(
      'User preference for dark mode',
      'The user prefers dark mode in all editors and terminals. They mentioned this during the initial setup conversation.',
    );
    expect(result.pass).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it('returns a score between 0 and 1 for passing content', () => {
    const result = assessMemoryQuality(
      'Project decision',
      'We decided to use Fastify instead of Express for the API layer because of better TypeScript support and schema validation.',
    );
    expect(result.pass).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});

describe('isDurableMemory', () => {
  it('detects name statements', () => {
    expect(isDurableMemory('My name is Alex and I work on Popeye')).toBe(true);
  });

  it('detects birthday patterns', () => {
    expect(isDurableMemory('User birthday is March 15th')).toBe(true);
  });

  it('detects role statements', () => {
    expect(isDurableMemory('I work as a senior engineer at Acme Corp')).toBe(true);
  });

  it('detects identity patterns', () => {
    expect(isDurableMemory('I live in San Francisco and commute by bike')).toBe(true);
  });

  it('does not flag generic semantic content as durable', () => {
    expect(isDurableMemory('Prefers dark mode in editors')).toBe(false);
  });

  it('does not flag generic episodic content', () => {
    expect(isDurableMemory('Ran database migration and fixed three bugs in the API layer')).toBe(false);
  });
});

describe('computeJaccardRelevance', () => {
  it('returns 1.0 for identical text', () => {
    expect(computeJaccardRelevance('hello world', 'hello world')).toBe(1);
  });

  it('returns partial overlap for shared tokens', () => {
    const score = computeJaccardRelevance('database migration', 'database schema migration plan');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('returns 0 for no overlap', () => {
    expect(computeJaccardRelevance('hello world', 'foo bar baz')).toBe(0);
  });

  it('returns 0 for empty query', () => {
    expect(computeJaccardRelevance('', 'some content')).toBe(0);
  });

  it('returns 0 for empty content', () => {
    expect(computeJaccardRelevance('query', '')).toBe(0);
  });

  it('is case insensitive', () => {
    expect(computeJaccardRelevance('Database', 'database')).toBe(1);
  });

  it('limits content to 500 tokens', () => {
    const longContent = Array.from({ length: 1000 }, (_, i) => `word${i}`).join(' ');
    // Should not throw, should handle gracefully
    const score = computeJaccardRelevance('word0 word1', longContent);
    expect(score).toBeGreaterThan(0);
  });
});
