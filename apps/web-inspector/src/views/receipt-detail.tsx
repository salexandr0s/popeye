import { useParams, Link } from 'react-router-dom';
import { useReceipt } from '../api/hooks';
import { Badge } from '../components/badge';
import { Loading } from '../components/loading';
import { ErrorDisplay } from '../components/error-display';
import { PageHeader } from '../components/page-header';

function timelineSeverityClasses(severity: string): string {
  switch (severity) {
    case 'error':
      return 'bg-[var(--color-danger)]/10 text-[var(--color-danger)]';
    case 'warn':
      return 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]';
    default:
      return 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]';
  }
}

function timelineKindLabel(kind: string): string {
  return kind.replace(/_/g, ' ');
}

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
            {receipt.runtime?.projectId ? (
              <div>
                <p className="text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide">
                  Project
                </p>
                <p className="mt-[4px] text-[14px] font-mono">{receipt.runtime.projectId}</p>
              </div>
            ) : null}
            {receipt.runtime?.profileId ? (
              <div>
                <p className="text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide">
                  Profile
                </p>
                <p className="mt-[4px] text-[14px] font-mono">{receipt.runtime.profileId}</p>
              </div>
            ) : null}
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

        {receipt.runtime?.execution ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
            <h2 className="text-[14px] font-medium text-[var(--color-fg-muted)] uppercase tracking-wide mb-[12px]">
              Runtime Context
            </h2>
            <div className="grid grid-cols-2 gap-[16px]">
              <div>
                <p className="text-[12px] text-[var(--color-fg-muted)]">Mode</p>
                <p className="text-[14px] font-medium">{receipt.runtime.execution.mode}</p>
              </div>
              <div>
                <p className="text-[12px] text-[var(--color-fg-muted)]">Session Policy</p>
                <p className="text-[14px] font-medium">{receipt.runtime.execution.sessionPolicy}</p>
              </div>
              <div>
                <p className="text-[12px] text-[var(--color-fg-muted)]">Memory / Recall Scope</p>
                <p className="text-[14px] font-medium">
                  {receipt.runtime.execution.memoryScope} / {receipt.runtime.execution.recallScope}
                </p>
              </div>
              <div>
                <p className="text-[12px] text-[var(--color-fg-muted)]">Filesystem Policy</p>
                <p className="text-[14px] font-medium">{receipt.runtime.execution.filesystemPolicyClass}</p>
              </div>
              <div>
                <p className="text-[12px] text-[var(--color-fg-muted)]">Context Release Policy</p>
                <p className="text-[14px] font-medium">{receipt.runtime.execution.contextReleasePolicy}</p>
              </div>
            </div>

            {receipt.runtime.execution.warnings.length > 0 ? (
              <div className="mt-[16px] rounded-[var(--radius-sm)] bg-[var(--color-warning)]/5 p-[12px]">
                <p className="text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide mb-[4px]">
                  Runtime Warnings
                </p>
                <ul className="space-y-[4px] text-[14px] text-[var(--color-fg)]">
                  {receipt.runtime.execution.warnings.map((warning) => (
                    <li key={warning}>• {warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {receipt.runtime?.contextReleases ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
            <h2 className="text-[14px] font-medium text-[var(--color-fg-muted)] uppercase tracking-wide mb-[12px]">
              Context Releases
            </h2>
            <div className="grid grid-cols-2 gap-[16px]">
              <div>
                <p className="text-[12px] text-[var(--color-fg-muted)]">Total Releases</p>
                <p className="text-[14px] font-medium font-mono">{receipt.runtime.contextReleases.totalReleases}</p>
              </div>
              <div>
                <p className="text-[12px] text-[var(--color-fg-muted)]">Estimated Tokens Released</p>
                <p className="text-[14px] font-medium font-mono">{receipt.runtime.contextReleases.totalTokenEstimate}</p>
              </div>
            </div>
            <div className="mt-[16px] space-y-[8px]">
              {Object.entries(receipt.runtime.contextReleases.byDomain).map(([domain, summary]) => (
                <div
                  key={domain}
                  className="flex items-center justify-between rounded-[var(--radius-sm)] bg-[var(--color-bg-muted)] px-[12px] py-[10px] text-[14px]"
                >
                  <span className="font-medium">{domain}</span>
                  <span className="font-mono text-[var(--color-fg-muted)]">
                    {summary.count} release(s) / {summary.tokens} tokens
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {receipt.runtime?.timeline && receipt.runtime.timeline.length > 0 ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
            <h2 className="text-[14px] font-medium text-[var(--color-fg-muted)] uppercase tracking-wide mb-[12px]">
              Policy Timeline
            </h2>
            <div className="space-y-[12px]">
              {receipt.runtime.timeline.map((event) => {
                const metadataEntries = Object.entries(event.metadata);
                return (
                  <div
                    key={event.id}
                    className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-muted)] p-[12px]"
                  >
                    <div className="flex flex-wrap items-center gap-[8px]">
                      <span
                        className={`inline-flex rounded-full px-[8px] py-[2px] text-[12px] font-medium ${timelineSeverityClasses(event.severity)}`}
                      >
                        {event.severity}
                      </span>
                      <span className="text-[12px] uppercase tracking-wide text-[var(--color-fg-muted)]">
                        {timelineKindLabel(event.kind)}
                      </span>
                      <span className="text-[12px] text-[var(--color-fg-muted)]">
                        {new Date(event.at).toLocaleString()}
                      </span>
                    </div>
                    <div className="mt-[8px]">
                      <p className="text-[14px] font-medium text-[var(--color-fg)]">{event.title}</p>
                      {event.detail ? (
                        <p className="mt-[4px] text-[14px] text-[var(--color-fg-muted)]">{event.detail}</p>
                      ) : null}
                    </div>
                    {metadataEntries.length > 0 ? (
                      <details className="mt-[10px]">
                        <summary className="cursor-pointer text-[12px] font-medium text-[var(--color-fg-muted)]">
                          Event metadata
                        </summary>
                        <div className="mt-[8px] grid grid-cols-1 gap-[6px] text-[12px] text-[var(--color-fg-muted)]">
                          {metadataEntries.map(([key, value]) => (
                            <div key={key} className="flex items-start justify-between gap-[12px]">
                              <span className="uppercase tracking-wide">{key}</span>
                              <span className="font-mono text-right text-[var(--color-fg)]">{value}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
