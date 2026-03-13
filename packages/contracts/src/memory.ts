import { z } from 'zod';
import { DataClassificationSchema } from './config.js';

export const MemoryTypeSchema = z.enum(['episodic', 'semantic', 'procedural']);
export type MemoryType = z.infer<typeof MemoryTypeSchema>;

export const MemoryRecordSchema = z.object({
  id: z.string(),
  description: z.string(),
  classification: DataClassificationSchema,
  sourceType: z.enum(['receipt', 'telegram', 'daily_summary', 'curated_memory', 'workspace_doc']),
  content: z.string(),
  confidence: z.number().min(0).max(1),
  scope: z.string().default('workspace'),
  sourceRunId: z.string().nullable().default(null),
  sourceTimestamp: z.string().nullable().default(null),
  createdAt: z.string().default(''),
});
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;

export const MemorySearchResultSchema = z.object({
  id: z.string(),
  description: z.string(),
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
  }),
});
export type MemorySearchResult = z.infer<typeof MemorySearchResultSchema>;

export const MemorySearchResponseSchema = z.object({
  results: z.array(MemorySearchResultSchema),
  query: z.string(),
  totalCandidates: z.number().int().nonnegative(),
  latencyMs: z.number().nonnegative(),
  searchMode: z.enum(['hybrid', 'fts_only', 'vec_only']),
});
export type MemorySearchResponse = z.infer<typeof MemorySearchResponseSchema>;

export const MemoryEventRecordSchema = z.object({
  id: z.string(),
  memoryId: z.string(),
  type: z.string(),
  createdAt: z.string(),
});
export type MemoryEventRecord = z.infer<typeof MemoryEventRecordSchema>;

export const MemoryEmbeddingRecordSchema = z.object({
  id: z.string(),
  memoryId: z.string(),
  embeddingJson: z.string(),
  createdAt: z.string(),
});
export type MemoryEmbeddingRecord = z.infer<typeof MemoryEmbeddingRecordSchema>;

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
  createdAt: z.string(),
});
export type MemoryConsolidationRecord = z.infer<typeof MemoryConsolidationRecordSchema>;
