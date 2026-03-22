import { DEFAULT_CHUNK_OPTIONS, type ChunkOptions, type ChunkResult, type Chunker } from './chunker-types.js';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Plaintext chunker: splits by paragraph boundaries (double newlines).
 * Merges small paragraphs to meet minimum chunk size.
 */
export const plaintextChunker: Chunker = {
  chunk(content: string, opts?: ChunkOptions): ChunkResult[] {
    const options = { ...DEFAULT_CHUNK_OPTIONS, ...opts };
    const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().length > 0);

    if (paragraphs.length === 0) return [];

    // Merge small paragraphs, split large ones
    const groups: string[] = [];
    let current = '';

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (current.length === 0) {
        current = trimmed;
        continue;
      }

      const combined = current + '\n\n' + trimmed;
      if (estimateTokens(combined) <= options.maxTokensPerChunk) {
        current = combined;
      } else {
        // Flush current if it meets minimum size
        if (estimateTokens(current) >= options.minTokensPerChunk) {
          groups.push(current);
          current = trimmed;
        } else {
          // Current is too small alone — combine anyway (will be over max but avoids tiny chunks)
          current = combined;
        }
      }
    }
    if (current.trim().length > 0) {
      groups.push(current.trim());
    }

    // If we ended up with a single group that's too small, just return it as-is
    const capped = groups.slice(0, options.maxChunks);
    return capped.map((text, i) => ({
      index: i,
      sectionPath: null,
      chunkKind: 'paragraph',
      text,
      tokenCount: estimateTokens(text),
      language: null,
    }));
  },
};
