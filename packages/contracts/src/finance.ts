import { z } from 'zod';

// --- Finance Import ---

export const FinanceImportTypeSchema = z.enum(['csv', 'ofx', 'qfx', 'document']);
export type FinanceImportType = z.infer<typeof FinanceImportTypeSchema>;

export const FinanceImportStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed']);
export type FinanceImportStatus = z.infer<typeof FinanceImportStatusSchema>;

export const FinanceImportRecordSchema = z.object({
  id: z.string(),
  vaultId: z.string(),
  importType: FinanceImportTypeSchema,
  fileName: z.string(),
  status: FinanceImportStatusSchema.default('pending'),
  recordCount: z.number().int().nonnegative().default(0),
  importedAt: z.string(),
});
export type FinanceImportRecord = z.infer<typeof FinanceImportRecordSchema>;

// --- Finance Transaction ---

export const FinanceTransactionRecordSchema = z.object({
  id: z.string(),
  importId: z.string(),
  date: z.string(),
  description: z.string(),
  amount: z.number(),
  currency: z.string().default('USD'),
  category: z.string().nullable().default(null),
  merchantName: z.string().nullable().default(null),
  accountLabel: z.string().nullable().default(null),
  redactedSummary: z.string().default(''),
});
export type FinanceTransactionRecord = z.infer<typeof FinanceTransactionRecordSchema>;

// --- Finance Document ---

export const FinanceDocumentRecordSchema = z.object({
  id: z.string(),
  importId: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  redactedSummary: z.string().default(''),
});
export type FinanceDocumentRecord = z.infer<typeof FinanceDocumentRecordSchema>;

// --- Finance Digest ---

export const FinanceAnomalyFlagSchema = z.object({
  description: z.string(),
  severity: z.enum(['info', 'warn', 'alert']),
  transactionId: z.string().nullable().default(null),
});
export type FinanceAnomalyFlag = z.infer<typeof FinanceAnomalyFlagSchema>;

export const FinanceDigestRecordSchema = z.object({
  id: z.string(),
  period: z.string(),
  totalIncome: z.number().default(0),
  totalExpenses: z.number().default(0),
  categoryBreakdown: z.record(z.string(), z.number()).default({}),
  anomalyFlags: z.array(FinanceAnomalyFlagSchema).default([]),
  generatedAt: z.string(),
});
export type FinanceDigestRecord = z.infer<typeof FinanceDigestRecordSchema>;

// --- Finance Search ---

export const FinanceSearchQuerySchema = z.object({
  query: z.string().min(1),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  category: z.string().optional(),
  limit: z.number().int().positive().max(100).default(20),
});
export type FinanceSearchQuery = z.infer<typeof FinanceSearchQuerySchema>;

export const FinanceSearchResultSchema = z.object({
  transactionId: z.string(),
  date: z.string(),
  description: z.string(),
  amount: z.number(),
  redactedSummary: z.string(),
  score: z.number(),
});
export type FinanceSearchResult = z.infer<typeof FinanceSearchResultSchema>;

// --- Finance Reminder ---

export const FinanceReminderCandidateSchema = z.object({
  description: z.string(),
  amount: z.number(),
  dueDate: z.string().nullable(),
  source: z.string(),
});
export type FinanceReminderCandidate = z.infer<typeof FinanceReminderCandidateSchema>;
