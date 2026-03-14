/**
 * Type definitions for the memory package.
 *
 * MemorySearchResult and MemorySearchResponse are the single source of truth
 * from @popeye/contracts. MemoryRecord remains local because the internal
 * field shapes (loose classification union) diverge from the contract schema.
 */

export type { MemoryType, MemorySearchResult, MemorySearchResponse } from '@popeye/contracts';

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
  memoryType: 'episodic' | 'semantic' | 'procedural';
  dedupKey: string | null;
  lastReinforcedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
}
