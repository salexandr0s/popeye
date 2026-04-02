import { z } from 'zod';

import { JobStateSchema, RunStateSchema, TaskSourceSchema } from './execution.js';

export const AutomationStatusSchema = z.enum(['healthy', 'running', 'paused', 'attention', 'idle']);
export type AutomationStatus = z.infer<typeof AutomationStatusSchema>;

export const AutomationControlAvailabilitySchema = z.object({
  runNow: z.boolean().default(false),
  pause: z.boolean().default(false),
  resume: z.boolean().default(false),
  enabledEdit: z.boolean().default(false),
  cadenceEdit: z.boolean().default(false),
});
export type AutomationControlAvailability = z.infer<typeof AutomationControlAvailabilitySchema>;

export const AutomationUpdateInputSchema = z.object({
  enabled: z.boolean().optional(),
  intervalSeconds: z.number().int().positive().optional(),
}).refine(
  (value) => value.enabled !== undefined || value.intervalSeconds !== undefined,
  { message: 'At least one automation field must be provided.' },
);
export type AutomationUpdateInput = z.infer<typeof AutomationUpdateInputSchema>;

export const AutomationRecentRunSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  state: RunStateSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  receiptId: z.string().nullable().default(null),
  pendingApprovalCount: z.number().int().nonnegative().default(0),
  openInterventionCount: z.number().int().nonnegative().default(0),
});
export type AutomationRecentRun = z.infer<typeof AutomationRecentRunSchema>;

export const AutomationRecordSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  taskId: z.string(),
  source: TaskSourceSchema,
  title: z.string(),
  taskStatus: z.enum(['active', 'paused']),
  jobId: z.string().nullable().default(null),
  jobStatus: JobStateSchema.nullable().default(null),
  status: AutomationStatusSchema,
  enabled: z.boolean(),
  scheduleSummary: z.string(),
  intervalSeconds: z.number().int().positive().nullable().default(null),
  lastRunAt: z.string().nullable().default(null),
  lastSuccessAt: z.string().nullable().default(null),
  lastFailureAt: z.string().nullable().default(null),
  nextExpectedAt: z.string().nullable().default(null),
  blockedReason: z.string().nullable().default(null),
  attentionReason: z.string().nullable().default(null),
  openInterventionCount: z.number().int().nonnegative().default(0),
  pendingApprovalCount: z.number().int().nonnegative().default(0),
  controls: AutomationControlAvailabilitySchema,
});
export type AutomationRecord = z.infer<typeof AutomationRecordSchema>;

export const AutomationDetailSchema = AutomationRecordSchema.extend({
  recentRuns: z.array(AutomationRecentRunSchema).default([]),
});
export type AutomationDetail = z.infer<typeof AutomationDetailSchema>;

export const AutomationListResponseSchema = z.array(AutomationRecordSchema);
export type AutomationListResponse = z.infer<typeof AutomationListResponseSchema>;

export const AutomationListQueryParamsSchema = z.object({
  workspaceId: z.string().optional(),
});
export type AutomationListQueryParams = z.infer<typeof AutomationListQueryParamsSchema>;
