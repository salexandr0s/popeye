import { z } from 'zod';

// --- File Root Permission ---

export const FileRootPermissionSchema = z.enum(['read', 'index', 'index_and_derive']);
export const FileRootKindSchema = z.enum(['general', 'knowledge_base']);

// --- File Root Record ---

export const FileRootRecordSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  label: z.string(),
  rootPath: z.string(),
  kind: FileRootKindSchema.default('general'),
  permission: FileRootPermissionSchema,
  filePatterns: z.array(z.string()).default(['**/*.md', '**/*.txt']),
  excludePatterns: z.array(z.string()).default([]),
  maxFileSizeBytes: z.number().int().positive().default(1_048_576), // 1MB
  enabled: z.boolean().default(true),
  lastIndexedAt: z.string().nullable().default(null),
  lastIndexedCount: z.number().int().nonnegative().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FileRootRecord = z.infer<typeof FileRootRecordSchema>;

// --- File Document Record ---

export const FileDocumentRecordSchema = z.object({
  id: z.string(),
  fileRootId: z.string(),
  relativePath: z.string(),
  contentHash: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  memoryId: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FileDocumentRecord = z.infer<typeof FileDocumentRecordSchema>;

// --- File Root Registration Input ---

export const FileRootRegistrationInputSchema = z.object({
  workspaceId: z.string().min(1).default('default'),
  label: z.string().min(1),
  rootPath: z.string().min(1),
  kind: FileRootKindSchema.default('general'),
  permission: FileRootPermissionSchema.default('index'),
  filePatterns: z.array(z.string()).default(['**/*.md', '**/*.txt']),
  excludePatterns: z.array(z.string()).default([]),
  maxFileSizeBytes: z.number().int().positive().default(1_048_576),
});
export type FileRootRegistrationInput = z.infer<typeof FileRootRegistrationInputSchema>;

// --- File Root Update Input ---

export const FileRootUpdateInputSchema = z.object({
  label: z.string().min(1).optional(),
  kind: FileRootKindSchema.optional(),
  permission: FileRootPermissionSchema.optional(),
  filePatterns: z.array(z.string()).optional(),
  excludePatterns: z.array(z.string()).optional(),
  maxFileSizeBytes: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
});
export type FileRootUpdateInput = z.infer<typeof FileRootUpdateInputSchema>;

// --- File Search ---

export const FileSearchQuerySchema = z.object({
  query: z.string().min(1),
  rootId: z.string().optional(),
  workspaceId: z.string().optional(),
  filePatterns: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(100).default(10),
  includeContent: z.boolean().default(false),
});
export type FileSearchQuery = z.infer<typeof FileSearchQuerySchema>;

export const FileSearchResultSchema = z.object({
  documentId: z.string(),
  fileRootId: z.string(),
  relativePath: z.string(),
  memoryId: z.string().nullable(),
  score: z.number(),
  snippet: z.string(),
});
export type FileSearchResult = z.infer<typeof FileSearchResultSchema>;

export const FileSearchResponseSchema = z.object({
  query: z.string(),
  results: z.array(FileSearchResultSchema),
  totalCandidates: z.number().int().nonnegative(),
});
export type FileSearchResponse = z.infer<typeof FileSearchResponseSchema>;

// --- File Index Result ---

export const FileIndexResultSchema = z.object({
  rootId: z.string(),
  indexed: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  stale: z.number().int().nonnegative(),
  errors: z.array(z.string()),
});
export type FileIndexResult = z.infer<typeof FileIndexResultSchema>;

// --- Write Intent ---

const FileWriteIntentStatusSchema = z.enum(['pending', 'applied', 'rejected']);

const FileWriteIntentTypeSchema = z.enum(['create', 'update', 'delete']);

export const FileWriteIntentRecordSchema = z.object({
  id: z.string(),
  fileRootId: z.string(),
  filePath: z.string(),
  intentType: FileWriteIntentTypeSchema,
  diffPreview: z.string().default(''),
  status: FileWriteIntentStatusSchema.default('pending'),
  runId: z.string().nullable().default(null),
  approvalId: z.string().nullable().default(null),
  receiptId: z.string().nullable().default(null),
  createdAt: z.string(),
  reviewedAt: z.string().nullable().default(null),
});
export type FileWriteIntentRecord = z.infer<typeof FileWriteIntentRecordSchema>;

export const FileWriteIntentCreateInputSchema = z.object({
  fileRootId: z.string().min(1),
  filePath: z.string().min(1),
  intentType: FileWriteIntentTypeSchema,
  diffPreview: z.string().default(''),
  runId: z.string().nullable().optional(),
});
export type FileWriteIntentCreateInput = z.infer<typeof FileWriteIntentCreateInputSchema>;

export const FileWriteIntentReviewInputSchema = z.object({
  action: z.enum(['apply', 'reject']),
  reason: z.string().optional(),
});
export type FileWriteIntentReviewInput = z.infer<typeof FileWriteIntentReviewInputSchema>;
