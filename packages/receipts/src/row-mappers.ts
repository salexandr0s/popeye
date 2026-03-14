import {
  ReceiptRecordSchema,
  UsageMetricsSchema,
} from '@popeye/contracts';
import { z } from 'zod';

const ReceiptRowSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  job_id: z.string(),
  task_id: z.string(),
  workspace_id: z.string(),
  status: z.enum(['succeeded', 'failed', 'cancelled', 'abandoned']),
  summary: z.string(),
  details: z.string(),
  usage_json: z.string(),
  created_at: z.string(),
});

export const ReceiptIdRowSchema = z.object({
  id: z.string(),
});

export const UsageSummaryRowSchema = z.object({
  totalRuns: z.coerce.number().int().nonnegative(),
  tokensIn: z.coerce.number().nonnegative(),
  tokensOut: z.coerce.number().nonnegative(),
  estimatedCostUsd: z.coerce.number().nonnegative(),
});

function parseUsage(value: string) {
  return UsageMetricsSchema.parse(JSON.parse(value));
}

export function mapReceiptRow(row: unknown) {
  const parsed = ReceiptRowSchema.parse(row);
  return ReceiptRecordSchema.parse({
    id: parsed.id,
    runId: parsed.run_id,
    jobId: parsed.job_id,
    taskId: parsed.task_id,
    workspaceId: parsed.workspace_id,
    status: parsed.status,
    summary: parsed.summary,
    details: parsed.details,
    usage: parseUsage(parsed.usage_json),
    createdAt: parsed.created_at,
  });
}
