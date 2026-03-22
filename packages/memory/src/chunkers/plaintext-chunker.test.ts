import { describe, expect, it } from 'vitest';
import { plaintextChunker } from './plaintext-chunker.js';

describe('plaintextChunker', () => {
  it('splits by paragraph boundaries', () => {
    const content = `${'word '.repeat(200)}

${'word '.repeat(200)}

${'word '.repeat(200)}`;
    const chunks = plaintextChunker.chunk(content, { maxTokensPerChunk: 300 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('merges small paragraphs', () => {
    const content = `Short A.

Short B.

Short C.`;
    const chunks = plaintextChunker.chunk(content, { minTokensPerChunk: 32 });
    // All three should be merged
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toContain('Short A.');
    expect(chunks[0]!.text).toContain('Short C.');
  });

  it('sets sectionPath to null', () => {
    const chunks = plaintextChunker.chunk('Some text content here.');
    expect(chunks[0]!.sectionPath).toBeNull();
  });

  it('sets chunkKind to paragraph', () => {
    const chunks = plaintextChunker.chunk('Some text content here.');
    expect(chunks[0]!.chunkKind).toBe('paragraph');
  });

  it('handles empty content', () => {
    const chunks = plaintextChunker.chunk('');
    expect(chunks).toHaveLength(0);
  });

  it('handles whitespace-only content', () => {
    const chunks = plaintextChunker.chunk('   \n\n   \n\n   ');
    expect(chunks).toHaveLength(0);
  });

  it('respects maxChunks limit', () => {
    const content = Array.from({ length: 20 }, (_, i) => `Paragraph ${i} with some content.`).join('\n\n');
    const chunks = plaintextChunker.chunk(content, { maxChunks: 5 });
    expect(chunks.length).toBeLessThanOrEqual(5);
  });

  it('assigns sequential indexes', () => {
    const content = `${'word '.repeat(200)}\n\n${'word '.repeat(200)}\n\n${'word '.repeat(200)}`;
    const chunks = plaintextChunker.chunk(content, { maxTokensPerChunk: 300 });
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]!.index).toBe(i);
    }
  });

  it('estimates token count', () => {
    const content = 'word '.repeat(100);
    const chunks = plaintextChunker.chunk(content);
    expect(chunks[0]!.tokenCount).toBeGreaterThan(0);
  });
});
