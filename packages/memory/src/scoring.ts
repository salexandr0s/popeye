import type { MemoryType } from './types.js';

import { computeConfidenceDecay, computeJaccardRelevance, computeRecencyScore, normalizeRelevanceScore } from './pure-functions.js';
import { computeLocationScopeMatchScore, type MemoryLocationFilter } from './location.js';
import type { FtsCandidate } from './fts5-search.js';
import type { VecCandidate } from './vec-search.js';
import type { ScoringWeights } from './strategy.js';
import type { TemporalConstraint } from './types.js';
import { chooseTemporalReference, computeTemporalFit } from './temporal.js';

export interface ScoredCandidate {
  memoryId: string;
  description: string;
  content: string;
  memoryType: MemoryType;
  confidence: number;
  effectiveConfidence: number;
  scope: string;
  workspaceId: string | null;
  projectId: string | null;
  sourceType: string;
  createdAt: string;
  lastReinforcedAt: string | null;
  durable: boolean;
  score: number;
  layer?: 'artifact' | 'fact' | 'synthesis' | 'curated' | undefined;
  namespaceId?: string | undefined;
  occurredAt?: string | null | undefined;
  validFrom?: string | null | undefined;
  validTo?: string | null | undefined;
  evidenceCount?: number | undefined;
  revisionStatus?: 'active' | 'superseded' | undefined;
  domain?: string | undefined;
  scoreBreakdown: {
    relevance: number;
    recency: number;
    confidence: number;
    scopeMatch: number;
    entityBoost?: number;
    temporalFit?: number;
  };
}

/** Pre-fetched metadata for vec-only candidates (not in FTS results). */
export interface VecOnlyMetadata {
  memoryId: string;
  description: string;
  content: string;
  memoryType: MemoryType;
  confidence: number;
  scope: string;
  workspaceId: string | null;
  projectId: string | null;
  sourceType: string;
  createdAt: string;
  lastReinforcedAt: string | null;
  durable: boolean;
  layer?: 'artifact' | 'fact' | 'synthesis' | 'curated' | undefined;
  namespaceId?: string | undefined;
  occurredAt?: string | null | undefined;
  validFrom?: string | null | undefined;
  validTo?: string | null | undefined;
  evidenceCount?: number | undefined;
  revisionStatus?: 'active' | 'superseded' | undefined;
  domain?: string | undefined;
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  relevance: 0.40,
  recency: 0.25,
  confidence: 0.20,
  scopeMatch: 0.15,
  entityBoost: 0.00,
};

export interface RerankParams {
  halfLifeDays: number;
  queryScope?: string | undefined;
  queryLocation?: MemoryLocationFilter | undefined;
  now?: Date | undefined;
  vecOnlyMetadata?: Map<string, VecOnlyMetadata> | undefined;
  weights?: ScoringWeights | undefined;
  queryText?: string | undefined;
  entityMatches?: Map<string, number> | undefined;
  temporalConstraint?: TemporalConstraint | null | undefined;
}

export function rerankAndMerge(
  ftsCandidates: FtsCandidate[],
  vecCandidates: VecCandidate[],
  params: RerankParams,
): ScoredCandidate[] {
  const now = params.now ?? new Date();
  const w = params.weights ?? DEFAULT_WEIGHTS;

  // Index FTS candidates by memoryId
  const ftsMap = new Map<string, FtsCandidate>();
  for (const c of ftsCandidates) {
    ftsMap.set(c.memoryId, c);
  }

  // Index vec distances by memoryId
  const vecMap = new Map<string, number>();
  for (const v of vecCandidates) {
    vecMap.set(v.memoryId, v.distance);
  }

  // Collect all unique memoryIds
  const allIds = new Set<string>([...ftsMap.keys(), ...vecMap.keys()]);

  const results: ScoredCandidate[] = [];

  for (const id of allIds) {
    const fts = ftsMap.get(id);
    const vecMeta = params.vecOnlyMetadata?.get(id);

    // Need metadata from FTS or pre-fetched vec-only metadata
    const meta = fts ?? vecMeta;
    if (!meta) continue;

    const ftsRelevance = fts ? normalizeRelevanceScore(fts.ftsRank) : 0;
    const vecDistance = vecMap.get(id);
    const vecRelevance = vecDistance !== undefined ? 1 - vecDistance : 0;

    // Jaccard fallback: when a candidate has FTS relevance but NO vec relevance and queryText is provided
    let relevance = Math.max(ftsRelevance, vecRelevance);
    if (ftsRelevance > 0 && vecDistance === undefined && params.queryText) {
      const jaccardRelevance = computeJaccardRelevance(params.queryText, meta.content) * 0.8;
      relevance = Math.max(ftsRelevance, jaccardRelevance);
    }

    const temporalReference = chooseTemporalReference({
      occurredAt: meta.occurredAt,
      validFrom: meta.validFrom,
      createdAt: meta.createdAt,
    });
    const recency = computeRecencyScore(temporalReference, now);
    const temporalFit = computeTemporalFit(temporalReference, params.temporalConstraint);
    const recencySignal = temporalFit > 0 ? Math.max(recency, temporalFit) : recency;

    const referenceDate = meta.lastReinforcedAt ?? meta.createdAt;
    const daysSinceReinforcement = (now.getTime() - new Date(referenceDate).getTime()) / (1000 * 60 * 60 * 24);
    const effectiveHalfLife = meta.durable ? params.halfLifeDays * 10 : params.halfLifeDays;
    const effectiveConfidence = computeConfidenceDecay(meta.confidence, daysSinceReinforcement, effectiveHalfLife);

    const scopeMatch = computeLocationScopeMatchScore(
      { workspaceId: meta.workspaceId, projectId: meta.projectId },
      params.queryLocation,
    );

    const entityMatchCount = params.entityMatches?.get(id) ?? 0;
    const entityBoostScore = Math.min(1, entityMatchCount / 3);

    const score = (w.relevance * relevance) + (w.recency * recencySignal) + (w.confidence * effectiveConfidence) + (w.scopeMatch * scopeMatch) + (w.entityBoost * entityBoostScore);

    const scoreBreakdown: ScoredCandidate['scoreBreakdown'] = {
      relevance,
      recency: recencySignal,
      confidence: effectiveConfidence,
      scopeMatch,
    };
    if (temporalFit > 0) {
      scoreBreakdown.temporalFit = temporalFit;
    }
    if (entityBoostScore > 0) {
      scoreBreakdown.entityBoost = entityBoostScore;
    }

    results.push({
      memoryId: meta.memoryId,
      description: meta.description,
      content: meta.content,
      memoryType: meta.memoryType,
      confidence: meta.confidence,
      effectiveConfidence,
      scope: meta.scope,
      workspaceId: meta.workspaceId,
      projectId: meta.projectId,
      sourceType: meta.sourceType,
      createdAt: meta.createdAt,
      lastReinforcedAt: meta.lastReinforcedAt,
      durable: meta.durable,
      layer: meta.layer,
      namespaceId: meta.namespaceId,
      occurredAt: meta.occurredAt,
      validFrom: meta.validFrom,
      validTo: meta.validTo,
      evidenceCount: meta.evidenceCount,
      revisionStatus: meta.revisionStatus,
      domain: meta.domain,
      score,
      scoreBreakdown,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}
