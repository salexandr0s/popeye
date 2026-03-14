// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ApiProvider } from './provider';

// We cannot import usePolling/useFetch directly since they are not exported.
// Instead, test through the public hooks that use them.
// useDaemonStatus uses usePolling, useRun uses useFetch.
import { useDaemonStatus, useRun } from './hooks';

const AUTH_TOKEN = 'test-auth-token';

// Enable React act() environment
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function createWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <ApiProvider>{children}</ApiProvider>;
  };
}

describe('hooks (usePolling via useDaemonStatus)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    (window as unknown as { __POPEYE_AUTH_TOKEN__: string }).__POPEYE_AUTH_TOKEN__ = AUTH_TOKEN;
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
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(statusData),
    });

    const { result } = renderHook(() => useDaemonStatus(), {
      wrapper: createWrapper(),
    });

    // Initially loading
    expect(result.current.loading).toBe(true);

    // Flush microtasks so the fetch promise resolves under fake timers
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual(statusData);
    expect(result.current.error).toBeNull();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('re-fetches at interval', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ state: 'running' }),
    });

    renderHook(() => useDaemonStatus(), {
      wrapper: createWrapper(),
    });

    // Let the initial fetch resolve
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const initialCallCount = fetchMock.mock.calls.length;

    // Advance by the polling interval (5000ms for useDaemonStatus)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCallCount);
  });

  it('cleans up interval on unmount', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ state: 'running' }),
    });

    const { unmount } = renderHook(() => useDaemonStatus(), {
      wrapper: createWrapper(),
    });

    // Let the initial fetch resolve
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const callCountBeforeUnmount = fetchMock.mock.calls.length;
    unmount();

    // Advance timers after unmount — no additional fetches should happen
    vi.advanceTimersByTime(15000);

    expect(fetchMock.mock.calls.length).toBe(callCountBeforeUnmount);
  });
});

describe('hooks (useFetch via useRun)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (window as unknown as { __POPEYE_AUTH_TOKEN__: string }).__POPEYE_AUTH_TOKEN__ = AUTH_TOKEN;
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
      json: () => Promise.resolve(runData),
    });

    const { result } = renderHook(() => useRun('run-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(runData);
    expect(result.current.error).toBeNull();
  });

  it('sets error on fetch failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network failure'));

    const { result } = renderHook(() => useRun('run-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network failure');
    expect(result.current.data).toBeNull();
  });
});
