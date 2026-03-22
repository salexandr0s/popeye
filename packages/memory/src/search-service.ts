import type Database from 'better-sqlite3';

import type {
  MemoryRecord,
  MemorySearchResponse,
  MemorySearchResult,
  MemoryType,
  RecallExplanation,
} from './types.js';

import {
  classifyMemoryType,
  sanitizeSearchQuery,
} from './pure-functions.js';
import { applyBudgetAllocation, type BudgetConfig } from './budget-allocation.js';
import { classifyExpansionPolicy } from './expansion-policy.js';
import { getStrategyWeights } from './strategy.js';
import type { EmbeddingClient } from './embedding-client.js';
import { searchChunksFts5, searchFactsFts5, searchSynthesesFts5 } from './fts5-search.js';
import {
  matchesMemoryLocation,
  normalizeMemoryLocation,
  resolveMemoryLocationFilter,
  type MemoryLocationFilter,
} from './location.js';
import { rerankAndMerge } from './scoring.js';
import type { FactMetadata, ScoredCandidate } from './scoring.js';
import { buildRecallPlan } from './recall-planner.js';
import { buildRecallExplanation } from './recall-explainer.js';
import { applyConsumerProfile, getExcludedDomains } from './consumer-profiles.js';
import { buildRetrievalTrace, logRetrievalTrace } from './retrieval-logging.js';

export interface MemorySearchLogger {
  info(msg: string, details?: Record<string, unknown>): void;
  warn(msg: string, details?: Record<string, unknown>): void;
  error(msg: string, details?: Record<string, unknown>): void;
  debug(msg: string, details?: Record<string, unknown>): void;
}

export class MemorySearchService {
  private readonly db: Database.Database;
  private readonly embeddingClient: EmbeddingClient;
  private readonly halfLifeDays: number;
  private readonly budgetConfig: BudgetConfig | undefined;
  private readonly redactionPatterns: string[];
  private readonly logger: MemorySearchLogger | undefined;
  private readonly enableRetrievalLogging: boolean;

  constructor(opts: {
    db: Database.Database;
    embeddingClient: EmbeddingClient;
    halfLifeDays?: number;
    budgetConfig?: BudgetConfig | undefined;
    redactionPatterns?: string[] | undefined;
    logger?: MemorySearchLogger | undefined;
    enableRetrievalLogging?: boolean | undefined;
  }) {
    this.db = opts.db;
    this.embeddingClient = opts.embeddingClient;
    this.halfLifeDays = opts.halfLifeDays ?? 30;
    this.budgetConfig = opts.budgetConfig;
    this.redactionPatterns = opts.redactionPatterns ?? [];
    this.logger = opts.logger;
    this.enableRetrievalLogging = opts.enableRetrievalLogging ?? false;
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
    const profileQuery: { domains?: string[]; namespaceIds?: string[]; includeGlobal?: boolean } = {};
    if (query.domains !== undefined) profileQuery.domains = query.domains;
    if (query.namespaceIds !== undefined) profileQuery.namespaceIds = query.namespaceIds;
    if (query.includeGlobal !== undefined) profileQuery.includeGlobal = query.includeGlobal;
    const profileFilters = applyConsumerProfile(
      query.consumerProfile,
      profileQuery,
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
    let allScored: ScoredCandidate[] = [];
    const occurredAfter = query.occurredAfter ?? plan.temporalConstraint?.from ?? undefined;
    const occurredBefore = query.occurredBefore ?? plan.temporalConstraint?.to ?? undefined;

    const overfetch = limit * 3;
    const shouldSearchFacts = !layers || layers.length === 0 || layers.includes('fact');
    const shouldSearchSyntheses = !layers || layers.length === 0 || layers.includes('synthesis') || layers.includes('curated');
    const shouldSearchChunks = !layers || layers.length === 0 || layers.includes('artifact');

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

    const entityMatches = new Map<string, number>();

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
      domain: candidate.domain as MemorySearchResult['domain'],
      scoreBreakdown: candidate.scoreBreakdown,
    });

    const chunkFtsFilters = {
      ...(scopeAliasQuery ? { scope } : {}),
      ...(queryLocation !== undefined ? { workspaceId: queryLocation.workspaceId, projectId: queryLocation.projectId } : {}),
      ...(effectiveIncludeGlobal !== undefined ? { includeGlobal: effectiveIncludeGlobal } : {}),
      ...(domains !== undefined ? { domains } : {}),
      limit: overfetch,
    };

    const rawFtsCandidates = [
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
      ...(shouldSearchChunks ? searchChunksFts5(this.db, queryText, chunkFtsFilters) : []),
    ];

    // Apply domain exclusion post-filter (handles the assistant profile's excludedDomains
    // which cannot be expressed as a SQL inclusion filter)
    const ftsCandidates = excludedDomains.length > 0
      ? rawFtsCandidates.filter((c) => !c.domain || !excludedDomains.includes(c.domain))
      : rawFtsCandidates;

    // Build factMetadata for structured scoring signals
    const factMetadata = new Map<string, FactMetadata>();
    const factCandidateIds = ftsCandidates.filter((c) => c.layer === 'fact').map((c) => c.memoryId);
    if (factCandidateIds.length > 0) {
      const placeholders = factCandidateIds.map(() => '?').join(',');
      try {
        const rows = this.db.prepare(
          `SELECT id, is_latest, salience, support_count, source_trust_score, operator_status FROM memory_facts WHERE id IN (${placeholders})`,
        ).all(...factCandidateIds) as Array<{
          id: string;
          is_latest: number;
          salience: number;
          support_count: number;
          source_trust_score: number;
          operator_status: string;
        }>;
        for (const row of rows) {
          factMetadata.set(row.id, {
            isLatest: Boolean(row.is_latest),
            salience: row.salience,
            supportCount: row.support_count,
            sourceTrustScore: row.source_trust_score,
            operatorStatus: row.operator_status,
          });
        }
      } catch {
        // Phase 1 columns may not exist in test DBs — degrade gracefully
      }
    }

    allScored = rerankAndMerge(ftsCandidates, [], {
      ...rerankParams,
      weights,
      queryText,
      entityMatches,
      factMetadata,
    });
    totalCandidates = allScored.length;
    const limited = this.budgetConfig ? applyBudgetAllocation(allScored, limit, this.budgetConfig) : allScored.slice(0, limit);
    results = limited.map(mapResult);

    const latencyMs = performance.now() - start;

    let traceId: string | undefined;

    if (this.enableRetrievalLogging) {
      // Count candidates from the full pre-limit scored array
      const candidateCounts: Record<string, number> = { total: totalCandidates };
      for (const c of allScored) {
        const layer = c.layer ?? 'legacy';
        candidateCounts[layer] = (candidateCounts[layer] ?? 0) + 1;
      }

      const trace = buildRetrievalTrace({
        queryText: queryText,
        strategy: plan.strategy,
        filters: {
          scope: scope ?? null,
          workspaceId: queryLocation?.workspaceId ?? null,
          projectId: queryLocation?.projectId ?? null,
          includeGlobal: effectiveIncludeGlobal ?? false,
          searchMode,
          layers: layers ?? [],
          domains: domains ?? [],
        },
        candidateCounts,
        selected: results.map((r) => {
          const bd: Record<string, number> = {};
          for (const [k, v] of Object.entries(r.scoreBreakdown)) {
            if (v !== undefined) bd[k] = v;
          }
          return {
            id: r.id,
            layer: r.layer as string | undefined,
            score: r.score,
            scoreBreakdown: bd,
          };
        }),
        latencyMs,
      });

      traceId = trace.traceId;

      try {
        logRetrievalTrace(this.db, trace);
      } catch (err) {
        this.logger?.warn('Failed to log retrieval trace', { error: String(err) });
      }
    }

    return {
      results,
      query: query.query,
      totalCandidates,
      latencyMs,
      searchMode,
      strategy: plan.strategy,
      ...(traceId !== undefined ? { traceId } : {}),
    };
  }

  getMemoryContent(memoryId: string, locationFilter?: MemoryLocationFilter): MemoryRecord | null {
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
      ...(query.domains !== undefined && { domains: query.domains }),
      ...(query.consumerProfile !== undefined && { consumerProfile: query.consumerProfile }),
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
    sourceCount: number;
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
        sourceCount,
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
        sourceCount,
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
        sourceCount,
        layer: record.layer,
        namespaceId: record.namespaceId,
        evidenceCount: record.evidenceCount,
        revisionStatus: record.revisionStatus,
      };
    }

    return null;
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

}
