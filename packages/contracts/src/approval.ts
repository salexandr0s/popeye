import { z } from 'zod';
import { DomainKindSchema } from './domain.js';
import { TaskSourceSchema } from './execution.js';

const ApprovalScopeSchema = z.enum(['secret_access', 'vault_open', 'context_release', 'data_source_connect', 'external_write']);
export type ApprovalScope = z.infer<typeof ApprovalScopeSchema>;

export const ApprovalRiskClassSchema = z.enum(['auto', 'ask', 'deny']);
export type ApprovalRiskClass = z.infer<typeof ApprovalRiskClassSchema>;

const ApprovalStatusSchema = z.enum(['pending', 'approved', 'denied', 'expired']);

const ApprovalResolvedBySchema = z.enum(['operator', 'policy', 'standing_approval', 'automation_grant', 'expiry']);

const ActionKindSchema = z.enum([
  'read',
  'search',
  'sync',
  'import',
  'digest',
  'classify',
  'triage',
  'draft',
  'connect',
  'release_context',
  'open_vault',
  'write',
  'send',
  'delete',
]);
export type ActionKind = z.infer<typeof ActionKindSchema>;

const ActionResourceScopeSchema = z.enum(['global', 'workspace', 'project', 'run', 'connection', 'resource']);
export type ActionResourceScope = z.infer<typeof ActionResourceScopeSchema>;

export const ApprovalRecordSchema = z.object({
  id: z.string(),
  scope: ApprovalScopeSchema,
  domain: DomainKindSchema,
  riskClass: ApprovalRiskClassSchema,
  actionKind: ActionKindSchema.default('read'),
  resourceScope: ActionResourceScopeSchema.default('resource'),
  resourceType: z.string(),
  resourceId: z.string(),
  requestedBy: z.string(),
  runId: z.string().nullable().default(null),
  standingApprovalEligible: z.boolean().default(false),
  automationGrantEligible: z.boolean().default(false),
  interventionId: z.string().nullable().default(null),
  payloadPreview: z.string().max(4000).default(''),
  idempotencyKey: z.string().nullable().default(null),
  status: ApprovalStatusSchema.default('pending'),
  resolvedBy: ApprovalResolvedBySchema.nullable().default(null),
  resolvedByGrantId: z.string().nullable().default(null),
  decisionReason: z.string().nullable().default(null),
  expiresAt: z.string().nullable().default(null),
  createdAt: z.string(),
  resolvedAt: z.string().nullable().default(null),
});
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;

export const ApprovalRequestInputSchema = z.object({
  scope: ApprovalScopeSchema,
  domain: DomainKindSchema,
  riskClass: ApprovalRiskClassSchema,
  actionKind: ActionKindSchema.default('read'),
  resourceScope: ActionResourceScopeSchema.default('resource'),
  resourceType: z.string(),
  resourceId: z.string(),
  requestedBy: z.string(),
  runId: z.string().nullable().optional(),
  standingApprovalEligible: z.boolean().optional(),
  automationGrantEligible: z.boolean().optional(),
  payloadPreview: z.string().max(4000).optional(),
  idempotencyKey: z.string().optional(),
  expiresAt: z.string().optional(),
});
export type ApprovalRequestInput = z.infer<typeof ApprovalRequestInputSchema>;

export const ActionApprovalRequestInputSchema = z.object({
  scope: ApprovalScopeSchema,
  domain: DomainKindSchema,
  actionKind: ActionKindSchema,
  resourceScope: ActionResourceScopeSchema.default('resource'),
  resourceType: z.string(),
  resourceId: z.string(),
  requestedBy: z.string(),
  runId: z.string().nullable().optional(),
  payloadPreview: z.string().max(4000).optional(),
  idempotencyKey: z.string().optional(),
  expiresAt: z.string().optional(),
});
export type ActionApprovalRequestInput = z.infer<typeof ActionApprovalRequestInputSchema>;

export const ApprovalResolveInputSchema = z.object({
  decision: z.enum(['approved', 'denied']),
  decisionReason: z.string().optional(),
});
export type ApprovalResolveInput = z.infer<typeof ApprovalResolveInputSchema>;

export const ApprovalPolicyRuleSchema = z.object({
  scope: ApprovalScopeSchema,
  domain: DomainKindSchema,
  riskClass: ApprovalRiskClassSchema,
  actionKinds: z.array(ActionKindSchema).default([]),
  resourceScopes: z.array(ActionResourceScopeSchema).default([]),
});
export type ApprovalPolicyRule = z.infer<typeof ApprovalPolicyRuleSchema>;

export const ApprovalPolicyConfigSchema = z.object({
  rules: z.array(ApprovalPolicyRuleSchema).default([]),
  defaultRiskClass: ApprovalRiskClassSchema.default('ask'),
  pendingExpiryMinutes: z.number().int().positive().default(60),
});
export type ApprovalPolicyConfig = z.infer<typeof ApprovalPolicyConfigSchema>;

export const ActionPolicyDefaultSchema = z.object({
  scope: ApprovalScopeSchema,
  domain: DomainKindSchema.nullable().default(null),
  actionKind: ActionKindSchema,
  riskClass: ApprovalRiskClassSchema,
  standingApprovalEligible: z.boolean().default(false),
  automationGrantEligible: z.boolean().default(false),
  reason: z.string(),
});
export type ActionPolicyDefault = z.infer<typeof ActionPolicyDefaultSchema>;

const ActionPolicyEvaluationSourceSchema = z.enum(['rule', 'default', 'fallback']);

export const ActionPolicyEvaluationSchema = z.object({
  scope: ApprovalScopeSchema,
  domain: DomainKindSchema,
  actionKind: ActionKindSchema,
  resourceScope: ActionResourceScopeSchema.default('resource'),
  riskClass: ApprovalRiskClassSchema,
  standingApprovalEligible: z.boolean().default(false),
  automationGrantEligible: z.boolean().default(false),
  source: ActionPolicyEvaluationSourceSchema,
  reason: z.string(),
});
export type ActionPolicyEvaluation = z.infer<typeof ActionPolicyEvaluationSchema>;

const PolicyGrantStatusSchema = z.enum(['active', 'revoked', 'expired']);

const PolicyGrantBaseSchema = z.object({
  scope: ApprovalScopeSchema,
  domain: DomainKindSchema,
  actionKind: ActionKindSchema,
  resourceScope: ActionResourceScopeSchema.default('resource'),
  resourceType: z.string(),
  resourceId: z.string().nullable().default(null),
  requestedBy: z.string().nullable().default(null),
  workspaceId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  note: z.string().max(4000).default(''),
  expiresAt: z.string().nullable().default(null),
});

export const StandingApprovalRecordSchema = PolicyGrantBaseSchema.extend({
  id: z.string(),
  createdBy: z.string(),
  status: PolicyGrantStatusSchema.default('active'),
  createdAt: z.string(),
  revokedAt: z.string().nullable().default(null),
  revokedBy: z.string().nullable().default(null),
});
export type StandingApprovalRecord = z.infer<typeof StandingApprovalRecordSchema>;

export const StandingApprovalCreateInputSchema = PolicyGrantBaseSchema.extend({
  createdBy: z.string(),
});
export type StandingApprovalCreateInput = z.infer<typeof StandingApprovalCreateInputSchema>;

export const PolicyGrantRevokeInputSchema = z.object({
  revokedBy: z.string(),
});
export type PolicyGrantRevokeInput = z.infer<typeof PolicyGrantRevokeInputSchema>;

export const AutomationGrantRecordSchema = PolicyGrantBaseSchema.extend({
  id: z.string(),
  createdBy: z.string(),
  taskSources: z.array(TaskSourceSchema).default(['heartbeat', 'schedule']),
  status: PolicyGrantStatusSchema.default('active'),
  createdAt: z.string(),
  revokedAt: z.string().nullable().default(null),
  revokedBy: z.string().nullable().default(null),
});
export type AutomationGrantRecord = z.infer<typeof AutomationGrantRecordSchema>;

export const AutomationGrantCreateInputSchema = PolicyGrantBaseSchema.extend({
  createdBy: z.string(),
  taskSources: z.array(TaskSourceSchema).default(['heartbeat', 'schedule']),
});
export type AutomationGrantCreateInput = z.infer<typeof AutomationGrantCreateInputSchema>;
