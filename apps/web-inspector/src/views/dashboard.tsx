import { Card } from '../components/card';
import { Loading } from '../components/loading';
import { ErrorDisplay } from '../components/error-display';
import { PageHeader } from '../components/page-header';
import { useDaemonStatus, useSchedulerStatus, useUsageSummary } from '../api/hooks';

function formatUptime(startedAt: string): string {
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const diffMs = now - start;

  if (diffMs < 0) return '0s';

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function Dashboard() {
  const { data: status, error: statusError, loading: statusLoading } = useDaemonStatus();
  const { data: scheduler } = useSchedulerStatus();
  const { data: usage } = useUsageSummary();

  if (statusLoading) return <Loading />;
  if (statusError) return <ErrorDisplay message={statusError} />;
  if (!status) return <Loading />;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Popeye daemon overview"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[16px]">
        <Card
          label="Status"
          value={status.ok ? 'Healthy' : 'Unhealthy'}
          description={`Engine: ${status.engineKind}`}
        />
        <Card
          label="Uptime"
          value={formatUptime(status.startedAt)}
          description={`Since ${new Date(status.startedAt).toLocaleString()}`}
        />
        <Card
          label="Running Jobs"
          value={status.runningJobs}
          description={`${status.queuedJobs} queued`}
        />
        <Card
          label="Open Interventions"
          value={status.openInterventions}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[16px] mt-[16px]">
        <Card
          label="Scheduler"
          value={status.schedulerRunning ? 'Running' : 'Stopped'}
          description={
            scheduler?.nextHeartbeatDueAt
              ? `Next heartbeat: ${new Date(scheduler.nextHeartbeatDueAt).toLocaleTimeString()}`
              : undefined
          }
        />
        <Card
          label="Active Leases"
          value={status.activeLeases}
        />
        {usage ? (
          <>
            <Card
              label="Total Runs"
              value={usage.runs}
            />
            <Card
              label="Estimated Cost"
              value={`$${usage.estimatedCostUsd.toFixed(4)}`}
              description={`${usage.tokensIn.toLocaleString()} in / ${usage.tokensOut.toLocaleString()} out`}
            />
          </>
        ) : (
          <>
            <Card label="Total Runs" value="--" />
            <Card label="Estimated Cost" value="--" />
          </>
        )}
      </div>
    </div>
  );
}
