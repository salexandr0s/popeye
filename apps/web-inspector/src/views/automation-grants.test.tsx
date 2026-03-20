// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AutomationGrants } from './automation-grants';

const hooks = vi.hoisted(() => ({
  useAutomationGrants: vi.fn(),
}));

const api = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock('../api/hooks', () => hooks);
vi.mock('../api/provider', () => ({
  useApi: () => api,
}));

function makeAutomationGrant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'grant-1',
    scope: 'external_write',
    domain: 'todos',
    actionKind: 'digest',
    resourceScope: 'resource',
    resourceType: 'todo_digest',
    resourceId: null,
    requestedBy: 'popeye_todo_digest',
    workspaceId: 'default',
    projectId: null,
    note: '',
    expiresAt: null,
    createdBy: 'operator',
    taskSources: ['heartbeat', 'schedule'],
    status: 'active',
    createdAt: '2026-03-20T09:00:00.000Z',
    revokedAt: null,
    revokedBy: null,
    ...overrides,
  };
}

function makeResult(overrides: Record<string, unknown> = {}) {
  return {
    data: [makeAutomationGrant()],
    error: null,
    loading: false,
    updatedAt: '2026-03-20T09:00:00.000Z',
    refetch: vi.fn(),
    ...overrides,
  };
}

describe('AutomationGrants', () => {
  beforeEach(() => {
    api.post.mockReset();
    api.post.mockResolvedValue({});
    hooks.useAutomationGrants.mockReturnValue(makeResult());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders empty state', () => {
    hooks.useAutomationGrants.mockReturnValue(makeResult({ data: [] }));
    render(<MemoryRouter><AutomationGrants /></MemoryRouter>);
    expect(screen.getByText('No automation grants')).toBeTruthy();
  });

  it('creates and revokes automation grants', async () => {
    const refetch = vi.fn();
    hooks.useAutomationGrants.mockReturnValue(makeResult({ refetch }));

    render(<MemoryRouter><AutomationGrants /></MemoryRouter>);

    fireEvent.change(screen.getByPlaceholderText('Resource type (required)'), { target: { value: 'digest-job' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create automation grant' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v1/policies/automation-grants', expect.objectContaining({
        resourceType: 'digest-job',
        createdBy: 'web_inspector',
      }));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v1/policies/automation-grants/grant-1/revoke', { revokedBy: 'web_inspector' });
      expect(refetch).toHaveBeenCalled();
    });
  });
});
