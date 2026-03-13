import { spawnSync } from 'node:child_process';

export const KEYCHAIN_SERVICE_PREFIX = 'com.popeye.';
export const KEYCHAIN_ACCOUNT = 'popeye';

export interface KeychainResult {
  ok: boolean;
  value?: string;
  error?: string;
}

export function keychainServiceName(key: string): string {
  return `${KEYCHAIN_SERVICE_PREFIX}${key}`;
}

export function isKeychainAvailable(): boolean {
  const result = spawnSync('security', ['help'], { encoding: 'utf8' });
  return result.status === 0;
}

export function keychainGet(key: string): KeychainResult {
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

export function keychainSet(key: string, value: string): KeychainResult {
  const service = keychainServiceName(key);
  // Note: -w requires the password as an inline argument — macOS `security`
  // does not support reading -w from stdin. The secret is briefly visible in
  // `ps` output. This is acceptable for a single-operator daemon; a native
  // Keychain API binding would avoid this exposure.
  const result = spawnSync(
    'security',
    ['add-generic-password', '-s', service, '-a', KEYCHAIN_ACCOUNT, '-w', value, '-U'],
    { encoding: 'utf8' },
  );
  if (result.status === 0) {
    return { ok: true };
  }
  return { ok: false, error: result.stderr?.trim() || `exit code ${result.status}` };
}

export function keychainDelete(key: string): KeychainResult {
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
  return keychainGet(key).ok;
}
