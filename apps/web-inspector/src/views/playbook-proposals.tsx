import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import type { PlaybookProposalRecord } from '../api/hooks';
import { usePlaybookProposals } from '../api/hooks';
import { Badge } from '../components/badge';
import { Card } from '../components/card';
import { DataTable, type Column } from '../components/data-table';
import { EmptyState } from '../components/empty-state';
import { ErrorDisplay } from '../components/error-display';
import { Loading } from '../components/loading';
import { PageHeader } from '../components/page-header';
import { buildPlaybookProposalAuthoringPath } from './playbook-utils';

type ProposalStatusFilter = 'all' | 'drafting' | 'pending_review' | 'approved' | 'rejected' | 'applied';
type ProposalKindFilter = 'all' | 'draft' | 'patch';
type ProposalScopeFilter = 'all' | 'global' | 'workspace' | 'project';
type ProposalSort = 'created_desc' | 'created_asc' | 'updated_desc' | 'updated_asc' | 'title_asc' | 'title_desc';

const PAGE_SIZE = 25;

export function PlaybookProposals() {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ProposalStatusFilter>('all');
  const [kindFilter, setKindFilter] = useState<ProposalKindFilter>('all');
  const [scopeFilter, setScopeFilter] = useState<ProposalScopeFilter>('all');
  const [sort, setSort] = useState<ProposalSort>('created_desc');
  const [offset, setOffset] = useState(0);
  const proposals = usePlaybookProposals({
    ...(query.trim().length > 0 ? { q: query } : {}),
    ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    ...(kindFilter !== 'all' ? { kind: kindFilter } : {}),
    ...(scopeFilter !== 'all' ? { scope: scopeFilter } : {}),
    sort,
    limit: PAGE_SIZE + 1,
    offset,
  });

  useEffect(() => {
    setOffset(0);
  }, [query, statusFilter, kindFilter, scopeFilter, sort]);

  const rawItems = proposals.data ?? [];
  const items = useMemo(() => rawItems.slice(0, PAGE_SIZE), [rawItems]);
  const hasNextPage = rawItems.length > PAGE_SIZE;

  if (proposals.loading && !proposals.data) return <Loading />;
  if (proposals.error) return <ErrorDisplay message={proposals.error} />;

  if (items.length === 0 && query.trim().length === 0 && statusFilter === 'all' && kindFilter === 'all' && scopeFilter === 'all') {
    return (
      <>
        <PageHeader
          title="Playbook Proposals"
          description="Operator review queue for playbook drafts and patches."
        />
        <EmptyState
          title="No proposals yet"
          description="Runtime-created or operator-created playbook proposals will appear here."
        />
      </>
    );
  }

  const columns: Column<PlaybookProposalRecord>[] = [
    {
      key: 'title',
      header: 'Proposal',
      render: (row) => (
        <div>
          <Link
            className="font-medium text-[var(--color-accent)] hover:underline"
            to={`/playbook-proposals/${encodeURIComponent(row.id)}`}
          >
            {row.title}
          </Link>
          <p className="mt-[4px] font-mono text-[12px] text-[var(--color-fg-muted)]">{row.id}</p>
        </div>
      ),
    },
    {
      key: 'kind',
      header: 'Kind',
      width: '100px',
      render: (row) => row.kind,
    },
    {
      key: 'status',
      header: 'Status',
      width: '140px',
      render: (row) => <Badge state={row.status} />,
    },
    {
      key: 'scope',
      header: 'Scope',
      width: '120px',
      render: (row) => row.scope,
    },
    {
      key: 'playbook',
      header: 'Playbook',
      render: (row) => (
        <div>
          <p>{row.playbookId}</p>
          <p className="text-[12px] text-[var(--color-fg-muted)]">{row.targetRecordId ?? 'new draft'}</p>
        </div>
      ),
    },
    {
      key: 'source',
      header: 'Source',
      render: (row) => row.proposedBy,
    },
    {
      key: 'scan',
      header: 'Scan',
      width: '120px',
      render: (row) => <Badge state={row.scanVerdict} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '120px',
      render: (row) => (
        <Link
          className="text-[var(--color-accent)] hover:underline"
          to={`/playbook-proposals/${encodeURIComponent(row.id)}`}
        >
          View
        </Link>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Playbook Proposals"
        description="Operator review queue for playbook drafts and patches."
      />

      <div className="mb-[20px] flex flex-wrap gap-[12px]">
        <Link
          className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[14px] py-[8px] text-[13px] font-medium text-white"
          to={buildPlaybookProposalAuthoringPath({ kind: 'draft' })}
        >
          New playbook proposal
        </Link>
      </div>

      <div className="mb-[24px] grid gap-[16px] md:grid-cols-5">
        <Card label="Drafting" value={items.filter((item) => item.status === 'drafting').length} description="Editable drafts on this page" />
        <Card label="Pending" value={items.filter((item) => item.status === 'pending_review').length} description="Awaiting review" />
        <Card label="Approved" value={items.filter((item) => item.status === 'approved').length} description="Ready to apply" />
        <Card label="Applied" value={items.filter((item) => item.status === 'applied').length} description="Written to canonical files" />
        <Card label="Rejected" value={items.filter((item) => item.status === 'rejected').length} description="Closed proposals" />
      </div>

      <section aria-labelledby="playbook-proposal-filters-heading" className="mb-[16px]">
        <h2 id="playbook-proposal-filters-heading" className="sr-only">
          Playbook proposal filters
        </h2>
        <div className="flex flex-wrap gap-[12px]">
          <label className="min-w-[240px] flex-1">
            <span className="mb-[6px] block text-[12px] font-medium text-[var(--color-fg-muted)]">Search</span>
            <input
              className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px]"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Title, playbook, proposal, target, or run"
              value={query}
            />
          </label>
          <label>
            <span className="mb-[6px] block text-[12px] font-medium text-[var(--color-fg-muted)]">Status</span>
            <select
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px]"
              onChange={(event) => setStatusFilter(event.target.value as ProposalStatusFilter)}
              value={statusFilter}
            >
              <option value="all">All statuses</option>
              <option value="drafting">Drafting</option>
              <option value="pending_review">Pending review</option>
              <option value="approved">Approved</option>
              <option value="applied">Applied</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
          <label>
            <span className="mb-[6px] block text-[12px] font-medium text-[var(--color-fg-muted)]">Kind</span>
            <select
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px]"
              onChange={(event) => setKindFilter(event.target.value as ProposalKindFilter)}
              value={kindFilter}
            >
              <option value="all">All kinds</option>
              <option value="draft">Draft</option>
              <option value="patch">Patch</option>
            </select>
          </label>
          <label>
            <span className="mb-[6px] block text-[12px] font-medium text-[var(--color-fg-muted)]">Scope</span>
            <select
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px]"
              onChange={(event) => setScopeFilter(event.target.value as ProposalScopeFilter)}
              value={scopeFilter}
            >
              <option value="all">All scopes</option>
              <option value="global">Global</option>
              <option value="workspace">Workspace</option>
              <option value="project">Project</option>
            </select>
          </label>
          <label>
            <span className="mb-[6px] block text-[12px] font-medium text-[var(--color-fg-muted)]">Sort</span>
            <select
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px]"
              onChange={(event) => setSort(event.target.value as ProposalSort)}
              value={sort}
            >
              <option value="created_desc">Newest created</option>
              <option value="created_asc">Oldest created</option>
              <option value="updated_desc">Newest updated</option>
              <option value="updated_asc">Oldest updated</option>
              <option value="title_asc">Title A→Z</option>
              <option value="title_desc">Title Z→A</option>
            </select>
          </label>
        </div>
      </section>

      {items.length === 0 ? (
        <EmptyState
          title="No matching proposals"
          description="Adjust the server-side filters to inspect a different review slice."
        />
      ) : (
        <>
          <DataTable columns={columns} data={items} keyFn={(row) => row.id} />
          <div className="mt-[16px] flex items-center justify-between gap-[12px]">
            <p className="text-[13px] text-[var(--color-fg-muted)]">Page {Math.floor(offset / PAGE_SIZE) + 1}</p>
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
