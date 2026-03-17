import { z } from 'zod';

export const SecretProviderKindSchema = z.enum(['keychain', 'file', 'env']);
export type SecretProviderKind = z.infer<typeof SecretProviderKindSchema>;

export const SecretRefSchema = z.object({
  id: z.string(),
  provider: SecretProviderKindSchema,
  key: z.string(),
  createdAt: z.string(),
  rotatedAt: z.string().nullable().default(null),
  expiresAt: z.string().nullable().default(null),
});
export type SecretRef = z.infer<typeof SecretRefSchema>;

export const SecretRefRecordSchema = SecretRefSchema.extend({
  connectionId: z.string().nullable().default(null),
  description: z.string().default(''),
});
export type SecretRefRecord = z.infer<typeof SecretRefRecordSchema>;
