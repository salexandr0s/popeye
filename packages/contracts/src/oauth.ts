import { z } from 'zod';

import { ConnectionModeSchema } from './connection.js';
import { DomainKindSchema } from './domain.js';

const OAuthProviderKindSchema = z.enum(['gmail', 'google_calendar', 'github']);
export type OAuthProviderKind = z.infer<typeof OAuthProviderKindSchema>;

const OAuthSessionStatusSchema = z.enum(['pending', 'completed', 'failed', 'expired']);

export const OAuthConnectStartRequestSchema = z.object({
  providerKind: OAuthProviderKindSchema,
  connectionId: z.string().min(1).optional(),
  mode: ConnectionModeSchema.default('read_write'),
  syncIntervalSeconds: z.number().int().positive().default(900),
});
export type OAuthConnectStartRequest = z.infer<typeof OAuthConnectStartRequestSchema>;

export const OAuthSessionRecordSchema = z.object({
  id: z.string(),
  providerKind: OAuthProviderKindSchema,
  domain: DomainKindSchema,
  status: OAuthSessionStatusSchema.default('pending'),
  authorizationUrl: z.string().url(),
  redirectUri: z.string().url(),
  connectionId: z.string().nullable().default(null),
  accountId: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  createdAt: z.string(),
  expiresAt: z.string(),
  completedAt: z.string().nullable().default(null),
});
export type OAuthSessionRecord = z.infer<typeof OAuthSessionRecordSchema>;
