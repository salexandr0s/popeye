import {
  JobLeaseRecordSchema,
  JobRecordSchema,
  JobStateSchema,
  RetryPolicySchema,
  TaskRecordSchema,
  TaskSideEffectProfileSchema,
} from '@popeye/contracts';
import { z } from 'zod';

const TaskRowSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  project_id: z.string().nullable(),
  profile_id: z.string().nullable().default('default'),
  title: z.string(),
  prompt: z.string(),
  source: z.enum(['manual', 'heartbeat', 'schedule', 'telegram', 'api']),
  status: z.enum(['active', 'paused']),
  retry_policy_json: z.string(),
  side_effect_profile: TaskSideEffectProfileSchema,
  coalesce_key: z.string().nullable(),
  created_at: z.string(),
});

const JobRowSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  workspace_id: z.string(),
  status: JobStateSchema,
  retry_count: z.coerce.number().int().nonnegative(),
  available_at: z.string(),
  last_run_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const JobLeaseRowSchema = z.object({
  job_id: z.string(),
  lease_owner: z.string(),
  lease_expires_at: z.string(),
  updated_at: z.string(),
});

export const IdRowSchema = z.object({
  id: z.string(),
});

function parseRetryPolicy(value: string) {
  return RetryPolicySchema.parse(JSON.parse(value));
}

export function mapTaskRow(row: unknown) {
  const parsed = TaskRowSchema.parse(row);
  return TaskRecordSchema.parse({
    id: parsed.id,
    workspaceId: parsed.workspace_id,
    projectId: parsed.project_id,
    profileId: parsed.profile_id ?? 'default',
    title: parsed.title,
    prompt: parsed.prompt,
    source: parsed.source,
    status: parsed.status,
    retryPolicy: parseRetryPolicy(parsed.retry_policy_json),
    sideEffectProfile: parsed.side_effect_profile,
    coalesceKey: parsed.coalesce_key,
    createdAt: parsed.created_at,
  });
}

export function mapJobRow(row: unknown) {
  const parsed = JobRowSchema.parse(row);
  return JobRecordSchema.parse({
    id: parsed.id,
    taskId: parsed.task_id,
    workspaceId: parsed.workspace_id,
    status: parsed.status,
    retryCount: parsed.retry_count,
    availableAt: parsed.available_at,
    lastRunId: parsed.last_run_id,
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at,
  });
}

export function mapJobLeaseRow(row: unknown) {
  const parsed = JobLeaseRowSchema.parse(row);
  return JobLeaseRecordSchema.parse({
    jobId: parsed.job_id,
    leaseOwner: parsed.lease_owner,
    leaseExpiresAt: parsed.lease_expires_at,
    updatedAt: parsed.updated_at,
  });
}
