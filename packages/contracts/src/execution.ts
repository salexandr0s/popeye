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

export const TaskSourceSchema = z.enum(['manual', 'heartbeat', 'schedule', 'telegram', 'api']);
export type TaskSource = z.infer<typeof TaskSourceSchema>;

export const ExecutionProfileModeSchema = z.enum(['restricted', 'interactive', 'elevated']);

export const ExecutionScopeSchema = z.enum(['workspace', 'project', 'global']);

export const FilesystemPolicyClassSchema = z.enum(['workspace', 'project', 'read_only_workspace', 'memory_only']);

export const ProfileContextReleasePolicySchema = z.enum(['none', 'summary_only', 'excerpt', 'full']);
export type ProfileContextReleasePolicy = z.infer<typeof ProfileContextReleasePolicySchema>;

export const InterventionCodeSchema = z.enum([
  'needs_credentials',
  'needs_policy_decision',
  'needs_instruction_fix',
  'needs_workspace_fix',
  'needs_operator_input',
  'retry_budget_exhausted',
  'iteration_budget_exhausted',
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
  profileId: z.string().default('default'),
  title: z.string(),
  prompt: z.string(),
  source: TaskSourceSchema,
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
  profileId: z.string().default('default'),
  sessionRootId: z.string(),
  engineSessionRef: z.string().nullable(),
  state: RunStateSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  error: z.string().nullable(),
  iterationsUsed: z.number().int().nonnegative().nullable().default(null),
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
  updatedAt: z.string().nullable().default(null),
  resolutionNote: z.string().nullable().default(null),
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
  path: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;

export const AgentProfileRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  mode: ExecutionProfileModeSchema.default('interactive'),
  modelPolicy: z.string().default('inherit'),
  allowedRuntimeTools: z.array(z.string()).default([]),
  allowedCapabilityIds: z.array(z.string()).default([]),
  memoryScope: ExecutionScopeSchema.default('workspace'),
  recallScope: ExecutionScopeSchema.default('workspace'),
  filesystemPolicyClass: FilesystemPolicyClassSchema.default('workspace'),
  contextReleasePolicy: ProfileContextReleasePolicySchema.default('summary_only'),
  createdAt: z.string(),
  updatedAt: z.string().nullable().default(null),
});
export type AgentProfileRecord = z.infer<typeof AgentProfileRecordSchema>;

const ExecutionEnvelopeProvenanceSchema = z.object({
  derivedAt: z.string(),
  engineKind: z.string(),
  sessionPolicy: z.enum(['dedicated', 'ephemeral', 'per_task']),
  warnings: z.array(z.string()).default([]),
});

export const ExecutionEnvelopeSchema = z.object({
  runId: z.string(),
  taskId: z.string(),
  profileId: z.string(),
  workspaceId: z.string(),
  projectId: z.string().nullable().default(null),
  mode: ExecutionProfileModeSchema,
  modelPolicy: z.string(),
  allowedRuntimeTools: z.array(z.string()).default([]),
  allowedCapabilityIds: z.array(z.string()).default([]),
  memoryScope: ExecutionScopeSchema,
  recallScope: ExecutionScopeSchema,
  filesystemPolicyClass: FilesystemPolicyClassSchema,
  contextReleasePolicy: ProfileContextReleasePolicySchema,
  readRoots: z.array(z.string()).default([]),
  writeRoots: z.array(z.string()).default([]),
  protectedPaths: z.array(z.string()).default([]),
  scratchRoot: z.string(),
  cwd: z.string().nullable().default(null),
  provenance: ExecutionEnvelopeProvenanceSchema,
});
export type ExecutionEnvelope = z.infer<typeof ExecutionEnvelopeSchema>;
