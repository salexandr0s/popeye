import { Card } from '../components/card';
import { DataTable, type Column } from '../components/data-table';
import { Loading } from '../components/loading';
import { ErrorDisplay } from '../components/error-display';
import { EmptyState } from '../components/empty-state';
import { PageHeader } from '../components/page-header';
import { useUsageSummary, useSecurityAudit, type SecurityAuditFinding } from '../api/hooks';
import { Badge } from '../components/badge';

export function Usage() {
  const { data: usage, error: usageError, loading: usageLoading } = useUsageSummary();
  const { data: audit, error: auditError, loading: auditLoading } = useSecurityAudit();

  const auditColumns: Column<SecurityAuditFinding>[] = [
    {
      key: 'severity',
      header: 'Severity',
      render: (row) => <Badge state={row.severity} />,
      width: '120px',
    },
    {
      key: 'code',
      header: 'Code',
      render: (row) => (
        <span className="text-[14px] font-mono">{row.code}</span>
      ),
      width: '200px',
    },
    {
      key: 'message',
      header: 'Message',
      render: (row) => (
        <span className="text-[14px]">{row.message}</span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Usage & Audit"
        description="Cost tracking and security findings"
      />

      {/* Usage stats */}
      {usageLoading ? <Loading /> : null}
      {usageError ? <ErrorDisplay message={usageError} /> : null}
      {usage ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[16px] mb-[32px]">
          <Card label="Total Runs" value={usage.runs} />
          <Card
            label="Tokens In"
            value={usage.tokensIn.toLocaleString()}
          />
          <Card
            label="Tokens Out"
            value={usage.tokensOut.toLocaleString()}
          />
          <Card
            label="Estimated Cost"
            value={`$${usage.estimatedCostUsd.toFixed(4)}`}
          />
        </div>
      ) : null}

      {/* Security audit */}
      <div className="mt-[16px]">
        <h2 className="text-[18px] font-semibold text-[var(--color-fg)] mb-[16px]">
          Security Audit
        </h2>
        {auditLoading ? <Loading /> : null}
        {auditError ? <ErrorDisplay message={auditError} /> : null}
        {audit ? (
          audit.length > 0 ? (
            <DataTable
              columns={auditColumns}
              data={audit}
              keyFn={(f) => `${f.code}-${f.message}`}
            />
          ) : (
            <EmptyState
              title="No findings"
              description="No security audit findings to display."
            />
          )
        ) : null}
      </div>
    </div>
  );
}
