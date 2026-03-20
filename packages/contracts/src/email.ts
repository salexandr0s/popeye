import { z } from 'zod';

// --- Email Account Record ---

export const EmailAccountRecordSchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  emailAddress: z.string(),
  displayName: z.string(),
  syncCursorPageToken: z.string().nullable().default(null),
  syncCursorHistoryId: z.string().nullable().default(null),
  lastSyncAt: z.string().nullable().default(null),
  messageCount: z.number().int().nonnegative().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EmailAccountRecord = z.infer<typeof EmailAccountRecordSchema>;

// --- Email Thread Record ---

export const EmailImportanceSchema = z.enum(['low', 'normal', 'high', 'critical']);
export type EmailImportance = z.infer<typeof EmailImportanceSchema>;

export const EmailThreadRecordSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  gmailThreadId: z.string(),
  subject: z.string(),
  snippet: z.string(),
  lastMessageAt: z.string(),
  messageCount: z.number().int().nonnegative().default(1),
  labelIds: z.array(z.string()).default([]),
  isUnread: z.boolean().default(false),
  isStarred: z.boolean().default(false),
  importance: EmailImportanceSchema.default('normal'),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EmailThreadRecord = z.infer<typeof EmailThreadRecordSchema>;

// --- Email Message Record ---

export const EmailMessageRecordSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  accountId: z.string(),
  gmailMessageId: z.string(),
  from: z.string(),
  to: z.array(z.string()).default([]),
  cc: z.array(z.string()).default([]),
  subject: z.string(),
  snippet: z.string(),
  bodyPreview: z.string().default(''),
  receivedAt: z.string(),
  sizeEstimate: z.number().int().nonnegative().default(0),
  labelIds: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EmailMessageRecord = z.infer<typeof EmailMessageRecordSchema>;

// --- Email Sync Cursor ---

export const EmailSyncCursorSchema = z.object({
  accountId: z.string(),
  pageToken: z.string().nullable().default(null),
  historyId: z.string().nullable().default(null),
  updatedAt: z.string(),
});
export type EmailSyncCursor = z.infer<typeof EmailSyncCursorSchema>;

// --- Email Digest Record ---

export const EmailDigestRecordSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  workspaceId: z.string(),
  date: z.string(),
  unreadCount: z.number().int().nonnegative(),
  highSignalCount: z.number().int().nonnegative(),
  summaryMarkdown: z.string(),
  generatedAt: z.string(),
});
export type EmailDigestRecord = z.infer<typeof EmailDigestRecordSchema>;

// --- Email Search ---

export const EmailSearchQuerySchema = z.object({
  query: z.string().min(1),
  accountId: z.string().optional(),
  limit: z.number().int().positive().max(100).default(20),
  labelFilter: z.array(z.string()).optional(),
  dateRange: z.object({
    from: z.string().optional(),
    to: z.string().optional(),
  }).optional(),
});
export type EmailSearchQuery = z.infer<typeof EmailSearchQuerySchema>;

export const EmailSearchResultSchema = z.object({
  threadId: z.string(),
  subject: z.string(),
  snippet: z.string(),
  from: z.string(),
  lastMessageAt: z.string(),
  score: z.number(),
});
export type EmailSearchResult = z.infer<typeof EmailSearchResultSchema>;

// --- Email Sync Result ---

export const EmailSyncResultSchema = z.object({
  accountId: z.string(),
  synced: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  errors: z.array(z.string()),
});
export type EmailSyncResult = z.infer<typeof EmailSyncResultSchema>;

export const EmailDraftRecordSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  connectionId: z.string(),
  providerDraftId: z.string(),
  providerMessageId: z.string().nullable().default(null),
  to: z.array(z.string()).default([]),
  cc: z.array(z.string()).default([]),
  subject: z.string(),
  bodyPreview: z.string().default(''),
  updatedAt: z.string(),
});
export type EmailDraftRecord = z.infer<typeof EmailDraftRecordSchema>;

export const EmailDraftCreateInputSchema = z.object({
  accountId: z.string().min(1),
  to: z.array(z.string().email()).default([]),
  cc: z.array(z.string().email()).default([]),
  subject: z.string().min(1),
  body: z.string().default(''),
});
export type EmailDraftCreateInput = z.infer<typeof EmailDraftCreateInputSchema>;

export const EmailDraftUpdateInputSchema = z.object({
  accountId: z.string().min(1).optional(),
  to: z.array(z.string().email()).optional(),
  cc: z.array(z.string().email()).optional(),
  subject: z.string().min(1).optional(),
  body: z.string().optional(),
});
export type EmailDraftUpdateInput = z.infer<typeof EmailDraftUpdateInputSchema>;

// --- Email Account Registration Input ---

export const EmailAccountRegistrationInputSchema = z.object({
  connectionId: z.string().min(1),
  emailAddress: z.string().email(),
  displayName: z.string().min(1),
});
export type EmailAccountRegistrationInput = z.infer<typeof EmailAccountRegistrationInputSchema>;
