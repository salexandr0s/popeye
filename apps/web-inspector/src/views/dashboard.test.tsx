// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Dashboard } from './dashboard';

const hooks = vi.hoisted(() => ({
  useDaemonStatus: vi.fn(),
  useEngineCapabilities: vi.fn(),
  useSchedulerStatus: vi.fn(),
  useUsageSummary: vi.fn(),
}));

vi.mock('../api/hooks', () => hooks);

function pollingResult<T>(data: T) {
  return {
    data,
    error: null,
    loading: false,
    updatedAt: '2026-03-18T10:20:00.000Z',
    refetch: vi.fn(),
  };
}

describe('Dashboard', () => {
  beforeEach(() => {
    hooks.useDaemonStatus.mockReturnValue(pollingResult({
      ok: true,
      runningJobs: 2,
      queuedJobs: 3,
      openInterventions: 1,
      activeLeases: 1,
      engineKind: 'pi',
      schedulerRunning: true,
      startedAt: '2026-03-18T09:00:00.000Z',
      lastShutdownAt: null,
    }));
    hooks.useEngineCapabilities.mockReturnValue(pollingResult({
      engineKind: 'pi',
      persistentSessionSupport: true,
      resumeBySessionRefSupport: false,
      hostToolMode: 'native_with_fallback',
      compactionEventSupport: true,
      cancellationMode: 'rpc_abort_with_signal_fallback',
      acceptedRequestMetadata: ['prompt', 'cwd', 'workspaceId'],
      warnings: ['version mismatch'],
    }));
    hooks.useSchedulerStatus.mockReturnValue(pollingResult({
      running: true,
      activeLeases: 1,
      activeRuns: 2,
      nextHeartbeatDueAt: '2026-03-18T10:25:00.000Z',
    }));
    hooks.useUsageSummary.mockReturnValue(pollingResult({
      runs: 42,
      tokensIn: 1200,
      tokensOut: 800,
      estimatedCostUsd: 1.2345,
    }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders engine capability cards', () => {
    render(<Dashboard />);

    expect(screen.getByText('Host Tools')).toBeTruthy();
    expect(screen.getByText('native_with_fallback')).toBeTruthy();
    expect(screen.getByText('Sessions')).toBeTruthy();
    expect(screen.getByText('Persistent')).toBeTruthy();
    expect(screen.getByText('Compaction')).toBeTruthy();
    expect(screen.getByText('Supported')).toBeTruthy();
    expect(screen.getByText('Accepted Metadata')).toBeTruthy();
    expect(screen.getByText('prompt, cwd')).toBeTruthy();
    expect(screen.getByText('version mismatch')).toBeTruthy();
  });
});
