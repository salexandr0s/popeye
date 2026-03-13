import { z } from 'zod';

export const RetryPolicySchema = z.object({
  maxAttempts: z.number().int().positive().default(3),
  baseDelaySeconds: z.number().int().positive().default(5),
  multiplier: z.number().positive().default(2),
  maxDelaySeconds: z.number().int().positive().default(900),
});
export type RetryPolicy = z.infer<typeof RetryPolicySchema>;

export const TaskSideEffectProfileSchema = z.enum(['read_only', 'external_side_effect']);
export type TaskSideEffectProfile = z.infer<typeof TaskSideEffectProfileSchema>;

export const InterventionCodeSchema = z.enum([
  'needs_credentials',
  'needs_policy_decision',
  'needs_instruction_fix',
  'needs_workspace_fix',
  'needs_operator_input',
  'retry_budget_exhausted',
  'auth_failure',
  'prompt_injection_quarantined',
  'failed_final',
]);
export type InterventionCode = z.infer<typeof InterventionCodeSchema>;

export const JobStateSchema = z.enum([
  'queued',
  'leased',
  'running',
  'waiting_retry',
  'paused',
  'blocked_operator',
  'succeeded',
  'failed_final',
  'cancelled',
]);
export type JobState = z.infer<typeof JobStateSchema>;

export const RunStateSchema = z.enum([
  'starting',
  'running',
  'succeeded',
  'failed_retryable',
  'failed_final',
  'cancelled',
  'abandoned',
]);
export type RunState = z.infer<typeof RunStateSchema>;

export const TaskRecordSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string().nullable(),
  title: z.string(),
  prompt: z.string(),
  source: z.enum(['manual', 'heartbeat', 'schedule', 'telegram', 'api']),
  status: z.enum(['active', 'paused']).default('active'),
  retryPolicy: RetryPolicySchema,
  sideEffectProfile: TaskSideEffectProfileSchema,
  coalesceKey: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type TaskRecord = z.infer<typeof TaskRecordSchema>;

export const JobRecordSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  workspaceId: z.string(),
  status: JobStateSchema,
  retryCount: z.number().int().nonnegative(),
  availableAt: z.string(),
  lastRunId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type JobRecord = z.infer<typeof JobRecordSchema>;

export const RunRecordSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  taskId: z.string(),
  workspaceId: z.string(),
  sessionRootId: z.string(),
  engineSessionRef: z.string().nullable(),
  state: RunStateSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  error: z.string().nullable(),
});
export type RunRecord = z.infer<typeof RunRecordSchema>;

export const RunEventRecordSchema = z.object({
  id: z.string(),
  runId: z.string(),
  type: z.string(),
  payload: z.string(),
  createdAt: z.string(),
});
export type RunEventRecord = z.infer<typeof RunEventRecordSchema>;

export const InterventionRecordSchema = z.object({
  id: z.string(),
  code: InterventionCodeSchema,
  runId: z.string().nullable(),
  status: z.enum(['open', 'resolved']),
  reason: z.string(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});
export type InterventionRecord = z.infer<typeof InterventionRecordSchema>;

export const JobLeaseRecordSchema = z.object({
  jobId: z.string(),
  leaseOwner: z.string(),
  leaseExpiresAt: z.string(),
  updatedAt: z.string(),
});
export type JobLeaseRecord = z.infer<typeof JobLeaseRecordSchema>;

export const ProjectRecordSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  createdAt: z.string(),
});
export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;

export const AgentProfileRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
});
export type AgentProfileRecord = z.infer<typeof AgentProfileRecordSchema>;
