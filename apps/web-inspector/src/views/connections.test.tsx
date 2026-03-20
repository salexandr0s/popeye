// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { Connections } from './connections';

const hooks = vi.hoisted(() => ({
  useConnections: vi.fn(),
  useEmailAccounts: vi.fn(),
  useCalendarAccounts: vi.fn(),
  useGithubAccounts: vi.fn(),
}));

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));

vi.mock('../api/hooks', () => hooks);
vi.mock('../api/provider', () => ({
  useApi: () => api,
}));

function makeConnection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'connection-1',
    domain: 'email',
    providerKind: 'gmail',
    label: 'Gmail (operator@example.com)',
    mode: 'read_only',
    secretRefId: 'secret-1',
    enabled: true,
    syncIntervalSeconds: 900,
    allowedScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    allowedResources: ['operator@example.com'],
    lastSyncAt: null,
    lastSyncStatus: null,
    createdAt: '2026-03-20T10:00:00.000Z',
    updatedAt: '2026-03-20T10:00:00.000Z',
    policy: {
      status: 'ready',
      secretStatus: 'configured',
      mutatingRequiresApproval: true,
      diagnostics: [],
    },
    health: {
      status: 'healthy',
      authState: 'configured',
      checkedAt: '2026-03-20T10:05:00.000Z',
      lastError: null,
      diagnostics: [],
    },
    sync: {
      status: 'idle',
      lastAttemptAt: null,
      lastSuccessAt: null,
      cursorKind: 'history_id',
      cursorPresent: false,
      lagSummary: 'Awaiting first sync',
    },
    ...overrides,
  };
}

function makeResult(data: unknown, overrides: Record<string, unknown> = {}) {
  return {
    data,
    error: null,
    loading: false,
    updatedAt: '2026-03-20T10:00:00.000Z',
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderConnections() {
  return render(
    <MemoryRouter>
      <Connections />
    </MemoryRouter>,
  );
}

describe('Connections', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    api.get.mockReset();
    api.post.mockReset();
    api.patch.mockReset();
    hooks.useConnections.mockReturnValue(makeResult([]));
    hooks.useEmailAccounts.mockReturnValue(makeResult([]));
    hooks.useCalendarAccounts.mockReturnValue(makeResult([]));
    hooks.useGithubAccounts.mockReturnValue(makeResult([]));
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('renders empty state when no connections exist', () => {
    renderConnections();

    expect(screen.getByRole('heading', { name: 'Connections' })).toBeTruthy();
    expect(screen.getByText('No connections yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect Gmail' })).toBeTruthy();
  });

  it('completes the browser OAuth flow when the session reaches completed', async () => {
    const refetchConnections = vi.fn();
    const refetchEmail = vi.fn();
    const refetchCalendar = vi.fn();
    const refetchGithub = vi.fn();
    hooks.useConnections.mockReturnValue(makeResult([], { refetch: refetchConnections }));
    hooks.useEmailAccounts.mockReturnValue(makeResult([], { refetch: refetchEmail }));
    hooks.useCalendarAccounts.mockReturnValue(makeResult([], { refetch: refetchCalendar }));
    hooks.useGithubAccounts.mockReturnValue(makeResult([], { refetch: refetchGithub }));

    api.post.mockResolvedValueOnce({
      id: 'oauth-session-1',
      providerKind: 'gmail',
      domain: 'email',
      status: 'pending',
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=test',
      redirectUri: 'http://127.0.0.1:3210/v1/connections/oauth/callback',
      connectionId: null,
      accountId: null,
      error: null,
      createdAt: '2026-03-20T10:00:00.000Z',
      expiresAt: '2026-03-20T10:15:00.000Z',
      completedAt: null,
    });
    api.get.mockResolvedValueOnce({
      id: 'oauth-session-1',
      providerKind: 'gmail',
      domain: 'email',
      status: 'completed',
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=test',
      redirectUri: 'http://127.0.0.1:3210/v1/connections/oauth/callback',
      connectionId: 'connection-1',
      accountId: 'account-1',
      error: null,
      createdAt: '2026-03-20T10:00:00.000Z',
      expiresAt: '2026-03-20T10:15:00.000Z',
      completedAt: '2026-03-20T10:01:00.000Z',
    });

    renderConnections();
    fireEvent.click(screen.getByRole('button', { name: 'Connect Gmail' }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(api.post).toHaveBeenCalledWith('/v1/connections/oauth/start', {
      providerKind: 'gmail',
      mode: 'read_only',
      syncIntervalSeconds: 900,
    });
    expect(window.open).toHaveBeenCalledWith(
      'https://accounts.google.com/o/oauth2/v2/auth?state=test',
      '_blank',
      'noopener,noreferrer',
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.get).toHaveBeenCalledWith('/v1/connections/oauth/sessions/oauth-session-1');
    expect(refetchConnections).toHaveBeenCalled();
    expect(refetchEmail).toHaveBeenCalled();
    expect(refetchCalendar).toHaveBeenCalled();
    expect(refetchGithub).toHaveBeenCalled();
  });

  it('routes manual syncs only for supported provider domains', async () => {
    const refetchConnections = vi.fn();
    hooks.useConnections.mockReturnValue(makeResult([
      makeConnection(),
      makeConnection({
        id: 'connection-2',
        domain: 'todos',
        providerKind: 'todoist',
        label: 'Todoist',
      }),
    ], { refetch: refetchConnections }));
    hooks.useEmailAccounts.mockReturnValue(makeResult([
      {
        id: 'email-account-1',
        connectionId: 'connection-1',
        emailAddress: 'operator@example.com',
        displayName: 'Operator',
      },
    ]));
    api.post.mockResolvedValueOnce({ accountId: 'email-account-1', synced: 0, updated: 0, errors: [] });

    renderConnections();

    expect(screen.getAllByRole('button', { name: 'Sync' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(api.post).toHaveBeenCalledWith('/v1/email/sync', { accountId: 'email-account-1' });
    expect(refetchConnections).toHaveBeenCalled();
  });
});
