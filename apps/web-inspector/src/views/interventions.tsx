import { DataTable, type Column } from '../components/data-table';
import { Badge } from '../components/badge';
import { Loading } from '../components/loading';
import { ErrorDisplay } from '../components/error-display';
import { EmptyState } from '../components/empty-state';
import { PageHeader } from '../components/page-header';
import { useInterventions, type InterventionRecord } from '../api/hooks';
import { useApi } from '../api/provider';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function Interventions() {
  const { data: interventions, error, loading, refetch } = useInterventions();
  const api = useApi();

  const handleResolve = async (id: string) => {
    try {
      await api.post(`/v1/interventions/${id}/resolve`);
      refetch();
    } catch {
      // Error handling deferred
    }
  };

  const columns: Column<InterventionRecord>[] = [
    {
      key: 'code',
      header: 'Code',
      render: (row) => <Badge state={row.code} />,
      width: '200px',
    },
    {
      key: 'reason',
      header: 'Reason',
      render: (row) => (
        <span className="text-[14px]">
          {row.reason.length > 100
            ? `${row.reason.slice(0, 100)}...`
            : row.reason}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <Badge state={row.status} />,
      width: '120px',
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (row) => (
        <span className="text-[14px] text-[var(--color-fg-muted)]">
          {formatTime(row.createdAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) =>
        row.status === 'open' ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              void handleResolve(row.id);
            }}
            className="px-[8px] py-[4px] text-[12px] rounded-[var(--radius-sm)] font-medium text-[var(--color-success)] hover:bg-[var(--color-success)]/10 transition-colors duration-[var(--duration-fast)]"
          >
            Resolve
          </button>
        ) : null,
      width: '80px',
    },
  ];

  if (loading) return <Loading />;
  if (error) return <ErrorDisplay message={error} />;

  return (
    <div>
      <PageHeader
        title="Interventions"
        description="Operator-required actions"
      />
      {interventions && interventions.length > 0 ? (
        <DataTable
          columns={columns}
          data={interventions}
          keyFn={(i) => i.id}
        />
      ) : (
        <EmptyState
          title="No interventions"
          description="Interventions are created when runs require operator input."
        />
      )}
    </div>
  );
}
