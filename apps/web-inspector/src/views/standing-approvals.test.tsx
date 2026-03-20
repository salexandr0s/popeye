// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { StandingApprovals } from './standing-approvals';

const hooks = vi.hoisted(() => ({
  useStandingApprovals: vi.fn(),
}));

const api = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock('../api/hooks', () => hooks);
vi.mock('../api/provider', () => ({
  useApi: () => api,
}));

function makeStandingApproval(overrides: Record<string, unknown> = {}) {
  return {
    id: 'standing-1',
    scope: 'external_write',
    domain: 'email',
    actionKind: 'write',
    resourceScope: 'resource',
    resourceType: 'draft',
    resourceId: 'draft-1',
    requestedBy: 'popeye_email_send',
    workspaceId: 'default',
    projectId: null,
    note: '',
    expiresAt: null,
    createdBy: 'operator',
    status: 'active',
    createdAt: '2026-03-20T09:00:00.000Z',
    revokedAt: null,
    revokedBy: null,
    ...overrides,
  };
}

function makeResult(overrides: Record<string, unknown> = {}) {
  return {
    data: [makeStandingApproval()],
    error: null,
    loading: false,
    updatedAt: '2026-03-20T09:00:00.000Z',
    refetch: vi.fn(),
    ...overrides,
  };
}

describe('StandingApprovals', () => {
  beforeEach(() => {
    api.post.mockReset();
    api.post.mockResolvedValue({});
    hooks.useStandingApprovals.mockReturnValue(makeResult());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders empty state', () => {
    hooks.useStandingApprovals.mockReturnValue(makeResult({ data: [] }));
    render(<MemoryRouter><StandingApprovals /></MemoryRouter>);
    expect(screen.getByText('No standing approvals')).toBeTruthy();
  });

  it('creates and revokes standing approvals', async () => {
    const refetch = vi.fn();
    hooks.useStandingApprovals.mockReturnValue(makeResult({ refetch }));

    render(<MemoryRouter><StandingApprovals /></MemoryRouter>);

    fireEvent.change(screen.getByPlaceholderText('Resource type (required)'), { target: { value: 'vault' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create standing approval' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v1/policies/standing-approvals', expect.objectContaining({
        resourceType: 'vault',
        createdBy: 'web_inspector',
      }));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v1/policies/standing-approvals/standing-1/revoke', { revokedBy: 'web_inspector' });
      expect(refetch).toHaveBeenCalled();
    });
  });
});
