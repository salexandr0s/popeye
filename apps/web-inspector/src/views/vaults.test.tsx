// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Vaults } from './vaults';

const hooks = vi.hoisted(() => ({
  useVaults: vi.fn(),
}));

const api = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock('../api/hooks', () => hooks);
vi.mock('../api/provider', () => ({
  useApi: () => api,
}));

function makeVault(overrides: Record<string, unknown> = {}) {
  return {
    id: 'vault-1',
    domain: 'finance',
    kind: 'restricted',
    dbPath: '/tmp/popeye/vaults/finance/records.db',
    encrypted: false,
    encryptionKeyRef: null,
    status: 'open',
    createdAt: '2026-03-20T10:00:00.000Z',
    lastAccessedAt: '2026-03-20T10:30:00.000Z',
    ...overrides,
  };
}

function makeVaultsResult(overrides: Record<string, unknown> = {}) {
  return {
    data: [makeVault()],
    error: null,
    loading: false,
    updatedAt: '2026-03-20T10:00:00.000Z',
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderVaults() {
  return render(
    <MemoryRouter>
      <Vaults />
    </MemoryRouter>,
  );
}

describe('Vaults', () => {
  beforeEach(() => {
    api.post.mockReset();
    api.post.mockResolvedValue({});
    hooks.useVaults.mockReturnValue(makeVaultsResult());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders loading, error, and empty states', () => {
    hooks.useVaults.mockReturnValueOnce(makeVaultsResult({ data: null, loading: true }));
    const { unmount } = renderVaults();
    expect(screen.getByText('Loading...')).toBeTruthy();
    unmount();

    hooks.useVaults.mockReturnValueOnce(makeVaultsResult({ data: null, error: 'Vaults failed' }));
    renderVaults();
    expect(screen.getByText('Vaults failed')).toBeTruthy();
    cleanup();

    hooks.useVaults.mockReturnValueOnce(makeVaultsResult({ data: [] }));
    renderVaults();
    expect(screen.getByText('No vaults')).toBeTruthy();
  });

  it('renders vault rows and posts actions', async () => {
    const refetch = vi.fn();
    hooks.useVaults.mockReturnValue(makeVaultsResult({ refetch }));

    renderVaults();

    expect(screen.getByText('finance')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v1/vaults/vault-1/close', {});
      expect(refetch).toHaveBeenCalled();
    });
  });

  it('shows action errors when vault mutation fails', async () => {
    api.post.mockRejectedValueOnce(new Error('Vault sealed elsewhere'));

    renderVaults();
    fireEvent.click(screen.getByRole('button', { name: 'Seal' }));

    expect(await screen.findByText('Vault sealed elsewhere')).toBeTruthy();
  });
});
