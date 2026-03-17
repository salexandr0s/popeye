import { describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { createConnection } from 'node:net';

import { detectGws, detectProtonBridge, detectAvailableProviders } from '../providers/detect.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:net', () => ({
  createConnection: vi.fn(),
}));

const mockExecFile = vi.mocked(execFile);
const mockCreateConnection = vi.mocked(createConnection);

describe('detectGws', () => {
  it('returns available + authenticated when gws works', async () => {
    // First call: --version
    // Second call: gmail users getProfile
    let callCount = 0;
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callCount++;
      if (callCount === 1) {
        (callback as Function)(null, '1.0.0', '');
      } else {
        (callback as Function)(null, '{"emailAddress":"user@gmail.com"}', '');
      }
      return undefined as never;
    });

    const result = await detectGws();
    expect(result.available).toBe(true);
    expect(result.authenticated).toBe(true);
  });

  it('returns available but not authenticated when profile check fails', async () => {
    let callCount = 0;
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callCount++;
      if (callCount === 1) {
        (callback as Function)(null, '1.0.0', '');
      } else {
        (callback as Function)(new Error('unauthenticated'), '', '');
      }
      return undefined as never;
    });

    const result = await detectGws();
    expect(result.available).toBe(true);
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('not authenticated');
  });

  it('returns not available when gws binary not found', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      (callback as Function)(new Error('ENOENT'), '', '');
      return undefined as never;
    });

    const result = await detectGws();
    expect(result.available).toBe(false);
    expect(result.error).toContain('not found');
  });
});

describe('detectProtonBridge', () => {
  it('returns available when TCP connect succeeds', async () => {
    const mockSocket = {
      destroy: vi.fn(),
      on: vi.fn().mockReturnThis(),
    };
    mockCreateConnection.mockImplementation((...args: unknown[]) => {
      // createConnection(opts, callback) — callback is second arg
      const callback = args[1] as Function;
      setTimeout(() => callback(), 0);
      return mockSocket as never;
    });

    const result = await detectProtonBridge();
    expect(result.available).toBe(true);
  });

  it('returns not available when TCP connect fails', async () => {
    let errorHandler: Function | undefined;
    const mockSocket = {
      destroy: vi.fn(),
      on: vi.fn().mockImplementation((event: string, handler: Function) => {
        if (event === 'error') {
          errorHandler = handler;
        }
        return mockSocket;
      }),
    };
    mockCreateConnection.mockImplementation(() => {
      setTimeout(() => errorHandler?.(new Error('ECONNREFUSED')), 0);
      return mockSocket as never;
    });

    const result = await detectProtonBridge();
    expect(result.available).toBe(false);
    expect(result.error).toContain('not detected');
  });
});

describe('detectAvailableProviders', () => {
  it('runs both detections in parallel', async () => {
    // Mock gws as available
    let callCount = 0;
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      callCount++;
      if (callCount <= 2) {
        (callback as Function)(null, callCount === 1 ? '1.0.0' : '{}', '');
      }
      return undefined as never;
    });

    // Mock bridge as not available
    let errorHandler: Function | undefined;
    const mockSocket = {
      destroy: vi.fn(),
      on: vi.fn().mockImplementation((event: string, handler: Function) => {
        if (event === 'error') {
          errorHandler = handler;
        }
        return mockSocket;
      }),
    };
    mockCreateConnection.mockImplementation(() => {
      setTimeout(() => errorHandler?.(new Error('ECONNREFUSED')), 0);
      return mockSocket as never;
    });

    const result = await detectAvailableProviders();
    expect(result.gws.available).toBe(true);
    expect(result.protonBridge.available).toBe(false);
  });
});
