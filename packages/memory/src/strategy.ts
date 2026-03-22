import type { QueryStrategy } from '@popeye/contracts';
export type { QueryStrategy };

export interface ScoringWeights {
  relevance: number;
  recency: number;
  confidence: number;
  scopeMatch: number;
  sourceTrust?: number | undefined;
  salience?: number | undefined;
  latestness?: number | undefined;
  evidenceDensity?: number | undefined;
  operatorBonus?: number | undefined;
  layerPrior?: number | undefined;
}

const FACTUAL_PATTERNS = /\b(what is|who is|what's|who's|tell me about|whose name|birthday|email address)\b/i;
const TEMPORAL_PATTERNS = /\b(yesterday|today|last week|last month|recently|when did|this morning|this week|latest|newest)\b/i;
const PROCEDURAL_PATTERNS = /\b(how to|how do i|how can i|steps to|process for|workflow|guide|tutorial)\b/i;
const PROJECT_STATE_PATTERNS = /\b(project status|current state|what state|project progress)\b/i;
const PROFILE_PATTERNS = /\b(my profile|about me|my preferences|who am i)\b/i;
const AUDIT_PATTERNS = /\b(why was|how was|explain recall|show evidence|audit|provenance)\b/i;

export function classifyQueryStrategy(query: string): QueryStrategy {
  if (TEMPORAL_PATTERNS.test(query)) return 'temporal';
  if (PROCEDURAL_PATTERNS.test(query)) return 'procedural';
  if (PROJECT_STATE_PATTERNS.test(query)) return 'project_state';
  if (PROFILE_PATTERNS.test(query)) return 'profile';
  if (AUDIT_PATTERNS.test(query)) return 'audit';
  if (FACTUAL_PATTERNS.test(query)) return 'factual';
  return 'exploratory';
}

const STRATEGY_WEIGHTS: Record<QueryStrategy, ScoringWeights> = {
  factual:       { relevance: 0.35, recency: 0.10, confidence: 0.40, scopeMatch: 0.15 },
  temporal:      { relevance: 0.30, recency: 0.45, confidence: 0.10, scopeMatch: 0.15 },
  procedural:    { relevance: 0.50, recency: 0.10, confidence: 0.25, scopeMatch: 0.15 },
  exploratory:   { relevance: 0.40, recency: 0.25, confidence: 0.20, scopeMatch: 0.15 },
  project_state: { relevance: 0.25, recency: 0.30, confidence: 0.15, scopeMatch: 0.15, salience: 0.10, latestness: 0.05 },
  profile:       { relevance: 0.20, recency: 0.05, confidence: 0.20, scopeMatch: 0.15, salience: 0.15, latestness: 0.10, layerPrior: 0.10, operatorBonus: 0.05 },
  audit:         { relevance: 0.35, recency: 0.10, confidence: 0.15, scopeMatch: 0.15, evidenceDensity: 0.15, sourceTrust: 0.10 },
};

export function getStrategyWeights(strategy: QueryStrategy): ScoringWeights {
  return STRATEGY_WEIGHTS[strategy] ?? STRATEGY_WEIGHTS.exploratory;
}
