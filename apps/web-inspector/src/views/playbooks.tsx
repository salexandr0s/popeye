import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import type { PlaybookRecord, PlaybookStaleCandidate } from '../api/hooks';
import { usePlaybookStaleCandidates, usePlaybooks } from '../api/hooks';
import { Badge } from '../components/badge';
import { Card } from '../components/card';
import { DataTable, type Column } from '../components/data-table';
import { EmptyState } from '../components/empty-state';
import { ErrorDisplay } from '../components/error-display';
import { Loading } from '../components/loading';
import { PageHeader } from '../components/page-header';
import { buildPlaybookProposalAuthoringPath, buildPlaybookRepairSummary } from './playbook-utils';

type ScopeFilter = 'all' | 'global' | 'workspace' | 'project';
type StatusFilter = 'all' | 'draft' | 'active' | 'retired';

const PAGE_SIZE = 25;

function scopeRank(scope: PlaybookRecord['scope']): number {
  switch (scope) {
    case 'global':
      return 0;
    case 'workspace':
      return 1;
    case 'project':
      return 2;
  }
}

function formatRate(value: number | null | undefined): string {
  return `${Math.round((value ?? 0) * 100)}%`;
}

function formatRelativeTimestamp(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

export function Playbooks() {
  const [query, setQuery] = useState('');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [offset, setOffset] = useState(0);
  const playbooks = usePlaybooks({
    ...(query.trim().length > 0 ? { q: query } : {}),
    ...(scopeFilter !== 'all' ? { scope: scopeFilter } : {}),
    ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    limit: PAGE_SIZE + 1,
    offset,
  });
  const staleCandidates = usePlaybookStaleCandidates();

  useEffect(() => {
    setOffset(0);
  }, [query, scopeFilter, statusFilter]);

  const rawItems = playbooks.data ?? [];
  const items = useMemo(
    () => rawItems.slice(0, PAGE_SIZE).sort((left, right) => {
      const byScope = scopeRank(left.scope) - scopeRank(right.scope);
      if (byScope !== 0) return byScope;
      const byTitle = left.title.localeCompare(right.title);
      if (byTitle !== 0) return byTitle;
      return left.recordId.localeCompare(right.recordId);
    }),
    [rawItems],
  );
  const hasNextPage = rawItems.length > PAGE_SIZE;
  const stale = staleCandidates.data ?? [];
  const hasActiveFilters = query.trim().length > 0 || scopeFilter !== 'all' || statusFilter !== 'all';

  if (playbooks.loading && !playbooks.data) return <Loading />;
  if (playbooks.error) return <ErrorDisplay message={playbooks.error} />;

  if (items.length === 0 && !hasActiveFilters) {
    return (
      <>
        <PageHeader
          title="Playbooks"
          description="Canonical operator-owned procedures compiled into deterministic instruction bundles."
        />
        <div className="mb-[20px] flex flex-wrap gap-[12px]">
          <Link
            className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[14px] py-[8px] text-[13px] font-medium text-white"
            to={buildPlaybookProposalAuthoringPath({ kind: 'draft' })}
          >
            New playbook proposal
          </Link>
        </div>
        <EmptyState
          title="No playbooks yet"
          description="Approved playbook drafts and canonical files will appear here once they exist."
        />
      </>
    );
  }

  const columns: Column<PlaybookRecord>[] = [
    {
      key: 'title',
      header: 'Playbook',
      render: (row) => (
        <div>
          <Link
            className="font-medium text-[var(--color-accent)] hover:underline"
            to={`/playbooks/${encodeURIComponent(row.recordId)}`}
          >
            {row.title}
          </Link>
          <p className="mt-[4px] font-mono text-[12px] text-[var(--color-fg-muted)]">{row.recordId}</p>
        </div>
      ),
    },
    {
      key: 'scope',
      header: 'Scope',
      width: '120px',
      render: (row) => row.scope,
    },
    {
      key: 'status',
      header: 'Status',
      width: '120px',
      render: (row) => <Badge state={row.status} />,
    },
    {
      key: 'uses',
      header: 'Uses (30d)',
      width: '110px',
      render: (row) => row.effectiveness?.useCount30d ?? 0,
    },
    {
      key: 'successRate',
      header: 'Success',
      width: '100px',
      render: (row) => formatRate(row.effectiveness?.successRate30d),
    },
    {
      key: 'failureRate',
      header: 'Failure',
      width: '100px',
      render: (row) => formatRate(row.effectiveness?.failureRate30d),
    },
    {
      key: 'interventionRate',
      header: 'Intervention',
      width: '120px',
      render: (row) => formatRate(row.effectiveness?.interventionRate30d),
    },
    {
      key: 'updated',
      header: 'Last used',
      width: '190px',
      render: (row) => formatRelativeTimestamp(row.effectiveness?.lastUsedAt),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '120px',
      render: (row) => (
        <Link
          className="text-[var(--color-accent)] hover:underline"
          to={`/playbooks/${encodeURIComponent(row.recordId)}`}
        >
          View
        </Link>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Playbooks"
        description="Canonical operator-owned procedures compiled into deterministic instruction bundles."
      />

      <div className="mb-[20px] flex flex-wrap gap-[12px]">
        <Link
          className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[14px] py-[8px] text-[13px] font-medium text-white"
          to={buildPlaybookProposalAuthoringPath({ kind: 'draft' })}
        >
          New playbook proposal
        </Link>
        <Link
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[14px] py-[8px] text-[13px] font-medium"
          to="/playbook-proposals"
        >
          Review proposals
        </Link>
      </div>

      <div className="mb-[24px] grid gap-[16px] md:grid-cols-4">
        <Card label="Visible" value={items.length} description={hasActiveFilters ? 'Current server-side page' : 'Current page'} />
        <Card
          label="Active"
          value={items.filter((item) => item.status === 'active').length}
          description="Instruction-active on this page"
        />
        <Card
          label="Avg success"
          value={items.length === 0 ? '0%' : formatRate(items.reduce((sum, item) => sum + (item.effectiveness?.successRate30d ?? 0), 0) / items.length)}
          description="30-day run success rate"
        />
        <Card label="Needs review" value={stale.length} description="Stale procedure candidates" />
      </div>

      {staleCandidates.error ? (
        <div className="mb-[16px]">
          <ErrorDisplay message={staleCandidates.error} />
        </div>
      ) : null}

      {stale.length > 0 ? (
        <section
          aria-labelledby="playbook-needs-review-heading"
          className="mb-[24px] rounded-[var(--radius-md)] border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 p-[20px]"
        >
          <h2 id="playbook-needs-review-heading" className="text-[16px] font-semibold text-[var(--color-fg)]">
            Needs review
          </h2>
          <p className="mt-[4px] text-[14px] text-[var(--color-fg-muted)]">
            These active playbooks show recent failure or intervention signals without a newer follow-up proposal.
          </p>
          <div className="mt-[16px] space-y-[12px]">
            {stale.map((candidate) => (
              <StaleCandidateCard key={candidate.recordId} candidate={candidate} />
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="playbook-filters-heading" className="mb-[16px]">
        <h2 id="playbook-filters-heading" className="sr-only">
          Playbook filters
        </h2>
        <div className="flex flex-wrap gap-[12px]">
          <label className="min-w-[240px] flex-1">
            <span className="mb-[6px] block text-[12px] font-medium text-[var(--color-fg-muted)]">Search</span>
            <input
              className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px]"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Title, playbook ID, record ID, or profile"
              value={query}
            />
          </label>
          <label>
            <span className="mb-[6px] block text-[12px] font-medium text-[var(--color-fg-muted)]">Scope</span>
            <select
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px]"
              onChange={(event) => setScopeFilter(event.target.value as ScopeFilter)}
              value={scopeFilter}
            >
              <option value="all">All scopes</option>
              <option value="global">Global</option>
              <option value="workspace">Workspace</option>
              <option value="project">Project</option>
            </select>
          </label>
          <label>
            <span className="mb-[6px] block text-[12px] font-medium text-[var(--color-fg-muted)]">Status</span>
            <select
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px]"
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              value={statusFilter}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="retired">Retired</option>
            </select>
          </label>
        </div>
      </section>

      {items.length === 0 ? (
        <EmptyState
          title="No matching playbooks"
          description="Adjust the server-side filters to inspect a different slice."
        />
      ) : (
        <>
          <DataTable columns={columns} data={items} keyFn={(row) => row.recordId} />
          <div className="mt-[16px] flex items-center justify-between gap-[12px]">
            <p className="text-[13px] text-[var(--color-fg-muted)]">
              Page {Math.floor(offset / PAGE_SIZE) + 1}
            </p>
            <div className="flex gap-[8px]">
              <button
                className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[12px] py-[8px] text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
                disabled={offset === 0}
                onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
                type="button"
              >
                Previous
              </button>
              <button
                className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[12px] py-[8px] text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!hasNextPage}
                onClick={() => setOffset((current) => current + PAGE_SIZE)}
                type="button"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StaleCandidateCard({ candidate }: { candidate: PlaybookStaleCandidate }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[16px]">
      <div className="flex flex-wrap items-start justify-between gap-[12px]">
        <div>
          <Link
            className="text-[15px] font-semibold text-[var(--color-accent)] hover:underline"
            to={`/playbooks/${encodeURIComponent(candidate.recordId)}`}
          >
            {candidate.title}
          </Link>
          <p className="mt-[4px] font-mono text-[12px] text-[var(--color-fg-muted)]">{candidate.recordId}</p>
        </div>
        <Link
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[12px] py-[7px] text-[13px] font-medium"
          to={buildPlaybookProposalAuthoringPath({
            kind: 'patch',
            recordId: candidate.recordId,
            repairSummary: buildPlaybookRepairSummary(candidate),
          })}
        >
          Draft repair proposal
        </Link>
      </div>
      <div className="mt-[12px] flex flex-wrap gap-[12px] text-[13px] text-[var(--color-fg-muted)]">
        <span>{candidate.useCount30d} uses / 30d</span>
        <span>{candidate.failedRuns30d} failed runs</span>
        <span>{candidate.interventions30d} interventions</span>
        <span>{candidate.lastUsedAt ? `Last used ${new Date(candidate.lastUsedAt).toLocaleString()}` : 'Not used recently'}</span>
      </div>
      <ul className="mt-[12px] space-y-[4px] text-[13px] text-[var(--color-fg-muted)]">
        {candidate.reasons.map((reason) => (
          <li key={reason}>• {reason}</li>
        ))}
      </ul>
    </div>
  );
}
