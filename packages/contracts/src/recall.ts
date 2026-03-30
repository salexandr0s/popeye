import { z } from 'zod';

import { MemoryLayerSchema, MemorySourceTypeSchema } from './memory.js';

export const RecallSourceKindSchema = z.enum([
  'receipt',
  'run_event',
  'message',
  'message_ingress',
  'intervention',
  'memory',
]);
export type RecallSourceKind = z.infer<typeof RecallSourceKindSchema>;

export const RecallQuerySchema = z.object({
  query: z.string().min(1),
  workspaceId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  includeGlobal: z.boolean().optional(),
  kinds: z.array(RecallSourceKindSchema).optional(),
  limit: z.number().int().positive().max(100).default(20),
});
export type RecallQuery = z.infer<typeof RecallQuerySchema>;

export const RecallResultSchema = z.object({
  sourceKind: RecallSourceKindSchema,
  sourceId: z.string(),
  title: z.string(),
  snippet: z.string(),
  score: z.number(),
  createdAt: z.string(),
  workspaceId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  runId: z.string().nullable().default(null),
  taskId: z.string().nullable().default(null),
  sessionRootId: z.string().nullable().default(null),
  subtype: z.string().nullable().default(null),
  status: z.string().nullable().default(null),
  memoryLayer: MemoryLayerSchema.optional(),
  memorySourceType: MemorySourceTypeSchema.optional(),
});
export type RecallResult = z.infer<typeof RecallResultSchema>;

export const RecallSearchResponseSchema = z.object({
  query: z.string(),
  results: z.array(RecallResultSchema),
  totalMatches: z.number().int().nonnegative(),
});
export type RecallSearchResponse = z.infer<typeof RecallSearchResponseSchema>;

export const RecallDetailSchema = RecallResultSchema.extend({
  content: z.string(),
  metadata: z.record(z.string(), z.string()).default({}),
});
export type RecallDetail = z.infer<typeof RecallDetailSchema>;
