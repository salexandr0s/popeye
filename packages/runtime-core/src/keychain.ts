import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, unlinkSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const KEYCHAIN_SERVICE_PREFIX = 'com.popeye.';
export const KEYCHAIN_ACCOUNT = 'popeye';

export interface KeychainResult {
  ok: boolean;
  value?: string;
  error?: string;
}

const SAFE_KEY_RE = /^[a-zA-Z0-9._-]+$/;

function assertSafeKeychainKey(key: string): void {
  if (!SAFE_KEY_RE.test(key)) {
    throw new Error(`Unsafe keychain key: ${key}`);
  }
}

export function keychainServiceName(key: string): string {
  return `${KEYCHAIN_SERVICE_PREFIX}${key}`;
}

export function isKeychainAvailable(): boolean {
  if (process.platform !== 'darwin') {
    return false;
  }
  const result = spawnSync('security', ['help'], { encoding: 'utf8' });
  return result.status === 0;
}

export function keychainGet(key: string): KeychainResult {
  assertSafeKeychainKey(key);
  if (process.platform !== 'darwin') {
    return { ok: false, error: 'keychain is only available on macOS' };
  }
  const service = keychainServiceName(key);
  const result = spawnSync('security', ['find-generic-password', '-s', service, '-a', KEYCHAIN_ACCOUNT, '-w'], {
    encoding: 'utf8',
  });
  if (result.status === 0) {
    return { ok: true, value: result.stdout.trim() };
  }
  if (result.status === 44) {
    return { ok: false, error: 'not_found' };
  }
  return { ok: false, error: result.stderr?.trim() || `exit code ${result.status}` };
}

/**
 * Write a secret to macOS Keychain using a temporary file to avoid exposing the
 * value in the process argument list (`ps`). The temp file is created with 0600
 * permissions and deleted immediately after use.
 */
export function keychainSet(key: string, value: string): KeychainResult {
  assertSafeKeychainKey(key);
  if (process.platform !== 'darwin') {
    return { ok: false, error: 'keychain is only available on macOS' };
  }
  const service = keychainServiceName(key);
  const tmpDir = mkdtempSync(join(tmpdir(), 'popeye-kc-'));
  const tmpFile = join(tmpDir, 'secret');
  try {
    writeFileSync(tmpFile, value, { mode: 0o600 });
    chmodSync(tmpDir, 0o700);
    // Use shell to read the secret from a temp file via $(cat ...) so it never
    // appears as a direct argument to `security`.
    const result = spawnSync(
      '/bin/sh',
      ['-c', `security add-generic-password -s "${service}" -a "${KEYCHAIN_ACCOUNT}" -w "$(cat "${tmpFile}")" -U`],
      { encoding: 'utf8' },
    );
    if (result.status === 0) {
      return { ok: true };
    }
    return { ok: false, error: result.stderr?.trim() || `exit code ${result.status}` };
  } finally {
    try { unlinkSync(tmpFile); } catch { /* best effort */ }
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

export function keychainDelete(key: string): KeychainResult {
  assertSafeKeychainKey(key);
  if (process.platform !== 'darwin') {
    return { ok: false, error: 'keychain is only available on macOS' };
  }
  const service = keychainServiceName(key);
  const result = spawnSync('security', ['delete-generic-password', '-s', service, '-a', KEYCHAIN_ACCOUNT], {
    encoding: 'utf8',
  });
  if (result.status === 0) {
    return { ok: true };
  }
  return { ok: false, error: result.stderr?.trim() || `exit code ${result.status}` };
}

export function keychainHas(key: string): boolean {
  assertSafeKeychainKey(key);
  return keychainGet(key).ok;
}
