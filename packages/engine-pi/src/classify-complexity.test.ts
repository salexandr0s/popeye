import { describe, expect, it } from 'vitest';

import { classifyPromptComplexity, resolveModelForPrompt } from './classify-complexity.ts';

describe('classifyPromptComplexity', () => {
  it('classifies short greeting as simple', () => {
    const result = classifyPromptComplexity('Hello!');
    expect(result.classification).toBe('simple');
    expect(result.score).toBeLessThan(0.3);
    expect(result.signals).toContain('short_length');
    expect(result.signals).toContain('few_words');
  });

  it('classifies empty string as simple', () => {
    const result = classifyPromptComplexity('');
    expect(result.classification).toBe('simple');
    expect(result.score).toBeLessThan(0.3);
  });

  it('classifies multi-line code prompt as complex', () => {
    const codeBlock = '```\nconst x = 1;\nconst y = 2;\n```';
    const words = Array.from({ length: 170 }, (_, i) => `word${i}`).join(' ');
    const prompt = `Please review this code:\n${codeBlock}\n\nAnd also this:\n${codeBlock}\n\n${words}`;
    const result = classifyPromptComplexity(prompt);
    expect(result.classification).toBe('complex');
    expect(result.score).toBeGreaterThan(0.7);
    expect(result.signals).toContain('multiple_code_blocks');
  });

  it('classifies ambiguous mid-length prompt as standard', () => {
    const prompt = 'Can you help me with my project setup and configuration? I need to understand how the authentication system works and how it interacts with the database layer across multiple services in our backend';
    const result = classifyPromptComplexity(prompt);
    expect(result.classification).toBe('standard');
    expect(result.score).toBeGreaterThanOrEqual(0.3);
    expect(result.score).toBeLessThanOrEqual(0.7);
  });

  it('bumps classification when complexity keywords are present', () => {
    const result = classifyPromptComplexity('Please debug this');
    expect(result.classification).not.toBe('simple');
    expect(result.signals).toContain('has_complexity_keywords');
  });

  it('does not classify error traces as simple', () => {
    const result = classifyPromptComplexity('Error: fail');
    expect(result.classification).not.toBe('simple');
    expect(result.signals).toContain('has_error_trace');
  });
});

describe('resolveModelForPrompt', () => {
  it('returns undefined when routing is disabled', () => {
    expect(resolveModelForPrompt({ enabled: false }, 'Hello')).toBeUndefined();
    expect(resolveModelForPrompt(undefined, 'Hello')).toBeUndefined();
  });

  it('routes simple prompt to simpleModel', () => {
    const config = { enabled: true, simpleModel: 'haiku', standardModel: 'sonnet', complexModel: 'opus' };
    const result = resolveModelForPrompt(config, 'Hi');
    expect(result).toBeDefined();
    expect(result!.model).toBe('haiku');
    expect(result!.classification).toBe('simple');
  });

  it('routes standard prompt to standardModel', () => {
    const prompt = 'Can you help me with my project setup and configuration? I need to understand how the authentication system works and how it interacts with the database layer across multiple services in our backend';
    const config = { enabled: true, simpleModel: 'haiku', standardModel: 'sonnet', complexModel: 'opus' };
    const result = resolveModelForPrompt(config, prompt);
    expect(result).toBeDefined();
    expect(result!.model).toBe('sonnet');
    expect(result!.classification).toBe('standard');
  });

  it('routes complex prompt to complexModel', () => {
    const codeBlock = '```\nconst x = 1;\n```';
    const words = Array.from({ length: 170 }, (_, i) => `word${i}`).join(' ');
    const config = { enabled: true, simpleModel: 'haiku', standardModel: 'sonnet', complexModel: 'opus' };
    const result = resolveModelForPrompt(config, `Review:\n${codeBlock}\n${codeBlock}\n${words}`);
    expect(result).toBeDefined();
    expect(result!.model).toBe('opus');
    expect(result!.classification).toBe('complex');
  });

  it('returns undefined model when matching tier has no model configured', () => {
    const config = { enabled: true };
    const result = resolveModelForPrompt(config, 'Hi');
    expect(result).toBeDefined();
    expect(result!.model).toBeUndefined();
  });
});
