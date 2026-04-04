import { z } from 'zod';

import { UsageMetricsSchema } from './engine.js';
import { OAuthProviderAvailabilityStatusSchema } from './oauth.js';
import { AuthRoleSchema } from './security.js';

export const TelegramConfigRecordSchema = z.object({
  enabled: z.boolean(),
  allowedUserId: z.string().nullable().default(null),
  secretRefId: z.string().nullable().default(null),
});
export type TelegramConfigRecord = z.infer<typeof TelegramConfigRecordSchema>;

export const TelegramConfigUpdateInputSchema = TelegramConfigRecordSchema;
export type TelegramConfigUpdateInput = z.infer<typeof TelegramConfigUpdateInputSchema>;

export const TelegramSecretAvailabilitySchema = z.enum(['not_configured', 'available', 'missing']);
export type TelegramSecretAvailability = z.infer<typeof TelegramSecretAvailabilitySchema>;

export const TelegramManagementModeSchema = z.enum(['launchd', 'manual']);
export type TelegramManagementMode = z.infer<typeof TelegramManagementModeSchema>;

export const TelegramConfigSnapshotSchema = z.object({
  persisted: TelegramConfigRecordSchema,
  applied: TelegramConfigRecordSchema,
  effectiveWorkspaceId: z.string(),
  secretAvailability: TelegramSecretAvailabilitySchema,
  staleComparedToApplied: z.boolean(),
  warnings: z.array(z.string()).default([]),
  managementMode: TelegramManagementModeSchema,
  restartSupported: z.boolean(),
});
export type TelegramConfigSnapshot = z.infer<typeof TelegramConfigSnapshotSchema>;

export const TelegramApplyStatusSchema = z.enum([
  'reloaded_active',
  'reloaded_inactive',
  'disabled',
  'failed_rolled_back',
  'failed_stopped',
]);
export type TelegramApplyStatus = z.infer<typeof TelegramApplyStatusSchema>;

export const TelegramApplyResponseSchema = z.object({
  status: TelegramApplyStatusSchema,
  summary: z.string(),
  snapshot: TelegramConfigSnapshotSchema,
});
export type TelegramApplyResponse = z.infer<typeof TelegramApplyResponseSchema>;

export const DaemonRestartStatusSchema = z.enum(['scheduled', 'manual_required']);
export type DaemonRestartStatus = z.infer<typeof DaemonRestartStatusSchema>;

export const DaemonRestartResponseSchema = z.object({
  status: DaemonRestartStatusSchema,
  summary: z.string(),
  managementMode: TelegramManagementModeSchema,
  restartSupported: z.boolean(),
});
export type DaemonRestartResponse = z.infer<typeof DaemonRestartResponseSchema>;

export const ProviderAuthProviderSchema = z.enum(['google', 'github']);
export type ProviderAuthProvider = z.infer<typeof ProviderAuthProviderSchema>;

export const ProviderAuthSecretAvailabilitySchema = z.enum(['not_configured', 'available', 'missing']);
export type ProviderAuthSecretAvailability = z.infer<typeof ProviderAuthSecretAvailabilitySchema>;

export const ProviderAuthConfigRecordSchema = z.object({
  provider: ProviderAuthProviderSchema,
  clientId: z.string().nullable().default(null),
  clientSecretRefId: z.string().nullable().default(null),
  secretAvailability: ProviderAuthSecretAvailabilitySchema,
  status: OAuthProviderAvailabilityStatusSchema,
  details: z.string(),
});
export type ProviderAuthConfigRecord = z.infer<typeof ProviderAuthConfigRecordSchema>;

export const ProviderAuthConfigListResponseSchema = z.array(ProviderAuthConfigRecordSchema);
export type ProviderAuthConfigListResponse = z.infer<typeof ProviderAuthConfigListResponseSchema>;

export const ProviderAuthConfigUpdateInputSchema = z.object({
  clientId: z.string().nullable().optional(),
  clientSecret: z.string().nullable().optional(),
  clearStoredSecret: z.boolean().default(false),
});
export type ProviderAuthConfigUpdateInput = z.infer<typeof ProviderAuthConfigUpdateInputSchema>;

export const MutationReceiptKindSchema = z.enum([
  'telegram_config_update',
  'provider_auth_update',
  'telegram_apply',
  'daemon_restart',
  'automation_update',
  'automation_run_now',
  'automation_pause',
  'automation_resume',
  'curated_document_save',
  'knowledge_import',
  'knowledge_revision_apply',
  'knowledge_revision_reject',
]);
export type MutationReceiptKind = z.infer<typeof MutationReceiptKindSchema>;

export const MutationReceiptStatusSchema = z.enum(['succeeded', 'failed', 'scheduled']);
export type MutationReceiptStatus = z.infer<typeof MutationReceiptStatusSchema>;

export const MutationReceiptRecordSchema = z.object({
  id: z.string(),
  kind: MutationReceiptKindSchema,
  component: z.string(),
  status: MutationReceiptStatusSchema,
  summary: z.string(),
  details: z.string(),
  actorRole: AuthRoleSchema,
  workspaceId: z.string().nullable().default(null),
  usage: UsageMetricsSchema,
  metadata: z.record(z.string(), z.string()).default({}),
  createdAt: z.string(),
});
export type MutationReceiptRecord = z.infer<typeof MutationReceiptRecordSchema>;

export const MutationReceiptListResponseSchema = z.array(MutationReceiptRecordSchema);
export type MutationReceiptListResponse = z.infer<typeof MutationReceiptListResponseSchema>;
