import { z } from 'zod';
import { DataClassificationSchema } from './config.js';
import { DomainKindSchema, ContextReleasePolicySchema } from './domain.js';

export const MemoryTypeSchema = z.enum(['episodic', 'semantic', 'procedural']);
export type MemoryType = z.infer<typeof MemoryTypeSchema>;

export const MemoryLayerSchema = z.enum(['artifact', 'fact', 'synthesis', 'curated']);
export type MemoryLayer = z.infer<typeof MemoryLayerSchema>;

export const MemoryNamespaceKindSchema = z.enum(['global', 'workspace', 'project', 'communications', 'integration', 'coding']);
export type MemoryNamespaceKind = z.infer<typeof MemoryNamespaceKindSchema>;

export const MemoryFactKindSchema = z.enum(['event', 'preference', 'identity', 'procedure', 'relationship', 'state', 'summary']);
export type MemoryFactKind = z.infer<typeof MemoryFactKindSchema>;

export const MemorySynthesisKindSchema = z.enum(['daily', 'weekly', 'profile', 'procedure', 'project_state', 'profile_static', 'profile_dynamic']);
export type MemorySynthesisKind = z.infer<typeof MemorySynthesisKindSchema>;

export const MemoryRevisionRelationSchema = z.enum(['supersedes', 'confirmed_by']);
export type MemoryRevisionRelation = z.infer<typeof MemoryRevisionRelationSchema>;

export const RevisionStatusSchema = z.enum(['active', 'superseded']);
export type RevisionStatus = z.infer<typeof RevisionStatusSchema>;

export const EvidenceKindSchema = z.enum(['artifact', 'fact', 'synthesis']);

export const MemorySourceTypeSchema = z.enum([
  'receipt',
  'telegram',
  'daily_summary',
  'curated_memory',
  'workspace_doc',
  'compaction_flush',
  'capability_sync',
  'context_release',
  'file_doc',
  'coding_session',
  'code_review',
  'debug_session',
]);
export type MemorySourceType = z.infer<typeof MemorySourceTypeSchema>;

export const MemoryRelationTypeSchema = z.enum(['updates', 'extends', 'confirmed_by', 'contradicts', 'derives', 'related_to']);
export type MemoryRelationType = z.infer<typeof MemoryRelationTypeSchema>;

export const IngestionStatusSchema = z.enum(['ready', 'queued', 'processing', 'done', 'failed', 'deleted']);
export type IngestionStatus = z.infer<typeof IngestionStatusSchema>;

export const OperatorStatusSchema = z.enum(['normal', 'pinned', 'protected', 'rejected']);
export type OperatorStatus = z.infer<typeof OperatorStatusSchema>;

export const EmbeddingOwnerKindSchema = z.enum(['artifact_chunk', 'fact', 'synthesis']);
export type EmbeddingOwnerKind = z.infer<typeof EmbeddingOwnerKindSchema>;

export const EmbeddingStatusSchema = z.enum(['active', 'stale', 'deleted']);
export type EmbeddingStatus = z.infer<typeof EmbeddingStatusSchema>;

export const MemorySourceStreamRecordSchema = z.object({
  id: z.string(),
  stableKey: z.string(),
  providerKind: z.string(),
  sourceType: MemorySourceTypeSchema,
  externalId: z.string().nullable().default(null),
  namespaceId: z.string(),
  workspaceId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  title: z.string().nullable().default(null),
  canonicalUri: z.string().nullable().default(null),
  classification: DataClassificationSchema,
  contextReleasePolicy: ContextReleasePolicySchema.default('full'),
  trustTier: z.number().int().min(1).max(5).default(3),
  trustScore: z.number().min(0).max(1).default(0.7),
  ingestionStatus: IngestionStatusSchema.default('ready'),
  lastProcessedHash: z.string().nullable().default(null),
  lastSyncCursor: z.string().nullable().default(null),
  metadataJson: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable().default(null),
});
export type MemorySourceStreamRecord = z.infer<typeof MemorySourceStreamRecordSchema>;

export const MemoryArtifactChunkRecordSchema = z.object({
  id: z.string(),
  artifactId: z.string(),
  sourceStreamId: z.string().nullable().default(null),
  chunkIndex: z.number().int().nonnegative(),
  sectionPath: z.string().nullable().default(null),
  chunkKind: z.string(),
  text: z.string(),
  textHash: z.string(),
  tokenCount: z.number().int().nonnegative(),
  language: z.string().nullable().default(null),
  classification: DataClassificationSchema,
  contextReleasePolicy: ContextReleasePolicySchema.default('full'),
  createdAt: z.string(),
  updatedAt: z.string(),
  invalidatedAt: z.string().nullable().default(null),
  metadataJson: z.record(z.string(), z.unknown()).default({}),
});
export type MemoryArtifactChunkRecord = z.infer<typeof MemoryArtifactChunkRecordSchema>;

export const MemoryEmbeddingRecordSchema = z.object({
  id: z.string(),
  ownerKind: EmbeddingOwnerKindSchema,
  ownerId: z.string(),
  model: z.string(),
  dim: z.number().int().positive(),
  contentHash: z.string(),
  status: EmbeddingStatusSchema.default('active'),
  createdAt: z.string(),
  updatedAt: z.string(),
  embeddingVersion: z.string(),
  metadataJson: z.record(z.string(), z.unknown()).default({}),
});
export type MemoryEmbeddingRecord = z.infer<typeof MemoryEmbeddingRecordSchema>;

export const MemoryRelationRecordSchema = z.object({
  id: z.string(),
  relationType: MemoryRelationTypeSchema,
  sourceKind: z.string(),
  sourceId: z.string(),
  targetKind: z.string(),
  targetId: z.string(),
  confidence: z.number().min(0).max(1).default(1.0),
  createdBy: z.string(),
  reason: z.string().default(''),
  metadataJson: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string(),
});
export type MemoryRelationRecord = z.infer<typeof MemoryRelationRecordSchema>;

export const MemoryOperatorActionRecordSchema = z.object({
  id: z.string(),
  actionKind: z.string(),
  targetKind: z.string(),
  targetId: z.string(),
  reason: z.string().default(''),
  payloadJson: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string(),
});
export type MemoryOperatorActionRecord = z.infer<typeof MemoryOperatorActionRecordSchema>;

export const MemoryRecordSchema = z.object({
  id: z.string(),
  description: z.string(),
  classification: DataClassificationSchema,
  sourceType: MemorySourceTypeSchema,
  content: z.string(),
  confidence: z.number().min(0).max(1),
  scope: z.string().default('workspace'),
  workspaceId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  sourceRunId: z.string().nullable().default(null),
  sourceTimestamp: z.string().nullable().default(null),
  memoryType: MemoryTypeSchema.default('episodic'),
  dedupKey: z.string().nullable().default(null),
  lastReinforcedAt: z.string().nullable().default(null),
  archivedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  durable: z.boolean().default(false),
  domain: DomainKindSchema.default('general'),
  contextReleasePolicy: ContextReleasePolicySchema.default('full'),
});
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;

export const MemoryNamespaceRecordSchema = z.object({
  id: z.string(),
  kind: MemoryNamespaceKindSchema,
  externalRef: z.string().nullable().default(null),
  label: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MemoryNamespaceRecord = z.infer<typeof MemoryNamespaceRecordSchema>;

export const MemoryArtifactRecordSchema = z.object({
  id: z.string(),
  sourceType: MemorySourceTypeSchema,
  classification: DataClassificationSchema,
  scope: z.string(),
  workspaceId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  namespaceId: z.string(),
  sourceRunId: z.string().nullable().default(null),
  sourceRef: z.string().nullable().default(null),
  sourceRefType: z.string().nullable().default(null),
  capturedAt: z.string(),
  occurredAt: z.string().nullable().default(null),
  content: z.string(),
  contentHash: z.string(),
  metadataJson: z.record(z.string(), z.unknown()).default({}),
  domain: DomainKindSchema.default('general'),
  // Phase 1 extensions (optional for backward compat with pre-migration reads)
  sourceStreamId: z.string().nullable().default(null),
  artifactVersion: z.number().int().positive().default(1),
  contextReleasePolicy: ContextReleasePolicySchema.default('full'),
  trustScore: z.number().min(0).max(1).default(0.7),
  invalidatedAt: z.string().nullable().default(null),
});
export type MemoryArtifactRecord = z.infer<typeof MemoryArtifactRecordSchema>;

export const MemoryFactRecordSchema = z.object({
  id: z.string(),
  namespaceId: z.string(),
  scope: z.string(),
  workspaceId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  classification: DataClassificationSchema,
  sourceType: MemorySourceTypeSchema,
  memoryType: MemoryTypeSchema,
  factKind: MemoryFactKindSchema,
  text: z.string(),
  confidence: z.number().min(0).max(1),
  sourceReliability: z.number().min(0).max(1),
  extractionConfidence: z.number().min(0).max(1),
  humanConfirmed: z.boolean().default(false),
  occurredAt: z.string().nullable().default(null),
  validFrom: z.string().nullable().default(null),
  validTo: z.string().nullable().default(null),
  sourceRunId: z.string().nullable().default(null),
  sourceTimestamp: z.string().nullable().default(null),
  dedupKey: z.string().nullable().default(null),
  lastReinforcedAt: z.string().nullable().default(null),
  archivedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  durable: z.boolean().default(false),
  revisionStatus: RevisionStatusSchema.default('active'),
  domain: DomainKindSchema.default('general'),
  // Phase 1 extensions (defaults match SQL NOT NULL DEFAULT values)
  rootFactId: z.string().nullable().default(null),
  parentFactId: z.string().nullable().default(null),
  isLatest: z.boolean().default(true),
  claimKey: z.string().nullable().default(null),
  salience: z.number().min(0).max(1).default(0.5),
  supportCount: z.number().int().nonnegative().default(1),
  sourceTrustScore: z.number().min(0).max(1).default(0.7),
  contextReleasePolicy: ContextReleasePolicySchema.default('full'),
  forgetAfter: z.string().nullable().default(null),
  staleAfter: z.string().nullable().default(null),
  expiredAt: z.string().nullable().default(null),
  invalidatedAt: z.string().nullable().default(null),
  operatorStatus: OperatorStatusSchema.default('normal'),
});
export type MemoryFactRecord = z.infer<typeof MemoryFactRecordSchema>;

export const MemorySynthesisRecordSchema = z.object({
  id: z.string(),
  namespaceId: z.string(),
  scope: z.string(),
  workspaceId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  classification: DataClassificationSchema,
  synthesisKind: MemorySynthesisKindSchema,
  title: z.string(),
  text: z.string(),
  confidence: z.number().min(0).max(1),
  refreshPolicy: z.string().default('manual'),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable().default(null),
  domain: DomainKindSchema.default('general'),
  // Phase 1 extensions (defaults match SQL NOT NULL DEFAULT values)
  subjectKind: z.string().nullable().default(null),
  subjectId: z.string().nullable().default(null),
  refreshDueAt: z.string().nullable().default(null),
  salience: z.number().min(0).max(1).default(0.5),
  qualityScore: z.number().min(0).max(1).default(0.7),
  contextReleasePolicy: ContextReleasePolicySchema.default('full'),
  invalidatedAt: z.string().nullable().default(null),
  operatorStatus: OperatorStatusSchema.default('normal'),
});
export type MemorySynthesisRecord = z.infer<typeof MemorySynthesisRecordSchema>;

export const MemoryRevisionRecordSchema = z.object({
  id: z.string(),
  relation: MemoryRevisionRelationSchema,
  sourceFactId: z.string(),
  targetFactId: z.string(),
  reason: z.string().default(''),
  createdAt: z.string(),
});
export type MemoryRevisionRecord = z.infer<typeof MemoryRevisionRecordSchema>;

export const EvidenceLinkSchema = z.object({
  id: z.string(),
  sourceKind: EvidenceKindSchema,
  sourceId: z.string(),
  targetKind: EvidenceKindSchema,
  targetId: z.string(),
  excerpt: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type EvidenceLink = z.infer<typeof EvidenceLinkSchema>;

export const TemporalConstraintSchema = z.object({
  label: z.string(),
  from: z.string().nullable().default(null),
  to: z.string().nullable().default(null),
});
export type TemporalConstraint = z.infer<typeof TemporalConstraintSchema>;

export const MemorySearchResultSchema = z.object({
  id: z.string(),
  description: z.string(),
  content: z.string().nullable(),
  type: z.string(),
  confidence: z.number(),
  effectiveConfidence: z.number(),
  scope: z.string(),
  workspaceId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  sourceType: z.string(),
  createdAt: z.string(),
  lastReinforcedAt: z.string().nullable(),
  score: z.number(),
  layer: MemoryLayerSchema.optional(),
  namespaceId: z.string().optional(),
  occurredAt: z.string().nullable().optional(),
  validFrom: z.string().nullable().optional(),
  validTo: z.string().nullable().optional(),
  evidenceCount: z.number().int().nonnegative().optional(),
  revisionStatus: RevisionStatusSchema.optional(),
  domain: DomainKindSchema.optional(),
  scoreBreakdown: z.object({
    relevance: z.number(),
    recency: z.number(),
    confidence: z.number(),
    scopeMatch: z.number(),
    entityBoost: z.number().optional(),
    temporalFit: z.number().optional(),
    sourceTrust: z.number().optional(),
    salience: z.number().optional(),
    latestness: z.number().optional(),
    evidenceDensity: z.number().optional(),
    operatorBonus: z.number().optional(),
    layerPrior: z.number().optional(),
  }),
});
export type MemorySearchResult = z.infer<typeof MemorySearchResultSchema>;

export const QueryStrategySchema = z.enum(['factual', 'temporal', 'procedural', 'exploratory', 'project_state', 'profile', 'audit']);
export type QueryStrategy = z.infer<typeof QueryStrategySchema>;

export const MemorySearchResponseSchema = z.object({
  results: z.array(MemorySearchResultSchema),
  query: z.string(),
  totalCandidates: z.number().int().nonnegative(),
  latencyMs: z.number().nonnegative(),
  searchMode: z.enum(['hybrid', 'fts_only', 'vec_only']),
  strategy: QueryStrategySchema.optional(),
  traceId: z.string().optional(),
});
export type MemorySearchResponse = z.infer<typeof MemorySearchResponseSchema>;

// Context assembly
export const ContextLayerItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  score: z.number(),
  tokenCount: z.number(),
  sourceType: z.string().optional(),
  occurredAt: z.string().nullable().optional(),
});
export type ContextLayerItem = z.infer<typeof ContextLayerItemSchema>;

export const ContextLayerSchema = z.object({
  layer: MemoryLayerSchema,
  items: z.array(ContextLayerItemSchema),
  totalTokens: z.number(),
});
export type ContextLayer = z.infer<typeof ContextLayerSchema>;

export const ContextAssemblyResultSchema = z.object({
  profileStatic: z.string().nullable(),
  profileDynamic: z.string().nullable(),
  layers: z.array(ContextLayerSchema),
  totalTokens: z.number(),
  budgetUsed: z.number(),
  budgetMax: z.number(),
  query: z.string(),
  strategy: QueryStrategySchema.optional(),
  traceId: z.string().optional(),
});
export type ContextAssemblyResult = z.infer<typeof ContextAssemblyResultSchema>;

export const ProfileContextResultSchema = z.object({
  staticProfile: z.string().nullable(),
  dynamicProfile: z.string().nullable(),
  totalTokens: z.number(),
});
export type ProfileContextResult = z.infer<typeof ProfileContextResultSchema>;

export const MemoryHistoryResultSchema = z.object({
  memoryId: z.string(),
  versionChain: z.array(z.object({
    factId: z.string(),
    text: z.string(),
    createdAt: z.string(),
    isLatest: z.boolean(),
    relation: z.string().optional(),
  })),
  evidenceLinks: z.array(z.object({
    artifactId: z.string(),
    excerpt: z.string().nullable(),
    createdAt: z.string(),
  })),
  operatorActions: z.array(z.object({
    actionKind: z.string(),
    reason: z.string(),
    createdAt: z.string(),
  })),
});
export type MemoryHistoryResult = z.infer<typeof MemoryHistoryResultSchema>;

export const RecallPlanSchema = z.object({
  query: z.string(),
  strategy: QueryStrategySchema,
  layers: z.array(MemoryLayerSchema).default([]),
  namespaceIds: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  temporalConstraint: TemporalConstraintSchema.nullable().default(null),
  includeEvidence: z.boolean().default(false),
  includeSuperseded: z.boolean().default(false),
});
export type RecallPlan = z.infer<typeof RecallPlanSchema>;

export const RecallExplanationSchema = z.object({
  query: z.string(),
  strategy: QueryStrategySchema,
  searchMode: z.enum(['hybrid', 'fts_only', 'vec_only']),
  memoryId: z.string(),
  layer: MemoryLayerSchema.optional(),
  score: z.number(),
  scoreBreakdown: MemorySearchResultSchema.shape.scoreBreakdown,
  filters: z.object({
    scope: z.string().nullable().default(null),
    workspaceId: z.string().nullable().default(null),
    projectId: z.string().nullable().default(null),
    includeGlobal: z.boolean().default(false),
    namespaceIds: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    includeSuperseded: z.boolean().default(false),
    temporalConstraint: TemporalConstraintSchema.nullable().default(null),
  }),
  result: MemorySearchResultSchema,
  evidence: z.array(EvidenceLinkSchema).default([]),
});
export type RecallExplanation = z.infer<typeof RecallExplanationSchema>;

export const MemoryAuditResponseSchema = z.object({
  totalMemories: z.number().int().nonnegative(),
  activeMemories: z.number().int().nonnegative(),
  archivedMemories: z.number().int().nonnegative(),
  byType: z.record(z.string(), z.number().int().nonnegative()),
  byScope: z.record(z.string(), z.number().int().nonnegative()),
  byClassification: z.record(z.string(), z.number().int().nonnegative()),
  averageConfidence: z.number().nonnegative(),
  staleCount: z.number().int().nonnegative(),
  consolidationsPerformed: z.number().int().nonnegative(),
  lastDecayRunAt: z.string().nullable(),
  lastConsolidationRunAt: z.string().nullable(),
  lastDailySummaryAt: z.string().nullable(),
});
export type MemoryAuditResponse = z.infer<typeof MemoryAuditResponseSchema>;

export const MemorySearchQuerySchema = z.object({
  query: z.string(),
  scope: z.string().optional(),
  workspaceId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  includeGlobal: z.boolean().optional(),
  memoryTypes: z.array(MemoryTypeSchema).optional(),
  layers: z.array(MemoryLayerSchema).optional(),
  namespaceIds: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  limit: z.number().int().positive().max(100).optional(),
  includeContent: z.boolean().optional(),
  includeEvidence: z.boolean().optional(),
  includeSuperseded: z.boolean().optional(),
  occurredAfter: z.string().optional(),
  occurredBefore: z.string().optional(),
  domains: z.array(DomainKindSchema).optional(),
  consumerProfile: z.string().optional(),
});
export type MemorySearchQuery = z.infer<typeof MemorySearchQuerySchema>;
