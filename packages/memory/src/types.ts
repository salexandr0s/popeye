/**
 * Local type definitions for memory package.
 *
 * MemoryType is re-exported from contracts. MemoryRecord, MemorySearchResult,
 * and MemorySearchResponse remain local because the internal field names
 * (memoryId vs id, loose sourceType) diverge from the contract schemas.
 */

import type { MemoryType as _MemoryType } from '@popeye/contracts';
export type MemoryType = _MemoryType;

export interface MemoryRecord {
  id: string;
  description: string;
  classification: 'secret' | 'sensitive' | 'internal' | 'embeddable';
  sourceType: string;
  content: string;
  confidence: number;
  scope: string;
  sourceRunId: string | null;
  sourceTimestamp: string | null;
  memoryType: MemoryType;
  dedupKey: string | null;
  lastReinforcedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
}

export interface MemorySearchResult {
  memoryId: string;
  description: string;
  content: string | null;
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

export interface MemorySearchResponse {
  results: MemorySearchResult[];
  query: string;
  totalCandidates: number;
  latencyMs: number;
  searchMode: 'hybrid' | 'fts_only' | 'vec_only';
}
