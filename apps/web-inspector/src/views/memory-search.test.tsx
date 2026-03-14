// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { MemorySearch } from './memory-search';

const api = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock('../api/provider', () => ({
  useApi: () => api,
}));

function makeSearchResponse(overrides: Record<string, unknown> = {}) {
  return {
    results: [
      {
        id: 'mem-1',
        description: 'Saved note',
        content: 'Full memory content',
        type: 'semantic',
        confidence: 0.9,
        effectiveConfidence: 0.85,
        scope: 'workspace',
        sourceType: 'receipt',
        createdAt: '2026-03-14T10:00:00.000Z',
        lastReinforcedAt: null,
        score: 0.8123,
        scoreBreakdown: {
          relevance: 0.8,
          recency: 0.7,
          confidence: 0.9,
          scopeMatch: 1,
        },
      },
    ],
    query: 'alpha',
    totalCandidates: 5,
    latencyMs: 12,
    searchMode: 'hybrid',
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function renderMemorySearch(initialEntry = '/memory') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/memory" element={<><MemorySearch /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('MemorySearch', () => {
  beforeEach(() => {
    api.post.mockReset();
    api.post.mockResolvedValue(makeSearchResponse());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('guards empty queries and keeps search disabled', () => {
    renderMemorySearch();

    expect(screen.getByRole('button', { name: 'Search' })).toHaveProperty('disabled', true);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('searches by button click and renders results', async () => {
    renderMemorySearch();

    fireEvent.change(screen.getByPlaceholderText('Search memories...'), { target: { value: 'alpha' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v1/memory/search', {
        query: 'alpha',
        includeContent: true,
        limit: 20,
      });
    });

    expect(screen.getByTestId('location-search').textContent).toBe('?q=alpha');
    expect(await screen.findByText('Saved note')).toBeTruthy();
    expect(screen.getByText('Full memory content')).toBeTruthy();
  });

  it('searches by pressing Enter and syncs the URL', async () => {
    renderMemorySearch();

    fireEvent.change(screen.getByPlaceholderText('Search memories...'), { target: { value: 'alpha' } });
    fireEvent.keyDown(screen.getByPlaceholderText('Search memories...'), { key: 'Enter' });

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByTestId('location-search').textContent).toBe('?q=alpha');
  });

  it('auto-searches from the q query param and renders empty results', async () => {
    api.post.mockResolvedValueOnce(makeSearchResponse({ results: [], totalCandidates: 0, query: 'from-url' }));

    renderMemorySearch('/memory?q=from-url');

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v1/memory/search', {
        query: 'from-url',
        includeContent: true,
        limit: 20,
      });
    });

    expect(screen.getByPlaceholderText('Search memories...')).toHaveProperty('value', 'from-url');
    expect(await screen.findByText('No results')).toBeTruthy();
  });

  it('shows request failures', async () => {
    api.post.mockRejectedValueOnce(new Error('Search failed'));

    renderMemorySearch('/memory?q=alpha');

    expect(await screen.findByText('Search failed')).toBeTruthy();
  });
});
