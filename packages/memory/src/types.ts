/**
 * Local type definitions for memory package.
 * These types are defined here because the contracts package may not include
 * all memory-specific schemas yet.
 */

export type MemoryType = 'episodic' | 'semantic' | 'procedural';

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
