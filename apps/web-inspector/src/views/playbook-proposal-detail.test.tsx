// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { PlaybookProposalDetailView } from './playbook-proposal-detail';

const hooks = vi.hoisted(() => ({
  usePlaybookProposal: vi.fn(),
}));

const api = vi.hoisted(() => ({
  post: vi.fn(),
  patch: vi.fn(),
}));

vi.mock('../api/hooks', () => hooks);
vi.mock('../api/provider', () => ({
  useApi: () => api,
}));

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
    summary: 'Summary',
    body: 'Body',
    markdownText: '---\nBody\n',
    diffPreview: '+ Body',
    contentHash: 'content-1',
    revisionHash: 'revision-1',
    scanVerdict: 'sanitize',
    scanMatchedRules: ['warn-rule'],
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
    <MemoryRouter initialEntries={['/playbook-proposals/proposal-1']}>
      <Routes>
        <Route path="/playbook-proposals/:proposalId" element={<PlaybookProposalDetailView />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PlaybookProposalDetailView', () => {
  beforeEach(() => {
    api.post.mockReset();
    api.patch.mockReset();
    api.post.mockResolvedValue({});
    api.patch.mockResolvedValue({});
    hooks.usePlaybookProposal.mockReturnValue(result({ data: makeProposal() }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders loading, error, and not-found states', () => {
    hooks.usePlaybookProposal.mockReturnValueOnce(result({ loading: true }));
    const { unmount } = renderView();
    expect(screen.getByText('Loading...')).toBeTruthy();
    unmount();

    hooks.usePlaybookProposal.mockReturnValueOnce(result({ error: 'Proposal failed' }));
    renderView();
    expect(screen.getByText('Proposal failed')).toBeTruthy();
    cleanup();

    hooks.usePlaybookProposal.mockReturnValueOnce(result({ data: null }));
    renderView();
    expect(screen.getByText('Playbook proposal not found.')).toBeTruthy();
  });

  it('reviews a pending proposal', async () => {
    const refetch = vi.fn();
    hooks.usePlaybookProposal.mockReturnValue(result({ data: makeProposal(), refetch }));

    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v1/playbook-proposals/proposal-1/review', {
        decision: 'approved',
        reviewedBy: 'web-inspector',
        note: '',
      });
      expect(refetch).toHaveBeenCalled();
    });
  });

  it('applies an approved proposal and shows errors', async () => {
    const refetch = vi.fn();
    hooks.usePlaybookProposal.mockReturnValue(
      result({
        data: makeProposal({ status: 'approved', kind: 'patch', targetRecordId: 'workspace:ws-1:triage' }),
        refetch,
      }),
    );

    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Apply to canonical file' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v1/playbook-proposals/proposal-1/apply', {
        appliedBy: 'web-inspector',
      });
      expect(refetch).toHaveBeenCalled();
    });

    api.post.mockRejectedValueOnce(new Error('Apply failed'));
    hooks.usePlaybookProposal.mockReturnValue(
      result({
        data: makeProposal({ status: 'approved', kind: 'patch', targetRecordId: 'workspace:ws-1:triage' }),
      }),
    );
    cleanup();
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Apply to canonical file' }));
    expect(await screen.findByText('Apply failed')).toBeTruthy();
  });

  it('edits drafting proposals, shows evidence, and submits them for review', async () => {
    const refetch = vi.fn();
    hooks.usePlaybookProposal.mockReturnValue(
      result({
        data: makeProposal({
          kind: 'patch',
          status: 'drafting',
          targetRecordId: 'workspace:ws-1:triage',
          baseRevisionHash: 'rev-1',
          diffPreview: '',
          evidence: {
            runIds: ['run-1'],
            interventionIds: ['intervention-1'],
            lastProblemAt: '2026-03-30T10:00:00.000Z',
            metrics30d: { useCount30d: 3, failedRuns30d: 2, interventions30d: 1 },
            suggestedPatchNote: 'Needs follow-up',
          },
        }),
        refetch,
      }),
    );

    renderView();

    expect(screen.getByText('No canonical diff yet. Edit the proposed body before submitting for review.')).toBeTruthy();
    expect(screen.getByText('Needs follow-up')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'run-1' })[0]?.getAttribute('href')).toBe('/runs/run-1');

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Updated title' } });
    fireEvent.change(screen.getByLabelText('Allowed profiles'), { target: { value: 'default, reviewer' } });
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'Updated summary' } });
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'Updated body' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/v1/playbook-proposals/proposal-1', {
        title: 'Updated title',
        allowedProfileIds: ['default', 'reviewer'],
        summary: 'Updated summary',
        body: 'Updated body',
        updatedBy: 'web-inspector',
      });
      expect(refetch).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v1/playbook-proposals/proposal-1/submit-review', {
        submittedBy: 'web-inspector',
      });
    });
  });
});
