// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Approvals } from './approvals';

const hooks = vi.hoisted(() => ({
  useApprovals: vi.fn(),
}));

const api = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock('../api/hooks', () => hooks);
vi.mock('../api/provider', () => ({
  useApi: () => api,
}));

function makeApproval(overrides: Record<string, unknown> = {}) {
  return {
    id: 'approval-1',
    scope: 'vault_open',
    domain: 'finance',
    riskClass: 'ask',
    actionKind: 'open_vault',
    resourceScope: 'resource',
    resourceType: 'vault',
    resourceId: 'vault-1',
    requestedBy: 'agent',
    runId: 'run-1',
    standingApprovalEligible: true,
    automationGrantEligible: false,
    interventionId: 'int-1',
    payloadPreview: '',
    idempotencyKey: null,
    status: 'pending',
    resolvedBy: null,
    decisionReason: null,
    expiresAt: '2026-03-20T10:00:00.000Z',
    createdAt: '2026-03-20T09:00:00.000Z',
    resolvedAt: null,
    ...overrides,
  };
}

function makeApprovalsResult(overrides: Record<string, unknown> = {}) {
  return {
    data: [makeApproval()],
    error: null,
    loading: false,
    updatedAt: '2026-03-20T09:00:00.000Z',
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderApprovals() {
  return render(
    <MemoryRouter>
      <Approvals />
    </MemoryRouter>,
  );
}

describe('Approvals', () => {
  beforeEach(() => {
    api.post.mockReset();
    api.post.mockResolvedValue({});
    hooks.useApprovals.mockReturnValue(makeApprovalsResult());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders loading, error, and empty states', () => {
    hooks.useApprovals.mockReturnValueOnce(makeApprovalsResult({ data: null, loading: true }));
    const { unmount } = renderApprovals();
    expect(screen.getByText('Loading...')).toBeTruthy();
    unmount();

    hooks.useApprovals.mockReturnValueOnce(makeApprovalsResult({ data: null, error: 'Approvals failed' }));
    renderApprovals();
    expect(screen.getByText('Approvals failed')).toBeTruthy();
    cleanup();

    hooks.useApprovals.mockReturnValueOnce(makeApprovalsResult({ data: [] }));
    renderApprovals();
    expect(screen.getByText('No approvals')).toBeTruthy();
  });

  it('renders approval rows and resolves them', async () => {
    const refetch = vi.fn();
    hooks.useApprovals.mockReturnValue(makeApprovalsResult({ refetch }));

    renderApprovals();

    expect(screen.getByText('vault_open')).toBeTruthy();
    expect(screen.getByText('open_vault')).toBeTruthy();
    expect(screen.getByText('run-1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v1/approvals/approval-1/resolve', { decision: 'approved' });
      expect(refetch).toHaveBeenCalled();
    });
  });

  it('shows action errors when resolution fails', async () => {
    api.post.mockRejectedValueOnce(new Error('Approval blocked'));

    renderApprovals();
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));

    expect(await screen.findByText('Approval blocked')).toBeTruthy();
  });

  it('shows grant provenance for resolved approvals', () => {
    hooks.useApprovals.mockReturnValue(makeApprovalsResult({
      data: [makeApproval({
        status: 'approved',
        resolvedBy: 'standing_approval',
        resolvedByGrantId: 'standing-1',
      })],
    }));

    renderApprovals();

    expect(screen.getByText('standing_approval')).toBeTruthy();
    expect(screen.getByText('standing-1')).toBeTruthy();
  });
});
