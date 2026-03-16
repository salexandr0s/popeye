import { z } from 'zod';

export const IntegrityCheckNameSchema = z.enum([
  'fts5_index_sync',
  'vec_index_sync',
  'orphaned_embeddings',
  'dedup_key_consistency',
  'entity_mention_consistency',
  'consolidation_chain_integrity',
  'confidence_bounds',
  'summary_dag_integrity',
  'event_log_completeness',
]);
export type IntegrityCheckName = z.infer<typeof IntegrityCheckNameSchema>;

export const IntegrityViolationSchema = z.object({
  check: IntegrityCheckNameSchema,
  memoryId: z.string().optional(),
  detail: z.string(),
  autoFixable: z.boolean(),
});
export type IntegrityViolation = z.infer<typeof IntegrityViolationSchema>;

export const IntegrityReportSchema = z.object({
  checksRun: z.array(IntegrityCheckNameSchema),
  violations: z.array(IntegrityViolationSchema),
  fixesApplied: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
});
export type IntegrityReport = z.infer<typeof IntegrityReportSchema>;
