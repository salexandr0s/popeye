import { z } from 'zod';
import { UsageMetricsSchema } from './engine.js';

// ---------------------------------------------------------------------------
// Analytics granularity and time range
// ---------------------------------------------------------------------------

export const AnalyticsGranularitySchema = z.enum(['hourly', 'daily', 'weekly', 'monthly']);
export type AnalyticsGranularity = z.infer<typeof AnalyticsGranularitySchema>;

export const AnalyticsTimeRangeSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  granularity: AnalyticsGranularitySchema.default('daily'),
  workspaceId: z.string().optional(),
});
export type AnalyticsTimeRange = z.infer<typeof AnalyticsTimeRangeSchema>;

// ---------------------------------------------------------------------------
// Usage time buckets
// ---------------------------------------------------------------------------

export const AnalyticsTimeBucketSchema = z.object({
  bucket: z.string(),
  runs: z.number().int().nonnegative(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
});
export type AnalyticsTimeBucket = z.infer<typeof AnalyticsTimeBucketSchema>;

export const AnalyticsUsageResponseSchema = z.object({
  granularity: AnalyticsGranularitySchema,
  buckets: z.array(AnalyticsTimeBucketSchema),
});
export type AnalyticsUsageResponse = z.infer<typeof AnalyticsUsageResponseSchema>;

// ---------------------------------------------------------------------------
// Model breakdown
// ---------------------------------------------------------------------------

export const AnalyticsModelBreakdownSchema = z.object({
  provider: z.string(),
  model: z.string(),
  runs: z.number().int().nonnegative(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
});
export type AnalyticsModelBreakdown = z.infer<typeof AnalyticsModelBreakdownSchema>;

export const AnalyticsModelsResponseSchema = z.object({
  models: z.array(AnalyticsModelBreakdownSchema),
});
export type AnalyticsModelsResponse = z.infer<typeof AnalyticsModelsResponseSchema>;

// ---------------------------------------------------------------------------
// Status breakdown
// ---------------------------------------------------------------------------

export const AnalyticsStatusBreakdownSchema = z.object({
  status: z.string(),
  count: z.number().int().nonnegative(),
});
export type AnalyticsStatusBreakdown = z.infer<typeof AnalyticsStatusBreakdownSchema>;

// ---------------------------------------------------------------------------
// Project cost breakdown
// ---------------------------------------------------------------------------

export const AnalyticsProjectCostSchema = z.object({
  workspaceId: z.string(),
  runs: z.number().int().nonnegative(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
});
export type AnalyticsProjectCost = z.infer<typeof AnalyticsProjectCostSchema>;

export const AnalyticsProjectsResponseSchema = z.object({
  projects: z.array(AnalyticsProjectCostSchema),
});
export type AnalyticsProjectsResponse = z.infer<typeof AnalyticsProjectsResponseSchema>;

// ---------------------------------------------------------------------------
// Session search
// ---------------------------------------------------------------------------

export const SessionSearchQuerySchema = z.object({
  q: z.string().min(1),
  type: z.string().optional(),
  workspaceId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
export type SessionSearchQuery = z.infer<typeof SessionSearchQuerySchema>;

export const SessionSearchResultSchema = z.object({
  eventId: z.string(),
  runId: z.string(),
  type: z.string(),
  payload: z.string(),
  createdAt: z.string(),
  rank: z.number(),
});
export type SessionSearchResult = z.infer<typeof SessionSearchResultSchema>;

export const SessionSearchResponseSchema = z.object({
  query: z.string(),
  results: z.array(SessionSearchResultSchema),
  totalMatches: z.number().int().nonnegative(),
});
export type SessionSearchResponse = z.infer<typeof SessionSearchResponseSchema>;

// ---------------------------------------------------------------------------
// Trajectory export
// ---------------------------------------------------------------------------

export const TrajectoryFormatSchema = z.enum(['jsonl', 'sharegpt']);
export type TrajectoryFormat = z.infer<typeof TrajectoryFormatSchema>;

export const TrajectoryQuerySchema = z.object({
  format: TrajectoryFormatSchema.default('jsonl'),
  types: z.string().optional(),
});
export type TrajectoryQuery = z.infer<typeof TrajectoryQuerySchema>;

export const ShareGPTMessageSchema = z.object({
  from: z.enum(['human', 'gpt', 'tool', 'system']),
  value: z.string(),
});
export type ShareGPTMessage = z.infer<typeof ShareGPTMessageSchema>;

export const ShareGPTConversationSchema = z.object({
  id: z.string(),
  conversations: z.array(ShareGPTMessageSchema),
  metadata: z.object({
    runId: z.string(),
    status: z.string(),
    model: z.string().optional(),
    tokensIn: z.number().int().nonnegative().optional(),
    tokensOut: z.number().int().nonnegative().optional(),
    estimatedCostUsd: z.number().nonnegative().optional(),
  }),
});
export type ShareGPTConversation = z.infer<typeof ShareGPTConversationSchema>;

// ---------------------------------------------------------------------------
// Delegation
// ---------------------------------------------------------------------------

export const DelegationRequestSchema = z.object({
  prompt: z.string().min(1),
  maxIterations: z.number().int().positive(),
  title: z.string().optional(),
});
export type DelegationRequest = z.infer<typeof DelegationRequestSchema>;

export const DelegationResultSchema = z.object({
  runId: z.string(),
  status: z.enum(['succeeded', 'failed', 'cancelled']),
  output: z.string(),
  iterationsUsed: z.number().int().nonnegative(),
  usage: UsageMetricsSchema,
});
export type DelegationResult = z.infer<typeof DelegationResultSchema>;

export const DelegationSummarySchema = z.object({
  parentRunId: z.string().nullable(),
  childRunIds: z.array(z.string()),
  totalDelegatedIterations: z.number().int().nonnegative(),
  aggregatedUsage: UsageMetricsSchema,
});
export type DelegationSummary = z.infer<typeof DelegationSummarySchema>;

export const DelegationTreeNodeSchema: z.ZodType<DelegationTreeNode> = z.lazy(() =>
  z.object({
    runId: z.string(),
    parentRunId: z.string().nullable(),
    depth: z.number().int().nonnegative(),
    state: z.string(),
    iterationsUsed: z.number().int().nonnegative().nullable(),
    title: z.string().nullable(),
    children: z.array(DelegationTreeNodeSchema),
  }),
);

export interface DelegationTreeNode {
  runId: string;
  parentRunId: string | null;
  depth: number;
  state: string;
  iterationsUsed: number | null;
  title: string | null;
  children: DelegationTreeNode[];
}
