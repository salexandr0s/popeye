import { useState } from 'react';
import { useVaults } from '../api/hooks';
import { useApi } from '../api/provider';
import { PageHeader } from '../components/page-header';
import { Loading } from '../components/loading';
import { ErrorDisplay } from '../components/error-display';
import { EmptyState } from '../components/empty-state';
import { DataTable, type Column } from '../components/data-table';
import { Card } from '../components/card';
import { Badge } from '../components/badge';

export function Vaults() {
  const { data, error, loading, refetch } = useVaults();
  const api = useApi();
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (error) return <ErrorDisplay message={error} />;
  if (!data || data.length === 0) {
    return (
      <>
        <PageHeader
          title="Vaults"
          description="Inspect capability and restricted vault state managed by the runtime."
        />
        <EmptyState title="No vaults" description="Vault records will appear here once capability or restricted stores are created." />
      </>
    );
  }

  const openCount = data.filter((vault) => vault.status === 'open').length;
  const restrictedCount = data.filter((vault) => vault.kind === 'restricted').length;

  const handleAction = async (vaultId: string, action: 'close' | 'seal') => {
    try {
      setActionError(null);
      await api.post(`/v1/vaults/${vaultId}/${action}`, {});
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Vault action failed');
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
      key: 'domain',
      header: 'Domain',
      render: (row) => row.domain,
    },
    {
      key: 'kind',
      header: 'Kind',
      render: (row) => row.kind,
    },
    {
      key: 'encrypted',
      header: 'Encrypted',
      render: (row) => row.encrypted ? 'yes' : 'no',
    },
    {
      key: 'path',
      header: 'Path',
      render: (row) => (
        <span className="font-mono text-[12px] text-[var(--color-fg-muted)]">
          {row.dbPath}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '180px',
      render: (row) => (
        <div className="flex gap-[8px]">
          {row.status === 'open' ? (
            <button
              className="rounded-[var(--radius-sm)] bg-[var(--color-accent)]/10 px-[10px] py-[6px] text-[12px] font-medium text-[var(--color-accent)]"
              onClick={() => void handleAction(row.id, 'close')}
              type="button"
            >
              Close
            </button>
          ) : null}
          {row.status !== 'sealed' ? (
            <button
              className="rounded-[var(--radius-sm)] bg-[var(--color-warning)]/10 px-[10px] py-[6px] text-[12px] font-medium text-[var(--color-warning)]"
              onClick={() => void handleAction(row.id, 'seal')}
              type="button"
            >
              Seal
            </button>
          ) : (
            <span className="text-[12px] text-[var(--color-fg-muted)]">Sealed</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Vaults"
        description="Inspect capability and restricted vault state managed by the runtime."
      />

      <div className="mb-[24px] grid gap-[16px] md:grid-cols-3">
        <Card label="Total vaults" value={data.length} description="Capability and restricted vault records" />
        <Card label="Open vaults" value={openCount} description="Currently opened by approved runtime activity" />
        <Card label="Restricted" value={restrictedCount} description="Restricted-domain stores under the vault boundary" />
      </div>

      {actionError ? (
        <div className="mb-[16px]">
          <ErrorDisplay message={actionError} />
        </div>
      ) : null}

      <p className="mb-[16px] text-[13px] text-[var(--color-fg-muted)]">
        Opening a vault remains approval-gated and is performed through the control API or CLI with an approved
        <span className="font-mono"> vault_open </span>
        approval record.
      </p>

      <DataTable columns={columns} data={data} keyFn={(row) => row.id} />
    </div>
  );
}
