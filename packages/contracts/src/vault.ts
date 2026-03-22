import { z } from 'zod';
import { DomainKindSchema } from './domain.js';

export const VaultKindSchema = z.enum(['capability', 'restricted']);

const VaultStatusSchema = z.enum(['closed', 'open', 'sealed']);
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

export const VaultConfigSchema = z.object({
  restrictedVaultDir: z.string().default('vaults'),
  capabilityStoreDir: z.string().default('capabilities'),
  backupEncryptedVaults: z.boolean().default(true),
});

export const VaultBackupManifestSchema = z.object({
  vaultId: z.string(),
  createdAt: z.string(),
  cryptoVersion: z.number().int().nonnegative(),
  checksum: z.string(),
  entries: z.number().int().nonnegative(),
});
export type VaultBackupManifest = z.infer<typeof VaultBackupManifestSchema>;

export const VaultRestoreResultSchema = z.object({
  vaultId: z.string(),
  verified: z.boolean(),
  entriesRestored: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});

export const VaultBackupVerifyResultSchema = z.object({
  valid: z.boolean(),
  vaultId: z.string(),
  checksum: z.string(),
  entries: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});
