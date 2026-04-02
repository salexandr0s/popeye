import { z } from 'zod';

import { MutationReceiptRecordSchema } from './control-plane.js';

export const CuratedDocumentKindSchema = z.enum([
  'workspace_instructions',
  'project_instructions',
  'workspace_soul',
  'workspace_identity',
  'curated_memory',
  'daily_memory_note',
]);
export type CuratedDocumentKind = z.infer<typeof CuratedDocumentKindSchema>;

export const CuratedDocumentSummarySchema = z.object({
  id: z.string(),
  kind: CuratedDocumentKindSchema,
  workspaceId: z.string(),
  projectId: z.string().nullable().default(null),
  title: z.string(),
  subtitle: z.string().default(''),
  filePath: z.string(),
  writable: z.boolean().default(true),
  critical: z.boolean().default(false),
  exists: z.boolean().default(true),
  updatedAt: z.string().nullable().default(null),
});
export type CuratedDocumentSummary = z.infer<typeof CuratedDocumentSummarySchema>;

export const CuratedDocumentRecordSchema = CuratedDocumentSummarySchema.extend({
  markdownText: z.string().default(''),
  revisionHash: z.string().nullable().default(null),
});
export type CuratedDocumentRecord = z.infer<typeof CuratedDocumentRecordSchema>;

export const CuratedDocumentSaveProposalStatusSchema = z.enum(['ready', 'conflict']);
export type CuratedDocumentSaveProposalStatus = z.infer<typeof CuratedDocumentSaveProposalStatusSchema>;

export const CuratedDocumentProposeSaveInputSchema = z.object({
  markdownText: z.string(),
  baseRevisionHash: z.string().nullable().optional(),
});
export type CuratedDocumentProposeSaveInput = z.infer<typeof CuratedDocumentProposeSaveInputSchema>;

export const CuratedDocumentApplySaveInputSchema = CuratedDocumentProposeSaveInputSchema.extend({
  confirmedCriticalWrite: z.boolean().default(false),
});
export type CuratedDocumentApplySaveInput = z.infer<typeof CuratedDocumentApplySaveInputSchema>;

export const CuratedDocumentSaveProposalSchema = z.object({
  documentId: z.string(),
  status: CuratedDocumentSaveProposalStatusSchema,
  normalizedMarkdown: z.string(),
  diffPreview: z.string(),
  baseRevisionHash: z.string().nullable().default(null),
  currentRevisionHash: z.string().nullable().default(null),
  requiresExplicitConfirmation: z.boolean().default(false),
  redactionApplied: z.boolean().default(false),
  conflictMessage: z.string().nullable().default(null),
});
export type CuratedDocumentSaveProposal = z.infer<typeof CuratedDocumentSaveProposalSchema>;

export const CuratedDocumentApplyResultSchema = z.object({
  document: CuratedDocumentRecordSchema,
  receipt: MutationReceiptRecordSchema,
});
export type CuratedDocumentApplyResult = z.infer<typeof CuratedDocumentApplyResultSchema>;
