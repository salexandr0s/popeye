import { useState } from 'react';
import { useApi } from '../api/provider';
import { useFileRoots, useFileWriteIntents } from '../api/hooks';
import { PageHeader } from '../components/page-header';
import { Loading } from '../components/loading';
import { ErrorDisplay } from '../components/error-display';
import { EmptyState } from '../components/empty-state';
import { Card } from '../components/card';

interface FileWriteIntentRecord {
  id: string;
  fileRootId: string;
  filePath: string;
  intentType: string;
  diffPreview: string;
  status: string;
  runId: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

interface FileRootRecord {
  id: string;
  workspaceId: string;
  label: string;
  rootPath: string;
  permission: string;
  filePatterns: string[];
  excludePatterns: string[];
  maxFileSizeBytes: number;
  enabled: boolean;
  lastIndexedAt: string | null;
  lastIndexedCount: number;
  createdAt: string;
  updatedAt: string;
}

interface FileSearchResponse {
  query: string;
  results: Array<{
    documentId: string;
    filePath: string;
    snippet: string;
    score: number;
  }>;
}

export function Files() {
  const api = useApi();
  const roots = useFileRoots();
  const pendingIntents = useFileWriteIntents('pending');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FileSearchResponse['results']>([]);

  if (roots.loading) return <Loading />;
  if (roots.error) return <ErrorDisplay message={roots.error} />;

  const handleSearch = async () => {
    if (!query.trim()) return;
    try {
      setBusyAction('search');
      setActionError(null);
      const response = await api.get<FileSearchResponse>(
        `/v1/files/search?query=${encodeURIComponent(query)}`,
      );
      setSearchResults(response.results);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Search failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleReindex = async (rootId: string) => {
    try {
      setBusyAction(`reindex:${rootId}`);
      setActionError(null);
      await api.post(`/v1/files/roots/${encodeURIComponent(rootId)}/reindex`);
      roots.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Reindex failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleReviewIntent = async (intentId: string, action: 'apply' | 'reject') => {
    try {
      setBusyAction(`review:${intentId}`);
      setActionError(null);
      await api.post(`/v1/files/write-intents/${encodeURIComponent(intentId)}/review`, { action });
      pendingIntents.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : `${action} failed`);
    } finally {
      setBusyAction(null);
    }
  };

  const rootData = (roots.data ?? []) as FileRootRecord[];
  const intentData = (pendingIntents.data ?? []) as FileWriteIntentRecord[];

  return (
    <div>
      <PageHeader title="Files" description="File roots, indexing, write review queue, and search." />

      <div className="mb-[24px] grid gap-[16px] md:grid-cols-3">
        <Card label="File Roots" value={String(rootData.length)} description="Registered roots" />
        <Card label="Pending Reviews" value={String(intentData.length)} description="Write intents awaiting review" />
        <Card
          label="Total Indexed"
          value={String(rootData.reduce((sum, r) => sum + r.lastIndexedCount, 0))}
          description="Across all roots"
        />
      </div>

      {actionError ? (
        <div className="mb-[16px]">
          <ErrorDisplay message={actionError} />
        </div>
      ) : null}

      <div className="mb-[24px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
        <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Search Files</h2>
        <div className="mt-[12px] flex gap-[12px]">
          <input
            className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px]"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search indexed files"
            value={query}
          />
          <button
            className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[14px] py-[8px] text-[13px] font-medium text-white"
            onClick={() => void handleSearch()}
            type="button"
          >
            {busyAction === 'search' ? 'Searching…' : 'Search'}
          </button>
        </div>
        <div className="mt-[16px] space-y-[8px]">
          {searchResults.length === 0 ? (
            <p className="text-[14px] text-[var(--color-fg-muted)]">Run a search to find files.</p>
          ) : searchResults.map((result) => (
            <div key={result.documentId} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[12px]">
              <p className="font-medium font-mono text-[13px]">{result.filePath}</p>
              <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">{result.snippet}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-[24px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
        <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">File Roots</h2>
        <div className="mt-[12px] space-y-[8px]">
          {rootData.length === 0 ? (
            <EmptyState title="No file roots" description="Register a file root to start indexing." />
          ) : rootData.map((root) => (
            <div key={root.id} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[12px]">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium">{root.label}</p>
                  <p className="mt-[4px] font-mono text-[12px] text-[var(--color-fg-muted)]">{root.rootPath}</p>
                  <p className="mt-[2px] text-[12px] text-[var(--color-fg-muted)]">
                    {root.permission} · {root.lastIndexedCount} indexed{root.lastIndexedAt ? ` · last ${new Date(root.lastIndexedAt).toLocaleString()}` : ''}
                  </p>
                </div>
                <button
                  className="rounded-[var(--radius-sm)] bg-[var(--color-fg)]/[0.06] px-[10px] py-[6px] text-[12px] font-medium text-[var(--color-fg)]"
                  onClick={() => void handleReindex(root.id)}
                  type="button"
                >
                  {busyAction === `reindex:${root.id}` ? 'Reindexing…' : 'Reindex'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {intentData.length > 0 ? (
        <div className="mb-[24px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
          <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Write Review Queue</h2>
          <div className="mt-[12px] space-y-[8px]">
            {intentData.map((intent) => (
              <div key={intent.id} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[12px]">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium font-mono text-[13px]">{intent.filePath}</p>
                    <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">
                      {intent.intentType} · {new Date(intent.createdAt).toLocaleString()}
                    </p>
                    {intent.diffPreview ? (
                      <pre className="mt-[8px] max-h-[120px] overflow-auto rounded-[var(--radius-sm)] bg-[var(--color-bg-muted)] p-[8px] text-[11px] font-mono">
                        {intent.diffPreview}
                      </pre>
                    ) : null}
                  </div>
                  <div className="flex gap-[8px]">
                    <button
                      className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[10px] py-[6px] text-[12px] font-medium text-white"
                      onClick={() => void handleReviewIntent(intent.id, 'apply')}
                      type="button"
                    >
                      {busyAction === `review:${intent.id}` ? '…' : 'Apply'}
                    </button>
                    <button
                      className="rounded-[var(--radius-sm)] bg-red-100 px-[10px] py-[6px] text-[12px] font-medium text-red-700"
                      onClick={() => void handleReviewIntent(intent.id, 'reject')}
                      type="button"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
