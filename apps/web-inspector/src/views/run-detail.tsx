import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useRun, useRunEvents } from '../api/hooks';
import { useApi } from '../api/provider';
import { Badge } from '../components/badge';
import { Loading } from '../components/loading';
import { ErrorDisplay } from '../components/error-display';
import { PageHeader } from '../components/page-header';
import { formatTime } from '../utils/format';

export function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: run, error, loading, refetch } = useRun(id);
  const {
    data: events,
    error: eventsError,
    loading: eventsLoading,
  } = useRunEvents(id);
  const api = useApi();
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (error) return <ErrorDisplay message={error} />;
  if (!run) return <Loading />;

  const handleCancel = async () => {
    try {
      setActionError(null);
      await api.post(`/v1/runs/${run.id}/cancel`);
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Cancel failed');
    }
  };

  const handleRetry = async () => {
    try {
      setActionError(null);
      await api.post(`/v1/runs/${run.id}/retry`);
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Retry failed');
    }
  };

  const canCancel = run.state === 'starting' || run.state === 'running';
  const canRetry = ['failed_retryable', 'failed_final', 'cancelled', 'abandoned'].includes(run.state);

  return (
    <div>
      <PageHeader title={`Run ${run.id.slice(0, 8)}...`} />

      <div className="space-y-[24px]">
        {/* Run info */}
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
          <div className="grid grid-cols-2 gap-[16px]">
            <div>
              <p className="text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide">
                State
              </p>
              <div className="mt-[4px]">
                <Badge state={run.state} />
              </div>
            </div>
            <div>
              <p className="text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide">
                Job
              </p>
              <p className="mt-[4px] text-[14px] font-mono text-[var(--color-fg)]">
                {run.jobId.slice(0, 12)}...
              </p>
            </div>
            <div>
              <p className="text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide">
                Started
              </p>
              <p className="mt-[4px] text-[14px]">{formatTime(run.startedAt)}</p>
            </div>
            <div>
              <p className="text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide">
                Finished
              </p>
              <p className="mt-[4px] text-[14px]">{formatTime(run.finishedAt)}</p>
            </div>
            <div>
              <p className="text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide">
                Workspace
              </p>
              <p className="mt-[4px] text-[14px]">{run.workspaceId}</p>
            </div>
            <div>
              <p className="text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide">
                Session Root
              </p>
              <p className="mt-[4px] text-[14px] font-mono">
                {run.sessionRootId.slice(0, 12)}...
              </p>
            </div>
          </div>

          {run.error ? (
            <div className="mt-[16px] rounded-[var(--radius-sm)] bg-[var(--color-danger)]/5 p-[12px]">
              <p className="text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide mb-[4px]">
                Error
              </p>
              <p className="text-[14px] text-[var(--color-danger)] font-mono whitespace-pre-wrap">
                {run.error}
              </p>
            </div>
          ) : null}
        </div>

        {/* Actions */}
        {actionError ? <ErrorDisplay message={actionError} /> : null}
        <div className="flex gap-[8px]">
          {canCancel ? (
            <button
              onClick={() => void handleCancel()}
              className="px-[16px] py-[8px] rounded-[var(--radius-sm)] text-[14px] font-medium bg-[var(--color-danger)]/10 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/20 transition-colors duration-[var(--duration-fast)]"
            >
              Cancel Run
            </button>
          ) : null}
          {canRetry ? (
            <button
              onClick={() => void handleRetry()}
              className="px-[16px] py-[8px] rounded-[var(--radius-sm)] text-[14px] font-medium bg-[var(--color-accent)]/10 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20 transition-colors duration-[var(--duration-fast)]"
            >
              Retry Job
            </button>
          ) : null}
          <Link
            to={`/receipts`}
            className="px-[16px] py-[8px] rounded-[var(--radius-sm)] text-[14px] font-medium text-[var(--color-fg-muted)] hover:bg-[var(--color-fg)]/[0.03] transition-colors duration-[var(--duration-fast)]"
          >
            View Receipts
          </Link>
        </div>

        {/* Event timeline */}
        <div>
          <h2 className="text-[16px] font-semibold text-[var(--color-fg)] mb-[12px]">
            Events
          </h2>
          {eventsLoading ? (
            <Loading />
          ) : eventsError ? (
            <ErrorDisplay message={eventsError} />
          ) : events && events.length > 0 ? (
            <div className="space-y-[4px]">
              {events.map((evt) => (
                <div
                  key={evt.id}
                  className="flex items-start gap-[12px] py-[8px] px-[12px] rounded-[var(--radius-sm)] hover:bg-[var(--color-bg-muted)] transition-colors duration-[var(--duration-fast)]"
                >
                  <span className="text-[12px] text-[var(--color-fg-muted)] font-mono whitespace-nowrap mt-[2px]">
                    {new Date(evt.createdAt).toLocaleTimeString()}
                  </span>
                  <Badge state={evt.type} />
                  <span className="text-[13px] text-[var(--color-fg-muted)] font-mono truncate flex-1">
                    {evt.payload.length > 120
                      ? `${evt.payload.slice(0, 120)}...`
                      : evt.payload}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[14px] text-[var(--color-fg-muted)]">
              No events recorded.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
