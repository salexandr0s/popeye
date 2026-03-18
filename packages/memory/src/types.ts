/**
 * Type definitions for the memory package.
 *
 * Contract schemas remain the source of truth for public shapes. The local
 * MemoryRecord shape is broader because the compatibility layer still serves
 * legacy `memories` rows while newer recall records can expose optional layered
 * metadata.
 */

export type {
  MemoryType,
  MemoryLayer,
  MemoryFactKind,
  MemorySynthesisKind,
  MemoryNamespaceRecord,
  MemoryArtifactRecord,
  MemoryFactRecord,
  MemorySynthesisRecord,
  MemoryRevisionRecord,
  MemorySearchResult,
  MemorySearchResponse,
  RecallExplanation,
  RecallPlan,
  TemporalConstraint,
  RevisionStatus,
} from '@popeye/contracts';

export interface MemoryRecord {
  id: string;
  description: string;
  classification: 'secret' | 'sensitive' | 'internal' | 'embeddable';
  sourceType: string;
  content: string;
  confidence: number;
  scope: string;
  workspaceId: string | null;
  projectId: string | null;
  sourceRunId: string | null;
  sourceTimestamp: string | null;
  memoryType: 'episodic' | 'semantic' | 'procedural';
  dedupKey: string | null;
  lastReinforcedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  durable: boolean;
  layer?: 'artifact' | 'fact' | 'synthesis' | 'curated' | undefined;
  namespaceId?: string | undefined;
  occurredAt?: string | null | undefined;
  validFrom?: string | null | undefined;
  validTo?: string | null | undefined;
  revisionStatus?: 'active' | 'superseded' | undefined;
  evidenceCount?: number | undefined;
}

export interface StoreMemoryResult {
  memoryId: string;
  embedded: boolean;
  rejected?: boolean | undefined;
  rejectionReason?: string | undefined;
}
