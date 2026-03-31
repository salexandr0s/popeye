// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { PlaybookDetailView } from './playbook-detail';

const hooks = vi.hoisted(() => ({
  usePlaybook: vi.fn(),
  usePlaybookRevisions: vi.fn(),
  usePlaybookStaleCandidates: vi.fn(),
  usePlaybookUsage: vi.fn(),
}));

const api = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock('../api/hooks', () => hooks);
vi.mock('../api/provider', () => ({
  useApi: () => api,
}));

function makePlaybook(overrides: Record<string, unknown> = {}) {
  return {
    recordId: 'workspace:ws-1:triage',
    playbookId: 'triage',
    scope: 'workspace',
    workspaceId: 'ws-1',
    projectId: null,
    title: 'Triage',
    status: 'draft',
    allowedProfileIds: [],
    filePath: '/tmp/triage.md',
    currentRevisionHash: 'rev-1',
    body: 'Body',
    markdownText: '---\nBody\n',
    indexedMemoryId: 'memory-1',
    effectiveness: {
      useCount30d: 3,
      succeededRuns30d: 1,
      failedRuns30d: 2,
      intervenedRuns30d: 1,
      successRate30d: 1 / 3,
      failureRate30d: 2 / 3,
      interventionRate30d: 1 / 3,
      lastUsedAt: '2026-03-31T10:00:00.000Z',
      lastUpdatedAt: '2026-03-30T10:00:00.000Z',
    },
    createdAt: '2026-03-30T10:00:00.000Z',
    updatedAt: '2026-03-30T10:00:00.000Z',
    ...overrides,
  };
}

function makeRevision(overrides: Record<string, unknown> = {}) {
  return {
    playbookRecordId: 'workspace:ws-1:triage',
    revisionHash: 'rev-1',
    title: 'Triage',
    status: 'draft',
    allowedProfileIds: [],
    filePath: '/tmp/triage.md',
    contentHash: 'content-1',
    markdownText: '---\nBody\n',
    createdAt: '2026-03-30T10:00:00.000Z',
    current: true,
    ...overrides,
  };
}

function makeCandidate(overrides: Record<string, unknown> = {}) {
  return {
    recordId: 'workspace:ws-1:triage',
    title: 'Triage',
    scope: 'workspace',
    currentRevisionHash: 'rev-1',
    lastUsedAt: '2026-03-30T10:00:00.000Z',
    useCount30d: 3,
    failedRuns30d: 2,
    interventions30d: 1,
    lastProposalAt: null,
    indexedMemoryId: 'memory-1',
    reasons: ['Repeated failed runs in the last 30 days (2).'],
    ...overrides,
  };
}

function makeUsage(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-1',
    taskId: 'task-1',
    jobId: 'job-1',
    runState: 'failed_final',
    startedAt: '2026-03-31T09:00:00.000Z',
    finishedAt: '2026-03-31T09:05:00.000Z',
    interventionCount: 1,
    receiptId: 'receipt-1',
    ...overrides,
  };
}

function result<T>(overrides: Partial<{
  data: T;
  error: string | null;
  loading: boolean;
  updatedAt: string | null;
  refetch: () => void;
}> = {}) {
  return {
    data: null,
    error: null,
    loading: false,
    updatedAt: '2026-03-30T10:00:00.000Z',
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderView() {
  return render(
    <MemoryRouter initialEntries={['/playbooks/workspace%3Aws-1%3Atriage']}>
      <Routes>
        <Route path="/playbooks/:recordId" element={<PlaybookDetailView />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PlaybookDetailView', () => {
  beforeEach(() => {
    api.post.mockReset();
    api.post.mockResolvedValue({});
    hooks.usePlaybook.mockReturnValue(result({ data: makePlaybook() }));
    hooks.usePlaybookRevisions.mockReturnValue(result({ data: [makeRevision()] }));
    hooks.usePlaybookStaleCandidates.mockReturnValue(result({ data: [makeCandidate()] }));
    hooks.usePlaybookUsage.mockReturnValue(result({ data: [makeUsage()] }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders loading, error, and not-found states', () => {
    hooks.usePlaybook.mockReturnValueOnce(result({ loading: true }));
    const { unmount } = renderView();
    expect(screen.getByText('Loading...')).toBeTruthy();
    unmount();

    hooks.usePlaybook.mockReturnValueOnce(result({ error: 'Playbook failed' }));
    renderView();
    expect(screen.getByText('Playbook failed')).toBeTruthy();
    cleanup();

    hooks.usePlaybook.mockReturnValueOnce(result({ data: null }));
    renderView();
    expect(screen.getByText('Playbook not found.')).toBeTruthy();
  });

  it('renders details and activates a playbook', async () => {
    const playbookRefetch = vi.fn();
    const revisionsRefetch = vi.fn();
    const staleRefetch = vi.fn();
    const usageRefetch = vi.fn();
    hooks.usePlaybook.mockReturnValue(result({ data: makePlaybook(), refetch: playbookRefetch }));
    hooks.usePlaybookRevisions.mockReturnValue(result({ data: [makeRevision()], refetch: revisionsRefetch }));
    hooks.usePlaybookStaleCandidates.mockReturnValue(result({ data: [makeCandidate()], refetch: staleRefetch }));
    hooks.usePlaybookUsage.mockReturnValue(result({ data: [makeUsage()], refetch: usageRefetch }));

    renderView();

    expect(screen.getByText(/Repeated failed runs in the last 30 days/)).toBeTruthy();
    expect(screen.getByText('memory-1')).toBeTruthy();
    expect(screen.getByText('67%')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'run-1' }).getAttribute('href')).toBe('/runs/run-1');
    expect(screen.getByRole('link', { name: 'Propose patch' }).getAttribute('href')).toBe(
      '/playbook-proposals/new?kind=patch&recordId=workspace%3Aws-1%3Atriage',
    );
    expect(screen.getByRole('link', { name: 'Draft repair proposal' }).getAttribute('href')).toContain(
      '/playbook-proposals/new?kind=patch&recordId=workspace%3Aws-1%3Atriage',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v1/playbooks/workspace%3Aws-1%3Atriage/activate', {
        updatedBy: 'web-inspector',
      });
      expect(playbookRefetch).toHaveBeenCalled();
      expect(revisionsRefetch).toHaveBeenCalled();
      expect(staleRefetch).toHaveBeenCalled();
      expect(usageRefetch).not.toHaveBeenCalled();
    });

    api.post.mockResolvedValueOnce({ id: 'proposal-1' });
    fireEvent.click(screen.getByRole('button', { name: 'Suggest patch from recent failures' }));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v1/playbooks/workspace%3Aws-1%3Atriage/suggest-patch', {
        proposedBy: 'web-inspector',
      });
    });
  });

  it('shows action errors when lifecycle updates fail', async () => {
    api.post.mockRejectedValueOnce(new Error('Activation failed'));

    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

    expect(await screen.findByText('Activation failed')).toBeTruthy();
  });
});
