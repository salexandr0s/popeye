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

export const ConnectionHealthStatusSchema = z.enum(['unknown', 'healthy', 'degraded', 'reauth_required', 'error']);
export type ConnectionHealthStatus = z.infer<typeof ConnectionHealthStatusSchema>;

export const ConnectionAuthStateSchema = z.enum([
  'not_required',
  'configured',
  'missing',
  'stale',
  'expired',
  'revoked',
  'invalid_scopes',
]);
export type ConnectionAuthState = z.infer<typeof ConnectionAuthStateSchema>;

export const ConnectionCursorKindSchema = z.enum(['none', 'history_id', 'sync_token', 'since']);
export type ConnectionCursorKind = z.infer<typeof ConnectionCursorKindSchema>;

export const ConnectionResourceTypeSchema = z.enum([
  'resource',
  'mailbox',
  'calendar',
  'repo',
  'project',
]);
export type ConnectionResourceType = z.infer<typeof ConnectionResourceTypeSchema>;

export const ConnectionResourceRuleSchema = z.object({
  resourceType: ConnectionResourceTypeSchema,
  resourceId: z.string().min(1),
  displayName: z.string().min(1),
  writeAllowed: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ConnectionResourceRule = z.infer<typeof ConnectionResourceRuleSchema>;

export const ConnectionRemediationActionSchema = z.enum([
  'reauthorize',
  'reconnect',
  'scope_fix',
  'secret_fix',
]);
export type ConnectionRemediationAction = z.infer<typeof ConnectionRemediationActionSchema>;

export const ConnectionRemediationSchema = z.object({
  action: ConnectionRemediationActionSchema,
  message: z.string(),
  updatedAt: z.string(),
});
export type ConnectionRemediation = z.infer<typeof ConnectionRemediationSchema>;

export const ConnectionPolicySummarySchema = z.object({
  status: ConnectionReadinessStatusSchema.default('ready'),
  secretStatus: ConnectionSecretStatusSchema.default('not_required'),
  mutatingRequiresApproval: z.boolean().default(false),
  diagnostics: z.array(ConnectionPolicyDiagnosticSchema).default([]),
});
export type ConnectionPolicySummary = z.infer<typeof ConnectionPolicySummarySchema>;

export const ConnectionHealthSummarySchema = z.object({
  status: ConnectionHealthStatusSchema.default('unknown'),
  authState: ConnectionAuthStateSchema.default('not_required'),
  checkedAt: z.string().nullable().default(null),
  lastError: z.string().nullable().default(null),
  diagnostics: z.array(ConnectionPolicyDiagnosticSchema).default([]),
  remediation: ConnectionRemediationSchema.nullable().default(null),
});
export type ConnectionHealthSummary = z.infer<typeof ConnectionHealthSummarySchema>;

export const ConnectionSyncSummarySchema = z.object({
  lastAttemptAt: z.string().nullable().default(null),
  lastSuccessAt: z.string().nullable().default(null),
  status: z.enum(['idle', 'success', 'partial', 'failed']).default('idle'),
  cursorKind: ConnectionCursorKindSchema.default('none'),
  cursorPresent: z.boolean().default(false),
  lagSummary: z.string().default(''),
});
export type ConnectionSyncSummary = z.infer<typeof ConnectionSyncSummarySchema>;

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
  resourceRules: z.array(ConnectionResourceRuleSchema).default([]),
  lastSyncAt: z.string().nullable().default(null),
  lastSyncStatus: ConnectionSyncStatusSchema.nullable().default(null),
  policy: ConnectionPolicySummarySchema.optional(),
  health: ConnectionHealthSummarySchema.optional(),
  sync: ConnectionSyncSummarySchema.optional(),
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
  resourceRules: z.array(
    ConnectionResourceRuleSchema.omit({
      createdAt: true,
      updatedAt: true,
    }),
  ).default([]),
});
export type ConnectionCreateInput = z.input<typeof ConnectionCreateInputSchema>;

export const ConnectionUpdateInputSchema = z.object({
  label: z.string().min(1).optional(),
  mode: ConnectionModeSchema.optional(),
  secretRefId: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  syncIntervalSeconds: z.number().int().positive().optional(),
  allowedScopes: z.array(z.string()).optional(),
  allowedResources: z.array(z.string()).optional(),
  resourceRules: z.array(
    ConnectionResourceRuleSchema.omit({
      createdAt: true,
      updatedAt: true,
    }),
  ).optional(),
});
export type ConnectionUpdateInput = z.input<typeof ConnectionUpdateInputSchema>;

// --- Resource-Rule CRUD inputs ---

export const ConnectionResourceRuleCreateInputSchema = ConnectionResourceRuleSchema.omit({
  createdAt: true,
  updatedAt: true,
});
export type ConnectionResourceRuleCreateInput = z.infer<typeof ConnectionResourceRuleCreateInputSchema>;

export const ConnectionResourceRuleDeleteInputSchema = z.object({
  resourceType: ConnectionResourceTypeSchema,
  resourceId: z.string().min(1),
});
export type ConnectionResourceRuleDeleteInput = z.infer<typeof ConnectionResourceRuleDeleteInputSchema>;

// --- Diagnostics & Reconnect ---

export const ConnectionDiagnosticsResponseSchema = z.object({
  connectionId: z.string(),
  label: z.string(),
  providerKind: ConnectionProviderKindSchema,
  domain: z.string(),
  enabled: z.boolean(),
  health: ConnectionHealthSummarySchema,
  sync: ConnectionSyncSummarySchema,
  policy: ConnectionPolicySummarySchema,
  remediation: ConnectionRemediationSchema.nullable(),
  humanSummary: z.string(),
});
export type ConnectionDiagnosticsResponse = z.infer<typeof ConnectionDiagnosticsResponseSchema>;

export const ConnectionReconnectRequestSchema = z.object({
  action: ConnectionRemediationActionSchema,
});
export type ConnectionReconnectRequest = z.infer<typeof ConnectionReconnectRequestSchema>;
