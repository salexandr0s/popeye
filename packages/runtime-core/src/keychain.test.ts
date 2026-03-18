import { type SpawnSyncReturns } from 'node:child_process';
import type * as NodeFsModule from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsModule>();
  return {
    ...actual,
    mkdtempSync: actual.mkdtempSync,
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    chmodSync: vi.fn(),
  };
});

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

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
const mockWriteFileSync = vi.mocked(writeFileSync);

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

  it('keychainSet uses file-based secret passing via shell', () => {
    mockSpawnSync.mockReturnValueOnce(fakeResult({ status: 0 }));
    const callCountBefore = mockSpawnSync.mock.calls.length;
    const result = keychainSet('my-key', 'my-secret');
    expect(result.ok).toBe(true);
    // Find the keychainSet call (the one after callCountBefore)
    const setCall = mockSpawnSync.mock.calls[callCountBefore]!;
    expect(setCall[0]).toBe('/bin/sh');
    const shellCmd = (setCall[1] as string[])[1]!;
    expect(shellCmd).toContain('security add-generic-password');
    expect(shellCmd).toContain('$(cat');
    expect(shellCmd).not.toContain('my-secret');
  });

  it('keychainSet writes temp file with 0600 permissions', () => {
    mockSpawnSync.mockReturnValueOnce(fakeResult({ status: 0 }));
    keychainSet('perm-key', 'perm-secret');
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('secret'),
      'perm-secret',
      { mode: 0o600 },
    );
  });

  it('keychainSet cleans up temp file even on error', () => {
    mockSpawnSync.mockImplementationOnce(() => { throw new Error('spawn failed'); });
    expect(() => keychainSet('err-key', 'err-secret')).toThrow('spawn failed');
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
