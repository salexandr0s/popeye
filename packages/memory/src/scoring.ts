import type { MemoryType } from './types.js';

import { computeConfidenceDecay, computeRecencyScore, computeScopeMatchScore, normalizeRelevanceScore } from './pure-functions.js';
import type { FtsCandidate } from './fts5-search.js';
import type { VecCandidate } from './vec-search.js';

export interface ScoredCandidate {
  memoryId: string;
  description: string;
  content: string;
  memoryType: MemoryType;
  confidence: number;
  effectiveConfidence: number;
  scope: string;
  sourceType: string;
  createdAt: string;
  lastReinforcedAt: string | null;
  score: number;
  scoreBreakdown: {
    relevance: number;
    recency: number;
    confidence: number;
    scopeMatch: number;
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
  sourceType: string;
  createdAt: string;
  lastReinforcedAt: string | null;
}

export function rerankAndMerge(
  ftsCandidates: FtsCandidate[],
  vecCandidates: VecCandidate[],
  params: { halfLifeDays: number; queryScope?: string; now?: Date; vecOnlyMetadata?: Map<string, VecOnlyMetadata> },
): ScoredCandidate[] {
  const now = params.now ?? new Date();

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
    const relevance = Math.max(ftsRelevance, vecRelevance);

    const recency = computeRecencyScore(meta.createdAt, now);

    const referenceDate = meta.lastReinforcedAt ?? meta.createdAt;
    const daysSinceReinforcement = (now.getTime() - new Date(referenceDate).getTime()) / (1000 * 60 * 60 * 24);
    const effectiveConfidence = computeConfidenceDecay(meta.confidence, daysSinceReinforcement, params.halfLifeDays);

    const scopeMatch = computeScopeMatchScore(meta.scope, params.queryScope);

    const score = (0.4 * relevance) + (0.25 * recency) + (0.2 * effectiveConfidence) + (0.15 * scopeMatch);

    results.push({
      memoryId: meta.memoryId,
      description: meta.description,
      content: meta.content,
      memoryType: meta.memoryType,
      confidence: meta.confidence,
      effectiveConfidence,
      scope: meta.scope,
      sourceType: meta.sourceType,
      createdAt: meta.createdAt,
      lastReinforcedAt: meta.lastReinforcedAt,
      score,
      scoreBreakdown: {
        relevance,
        recency,
        confidence: effectiveConfidence,
        scopeMatch,
      },
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}
