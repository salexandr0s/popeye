import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { nowIso } from '@popeye/contracts';

export interface VaultBackupManifest {
  vaultId: string;
  backupPath: string;
  checksum: string;
  algorithm: string;
  createdAt: string;
}

export interface VaultBackupResult {
  manifest: VaultBackupManifest;
  success: boolean;
}

export interface VaultVerifyResult {
  valid: boolean;
  manifest: VaultBackupManifest | null;
  error?: string;
}

function checksumFile(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

export function backupVault(
  vaultDbPath: string,
  vaultId: string,
  destinationDir: string,
): VaultBackupResult {
  mkdirSync(destinationDir, { recursive: true, mode: 0o700 });

  const fileName = basename(vaultDbPath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `vault-${vaultId.slice(0, 8)}-${timestamp}-${fileName}`;
  const backupPath = join(destinationDir, backupFileName);

  // Prefer the .enc file if it exists (vault is encrypted at rest)
  const sourceFile = existsSync(`${vaultDbPath}.enc`) ? `${vaultDbPath}.enc` : vaultDbPath;
  if (!existsSync(sourceFile)) {
    throw new Error(`Vault file not found: ${sourceFile}`);
  }

  copyFileSync(sourceFile, backupPath);
  const checksum = checksumFile(backupPath);

  const manifest: VaultBackupManifest = {
    vaultId,
    backupPath,
    checksum,
    algorithm: 'sha256',
    createdAt: nowIso(),
  };

  writeFileSync(`${backupPath}.manifest.json`, JSON.stringify(manifest, null, 2));

  return { manifest, success: true };
}

export function restoreVault(
  backupPath: string,
  targetDbPath: string,
): VaultBackupResult {
  if (!existsSync(backupPath)) {
    throw new Error(`Backup file not found: ${backupPath}`);
  }

  copyFileSync(backupPath, targetDbPath);
  const checksum = checksumFile(targetDbPath);

  const manifest: VaultBackupManifest = {
    vaultId: '',
    backupPath,
    checksum,
    algorithm: 'sha256',
    createdAt: nowIso(),
  };

  // Try to read existing manifest for vault ID
  const manifestPath = `${backupPath}.manifest.json`;
  if (existsSync(manifestPath)) {
    try {
      const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as VaultBackupManifest;
      manifest.vaultId = raw.vaultId;
    } catch {
      // Ignore parse errors
    }
  }

  return { manifest, success: true };
}

export function verifyVaultBackup(backupPath: string): VaultVerifyResult {
  if (!existsSync(backupPath)) {
    return { valid: false, manifest: null, error: 'Backup file not found' };
  }

  const manifestPath = `${backupPath}.manifest.json`;
  if (!existsSync(manifestPath)) {
    return { valid: false, manifest: null, error: 'Manifest file not found' };
  }

  let manifest: VaultBackupManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as VaultBackupManifest;
  } catch {
    return { valid: false, manifest: null, error: 'Manifest is not valid JSON' };
  }

  const actual = checksumFile(backupPath);
  if (actual !== manifest.checksum) {
    return {
      valid: false,
      manifest,
      error: `Checksum mismatch: expected ${manifest.checksum}, got ${actual}`,
    };
  }

  return { valid: true, manifest };
}
