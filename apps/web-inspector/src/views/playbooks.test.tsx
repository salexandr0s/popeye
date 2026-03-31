// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { Playbooks } from './playbooks';

const hooks = vi.hoisted(() => ({
  usePlaybooks: vi.fn(),
  usePlaybookStaleCandidates: vi.fn(),
}));

vi.mock('../api/hooks', () => hooks);

function makePlaybook(overrides: Record<string, unknown> = {}) {
  return {
    recordId: 'workspace:ws-1:triage',
    playbookId: 'triage',
    scope: 'workspace',
    workspaceId: 'ws-1',
    projectId: null,
    title: 'Triage',
    status: 'active',
    allowedProfileIds: [],
    filePath: '/tmp/triage.md',
    currentRevisionHash: 'rev-1',
    effectiveness: {
      useCount30d: 4,
      succeededRuns30d: 3,
      failedRuns30d: 1,
      intervenedRuns30d: 1,
      successRate30d: 0.75,
      failureRate30d: 0.25,
      interventionRate30d: 0.25,
      lastUsedAt: '2026-03-31T10:00:00.000Z',
      lastUpdatedAt: '2026-03-30T10:00:00.000Z',
    },
    createdAt: '2026-03-30T10:00:00.000Z',
    updatedAt: '2026-03-30T10:00:00.000Z',
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

function pollingResult<T>(overrides: Partial<{
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

function renderPlaybooks() {
  return render(
    <MemoryRouter>
      <Playbooks />
    </MemoryRouter>,
  );
}

describe('Playbooks', () => {
  beforeEach(() => {
    hooks.usePlaybooks.mockImplementation((options?: { q?: string; status?: string; scope?: string; limit?: number; offset?: number }) => {
      const all = [
        makePlaybook(),
        makePlaybook({
          recordId: 'project:proj-1:followup',
          playbookId: 'followup',
          scope: 'project',
          projectId: 'proj-1',
          title: 'Follow-up',
          status: 'draft',
          effectiveness: {
            useCount30d: 2,
            succeededRuns30d: 1,
            failedRuns30d: 1,
            intervenedRuns30d: 0,
            successRate30d: 0.5,
            failureRate30d: 0.5,
            interventionRate30d: 0,
            lastUsedAt: '2026-03-29T10:00:00.000Z',
            lastUpdatedAt: '2026-03-30T10:00:00.000Z',
          },
        }),
      ];
      const filtered = all.filter((playbook) => {
        if (options?.status && playbook.status !== options.status) return false;
        if (options?.scope && playbook.scope !== options.scope) return false;
        if (options?.q && ![playbook.recordId, playbook.playbookId, playbook.title].join(' ').toLowerCase().includes(options.q.toLowerCase())) {
          return false;
        }
        return true;
      });
      return pollingResult({ data: filtered });
    });
    hooks.usePlaybookStaleCandidates.mockReturnValue(
      pollingResult({
        data: [makeCandidate()],
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders loading, error, and empty states', () => {
    hooks.usePlaybooks.mockReturnValueOnce(pollingResult({ loading: true }));
    const { unmount } = renderPlaybooks();
    expect(screen.getByText('Loading...')).toBeTruthy();
    unmount();

    hooks.usePlaybooks.mockReturnValueOnce(pollingResult({ error: 'Playbooks failed' }));
    renderPlaybooks();
    expect(screen.getByText('Playbooks failed')).toBeTruthy();
    cleanup();

    hooks.usePlaybooks.mockReturnValueOnce(pollingResult({ data: [] }));
    renderPlaybooks();
    expect(screen.getByText('No playbooks yet')).toBeTruthy();
  });

  it('renders stale candidates, routes filters through usePlaybooks, and exposes authoring links', () => {
    renderPlaybooks();

    const table = within(screen.getByRole('table'));
    expect(screen.getAllByText('Needs review')).toHaveLength(2);
    expect(screen.getByText(/Repeated failed runs in the last 30 days/)).toBeTruthy();
    expect(table.getByText('workspace:ws-1:triage')).toBeTruthy();
    expect(table.getByText('project:proj-1:followup')).toBeTruthy();
    expect(screen.getByText('75%')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'New playbook proposal' }).getAttribute('href')).toBe('/playbook-proposals/new?kind=draft');
    expect(screen.getByRole('link', { name: 'Draft repair proposal' }).getAttribute('href')).toContain('/playbook-proposals/new?kind=patch');

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'follow' } });
    expect(hooks.usePlaybooks).toHaveBeenLastCalledWith({ q: 'follow', limit: 26, offset: 0 });
    expect(within(screen.getByRole('table')).getByText('project:proj-1:followup')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'active' } });
    expect(hooks.usePlaybooks).toHaveBeenLastCalledWith({ status: 'active', limit: 26, offset: 0 });
    expect(within(screen.getByRole('table')).getByText('workspace:ws-1:triage')).toBeTruthy();
  });
});
