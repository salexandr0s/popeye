import { z } from 'zod';
import { DomainKindSchema, ContextReleasePolicySchema } from './domain.js';

export const ContextReleaseDecisionSchema = z.object({
  id: z.string(),
  domain: DomainKindSchema,
  vaultId: z.string().nullable().default(null),
  sourceRef: z.string(),
  releaseLevel: ContextReleasePolicySchema,
  approvalId: z.string().nullable().default(null),
  runId: z.string().nullable().default(null),
  tokenEstimate: z.number().int().nonnegative().default(0),
  redacted: z.boolean().default(false),
  createdAt: z.string(),
});
export type ContextReleaseDecision = z.infer<typeof ContextReleaseDecisionSchema>;

export const ContextReleasePreviewSchema = z.object({
  domain: DomainKindSchema,
  sourceRef: z.string(),
  releaseLevel: ContextReleasePolicySchema,
  previewText: z.string(),
  tokenEstimate: z.number().int().nonnegative(),
  requiresApproval: z.boolean(),
  redactionApplied: z.boolean(),
});
export type ContextReleasePreview = z.infer<typeof ContextReleasePreviewSchema>;
