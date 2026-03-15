import type { QueryStrategy } from '@popeye/contracts';
export type { QueryStrategy };

export interface ScoringWeights {
  relevance: number;
  recency: number;
  confidence: number;
  scopeMatch: number;
  entityBoost: number;
}

const FACTUAL_PATTERNS = /\b(what is|who is|what's|who's|tell me about|whose name|birthday|email address)\b/i;
const TEMPORAL_PATTERNS = /\b(yesterday|today|last week|last month|recently|when did|this morning|this week|latest|newest)\b/i;
const PROCEDURAL_PATTERNS = /\b(how to|how do i|how can i|steps to|process for|workflow|guide|tutorial)\b/i;

export function classifyQueryStrategy(query: string): QueryStrategy {
  if (TEMPORAL_PATTERNS.test(query)) return 'temporal';
  if (PROCEDURAL_PATTERNS.test(query)) return 'procedural';
  if (FACTUAL_PATTERNS.test(query)) return 'factual';
  return 'exploratory';
}

const STRATEGY_WEIGHTS: Record<QueryStrategy, ScoringWeights> = {
  factual:     { relevance: 0.30, recency: 0.10, confidence: 0.40, scopeMatch: 0.15, entityBoost: 0.05 },
  temporal:    { relevance: 0.30, recency: 0.45, confidence: 0.10, scopeMatch: 0.15, entityBoost: 0.00 },
  procedural:  { relevance: 0.45, recency: 0.10, confidence: 0.25, scopeMatch: 0.15, entityBoost: 0.05 },
  exploratory: { relevance: 0.40, recency: 0.25, confidence: 0.20, scopeMatch: 0.15, entityBoost: 0.00 },
};

export function getStrategyWeights(strategy: QueryStrategy): ScoringWeights {
  return STRATEGY_WEIGHTS[strategy];
}
