import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import type { BackupManifest, RuntimePaths } from '@popeye/contracts';
import { BackupManifestSchema } from '@popeye/contracts';
import { sha256 } from '@popeye/observability';

export interface BackupOptions {
  destinationDir: string;
  runtimePaths: RuntimePaths;
  workspacePaths?: string[];
}

export interface BackupVerificationResult {
  valid: boolean;
  manifest: BackupManifest;
  mismatches: string[];
}

function copyPath(source: string, destination: string): void {
  if (!existsSync(source)) {
    return;
  }
  const stats = statSync(source);
  if (stats.isDirectory()) {
    mkdirSync(destination, { recursive: true, mode: 0o700 });
    cpSync(source, destination, { recursive: true, dereference: false, force: true });
    return;
  }
  mkdirSync(resolve(destination, '..'), { recursive: true, mode: 0o700 });
  cpSync(source, destination, { dereference: false, force: true });
}

function collectManifestEntries(root: string): BackupManifest['entries'] {
  const entries: BackupManifest['entries'] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        entries.push({ kind: 'directory', path: relative(root, full), sha256: '' });
        walk(full);
      } else {
        entries.push({
          kind: 'file',
          path: relative(root, full),
          sha256: sha256(readFileSync(full)),
        });
      }
    }
  }

  walk(root);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

export function createBackup(options: BackupOptions): string {
  const backupRoot = resolve(options.destinationDir);
  rmSync(backupRoot, { recursive: true, force: true });
  mkdirSync(backupRoot, { recursive: true, mode: 0o700 });

  const mapping = [
    [options.runtimePaths.configDir, join(backupRoot, 'config')],
    [options.runtimePaths.stateDir, join(backupRoot, 'state')],
    [options.runtimePaths.receiptsDir, join(backupRoot, 'receipts')],
  ] as const;

  for (const [source, destination] of mapping) {
    copyPath(source, destination);
  }

  if (options.workspacePaths) {
    for (const workspacePath of options.workspacePaths) {
      const workspaceName = workspacePath.split('/').filter(Boolean).at(-1) ?? 'workspace';
      copyPath(workspacePath, join(backupRoot, 'workspaces', workspaceName));
    }
  }

  const manifest: BackupManifest = {
    version: '1',
    createdAt: new Date().toISOString(),
    entries: collectManifestEntries(backupRoot),
  };
  writeFileSync(join(backupRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return backupRoot;
}

export function verifyBackup(backupRoot: string): BackupVerificationResult {
  const manifest = BackupManifestSchema.parse(JSON.parse(readFileSync(join(backupRoot, 'manifest.json'), 'utf8')));
  const mismatches: string[] = [];
  for (const entry of manifest.entries) {
    if (entry.kind !== 'file' || entry.path === 'manifest.json') {
      continue;
    }
    const full = join(backupRoot, entry.path);
    if (!existsSync(full)) {
      mismatches.push(`Missing file: ${entry.path}`);
      continue;
    }
    const actual = sha256(readFileSync(full));
    if (actual !== entry.sha256) {
      mismatches.push(`Checksum mismatch: ${entry.path}`);
    }
  }
  return { valid: mismatches.length === 0, manifest, mismatches };
}

export function restoreBackup(backupRoot: string, runtimePaths: RuntimePaths): void {
  const verification = verifyBackup(backupRoot);
  if (!verification.valid) {
    throw new Error(`Backup verification failed: ${verification.mismatches.join('; ')}`);
  }

  const mapping = [
    [join(backupRoot, 'config'), runtimePaths.configDir],
    [join(backupRoot, 'state'), runtimePaths.stateDir],
    [join(backupRoot, 'receipts'), runtimePaths.receiptsDir],
  ] as const;
  for (const [source, destination] of mapping) {
    if (!existsSync(source)) {
      continue;
    }
    rmSync(destination, { recursive: true, force: true });
    mkdirSync(resolve(destination, '..'), { recursive: true, mode: 0o700 });
    cpSync(source, destination, { recursive: true, force: true });
  }
}
