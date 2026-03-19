// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ApiProvider } from './provider';
import { resetBrowserBootstrapForTests, useDaemonStatus, useRun } from './hooks';
import { submitBrowserUnlockToken } from './browser-session';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BOOTSTRAP_NONCE = 'bootstrap-nonce-test';

function createWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <ApiProvider>{children}</ApiProvider>;
  };
}

describe('hooks (usePolling via useDaemonStatus)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    resetBrowserBootstrapForTests();
    (window as unknown as { __POPEYE_BOOTSTRAP_NONCE__: string }).__POPEYE_BOOTSTRAP_NONCE__ = BOOTSTRAP_NONCE;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fetches on mount', async () => {
    const statusData = { state: 'running', uptime: 1234 };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(statusData),
    });

    const { result } = renderHook(() => useDaemonStatus(), {
      wrapper: createWrapper(),
    });

    expect(result.current.loading).toBe(true);

    act(() => {
      submitBrowserUnlockToken('operator-token-123');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual(statusData);
    expect(result.current.error).toBeNull();
    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/auth/exchange');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/v1/status');
  });

  it('re-fetches at interval without repeating bootstrap exchange', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ state: 'running' }),
    });

    renderHook(() => useDaemonStatus(), {
      wrapper: createWrapper(),
    });

    act(() => {
      submitBrowserUnlockToken('operator-token-123');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const initialCallCount = fetchMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCallCount);
    const exchangeCalls = fetchMock.mock.calls.filter(([path]) => path === '/v1/auth/exchange');
    expect(exchangeCalls).toHaveLength(1);
  });

  it('cleans up interval on unmount', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ state: 'running' }),
    });

    const { unmount } = renderHook(() => useDaemonStatus(), {
      wrapper: createWrapper(),
    });

    act(() => {
      submitBrowserUnlockToken('operator-token-123');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const callCountBeforeUnmount = fetchMock.mock.calls.length;
    unmount();
    vi.advanceTimersByTime(15000);

    expect(fetchMock.mock.calls.length).toBe(callCountBeforeUnmount);
  });
});

describe('hooks (useFetch via useRun)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetBrowserBootstrapForTests();
    (window as unknown as { __POPEYE_BOOTSTRAP_NONCE__: string }).__POPEYE_BOOTSTRAP_NONCE__ = BOOTSTRAP_NONCE;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('does not fetch when path is null (undefined id)', async () => {
    const { result } = renderHook(() => useRun(undefined), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('fetches when path is provided', async () => {
    const runData = { id: 'run-1', state: 'succeeded' };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(runData),
    });

    const { result } = renderHook(() => useRun('run-1'), {
      wrapper: createWrapper(),
    });

    act(() => {
      submitBrowserUnlockToken('operator-token-123');
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(runData);
    expect(result.current.error).toBeNull();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/auth/exchange');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/v1/runs/run-1');
  });

  it('sets error on fetch failure', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
    fetchMock.mockRejectedValueOnce(new Error('Network failure'));

    const { result } = renderHook(() => useRun('run-1'), {
      wrapper: createWrapper(),
    });

    act(() => {
      submitBrowserUnlockToken('operator-token-123');
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network failure');
    expect(result.current.data).toBeNull();
  });
});
