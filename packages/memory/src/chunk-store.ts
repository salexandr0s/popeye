import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { sha256 } from '@popeye/observability';

import type { ChunkResult } from './chunkers/chunker-types.js';

export interface InsertChunksInput {
  artifactId: string;
  sourceStreamId: string | null;
  classification: string;
  contextReleasePolicy?: string | undefined;
  chunks: ChunkResult[];
}

export interface ChunkRow {
  id: string;
  artifactId: string;
  sourceStreamId: string | null;
  chunkIndex: number;
  sectionPath: string | null;
  chunkKind: string;
  text: string;
  textHash: string;
  tokenCount: number;
  language: string | null;
  classification: string;
  contextReleasePolicy: string;
  createdAt: string;
}

/**
 * Insert chunks for an artifact and sync FTS index.
 * Returns the inserted chunk records.
 */
export function insertChunks(db: Database.Database, input: InsertChunksInput): ChunkRow[] {
  const now = new Date().toISOString();
  const policy = input.contextReleasePolicy ?? 'full';

  const insertStmt = db.prepare(
    `INSERT INTO memory_artifact_chunks
      (id, artifact_id, source_stream_id, chunk_index, section_path, chunk_kind, text, text_hash, token_count, language, classification, context_release_policy, created_at, updated_at, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')`,
  );

  const ftsStmt = db.prepare(
    'INSERT INTO memory_artifact_chunks_fts (chunk_id, section_path, text) VALUES (?, ?, ?)',
  );

  const rows: ChunkRow[] = [];

  const tx = db.transaction(() => {
    for (const chunk of input.chunks) {
      const id = randomUUID();
      const textHash = sha256(chunk.text);

      insertStmt.run(
        id,
        input.artifactId,
        input.sourceStreamId,
        chunk.index,
        chunk.sectionPath,
        chunk.chunkKind,
        chunk.text,
        textHash,
        chunk.tokenCount,
        chunk.language,
        input.classification,
        policy,
        now,
        now,
      );

      ftsStmt.run(id, chunk.sectionPath ?? '', chunk.text);

      rows.push({
        id,
        artifactId: input.artifactId,
        sourceStreamId: input.sourceStreamId,
        chunkIndex: chunk.index,
        sectionPath: chunk.sectionPath,
        chunkKind: chunk.chunkKind,
        text: chunk.text,
        textHash,
        tokenCount: chunk.tokenCount,
        language: chunk.language,
        classification: input.classification,
        contextReleasePolicy: policy,
        createdAt: now,
      });
    }
  });
  tx();

  return rows;
}

/**
 * Get all active chunks for an artifact.
 */
export function getChunksByArtifact(db: Database.Database, artifactId: string): ChunkRow[] {
  const rows = db.prepare(
    `SELECT id, artifact_id, source_stream_id, chunk_index, section_path, chunk_kind, text, text_hash, token_count, language, classification, context_release_policy, created_at
     FROM memory_artifact_chunks
     WHERE artifact_id = ? AND invalidated_at IS NULL
     ORDER BY chunk_index`,
  ).all(artifactId) as Array<{
    id: string;
    artifact_id: string;
    source_stream_id: string | null;
    chunk_index: number;
    section_path: string | null;
    chunk_kind: string;
    text: string;
    text_hash: string;
    token_count: number;
    language: string | null;
    classification: string;
    context_release_policy: string;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    artifactId: row.artifact_id,
    sourceStreamId: row.source_stream_id,
    chunkIndex: row.chunk_index,
    sectionPath: row.section_path,
    chunkKind: row.chunk_kind,
    text: row.text,
    textHash: row.text_hash,
    tokenCount: row.token_count,
    language: row.language,
    classification: row.classification,
    contextReleasePolicy: row.context_release_policy,
    createdAt: row.created_at,
  }));
}

/**
 * Invalidate all chunks for an artifact (soft delete).
 * Also removes them from FTS index.
 */
export function invalidateChunksByArtifact(db: Database.Database, artifactId: string): number {
  const now = new Date().toISOString();

  // Get chunk IDs for FTS cleanup
  const chunkIds = db.prepare(
    'SELECT id FROM memory_artifact_chunks WHERE artifact_id = ? AND invalidated_at IS NULL',
  ).all(artifactId) as Array<{ id: string }>;

  if (chunkIds.length === 0) return 0;

  const tx = db.transaction(() => {
    // Remove from FTS
    for (const { id } of chunkIds) {
      db.prepare('DELETE FROM memory_artifact_chunks_fts WHERE chunk_id = ?').run(id);
    }

    // Invalidate chunks
    db.prepare(
      'UPDATE memory_artifact_chunks SET invalidated_at = ?, updated_at = ? WHERE artifact_id = ? AND invalidated_at IS NULL',
    ).run(now, now, artifactId);
  });
  tx();

  return chunkIds.length;
}
