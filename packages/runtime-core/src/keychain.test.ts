import { type SpawnSyncReturns } from 'node:child_process';

import { describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

import { spawnSync } from 'node:child_process';

import {
  KEYCHAIN_ACCOUNT,
  isKeychainAvailable,
  keychainDelete,
  keychainGet,
  keychainHas,
  keychainServiceName,
  keychainSet,
} from './keychain.js';

const mockSpawnSync = vi.mocked(spawnSync);

function fakeResult(overrides: Partial<SpawnSyncReturns<string>>): SpawnSyncReturns<string> {
  return {
    pid: 1,
    output: [],
    stdout: '',
    stderr: '',
    status: 0,
    signal: null,
    ...overrides,
  };
}

describe('keychain', () => {
  it('keychainServiceName returns prefixed name', () => {
    expect(keychainServiceName('api-key')).toBe('com.popeye.api-key');
  });

  it('isKeychainAvailable returns true when security exits 0', () => {
    mockSpawnSync.mockReturnValueOnce(fakeResult({ status: 0 }));
    expect(isKeychainAvailable()).toBe(true);
    expect(mockSpawnSync).toHaveBeenCalledWith('security', ['help'], { encoding: 'utf8' });
  });

  it('isKeychainAvailable returns false when security not found', () => {
    mockSpawnSync.mockReturnValueOnce(fakeResult({ status: 1, error: new Error('ENOENT') }));
    expect(isKeychainAvailable()).toBe(false);
  });

  it('keychainSet passes correct args including -U', () => {
    mockSpawnSync.mockReturnValueOnce(fakeResult({ status: 0 }));
    const result = keychainSet('my-key', 'my-secret');
    expect(result.ok).toBe(true);
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'security',
      ['add-generic-password', '-s', 'com.popeye.my-key', '-a', KEYCHAIN_ACCOUNT, '-w', 'my-secret', '-U'],
      { encoding: 'utf8' },
    );
  });

  it('keychainGet returns ok with value on success', () => {
    mockSpawnSync.mockReturnValueOnce(fakeResult({ status: 0, stdout: 'the-secret\n' }));
    const result = keychainGet('my-key');
    expect(result).toEqual({ ok: true, value: 'the-secret' });
  });

  it('keychainGet returns not_found on exit code 44', () => {
    mockSpawnSync.mockReturnValueOnce(fakeResult({ status: 44 }));
    const result = keychainGet('missing');
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('keychainDelete passes correct args', () => {
    mockSpawnSync.mockReturnValueOnce(fakeResult({ status: 0 }));
    const result = keychainDelete('my-key');
    expect(result.ok).toBe(true);
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'security',
      ['delete-generic-password', '-s', 'com.popeye.my-key', '-a', KEYCHAIN_ACCOUNT],
      { encoding: 'utf8' },
    );
  });

  it('keychainHas delegates to keychainGet', () => {
    mockSpawnSync.mockReturnValueOnce(fakeResult({ status: 0, stdout: 'val\n' }));
    expect(keychainHas('exists')).toBe(true);

    mockSpawnSync.mockReturnValueOnce(fakeResult({ status: 44 }));
    expect(keychainHas('missing')).toBe(false);
  });
});
