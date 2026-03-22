import { describe, expect, it } from 'vitest';
import { markdownChunker } from './markdown-chunker.js';

describe('markdownChunker', () => {
  it('splits by heading hierarchy', () => {
    const content = `# Title

Intro paragraph.

## Section A

Content for section A.

## Section B

Content for section B.
`;
    const chunks = markdownChunker.chunk(content);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const sectionA = chunks.find((c) => c.text.includes('Content for section A'));
    const sectionB = chunks.find((c) => c.text.includes('Content for section B'));
    expect(sectionA).toBeTruthy();
    expect(sectionB).toBeTruthy();
    expect(sectionA!.sectionPath).toContain('## Section A');
    expect(sectionB!.sectionPath).toContain('## Section B');
  });

  it('extracts code fences as code_block chunks', () => {
    const content = `## Setup

Some text.

\`\`\`typescript
const x = 42;
\`\`\`

More text.
`;
    const chunks = markdownChunker.chunk(content);
    const codeChunk = chunks.find((c) => c.chunkKind === 'code_block');
    expect(codeChunk).toBeTruthy();
    expect(codeChunk!.text).toContain('const x = 42');
    expect(codeChunk!.language).toBe('typescript');
    expect(codeChunk!.sectionPath).toContain('## Setup');
  });

  it('falls back to paragraph splitting for flat markdown', () => {
    const content = `First paragraph with enough text to be its own chunk.

Second paragraph with enough text to be its own chunk.

Third paragraph with enough text to be its own chunk.`;
    const chunks = markdownChunker.chunk(content);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0]!.sectionPath).toBeNull();
    expect(chunks[0]!.chunkKind).toBe('paragraph');
  });

  it('merges small chunks with neighbors under same heading', () => {
    const content = `## Section

A.

B.

C.`;
    const chunks = markdownChunker.chunk(content, { minTokensPerChunk: 32 });
    // All three tiny paragraphs should be merged into one
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toContain('A.');
    expect(chunks[0]!.text).toContain('C.');
  });

  it('respects maxChunks limit', () => {
    const sections = Array.from({ length: 10 }, (_, i) => `## Section ${i}\n\nContent ${i}.\n`).join('\n');
    const chunks = markdownChunker.chunk(sections, { maxChunks: 3 });
    expect(chunks.length).toBeLessThanOrEqual(3);
  });

  it('handles empty content', () => {
    const chunks = markdownChunker.chunk('');
    expect(chunks).toHaveLength(0);
  });

  it('handles content with only code fences', () => {
    const content = `\`\`\`python
print("hello")
\`\`\``;
    const chunks = markdownChunker.chunk(content);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.chunkKind).toBe('code_block');
    expect(chunks[0]!.language).toBe('python');
  });

  it('assigns sequential indexes', () => {
    const content = `## A\n\nText A.\n\n## B\n\nText B.\n\n## C\n\nText C.`;
    const chunks = markdownChunker.chunk(content);
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]!.index).toBe(i);
    }
  });

  it('estimates token count', () => {
    const content = `## Section\n\n${'word '.repeat(100)}`;
    const chunks = markdownChunker.chunk(content);
    expect(chunks[0]!.tokenCount).toBeGreaterThan(0);
    // ~500 chars = ~125 tokens
    expect(chunks[0]!.tokenCount).toBeLessThan(200);
  });

  it('handles nested headings', () => {
    const content = `# Top

## Sub

### Deep

Content here.`;
    const chunks = markdownChunker.chunk(content);
    const deep = chunks.find((c) => c.text.includes('Content here'));
    expect(deep).toBeTruthy();
    expect(deep!.sectionPath).toContain('# Top');
    expect(deep!.sectionPath).toContain('## Sub');
    expect(deep!.sectionPath).toContain('### Deep');
  });
});
