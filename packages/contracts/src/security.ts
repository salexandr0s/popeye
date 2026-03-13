import { z } from 'zod';

export const PromptScanVerdictSchema = z.enum(['allow', 'sanitize', 'quarantine']);
export type PromptScanVerdict = z.infer<typeof PromptScanVerdictSchema>;

export const PromptScanResultSchema = z.object({
  verdict: PromptScanVerdictSchema,
  sanitizedText: z.string(),
  matchedRules: z.array(z.string()).default([]),
});
export type PromptScanResult = z.infer<typeof PromptScanResultSchema>;

export const CriticalFileMutationRequestSchema = z.object({
  path: z.string(),
  approved: z.boolean().default(false),
});
export type CriticalFileMutationRequest = z.infer<typeof CriticalFileMutationRequestSchema>;

export const CriticalFilePolicyDecisionSchema = z.object({
  allowed: z.boolean(),
  reason: z.string(),
  requiresReceipt: z.boolean(),
});
export type CriticalFilePolicyDecision = z.infer<typeof CriticalFilePolicyDecisionSchema>;

export const SecurityAuditFindingSchema = z.object({
  code: z.string(),
  severity: z.enum(['info', 'warn', 'error']),
  message: z.string(),
});
export type SecurityAuditFinding = z.infer<typeof SecurityAuditFindingSchema>;

export const SecurityAuditEventSchema = z.object({
  code: z.string(),
  severity: z.enum(['info', 'warn', 'error']),
  message: z.string(),
  component: z.string(),
  timestamp: z.string(),
  details: z.record(z.string(), z.string()).default({}),
});
export type SecurityAuditEvent = z.infer<typeof SecurityAuditEventSchema>;

export const AuthTokenRecordSchema = z.object({
  token: z.string().min(32),
  createdAt: z.string(),
  expiresAt: z.string().optional(),
});
export type AuthTokenRecord = z.infer<typeof AuthTokenRecordSchema>;

export const AuthRotationRecordSchema = z.object({
  current: AuthTokenRecordSchema,
  next: AuthTokenRecordSchema.optional(),
  overlapEndsAt: z.string().optional(),
});
export type AuthRotationRecord = z.infer<typeof AuthRotationRecordSchema>;
