import { describe, expect, it } from 'vitest';

import { createDisabledSummarizationClient, createOpenAISummarizationClient } from './summarization-client.js';

describe('createDisabledSummarizationClient', () => {
  it('returns enabled=false', () => {
    const client = createDisabledSummarizationClient();
    expect(client.enabled).toBe(false);
  });

  it('returns input when under token limit', async () => {
    const client = createDisabledSummarizationClient();
    const result = await client.complete({
      systemPrompt: 'system',
      userPrompt: 'short input',
      maxTokens: 100,
    });
    expect(result).toBe('short input');
  });

  it('truncates input when over token limit', async () => {
    const client = createDisabledSummarizationClient();
    const longInput = 'a'.repeat(1000);
    const result = await client.complete({
      systemPrompt: 'system',
      userPrompt: longInput,
      maxTokens: 10, // 10 * 4 = 40 chars
    });
    expect(result).toHaveLength(40 + '... [truncated]'.length);
    expect(result).toContain('... [truncated]');
  });
});

describe('createOpenAISummarizationClient', () => {
  it('returns enabled=true', () => {
    const client = createOpenAISummarizationClient({});
    expect(client.enabled).toBe(true);
  });

  it('throws when OPENAI_API_KEY is not set', async () => {
    const originalKey = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];

    const client = createOpenAISummarizationClient({});
    await expect(
      client.complete({ systemPrompt: 'test', userPrompt: 'test', maxTokens: 100 }),
    ).rejects.toThrow('OPENAI_API_KEY');

    if (originalKey) process.env['OPENAI_API_KEY'] = originalKey;
  });
});
