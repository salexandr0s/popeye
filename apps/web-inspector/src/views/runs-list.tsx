import { useNavigate } from 'react-router-dom';
import { DataTable, type Column } from '../components/data-table';
import { Badge } from '../components/badge';
import { Loading } from '../components/loading';
import { ErrorDisplay } from '../components/error-display';
import { EmptyState } from '../components/empty-state';
import { PageHeader } from '../components/page-header';
import { useRuns, useTasks, type RunRecord, type TaskRecord } from '../api/hooks';
import { formatTime } from '../utils/format';

export function RunsList() {
  const { data: runs, error, loading } = useRuns();
  const { data: tasks } = useTasks();
  const navigate = useNavigate();

  const taskMap = new Map<string, TaskRecord>();
  if (tasks) {
    for (const t of tasks) {
      taskMap.set(t.id, t);
    }
  }

  const columns: Column<RunRecord>[] = [
    {
      key: 'state',
      header: 'State',
      render: (row) => <Badge state={row.state} />,
      width: '140px',
    },
    {
      key: 'task',
      header: 'Task',
      render: (row) => {
        const task = taskMap.get(row.taskId);
        return (
          <span className="text-[14px]">
            {task?.title ?? row.taskId}
          </span>
        );
      },
    },
    {
      key: 'workspace',
      header: 'Workspace',
      render: (row) => (
        <span className="text-[14px] text-[var(--color-fg-muted)]">
          {row.workspaceId}
        </span>
      ),
    },
    {
      key: 'startedAt',
      header: 'Started',
      render: (row) => (
        <span className="text-[14px] text-[var(--color-fg-muted)]">
          {formatTime(row.startedAt)}
        </span>
      ),
    },
    {
      key: 'finishedAt',
      header: 'Finished',
      render: (row) => (
        <span className="text-[14px] text-[var(--color-fg-muted)]">
          {formatTime(row.finishedAt)}
        </span>
      ),
    },
  ];

  if (loading) return <Loading />;
  if (error) return <ErrorDisplay message={error} />;

  return (
    <div>
      <PageHeader title="Runs" description="All engine runs" />
      {runs && runs.length > 0 ? (
        <DataTable
          columns={columns}
          data={runs}
          keyFn={(r) => r.id}
          onRowClick={(r) => navigate(`/runs/${r.id}`)}
        />
      ) : (
        <EmptyState title="No runs yet" description="Runs will appear here once tasks are executed." />
      )}
    </div>
  );
}
