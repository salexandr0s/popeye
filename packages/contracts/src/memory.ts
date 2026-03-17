import { z } from 'zod';
import { DataClassificationSchema } from './config.js';
import { DomainKindSchema, ContextReleasePolicySchema } from './domain.js';

export const MemoryTypeSchema = z.enum(['episodic', 'semantic', 'procedural']);
export type MemoryType = z.infer<typeof MemoryTypeSchema>;

export const MemorySourceTypeSchema = z.enum([
  'receipt',
  'telegram',
  'daily_summary',
  'curated_memory',
  'workspace_doc',
  'compaction_flush',
  'capability_sync',
  'context_release',
]);
export type MemorySourceType = z.infer<typeof MemorySourceTypeSchema>;

export const MemoryRecordSchema = z.object({
  id: z.string(),
  description: z.string(),
  classification: DataClassificationSchema,
  sourceType: MemorySourceTypeSchema,
  content: z.string(),
  confidence: z.number().min(0).max(1),
  scope: z.string().default('workspace'),
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

export const MemorySearchResultSchema = z.object({
  id: z.string(),
  description: z.string(),
  content: z.string().nullable(),
  type: z.string(),
  confidence: z.number(),
  effectiveConfidence: z.number(),
  scope: z.string(),
  sourceType: z.string(),
  createdAt: z.string(),
  lastReinforcedAt: z.string().nullable(),
  score: z.number(),
  scoreBreakdown: z.object({
    relevance: z.number(),
    recency: z.number(),
    confidence: z.number(),
    scopeMatch: z.number(),
    entityBoost: z.number().optional(),
  }),
});
export type MemorySearchResult = z.infer<typeof MemorySearchResultSchema>;

export const QueryStrategySchema = z.enum(['factual', 'temporal', 'procedural', 'exploratory']);
export type QueryStrategy = z.infer<typeof QueryStrategySchema>;

export const MemorySearchResponseSchema = z.object({
  results: z.array(MemorySearchResultSchema),
  query: z.string(),
  totalCandidates: z.number().int().nonnegative(),
  latencyMs: z.number().nonnegative(),
  searchMode: z.enum(['hybrid', 'fts_only', 'vec_only']),
  strategy: QueryStrategySchema.optional(),
});
export type MemorySearchResponse = z.infer<typeof MemorySearchResponseSchema>;

export const MemoryEventRecordSchema = z.object({
  id: z.string(),
  memoryId: z.string(),
  type: z.string(),
  createdAt: z.string(),
});
export type MemoryEventRecord = z.infer<typeof MemoryEventRecordSchema>;

export const MemorySourceRecordSchema = z.object({
  id: z.string(),
  memoryId: z.string(),
  sourceType: z.string(),
  sourceRef: z.string(),
  createdAt: z.string(),
});
export type MemorySourceRecord = z.infer<typeof MemorySourceRecordSchema>;

export const MemoryConsolidationRecordSchema = z.object({
  id: z.string(),
  memoryId: z.string(),
  mergedIntoId: z.string(),
  reason: z.string().default(''),
  createdAt: z.string(),
});
export type MemoryConsolidationRecord = z.infer<typeof MemoryConsolidationRecordSchema>;

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
  memoryTypes: z.array(MemoryTypeSchema).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  limit: z.number().int().positive().max(100).optional(),
  includeContent: z.boolean().optional(),
});
export type MemorySearchQuery = z.infer<typeof MemorySearchQuerySchema>;

export const BudgetFitResultSchema = z.object({
  results: z.array(MemorySearchResultSchema),
  totalTokensUsed: z.number().int().nonnegative(),
  totalTokensBudget: z.number().int().positive(),
  truncatedCount: z.number().int().nonnegative(),
  droppedCount: z.number().int().nonnegative(),
  expansionPolicy: z.object({
    risk: z.enum(['low', 'moderate', 'high']),
    route: z.enum(['answer_directly', 'expand_shallow', 'expand_deep']),
    warning: z.string().optional(),
  }).optional(),
});
export type BudgetFitResult = z.infer<typeof BudgetFitResultSchema>;

export const MemoryDescribeResultSchema = z.object({
  id: z.string(),
  description: z.string(),
  type: z.string(),
  confidence: z.number(),
  scope: z.string(),
  sourceType: z.string(),
  createdAt: z.string(),
  lastReinforcedAt: z.string().nullable(),
  durable: z.boolean(),
  contentLength: z.number().int().nonnegative(),
  entityCount: z.number().int().nonnegative(),
  sourceCount: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative(),
});
export type MemoryDescribeResult = z.infer<typeof MemoryDescribeResultSchema>;

export const MemoryExpandResultSchema = z.object({
  id: z.string(),
  content: z.string(),
  tokenEstimate: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type MemoryExpandResult = z.infer<typeof MemoryExpandResultSchema>;
