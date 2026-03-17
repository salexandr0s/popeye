import { z } from 'zod';
import { DomainKindSchema } from './domain.js';

export const VaultKindSchema = z.enum(['capability', 'restricted']);
export type VaultKind = z.infer<typeof VaultKindSchema>;

export const VaultStatusSchema = z.enum(['closed', 'open', 'sealed']);
export type VaultStatus = z.infer<typeof VaultStatusSchema>;

export const VaultRecordSchema = z.object({
  id: z.string(),
  domain: DomainKindSchema,
  kind: VaultKindSchema,
  dbPath: z.string(),
  encrypted: z.boolean().default(false),
  encryptionKeyRef: z.string().nullable().default(null),
  status: VaultStatusSchema,
  createdAt: z.string(),
  lastAccessedAt: z.string().nullable().default(null),
});
export type VaultRecord = z.infer<typeof VaultRecordSchema>;

export const VaultAccessEventSchema = z.object({
  id: z.string(),
  vaultId: z.string(),
  accessType: z.enum(['read', 'write', 'backup', 'restore']),
  runId: z.string().nullable().default(null),
  timestamp: z.string(),
});
export type VaultAccessEvent = z.infer<typeof VaultAccessEventSchema>;

export const VaultConfigSchema = z.object({
  restrictedVaultDir: z.string().default('vaults'),
  capabilityStoreDir: z.string().default('capabilities'),
  backupEncryptedVaults: z.boolean().default(true),
});
export type VaultConfig = z.infer<typeof VaultConfigSchema>;
