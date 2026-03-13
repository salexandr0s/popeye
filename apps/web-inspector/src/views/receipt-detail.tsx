import { useParams, Link } from 'react-router-dom';
import { useReceipt } from '../api/hooks';
import { Badge } from '../components/badge';
import { Loading } from '../components/loading';
import { ErrorDisplay } from '../components/error-display';
import { PageHeader } from '../components/page-header';

export function ReceiptDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: receipt, error, loading } = useReceipt(id ?? '');

  if (loading) return <Loading />;
  if (error) return <ErrorDisplay message={error} />;
  if (!receipt) return <Loading />;

  return (
    <div>
      <PageHeader title={`Receipt ${receipt.id.slice(0, 8)}...`} />

      <div className="space-y-[24px]">
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
          <div className="grid grid-cols-2 gap-[16px]">
            <div>
              <p className="text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide">
                Status
              </p>
              <div className="mt-[4px]">
                <Badge state={receipt.status} />
              </div>
            </div>
            <div>
              <p className="text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide">
                Run
              </p>
              <Link
                to={`/runs/${receipt.runId}`}
                className="mt-[4px] block text-[14px] font-mono text-[var(--color-accent)] hover:underline"
              >
                {receipt.runId.slice(0, 12)}...
              </Link>
            </div>
            <div>
              <p className="text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide">
                Workspace
              </p>
              <p className="mt-[4px] text-[14px]">{receipt.workspaceId}</p>
            </div>
            <div>
              <p className="text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide">
                Created
              </p>
              <p className="mt-[4px] text-[14px]">
                {new Date(receipt.createdAt).toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
          <h2 className="text-[14px] font-medium text-[var(--color-fg-muted)] uppercase tracking-wide mb-[8px]">
            Summary
          </h2>
          <p className="text-[14px] text-[var(--color-fg)]">{receipt.summary}</p>
        </div>

        {/* Details */}
        {receipt.details ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
            <h2 className="text-[14px] font-medium text-[var(--color-fg-muted)] uppercase tracking-wide mb-[8px]">
              Details
            </h2>
            <pre className="text-[13px] text-[var(--color-fg)] font-[var(--font-mono)] whitespace-pre-wrap bg-[var(--color-bg-muted)] rounded-[var(--radius-sm)] p-[12px]">
              {receipt.details}
            </pre>
          </div>
        ) : null}

        {/* Usage */}
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
          <h2 className="text-[14px] font-medium text-[var(--color-fg-muted)] uppercase tracking-wide mb-[12px]">
            Usage Breakdown
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-[16px]">
            <div>
              <p className="text-[12px] text-[var(--color-fg-muted)]">Provider</p>
              <p className="text-[14px] font-medium">{receipt.usage.provider}</p>
            </div>
            <div>
              <p className="text-[12px] text-[var(--color-fg-muted)]">Model</p>
              <p className="text-[14px] font-medium">{receipt.usage.model}</p>
            </div>
            <div>
              <p className="text-[12px] text-[var(--color-fg-muted)]">Tokens In</p>
              <p className="text-[14px] font-medium font-mono">
                {receipt.usage.tokensIn.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-[12px] text-[var(--color-fg-muted)]">Tokens Out</p>
              <p className="text-[14px] font-medium font-mono">
                {receipt.usage.tokensOut.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-[12px] text-[var(--color-fg-muted)]">Estimated Cost</p>
              <p className="text-[14px] font-medium font-mono">
                ${receipt.usage.estimatedCostUsd.toFixed(4)}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
