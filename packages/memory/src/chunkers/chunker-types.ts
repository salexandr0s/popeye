/**
 * Chunker interface and types for splitting artifact content
 * into retrievable, searchable chunks.
 */

export interface ChunkResult {
  /** Stable order within the artifact (0-based). */
  index: number;
  /** Heading path or logical section (e.g. "## Setup > ### Config"). */
  sectionPath: string | null;
  /** Kind of chunk: paragraph, heading, code_block, message_window, table, etc. */
  chunkKind: string;
  /** Normalized text content. */
  text: string;
  /** Estimated token count (chars / 4). */
  tokenCount: number;
  /** Language hint for code chunks. */
  language: string | null;
}

export interface ChunkOptions {
  /** Maximum tokens per chunk (default: 512). */
  maxTokensPerChunk?: number;
  /** Minimum tokens per chunk — smaller chunks are merged with neighbors (default: 32). */
  minTokensPerChunk?: number;
  /** Maximum total chunks per artifact (default: 200). */
  maxChunks?: number;
}

export const DEFAULT_CHUNK_OPTIONS: Required<ChunkOptions> = {
  maxTokensPerChunk: 512,
  minTokensPerChunk: 32,
  maxChunks: 200,
};

export interface Chunker {
  /** Split content into retrievable chunks. */
  chunk(content: string, opts?: ChunkOptions): ChunkResult[];
}
