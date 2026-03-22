export type { Chunker, ChunkResult, ChunkOptions } from './chunker-types.js';
export { DEFAULT_CHUNK_OPTIONS } from './chunker-types.js';
export { markdownChunker } from './markdown-chunker.js';
export { plaintextChunker } from './plaintext-chunker.js';

import type { Chunker } from './chunker-types.js';
import { markdownChunker } from './markdown-chunker.js';
import { plaintextChunker } from './plaintext-chunker.js';

/**
 * Select the appropriate chunker based on source type.
 * Markdown-structured sources use heading-aware splitting.
 * Everything else falls back to paragraph-based plaintext splitting.
 */
export function selectChunker(sourceType: string): Chunker {
  switch (sourceType) {
    case 'workspace_doc':
    case 'curated_memory':
    case 'file_doc':
      return markdownChunker;
    default:
      return plaintextChunker;
  }
}
