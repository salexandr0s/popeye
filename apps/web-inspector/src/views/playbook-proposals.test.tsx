// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { PlaybookProposals } from './playbook-proposals';

const hooks = vi.hoisted(() => ({
  usePlaybookProposals: vi.fn(),
}));

vi.mock('../api/hooks', () => hooks);

function makeProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'proposal-1',
    kind: 'draft',
    status: 'pending_review',
    targetRecordId: null,
    baseRevisionHash: null,
    playbookId: 'triage',
    scope: 'workspace',
    workspaceId: 'ws-1',
    projectId: null,
    title: 'Triage draft',
    proposedStatus: 'draft',
    allowedProfileIds: [],
    summary: '',
    body: 'Body',
    markdownText: '---\nBody\n',
    diffPreview: '+ Body',
    contentHash: 'content-1',
    revisionHash: 'revision-1',
    scanVerdict: 'allow',
    scanMatchedRules: [],
    sourceRunId: 'run-1',
    proposedBy: 'runtime_tool',
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    appliedRecordId: null,
    appliedRevisionHash: null,
    appliedAt: null,
    createdAt: '2026-03-30T10:00:00.000Z',
    updatedAt: '2026-03-30T10:00:00.000Z',
    evidence: null,
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
    <MemoryRouter>
      <PlaybookProposals />
    </MemoryRouter>,
  );
}

describe('PlaybookProposals', () => {
  beforeEach(() => {
    hooks.usePlaybookProposals.mockImplementation((options?: {
      q?: string;
      status?: string;
      kind?: string;
      scope?: string;
      sort?: string;
      limit?: number;
      offset?: number;
    }) => {
      const all = [
        makeProposal({
          status: 'drafting',
          evidence: {
            runIds: ['run-1'],
            interventionIds: [],
            lastProblemAt: '2026-03-30T10:00:00.000Z',
            metrics30d: { useCount30d: 3, failedRuns30d: 2, interventions30d: 0 },
            suggestedPatchNote: 'Needs follow-up',
          },
        }),
        makeProposal({
          id: 'proposal-2',
          title: 'Approved patch',
          kind: 'patch',
          status: 'approved',
          targetRecordId: 'workspace:ws-1:triage',
        }),
      ];
      const filtered = all.filter((proposal) => {
        if (options?.status && proposal.status !== options.status) return false;
        if (options?.kind && proposal.kind !== options.kind) return false;
        if (options?.scope && proposal.scope !== options.scope) return false;
        if (options?.q && ![proposal.title, proposal.id, proposal.playbookId, proposal.targetRecordId ?? ''].join(' ').toLowerCase().includes(options.q.toLowerCase())) {
          return false;
        }
        return true;
      });
      return result({ data: filtered });
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders loading, error, and empty states', () => {
    hooks.usePlaybookProposals.mockReturnValueOnce(result({ loading: true }));
    const { unmount } = renderView();
    expect(screen.getByText('Loading...')).toBeTruthy();
    unmount();

    hooks.usePlaybookProposals.mockReturnValueOnce(result({ error: 'Proposals failed' }));
    renderView();
    expect(screen.getByText('Proposals failed')).toBeTruthy();
    cleanup();

    hooks.usePlaybookProposals.mockReturnValueOnce(result({ data: [] }));
    renderView();
    expect(screen.getByText('No proposals yet')).toBeTruthy();
  });

  it('routes filters server-side and exposes the proposal queue', () => {
    renderView();

    const table = within(screen.getByRole('table'));
    expect(screen.getByRole('link', { name: 'New playbook proposal' }).getAttribute('href')).toBe('/playbook-proposals/new?kind=draft');
    expect(table.getByText('Triage draft')).toBeTruthy();
    expect(table.getByText('Approved patch')).toBeTruthy();
    expect(screen.getByText('Editable drafts on this page')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'drafting' } });
    expect(hooks.usePlaybookProposals).toHaveBeenLastCalledWith({
      status: 'drafting',
      sort: 'created_desc',
      limit: 26,
      offset: 0,
    });
    expect(within(screen.getByRole('table')).getByText('Triage draft')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'approved' } });
    expect(hooks.usePlaybookProposals).toHaveBeenLastCalledWith({
      q: 'approved',
      status: 'drafting',
      sort: 'created_desc',
      limit: 26,
      offset: 0,
    });
  });
});
