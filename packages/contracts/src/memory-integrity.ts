import { z } from 'zod';

export const IntegrityCheckNameSchema = z.enum([
  'summary_dag_integrity',
  'orphan_chunks',
  'unsupported_facts',
  'profile_refresh_debt',
  'ttl_consistency',
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
