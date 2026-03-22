import { useState } from 'react';
import { useApi } from '../api/provider';
import { useFinanceImports } from '../api/hooks';
import { PageHeader } from '../components/page-header';
import { Loading } from '../components/loading';
import { ErrorDisplay } from '../components/error-display';
import { EmptyState } from '../components/empty-state';
import { Card } from '../components/card';

interface FinanceTransactionRecord {
  id: string;
  importId: string;
  date: string;
  description: string;
  amount: number;
  currency: string;
  category: string | null;
  merchantName: string | null;
  accountLabel: string | null;
  redactedSummary: string;
}

interface FinanceDocumentRecord {
  id: string;
  importId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  redactedSummary: string;
}

interface FinanceDigestRecord {
  id: string;
  period: string;
  totalIncome: number;
  totalExpenses: number;
  categoryBreakdown: Record<string, number>;
  anomalyFlags: Array<{ description: string; severity: string; transactionId: string | null }>;
  generatedAt: string;
}

interface FinanceSearchResponse {
  query: string;
  results: Array<{
    transactionId: string;
    date: string;
    description: string;
    amount: number;
    redactedSummary: string;
    score: number;
  }>;
}

export function Finance() {
  const api = useApi();
  const imports = useFinanceImports();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FinanceSearchResponse['results']>([]);
  const [transactions, setTransactions] = useState<FinanceTransactionRecord[]>([]);
  const [documents, setDocuments] = useState<FinanceDocumentRecord[]>([]);
  const [digest, setDigest] = useState<FinanceDigestRecord | null>(null);
  const [categoryFilter, setCategoryFilter] = useState('');

  if (imports.loading) return <Loading />;
  if (imports.error) return <ErrorDisplay message={imports.error} />;
  if (!imports.data || imports.data.length === 0) {
    return (
      <>
        <PageHeader title="Finance" description="Financial data imports, transactions, and digest views." />
        <EmptyState title="No finance imports" description="Import financial data to get started." />
      </>
    );
  }

  const handleSearch = async () => {
    if (!query.trim()) return;
    try {
      setBusyAction('search');
      setActionError(null);
      const params = new URLSearchParams({ query });
      if (categoryFilter) params.set('category', categoryFilter);
      const response = await api.get<FinanceSearchResponse>(`/v1/finance/search?${params.toString()}`);
      setSearchResults(response.results);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Search failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleLoadTransactions = async () => {
    try {
      setBusyAction('load');
      setActionError(null);
      const params = new URLSearchParams();
      if (categoryFilter) params.set('category', categoryFilter);
      const result = await api.get<FinanceTransactionRecord[]>(`/v1/finance/transactions?${params.toString()}`);
      setTransactions(result);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to load transactions');
    } finally {
      setBusyAction(null);
    }
  };

  const handleLoadDocuments = async () => {
    try {
      setBusyAction('documents');
      setActionError(null);
      const result = await api.get<FinanceDocumentRecord[]>('/v1/finance/documents');
      setDocuments(result);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to load documents');
    } finally {
      setBusyAction(null);
    }
  };

  const handleLoadDigest = async () => {
    try {
      setBusyAction('digest');
      setActionError(null);
      const result = await api.get<FinanceDigestRecord | null>('/v1/finance/digest');
      setDigest(result);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to load digest');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div>
      <PageHeader title="Finance" description="Financial data imports, transactions, and digest views." />

      <div className="mb-[24px] grid gap-[16px] md:grid-cols-3">
        <Card label="Imports" value={String(imports.data.length)} description="Total finance imports" />
        <Card
          label="Latest Import"
          value={imports.data[0]?.fileName ?? 'None'}
          description={imports.data[0]?.status ?? ''}
        />
        <Card
          label="Imported At"
          value={imports.data[0] ? new Date(imports.data[0].importedAt).toLocaleString() : 'Never'}
          description="Most recent import"
        />
      </div>

      {actionError ? (
        <div className="mb-[16px]">
          <ErrorDisplay message={actionError} />
        </div>
      ) : null}

      <div className="mb-[24px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
        <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Search Finance</h2>
        <div className="mt-[12px] flex gap-[12px]">
          <input
            className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px]"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search transactions"
            value={query}
          />
          <input
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px] text-[13px]"
            onChange={(event) => setCategoryFilter(event.target.value)}
            placeholder="Category filter"
            value={categoryFilter}
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
            <p className="text-[14px] text-[var(--color-fg-muted)]">Run a search to find transactions.</p>
          ) : searchResults.map((result) => (
            <div key={result.transactionId} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[12px]">
              <p className="font-medium">{result.description}</p>
              <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">
                {result.date} · ${result.amount.toFixed(2)} · score {result.score}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-[24px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
        <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Transactions</h2>
        <div className="mt-[12px] flex gap-[12px]">
          <button
            className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[14px] py-[8px] text-[13px] font-medium text-white"
            onClick={() => void handleLoadTransactions()}
            type="button"
          >
            {busyAction === 'load' ? 'Loading…' : 'Load Transactions'}
          </button>
        </div>
        <div className="mt-[16px] space-y-[8px]">
          {transactions.length === 0 ? (
            <p className="text-[14px] text-[var(--color-fg-muted)]">Click Load to view transactions.</p>
          ) : transactions.map((tx) => (
            <div key={tx.id} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[12px]">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium">{tx.description}</p>
                  <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">
                    {tx.date}{tx.category ? ` · ${tx.category}` : ''}{tx.merchantName ? ` · ${tx.merchantName}` : ''}
                  </p>
                </div>
                <span className={`text-[14px] font-semibold ${tx.amount >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>
                  {tx.amount >= 0 ? '+' : ''}{tx.currency} {tx.amount.toFixed(2)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-[24px] flex flex-wrap gap-[12px]">
        <button
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[14px] py-[8px] text-[13px] font-medium"
          onClick={() => void handleLoadDocuments()}
          type="button"
        >
          {busyAction === 'documents' ? 'Loading…' : 'Load Documents'}
        </button>
        <button
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[14px] py-[8px] text-[13px] font-medium"
          onClick={() => void handleLoadDigest()}
          type="button"
        >
          {busyAction === 'digest' ? 'Loading…' : 'Load Digest'}
        </button>
      </div>

      <div className="grid gap-[24px] md:grid-cols-2">
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
          <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Documents</h2>
          <div className="mt-[12px] space-y-[8px]">
            {documents.length === 0 ? (
              <p className="text-[14px] text-[var(--color-fg-muted)]">No documents loaded.</p>
            ) : documents.map((doc) => (
              <div key={doc.id} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[10px]">
                <p className="font-medium">{doc.fileName}</p>
                <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">
                  {doc.mimeType} · {(doc.sizeBytes / 1024).toFixed(1)} KB
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
          <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Digest</h2>
          {digest ? (
            <div className="mt-[12px] space-y-[8px]">
              <div className="grid grid-cols-2 gap-[8px]">
                <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[10px] text-center">
                  <p className="text-[20px] font-semibold text-[var(--color-success)]">+${digest.totalIncome.toFixed(2)}</p>
                  <p className="text-[12px] text-[var(--color-fg-muted)]">Income</p>
                </div>
                <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[10px] text-center">
                  <p className="text-[20px] font-semibold text-[var(--color-danger)]">-${digest.totalExpenses.toFixed(2)}</p>
                  <p className="text-[12px] text-[var(--color-fg-muted)]">Expenses</p>
                </div>
              </div>
              {Object.keys(digest.categoryBreakdown).length > 0 ? (
                <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[12px]">
                  <p className="font-medium text-[13px]">Category Breakdown</p>
                  {Object.entries(digest.categoryBreakdown).map(([cat, amount]) => (
                    <div key={cat} className="mt-[4px] flex justify-between text-[12px]">
                      <span>{cat}</span>
                      <span>${amount.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <p className="text-[12px] text-[var(--color-fg-muted)]">
                Period: {digest.period} · Generated {new Date(digest.generatedAt).toLocaleString()}
              </p>
            </div>
          ) : (
            <p className="mt-[12px] text-[14px] text-[var(--color-fg-muted)]">
              Click &quot;Load Digest&quot; to view the finance summary.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
