import { useState } from 'react';
import { useApi } from '../api/provider';
import { useApprovals } from '../api/hooks';
import { PageHeader } from '../components/page-header';
import { Loading } from '../components/loading';
import { ErrorDisplay } from '../components/error-display';
import { EmptyState } from '../components/empty-state';
import { DataTable, type Column } from '../components/data-table';
import { Badge } from '../components/badge';
import { Card } from '../components/card';

export function Approvals() {
  const { data, error, loading, refetch } = useApprovals();
  const api = useApi();
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (error) return <ErrorDisplay message={error} />;
  if (!data || data.length === 0) {
    return (
      <>
        <PageHeader
          title="Approvals"
          description="Review durable approval requests and resolve pending operator decisions."
        />
        <EmptyState title="No approvals" description="Approval requests will appear here when policy requires an operator decision." />
      </>
    );
  }

  const pending = data.filter((item) => item.status === 'pending').length;
  const approved = data.filter((item) => item.status === 'approved').length;
  const denied = data.filter((item) => item.status === 'denied').length;

  const handleResolve = async (id: string, decision: 'approved' | 'denied') => {
    try {
      setActionError(null);
      await api.post(`/v1/approvals/${id}/resolve`, { decision });
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Approval action failed');
    }
  };

  const columns: Column<(typeof data)[number]>[] = [
    {
      key: 'status',
      header: 'Status',
      width: '120px',
      render: (row) => <Badge state={row.status} />,
    },
    {
      key: 'scope',
      header: 'Scope',
      render: (row) => <span className="font-medium">{row.scope}</span>,
    },
    {
      key: 'resource',
      header: 'Resource',
      render: (row) => (
        <div>
          <p>{row.resourceType}</p>
          <p className="text-[12px] text-[var(--color-fg-muted)]">{row.resourceId}</p>
        </div>
      ),
    },
    {
      key: 'domain',
      header: 'Domain',
      render: (row) => row.domain,
    },
    {
      key: 'actionKind',
      header: 'Action',
      render: (row) => (
        <div>
          <p>{row.actionKind}</p>
          <p className="text-[12px] text-[var(--color-fg-muted)]">{row.resourceScope}</p>
        </div>
      ),
    },
    {
      key: 'requestedBy',
      header: 'Requested by',
      render: (row) => row.requestedBy,
    },
    {
      key: 'run',
      header: 'Run',
      render: (row) => (
        <span className="font-mono text-[12px] text-[var(--color-fg-muted)]">
          {row.runId ?? '(none)'}
        </span>
      ),
    },
    {
      key: 'resolution',
      header: 'Resolution',
      render: (row) => (
        <div>
          <p>{row.resolvedBy ?? 'pending'}</p>
          <p className="text-[12px] text-[var(--color-fg-muted)]">
            {row.resolvedByGrantId ?? row.decisionReason ?? 'No decision note'}
          </p>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '180px',
      render: (row) => row.status === 'pending' ? (
        <div className="flex gap-[8px]">
          <button
            className="rounded-[var(--radius-sm)] bg-[var(--color-success)]/10 px-[10px] py-[6px] text-[12px] font-medium text-[var(--color-success)]"
            onClick={() => void handleResolve(row.id, 'approved')}
            type="button"
          >
            Approve
          </button>
          <button
            className="rounded-[var(--radius-sm)] bg-[var(--color-danger)]/10 px-[10px] py-[6px] text-[12px] font-medium text-[var(--color-danger)]"
            onClick={() => void handleResolve(row.id, 'denied')}
            type="button"
          >
            Deny
          </button>
        </div>
      ) : (
        <span className="text-[12px] text-[var(--color-fg-muted)]">No action</span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Approvals"
        description="Review durable approval requests and resolve pending operator decisions."
      />

      <div className="mb-[24px] grid gap-[16px] md:grid-cols-3">
        <Card label="Pending" value={pending} description="Awaiting operator resolution" />
        <Card label="Approved" value={approved} description="Resolved in favor of execution" />
        <Card label="Denied" value={denied} description="Blocked by operator or policy" />
      </div>

      <p className="mb-[16px] text-[13px] text-[var(--color-fg-muted)]">
        Approval rows now include action provenance so you can see the action kind, resource scope,
        run linkage, and whether a standing approval or automation grant resolved the request.
      </p>

      {actionError ? (
        <div className="mb-[16px]">
          <ErrorDisplay message={actionError} />
        </div>
      ) : null}

      <DataTable columns={columns} data={data} keyFn={(row) => row.id} />
    </div>
  );
}
