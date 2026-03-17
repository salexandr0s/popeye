import { z } from 'zod';
import { DomainKindSchema } from './domain.js';

export const ApprovalScopeSchema = z.enum(['secret_access', 'vault_open', 'context_release', 'data_source_connect', 'external_write']);
export type ApprovalScope = z.infer<typeof ApprovalScopeSchema>;

export const ApprovalRiskClassSchema = z.enum(['auto', 'ask', 'deny']);
export type ApprovalRiskClass = z.infer<typeof ApprovalRiskClassSchema>;

export const ApprovalStatusSchema = z.enum(['pending', 'approved', 'denied', 'expired']);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const ApprovalResolvedBySchema = z.enum(['operator', 'policy', 'expiry']);
export type ApprovalResolvedBy = z.infer<typeof ApprovalResolvedBySchema>;

export const ApprovalRecordSchema = z.object({
  id: z.string(),
  scope: ApprovalScopeSchema,
  domain: DomainKindSchema,
  riskClass: ApprovalRiskClassSchema,
  resourceType: z.string(),
  resourceId: z.string(),
  requestedBy: z.string(),
  interventionId: z.string().nullable().default(null),
  payloadPreview: z.string().max(4000).default(''),
  idempotencyKey: z.string().nullable().default(null),
  status: ApprovalStatusSchema.default('pending'),
  resolvedBy: ApprovalResolvedBySchema.nullable().default(null),
  decisionReason: z.string().nullable().default(null),
  expiresAt: z.string().nullable().default(null),
  createdAt: z.string(),
  resolvedAt: z.string().nullable().default(null),
});
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;

export const ApprovalResolveInputSchema = z.object({
  decision: z.enum(['approved', 'denied']),
  decisionReason: z.string().optional(),
});
export type ApprovalResolveInput = z.infer<typeof ApprovalResolveInputSchema>;

export const ApprovalPolicyRuleSchema = z.object({
  scope: ApprovalScopeSchema,
  domain: DomainKindSchema,
  riskClass: ApprovalRiskClassSchema,
});
export type ApprovalPolicyRule = z.infer<typeof ApprovalPolicyRuleSchema>;

export const ApprovalPolicyConfigSchema = z.object({
  rules: z.array(ApprovalPolicyRuleSchema).default([]),
  defaultRiskClass: ApprovalRiskClassSchema.default('ask'),
  pendingExpiryMinutes: z.number().int().positive().default(60),
});
export type ApprovalPolicyConfig = z.infer<typeof ApprovalPolicyConfigSchema>;
