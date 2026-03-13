import { z } from 'zod';
import { UsageMetricsSchema } from './engine.js';

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
  createdAt: z.string(),
});
export type ReceiptRecord = z.infer<typeof ReceiptRecordSchema>;
