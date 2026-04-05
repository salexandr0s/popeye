import { describe, expect, it } from 'vitest';

import {
  createDisabledWikiCompilationClient,
  type WikiCompilationClient,
  type WikiCompileInput,
  type WikiCompileOutput,
} from './wiki-compilation-client.ts';
import {
  buildSourceCompilePrompt,
  buildSourceUpdatePrompt,
  buildEntityPagePrompt,
  buildIndexPrompt,
} from './wiki-compile-prompts.ts';
import type { KnowledgeSourceRecord } from '../../contracts/src/index.ts';

function mockSource(overrides?: Partial<KnowledgeSourceRecord>): KnowledgeSourceRecord {
  return {
    id: 'src-1',
    workspaceId: 'ws-1',
    knowledgeRootId: 'root-1',
    sourceType: 'website',
    title: 'Test Article',
    originalUri: 'https://example.com/test',
    originalPath: null,
    originalFileName: null,
    originalMediaType: 'text/html',
    adapter: 'jina_reader',
    fallbackUsed: false,
    status: 'compiled',
    contentHash: 'abc123',
    assetStatus: 'none',
    latestOutcome: 'created',
    conversionWarnings: [],
    createdAt: '2026-04-04T12:00:00Z',
    updatedAt: '2026-04-04T12:00:00Z',
    ...overrides,
  };
}

function createMockWikiCompilationClient(output: WikiCompileOutput): WikiCompilationClient {
  return {
    enabled: true,
    async compile(_input: WikiCompileInput): Promise<WikiCompileOutput> {
      return output;
    },
  };
}

describe('WikiCompilationClient', () => {
  describe('createDisabledWikiCompilationClient', () => {
    it('returns enabled=false', () => {
      const client = createDisabledWikiCompilationClient();
      expect(client.enabled).toBe(false);
    });

    it('returns empty output', async () => {
      const client = createDisabledWikiCompilationClient();
      const result = await client.compile({ systemPrompt: 'test', userPrompt: 'test', maxTokens: 100 });
      expect(result.markdown).toBe('');
      expect(result.suggestedEntities).toEqual([]);
      expect(result.suggestedCrossLinks).toEqual([]);
      expect(result.summary).toBe('');
    });
  });

  describe('mock client', () => {
    it('returns structured output', async () => {
      const expected: WikiCompileOutput = {
        markdown: '# Test Article\n\nThis discusses [[OpenAI]] and [[GPT-4]].\n',
        suggestedEntities: ['OpenAI', 'GPT-4'],
        suggestedCrossLinks: ['machine-learning', 'language-models'],
        summary: 'An overview of GPT-4 by OpenAI.',
      };
      const client = createMockWikiCompilationClient(expected);
      expect(client.enabled).toBe(true);

      const result = await client.compile({ systemPrompt: 'sys', userPrompt: 'user', maxTokens: 4000 });
      expect(result).toEqual(expected);
    });
  });
});

describe('wiki-compile-prompts', () => {
  const source = mockSource();

  describe('buildSourceCompilePrompt', () => {
    it('includes source metadata and content', () => {
      const result = buildSourceCompilePrompt(source, '# Hello\nContent here.', '');
      expect(result.systemPrompt).toContain('wiki compiler');
      expect(result.userPrompt).toContain('Test Article');
      expect(result.userPrompt).toContain('website');
      expect(result.userPrompt).toContain('https://example.com/test');
      expect(result.userPrompt).toContain('# Hello');
      expect(result.maxTokens).toBeGreaterThan(0);
    });
  });

  describe('buildSourceUpdatePrompt', () => {
    it('includes existing wiki content and new source', () => {
      const result = buildSourceUpdatePrompt(source, '# Update\nNew info.', '# Existing\nOld info.');
      expect(result.systemPrompt).toContain('updating an existing wiki article');
      expect(result.userPrompt).toContain('Existing wiki article');
      expect(result.userPrompt).toContain('# Existing');
      expect(result.userPrompt).toContain('New source content');
      expect(result.userPrompt).toContain('# Update');
    });
  });

  describe('buildEntityPagePrompt', () => {
    it('builds new entity page prompt', () => {
      const result = buildEntityPagePrompt('OpenAI', ['OpenAI released GPT-4.', 'OpenAI is an AI lab.'], null);
      expect(result.systemPrompt).toContain('entity');
      expect(result.userPrompt).toContain('OpenAI');
      expect(result.userPrompt).toContain('Context 1');
      expect(result.userPrompt).toContain('Context 2');
      expect(result.maxTokens).toBe(2000);
    });

    it('builds update entity page prompt when existing page provided', () => {
      const result = buildEntityPagePrompt('OpenAI', ['New context.'], '# OpenAI\nExisting content.');
      expect(result.systemPrompt).toContain('updating');
      expect(result.userPrompt).toContain('Existing page');
    });
  });

  describe('buildIndexPrompt', () => {
    it('lists all documents with summaries', () => {
      const docs = [
        { slug: 'openai', title: 'OpenAI', summary: 'An AI research lab.' },
        { slug: 'gpt-4', title: 'GPT-4', summary: 'A large language model.' },
      ];
      const result = buildIndexPrompt(docs);
      expect(result.systemPrompt).toContain('index compiler');
      expect(result.userPrompt).toContain('2 total');
      expect(result.userPrompt).toContain('[[openai]]');
      expect(result.userPrompt).toContain('[[gpt-4]]');
    });
  });
});
