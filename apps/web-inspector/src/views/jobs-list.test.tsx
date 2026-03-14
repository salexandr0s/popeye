// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { JobsList } from './jobs-list';

const hooks = vi.hoisted(() => ({
  useJobs: vi.fn(),
}));

const api = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock('../api/hooks', () => hooks);
vi.mock('../api/provider', () => ({
  useApi: () => api,
}));

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    taskId: 'task-1',
    workspaceId: 'alpha',
    status: 'queued',
    retryCount: 0,
    availableAt: '2026-03-14T09:30:00.000Z',
    lastRunId: null,
    createdAt: '2026-03-14T09:20:00.000Z',
    updatedAt: '2026-03-14T10:10:00.000Z',
    ...overrides,
  };
}

function makeJobsResult(overrides: Record<string, unknown> = {}) {
  return {
    data: [makeJob()],
    error: null,
    loading: false,
    updatedAt: '2026-03-14T10:00:00.000Z',
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderJobsList() {
  return render(
    <MemoryRouter>
      <JobsList />
    </MemoryRouter>,
  );
}

describe('JobsList', () => {
  beforeEach(() => {
    api.post.mockReset();
    api.post.mockResolvedValue({});
    hooks.useJobs.mockReturnValue(makeJobsResult());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders loading, error, and empty states', () => {
    hooks.useJobs.mockReturnValueOnce(makeJobsResult({ data: null, loading: true }));
    const { unmount } = renderJobsList();
    expect(screen.getByText('Loading...')).toBeTruthy();
    unmount();

    hooks.useJobs.mockReturnValueOnce(makeJobsResult({ data: null, error: 'Jobs failed' }));
    renderJobsList();
    expect(screen.getByText('Jobs failed')).toBeTruthy();
    cleanup();

    hooks.useJobs.mockReturnValueOnce(makeJobsResult({ data: [] }));
    renderJobsList();
    expect(screen.getByText('No jobs')).toBeTruthy();
  });

  it('shows pause for queued and running jobs only', () => {
    hooks.useJobs.mockReturnValue(makeJobsResult({
      data: [makeJob({ id: 'job-queued', status: 'queued' }), makeJob({ id: 'job-running', status: 'running' })],
    }));

    renderJobsList();

    expect(screen.getAllByRole('button', { name: 'Pause' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enqueue' })).toBeNull();
  });

  it('shows resume only for paused jobs and enqueue only for terminal jobs', () => {
    hooks.useJobs.mockReturnValue(makeJobsResult({
      data: [
        makeJob({ id: 'job-paused', status: 'paused' }),
        makeJob({ id: 'job-failed', status: 'failed_final' }),
        makeJob({ id: 'job-cancelled', status: 'cancelled' }),
        makeJob({ id: 'job-blocked', status: 'blocked_operator' }),
      ],
    }));

    renderJobsList();

    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Enqueue' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  });

  it('posts pause, resume, and enqueue actions then refetches', async () => {
    const refetch = vi.fn();
    hooks.useJobs.mockReturnValue(makeJobsResult({
      data: [
        makeJob({ id: 'job-queued', status: 'queued' }),
        makeJob({ id: 'job-paused', status: 'paused' }),
        makeJob({ id: 'job-failed', status: 'failed_final' }),
      ],
      refetch,
    }));

    renderJobsList();

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enqueue' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenNthCalledWith(1, '/v1/jobs/job-queued/pause');
      expect(api.post).toHaveBeenNthCalledWith(2, '/v1/jobs/job-paused/resume');
      expect(api.post).toHaveBeenNthCalledWith(3, '/v1/jobs/job-failed/enqueue');
      expect(refetch).toHaveBeenCalledTimes(3);
    });
  });

  it('shows action errors when a job action fails', async () => {
    api.post.mockRejectedValueOnce(new Error('Pause blocked'));

    renderJobsList();

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));

    expect(await screen.findByText('Pause blocked')).toBeTruthy();
  });
});
