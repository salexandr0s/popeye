import { z } from 'zod';

export const PlaybookScopeSchema = z.enum(['global', 'workspace', 'project']);
export type PlaybookScope = z.infer<typeof PlaybookScopeSchema>;

export const PlaybookStatusSchema = z.enum(['draft', 'active', 'retired']);
export type PlaybookStatus = z.infer<typeof PlaybookStatusSchema>;

export const PlaybookProposalKindSchema = z.enum(['draft', 'patch']);
export type PlaybookProposalKind = z.infer<typeof PlaybookProposalKindSchema>;

export const PlaybookProposalStatusSchema = z.enum(['drafting', 'pending_review', 'approved', 'rejected', 'applied']);
export type PlaybookProposalStatus = z.infer<typeof PlaybookProposalStatusSchema>;

export const PlaybookProposalSourceSchema = z.enum(['operator_api', 'runtime_tool', 'maintenance_job']);
export type PlaybookProposalSource = z.infer<typeof PlaybookProposalSourceSchema>;

export const PlaybookEffectivenessSchema = z.object({
  useCount30d: z.number().int().nonnegative(),
  succeededRuns30d: z.number().int().nonnegative(),
  failedRuns30d: z.number().int().nonnegative(),
  intervenedRuns30d: z.number().int().nonnegative(),
  successRate30d: z.number().min(0).max(1),
  failureRate30d: z.number().min(0).max(1),
  interventionRate30d: z.number().min(0).max(1),
  lastUsedAt: z.string().nullable().default(null),
  lastUpdatedAt: z.string(),
});
export type PlaybookEffectiveness = z.infer<typeof PlaybookEffectivenessSchema>;

export const PlaybookProposalEvidenceMetricsSchema = z.object({
  useCount30d: z.number().int().nonnegative(),
  failedRuns30d: z.number().int().nonnegative(),
  interventions30d: z.number().int().nonnegative(),
});
export type PlaybookProposalEvidenceMetrics = z.infer<typeof PlaybookProposalEvidenceMetricsSchema>;

export const PlaybookProposalEvidenceSchema = z.object({
  runIds: z.array(z.string().min(1)).default([]),
  interventionIds: z.array(z.string().min(1)).default([]),
  lastProblemAt: z.string().nullable().default(null),
  metrics30d: PlaybookProposalEvidenceMetricsSchema,
  suggestedPatchNote: z.string().default(''),
});
export type PlaybookProposalEvidence = z.infer<typeof PlaybookProposalEvidenceSchema>;

export const PlaybookFrontMatterSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: PlaybookStatusSchema.default('active'),
  allowedProfileIds: z.array(z.string().min(1)).default([]),
});
export type PlaybookFrontMatter = z.infer<typeof PlaybookFrontMatterSchema>;

export const ResolvedPlaybookSchema = z.object({
  recordId: z.string().min(1),
  id: z.string().min(1),
  title: z.string().min(1),
  status: PlaybookStatusSchema,
  scope: PlaybookScopeSchema,
  workspaceId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  path: z.string().min(1),
  body: z.string(),
  contentHash: z.string(),
  revisionHash: z.string(),
  allowedProfileIds: z.array(z.string().min(1)).default([]),
});
export type ResolvedPlaybook = z.infer<typeof ResolvedPlaybookSchema>;

export const AppliedPlaybookSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  scope: PlaybookScopeSchema,
  revisionHash: z.string(),
});
export type AppliedPlaybook = z.infer<typeof AppliedPlaybookSchema>;

export const PlaybookRecordSchema = z.object({
  recordId: z.string().min(1),
  playbookId: z.string().min(1),
  scope: PlaybookScopeSchema,
  workspaceId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  title: z.string().min(1),
  status: PlaybookStatusSchema,
  allowedProfileIds: z.array(z.string().min(1)).default([]),
  filePath: z.string().min(1),
  currentRevisionHash: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  effectiveness: PlaybookEffectivenessSchema.nullable().default(null),
});
export type PlaybookRecord = z.infer<typeof PlaybookRecordSchema>;

export const PlaybookSearchResultSchema = z.object({
  recordId: z.string().min(1),
  playbookId: z.string().min(1),
  title: z.string().min(1),
  scope: PlaybookScopeSchema,
  workspaceId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  status: PlaybookStatusSchema,
  currentRevisionHash: z.string().min(1),
  allowedProfileIds: z.array(z.string().min(1)).default([]),
  snippet: z.string().default(''),
  score: z.number().nonnegative(),
});
export type PlaybookSearchResult = z.infer<typeof PlaybookSearchResultSchema>;

export const PlaybookRevisionRecordSchema = z.object({
  playbookRecordId: z.string().min(1),
  revisionHash: z.string().min(1),
  title: z.string().min(1),
  status: PlaybookStatusSchema,
  allowedProfileIds: z.array(z.string().min(1)).default([]),
  filePath: z.string().min(1),
  contentHash: z.string().min(1),
  markdownText: z.string().default(''),
  createdAt: z.string(),
  current: z.boolean().default(false),
});
export type PlaybookRevisionRecord = z.infer<typeof PlaybookRevisionRecordSchema>;

export const PlaybookDetailSchema = PlaybookRecordSchema.extend({
  body: z.string(),
  markdownText: z.string(),
  indexedMemoryId: z.string().nullable().default(null),
});
export type PlaybookDetail = z.infer<typeof PlaybookDetailSchema>;

export const PlaybookUsageRunRecordSchema = z.object({
  runId: z.string().min(1),
  taskId: z.string().min(1),
  jobId: z.string().min(1),
  runState: z.string().min(1),
  startedAt: z.string(),
  finishedAt: z.string().nullable().default(null),
  interventionCount: z.number().int().nonnegative(),
  receiptId: z.string().nullable().default(null),
});
export type PlaybookUsageRunRecord = z.infer<typeof PlaybookUsageRunRecordSchema>;

export const PlaybookStaleCandidateSchema = z.object({
  recordId: z.string().min(1),
  title: z.string().min(1),
  scope: PlaybookScopeSchema,
  currentRevisionHash: z.string().min(1),
  lastUsedAt: z.string().nullable().default(null),
  useCount30d: z.number().int().nonnegative(),
  failedRuns30d: z.number().int().nonnegative(),
  interventions30d: z.number().int().nonnegative(),
  lastProposalAt: z.string().nullable().default(null),
  indexedMemoryId: z.string().nullable().default(null),
  reasons: z.array(z.string()).default([]),
});
export type PlaybookStaleCandidate = z.infer<typeof PlaybookStaleCandidateSchema>;

export const PlaybookProposalRecordSchema = z.object({
  id: z.string().min(1),
  kind: PlaybookProposalKindSchema,
  status: PlaybookProposalStatusSchema,
  targetRecordId: z.string().nullable().default(null),
  baseRevisionHash: z.string().nullable().default(null),
  playbookId: z.string().min(1),
  scope: PlaybookScopeSchema,
  workspaceId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  title: z.string().min(1),
  proposedStatus: PlaybookStatusSchema,
  allowedProfileIds: z.array(z.string().min(1)).default([]),
  summary: z.string().default(''),
  body: z.string(),
  markdownText: z.string(),
  diffPreview: z.string().default(''),
  contentHash: z.string().min(1),
  revisionHash: z.string().min(1),
  scanVerdict: z.enum(['allow', 'sanitize']),
  scanMatchedRules: z.array(z.string()).default([]),
  sourceRunId: z.string().nullable().default(null),
  proposedBy: PlaybookProposalSourceSchema,
  evidence: PlaybookProposalEvidenceSchema.nullable().default(null),
  reviewedBy: z.string().nullable().default(null),
  reviewedAt: z.string().nullable().default(null),
  reviewNote: z.string().nullable().default(null),
  appliedRecordId: z.string().nullable().default(null),
  appliedRevisionHash: z.string().nullable().default(null),
  appliedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PlaybookProposalRecord = z.infer<typeof PlaybookProposalRecordSchema>;
