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

export function rerankAndMerge(
  ftsCandidates: FtsCandidate[],
  vecCandidates: VecCandidate[],
  params: { halfLifeDays: number; queryScope?: string; now?: Date },
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
    // We need the FTS candidate for metadata; skip if only vec without FTS data
    if (!fts) continue;

    const ftsRelevance = normalizeRelevanceScore(fts.ftsRank);
    const vecDistance = vecMap.get(id);
    const vecRelevance = vecDistance !== undefined ? 1 - vecDistance : 0;
    const relevance = Math.max(ftsRelevance, vecRelevance);

    const recency = computeRecencyScore(fts.createdAt, now);

    const referenceDate = fts.lastReinforcedAt ?? fts.createdAt;
    const daysSinceReinforcement = (now.getTime() - new Date(referenceDate).getTime()) / (1000 * 60 * 60 * 24);
    const effectiveConfidence = computeConfidenceDecay(fts.confidence, daysSinceReinforcement, params.halfLifeDays);

    const scopeMatch = computeScopeMatchScore(fts.scope, params.queryScope);

    const score = (0.4 * relevance) + (0.25 * recency) + (0.2 * effectiveConfidence) + (0.15 * scopeMatch);

    results.push({
      memoryId: fts.memoryId,
      description: fts.description,
      content: fts.content,
      memoryType: fts.memoryType,
      confidence: fts.confidence,
      effectiveConfidence,
      scope: fts.scope,
      sourceType: fts.sourceType,
      createdAt: fts.createdAt,
      lastReinforcedAt: fts.lastReinforcedAt,
      score,
      scoreBreakdown: {
        relevance,
        recency,
        confidence: effectiveConfidence,
        scopeMatch,
      },
    });
  }

  // Also handle vec-only candidates if they have metadata from a separate lookup
  // For now, vec-only candidates without FTS data are skipped (they lack metadata)

  results.sort((a, b) => b.score - a.score);
  return results;
}
