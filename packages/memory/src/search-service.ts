import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

import type { MemoryRecord, MemorySearchResponse, MemorySearchResult, MemoryType, StoreMemoryResult } from './types.js';
import { redactText } from '@popeye/observability';

import { assessMemoryQuality, classifyMemoryType, computeDedupKey, computeReinforcedConfidence, isDurableMemory, sanitizeSearchQuery } from './pure-functions.js';
import { extractEntities } from './entity-extraction.js';
import { applyBudgetAllocation, type BudgetConfig } from './budget-allocation.js';
import { classifyQueryStrategy, getStrategyWeights } from './strategy.js';
import type { EmbeddingClient } from './embedding-client.js';
import { searchFts5, syncFtsDelete, syncFtsInsert } from './fts5-search.js';
import { rerankAndMerge } from './scoring.js';
import type { ScoredCandidate, VecOnlyMetadata } from './scoring.js';
import { deleteVecEmbedding, insertVecEmbedding, searchVec } from './vec-search.js';

export class MemorySearchService {
  private readonly db: Database.Database;
  private readonly embeddingClient: EmbeddingClient;
  private readonly getVecAvailable: () => boolean;
  private readonly halfLifeDays: number;
  private readonly budgetConfig: BudgetConfig | undefined;

  constructor(opts: { db: Database.Database; embeddingClient: EmbeddingClient; vecAvailable: boolean | (() => boolean); halfLifeDays?: number; budgetConfig?: BudgetConfig | undefined }) {
    this.db = opts.db;
    this.embeddingClient = opts.embeddingClient;
    if (typeof opts.vecAvailable === 'function') {
      const getVecAvailable = opts.vecAvailable;
      this.getVecAvailable = () => getVecAvailable();
    } else {
      const vecAvailable = opts.vecAvailable;
      this.getVecAvailable = () => vecAvailable;
    }
    this.halfLifeDays = opts.halfLifeDays ?? 30;
    this.budgetConfig = opts.budgetConfig;
  }

  async search(query: {
    query: string;
    scope?: string;
    memoryTypes?: MemoryType[];
    minConfidence?: number;
    limit?: number;
    includeContent?: boolean;
  }): Promise<MemorySearchResponse> {
    const queryText = sanitizeSearchQuery(query.query);
    const minConfidence = query.minConfidence ?? 0.1;
    const limit = query.limit ?? 20;
    const includeContent = query.includeContent ?? false;
    const scope = query.scope;
    const memoryTypes = query.memoryTypes;

    const start = performance.now();

    const strategy = classifyQueryStrategy(queryText);
    const weights = getStrategyWeights(strategy);

    let searchMode: 'hybrid' | 'fts_only' | 'vec_only' = 'fts_only';
    let results: MemorySearchResult[];
    let totalCandidates = 0;

    const ftsFilters: { scope?: string; minConfidence?: number; memoryTypes?: MemoryType[]; limit?: number } = {
      minConfidence,
      limit: limit * 3, // Over-fetch for reranking
    };
    if (scope !== undefined) ftsFilters.scope = scope;
    if (memoryTypes !== undefined) ftsFilters.memoryTypes = memoryTypes;

    const rerankParams: { halfLifeDays: number; queryScope?: string } = { halfLifeDays: this.halfLifeDays };
    if (scope !== undefined) rerankParams.queryScope = scope;

    // Entity matching for query boost (batched lookup)
    const queryEntities = extractEntities(queryText);
    const entityMatches = new Map<string, number>();

    if (queryEntities.length > 0) {
      const conditions = queryEntities.map(() => '(canonical_name = ? AND entity_type = ?)').join(' OR ');
      const bindValues = queryEntities.flatMap((qe) => [qe.canonicalName, qe.type]);
      const entityRows = this.db.prepare(
        `SELECT id FROM memory_entities WHERE ${conditions}`,
      ).all(...bindValues) as Array<{ id: string }>;
      const entityIds = entityRows.map((r) => r.id);

      if (entityIds.length > 0) {
        const placeholders = entityIds.map(() => '?').join(',');
        const mentions = this.db.prepare(
          `SELECT memory_id, COUNT(*) as cnt FROM memory_entity_mentions WHERE entity_id IN (${placeholders}) GROUP BY memory_id`,
        ).all(...entityIds) as Array<{ memory_id: string; cnt: number }>;
        for (const m of mentions) {
          entityMatches.set(m.memory_id, m.cnt);
        }
      }
    }

    const mapResult = (c: ScoredCandidate): MemorySearchResult => ({
      id: c.memoryId,
      description: c.description,
      content: includeContent ? c.content : null,
      type: c.memoryType,
      confidence: c.confidence,
      effectiveConfidence: c.effectiveConfidence,
      scope: c.scope,
      sourceType: c.sourceType,
      createdAt: c.createdAt,
      lastReinforcedAt: c.lastReinforcedAt,
      score: c.score,
      scoreBreakdown: c.scoreBreakdown,
    });

    if (this.getVecAvailable() && this.embeddingClient.enabled) {
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

      // Pre-fetch metadata for vec-only candidates (not in FTS results)
      const ftsIds = new Set(ftsCandidates.map((c) => c.memoryId));
      const vecOnlyIds = vecCandidates.filter((v) => !ftsIds.has(v.memoryId)).map((v) => v.memoryId);
      const vecOnlyMetadata = new Map<string, VecOnlyMetadata>();
      if (vecOnlyIds.length > 0) {
        const placeholders = vecOnlyIds.map(() => '?').join(',');
        const rows = this.db
          .prepare(`SELECT id, description, content, memory_type, confidence, scope, source_type, created_at, last_reinforced_at, durable FROM memories WHERE id IN (${placeholders}) AND archived_at IS NULL`)
          .all(...vecOnlyIds) as Array<{ id: string; description: string; content: string; memory_type: string; confidence: number; scope: string; source_type: string; created_at: string; last_reinforced_at: string | null; durable: number }>;
        for (const row of rows) {
          vecOnlyMetadata.set(row.id, {
            memoryId: row.id,
            description: row.description,
            content: row.content,
            memoryType: row.memory_type as MemoryType,
            confidence: row.confidence,
            scope: row.scope,
            sourceType: row.source_type,
            createdAt: row.created_at,
            lastReinforcedAt: row.last_reinforced_at,
            durable: Boolean(row.durable),
          });
        }
      }

      const scored = rerankAndMerge(ftsCandidates, vecCandidates, { ...rerankParams, vecOnlyMetadata, weights, queryText, entityMatches });
      totalCandidates = scored.length;
      const limited = this.budgetConfig ? applyBudgetAllocation(scored, limit, this.budgetConfig) : scored.slice(0, limit);
      results = limited.map(mapResult);
    } else {
      const ftsCandidates = searchFts5(this.db, queryText, ftsFilters);
      const scored = rerankAndMerge(ftsCandidates, [], { ...rerankParams, weights, queryText, entityMatches });
      totalCandidates = scored.length;
      const limited = this.budgetConfig ? applyBudgetAllocation(scored, limit, this.budgetConfig) : scored.slice(0, limit);
      results = limited.map(mapResult);
    }

    const latencyMs = performance.now() - start;

    return {
      results,
      query: query.query,
      totalCandidates,
      latencyMs,
      searchMode,
      strategy,
    };
  }

  storeMemory(input: {
    description: string;
    classification: string;
    sourceType: string;
    content: string;
    confidence: number;
    scope: string;
    memoryType?: MemoryType | undefined;
    sourceRef?: string | undefined;
    sourceRefType?: string | undefined;
  }): StoreMemoryResult {
    const memoryType = input.memoryType ?? classifyMemoryType(input.sourceType, input.content);
    const dedupKey = computeDedupKey(input.description, input.content, input.scope);
    const now = new Date().toISOString();

    // Check existing by dedup_key — reinforce instead (skip quality gate for reinforcement)
    const existing = this.db.prepare('SELECT id, confidence FROM memories WHERE dedup_key = ?').get(dedupKey) as { id: string; confidence: number } | undefined;

    if (existing) {
      const newConfidence = computeReinforcedConfidence(existing.confidence);
      this.db.prepare('UPDATE memories SET confidence = ?, last_reinforced_at = ? WHERE id = ?').run(newConfidence, now, existing.id);
      this.db.prepare("INSERT INTO memory_events (id, memory_id, type, payload, created_at) VALUES (?, ?, 'reinforced', '{}', ?)").run(randomUUID(), existing.id, now);
      return { memoryId: existing.id, embedded: false };
    }

    // Quality gate — reject junk before new storage
    const quality = assessMemoryQuality(input.description, input.content);
    if (!quality.pass) {
      return { memoryId: '', embedded: false, rejected: true, rejectionReason: quality.reason };
    }

    // Redact content
    const { text: redactedContent } = redactText(input.content);

    const memoryId = randomUUID();
    const durable = isDurableMemory(redactedContent) ? 1 : 0;

    // INSERT into memories
    const insertStmt = this.db.prepare(
      'INSERT INTO memories (id, description, classification, source_type, content, confidence, scope, memory_type, dedup_key, last_reinforced_at, created_at, durable) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insertStmt.run(memoryId, input.description, input.classification, input.sourceType, redactedContent, input.confidence, input.scope, memoryType, dedupKey, now, now, durable);

    // Sync FTS insert
    syncFtsInsert(this.db, memoryId, input.description, redactedContent);

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

    // Extract and persist entity mentions (batched in transaction)
    const entities = extractEntities(redactedContent);
    if (entities.length > 0) {
      const persistEntities = this.db.transaction(() => {
        for (const entity of entities) {
          const existingEntity = this.db.prepare(
            'SELECT id FROM memory_entities WHERE canonical_name = ? AND entity_type = ?',
          ).get(entity.canonicalName, entity.type) as { id: string } | undefined;

          let entityId: string;
          if (existingEntity) {
            entityId = existingEntity.id;
          } else {
            entityId = randomUUID();
            this.db.prepare(
              'INSERT INTO memory_entities (id, name, entity_type, canonical_name, created_at) VALUES (?, ?, ?, ?, ?)',
            ).run(entityId, entity.name, entity.type, entity.canonicalName, now);
          }

          this.db.prepare(
            'INSERT INTO memory_entity_mentions (id, memory_id, entity_id, mention_count, created_at) VALUES (?, ?, ?, 1, ?)',
          ).run(randomUUID(), memoryId, entityId, now);
        }
      });
      persistEntities();
    }

    // If embeddable and vec available: generate embedding, insert vec
    let embedded = false;
    if (input.classification === 'embeddable' && this.getVecAvailable() && this.embeddingClient.enabled) {
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
    memoryType?: MemoryType | undefined;
    sourceRef?: string | undefined;
    sourceRefType?: string | undefined;
  }): Promise<StoreMemoryResult> {
    const result = this.storeMemory(input);
    if (result.rejected) return result;

    if (input.classification === 'embeddable' && this.getVecAvailable() && this.embeddingClient.enabled) {
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
      'SELECT id, description, classification, source_type, content, confidence, scope, memory_type, dedup_key, last_reinforced_at, archived_at, created_at, source_run_id, source_timestamp, durable FROM memories WHERE id = ?',
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
      source_run_id: string | null;
      source_timestamp: string | null;
      durable: number;
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
      sourceRunId: row.source_run_id ?? null,
      sourceTimestamp: row.source_timestamp ?? null,
      memoryType: row.memory_type as MemoryRecord['memoryType'],
      dedupKey: row.dedup_key,
      lastReinforcedAt: row.last_reinforced_at,
      archivedAt: row.archived_at,
      createdAt: row.created_at,
      durable: Boolean(row.durable),
    };
  }

  syncFtsInsert(memoryId: string, description: string, content: string): void {
    syncFtsInsert(this.db, memoryId, description, content);
  }

  syncFtsDelete(memoryId: string, description: string, content: string): void {
    syncFtsDelete(this.db, memoryId, description, content);
  }

  insertVecEmbedding(memoryId: string, embedding: Float32Array): void {
    insertVecEmbedding(this.db, memoryId, embedding);
  }

  deleteVecEmbedding(memoryId: string): void {
    deleteVecEmbedding(this.db, memoryId);
  }
}
