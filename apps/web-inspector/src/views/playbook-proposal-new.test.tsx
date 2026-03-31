// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { PlaybookProposalNewView } from './playbook-proposal-new';

const hooks = vi.hoisted(() => ({
  usePlaybook: vi.fn(),
  useProjects: vi.fn(),
  useWorkspaces: vi.fn(),
}));

const api = vi.hoisted(() => ({
  post: vi.fn(),
}));

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('../api/hooks', () => hooks);
vi.mock('../api/provider', () => ({
  useApi: () => api,
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

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
    updatedAt: '2026-03-31T10:00:00.000Z',
    refetch: vi.fn(),
    ...overrides,
  };
}

function makePlaybook(overrides: Record<string, unknown> = {}) {
  return {
    recordId: 'workspace:ws-1:triage',
    playbookId: 'triage',
    scope: 'workspace',
    workspaceId: 'ws-1',
    projectId: null,
    title: 'Triage',
    status: 'active',
    allowedProfileIds: ['default'],
    filePath: '/tmp/triage.md',
    currentRevisionHash: 'rev-1',
    body: 'Current playbook body',
    markdownText: '---\nBody\n',
    indexedMemoryId: 'memory-1',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z',
    ...overrides,
  };
}

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
    sourceRunId: null,
    proposedBy: 'operator_api',
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    appliedRecordId: null,
    appliedRevisionHash: null,
    appliedAt: null,
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z',
    ...overrides,
  };
}

function renderView(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/playbook-proposals/new" element={<PlaybookProposalNewView />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PlaybookProposalNewView', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    api.post.mockReset();
    api.post.mockResolvedValue(makeProposal());
    hooks.usePlaybook.mockReturnValue(result({ data: makePlaybook() }));
    hooks.useWorkspaces.mockReturnValue(result({ data: [{ id: 'ws-1', name: 'Workspace One', rootPath: '/tmp/ws-1', createdAt: '2026-03-31T10:00:00.000Z' }] }));
    hooks.useProjects.mockReturnValue(result({ data: [{ id: 'proj-1', workspaceId: 'ws-1', name: 'Project One', path: '/tmp/ws-1/proj-1', createdAt: '2026-03-31T10:00:00.000Z' }] }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('validates scope-dependent draft selectors before submit', async () => {
    renderView('/playbook-proposals/new?kind=draft');

    fireEvent.change(screen.getByLabelText('Playbook ID'), { target: { value: 'followup' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Follow-up' } });
    fireEvent.change(screen.getByLabelText('Scope'), { target: { value: 'workspace' } });
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'Draft body' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create proposal' }));

    expect(await screen.findByText('Workspace selection is required for this scope.')).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('creates project-scoped draft proposals from the web form', async () => {
    renderView('/playbook-proposals/new?kind=draft');

    fireEvent.change(screen.getByLabelText('Playbook ID'), { target: { value: 'followup' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Follow-up' } });
    fireEvent.change(screen.getByLabelText('Scope'), { target: { value: 'project' } });
    fireEvent.change(screen.getByLabelText('Workspace'), { target: { value: 'ws-1' } });
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'proj-1' } });
    fireEvent.change(screen.getByLabelText('Allowed profiles'), { target: { value: 'reviewer, default' } });
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'Draft summary' } });
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'Draft body' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create proposal' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v1/playbook-proposals', {
        kind: 'draft',
        playbookId: 'followup',
        scope: 'project',
        workspaceId: 'ws-1',
        projectId: 'proj-1',
        title: 'Follow-up',
        allowedProfileIds: ['default', 'reviewer'],
        summary: 'Draft summary',
        body: 'Draft body',
      });
      expect(navigateMock).toHaveBeenCalledWith('/playbook-proposals/proposal-1');
    });
  });

  it('prefills patch proposals and submits the target record plus base revision hash', async () => {
    renderView('/playbook-proposals/new?kind=patch&recordId=workspace%3Aws-1%3Atriage&repairSummary=Needs%20repair');

    expect(screen.getByDisplayValue('Triage')).toBeTruthy();
    expect(screen.getByDisplayValue('default')).toBeTruthy();
    expect(screen.getByDisplayValue('Needs repair')).toBeTruthy();
    expect(screen.getByDisplayValue('Current playbook body')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'Updated body' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create proposal' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v1/playbook-proposals', {
        kind: 'patch',
        targetRecordId: 'workspace:ws-1:triage',
        baseRevisionHash: 'rev-1',
        title: 'Triage',
        allowedProfileIds: ['default'],
        summary: 'Needs repair',
        body: 'Updated body',
      });
      expect(navigateMock).toHaveBeenCalledWith('/playbook-proposals/proposal-1');
    });
  });
});
