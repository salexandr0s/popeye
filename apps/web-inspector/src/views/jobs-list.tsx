import { useState } from 'react';
import { DataTable, type Column } from '../components/data-table';
import { Badge } from '../components/badge';
import { Loading } from '../components/loading';
import { ErrorDisplay } from '../components/error-display';
import { EmptyState } from '../components/empty-state';
import { PageHeader } from '../components/page-header';
import { useJobs, type JobRecord } from '../api/hooks';
import { useApi } from '../api/provider';
import { formatTime } from '../utils/format';

export function JobsList() {
  const { data: jobs, error, loading, refetch } = useJobs();
  const api = useApi();
  const [actionError, setActionError] = useState<string | null>(null);

  const handlePause = async (jobId: string) => {
    try {
      setActionError(null);
      await api.post(`/v1/jobs/${jobId}/pause`);
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Pause failed');
    }
  };

  const handleResume = async (jobId: string) => {
    try {
      setActionError(null);
      await api.post(`/v1/jobs/${jobId}/resume`);
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Resume failed');
    }
  };

  const handleEnqueue = async (jobId: string) => {
    try {
      setActionError(null);
      await api.post(`/v1/jobs/${jobId}/enqueue`);
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Enqueue failed');
    }
  };

  const columns: Column<JobRecord>[] = [
    {
      key: 'status',
      header: 'Status',
      render: (row) => <Badge state={row.status} />,
      width: '160px',
    },
    {
      key: 'taskId',
      header: 'Task',
      render: (row) => (
        <span className="text-[14px] font-mono">{row.taskId.slice(0, 12)}...</span>
      ),
    },
    {
      key: 'retryCount',
      header: 'Retries',
      render: (row) => (
        <span className="text-[14px] text-[var(--color-fg-muted)]">
          {row.retryCount}
        </span>
      ),
      width: '80px',
    },
    {
      key: 'availableAt',
      header: 'Available At',
      render: (row) => (
        <span className="text-[14px] text-[var(--color-fg-muted)]">
          {formatTime(row.availableAt)}
        </span>
      ),
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
      render: (row) => (
        <div className="flex gap-[4px]">
          {row.status === 'running' || row.status === 'queued' ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                void handlePause(row.id);
              }}
              className="px-[8px] py-[4px] text-[12px] rounded-[var(--radius-sm)] text-[var(--color-warning)] hover:bg-[var(--color-warning)]/10 transition-colors duration-[var(--duration-fast)]"
            >
              Pause
            </button>
          ) : null}
          {row.status === 'paused' ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                void handleResume(row.id);
              }}
              className="px-[8px] py-[4px] text-[12px] rounded-[var(--radius-sm)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors duration-[var(--duration-fast)]"
            >
              Resume
            </button>
          ) : null}
          {['failed_final', 'cancelled'].includes(row.status) ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                void handleEnqueue(row.id);
              }}
              className="px-[8px] py-[4px] text-[12px] rounded-[var(--radius-sm)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors duration-[var(--duration-fast)]"
            >
              Enqueue
            </button>
          ) : null}
        </div>
      ),
      width: '100px',
    },
  ];

  if (loading) return <Loading />;
  if (error) return <ErrorDisplay message={error} />;

  return (
    <div>
      <PageHeader title="Jobs" description="Scheduled and active jobs" />
      {actionError ? <ErrorDisplay message={actionError} /> : null}
      {jobs && jobs.length > 0 ? (
        <DataTable
          columns={columns}
          data={jobs}
          keyFn={(j) => j.id}
        />
      ) : (
        <EmptyState title="No jobs" description="Jobs will appear here when tasks are enqueued." />
      )}
    </div>
  );
}
