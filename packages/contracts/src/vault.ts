import { z } from 'zod';
import { DomainKindSchema } from './domain.js';

export const VaultKindSchema = z.enum(['capability', 'restricted']);

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

// --- Vault crypto metadata ---

export const VaultCryptoAlgorithmSchema = z.literal('aes-256-gcm');
export type VaultCryptoAlgorithm = z.infer<typeof VaultCryptoAlgorithmSchema>;

export const VaultBackupPolicySchema = z.enum(['encrypted', 'none']);
export type VaultBackupPolicy = z.infer<typeof VaultBackupPolicySchema>;

export const VaultCryptoMetadataSchema = z.object({
  version: z.number().int().positive().default(1),
  kekRef: z.string(),
  dekWrapped: z.string(),
  algorithm: VaultCryptoAlgorithmSchema.default('aes-256-gcm'),
  backupPolicy: VaultBackupPolicySchema.default('encrypted'),
});
export type VaultCryptoMetadata = z.infer<typeof VaultCryptoMetadataSchema>;

// --- Vault backup/restore ---

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
export type VaultRestoreResult = z.infer<typeof VaultRestoreResultSchema>;

export const VaultBackupVerifyResultSchema = z.object({
  valid: z.boolean(),
  vaultId: z.string(),
  checksum: z.string(),
  entries: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});
export type VaultBackupVerifyResult = z.infer<typeof VaultBackupVerifyResultSchema>;
