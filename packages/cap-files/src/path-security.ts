import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import { minimatch } from 'minimatch';

const FORBIDDEN_ROOTS = new Set([
  '/', '/usr', '/etc', '/System', '/var', '/bin', '/sbin', '/lib', '/boot', '/dev', '/proc', '/sys',
  // macOS: /etc, /var, /tmp are symlinks to /private/*
  '/private/etc', '/private/var', '/private/tmp',
]);

export function validateRootPath(path: string): { valid: boolean; reason?: string } {
  if (!isAbsolute(path)) {
    return { valid: false, reason: 'Root path must be absolute' };
  }
  if (!existsSync(path)) {
    return { valid: false, reason: 'Root path does not exist' };
  }
  // Resolve symlinks and check canonical path before directory check
  let canonical: string;
  try {
    canonical = realpathSync(path);
  } catch {
    return { valid: false, reason: 'Root path cannot be resolved' };
  }
  if (FORBIDDEN_ROOTS.has(canonical)) {
    return { valid: false, reason: `Root path resolves to forbidden system directory: ${canonical}` };
  }
  const stat = lstatSync(path);
  if (!stat.isDirectory() && !stat.isSymbolicLink()) {
    return { valid: false, reason: 'Root path must be a directory' };
  }
  // If it's a symlink, check the target is a directory
  if (stat.isSymbolicLink()) {
    const targetStat = statSync(path);
    if (!targetStat.isDirectory()) {
      return { valid: false, reason: 'Root path must be a directory' };
    }
  }
  return { valid: true };
}

export function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  let canonicalRoot: string;
  let canonicalCandidate: string;
  try {
    canonicalRoot = realpathSync(rootPath);
  } catch {
    return false;
  }
  try {
    canonicalCandidate = realpathSync(candidatePath);
  } catch {
    // If the candidate doesn't exist, resolve what we can
    const resolved = resolve(candidatePath);
    const rel = relative(canonicalRoot, resolved);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  }
  const rel = relative(canonicalRoot, canonicalCandidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function isPathAllowed(
  _rootPath: string,
  relativePath: string,
  includePatterns: string[],
  excludePatterns: string[],
): boolean {
  // Check exclude patterns first
  for (const pattern of excludePatterns) {
    if (minimatch(relativePath, pattern, { dot: true })) {
      return false;
    }
  }
  // Check include patterns — if none specified, allow all
  if (includePatterns.length === 0) return true;
  for (const pattern of includePatterns) {
    if (minimatch(relativePath, pattern, { dot: true })) {
      return true;
    }
  }
  return false;
}

export function validateFileSize(path: string, maxBytes: number): { valid: boolean; sizeBytes: number } {
  try {
    const stat = statSync(path);
    return { valid: stat.size <= maxBytes, sizeBytes: stat.size };
  } catch {
    return { valid: false, sizeBytes: 0 };
  }
}
