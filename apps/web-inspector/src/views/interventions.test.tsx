// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Interventions } from './interventions';

const hooks = vi.hoisted(() => ({
  useInterventions: vi.fn(),
}));

const api = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock('../api/hooks', () => hooks);
vi.mock('../api/provider', () => ({
  useApi: () => api,
}));

function makeIntervention(overrides: Record<string, unknown> = {}) {
  return {
    id: 'int-1',
    code: 'needs_operator_input',
    runId: 'run-1',
    status: 'open',
    reason: 'Need operator confirmation',
    createdAt: '2026-03-14T10:00:00.000Z',
    resolvedAt: null,
    ...overrides,
  };
}

function makeInterventionsResult(overrides: Record<string, unknown> = {}) {
  return {
    data: [makeIntervention()],
    error: null,
    loading: false,
    updatedAt: '2026-03-14T10:00:00.000Z',
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderInterventions() {
  return render(
    <MemoryRouter>
      <Interventions />
    </MemoryRouter>,
  );
}

describe('Interventions', () => {
  beforeEach(() => {
    api.post.mockReset();
    api.post.mockResolvedValue({});
    hooks.useInterventions.mockReturnValue(makeInterventionsResult());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders loading, error, and empty states', () => {
    hooks.useInterventions.mockReturnValueOnce(makeInterventionsResult({ data: null, loading: true }));
    const { unmount } = renderInterventions();
    expect(screen.getByText('Loading...')).toBeTruthy();
    unmount();

    hooks.useInterventions.mockReturnValueOnce(makeInterventionsResult({ data: null, error: 'Interventions failed' }));
    renderInterventions();
    expect(screen.getByText('Interventions failed')).toBeTruthy();
    cleanup();

    hooks.useInterventions.mockReturnValueOnce(makeInterventionsResult({ data: [] }));
    renderInterventions();
    expect(screen.getByText('No interventions')).toBeTruthy();
  });

  it('shows resolve only for open interventions', () => {
    hooks.useInterventions.mockReturnValue(makeInterventionsResult({
      data: [
        makeIntervention({ id: 'int-open', status: 'open' }),
        makeIntervention({ id: 'int-resolved', status: 'resolved', resolvedAt: '2026-03-14T10:10:00.000Z' }),
      ],
    }));

    renderInterventions();

    expect(screen.getByRole('button', { name: 'Resolve' })).toBeTruthy();
    expect(screen.getAllByText('resolved')).toHaveLength(1);
  });

  it('posts resolve and refetches on success', async () => {
    const refetch = vi.fn();
    hooks.useInterventions.mockReturnValue(makeInterventionsResult({ refetch }));

    renderInterventions();

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v1/interventions/int-1/resolve');
      expect(refetch).toHaveBeenCalled();
    });
  });

  it('shows action errors when resolve fails', async () => {
    api.post.mockRejectedValueOnce(new Error('Resolve blocked'));

    renderInterventions();

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    expect(await screen.findByText('Resolve blocked')).toBeTruthy();
  });
});
