import { z } from 'zod';
import { DomainKindSchema } from './domain.js';

export const ConnectionProviderKindSchema = z.enum(['gmail', 'proton', 'google_calendar', 'github', 'todoist', 'local_fs', 'local']);
export type ConnectionProviderKind = z.infer<typeof ConnectionProviderKindSchema>;

export const ConnectionModeSchema = z.enum(['read_only', 'read_write']);
export type ConnectionMode = z.infer<typeof ConnectionModeSchema>;

export const ConnectionSyncStatusSchema = z.enum(['success', 'partial', 'failed']);
export type ConnectionSyncStatus = z.infer<typeof ConnectionSyncStatusSchema>;

export const ConnectionPolicyDiagnosticSchema = z.object({
  code: z.string(),
  severity: z.enum(['info', 'warn', 'error']),
  message: z.string(),
});
export type ConnectionPolicyDiagnostic = z.infer<typeof ConnectionPolicyDiagnosticSchema>;

export const ConnectionReadinessStatusSchema = z.enum(['ready', 'disabled', 'incomplete']);
export type ConnectionReadinessStatus = z.infer<typeof ConnectionReadinessStatusSchema>;

export const ConnectionSecretStatusSchema = z.enum(['not_required', 'configured', 'missing', 'stale']);
export type ConnectionSecretStatus = z.infer<typeof ConnectionSecretStatusSchema>;

export const ConnectionPolicySummarySchema = z.object({
  status: ConnectionReadinessStatusSchema.default('ready'),
  secretStatus: ConnectionSecretStatusSchema.default('not_required'),
  mutatingRequiresApproval: z.boolean().default(false),
  diagnostics: z.array(ConnectionPolicyDiagnosticSchema).default([]),
});
export type ConnectionPolicySummary = z.infer<typeof ConnectionPolicySummarySchema>;

export const ConnectionRecordSchema = z.object({
  id: z.string(),
  domain: DomainKindSchema,
  providerKind: ConnectionProviderKindSchema,
  label: z.string(),
  mode: ConnectionModeSchema.default('read_only'),
  secretRefId: z.string().nullable().default(null),
  enabled: z.boolean().default(true),
  syncIntervalSeconds: z.number().int().positive().default(900),
  allowedScopes: z.array(z.string()).default([]),
  allowedResources: z.array(z.string()).default([]),
  lastSyncAt: z.string().nullable().default(null),
  lastSyncStatus: ConnectionSyncStatusSchema.nullable().default(null),
  policy: ConnectionPolicySummarySchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ConnectionRecord = z.infer<typeof ConnectionRecordSchema>;

export const ConnectionCreateInputSchema = z.object({
  domain: DomainKindSchema,
  providerKind: ConnectionProviderKindSchema,
  label: z.string().min(1),
  mode: ConnectionModeSchema.default('read_only'),
  secretRefId: z.string().nullable().default(null),
  syncIntervalSeconds: z.number().int().positive().default(900),
  allowedScopes: z.array(z.string()).default([]),
  allowedResources: z.array(z.string()).default([]),
});
export type ConnectionCreateInput = z.infer<typeof ConnectionCreateInputSchema>;

export const ConnectionUpdateInputSchema = z.object({
  label: z.string().min(1).optional(),
  mode: ConnectionModeSchema.optional(),
  secretRefId: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  syncIntervalSeconds: z.number().int().positive().optional(),
  allowedScopes: z.array(z.string()).optional(),
  allowedResources: z.array(z.string()).optional(),
});
export type ConnectionUpdateInput = z.infer<typeof ConnectionUpdateInputSchema>;
