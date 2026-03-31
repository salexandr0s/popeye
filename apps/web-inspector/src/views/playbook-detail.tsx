import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type { PlaybookRevisionRecord, PlaybookUsageRunRecord } from '../api/hooks';
import { usePlaybook, usePlaybookRevisions, usePlaybookStaleCandidates, usePlaybookUsage } from '../api/hooks';
import { useApi } from '../api/provider';
import { Badge } from '../components/badge';
import { DataTable, type Column } from '../components/data-table';
import { EmptyState } from '../components/empty-state';
import { ErrorDisplay } from '../components/error-display';
import { Loading } from '../components/loading';
import { PageHeader } from '../components/page-header';
import { buildPlaybookProposalAuthoringPath, buildPlaybookRepairSummary } from './playbook-utils';

const USAGE_PAGE_SIZE = 10;

function formatRate(value: number | null | undefined): string {
  return `${Math.round((value ?? 0) * 100)}%`;
}

export function PlaybookDetailView() {
  const { recordId } = useParams<{ recordId: string }>();
  const navigate = useNavigate();
  const api = useApi();
  const playbook = usePlaybook(recordId);
  const revisions = usePlaybookRevisions(recordId);
  const staleCandidates = usePlaybookStaleCandidates();
  const [usageOffset, setUsageOffset] = useState(0);
  const usage = usePlaybookUsage(recordId, { limit: USAGE_PAGE_SIZE + 1, offset: usageOffset });
  const [busyAction, setBusyAction] = useState<'activate' | 'retire' | 'suggest' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setUsageOffset(0);
  }, [recordId]);

  const staleCandidate = useMemo(
    () => (staleCandidates.data ?? []).find((candidate) => candidate.recordId === recordId) ?? null,
    [recordId, staleCandidates.data],
  );
  const usageRows = (usage.data ?? []).slice(0, USAGE_PAGE_SIZE);
  const usageHasNext = (usage.data ?? []).length > USAGE_PAGE_SIZE;

  if (!recordId) return <ErrorDisplay message="Playbook record ID is required." />;
  if (playbook.loading && !playbook.data) return <Loading />;
  if (playbook.error) return <ErrorDisplay message={playbook.error} />;
  if (!playbook.data) return <ErrorDisplay message="Playbook not found." />;

  const handleLifecycleAction = async (action: 'activate' | 'retire') => {
    try {
      setBusyAction(action);
      setActionError(null);
      await api.post(`/v1/playbooks/${encodeURIComponent(recordId)}/${action}`, { updatedBy: 'web-inspector' });
      playbook.refetch();
      revisions.refetch();
      staleCandidates.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Playbook update failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSuggestPatch = async () => {
    try {
      setBusyAction('suggest');
      setActionError(null);
      const proposal = await api.post<{ id: string }>(
        `/v1/playbooks/${encodeURIComponent(recordId)}/suggest-patch`,
        { proposedBy: 'web-inspector' },
      );
      navigate(`/playbook-proposals/${encodeURIComponent(proposal.id)}`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Patch suggestion failed');
    } finally {
      setBusyAction(null);
    }
  };

  const revisionColumns: Column<PlaybookRevisionRecord>[] = [
    {
      key: 'revisionHash',
      header: 'Revision',
      width: '160px',
      render: (row) => (
        <span className="font-mono text-[12px] text-[var(--color-fg-muted)]">{row.revisionHash.slice(0, 12)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '120px',
      render: (row) => <Badge state={row.status} />,
    },
    {
      key: 'current',
      header: 'Current',
      width: '100px',
      render: (row) => (row.current ? 'Yes' : 'No'),
    },
    {
      key: 'createdAt',
      header: 'Created',
      width: '180px',
      render: (row) => new Date(row.createdAt).toLocaleString(),
    },
  ];

  const usageColumns: Column<PlaybookUsageRunRecord>[] = [
    {
      key: 'runId',
      header: 'Run',
      render: (row) => (
        <div>
          <Link className="font-medium text-[var(--color-accent)] hover:underline" to={`/runs/${encodeURIComponent(row.runId)}`}>
            {row.runId}
          </Link>
          <p className="mt-[4px] font-mono text-[12px] text-[var(--color-fg-muted)]">task {row.taskId}</p>
        </div>
      ),
    },
    {
      key: 'runState',
      header: 'State',
      width: '130px',
      render: (row) => <Badge state={row.runState} />,
    },
    {
      key: 'startedAt',
      header: 'Started',
      width: '180px',
      render: (row) => new Date(row.startedAt).toLocaleString(),
    },
    {
      key: 'finishedAt',
      header: 'Finished',
      width: '180px',
      render: (row) => (row.finishedAt ? new Date(row.finishedAt).toLocaleString() : '—'),
    },
    {
      key: 'interventionCount',
      header: 'Interventions',
      width: '120px',
      render: (row) => row.interventionCount,
    },
    {
      key: 'receiptId',
      header: 'Receipt',
      width: '120px',
      render: (row) =>
        row.receiptId ? (
          <Link className="text-[var(--color-accent)] hover:underline" to={`/receipts/${encodeURIComponent(row.receiptId)}`}>
            View
          </Link>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={playbook.data.title}
        description={`${playbook.data.scope} canonical playbook · ${playbook.data.recordId}`}
      />

      {staleCandidate ? (
        <section
          aria-labelledby="playbook-review-banner"
          className="mb-[16px] rounded-[var(--radius-md)] border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 p-[16px]"
        >
          <h2 id="playbook-review-banner" className="text-[15px] font-semibold text-[var(--color-fg)]">
            Needs review
          </h2>
          <ul className="mt-[8px] space-y-[4px] text-[13px] text-[var(--color-fg-muted)]">
            {staleCandidate.reasons.map((reason) => (
              <li key={reason}>• {reason}</li>
            ))}
          </ul>
          <div className="mt-[12px] flex flex-wrap gap-[12px]">
            <Link
              className="text-[13px] font-medium text-[var(--color-accent)] hover:underline"
              to={buildPlaybookProposalAuthoringPath({
                kind: 'patch',
                recordId: playbook.data.recordId,
                repairSummary: buildPlaybookRepairSummary(staleCandidate),
              })}
            >
              Draft repair proposal
            </Link>
          </div>
        </section>
      ) : null}

      {actionError ? (
        <div className="mb-[16px]">
          <ErrorDisplay message={actionError} />
        </div>
      ) : null}

      <div className="mb-[24px] flex flex-wrap gap-[12px]">
        {playbook.data.status !== 'active' ? (
          <button
            className="rounded-[var(--radius-sm)] bg-[var(--color-success)]/10 px-[14px] py-[8px] text-[13px] font-medium text-[var(--color-success)] disabled:cursor-not-allowed disabled:opacity-70"
            disabled={busyAction !== null}
            onClick={() => void handleLifecycleAction('activate')}
            type="button"
          >
            {busyAction === 'activate' ? 'Activating…' : 'Activate'}
          </button>
        ) : null}
        {playbook.data.status !== 'retired' ? (
          <button
            className="rounded-[var(--radius-sm)] bg-[var(--color-danger)]/10 px-[14px] py-[8px] text-[13px] font-medium text-[var(--color-danger)] disabled:cursor-not-allowed disabled:opacity-70"
            disabled={busyAction !== null}
            onClick={() => void handleLifecycleAction('retire')}
            type="button"
          >
            {busyAction === 'retire' ? 'Retiring…' : 'Retire'}
          </button>
        ) : null}
        <button
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[14px] py-[8px] text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-70"
          disabled={busyAction !== null}
          onClick={() => void handleSuggestPatch()}
          type="button"
        >
          {busyAction === 'suggest' ? 'Drafting…' : 'Suggest patch from recent failures'}
        </button>
        <Link
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[14px] py-[8px] text-[13px] font-medium"
          to={buildPlaybookProposalAuthoringPath({
            kind: 'patch',
            recordId: playbook.data.recordId,
          })}
        >
          Propose patch
        </Link>
        <Link
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[14px] py-[8px] text-[13px] font-medium"
          to="/playbook-proposals"
        >
          Review proposals
        </Link>
      </div>

      <div className="mb-[24px] grid gap-[16px] md:grid-cols-2 xl:grid-cols-4">
        <InfoCard label="Status">
          <Badge state={playbook.data.status} />
        </InfoCard>
        <InfoCard label="Allowed profiles">
          <p className="text-[14px] text-[var(--color-fg)]">
            {playbook.data.allowedProfileIds.length > 0 ? playbook.data.allowedProfileIds.join(', ') : 'all profiles'}
          </p>
        </InfoCard>
        <InfoCard label="Revision">
          <p className="font-mono text-[12px] text-[var(--color-fg)]">{playbook.data.currentRevisionHash}</p>
        </InfoCard>
        <InfoCard label="Procedural memory">
          <p className="font-mono text-[12px] text-[var(--color-fg)]">{playbook.data.indexedMemoryId ?? 'not indexed'}</p>
        </InfoCard>
      </div>

      <section className="mb-[24px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
        <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Effectiveness (30 days)</h2>
        <div className="mt-[16px] grid gap-[16px] md:grid-cols-2 xl:grid-cols-5">
          <InfoCard label="Uses">
            <p className="text-[18px] font-semibold text-[var(--color-fg)]">{playbook.data.effectiveness?.useCount30d ?? 0}</p>
          </InfoCard>
          <InfoCard label="Success rate">
            <p className="text-[18px] font-semibold text-[var(--color-fg)]">{formatRate(playbook.data.effectiveness?.successRate30d)}</p>
          </InfoCard>
          <InfoCard label="Failure rate">
            <p className="text-[18px] font-semibold text-[var(--color-fg)]">{formatRate(playbook.data.effectiveness?.failureRate30d)}</p>
          </InfoCard>
          <InfoCard label="Intervention rate">
            <p className="text-[18px] font-semibold text-[var(--color-fg)]">{formatRate(playbook.data.effectiveness?.interventionRate30d)}</p>
          </InfoCard>
          <InfoCard label="Last used">
            <p className="text-[14px] text-[var(--color-fg)]">{playbook.data.effectiveness?.lastUsedAt ? new Date(playbook.data.effectiveness.lastUsedAt).toLocaleString() : '—'}</p>
          </InfoCard>
        </div>
      </section>

      <section className="mb-[24px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
        <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Metadata</h2>
        <dl className="mt-[16px] grid gap-[12px] md:grid-cols-2">
          <MetadataRow label="Playbook ID" value={playbook.data.playbookId} />
          <MetadataRow label="Updated" value={new Date(playbook.data.updatedAt).toLocaleString()} />
          <div className="md:col-span-2">
            <dt className="text-[12px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">File path</dt>
            <dd className="mt-[4px] font-mono text-[12px] text-[var(--color-fg)]">{playbook.data.filePath}</dd>
          </div>
        </dl>
      </section>

      <section className="mb-[24px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
        <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Canonical markdown</h2>
        <pre className="mt-[12px] max-h-[520px] overflow-y-auto whitespace-pre-wrap rounded-[var(--radius-sm)] bg-[var(--color-bg-muted)] p-[12px] font-[var(--font-mono)] text-[13px] text-[var(--color-fg)]">
          {playbook.data.markdownText}
        </pre>
      </section>

      <section className="mb-[24px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
        <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Used by runs</h2>
        {usage.error ? (
          <div className="mt-[12px]">
            <ErrorDisplay message={usage.error} />
          </div>
        ) : usage.loading && !usage.data ? (
          <Loading />
        ) : usageRows.length === 0 ? (
          <EmptyState title="No recent usage" description="Recent runs that compiled this playbook will appear here." />
        ) : (
          <>
            <div className="mt-[12px]">
              <DataTable columns={usageColumns} data={usageRows} keyFn={(row) => row.runId} />
            </div>
            <div className="mt-[16px] flex items-center justify-between gap-[12px]">
              <p className="text-[13px] text-[var(--color-fg-muted)]">Page {Math.floor(usageOffset / USAGE_PAGE_SIZE) + 1}</p>
              <div className="flex gap-[8px]">
                <button
                  className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[12px] py-[8px] text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={usageOffset === 0}
                  onClick={() => setUsageOffset((current) => Math.max(0, current - USAGE_PAGE_SIZE))}
                  type="button"
                >
                  Previous
                </button>
                <button
                  className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[12px] py-[8px] text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!usageHasNext}
                  onClick={() => setUsageOffset((current) => current + USAGE_PAGE_SIZE)}
                  type="button"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
        <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Revisions</h2>
        {revisions.error ? (
          <div className="mt-[12px]">
            <ErrorDisplay message={revisions.error} />
          </div>
        ) : revisions.loading && !revisions.data ? (
          <Loading />
        ) : (revisions.data ?? []).length === 0 ? (
          <EmptyState title="No revisions yet" description="Revision history will appear after the first canonical write." />
        ) : (
          <div className="mt-[12px]">
            <DataTable columns={revisionColumns} data={revisions.data ?? []} keyFn={(row) => row.revisionHash} />
          </div>
        )}
      </section>
    </div>
  );
}

function InfoCard({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[16px]">
      <p className="text-[12px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">{label}</p>
      <div className="mt-[8px]">{children}</div>
    </div>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">{label}</dt>
      <dd className="mt-[4px] text-[14px] text-[var(--color-fg)]">{value}</dd>
    </div>
  );
}
