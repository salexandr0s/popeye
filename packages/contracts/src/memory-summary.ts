import { z } from 'zod';

export const MemorySummaryRecordSchema = z.object({
  id: z.string(),
  runId: z.string(),
  workspaceId: z.string(),
  parentId: z.string().nullable(),
  depth: z.number().int().nonnegative(),
  content: z.string(),
  tokenEstimate: z.number().int().nonnegative(),
  startTime: z.string(),
  endTime: z.string(),
  createdAt: z.string(),
});
export type MemorySummaryRecord = z.infer<typeof MemorySummaryRecordSchema>;

export const SummaryDAGNodeSchema: z.ZodType<SummaryDAGNode> = z.lazy(() =>
  z.object({
    summary: MemorySummaryRecordSchema,
    children: z.array(SummaryDAGNodeSchema),
  }),
);
export interface SummaryDAGNode {
  summary: MemorySummaryRecord;
  children: SummaryDAGNode[];
}

export const SummarySourceRecordSchema = z.object({
  id: z.string(),
  summaryId: z.string(),
  memoryId: z.string(),
  createdAt: z.string(),
});
export type SummarySourceRecord = z.infer<typeof SummarySourceRecordSchema>;
