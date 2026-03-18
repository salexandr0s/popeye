// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RunDetail } from './run-detail';

const hooks = vi.hoisted(() => ({
  useRun: vi.fn(),
  useRunEnvelope: vi.fn(),
  useRunEvents: vi.fn(),
}));

const api = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock('../api/hooks', () => hooks);
vi.mock('../api/provider', () => ({
  useApi: () => api,
}));

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    jobId: 'job-1',
    taskId: 'task-1',
    workspaceId: 'alpha',
    profileId: 'default',
    sessionRootId: 'session-1',
    engineSessionRef: null,
    state: 'running',
    startedAt: '2026-03-14T09:30:00.000Z',
    finishedAt: null,
    error: null,
    ...overrides,
  };
}

function makeRunResult(overrides: Record<string, unknown> = {}) {
  return {
    data: makeRun(),
    error: null,
    loading: false,
    updatedAt: '2026-03-14T10:00:00.000Z',
    refetch: vi.fn(),
    ...overrides,
  };
}

function makeEventResult(overrides: Record<string, unknown> = {}) {
  return {
    data: [],
    error: null,
    loading: false,
    updatedAt: '2026-03-14T10:00:00.000Z',
    refetch: vi.fn(),
    ...overrides,
  };
}

function makeEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-1',
    taskId: 'task-1',
    profileId: 'default',
    workspaceId: 'alpha',
    projectId: null,
    mode: 'interactive',
    modelPolicy: 'inherit',
    allowedRuntimeTools: ['popeye_memory_search', 'popeye_file_read'],
    allowedCapabilityIds: ['files'],
    memoryScope: 'workspace',
    recallScope: 'workspace',
    filesystemPolicyClass: 'workspace',
    contextReleasePolicy: 'summary_only',
    readRoots: ['/tmp/workspace'],
    writeRoots: ['/tmp/workspace'],
    protectedPaths: ['/tmp/workspace/WORKSPACE.md', '/tmp/workspace/MEMORY.md'],
    scratchRoot: '/tmp/popeye/scratch/run-1',
    cwd: '/tmp/workspace',
    provenance: {
      derivedAt: '2026-03-18T10:00:00.000Z',
      engineKind: 'fake',
      sessionPolicy: 'dedicated',
      warnings: [],
    },
    ...overrides,
  };
}

function makeEnvelopeResult(overrides: Record<string, unknown> = {}) {
  return {
    data: makeEnvelope(),
    error: null,
    loading: false,
    updatedAt: '2026-03-18T10:00:00.000Z',
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderRunDetail() {
  return render(
    <MemoryRouter initialEntries={['/runs/run-1']}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

const actionVisibilityCases = [
  { state: 'starting', expectCancel: true, expectRetry: false },
  { state: 'running', expectCancel: true, expectRetry: false },
  { state: 'failed_retryable', expectCancel: false, expectRetry: true },
  { state: 'failed_final', expectCancel: false, expectRetry: true },
  { state: 'cancelled', expectCancel: false, expectRetry: true },
  { state: 'abandoned', expectCancel: false, expectRetry: true },
  { state: 'succeeded', expectCancel: false, expectRetry: false },
] as const;

describe('RunDetail', () => {
  beforeEach(() => {
    api.post.mockReset();
    api.post.mockResolvedValue({});
    hooks.useRun.mockReturnValue(makeRunResult());
    hooks.useRunEnvelope.mockReturnValue(makeEnvelopeResult());
    hooks.useRunEvents.mockReturnValue(makeEventResult());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders a page loading state while the run is loading', () => {
    hooks.useRun.mockReturnValue(makeRunResult({ data: null, loading: true }));

    renderRunDetail();

    expect(screen.getByText('Loading...')).toBeTruthy();
  });

  it('renders a page-level error when the run fetch fails', () => {
    hooks.useRun.mockReturnValue(makeRunResult({ data: null, error: 'Run fetch failed' }));

    renderRunDetail();

    expect(screen.getByText('Run fetch failed')).toBeTruthy();
  });

  it.each(actionVisibilityCases)(
    'shows the correct actions for %s runs',
    ({ state, expectCancel, expectRetry }) => {
      hooks.useRun.mockReturnValue(makeRunResult({
        data: makeRun({
          state,
          finishedAt: expectRetry || state === 'succeeded' ? '2026-03-14T09:45:00.000Z' : null,
        }),
      }));

      renderRunDetail();

      expect(screen.queryByRole('button', { name: 'Cancel Run' }) !== null).toBe(expectCancel);
      expect(screen.queryByRole('button', { name: 'Retry Job' }) !== null).toBe(expectRetry);
      expect(screen.getByRole('link', { name: 'View Receipts' })).toBeTruthy();
    },
  );

  it('renders the run profile identifier', () => {
    hooks.useRun.mockReturnValue(makeRunResult({
      data: makeRun({ profileId: 'interactive-default' }),
    }));

    renderRunDetail();

    expect(screen.getByText('Profile')).toBeTruthy();
    expect(screen.getByText('interactive-default')).toBeTruthy();
  });

  it('renders execution envelope details and warnings', () => {
    hooks.useRunEnvelope.mockReturnValue(makeEnvelopeResult({
      data: makeEnvelope({
        memoryScope: 'workspace',
        recallScope: 'project',
        filesystemPolicyClass: 'read_only_workspace',
        contextReleasePolicy: 'excerpt',
        protectedPaths: ['/tmp/workspace/WORKSPACE.md'],
        provenance: {
          derivedAt: '2026-03-18T10:00:00.000Z',
          engineKind: 'fake',
          sessionPolicy: 'dedicated',
          warnings: ['Project-scoped memory recall is not yet supported by stored memory records.'],
        },
      }),
    }));

    renderRunDetail();

    expect(screen.getByText('Execution Envelope')).toBeTruthy();
    expect(screen.getByText('workspace / project')).toBeTruthy();
    expect(screen.getByText('read only workspace')).toBeTruthy();
    expect(screen.getByText('excerpt')).toBeTruthy();
    expect(screen.getByText('Protected Paths')).toBeTruthy();
    expect(screen.getByText(/Project-scoped memory recall is not yet supported/)).toBeTruthy();
  });

  it('posts cancel and refetches on success', async () => {
    const refetch = vi.fn();
    hooks.useRun.mockReturnValue(makeRunResult({
      data: makeRun({ state: 'running' }),
      refetch,
    }));

    renderRunDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel Run' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v1/runs/run-1/cancel');
      expect(refetch).toHaveBeenCalled();
    });
  });

  it('posts retry and refetches on success', async () => {
    const refetch = vi.fn();
    hooks.useRun.mockReturnValue(makeRunResult({
      data: makeRun({
        state: 'failed_retryable',
        finishedAt: '2026-03-14T09:45:00.000Z',
      }),
      refetch,
    }));

    renderRunDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Retry Job' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v1/runs/run-1/retry');
      expect(refetch).toHaveBeenCalled();
    });
  });

  it('shows an action error when cancel fails', async () => {
    api.post.mockRejectedValueOnce(new Error('Cancel blocked'));

    renderRunDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel Run' }));

    expect(await screen.findByText('Cancel blocked')).toBeTruthy();
  });

  it('shows an action error when retry fails', async () => {
    api.post.mockRejectedValueOnce(new Error('Retry blocked'));
    hooks.useRun.mockReturnValue(makeRunResult({
      data: makeRun({
        state: 'abandoned',
        finishedAt: '2026-03-14T09:45:00.000Z',
      }),
    }));

    renderRunDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Retry Job' }));

    expect(await screen.findByText('Retry blocked')).toBeTruthy();
  });

  it('renders an event loading state separately from the main run state', () => {
    hooks.useRunEvents.mockReturnValue(makeEventResult({
      data: null,
      loading: true,
    }));

    renderRunDetail();

    expect(screen.getByText('Events')).toBeTruthy();
    expect(screen.getByText('Loading...')).toBeTruthy();
  });

  it('renders an event error state when event fetch fails', () => {
    hooks.useRunEvents.mockReturnValue(makeEventResult({
      data: null,
      error: 'Events unavailable',
    }));

    renderRunDetail();

    expect(screen.getByText('Events unavailable')).toBeTruthy();
  });

  it('renders an empty event state when no events are recorded', () => {
    hooks.useRunEvents.mockReturnValue(makeEventResult({ data: [] }));

    renderRunDetail();

    expect(screen.getByText('No events recorded.')).toBeTruthy();
  });

  it('renders event rows and truncates long payloads', () => {
    const payload = 'x'.repeat(130);
    hooks.useRunEvents.mockReturnValue(makeEventResult({
      data: [
        {
          id: 'evt-1',
          runId: 'run-1',
          type: 'tool_result',
          payload,
          createdAt: '2026-03-14T09:35:00.000Z',
        },
      ],
    }));

    renderRunDetail();

    expect(screen.getByText('tool result')).toBeTruthy();
    expect(screen.getByText(`${payload.slice(0, 120)}...`)).toBeTruthy();
  });
});
