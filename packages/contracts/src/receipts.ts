import { z } from 'zod';
import { UsageMetricsSchema } from './engine.js';
import {
  ExecutionProfileModeSchema,
  ExecutionScopeSchema,
  FilesystemPolicyClassSchema,
  ProfileContextReleasePolicySchema,
} from './execution.js';

const ReceiptExecutionSummarySchema = z.object({
  mode: ExecutionProfileModeSchema,
  memoryScope: ExecutionScopeSchema,
  recallScope: ExecutionScopeSchema,
  filesystemPolicyClass: FilesystemPolicyClassSchema,
  contextReleasePolicy: ProfileContextReleasePolicySchema,
  sessionPolicy: z.enum(['dedicated', 'ephemeral', 'per_task']),
  warnings: z.array(z.string()).default([]),
});

const ReceiptContextReleaseDomainSummarySchema = z.object({
  count: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
});
export type ReceiptContextReleaseDomainSummary = z.infer<typeof ReceiptContextReleaseDomainSummarySchema>;

const ReceiptContextReleaseSummarySchema = z.object({
  totalReleases: z.number().int().nonnegative(),
  totalTokenEstimate: z.number().int().nonnegative(),
  byDomain: z.record(z.string(), ReceiptContextReleaseDomainSummarySchema),
});

export const ReceiptTimelineEventKindSchema = z.enum(['run', 'policy', 'approval', 'context_release', 'warning']);
export type ReceiptTimelineEventKind = z.infer<typeof ReceiptTimelineEventKindSchema>;

export const ReceiptTimelineEventSourceSchema = z.enum(['run_event', 'security_audit', 'approval', 'context_release', 'receipt']);
export type ReceiptTimelineEventSource = z.infer<typeof ReceiptTimelineEventSourceSchema>;

export const ReceiptTimelineEventSchema = z.object({
  id: z.string(),
  at: z.string(),
  kind: ReceiptTimelineEventKindSchema,
  severity: z.enum(['info', 'warn', 'error']),
  code: z.string(),
  title: z.string(),
  detail: z.string().default(''),
  source: ReceiptTimelineEventSourceSchema,
  metadata: z.record(z.string(), z.string()).default({}),
});
export type ReceiptTimelineEvent = z.infer<typeof ReceiptTimelineEventSchema>;

export const ReceiptRuntimeSummarySchema = z.object({
  projectId: z.string().nullable().default(null),
  profileId: z.string().nullable().default(null),
  execution: ReceiptExecutionSummarySchema.nullable().default(null),
  contextReleases: ReceiptContextReleaseSummarySchema.nullable().default(null),
  timeline: z.array(ReceiptTimelineEventSchema).default([]),
});
export type ReceiptRuntimeSummary = z.infer<typeof ReceiptRuntimeSummarySchema>;

export const ReceiptRecordSchema = z.object({
  id: z.string(),
  runId: z.string(),
  jobId: z.string(),
  taskId: z.string(),
  workspaceId: z.string(),
  status: z.enum(['succeeded', 'failed', 'cancelled', 'abandoned']),
  summary: z.string(),
  details: z.string(),
  usage: UsageMetricsSchema,
  runtime: ReceiptRuntimeSummarySchema.optional(),
  createdAt: z.string(),
});
export type ReceiptRecord = z.infer<typeof ReceiptRecordSchema>;
