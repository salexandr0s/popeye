export type TokenRiskLevel = 'low' | 'moderate' | 'high';
export type ExpansionRoute = 'answer_directly' | 'expand_shallow' | 'expand_deep';

export interface ExpansionPolicyResult {
  risk: TokenRiskLevel;
  route: ExpansionRoute;
  recommendedLimit: number;
  warning?: string;
}

interface ExpansionPolicyConfig {
  lowLimit?: number;
  moderateLimit?: number;
  highLimit?: number;
}

const BROAD_TIME_PATTERNS = [
  /\beverything\s+from\b/i,
  /\ball\s+of\s+(last|this)\s+(month|week|year|quarter)\b/i,
  /\bsince\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  /\bhistory\s+of\b/i,
  /\ball\s+memories?\b/i,
  /\bevery\s+(memory|record|entry)\b/i,
];

const MULTI_HOP_PATTERNS = [
  /\bhow\s+did\s+.+\s+relate\s+to\b/i,
  /\btrace\s+(the\s+)?history\b/i,
  /\bconnection\s+between\b/i,
  /\bwhat\s+led\s+to\b/i,
  /\btimeline\s+of\b/i,
  /\bevolution\s+of\b/i,
];

const EXHAUSTIVE_PATTERNS = [
  /^\s*all\s*$/i,
  /^\s*every\s*$/i,
  /^\s*everything\s*$/i,
  /^\s*\*\s*$/,
];

/**
 * Classify the expansion policy for a memory query.
 *
 * Determines token risk level and recommended retrieval strategy
 * based on query structure and intent patterns.
 */
export function classifyExpansionPolicy(
  query: string,
  config?: ExpansionPolicyConfig,
): ExpansionPolicyResult {
  const lowLimit = config?.lowLimit ?? 20;
  const moderateLimit = config?.moderateLimit ?? 5;
  const highLimit = config?.highLimit ?? 5;

  const trimmed = query.trim();

  // Very short queries are high-risk (too broad)
  if (trimmed.length <= 3 && trimmed.length > 0) {
    return {
      risk: 'high',
      route: 'expand_deep',
      recommendedLimit: highLimit,
      warning: 'Very short query — results may be broad. Consider a more specific query.',
    };
  }

  // Exhaustive/wildcard patterns
  if (EXHAUSTIVE_PATTERNS.some((p) => p.test(trimmed))) {
    return {
      risk: 'high',
      route: 'expand_deep',
      recommendedLimit: highLimit,
      warning: 'Exhaustive query detected — returning limited results to avoid context overflow.',
    };
  }

  // Multi-hop detection (check before broad time — multi-hop is more specific)
  if (MULTI_HOP_PATTERNS.some((p) => p.test(trimmed))) {
    return {
      risk: 'moderate',
      route: 'expand_shallow',
      recommendedLimit: moderateLimit,
    };
  }

  // Broad time range detection
  if (BROAD_TIME_PATTERNS.some((p) => p.test(trimmed))) {
    return {
      risk: 'high',
      route: 'expand_deep',
      recommendedLimit: highLimit,
      warning: 'Broad time range detected — results may be large. Consider narrowing the time range.',
    };
  }

  // Default: specific/narrow query
  return {
    risk: 'low',
    route: 'answer_directly',
    recommendedLimit: lowLimit,
  };
}
