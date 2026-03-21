import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

import type {
  MemoryRecord,
  MemorySearchResponse,
  MemorySearchResult,
  MemoryType,
  RecallExplanation,
  StoreMemoryResult,
} from './types.js';
import { redactText } from '@popeye/observability';

import {
  assessMemoryQuality,
  classifyMemoryType,
  computeDedupKey,
  computeReinforcedConfidence,
  isDurableMemory,
  sanitizeSearchQuery,
} from './pure-functions.js';
import { extractEntities } from './entity-extraction.js';
import { applyBudgetAllocation, type BudgetConfig } from './budget-allocation.js';
import { classifyExpansionPolicy } from './expansion-policy.js';
import { getStrategyWeights } from './strategy.js';
import type { EmbeddingClient } from './embedding-client.js';
import { searchFactsFts5, searchFts5, searchSynthesesFts5, syncFtsDelete, syncFtsInsert } from './fts5-search.js';
import {
  canonicalizeMemoryLocation,
  matchesMemoryLocation,
  normalizeMemoryLocation,
  resolveMemoryLocationFilter,
  type MemoryLocationFilter,
} from './location.js';
import { rerankAndMerge } from './scoring.js';
import type { ScoredCandidate, VecOnlyMetadata } from './scoring.js';
import { deleteVecEmbedding, insertVecEmbedding, searchVec } from './vec-search.js';
import { buildRecallPlan } from './recall-planner.js';
import { buildRecallExplanation } from './recall-explainer.js';
import { applyConsumerProfile, getExcludedDomains } from './consumer-profiles.js';

export interface MemorySearchLogger {
  info(msg: string, details?: Record<string, unknown>): void;
  warn(msg: string, details?: Record<string, unknown>): void;
  error(msg: string, details?: Record<string, unknown>): void;
  debug(msg: string, details?: Record<string, unknown>): void;
}

export class MemorySearchService {
  private readonly db: Database.Database;
  private readonly embeddingClient: EmbeddingClient;
  private readonly getVecAvailable: () => boolean;
  private readonly halfLifeDays: number;
  private readonly budgetConfig: BudgetConfig | undefined;
  private readonly redactionPatterns: string[];
  private readonly logger: MemorySearchLogger | undefined;

  constructor(opts: {
    db: Database.Database;
    embeddingClient: EmbeddingClient;
    vecAvailable: boolean | (() => boolean);
    halfLifeDays?: number;
    budgetConfig?: BudgetConfig | undefined;
    redactionPatterns?: string[] | undefined;
    logger?: MemorySearchLogger | undefined;
  }) {
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
    this.redactionPatterns = opts.redactionPatterns ?? [];
    this.logger = opts.logger;
  }

  private buildQueryLocation(input: {
    scope?: string | undefined;
    workspaceId?: string | null | undefined;
    projectId?: string | null | undefined;
    includeGlobal?: boolean | undefined;
  }): MemoryLocationFilter | undefined {
    return resolveMemoryLocationFilter(input);
  }

  private isScopeAliasQuery(input: {
    scope?: string | undefined;
    workspaceId?: string | null | undefined;
    projectId?: string | null | undefined;
  }): boolean {
    return input.scope !== undefined && input.workspaceId === undefined && input.projectId === undefined;
  }

  async search(query: {
    query: string;
    scope?: string;
    workspaceId?: string | null;
    projectId?: string | null;
    includeGlobal?: boolean;
    memoryTypes?: MemoryType[];
    minConfidence?: number;
    limit?: number;
    includeContent?: boolean;
    layers?: Array<'artifact' | 'fact' | 'synthesis' | 'curated'> | undefined;
    namespaceIds?: string[] | undefined;
    tags?: string[] | undefined;
    includeSuperseded?: boolean | undefined;
    occurredAfter?: string | undefined;
    occurredBefore?: string | undefined;
    domains?: string[] | undefined;
    consumerProfile?: string | undefined;
  }): Promise<MemorySearchResponse> {
    const queryText = sanitizeSearchQuery(query.query);
    const minConfidence = query.minConfidence ?? 0.1;
    const limit = query.limit ?? 20;
    const includeContent = query.includeContent ?? false;
    const scope = query.scope;
    const memoryTypes = query.memoryTypes;
    const layers = query.layers;
    const tags = query.tags;
    const includeSuperseded = query.includeSuperseded ?? false;

    // Resolve consumer profile into filter defaults
    const profileFilters = applyConsumerProfile(
      query.consumerProfile,
      { domains: query.domains, namespaceIds: query.namespaceIds, includeGlobal: query.includeGlobal },
      this.db,
    );
    const domains = query.domains ?? profileFilters.domains;
    const namespaceIds = query.namespaceIds ?? profileFilters.namespaceIds;
    const excludedDomains = getExcludedDomains(query.consumerProfile);
    const effectiveIncludeGlobal = query.includeGlobal ?? profileFilters.includeGlobal;

    const queryLocation = this.buildQueryLocation({
      scope,
      workspaceId: query.workspaceId,
      projectId: query.projectId,
      includeGlobal: effectiveIncludeGlobal,
    });
    const scopeAliasQuery = this.isScopeAliasQuery(query);

    const start = performance.now();

    const plan = buildRecallPlan({
      query: queryText,
      layers,
      namespaceIds,
      tags,
      includeEvidence: false,
      includeSuperseded,
    });
    const weights = getStrategyWeights(plan.strategy);

    let searchMode: 'hybrid' | 'fts_only' | 'vec_only' = 'fts_only';
    let results: MemorySearchResult[];
    let totalCandidates = 0;
    const occurredAfter = query.occurredAfter ?? plan.temporalConstraint?.from ?? undefined;
    const occurredBefore = query.occurredBefore ?? plan.temporalConstraint?.to ?? undefined;

    const overfetch = limit * 3;
    const shouldSearchFacts = !layers || layers.length === 0 || layers.includes('fact');
    const shouldSearchSyntheses = !layers || layers.length === 0 || layers.includes('synthesis') || layers.includes('curated');
    const shouldSearchLegacy = !layers || layers.length === 0 || layers.some((layer) => layer !== 'artifact');

    const legacyFtsFilters = {
      ...(scopeAliasQuery ? { scope } : {}),
      ...(queryLocation !== undefined ? { workspaceId: queryLocation.workspaceId, projectId: queryLocation.projectId } : {}),
      ...(effectiveIncludeGlobal !== undefined ? { includeGlobal: effectiveIncludeGlobal } : {}),
      ...(memoryTypes !== undefined ? { memoryTypes } : {}),
      ...(domains !== undefined ? { domains } : {}),
      minConfidence,
      limit: overfetch,
    };

    const structuredFtsFilters = {
      ...(scopeAliasQuery ? { scope } : {}),
      ...(queryLocation !== undefined ? { workspaceId: queryLocation.workspaceId, projectId: queryLocation.projectId } : {}),
      ...(effectiveIncludeGlobal !== undefined ? { includeGlobal: effectiveIncludeGlobal } : {}),
      ...(memoryTypes !== undefined ? { memoryTypes } : {}),
      ...(namespaceIds !== undefined ? { namespaceIds } : {}),
      ...(tags !== undefined ? { tags } : {}),
      ...(domains !== undefined ? { domains } : {}),
      includeSuperseded,
      ...(occurredAfter !== undefined ? { occurredAfter } : {}),
      ...(occurredBefore !== undefined ? { occurredBefore } : {}),
      minConfidence,
      limit: overfetch,
    };

    const rerankParams: {
      halfLifeDays: number;
      queryScope?: string;
      temporalConstraint?: ReturnType<typeof buildRecallPlan>['temporalConstraint'];
      queryLocation?: {
        workspaceId: string | null;
        projectId: string | null;
        includeGlobal?: boolean;
      };
    } = {
      halfLifeDays: this.halfLifeDays,
      temporalConstraint: plan.temporalConstraint,
    };
    if (scopeAliasQuery && scope !== undefined) rerankParams.queryScope = scope;
    if (queryLocation) {
      rerankParams.queryLocation = {
        workspaceId: queryLocation.workspaceId,
        projectId: queryLocation.projectId,
        ...(queryLocation.includeGlobal !== undefined ? { includeGlobal: queryLocation.includeGlobal } : {}),
      };
    }

    const queryEntities = extractEntities(queryText);
    const entityMatches = new Map<string, number>();

    if (queryEntities.length > 0) {
      const conditions = queryEntities.map(() => '(canonical_name = ? AND entity_type = ?)').join(' OR ');
      const bindValues = queryEntities.flatMap((qe) => [qe.canonicalName, qe.type]);
      const entityRows = this.db.prepare(
        `SELECT id FROM memory_entities WHERE ${conditions}`,
      ).all(...bindValues) as Array<{ id: string }>;
      const entityIds = entityRows.map((row) => row.id);

      if (entityIds.length > 0) {
        const placeholders = entityIds.map(() => '?').join(',');
        const mentions = this.db.prepare(
          `SELECT memory_id, COUNT(*) as cnt FROM memory_entity_mentions WHERE entity_id IN (${placeholders}) GROUP BY memory_id`,
        ).all(...entityIds) as Array<{ memory_id: string; cnt: number }>;
        for (const mention of mentions) {
          entityMatches.set(mention.memory_id, mention.cnt);
        }
      }
    }

    const mapResult = (candidate: ScoredCandidate): MemorySearchResult => ({
      id: candidate.memoryId,
      description: candidate.description,
      content: includeContent ? candidate.content : null,
      type: candidate.memoryType,
      confidence: candidate.confidence,
      effectiveConfidence: candidate.effectiveConfidence,
      scope: candidate.scope,
      workspaceId: candidate.workspaceId,
      projectId: candidate.projectId,
      sourceType: candidate.sourceType,
      createdAt: candidate.createdAt,
      lastReinforcedAt: candidate.lastReinforcedAt,
      score: candidate.score,
      layer: candidate.layer,
      namespaceId: candidate.namespaceId,
      occurredAt: candidate.occurredAt,
      validFrom: candidate.validFrom,
      validTo: candidate.validTo,
      evidenceCount: candidate.evidenceCount,
      revisionStatus: candidate.revisionStatus,
      domain: candidate.domain,
      scoreBreakdown: candidate.scoreBreakdown,
    });

    const rawFtsCandidates = [
      ...(shouldSearchLegacy ? searchFts5(this.db, queryText, legacyFtsFilters) : []),
      ...(shouldSearchFacts ? searchFactsFts5(this.db, queryText, structuredFtsFilters) : []),
      ...(shouldSearchSyntheses ? searchSynthesesFts5(this.db, queryText, {
        ...(scopeAliasQuery ? { scope } : {}),
        ...(queryLocation !== undefined ? { workspaceId: queryLocation.workspaceId, projectId: queryLocation.projectId } : {}),
        ...(effectiveIncludeGlobal !== undefined ? { includeGlobal: effectiveIncludeGlobal } : {}),
        ...(namespaceIds !== undefined ? { namespaceIds } : {}),
        ...(tags !== undefined ? { tags } : {}),
        ...(domains !== undefined ? { domains } : {}),
        limit: overfetch,
        minConfidence,
      }) : []),
    ];

    // Apply domain exclusion post-filter (handles the assistant profile's excludedDomains
    // which cannot be expressed as a SQL inclusion filter)
    const ftsCandidates = excludedDomains.length > 0
      ? rawFtsCandidates.filter((c) => !c.domain || !excludedDomains.includes(c.domain))
      : rawFtsCandidates;

    if (this.getVecAvailable() && this.embeddingClient.enabled && shouldSearchLegacy) {
      searchMode = 'hybrid';
      const embeddings = await this.embeddingClient.embed([queryText]);
      const queryEmbedding = embeddings[0];
      const vecCandidates = queryEmbedding ? searchVec(this.db, queryEmbedding, overfetch) : [];

      const ftsIds = new Set(ftsCandidates.map((candidate) => candidate.memoryId));
      const vecOnlyIds = vecCandidates.filter((candidate) => !ftsIds.has(candidate.memoryId)).map((candidate) => candidate.memoryId);
      const vecOnlyMetadata = new Map<string, VecOnlyMetadata>();
      if (vecOnlyIds.length > 0) {
        const placeholders = vecOnlyIds.map(() => '?').join(',');
        const rows = this.db
          .prepare(`SELECT id, description, content, memory_type, confidence, scope, workspace_id, project_id, source_type, created_at, last_reinforced_at, durable, domain FROM memories WHERE id IN (${placeholders}) AND archived_at IS NULL`)
          .all(...vecOnlyIds) as Array<{
            id: string;
            description: string;
            content: string;
            memory_type: string;
            confidence: number;
            scope: string;
            workspace_id: string | null;
            project_id: string | null;
            source_type: string;
            created_at: string;
            last_reinforced_at: string | null;
            durable: number;
            domain: string | null;
          }>;
        for (const row of rows) {
          // Filter out vec-only results that don't match domain constraints
          if (domains && domains.length > 0 && row.domain && !domains.includes(row.domain)) continue;
          if (excludedDomains.length > 0 && row.domain && excludedDomains.includes(row.domain)) continue;
          vecOnlyMetadata.set(row.id, {
            memoryId: row.id,
            description: row.description,
            content: row.content,
            memoryType: row.memory_type as MemoryType,
            confidence: row.confidence,
            scope: row.scope,
            workspaceId: row.workspace_id,
            projectId: row.project_id,
            sourceType: row.source_type,
            createdAt: row.created_at,
            lastReinforcedAt: row.last_reinforced_at,
            durable: Boolean(row.durable),
            domain: row.domain ?? undefined,
          });
        }
      }

      const scored = rerankAndMerge(ftsCandidates, vecCandidates, {
        ...rerankParams,
        vecOnlyMetadata,
        weights,
        queryText,
        entityMatches,
      });
      totalCandidates = scored.length;
      const limited = this.budgetConfig ? applyBudgetAllocation(scored, limit, this.budgetConfig) : scored.slice(0, limit);
      results = limited.map(mapResult);
    } else {
      const scored = rerankAndMerge(ftsCandidates, [], {
        ...rerankParams,
        weights,
        queryText,
        entityMatches,
      });
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
      strategy: plan.strategy,
    };
  }

  storeMemory(input: {
    description: string;
    classification: string;
    sourceType: string;
    content: string;
    confidence: number;
    scope: string;
    workspaceId?: string | null;
    projectId?: string | null;
    memoryType?: MemoryType | undefined;
    sourceRef?: string | undefined;
    sourceRefType?: string | undefined;
  }): StoreMemoryResult {
    const location = canonicalizeMemoryLocation({
      scope: input.scope,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
    });
    const scopeValue = location.scope;
    const memoryType = input.memoryType ?? classifyMemoryType(input.sourceType, input.content);
    const dedupKey = computeDedupKey(input.description, input.content, scopeValue);
    const now = new Date().toISOString();

    const existing = this.db.prepare('SELECT id, confidence FROM memories WHERE dedup_key = ?').get(dedupKey) as { id: string; confidence: number } | undefined;

    if (existing) {
      const newConfidence = computeReinforcedConfidence(existing.confidence);
      this.db.prepare('UPDATE memories SET confidence = ?, last_reinforced_at = ? WHERE id = ?').run(newConfidence, now, existing.id);
      this.db.prepare("INSERT INTO memory_events (id, memory_id, type, payload, created_at) VALUES (?, ?, 'reinforced', '{}', ?)").run(randomUUID(), existing.id, now);
      return { memoryId: existing.id, embedded: false };
    }

    const quality = assessMemoryQuality(input.description, input.content);
    if (!quality.pass) {
      return { memoryId: '', embedded: false, rejected: true, rejectionReason: quality.reason };
    }

    const { text: redactedContent } = redactText(input.content, this.redactionPatterns);
    const memoryId = randomUUID();
    const durable = isDurableMemory(redactedContent) ? 1 : 0;

    this.db.prepare(
      'INSERT INTO memories (id, description, classification, source_type, content, confidence, scope, workspace_id, project_id, memory_type, dedup_key, last_reinforced_at, created_at, durable) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      memoryId,
      input.description,
      input.classification,
      input.sourceType,
      redactedContent,
      input.confidence,
      scopeValue,
      location.workspaceId,
      location.projectId,
      memoryType,
      dedupKey,
      now,
      now,
      durable,
    );

    syncFtsInsert(this.db, memoryId, input.description, redactedContent);

    if (input.sourceRef) {
      this.db.prepare('INSERT INTO memory_sources (id, memory_id, source_type, source_ref, created_at) VALUES (?, ?, ?, ?, ?)').run(
        randomUUID(),
        memoryId,
        input.sourceRefType ?? input.sourceType,
        input.sourceRef,
        now,
      );
    }

    this.db.prepare("INSERT INTO memory_events (id, memory_id, type, payload, created_at) VALUES (?, ?, 'created', '{}', ?)").run(randomUUID(), memoryId, now);

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

    return { memoryId, embedded: false };
  }

  async storeMemoryWithEmbedding(input: {
    description: string;
    classification: string;
    sourceType: string;
    content: string;
    confidence: number;
    scope: string;
    workspaceId?: string | null;
    projectId?: string | null;
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
        // Embedding failure is non-fatal.
      }
    }

    return result;
  }

  getMemoryContent(memoryId: string, locationFilter?: MemoryLocationFilter): MemoryRecord | null {
    const legacyRow = this.db.prepare(
      'SELECT id, description, classification, source_type, content, confidence, scope, workspace_id, project_id, memory_type, dedup_key, last_reinforced_at, archived_at, created_at, source_run_id, source_timestamp, durable, domain FROM memories WHERE id = ?',
    ).get(memoryId) as {
      id: string;
      description: string;
      classification: string;
      source_type: string;
      content: string;
      confidence: number;
      scope: string;
      workspace_id: string | null;
      project_id: string | null;
      memory_type: string;
      dedup_key: string | null;
      last_reinforced_at: string | null;
      archived_at: string | null;
      created_at: string;
      source_run_id: string | null;
      source_timestamp: string | null;
      durable: number;
      domain: string | null;
    } | undefined;

    if (legacyRow) {
      const record: MemoryRecord = {
        id: legacyRow.id,
        description: legacyRow.description,
        classification: legacyRow.classification as MemoryRecord['classification'],
        sourceType: legacyRow.source_type,
        content: legacyRow.content,
        confidence: legacyRow.confidence,
        scope: legacyRow.scope,
        workspaceId: legacyRow.workspace_id,
        projectId: legacyRow.project_id,
        sourceRunId: legacyRow.source_run_id ?? null,
        sourceTimestamp: legacyRow.source_timestamp ?? null,
        memoryType: legacyRow.memory_type as MemoryRecord['memoryType'],
        dedupKey: legacyRow.dedup_key,
        lastReinforcedAt: legacyRow.last_reinforced_at,
        archivedAt: legacyRow.archived_at,
        createdAt: legacyRow.created_at,
        durable: Boolean(legacyRow.durable),
        domain: legacyRow.domain ?? undefined,
      };
      return matchesMemoryLocation(record, locationFilter) ? record : null;
    }

    let artifactRow: {
      id: string;
      classification: string;
      source_type: string;
      content: string;
      scope: string;
      workspace_id: string | null;
      project_id: string | null;
      source_run_id: string | null;
      source_ref: string | null;
      source_ref_type: string | null;
      captured_at: string;
      occurred_at: string | null;
      namespace_id: string;
    } | undefined;
    try {
      artifactRow = this.db.prepare(
        `SELECT id, classification, source_type, content, scope, workspace_id, project_id, source_run_id, source_ref, source_ref_type, captured_at, occurred_at, namespace_id
         FROM memory_artifacts
         WHERE id = ?`,
      ).get(memoryId) as typeof artifactRow;
    } catch {
      artifactRow = undefined;
    }

    if (artifactRow) {
      const location = normalizeMemoryLocation({
        scope: artifactRow.scope,
        workspaceId: artifactRow.workspace_id,
        projectId: artifactRow.project_id,
      });
      const record: MemoryRecord = {
        id: artifactRow.id,
        description: artifactRow.content.slice(0, 160),
        classification: artifactRow.classification as MemoryRecord['classification'],
        sourceType: artifactRow.source_type,
        content: artifactRow.content,
        confidence: 1,
        scope: artifactRow.scope,
        workspaceId: location.workspaceId,
        projectId: location.projectId,
        sourceRunId: artifactRow.source_run_id,
        sourceTimestamp: artifactRow.captured_at,
        memoryType: classifyMemoryType(artifactRow.source_type, artifactRow.content),
        dedupKey: null,
        lastReinforcedAt: artifactRow.captured_at,
        archivedAt: null,
        createdAt: artifactRow.captured_at,
        durable: false,
        layer: 'artifact',
        namespaceId: artifactRow.namespace_id,
        occurredAt: artifactRow.occurred_at,
      };
      return matchesMemoryLocation(record, locationFilter) ? record : null;
    }

    let factRow: {
      id: string;
      classification: string;
      source_type: string;
      text: string;
      confidence: number;
      scope: string;
      workspace_id: string | null;
      project_id: string | null;
      memory_type: string;
      dedup_key: string | null;
      last_reinforced_at: string | null;
      archived_at: string | null;
      created_at: string;
      source_run_id: string | null;
      source_timestamp: string | null;
      durable: number;
      namespace_id: string;
      occurred_at: string | null;
      valid_from: string | null;
      valid_to: string | null;
      revision_status: 'active' | 'superseded';
      evidence_count: number;
    } | undefined;
    try {
      factRow = this.db.prepare(
        `SELECT id, classification, source_type, text, confidence, scope, workspace_id, project_id, memory_type, dedup_key, last_reinforced_at, archived_at, created_at,
                source_run_id, source_timestamp, durable, namespace_id, occurred_at, valid_from, valid_to, revision_status,
                (SELECT COUNT(*) FROM memory_fact_sources WHERE fact_id = memory_facts.id) AS evidence_count
         FROM memory_facts
         WHERE id = ?`,
      ).get(memoryId) as typeof factRow;
    } catch {
      factRow = undefined;
    }

    if (factRow) {
      const location = normalizeMemoryLocation({
        scope: factRow.scope,
        workspaceId: factRow.workspace_id,
        projectId: factRow.project_id,
      });
      const record: MemoryRecord = {
        id: factRow.id,
        description: factRow.text.slice(0, 160),
        classification: factRow.classification as MemoryRecord['classification'],
        sourceType: factRow.source_type,
        content: factRow.text,
        confidence: factRow.confidence,
        scope: factRow.scope,
        workspaceId: location.workspaceId,
        projectId: location.projectId,
        sourceRunId: factRow.source_run_id,
        sourceTimestamp: factRow.source_timestamp,
        memoryType: factRow.memory_type as MemoryRecord['memoryType'],
        dedupKey: factRow.dedup_key,
        lastReinforcedAt: factRow.last_reinforced_at,
        archivedAt: factRow.archived_at,
        createdAt: factRow.created_at,
        durable: Boolean(factRow.durable),
        layer: 'fact',
        namespaceId: factRow.namespace_id,
        occurredAt: factRow.occurred_at,
        validFrom: factRow.valid_from,
        validTo: factRow.valid_to,
        revisionStatus: factRow.revision_status,
        evidenceCount: factRow.evidence_count,
      };
      return matchesMemoryLocation(record, locationFilter) ? record : null;
    }

    let synthesisRow: {
      id: string;
      classification: string;
      scope: string;
      workspace_id: string | null;
      project_id: string | null;
      title: string;
      text: string;
      confidence: number;
      created_at: string;
      updated_at: string;
      archived_at: string | null;
      namespace_id: string;
      evidence_count: number;
    } | undefined;
    try {
      synthesisRow = this.db.prepare(
        `SELECT id, classification, scope, workspace_id, project_id, title, text, confidence, created_at, updated_at, archived_at, namespace_id,
                (SELECT COUNT(*) FROM memory_synthesis_sources WHERE synthesis_id = memory_syntheses.id) AS evidence_count
         FROM memory_syntheses
         WHERE id = ?`,
      ).get(memoryId) as typeof synthesisRow;
    } catch {
      synthesisRow = undefined;
    }

    if (synthesisRow) {
      const location = normalizeMemoryLocation({
        scope: synthesisRow.scope,
        workspaceId: synthesisRow.workspace_id,
        projectId: synthesisRow.project_id,
      });
      const record: MemoryRecord = {
        id: synthesisRow.id,
        description: synthesisRow.title,
        classification: synthesisRow.classification as MemoryRecord['classification'],
        sourceType: 'curated_memory',
        content: synthesisRow.text,
        confidence: synthesisRow.confidence,
        scope: synthesisRow.scope,
        workspaceId: location.workspaceId,
        projectId: location.projectId,
        sourceRunId: null,
        sourceTimestamp: synthesisRow.updated_at,
        memoryType: 'semantic',
        dedupKey: null,
        lastReinforcedAt: synthesisRow.updated_at,
        archivedAt: synthesisRow.archived_at,
        createdAt: synthesisRow.created_at,
        durable: true,
        layer: 'synthesis',
        namespaceId: synthesisRow.namespace_id,
        evidenceCount: synthesisRow.evidence_count,
        revisionStatus: 'active',
      };
      return matchesMemoryLocation(record, locationFilter) ? record : null;
    }

    return null;
  }

  async explainRecall(input: {
    query: string;
    memoryId: string;
    scope?: string;
    workspaceId?: string | null;
    projectId?: string | null;
    includeGlobal?: boolean;
    memoryTypes?: MemoryType[];
    layers?: Array<'artifact' | 'fact' | 'synthesis' | 'curated'> | undefined;
    namespaceIds?: string[] | undefined;
    tags?: string[] | undefined;
    includeSuperseded?: boolean | undefined;
  }, locationFilter?: MemoryLocationFilter): Promise<RecallExplanation | null> {
    const effectiveLocationFilter = locationFilter ?? this.buildQueryLocation({
      scope: input.scope,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      includeGlobal: input.includeGlobal,
    });

    if (!this.getMemoryContent(input.memoryId, effectiveLocationFilter)) {
      return null;
    }

    const plan = buildRecallPlan({
      query: sanitizeSearchQuery(input.query),
      layers: input.layers,
      namespaceIds: input.namespaceIds,
      tags: input.tags,
      includeSuperseded: input.includeSuperseded,
    });

    const response = await this.search({
      query: input.query,
      ...(input.scope !== undefined ? { scope: input.scope } : {}),
      ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(input.includeGlobal !== undefined ? { includeGlobal: input.includeGlobal } : {}),
      ...(input.memoryTypes !== undefined ? { memoryTypes: input.memoryTypes } : {}),
      ...(input.layers !== undefined ? { layers: input.layers } : {}),
      ...(input.namespaceIds !== undefined ? { namespaceIds: input.namespaceIds } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.includeSuperseded !== undefined ? { includeSuperseded: input.includeSuperseded } : {}),
      includeContent: true,
      limit: 100,
    });

    const result = response.results.find((candidate: MemorySearchResult) => candidate.id === input.memoryId);
    if (!result) return null;

    return buildRecallExplanation({
      db: this.db,
      plan,
      searchMode: response.searchMode,
      result,
      scope: input.scope,
      workspaceId: effectiveLocationFilter?.workspaceId ?? null,
      projectId: effectiveLocationFilter?.projectId ?? null,
      includeGlobal: effectiveLocationFilter?.includeGlobal ?? false,
      tags: input.tags,
      namespaceIds: input.namespaceIds,
      includeSuperseded: input.includeSuperseded,
    });
  }

  async budgetFit(query: {
    query: string;
    scope?: string;
    workspaceId?: string | null;
    projectId?: string | null;
    includeGlobal?: boolean;
    memoryTypes?: MemoryType[];
    minConfidence?: number;
    maxTokens: number;
    limit?: number;
    domains?: string[];
    consumerProfile?: string;
  }): Promise<{
    results: MemorySearchResult[];
    totalTokensUsed: number;
    totalTokensBudget: number;
    truncatedCount: number;
    droppedCount: number;
    expansionPolicy?: { risk: string; route: string; warning?: string };
  }> {
    const policy = classifyExpansionPolicy(query.query);
    const effectiveLimit = query.limit ?? policy.recommendedLimit;

    const searchResponse = await this.search({
      query: query.query,
      ...(query.scope !== undefined && { scope: query.scope }),
      ...(query.workspaceId !== undefined && { workspaceId: query.workspaceId }),
      ...(query.projectId !== undefined && { projectId: query.projectId }),
      ...(query.includeGlobal !== undefined && { includeGlobal: query.includeGlobal }),
      ...(query.memoryTypes !== undefined && { memoryTypes: query.memoryTypes }),
      ...(query.minConfidence !== undefined && { minConfidence: query.minConfidence }),
      limit: effectiveLimit,
      includeContent: true,
    });

    const maxTokens = query.maxTokens;
    const fitted: MemorySearchResult[] = [];
    let tokensUsed = 0;
    let truncatedCount = 0;
    let droppedCount = 0;

    for (const result of searchResponse.results) {
      const contentLen = result.content?.length ?? 0;
      const tokenEst = Math.ceil(contentLen / 4);

      if (tokensUsed + tokenEst <= maxTokens) {
        fitted.push(result);
        tokensUsed += tokenEst;
      } else if (tokensUsed < maxTokens) {
        const remaining = (maxTokens - tokensUsed) * 4;
        fitted.push({
          ...result,
          content: result.content ? result.content.slice(0, remaining) + '...' : null,
        });
        tokensUsed = maxTokens;
        truncatedCount++;
      } else {
        droppedCount++;
      }
    }

    return {
      results: fitted,
      totalTokensUsed: tokensUsed,
      totalTokensBudget: maxTokens,
      truncatedCount,
      droppedCount,
      expansionPolicy: {
        risk: policy.risk,
        route: policy.route,
        ...(policy.warning !== undefined && { warning: policy.warning }),
      },
    };
  }

  describeMemory(memoryId: string, locationFilter?: MemoryLocationFilter): {
    id: string;
    description: string;
    type: string;
    confidence: number;
    scope: string;
    workspaceId: string | null;
    projectId: string | null;
    sourceType: string;
    createdAt: string;
    lastReinforcedAt: string | null;
    durable: boolean;
    contentLength: number;
    entityCount: number;
    sourceCount: number;
    eventCount: number;
    layer?: 'artifact' | 'fact' | 'synthesis' | 'curated' | undefined;
    namespaceId?: string | undefined;
    evidenceCount?: number | undefined;
    revisionStatus?: 'active' | 'superseded' | undefined;
  } | null {
    const record = this.getMemoryContent(memoryId, locationFilter);
    if (!record) return null;

    if (record.layer === 'artifact') {
      const sourceCount = (this.db.prepare('SELECT COUNT(*) as c FROM memory_fact_sources WHERE artifact_id = ?').get(memoryId) as { c: number }).c;
      return {
        id: record.id,
        description: record.description,
        type: record.memoryType,
        confidence: record.confidence,
        scope: record.scope,
        workspaceId: record.workspaceId,
        projectId: record.projectId,
        sourceType: record.sourceType,
        createdAt: record.createdAt,
        lastReinforcedAt: record.lastReinforcedAt,
        durable: record.durable,
        contentLength: record.content.length,
        entityCount: 0,
        sourceCount,
        eventCount: 0,
        layer: record.layer,
        namespaceId: record.namespaceId,
      };
    }

    if (record.layer === 'fact') {
      const sourceCount = (this.db.prepare('SELECT COUNT(*) as c FROM memory_fact_sources WHERE fact_id = ?').get(memoryId) as { c: number }).c;
      return {
        id: record.id,
        description: record.description,
        type: record.memoryType,
        confidence: record.confidence,
        scope: record.scope,
        workspaceId: record.workspaceId,
        projectId: record.projectId,
        sourceType: record.sourceType,
        createdAt: record.createdAt,
        lastReinforcedAt: record.lastReinforcedAt,
        durable: record.durable,
        contentLength: record.content.length,
        entityCount: 0,
        sourceCount,
        eventCount: 0,
        layer: record.layer,
        namespaceId: record.namespaceId,
        evidenceCount: record.evidenceCount,
        revisionStatus: record.revisionStatus,
      };
    }

    if (record.layer === 'synthesis') {
      const sourceCount = (this.db.prepare('SELECT COUNT(*) as c FROM memory_synthesis_sources WHERE synthesis_id = ?').get(memoryId) as { c: number }).c;
      return {
        id: record.id,
        description: record.description,
        type: record.memoryType,
        confidence: record.confidence,
        scope: record.scope,
        workspaceId: record.workspaceId,
        projectId: record.projectId,
        sourceType: record.sourceType,
        createdAt: record.createdAt,
        lastReinforcedAt: record.lastReinforcedAt,
        durable: record.durable,
        contentLength: record.content.length,
        entityCount: 0,
        sourceCount,
        eventCount: 0,
        layer: record.layer,
        namespaceId: record.namespaceId,
        evidenceCount: record.evidenceCount,
        revisionStatus: record.revisionStatus,
      };
    }

    const entityCount = (this.db.prepare('SELECT COUNT(*) as c FROM memory_entity_mentions WHERE memory_id = ?').get(memoryId) as { c: number }).c;
    const sourceCount = (this.db.prepare('SELECT COUNT(*) as c FROM memory_sources WHERE memory_id = ?').get(memoryId) as { c: number }).c;
    const eventCount = (this.db.prepare('SELECT COUNT(*) as c FROM memory_events WHERE memory_id = ?').get(memoryId) as { c: number }).c;

    return {
      id: record.id,
      description: record.description,
      type: record.memoryType,
      confidence: record.confidence,
      scope: record.scope,
      workspaceId: record.workspaceId,
      projectId: record.projectId,
      sourceType: record.sourceType,
      createdAt: record.createdAt,
      lastReinforcedAt: record.lastReinforcedAt,
      durable: record.durable,
      contentLength: record.content.length,
      entityCount,
      sourceCount,
      eventCount,
    };
  }

  expandMemory(memoryId: string, maxTokens?: number, locationFilter?: MemoryLocationFilter): {
    id: string;
    content: string;
    tokenEstimate: number;
    truncated: boolean;
  } | null {
    const record = this.getMemoryContent(memoryId, locationFilter);
    if (!record) return null;

    const cap = maxTokens ?? 8000;
    const maxChars = cap * 4;
    const truncated = record.content.length > maxChars;
    const content = truncated ? record.content.slice(0, maxChars) + '...' : record.content;

    return {
      id: record.id,
      content,
      tokenEstimate: Math.ceil(content.length / 4),
      truncated,
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
