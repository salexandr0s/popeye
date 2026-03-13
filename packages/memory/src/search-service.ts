import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

import type { MemoryRecord, MemorySearchResponse, MemorySearchResult, MemoryType } from './types.js';
import { redactText } from '@popeye/observability';

import { classifyMemoryType, computeDedupKey, computeReinforcedConfidence } from './pure-functions.js';
import type { EmbeddingClient } from './embedding-client.js';
import { searchFts5, syncFtsDelete, syncFtsInsert } from './fts5-search.js';
import { rerankAndMerge } from './scoring.js';
import type { ScoredCandidate } from './scoring.js';
import { deleteVecEmbedding, insertVecEmbedding, searchVec } from './vec-search.js';

export class MemorySearchService {
  private readonly db: Database.Database;
  private readonly embeddingClient: EmbeddingClient;
  private readonly vecAvailable: boolean;

  constructor(opts: { db: Database.Database; embeddingClient: EmbeddingClient; vecAvailable: boolean }) {
    this.db = opts.db;
    this.embeddingClient = opts.embeddingClient;
    this.vecAvailable = opts.vecAvailable;
  }

  async search(query: {
    query: string;
    scope?: string;
    memoryTypes?: MemoryType[];
    minConfidence?: number;
    limit?: number;
    includeContent?: boolean;
  }): Promise<MemorySearchResponse> {
    const queryText = query.query;
    const minConfidence = query.minConfidence ?? 0.1;
    const limit = query.limit ?? 20;
    const includeContent = query.includeContent ?? false;
    const scope = query.scope;
    const memoryTypes = query.memoryTypes;

    const start = performance.now();

    let searchMode: 'hybrid' | 'fts_only' | 'vec_only' = 'fts_only';
    let results: MemorySearchResult[];

    const ftsFilters: { scope?: string; minConfidence?: number; memoryTypes?: MemoryType[]; limit?: number } = {
      minConfidence,
      limit: limit * 3, // Over-fetch for reranking
    };
    if (scope !== undefined) ftsFilters.scope = scope;
    if (memoryTypes !== undefined) ftsFilters.memoryTypes = memoryTypes;

    const rerankParams: { halfLifeDays: number; queryScope?: string } = { halfLifeDays: 30 };
    if (scope !== undefined) rerankParams.queryScope = scope;

    const mapResult = (c: ScoredCandidate): MemorySearchResult => ({
      memoryId: c.memoryId,
      description: c.description,
      content: includeContent ? c.content : null,
      memoryType: c.memoryType,
      confidence: c.confidence,
      effectiveConfidence: c.effectiveConfidence,
      scope: c.scope,
      sourceType: c.sourceType,
      createdAt: c.createdAt,
      lastReinforcedAt: c.lastReinforcedAt,
      score: c.score,
      scoreBreakdown: c.scoreBreakdown,
    });

    if (this.vecAvailable && this.embeddingClient.enabled) {
      searchMode = 'hybrid';

      // Fire FTS5 + embed in parallel
      const [ftsCandidates, embeddings] = await Promise.all([
        Promise.resolve(searchFts5(this.db, queryText, ftsFilters)),
        this.embeddingClient.embed([queryText]),
      ]);

      const queryEmbedding = embeddings[0];
      const vecCandidates = queryEmbedding
        ? searchVec(this.db, queryEmbedding, limit * 3)
        : [];

      const scored = rerankAndMerge(ftsCandidates, vecCandidates, rerankParams);
      results = scored.slice(0, limit).map(mapResult);
    } else {
      const ftsCandidates = searchFts5(this.db, queryText, ftsFilters);
      const scored = rerankAndMerge(ftsCandidates, [], rerankParams);
      results = scored.slice(0, limit).map(mapResult);
    }

    const latencyMs = performance.now() - start;

    return {
      results,
      query: queryText,
      totalCandidates: results.length,
      latencyMs,
      searchMode,
    };
  }

  storeMemory(input: {
    description: string;
    classification: string;
    sourceType: string;
    content: string;
    confidence: number;
    scope: string;
    memoryType?: MemoryType;
    sourceRef?: string;
    sourceRefType?: string;
  }): { memoryId: string; embedded: boolean } {
    const memoryType = input.memoryType ?? classifyMemoryType(input.sourceType, input.content);
    const dedupKey = computeDedupKey(input.description, input.content, input.scope);
    const now = new Date().toISOString();

    // Check existing by dedup_key — reinforce instead
    const existing = this.db.prepare('SELECT id, confidence FROM memories WHERE dedup_key = ?').get(dedupKey) as { id: string; confidence: number } | undefined;

    if (existing) {
      const newConfidence = computeReinforcedConfidence(existing.confidence);
      this.db.prepare('UPDATE memories SET confidence = ?, last_reinforced_at = ? WHERE id = ?').run(newConfidence, now, existing.id);
      this.db.prepare("INSERT INTO memory_events (id, memory_id, type, payload, created_at) VALUES (?, ?, 'reinforced', '{}', ?)").run(randomUUID(), existing.id, now);
      return { memoryId: existing.id, embedded: false };
    }

    // Redact content
    const { text: redactedContent } = redactText(input.content);

    const memoryId = randomUUID();

    // INSERT into memories
    const insertStmt = this.db.prepare(
      'INSERT INTO memories (id, description, classification, source_type, content, confidence, scope, memory_type, dedup_key, last_reinforced_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const result = insertStmt.run(memoryId, input.description, input.classification, input.sourceType, redactedContent, input.confidence, input.scope, memoryType, dedupKey, now, now);
    const rowid = Number(result.lastInsertRowid);

    // Sync FTS insert
    syncFtsInsert(this.db, rowid, input.description, redactedContent);

    // Insert memory_sources if sourceRef
    if (input.sourceRef) {
      this.db.prepare('INSERT INTO memory_sources (id, memory_id, source_type, source_ref, created_at) VALUES (?, ?, ?, ?, ?)').run(
        randomUUID(),
        memoryId,
        input.sourceRefType ?? input.sourceType,
        input.sourceRef,
        now,
      );
    }

    // Record memory_events
    this.db.prepare("INSERT INTO memory_events (id, memory_id, type, payload, created_at) VALUES (?, ?, 'created', '{}', ?)").run(randomUUID(), memoryId, now);

    // If embeddable and vec available: generate embedding, insert vec
    let embedded = false;
    if (input.classification === 'embeddable' && this.vecAvailable && this.embeddingClient.enabled) {
      // Embedding is async — we handle it synchronously for the store call via a flag
      // The caller should handle async embedding separately if needed
      embedded = false; // Will be set true after async embed
    }

    return { memoryId, embedded };
  }

  async storeMemoryWithEmbedding(input: {
    description: string;
    classification: string;
    sourceType: string;
    content: string;
    confidence: number;
    scope: string;
    memoryType?: MemoryType;
    sourceRef?: string;
    sourceRefType?: string;
  }): Promise<{ memoryId: string; embedded: boolean }> {
    const result = this.storeMemory(input);

    if (input.classification === 'embeddable' && this.vecAvailable && this.embeddingClient.enabled) {
      try {
        const embeddings = await this.embeddingClient.embed([input.content]);
        const embedding = embeddings[0];
        if (embedding) {
          insertVecEmbedding(this.db, result.memoryId, embedding);
          return { memoryId: result.memoryId, embedded: true };
        }
      } catch {
        // Embedding failure is non-fatal
      }
    }

    return result;
  }

  getMemoryContent(memoryId: string): MemoryRecord | null {
    const row = this.db.prepare(
      'SELECT id, description, classification, source_type, content, confidence, scope, memory_type, dedup_key, last_reinforced_at, archived_at, created_at FROM memories WHERE id = ?',
    ).get(memoryId) as {
      id: string;
      description: string;
      classification: string;
      source_type: string;
      content: string;
      confidence: number;
      scope: string;
      memory_type: string;
      dedup_key: string | null;
      last_reinforced_at: string | null;
      archived_at: string | null;
      created_at: string;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      description: row.description,
      classification: row.classification as MemoryRecord['classification'],
      sourceType: row.source_type as MemoryRecord['sourceType'],
      content: row.content,
      confidence: row.confidence,
      scope: row.scope,
      sourceRunId: null,
      sourceTimestamp: null,
      memoryType: row.memory_type as MemoryRecord['memoryType'],
      dedupKey: row.dedup_key,
      lastReinforcedAt: row.last_reinforced_at,
      archivedAt: row.archived_at,
      createdAt: row.created_at,
    };
  }

  syncFtsInsert(rowid: number, description: string, content: string): void {
    syncFtsInsert(this.db, rowid, description, content);
  }

  syncFtsDelete(rowid: number, description: string, content: string): void {
    syncFtsDelete(this.db, rowid, description, content);
  }

  insertVecEmbedding(memoryId: string, embedding: Float32Array): void {
    insertVecEmbedding(this.db, memoryId, embedding);
  }

  deleteVecEmbedding(memoryId: string): void {
    deleteVecEmbedding(this.db, memoryId);
  }
}
