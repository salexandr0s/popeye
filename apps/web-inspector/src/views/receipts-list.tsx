import { useNavigate } from 'react-router-dom';
import { DataTable, type Column } from '../components/data-table';
import { Badge } from '../components/badge';
import { Loading } from '../components/loading';
import { ErrorDisplay } from '../components/error-display';
import { EmptyState } from '../components/empty-state';
import { PageHeader } from '../components/page-header';
import { useReceipts, type ReceiptRecord } from '../api/hooks';
import { formatTime } from '../utils/format';

export function ReceiptsList() {
  const { data: receipts, error, loading } = useReceipts();
  const navigate = useNavigate();

  const columns: Column<ReceiptRecord>[] = [
    {
      key: 'status',
      header: 'Status',
      render: (row) => <Badge state={row.status} />,
      width: '140px',
    },
    {
      key: 'summary',
      header: 'Summary',
      render: (row) => (
        <span className="text-[14px]">
          {row.summary.length > 80 ? `${row.summary.slice(0, 80)}...` : row.summary}
        </span>
      ),
    },
    {
      key: 'tokens',
      header: 'Tokens',
      render: (row) => (
        <span className="text-[14px] text-[var(--color-fg-muted)] font-mono">
          {row.usage.tokensIn.toLocaleString()} / {row.usage.tokensOut.toLocaleString()}
        </span>
      ),
      width: '140px',
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
  ];

  if (loading) return <Loading />;
  if (error) return <ErrorDisplay message={error} />;

  return (
    <div>
      <PageHeader title="Receipts" description="Run completion receipts" />
      {receipts && receipts.length > 0 ? (
        <DataTable
          columns={columns}
          data={receipts}
          keyFn={(r) => r.id}
          onRowClick={(r) => navigate(`/receipts/${r.id}`)}
        />
      ) : (
        <EmptyState title="No receipts" description="Receipts are generated when runs complete." />
      )}
    </div>
  );
}
