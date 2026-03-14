import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../api/provider';
import type { MemorySearchResponse, MemorySearchResult } from '../api/hooks';
import { Loading } from '../components/loading';
import { ErrorDisplay } from '../components/error-display';
import { EmptyState } from '../components/empty-state';
import { PageHeader } from '../components/page-header';

function MemoryResultCard({ result }: { result: MemorySearchResult }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[16px]">
      <div className="flex items-start justify-between gap-[12px]">
        <div className="flex-1">
          <p className="text-[14px] font-medium text-[var(--color-fg)]">
            {result.description}
          </p>
          <div className="flex gap-[12px] mt-[8px]">
            <span className="text-[12px] text-[var(--color-fg-muted)]">
              Type: {result.type}
            </span>
            <span className="text-[12px] text-[var(--color-fg-muted)]">
              Scope: {result.scope}
            </span>
            <span className="text-[12px] text-[var(--color-fg-muted)]">
              Confidence: {(result.effectiveConfidence * 100).toFixed(0)}%
            </span>
            <span className="text-[12px] text-[var(--color-fg-muted)]">
              Score: {result.score.toFixed(3)}
            </span>
          </div>
        </div>
      </div>
      {result.content ? (
        <pre className="mt-[12px] text-[13px] text-[var(--color-fg)] font-[var(--font-mono)] whitespace-pre-wrap bg-[var(--color-bg-muted)] rounded-[var(--radius-sm)] p-[12px] max-h-[200px] overflow-y-auto">
          {result.content}
        </pre>
      ) : null}
    </div>
  );
}

export function MemorySearch() {
  const api = useApi();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryFromParams = searchParams.get('q') ?? '';
  const [query, setQuery] = useState(queryFromParams);
  const [response, setResponse] = useState<MemorySearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchSearch = useCallback(async (searchQuery: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.post<MemorySearchResponse>('/v1/memory/search', {
        query: searchQuery,
        includeContent: true,
        limit: 20,
      });
      setResponse(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setResponse(null);
    } finally {
      setLoading(false);
    }
  }, [api]);

  const handleSearch = () => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return;
    setSearchParams({ q: normalizedQuery });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  useEffect(() => {
    setQuery(queryFromParams);
    if (!queryFromParams.trim()) {
      setResponse(null);
      setError(null);
      setLoading(false);
      return;
    }
    void fetchSearch(queryFromParams.trim());
  }, [fetchSearch, queryFromParams]);

  return (
    <div>
      <PageHeader
        title="Memory"
        description="Search the memory database"
      />

      <div className="flex gap-[8px] mb-[24px]">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search memories..."
          className="flex-1 px-[12px] py-[8px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[14px] text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)] transition-colors duration-[var(--duration-fast)] placeholder:text-[var(--color-fg-muted)]/50"
        />
        <button
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          className="px-[16px] py-[8px] rounded-[var(--radius-sm)] text-[14px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors duration-[var(--duration-fast)]"
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </div>

      {error ? <ErrorDisplay message={error} /> : null}
      {loading ? <Loading /> : null}

      {response ? (
        <div>
          <p className="text-[12px] text-[var(--color-fg-muted)] mb-[12px]">
            {response.results.length} of {response.totalCandidates} candidates
            in {response.latencyMs.toFixed(0)}ms ({response.searchMode})
          </p>
          {response.results.length > 0 ? (
            <div className="space-y-[8px]">
              {response.results.map((r) => (
                <MemoryResultCard key={r.id} result={r} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No results"
              description="Try a different search query."
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
