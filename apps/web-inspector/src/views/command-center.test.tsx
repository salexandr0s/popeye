// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { CommandCenter } from './command-center';

const hooks = vi.hoisted(() => ({
  useDaemonStatus: vi.fn(),
  useEventStreamFreshness: vi.fn(),
  useInterventions: vi.fn(),
  useJobs: vi.fn(),
  useReceipts: vi.fn(),
  useRunEvents: vi.fn(),
  useRuns: vi.fn(),
  useSchedulerStatus: vi.fn(),
  useTasks: vi.fn(),
  useUsageSummary: vi.fn(),
}));

vi.mock('../api/hooks', () => hooks);

function pollingResult<T>(data: T) {
  return {
    data,
    error: null,
    loading: false,
    updatedAt: '2026-03-14T10:20:00.000Z',
    refetch: vi.fn(),
  };
}

describe('CommandCenter', () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    hooks.useDaemonStatus.mockReturnValue(pollingResult({
      ok: true,
      runningJobs: 2,
      queuedJobs: 1,
      openInterventions: 1,
      activeLeases: 1,
      engineKind: 'pi',
      schedulerRunning: true,
      startedAt: '2026-03-14T09:00:00.000Z',
      lastShutdownAt: null,
    }));
    hooks.useSchedulerStatus.mockReturnValue(pollingResult({
      running: true,
      activeLeases: 1,
      activeRuns: 2,
      nextHeartbeatDueAt: '2026-03-14T10:25:00.000Z',
    }));
    hooks.useRuns.mockReturnValue(pollingResult([
      {
        id: 'run-1',
        jobId: 'job-1',
        taskId: 'task-1',
        workspaceId: 'alpha',
        sessionRootId: 'session-1',
        engineSessionRef: null,
        state: 'running',
        startedAt: '2026-03-14T09:30:00.000Z',
        finishedAt: null,
        error: null,
      },
      {
        id: 'run-2',
        jobId: 'job-2',
        taskId: 'task-2',
        workspaceId: 'beta',
        sessionRootId: 'session-2',
        engineSessionRef: null,
        state: 'failed_final',
        startedAt: '2026-03-14T09:00:00.000Z',
        finishedAt: '2026-03-14T09:10:00.000Z',
        error: 'boom',
      },
    ]));
    hooks.useJobs.mockReturnValue(pollingResult([
      {
        id: 'job-1',
        taskId: 'task-1',
        workspaceId: 'alpha',
        status: 'queued',
        retryCount: 0,
        availableAt: '2026-03-14T09:30:00.000Z',
        lastRunId: null,
        createdAt: '2026-03-14T09:20:00.000Z',
        updatedAt: '2026-03-14T10:10:00.000Z',
      },
      {
        id: 'job-2',
        taskId: 'task-2',
        workspaceId: 'beta',
        status: 'blocked_operator',
        retryCount: 1,
        availableAt: '2026-03-14T09:10:00.000Z',
        lastRunId: 'run-2',
        createdAt: '2026-03-14T09:05:00.000Z',
        updatedAt: '2026-03-14T10:15:00.000Z',
      },
    ]));
    hooks.useTasks.mockReturnValue(pollingResult([
      {
        id: 'task-1',
        workspaceId: 'alpha',
        projectId: null,
        title: 'Alpha task',
        prompt: 'Do alpha',
        source: 'manual',
        status: 'active',
        retryPolicy: { maxAttempts: 3, baseDelaySeconds: 5, multiplier: 2, maxDelaySeconds: 900 },
        sideEffectProfile: 'read_only',
        coalesceKey: null,
        createdAt: '2026-03-14T09:00:00.000Z',
      },
      {
        id: 'task-2',
        workspaceId: 'beta',
        projectId: null,
        title: 'Beta task',
        prompt: 'Do beta',
        source: 'manual',
        status: 'active',
        retryPolicy: { maxAttempts: 3, baseDelaySeconds: 5, multiplier: 2, maxDelaySeconds: 900 },
        sideEffectProfile: 'read_only',
        coalesceKey: null,
        createdAt: '2026-03-14T09:00:00.000Z',
      },
    ]));
    hooks.useInterventions.mockReturnValue(pollingResult([
      {
        id: 'int-1',
        code: 'needs_operator_input',
        runId: 'run-1',
        status: 'open',
        reason: 'Need confirmation',
        createdAt: '2026-03-14T10:00:00.000Z',
        resolvedAt: null,
      },
    ]));
    hooks.useReceipts.mockReturnValue(pollingResult([
      {
        id: 'receipt-1',
        runId: 'run-1',
        jobId: 'job-1',
        taskId: 'task-1',
        workspaceId: 'alpha',
        status: 'succeeded',
        summary: 'Alpha task finished cleanly',
        details: '',
        usage: {
          provider: 'openai',
          model: 'gpt-5',
          tokensIn: 100,
          tokensOut: 200,
          estimatedCostUsd: 0.12,
        },
        createdAt: '2026-03-14T10:18:00.000Z',
      },
    ]));
    hooks.useRunEvents.mockReturnValue(pollingResult([
      {
        id: 'evt-1',
        runId: 'run-1',
        type: 'tool_call',
        payload: '{\"tool\":\"grep\"}',
        createdAt: '2026-03-14T10:18:30.000Z',
      },
      {
        id: 'evt-2',
        runId: 'run-1',
        type: 'tool_result',
        payload: '{\"ok\":true}',
        createdAt: '2026-03-14T10:19:30.000Z',
      },
    ]));
    hooks.useUsageSummary.mockReturnValue(pollingResult({
      runs: 5,
      tokensIn: 1000,
      tokensOut: 500,
      estimatedCostUsd: 1.25,
    }));
    hooks.useEventStreamFreshness.mockReturnValue({
      connected: true,
      error: null,
      lastEventAt: '2026-03-14T10:19:00.000Z',
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders summary cards and filtered workspace content', () => {
    render(
      <MemoryRouter>
        <CommandCenter />
      </MemoryRouter>,
    );

    expect(screen.getByText('Command Center')).toBeTruthy();
    expect(screen.getByText('Active Runs')).toBeTruthy();
    expect(screen.getByText('$1.2500')).toBeTruthy();
    expect(screen.getAllByText('Alpha task').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Beta task').length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('Workspace'), { target: { value: 'alpha' } });

    expect(screen.getAllByText('Alpha task').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Beta task')).toHaveLength(0);
  });

  it('persists panel toggle state', () => {
    render(
      <MemoryRouter>
        <CommandCenter />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Hide attention' }));

    expect(screen.queryByText('Attention')).not.toBeTruthy();
    expect(window.localStorage.getItem('popeye.command-center.layout')).toContain('"attention":false');
  });

  it('opens inline run drill-down with recent events and related tools', async () => {
    render(
      <MemoryRouter>
        <CommandCenter />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select run run-1' }));

    expect(screen.getByText('Run detail')).toBeTruthy();
    expect(screen.getByText('Recent run events')).toBeTruthy();
    expect(screen.getByText('Alpha task finished cleanly')).toBeTruthy();
    expect(screen.getByText("pop run show 'run-1'")).toBeTruthy();
    expect(screen.getAllByText(/Recent run event/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole('button', { name: 'Copy' })[0]!);

    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });

  it('persists dense mode and selected detail state', () => {
    render(
      <MemoryRouter>
        <CommandCenter />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dense mode' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select intervention int-1' }));

    const saved = window.localStorage.getItem('popeye.command-center.layout');
    expect(saved).toContain('\"denseMode\":true');
    expect(saved).toContain('\"kind\":\"intervention\"');
  });
});
