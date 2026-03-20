// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { People } from './people';

const hooks = vi.hoisted(() => ({
  usePeople: vi.fn(),
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

function makePerson(overrides: Record<string, unknown> = {}) {
  return {
    id: 'person-1',
    displayName: 'Operator Example',
    pronouns: null,
    tags: ['ops'],
    notes: 'existing note',
    canonicalEmail: 'operator@example.com',
    githubLogin: 'operator',
    activitySummary: 'email, github',
    identityCount: 2,
    contactMethodCount: 2,
    policy: null,
    identities: [
      {
        id: 'identity-email',
        personId: 'person-1',
        provider: 'email',
        externalId: 'operator@example.com',
        displayName: 'Operator Example',
        handle: null,
        createdAt: '2026-03-20T10:00:00.000Z',
        updatedAt: '2026-03-20T10:00:00.000Z',
      },
    ],
    contactMethods: [
      {
        id: 'contact-email',
        personId: 'person-1',
        type: 'email',
        value: 'operator@example.com',
        label: 'derived',
        source: 'derived',
        createdAt: '2026-03-20T10:00:00.000Z',
        updatedAt: '2026-03-20T10:00:00.000Z',
      },
    ],
    createdAt: '2026-03-20T10:00:00.000Z',
    updatedAt: '2026-03-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('People view', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    api.patch.mockReset();
    hooks.usePeople.mockReturnValue(makeResult([]));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders an empty state before any people are projected', () => {
    render(<People />);

    expect(screen.getByRole('heading', { name: 'People' })).toBeTruthy();
    expect(screen.getByText('No people projected yet')).toBeTruthy();
  });

  it('saves notes and detaches identities for the selected person', async () => {
    const refetch = vi.fn();
    hooks.usePeople.mockReturnValue(makeResult([makePerson()], { refetch }));
    api.patch.mockResolvedValue(makePerson({ notes: 'updated note', tags: ['ops', 'vip'] }));
    api.post.mockResolvedValueOnce(makePerson({ id: 'person-2', displayName: 'Detached Identity' }));

    render(<People />);

    fireEvent.change(screen.getByPlaceholderText('Tags (comma-separated)'), { target: { value: 'ops, vip' } });
    fireEvent.change(screen.getByPlaceholderText('Operator notes'), { target: { value: 'updated note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Notes' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/v1/people/person-1', {
      notes: 'updated note',
      tags: ['ops', 'vip'],
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Detach' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/v1/people/identities/identity-email/detach', {
      requestedBy: 'web-inspector',
    }));
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });
});
