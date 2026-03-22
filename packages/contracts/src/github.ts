import { z } from 'zod';

// --- GitHub Account Record ---

export const GithubAccountRecordSchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  githubUsername: z.string(),
  displayName: z.string(),
  syncCursorSince: z.string().nullable().default(null),
  lastSyncAt: z.string().nullable().default(null),
  repoCount: z.number().int().nonnegative().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GithubAccountRecord = z.infer<typeof GithubAccountRecordSchema>;

// --- GitHub Repo Record ---

export const GithubRepoRecordSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  githubRepoId: z.number().int(),
  owner: z.string(),
  name: z.string(),
  fullName: z.string(),
  description: z.string().default(''),
  isPrivate: z.boolean().default(false),
  isFork: z.boolean().default(false),
  defaultBranch: z.string().default('main'),
  language: z.string().nullable().default(null),
  starsCount: z.number().int().nonnegative().default(0),
  openIssuesCount: z.number().int().nonnegative().default(0),
  lastPushedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GithubRepoRecord = z.infer<typeof GithubRepoRecordSchema>;

// --- GitHub Pull Request Record ---

const GithubPrStateSchema = z.enum(['open', 'closed', 'merged']);

const GithubReviewDecisionSchema = z.enum(['approved', 'changes_requested', 'review_required']).nullable().default(null);

const GithubCiStatusSchema = z.enum(['success', 'failure', 'pending']).nullable().default(null);

export const GithubPullRequestRecordSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  repoId: z.string(),
  githubPrNumber: z.number().int(),
  title: z.string(),
  bodyPreview: z.string().default(''),
  author: z.string(),
  state: GithubPrStateSchema,
  isDraft: z.boolean().default(false),
  reviewDecision: GithubReviewDecisionSchema,
  ciStatus: GithubCiStatusSchema,
  headBranch: z.string(),
  baseBranch: z.string(),
  additions: z.number().int().nonnegative().default(0),
  deletions: z.number().int().nonnegative().default(0),
  changedFiles: z.number().int().nonnegative().default(0),
  labels: z.array(z.string()).default([]),
  requestedReviewers: z.array(z.string()).default([]),
  createdAtGh: z.string(),
  updatedAtGh: z.string(),
  mergedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GithubPullRequestRecord = z.infer<typeof GithubPullRequestRecordSchema>;

// --- GitHub Issue Record ---

const GithubIssueStateSchema = z.enum(['open', 'closed']);

export const GithubIssueRecordSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  repoId: z.string(),
  githubIssueNumber: z.number().int(),
  title: z.string(),
  bodyPreview: z.string().default(''),
  author: z.string(),
  state: GithubIssueStateSchema,
  labels: z.array(z.string()).default([]),
  assignees: z.array(z.string()).default([]),
  milestone: z.string().nullable().default(null),
  isAssignedToMe: z.boolean().default(false),
  isMentioned: z.boolean().default(false),
  createdAtGh: z.string(),
  updatedAtGh: z.string(),
  closedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GithubIssueRecord = z.infer<typeof GithubIssueRecordSchema>;

// --- GitHub Notification Record ---

export const GithubNotificationRecordSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  githubNotificationId: z.string(),
  repoFullName: z.string(),
  subjectTitle: z.string(),
  subjectType: z.string(),
  reason: z.string(),
  isUnread: z.boolean().default(true),
  updatedAtGh: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GithubNotificationRecord = z.infer<typeof GithubNotificationRecordSchema>;

// --- GitHub Digest Record ---

export const GithubDigestRecordSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  workspaceId: z.string(),
  date: z.string(),
  openPrsCount: z.number().int().nonnegative(),
  reviewRequestsCount: z.number().int().nonnegative(),
  assignedIssuesCount: z.number().int().nonnegative(),
  unreadNotificationsCount: z.number().int().nonnegative(),
  summaryMarkdown: z.string(),
  generatedAt: z.string(),
});
export type GithubDigestRecord = z.infer<typeof GithubDigestRecordSchema>;

// --- GitHub Search ---

const GithubSearchEntityTypeSchema = z.enum(['pr', 'issue', 'all']).default('all');

export const GithubSearchQuerySchema = z.object({
  query: z.string().min(1),
  accountId: z.string().optional(),
  limit: z.number().int().positive().max(100).default(20),
  entityType: GithubSearchEntityTypeSchema.optional(),
});
export type GithubSearchQuery = z.infer<typeof GithubSearchQuerySchema>;

export const GithubSearchResultSchema = z.object({
  entityType: z.enum(['pr', 'issue']),
  entityId: z.string(),
  repoFullName: z.string(),
  number: z.number().int(),
  title: z.string(),
  author: z.string(),
  state: z.string(),
  updatedAt: z.string(),
  score: z.number(),
});
export type GithubSearchResult = z.infer<typeof GithubSearchResultSchema>;

// --- GitHub Sync Result ---

export const GithubSyncResultSchema = z.object({
  accountId: z.string(),
  reposSynced: z.number().int().nonnegative(),
  prsSynced: z.number().int().nonnegative(),
  issuesSynced: z.number().int().nonnegative(),
  notificationsSynced: z.number().int().nonnegative(),
  errors: z.array(z.string()),
});
export type GithubSyncResult = z.infer<typeof GithubSyncResultSchema>;

export const GithubCommentRecordSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  repoFullName: z.string(),
  issueNumber: z.number().int().positive(),
  bodyPreview: z.string(),
  htmlUrl: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type GithubCommentRecord = z.infer<typeof GithubCommentRecordSchema>;

export const GithubCommentCreateInputSchema = z.object({
  accountId: z.string().min(1),
  repoFullName: z.string().min(1),
  issueNumber: z.number().int().positive(),
  body: z.string().min(1),
});
export type GithubCommentCreateInput = z.infer<typeof GithubCommentCreateInputSchema>;

export const GithubNotificationMarkReadInputSchema = z.object({
  notificationId: z.string().min(1),
});
export type GithubNotificationMarkReadInput = z.infer<typeof GithubNotificationMarkReadInputSchema>;

// --- GitHub Account Registration Input ---

export const GithubAccountRegistrationInputSchema = z.object({
  connectionId: z.string().min(1),
  githubUsername: z.string().min(1),
  displayName: z.string().min(1),
});
export type GithubAccountRegistrationInput = z.infer<typeof GithubAccountRegistrationInputSchema>;
