import type Database from 'better-sqlite3';
import type { DataClassification, MemorySourceType } from '@popeye/contracts';
import { sha256 } from '@popeye/observability';

import { resolveOrCreateSourceStream, updateSourceStreamStatus } from './source-streams.js';
import { captureArtifact } from './artifact-store.js';
import { selectChunker } from './chunkers/index.js';
import { insertChunks } from './chunk-store.js';
import { extractFacts } from './fact-extractor.js';
import { upsertFacts } from './fact-store.js';

export interface BackfillOptions {
  batchSize?: number | undefined;
  scope: string;
  namespaceId: string;
  classification: DataClassification;
}

export interface BackfillResult {
  processed: number;
  skipped: number;
  errors: number;
}

interface LegacyMemoryRow {
  id: string;
  description: string;
  classification: string;
  source_type: string;
  content: string;
  confidence: number;
  scope: string;
  created_at: string;
  memory_type: string | null;
  source_run_id: string | null;
  source_timestamp: string | null;
  workspace_id: string | null;
  project_id: string | null;
  namespace_id: string | null;
  domain: string | null;
}

/**
 * Backfill legacy `memories` rows into the structured layer:
 * source stream → artifact → chunks → facts.
 *
 * Skips rows whose content hash matches the source stream's `last_processed_hash`.
 * Errors on individual rows are caught and counted, not propagated.
 */
export function backfillLegacyMemories(db: Database.Database, opts: BackfillOptions): BackfillResult {
  const batchSize = opts.batchSize ?? 100;

  const rows = db.prepare(
    `SELECT id, description, classification, source_type, content, confidence, scope,
            created_at, memory_type, source_run_id, source_timestamp,
            workspace_id, project_id, namespace_id, domain
     FROM memories
     WHERE archived_at IS NULL
     ORDER BY created_at ASC
     LIMIT ?`,
  ).all(batchSize) as LegacyMemoryRow[];

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      const contentHash = sha256(row.content);

      // Resolve or create source stream
      const stream = resolveOrCreateSourceStream(db, {
        stableKey: `legacy:${row.id}`,
        providerKind: 'legacy',
        sourceType: (row.source_type || 'curated_memory') as MemorySourceType,
        scope: row.scope || opts.scope,
        workspaceId: row.workspace_id,
        projectId: row.project_id,
        classification: opts.classification,
      });

      // Skip if content unchanged
      if (stream.lastProcessedHash === contentHash) {
        skipped++;
        continue;
      }

      // Capture artifact
      const artifact = captureArtifact(db, {
        sourceType: (row.source_type || 'curated_memory') as MemorySourceType,
        classification: opts.classification,
        scope: row.scope || opts.scope,
        workspaceId: row.workspace_id,
        projectId: row.project_id,
        content: row.content,
        sourceRunId: row.source_run_id,
        sourceStreamId: stream.id,
      });

      // Chunk
      const chunker = selectChunker(row.source_type || 'curated_memory');
      const chunkResults = chunker.chunk(row.content, {});
      if (chunkResults.length > 0) {
        insertChunks(db, {
          artifactId: artifact.id,
          sourceStreamId: stream.id,
          classification: opts.classification,
          chunks: chunkResults,
        });
      }

      // Extract and upsert facts
      const facts = extractFacts({
        description: row.description,
        content: row.content,
        classification: opts.classification,
        sourceType: (row.source_type || 'curated_memory') as MemorySourceType,
        scope: row.scope || opts.scope,
        memoryType: (row.memory_type || 'episodic') as 'episodic' | 'semantic' | 'procedural',
        sourceRunId: row.source_run_id,
        sourceTimestamp: row.source_timestamp,
      });
      if (facts.length > 0) {
        upsertFacts(db, {
          artifact,
          sourceType: (row.source_type || 'curated_memory') as MemorySourceType,
          scope: row.scope || opts.scope,
          workspaceId: row.workspace_id,
          projectId: row.project_id,
          classification: opts.classification,
          memoryType: (row.memory_type || 'episodic') as 'episodic' | 'semantic' | 'procedural',
          sourceRunId: row.source_run_id,
          sourceTimestamp: row.source_timestamp,
          facts,
        });
      }

      // Update stream status
      updateSourceStreamStatus(db, stream.id, 'done', contentHash);
      processed++;
    } catch {
      errors++;
    }
  }

  return { processed, skipped, errors };
}
