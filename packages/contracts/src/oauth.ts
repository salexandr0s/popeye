import { z } from 'zod';

import { ConnectionModeSchema } from './connection.js';
import { DomainKindSchema } from './domain.js';

export const OAuthProviderKindSchema = z.enum(['gmail', 'google_calendar', 'google_tasks', 'github']);
export type OAuthProviderKind = z.infer<typeof OAuthProviderKindSchema>;

export const OAuthProviderAvailabilityStatusSchema = z.enum([
  'ready',
  'missing_client_id',
  'missing_client_secret',
  'missing_client_credentials',
]);
export type OAuthProviderAvailabilityStatus = z.infer<typeof OAuthProviderAvailabilityStatusSchema>;

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

export const OAuthProviderAvailabilityRecordSchema = z.object({
  providerKind: OAuthProviderKindSchema,
  domain: DomainKindSchema,
  status: OAuthProviderAvailabilityStatusSchema,
  details: z.string(),
});
export type OAuthProviderAvailabilityRecord = z.infer<typeof OAuthProviderAvailabilityRecordSchema>;
