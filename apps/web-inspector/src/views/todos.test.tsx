// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { Todos } from './todos';

const hooks = vi.hoisted(() => ({
  useConnections: vi.fn(),
  useOAuthProviders: vi.fn(),
  useTodoAccounts: vi.fn(),
  useTodoProjects: vi.fn(),
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

describe('Todos', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    api.patch.mockReset();
    hooks.useConnections.mockReturnValue(makeResult([]));
    hooks.useOAuthProviders.mockReturnValue(makeResult([
      {
        providerKind: 'google_tasks',
        domain: 'todos',
        status: 'missing_client_credentials',
        details: 'Google OAuth is not configured. Add providerAuth.google.clientId and save the Google OAuth client secret in Popeye so providerAuth.google.clientSecretRefId points to an available secret.',
      },
    ]));
    hooks.useTodoAccounts.mockReturnValue(makeResult([]));
    hooks.useTodoProjects.mockReturnValue(makeResult([]));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('disables Google Tasks connect when OAuth config is missing', () => {
    render(
      <MemoryRouter>
        <Todos />
      </MemoryRouter>,
    );

    const button = screen.getByRole('button', { name: 'Connect Google Tasks' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/providerAuth\.google\.clientId/)).toBeTruthy();
    expect(screen.getByText(/providerAuth\.google\.clientSecretRefId/)).toBeTruthy();

    fireEvent.click(button);
    expect(api.post).not.toHaveBeenCalled();
  });
});
