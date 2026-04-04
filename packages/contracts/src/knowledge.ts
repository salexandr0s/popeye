import { z } from 'zod';

import { MutationReceiptRecordSchema } from './control-plane.js';

export const KnowledgeSourceTypeSchema = z.enum([
  'local_file',
  'manual_text',
  'website',
  'pdf',
  'x_post',
  'repo',
  'dataset',
  'image',
]);
export type KnowledgeSourceType = z.infer<typeof KnowledgeSourceTypeSchema>;

export const KnowledgeConversionAdapterSchema = z.enum([
  'native',
  'jina_reader',
  'trafilatura',
  'markitdown',
  'docling',
]);
export type KnowledgeConversionAdapter = z.infer<typeof KnowledgeConversionAdapterSchema>;

export const KnowledgeConverterStatusSchema = z.enum(['ready', 'missing', 'degraded']);
export type KnowledgeConverterStatus = z.infer<typeof KnowledgeConverterStatusSchema>;

export const KnowledgeConverterProvenanceSchema = z.enum(['bundled', 'system', 'remote', 'missing']);
export type KnowledgeConverterProvenance = z.infer<typeof KnowledgeConverterProvenanceSchema>;

export const KnowledgeConverterIdSchema = z.enum([
  'jina_reader',
  'trafilatura',
  'markitdown',
  'docling',
]);
export type KnowledgeConverterId = z.infer<typeof KnowledgeConverterIdSchema>;

export const KnowledgeAssetStatusSchema = z.enum([
  'none',
  'localized',
  'partial_failure',
  'failed',
]);
export type KnowledgeAssetStatus = z.infer<typeof KnowledgeAssetStatusSchema>;

export const KnowledgeImportOutcomeSchema = z.enum(['created', 'updated', 'unchanged']);
export type KnowledgeImportOutcome = z.infer<typeof KnowledgeImportOutcomeSchema>;

export const KnowledgeSourceStatusSchema = z.enum([
  'pending',
  'imported',
  'converted',
  'conversion_failed',
  'compiled',
  'compiled_with_warnings',
  'degraded',
]);
export type KnowledgeSourceStatus = z.infer<typeof KnowledgeSourceStatusSchema>;

export const KnowledgeDocumentKindSchema = z.enum([
  'source_normalized',
  'wiki_article',
  'output_note',
]);
export type KnowledgeDocumentKind = z.infer<typeof KnowledgeDocumentKindSchema>;

export const KnowledgeDocumentStatusSchema = z.enum([
  'active',
  'draft_only',
  'archived',
]);
export type KnowledgeDocumentStatus = z.infer<typeof KnowledgeDocumentStatusSchema>;

export const KnowledgeRevisionStatusSchema = z.enum(['draft', 'applied', 'rejected']);
export type KnowledgeRevisionStatus = z.infer<typeof KnowledgeRevisionStatusSchema>;

export const KnowledgeLinkKindSchema = z.enum(['markdown', 'wikilink', 'compiled_from', 'citation', 'related']);
export type KnowledgeLinkKind = z.infer<typeof KnowledgeLinkKindSchema>;

export const KnowledgeLinkStatusSchema = z.enum(['active', 'broken', 'unresolved']);
export type KnowledgeLinkStatus = z.infer<typeof KnowledgeLinkStatusSchema>;

export const KnowledgeCompileJobStatusSchema = z.enum(['queued', 'succeeded', 'failed']);
export type KnowledgeCompileJobStatus = z.infer<typeof KnowledgeCompileJobStatusSchema>;

export const KnowledgeSourceRecordSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  knowledgeRootId: z.string(),
  sourceType: KnowledgeSourceTypeSchema,
  title: z.string(),
  originalUri: z.string().nullable().default(null),
  originalPath: z.string().nullable().default(null),
  originalFileName: z.string().nullable().default(null),
  originalMediaType: z.string().nullable().default(null),
  adapter: KnowledgeConversionAdapterSchema,
  fallbackUsed: z.boolean().default(false),
  status: KnowledgeSourceStatusSchema,
  contentHash: z.string(),
  assetStatus: KnowledgeAssetStatusSchema.default('none'),
  latestOutcome: KnowledgeImportOutcomeSchema.default('created'),
  conversionWarnings: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type KnowledgeSourceRecord = z.infer<typeof KnowledgeSourceRecordSchema>;

export const KnowledgeDocumentRecordSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  knowledgeRootId: z.string(),
  sourceId: z.string().nullable().default(null),
  kind: KnowledgeDocumentKindSchema,
  title: z.string(),
  slug: z.string(),
  relativePath: z.string(),
  revisionHash: z.string().nullable().default(null),
  status: KnowledgeDocumentStatusSchema.default('active'),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type KnowledgeDocumentRecord = z.infer<typeof KnowledgeDocumentRecordSchema>;

export const KnowledgeDocumentDetailSchema = KnowledgeDocumentRecordSchema.extend({
  markdownText: z.string(),
  exists: z.boolean().default(true),
  sourceIds: z.array(z.string()).default([]),
});
export type KnowledgeDocumentDetail = z.infer<typeof KnowledgeDocumentDetailSchema>;

export const KnowledgeDocumentRevisionRecordSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  workspaceId: z.string(),
  status: KnowledgeRevisionStatusSchema,
  sourceKind: z.string(),
  sourceId: z.string().nullable().default(null),
  proposedTitle: z.string().nullable().default(null),
  proposedMarkdown: z.string(),
  diffPreview: z.string(),
  baseRevisionHash: z.string().nullable().default(null),
  createdAt: z.string(),
  appliedAt: z.string().nullable().default(null),
});
export type KnowledgeDocumentRevisionRecord = z.infer<typeof KnowledgeDocumentRevisionRecordSchema>;

export const KnowledgeLinkRecordSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  sourceDocumentId: z.string(),
  targetDocumentId: z.string().nullable().default(null),
  targetSlug: z.string().nullable().default(null),
  targetLabel: z.string(),
  linkKind: KnowledgeLinkKindSchema,
  linkStatus: KnowledgeLinkStatusSchema,
  confidence: z.number().min(0).max(1).default(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type KnowledgeLinkRecord = z.infer<typeof KnowledgeLinkRecordSchema>;

export const KnowledgeNeighborhoodSchema = z.object({
  document: KnowledgeDocumentRecordSchema,
  incoming: z.array(KnowledgeLinkRecordSchema),
  outgoing: z.array(KnowledgeLinkRecordSchema),
  relatedDocuments: z.array(KnowledgeDocumentRecordSchema),
});
export type KnowledgeNeighborhood = z.infer<typeof KnowledgeNeighborhoodSchema>;

export const KnowledgeCompileJobRecordSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  sourceId: z.string().nullable().default(null),
  targetDocumentId: z.string().nullable().default(null),
  status: KnowledgeCompileJobStatusSchema,
  summary: z.string(),
  warnings: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type KnowledgeCompileJobRecord = z.infer<typeof KnowledgeCompileJobRecordSchema>;

export const KnowledgeAuditReportSchema = z.object({
  totalSources: z.number().int().nonnegative(),
  totalDocuments: z.number().int().nonnegative(),
  totalDraftRevisions: z.number().int().nonnegative(),
  unresolvedLinks: z.number().int().nonnegative(),
  brokenLinks: z.number().int().nonnegative(),
  failedConversions: z.number().int().nonnegative(),
  degradedSources: z.number().int().nonnegative(),
  warningSources: z.number().int().nonnegative(),
  assetLocalizationFailures: z.number().int().nonnegative(),
  lastCompileAt: z.string().nullable().default(null),
});
export type KnowledgeAuditReport = z.infer<typeof KnowledgeAuditReportSchema>;

export const KnowledgeImportInputSchema = z.object({
  workspaceId: z.string().min(1),
  sourceType: KnowledgeSourceTypeSchema,
  title: z.string().min(1),
  sourceUri: z.string().url().optional(),
  sourcePath: z.string().min(1).optional(),
  sourceText: z.string().min(1).optional(),
});
export type KnowledgeImportInput = z.infer<typeof KnowledgeImportInputSchema>;

export const KnowledgeDocumentRevisionProposalInputSchema = z.object({
  title: z.string().min(1).optional(),
  markdownText: z.string().min(1),
  baseRevisionHash: z.string().nullable().optional(),
});
export type KnowledgeDocumentRevisionProposalInput = z.infer<typeof KnowledgeDocumentRevisionProposalInputSchema>;

export const KnowledgeDocumentRevisionApplyInputSchema = z.object({
  approved: z.boolean().default(true),
});
export type KnowledgeDocumentRevisionApplyInput = z.infer<typeof KnowledgeDocumentRevisionApplyInputSchema>;

export const KnowledgeLinkCreateInputSchema = z.object({
  sourceDocumentId: z.string().min(1),
  targetDocumentId: z.string().optional(),
  targetSlug: z.string().optional(),
  targetLabel: z.string().min(1),
  linkKind: KnowledgeLinkKindSchema.default('related'),
});
export type KnowledgeLinkCreateInput = z.infer<typeof KnowledgeLinkCreateInputSchema>;

export const KnowledgeDocumentQuerySchema = z.object({
  workspaceId: z.string().min(1),
  kind: KnowledgeDocumentKindSchema.optional(),
  q: z.string().optional(),
});
export type KnowledgeDocumentQuery = z.infer<typeof KnowledgeDocumentQuerySchema>;

export const KnowledgeSourceListResponseSchema = z.array(KnowledgeSourceRecordSchema);
export const KnowledgeDocumentListResponseSchema = z.array(KnowledgeDocumentRecordSchema);
export const KnowledgeDocumentRevisionListResponseSchema = z.array(KnowledgeDocumentRevisionRecordSchema);
export const KnowledgeCompileJobListResponseSchema = z.array(KnowledgeCompileJobRecordSchema);

export const KnowledgeConverterAvailabilitySchema = z.object({
  id: KnowledgeConverterIdSchema,
  status: KnowledgeConverterStatusSchema,
  provenance: KnowledgeConverterProvenanceSchema,
  details: z.string(),
  version: z.string().nullable().default(null),
  lastCheckedAt: z.string(),
  installHint: z.string().nullable().default(null),
  usedFor: z.array(KnowledgeSourceTypeSchema).default([]),
  fallbackRank: z.number().int().positive(),
});
export type KnowledgeConverterAvailability = z.infer<typeof KnowledgeConverterAvailabilitySchema>;

export const KnowledgeConverterListResponseSchema = z.array(KnowledgeConverterAvailabilitySchema);
export type KnowledgeConverterListResponse = z.infer<typeof KnowledgeConverterListResponseSchema>;

export const KnowledgeSourceSnapshotRecordSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  workspaceId: z.string(),
  contentHash: z.string(),
  adapter: KnowledgeConversionAdapterSchema,
  fallbackUsed: z.boolean().default(false),
  status: KnowledgeSourceStatusSchema,
  assetStatus: KnowledgeAssetStatusSchema.default('none'),
  outcome: z.enum(['created', 'updated']).default('updated'),
  conversionWarnings: z.array(z.string()).default([]),
  createdAt: z.string(),
});
export type KnowledgeSourceSnapshotRecord = z.infer<typeof KnowledgeSourceSnapshotRecordSchema>;

export const KnowledgeSourceSnapshotListResponseSchema = z.array(KnowledgeSourceSnapshotRecordSchema);
export type KnowledgeSourceSnapshotListResponse = z.infer<typeof KnowledgeSourceSnapshotListResponseSchema>;

export const KnowledgeBetaReportRowSchema = z.object({
  label: z.string().min(1),
  title: z.string().min(1),
  sourceType: KnowledgeSourceTypeSchema,
  outcome: z.string().min(1),
  sourceId: z.string().optional(),
  adapter: KnowledgeConversionAdapterSchema.optional(),
  status: KnowledgeSourceStatusSchema.optional(),
  assetStatus: KnowledgeAssetStatusSchema.optional(),
  draftRevisionId: z.string().nullable().optional(),
  error: z.string().optional(),
});
export type KnowledgeBetaReportRow = z.infer<typeof KnowledgeBetaReportRowSchema>;

export const KnowledgeBetaGateCheckSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  passed: z.boolean(),
  details: z.string().min(1),
});
export type KnowledgeBetaGateCheck = z.infer<typeof KnowledgeBetaGateCheckSchema>;

export const KnowledgeBetaGateStatusSchema = z.enum(['passed', 'failed']);
export type KnowledgeBetaGateStatus = z.infer<typeof KnowledgeBetaGateStatusSchema>;

export const KnowledgeBetaGateSchema = z.object({
  status: KnowledgeBetaGateStatusSchema,
  minImportSuccessRate: z.number().min(0).max(1),
  actualImportSuccessRate: z.number().min(0).max(1),
  maxHardFailures: z.number().int().nonnegative(),
  actualHardFailures: z.number().int().nonnegative(),
  expectedReingestChecks: z.number().int().nonnegative().default(0),
  failedExpectedReingestChecks: z.number().int().nonnegative().default(0),
  checks: z.array(KnowledgeBetaGateCheckSchema).default([]),
});
export type KnowledgeBetaGate = z.infer<typeof KnowledgeBetaGateSchema>;

export const KnowledgeBetaRunRecordSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  manifestPath: z.string().nullable().default(null),
  importCount: z.number().int().nonnegative(),
  reingestCount: z.number().int().nonnegative(),
  hardFailureCount: z.number().int().nonnegative(),
  importSuccessRate: z.number().min(0).max(1),
  gateStatus: KnowledgeBetaGateStatusSchema,
  createdAt: z.string(),
});
export type KnowledgeBetaRunRecord = z.infer<typeof KnowledgeBetaRunRecordSchema>;

export const KnowledgeBetaRunDetailSchema = KnowledgeBetaRunRecordSchema.extend({
  reportMarkdown: z.string(),
  imports: z.array(KnowledgeBetaReportRowSchema).default([]),
  reingests: z.array(KnowledgeBetaReportRowSchema).default([]),
  converters: z.array(KnowledgeConverterAvailabilitySchema).default([]),
  audit: KnowledgeAuditReportSchema,
  gate: KnowledgeBetaGateSchema,
});
export type KnowledgeBetaRunDetail = z.infer<typeof KnowledgeBetaRunDetailSchema>;

export const KnowledgeBetaRunCreateInputSchema = z.object({
  workspaceId: z.string().min(1),
  manifestPath: z.string().nullable().optional(),
  reportMarkdown: z.string().min(1),
  imports: z.array(KnowledgeBetaReportRowSchema).min(1),
  reingests: z.array(KnowledgeBetaReportRowSchema).default([]),
  converters: z.array(KnowledgeConverterAvailabilitySchema).default([]),
  audit: KnowledgeAuditReportSchema,
  gate: KnowledgeBetaGateSchema,
});
export type KnowledgeBetaRunCreateInput = z.infer<typeof KnowledgeBetaRunCreateInputSchema>;

export const KnowledgeBetaRunListQuerySchema = z.object({
  workspaceId: z.string().min(1),
  limit: z.coerce.number().int().positive().max(20).optional(),
});
export type KnowledgeBetaRunListQuery = z.infer<typeof KnowledgeBetaRunListQuerySchema>;

export const KnowledgeBetaRunListResponseSchema = z.array(KnowledgeBetaRunRecordSchema);
export type KnowledgeBetaRunListResponse = z.infer<typeof KnowledgeBetaRunListResponseSchema>;

export const KnowledgeImportResultSchema = z.object({
  source: KnowledgeSourceRecordSchema,
  normalizedDocument: KnowledgeDocumentRecordSchema,
  compileJob: KnowledgeCompileJobRecordSchema,
  draftRevision: KnowledgeDocumentRevisionRecordSchema.nullable().default(null),
  outcome: KnowledgeImportOutcomeSchema.default('created'),
});
export type KnowledgeImportResult = z.infer<typeof KnowledgeImportResultSchema>;

export const KnowledgeRevisionApplyResultSchema = z.object({
  revision: KnowledgeDocumentRevisionRecordSchema,
  document: KnowledgeDocumentDetailSchema,
  receipt: MutationReceiptRecordSchema,
});
export type KnowledgeRevisionApplyResult = z.infer<typeof KnowledgeRevisionApplyResultSchema>;

export const KnowledgeRevisionRejectResultSchema = z.object({
  revision: KnowledgeDocumentRevisionRecordSchema,
  document: KnowledgeDocumentDetailSchema,
  receipt: MutationReceiptRecordSchema,
});
export type KnowledgeRevisionRejectResult = z.infer<typeof KnowledgeRevisionRejectResultSchema>;
