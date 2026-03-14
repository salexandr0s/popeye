import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../components/badge';
import { Card } from '../components/card';
import { EmptyState } from '../components/empty-state';
import { ErrorDisplay } from '../components/error-display';
import { Loading } from '../components/loading';
import { PageHeader } from '../components/page-header';
import {
  useDaemonStatus,
  useEventStreamFreshness,
  useInterventions,
  useJobs,
  useReceipts,
  useRunEvents,
  useRuns,
  useSchedulerStatus,
  useTasks,
  useUsageSummary,
  type EventStreamEnvelope,
  type InterventionRecord,
  type JobRecord,
  type ReceiptRecord,
  type RunRecord,
} from '../api/hooks';
import { formatTime } from '../utils/format';
import {
  applyStreamEventToRunActivity,
  buildRelatedCommandSnippets,
  buildTaskMap,
  DEFAULT_COMMAND_CENTER_LAYOUT,
  filterByWorkspace,
  getAttentionItems,
  getRunActivity,
  getRunActivityLabel,
  getRunAttention,
  getTaskProjectId,
  getTaskTitle,
  getWorkspaceOptions,
  isActiveJob,
  isActiveRun,
  isFailedJob,
  isFailedRun,
  isPanelStale,
  loadCommandCenterLayout,
  normalizeSelection,
  PANEL_KEYS,
  saveCommandCenterLayout,
  type CommandCenterLayout,
  type PanelKey,
  type SelectedCommandCenterItem,
} from './command-center-model';

function Panel({
  title,
  description,
  action,
  lastUpdated,
  stale,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  lastUpdated?: string | null;
  stale?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px] shadow-[var(--shadow-sm)] ${className ?? ''}`}>
      <div className="mb-[16px] flex flex-col gap-[12px] sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-[8px]">
            <h2 className="text-[18px] font-semibold text-[var(--color-fg)]">{title}</h2>
            <FreshnessPill stale={stale ?? false} />
          </div>
          {description ? (
            <p className="mt-[4px] text-[13px] text-[var(--color-fg-muted)]">{description}</p>
          ) : null}
          {lastUpdated ? (
            <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">Last updated {formatTime(lastUpdated)}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function FreshnessPill({ stale }: { stale: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-[8px] py-[2px] text-[11px] font-medium ${stale
        ? 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]'
        : 'bg-[var(--color-success)]/10 text-[var(--color-success)]'}`}
    >
      {stale ? 'Stale' : 'Fresh'}
    </span>
  );
}

function QuickLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[10px] py-[6px] text-[12px] font-medium text-[var(--color-fg-muted)] transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-fg)]/[0.03] hover:text-[var(--color-fg)]"
    >
      {label}
    </Link>
  );
}

function ControlButton({
  pressed,
  onClick,
  children,
}: {
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`rounded-[var(--radius-sm)] px-[12px] py-[8px] text-[13px] font-medium transition-colors duration-[var(--duration-fast)] ${pressed
        ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
        : 'border border-[var(--color-border)] text-[var(--color-fg-muted)] hover:bg-[var(--color-fg)]/[0.03] hover:text-[var(--color-fg)]'}`}
    >
      {children}
    </button>
  );
}

function StatusChip({ connected, error }: { connected: boolean; error: string | null }) {
  const label = connected ? 'Live stream connected' : 'Live stream disconnected';
  const tone = connected
    ? 'bg-[var(--color-success)]/10 text-[var(--color-success)]'
    : 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]';

  return (
    <div className={`inline-flex items-center gap-[8px] rounded-full px-[12px] py-[6px] text-[12px] font-medium ${tone}`}>
      <span className={`inline-block h-[6px] w-[6px] rounded-full ${connected ? 'bg-[var(--color-success)]' : 'bg-[var(--color-warning)]'}`} />
      <span>{label}</span>
      {error ? <span className="text-[var(--color-fg-muted)]">({error})</span> : null}
    </div>
  );
}

function DetailField({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-[var(--color-fg-muted)]">{label}</p>
      <div className={`mt-[4px] text-[14px] text-[var(--color-fg)] ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-[10px] text-[13px] font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">{title}</h3>
      {children}
    </section>
  );
}

function SelectableRow({
  selected,
  onSelect,
  label,
  title,
  meta,
  badges,
  description,
  action,
  dense,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  title: string;
  meta: ReactNode;
  badges?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  dense?: boolean;
}) {
  return (
    <li className={`rounded-[var(--radius-sm)] border ${selected ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5' : 'border-[var(--color-border)]'}`}>
      <div className="flex items-stretch gap-[8px]">
        <button
          type="button"
          onClick={onSelect}
          className={`flex-1 px-[12px] text-left transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-fg)]/[0.03] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40 ${dense ? 'py-[10px]' : 'py-[12px]'}`}
          aria-label={label}
        >
          {badges ? <div className="flex flex-wrap items-center gap-[8px]">{badges}</div> : null}
          <p className={`text-[var(--color-fg)] ${dense ? 'mt-[6px] text-[14px] font-medium' : 'mt-[8px] text-[15px] font-medium'}`}>
            {title}
          </p>
          <div className="mt-[6px] flex flex-wrap gap-[12px] text-[12px] text-[var(--color-fg-muted)]">{meta}</div>
          {description ? <div className="mt-[8px] text-[12px] text-[var(--color-fg-muted)]">{description}</div> : null}
        </button>
        {action ? <div className="flex shrink-0 items-start p-[12px]">{action}</div> : null}
      </div>
    </li>
  );
}

function CopyCommandButton({ command }: { command: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  const handleCopy = async () => {
    try {
      if (!globalThis.navigator?.clipboard?.writeText) {
        throw new Error('Clipboard unavailable');
      }
      await globalThis.navigator.clipboard.writeText(command);
      setStatus('copied');
      globalThis.window.setTimeout(() => setStatus('idle'), 1500);
    } catch {
      setStatus('error');
      globalThis.window.setTimeout(() => setStatus('idle'), 2500);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[10px] py-[6px] text-[12px] font-medium text-[var(--color-fg-muted)] transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-fg)]/[0.03] hover:text-[var(--color-fg)]"
    >
      {status === 'idle' ? 'Copy' : status === 'copied' ? 'Copied' : 'Select manually'}
    </button>
  );
}

function RelatedCommands({
  snippets,
}: {
  snippets: ReturnType<typeof buildRelatedCommandSnippets>;
}) {
  return (
    <div className="space-y-[10px]">
      {snippets.map((snippet) => (
        <div key={`${snippet.label}:${snippet.command}`} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-muted)] p-[12px]">
          <div className="flex items-center justify-between gap-[12px]">
            <p className="text-[12px] font-medium text-[var(--color-fg-muted)]">{snippet.label}</p>
            <CopyCommandButton command={snippet.command} />
          </div>
          <pre className="mt-[8px] overflow-x-auto whitespace-pre-wrap break-all text-[12px] text-[var(--color-fg)] font-[var(--font-mono)]">{snippet.command}</pre>
        </div>
      ))}
    </div>
  );
}

function buildLatestReceiptByRunId(receipts: ReceiptRecord[] | null | undefined): Map<string, ReceiptRecord> {
  const latest = new Map<string, ReceiptRecord>();
  for (const receipt of (receipts ?? []).slice().sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))) {
    if (!latest.has(receipt.runId)) latest.set(receipt.runId, receipt);
  }
  return latest;
}

function useClockTick(intervalMs: number): number {
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    const timer = globalThis.window.setInterval(() => setTick(Date.now()), intervalMs);
    return () => globalThis.window.clearInterval(timer);
  }, [intervalMs]);

  return tick;
}

function buildMemoryLinkQuery(parts: Array<string | null | undefined>): string {
  const query = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .slice(0, 2)
    .join(' ');
  return `/memory${query ? `?q=${encodeURIComponent(query)}` : ''}`;
}

export function CommandCenter() {
  const status = useDaemonStatus();
  const scheduler = useSchedulerStatus();
  const runs = useRuns();
  const jobs = useJobs();
  const tasks = useTasks();
  const interventions = useInterventions();
  const receipts = useReceipts();
  const usage = useUsageSummary();

  const [layout, setLayout] = useState(loadCommandCenterLayout);
  const [activityByRunId, setActivityByRunId] = useState<Record<string, ReturnType<typeof getRunActivity>>>({});
  const clockTick = useClockTick(15_000);
  const stream = useEventStreamFreshness(useCallback((event: EventStreamEnvelope) => {
    setActivityByRunId((current) => applyStreamEventToRunActivity(current, event));
  }, []));

  useEffect(() => {
    saveCommandCenterLayout(layout);
  }, [layout]);

  const taskMap = useMemo(() => buildTaskMap(tasks.data), [tasks.data]);
  const workspaceOptions = useMemo(
    () => getWorkspaceOptions(runs.data, jobs.data, tasks.data),
    [jobs.data, runs.data, tasks.data],
  );
  const latestReceiptByRunId = useMemo(() => buildLatestReceiptByRunId(receipts.data), [receipts.data]);
  const runMap = useMemo(() => new Map((runs.data ?? []).map((run) => [run.id, run])), [runs.data]);
  const jobMap = useMemo(() => new Map((jobs.data ?? []).map((job) => [job.id, job])), [jobs.data]);

  const filteredRuns = useMemo(
    () => filterByWorkspace(runs.data ?? [], layout.workspaceId, (run) => run.workspaceId),
    [layout.workspaceId, runs.data],
  );
  const filteredJobs = useMemo(
    () => filterByWorkspace(jobs.data ?? [], layout.workspaceId, (job) => job.workspaceId),
    [jobs.data, layout.workspaceId],
  );
  const filteredInterventions = useMemo(() => {
    if (layout.workspaceId === 'all') return (interventions.data ?? []).filter((entry) => entry.status === 'open');
    return (interventions.data ?? []).filter((entry) => {
      if (entry.status !== 'open') return false;
      if (!entry.runId) return true;
      return runMap.get(entry.runId)?.workspaceId === layout.workspaceId;
    });
  }, [interventions.data, layout.workspaceId, runMap]);

  const activeRuns = useMemo(
    () => [...filteredRuns].filter(isActiveRun).sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt)),
    [filteredRuns],
  );
  const activeJobs = useMemo(
    () => [...filteredJobs].filter(isActiveJob).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)),
    [filteredJobs],
  );
  const blockedJobs = useMemo(() => filteredJobs.filter((job) => job.status === 'blocked_operator'), [filteredJobs]);
  const failedJobs = useMemo(() => filteredJobs.filter(isFailedJob), [filteredJobs]);
  const failedRuns = useMemo(() => filteredRuns.filter(isFailedRun), [filteredRuns]);

  const { attentionRuns } = useMemo(
    () => getAttentionItems(filteredRuns, filteredJobs, filteredInterventions, layout.workspaceId, activityByRunId),
    [activityByRunId, filteredInterventions, filteredJobs, filteredRuns, layout.workspaceId],
  );

  useEffect(() => {
    const normalized = normalizeSelection(layout.selectedItem, filteredRuns, filteredJobs, filteredInterventions);
    if (normalized.kind !== layout.selectedItem.kind || normalized.id !== layout.selectedItem.id) {
      setLayout((current) => ({ ...current, selectedItem: normalized }));
    }
  }, [filteredInterventions, filteredJobs, filteredRuns, layout.selectedItem]);

  const selectedRun = layout.selectedItem.kind === 'run'
    ? filteredRuns.find((run) => run.id === layout.selectedItem.id) ?? null
    : null;
  const selectedJob = layout.selectedItem.kind === 'job'
    ? filteredJobs.find((job) => job.id === layout.selectedItem.id) ?? null
    : null;
  const selectedIntervention = layout.selectedItem.kind === 'intervention'
    ? filteredInterventions.find((intervention) => intervention.id === layout.selectedItem.id) ?? null
    : null;
  const selectedRunEvents = useRunEvents(selectedRun?.id);

  const summaryUpdatedAt = status.updatedAt ?? scheduler.updatedAt ?? usage.updatedAt ?? runs.updatedAt ?? jobs.updatedAt ?? interventions.updatedAt ?? receipts.updatedAt;
  const activeRunCount = activeRuns.length;
  const queuedJobCount = filteredJobs.filter((job) => job.status === 'queued').length;
  const blockedJobCount = blockedJobs.length;
  const openInterventionCount = filteredInterventions.length;
  const recentFailureCount = failedRuns.length + failedJobs.length;
  const schedulerNextHeartbeat = scheduler.data?.nextHeartbeatDueAt ? `Heartbeat ${formatTime(scheduler.data.nextHeartbeatDueAt)}` : 'Heartbeat unavailable';

  const selectItem = (selectedItem: SelectedCommandCenterItem) => {
    setLayout((current) => ({
      ...current,
      selectedItem,
      panels: {
        ...current.panels,
        detail: true,
      },
    }));
  };

  const togglePanel = (panel: PanelKey) => {
    setLayout((current) => ({
      ...current,
      panels: {
        ...current.panels,
        [panel]: !current.panels[panel],
      },
    }));
  };

  const setFocusMode = () => {
    setLayout((current) => ({
      ...current,
      focusMode: !current.focusMode,
      panels: current.focusMode
        ? DEFAULT_COMMAND_CENTER_LAYOUT.panels
        : {
            summary: true,
            runs: true,
            jobs: true,
            attention: false,
            detail: true,
          },
    }));
  };

  const selectedReceipt = selectedRun ? latestReceiptByRunId.get(selectedRun.id) ?? null : null;
  const selectedRunJob = selectedRun ? jobMap.get(selectedRun.jobId) ?? null : null;
  const selectedRunInterventions = selectedRun
    ? filteredInterventions.filter((intervention) => intervention.runId === selectedRun.id)
    : [];
  const selectedRunActivity = selectedRun
    ? getRunActivity(selectedRun, activityByRunId, selectedRunEvents.data)
    : null;
  const selectedRunAttention = selectedRun
    ? getRunAttention(selectedRun, {
        activity: selectedRunActivity,
        hasOpenIntervention: selectedRunInterventions.length > 0,
        isBlockedOperator: selectedRunJob?.status === 'blocked_operator',
        now: clockTick,
      })
    : null;

  const detailPaneUpdatedAt = selectedRunEvents.updatedAt
    ?? (selectedIntervention?.createdAt ?? null)
    ?? (selectedJob?.updatedAt ?? null)
    ?? null;

  const mainColumnsClassName = layout.panels.attention
    ? 'grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(300px,0.9fr)]'
    : 'grid-cols-1 xl:grid-cols-2';

  return (
    <div>
      <div className="mb-[24px] flex flex-col gap-[16px] 2xl:flex-row 2xl:items-start 2xl:justify-between">
        <PageHeader
          title="Command Center"
          description="Supervise active agents, inspect live activity, and jump into related Popeye tools without leaving the screen."
        />
        <div className="flex flex-col items-start gap-[12px] 2xl:items-end">
          <StatusChip connected={stream.connected} error={stream.error} />
          <div className="text-[12px] text-[var(--color-fg-muted)]">
            {stream.lastEventAt ? `Last live event ${formatTime(stream.lastEventAt)}` : 'Waiting for live events'}
          </div>
        </div>
      </div>

      <div className="mb-[20px] flex flex-col gap-[12px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[16px] shadow-[var(--shadow-sm)] 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <div className="flex flex-wrap items-center gap-[12px]">
          <label className="text-[13px] font-medium text-[var(--color-fg-muted)]" htmlFor="command-center-workspace-filter">
            Workspace
          </label>
          <select
            id="command-center-workspace-filter"
            value={layout.workspaceId}
            onChange={(event) => setLayout((current) => ({ ...current, workspaceId: event.target.value }))}
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] px-[12px] py-[8px] text-[14px] text-[var(--color-fg)]"
          >
            {workspaceOptions.map((workspaceId) => (
              <option key={workspaceId} value={workspaceId}>
                {workspaceId === 'all' ? 'All workspaces' : workspaceId}
              </option>
            ))}
          </select>
          <ControlButton pressed={layout.focusMode} onClick={setFocusMode}>
            {layout.focusMode ? 'Exit focus mode' : 'Focus mode'}
          </ControlButton>
          <ControlButton
            pressed={layout.denseMode}
            onClick={() => setLayout((current) => ({ ...current, denseMode: !current.denseMode }))}
          >
            Dense mode
          </ControlButton>
          <ControlButton
            pressed={layout.detailPane.width === 'compact'}
            onClick={() => setLayout((current) => ({
              ...current,
              detailPane: {
                width: current.detailPane.width === 'wide' ? 'compact' : 'wide',
              },
            }))}
          >
            {layout.detailPane.width === 'wide' ? 'Compact detail' : 'Wide detail'}
          </ControlButton>
        </div>
        <div className="flex flex-wrap gap-[8px]">
          {PANEL_KEYS.map((panel) => (
            <ControlButton key={panel} pressed={layout.panels[panel]} onClick={() => togglePanel(panel)}>
              {layout.panels[panel] ? `Hide ${panel}` : `Show ${panel}`}
            </ControlButton>
          ))}
        </div>
      </div>

      {layout.panels.summary ? (
        <div className="mb-[16px] grid grid-cols-1 gap-[16px] sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <Card label="Active Runs" value={activeRunCount} description={layout.workspaceId === 'all' ? schedulerNextHeartbeat : layout.workspaceId} />
          <Card label="Queued Jobs" value={queuedJobCount} description="Ready for scheduler pickup" />
          <Card label="Blocked Jobs" value={blockedJobCount} description="Waiting on operator help" />
          <Card label="Open Interventions" value={openInterventionCount} description={stream.connected ? 'Live hints updating' : 'Live stream disconnected'} />
          <Card label="Estimated Cost" value={usage.data ? `$${usage.data.estimatedCostUsd.toFixed(4)}` : '--'} description={usage.data ? `${usage.data.runs} runs total` : 'Usage unavailable'} />
          <Card label="Recent Failures" value={recentFailureCount} description={summaryUpdatedAt ? `Refreshed ${formatTime(summaryUpdatedAt)}` : 'Polling for updates'} />
        </div>
      ) : null}

      <div className={`grid gap-[16px] ${layout.panels.detail ? '2xl:grid-cols-[minmax(0,1.9fr)_minmax(340px,0.95fr)]' : 'grid-cols-1'}`}>
        <div className={`grid gap-[16px] ${mainColumnsClassName}`}>
          {layout.panels.runs ? (
            <Panel
              title="Active runs"
              description="Non-terminal engine work with live activity hints and inline selection."
              action={<QuickLink to="/runs" label="Open runs" />}
              lastUpdated={runs.updatedAt}
              stale={isPanelStale(runs.updatedAt, clockTick)}
            >
              {runs.loading ? <Loading /> : null}
              {runs.error ? <ErrorDisplay message={runs.error} /> : null}
              {!runs.loading && !runs.error ? (
                activeRuns.length > 0 ? (
                  <ul className="space-y-[12px]">
                    {activeRuns.map((run) => {
                      const activity = getRunActivity(run, activityByRunId, run.id === selectedRun?.id ? selectedRunEvents.data : undefined);
                      const attention = getRunAttention(run, {
                        activity,
                        hasOpenIntervention: filteredInterventions.some((intervention) => intervention.runId === run.id),
                        isBlockedOperator: filteredJobs.some((job) => job.lastRunId === run.id && job.status === 'blocked_operator'),
                        now: clockTick,
                      });
                      return (
                        <SelectableRow
                          key={run.id}
                          selected={layout.selectedItem.kind === 'run' && layout.selectedItem.id === run.id}
                          onSelect={() => selectItem({ kind: 'run', id: run.id })}
                          label={`Select run ${run.id}`}
                          title={getTaskTitle(taskMap, run.taskId)}
                          meta={(
                            <>
                              <span>{run.workspaceId}</span>
                              <span>{getRunActivityLabel(activity.source)} {formatTime(activity.lastActivityAt)}</span>
                              <span>Started {formatTime(run.startedAt)}</span>
                            </>
                          )}
                          badges={(
                            <>
                              <Badge state={run.state} />
                              {attention.label ? <Badge state={attention.level} /> : null}
                            </>
                          )}
                          description={attention.reason}
                          action={<QuickLink to={`/runs/${run.id}`} label="Open" />}
                          dense={layout.denseMode}
                        />
                      );
                    })}
                  </ul>
                ) : (
                  <EmptyState title="No active runs" description="Active run supervision appears here." />
                )
              ) : null}
            </Panel>
          ) : null}

          {layout.panels.jobs ? (
            <Panel
              title="Jobs in motion"
              description="Queued, leased, running, paused, waiting-retry, or operator-blocked jobs."
              action={<QuickLink to="/jobs" label="Open jobs" />}
              lastUpdated={jobs.updatedAt}
              stale={isPanelStale(jobs.updatedAt, clockTick)}
            >
              {jobs.loading ? <Loading /> : null}
              {jobs.error ? <ErrorDisplay message={jobs.error} /> : null}
              {!jobs.loading && !jobs.error ? (
                activeJobs.length > 0 ? (
                  <ul className="space-y-[12px]">
                    {activeJobs.map((job) => (
                      <SelectableRow
                        key={job.id}
                        selected={layout.selectedItem.kind === 'job' && layout.selectedItem.id === job.id}
                        onSelect={() => selectItem({ kind: 'job', id: job.id })}
                        label={`Select job ${job.id}`}
                        title={getTaskTitle(taskMap, job.taskId)}
                        meta={(
                          <>
                            <span>{job.workspaceId}</span>
                            <span>Updated {formatTime(job.updatedAt)}</span>
                            <span>Retries {job.retryCount}</span>
                          </>
                        )}
                        badges={(
                          <>
                            <Badge state={job.status} />
                            {job.lastRunId ? <span className="text-[12px] text-[var(--color-fg-muted)]">Run {job.lastRunId.slice(0, 8)}…</span> : null}
                          </>
                        )}
                        description={job.status === 'blocked_operator' ? 'Operator action is required before this job can continue.' : undefined}
                        action={<QuickLink to="/jobs" label="Board" />}
                        dense={layout.denseMode}
                      />
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="No active jobs" description="Queued or blocked jobs will appear here." />
                )
              ) : null}
            </Panel>
          ) : null}

          {layout.panels.attention ? (
            <Panel
              title="Attention"
              description="Operator hints only: open interventions, blocked jobs, and runs with no observed activity." 
              action={<QuickLink to="/interventions" label="Open interventions" />}
              lastUpdated={interventions.updatedAt ?? jobs.updatedAt ?? runs.updatedAt}
              stale={isPanelStale(interventions.updatedAt ?? jobs.updatedAt ?? runs.updatedAt, clockTick)}
            >
              {interventions.loading || jobs.loading || runs.loading ? <Loading /> : null}
              {interventions.error ? <ErrorDisplay message={interventions.error} /> : null}
              {jobs.error && !interventions.error ? <ErrorDisplay message={jobs.error} /> : null}
              {runs.error && !interventions.error && !jobs.error ? <ErrorDisplay message={runs.error} /> : null}
              {!interventions.loading && !jobs.loading && !runs.loading && !interventions.error && !jobs.error && !runs.error ? (
                attentionRuns.length > 0 || blockedJobs.length > 0 || filteredInterventions.length > 0 || recentFailureCount > 0 ? (
                  <div className="space-y-[16px]">
                    {filteredInterventions.length > 0 ? (
                      <DetailSection title="Open interventions">
                        <ul className="space-y-[8px]">
                          {filteredInterventions.slice(0, 5).map((intervention) => (
                            <SelectableRow
                              key={intervention.id}
                              selected={layout.selectedItem.kind === 'intervention' && layout.selectedItem.id === intervention.id}
                              onSelect={() => selectItem({ kind: 'intervention', id: intervention.id })}
                              label={`Select intervention ${intervention.id}`}
                              title={intervention.reason}
                              meta={(
                                <>
                                  <span>{intervention.code}</span>
                                  <span>Created {formatTime(intervention.createdAt)}</span>
                                </>
                              )}
                              badges={<Badge state={intervention.status} />}
                              action={<QuickLink to="/interventions" label="Review" />}
                              dense
                            />
                          ))}
                        </ul>
                      </DetailSection>
                    ) : null}

                    {attentionRuns.length > 0 ? (
                      <DetailSection title="Idle / stuck-risk runs">
                        <ul className="space-y-[8px]">
                          {attentionRuns.slice(0, 5).map(({ run, attention }) => (
                            <SelectableRow
                              key={run.id}
                              selected={layout.selectedItem.kind === 'run' && layout.selectedItem.id === run.id}
                              onSelect={() => selectItem({ kind: 'run', id: run.id })}
                              label={`Inspect run ${run.id}`}
                              title={getTaskTitle(taskMap, run.taskId)}
                              meta={(
                                <>
                                  <span>{run.workspaceId}</span>
                                  <span>Activity {formatTime(attention.lastActivityAt)}</span>
                                </>
                              )}
                              badges={<Badge state={attention.level} />}
                              description={attention.reason}
                              action={<QuickLink to={`/runs/${run.id}`} label="Inspect" />}
                              dense
                            />
                          ))}
                        </ul>
                      </DetailSection>
                    ) : null}

                    {blockedJobs.length > 0 ? (
                      <DetailSection title="Blocked jobs">
                        <ul className="space-y-[8px]">
                          {blockedJobs.slice(0, 5).map((job) => (
                            <SelectableRow
                              key={job.id}
                              selected={layout.selectedItem.kind === 'job' && layout.selectedItem.id === job.id}
                              onSelect={() => selectItem({ kind: 'job', id: job.id })}
                              label={`Inspect job ${job.id}`}
                              title={getTaskTitle(taskMap, job.taskId)}
                              meta={(
                                <>
                                  <span>{job.workspaceId}</span>
                                  <span>Updated {formatTime(job.updatedAt)}</span>
                                </>
                              )}
                              badges={<Badge state={job.status} />}
                              action={<QuickLink to="/jobs" label="Open" />}
                              dense
                            />
                          ))}
                        </ul>
                      </DetailSection>
                    ) : null}

                    {recentFailureCount > 0 ? (
                      <DetailSection title="Recent failures">
                        <p className="text-[13px] text-[var(--color-fg-muted)]">
                          {failedRuns.length} failed runs and {failedJobs.length} failed jobs are visible in the current workspace filter.
                        </p>
                      </DetailSection>
                    ) : null}
                  </div>
                ) : (
                  <EmptyState title="Nothing needs attention" description="The current workspace filter has no interventions, blocked jobs, or runs with idle heuristics." />
                )
              ) : null}
            </Panel>
          ) : null}
        </div>

        {layout.panels.detail ? (
          <Panel
            title="Inline detail"
            description="Quick drill-downs stay inside the command center. Dedicated pages remain available for full workflows."
            lastUpdated={detailPaneUpdatedAt}
            stale={isPanelStale(detailPaneUpdatedAt, clockTick)}
            className={`h-fit ${layout.detailPane.width === 'compact' ? '2xl:max-w-[420px]' : ''} 2xl:sticky 2xl:top-[24px]`}
          >
            {layout.selectedItem.kind === 'none' ? (
              <EmptyState
                title="Select something to inspect"
                description="Pick a run, job, or intervention from the overview panes to open inline details and related tool shortcuts."
              />
            ) : null}

            {selectedRun ? (
              <div className="space-y-[20px]">
                <DetailSection title="Run detail">
                  <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
                    <DetailField label="Task" value={getTaskTitle(taskMap, selectedRun.taskId)} />
                    <DetailField label="Workspace" value={selectedRun.workspaceId} />
                    <DetailField label="State" value={<Badge state={selectedRun.state} />} />
                    <DetailField label="Attention" value={selectedRunAttention?.label ? <Badge state={selectedRunAttention.level} /> : 'Normal'} />
                    <DetailField label="Run ID" value={selectedRun.id} mono />
                    <DetailField label="Job ID" value={selectedRun.jobId} mono />
                    <DetailField label="Session Root" value={selectedRun.sessionRootId} mono />
                    <DetailField label="Activity" value={selectedRunActivity ? `${formatTime(selectedRunActivity.lastActivityAt)} (${getRunActivityLabel(selectedRunActivity.source)})` : '--'} />
                    <DetailField label="Started" value={formatTime(selectedRun.startedAt)} />
                    <DetailField label="Finished" value={formatTime(selectedRun.finishedAt)} />
                  </div>
                  {selectedRunAttention?.reason ? (
                    <p className="mt-[12px] text-[12px] text-[var(--color-fg-muted)]">{selectedRunAttention.reason}</p>
                  ) : null}
                </DetailSection>

                {selectedReceipt ? (
                  <DetailSection title="Latest receipt summary">
                    <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-muted)] p-[12px]">
                      <div className="flex items-center justify-between gap-[12px]">
                        <Badge state={selectedReceipt.status} />
                        <QuickLink to={`/receipts/${selectedReceipt.id}`} label="Open receipt" />
                      </div>
                      <p className="mt-[10px] text-[14px] text-[var(--color-fg)]">{selectedReceipt.summary}</p>
                      <p className="mt-[6px] text-[12px] text-[var(--color-fg-muted)]">
                        {formatTime(selectedReceipt.createdAt)} · ${selectedReceipt.usage.estimatedCostUsd.toFixed(4)}
                      </p>
                    </div>
                  </DetailSection>
                ) : null}

                <DetailSection title="Recent run events">
                  {selectedRunEvents.loading ? <Loading /> : null}
                  {selectedRunEvents.error ? <ErrorDisplay message={selectedRunEvents.error} /> : null}
                  {!selectedRunEvents.loading && !selectedRunEvents.error ? (
                    selectedRunEvents.data && selectedRunEvents.data.length > 0 ? (
                      <div className="space-y-[8px]">
                        {selectedRunEvents.data.slice(-8).reverse().map((event) => (
                          <div key={event.id} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-muted)] p-[10px]">
                            <div className="flex flex-wrap items-center justify-between gap-[8px]">
                              <Badge state={event.type} />
                              <span className="text-[12px] text-[var(--color-fg-muted)]">{formatTime(event.createdAt)}</span>
                            </div>
                            <pre className="mt-[8px] whitespace-pre-wrap break-all text-[12px] text-[var(--color-fg)] font-[var(--font-mono)]">{event.payload}</pre>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState title="No run events" description="This run has no persisted events yet." />
                    )
                  ) : null}
                </DetailSection>

                <DetailSection title="Quick open">
                  <div className="flex flex-wrap gap-[8px]">
                    <QuickLink to={`/runs/${selectedRun.id}`} label="Run page" />
                    <QuickLink to="/jobs" label="Jobs" />
                    <QuickLink to={selectedReceipt ? `/receipts/${selectedReceipt.id}` : '/receipts'} label="Receipts" />
                    <QuickLink to={selectedRunInterventions[0] ? '/interventions' : '/interventions'} label="Interventions" />
                    <QuickLink
                      to={buildMemoryLinkQuery([getTaskTitle(taskMap, selectedRun.taskId), selectedRun.workspaceId])}
                      label="Memory"
                    />
                  </div>
                </DetailSection>

                <DetailSection title="Related tools">
                  <RelatedCommands
                    snippets={buildRelatedCommandSnippets({
                      runId: selectedRun.id,
                      jobId: selectedRun.jobId,
                      receiptId: selectedReceipt?.id ?? null,
                      taskTitle: getTaskTitle(taskMap, selectedRun.taskId),
                    })}
                  />
                </DetailSection>
              </div>
            ) : null}

            {selectedJob ? (
              <div className="space-y-[20px]">
                <DetailSection title="Job detail">
                  <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
                    <DetailField label="Task" value={getTaskTitle(taskMap, selectedJob.taskId)} />
                    <DetailField label="Workspace" value={selectedJob.workspaceId} />
                    <DetailField label="Status" value={<Badge state={selectedJob.status} />} />
                    <DetailField label="Retries" value={selectedJob.retryCount} />
                    <DetailField label="Job ID" value={selectedJob.id} mono />
                    <DetailField label="Last run" value={selectedJob.lastRunId ?? '--'} mono />
                    <DetailField label="Available" value={formatTime(selectedJob.availableAt)} />
                    <DetailField label="Updated" value={formatTime(selectedJob.updatedAt)} />
                  </div>
                </DetailSection>

                <DetailSection title="Quick open">
                  <div className="flex flex-wrap gap-[8px]">
                    <QuickLink to="/jobs" label="Jobs board" />
                    {selectedJob.lastRunId ? <QuickLink to={`/runs/${selectedJob.lastRunId}`} label="Related run" /> : null}
                    <QuickLink to="/receipts" label="Receipts" />
                    <QuickLink to={buildMemoryLinkQuery([getTaskTitle(taskMap, selectedJob.taskId), selectedJob.workspaceId])} label="Memory" />
                  </div>
                </DetailSection>

                <DetailSection title="Related tools">
                  <RelatedCommands
                    snippets={buildRelatedCommandSnippets({
                      runId: selectedJob.lastRunId,
                      jobId: selectedJob.id,
                      taskTitle: getTaskTitle(taskMap, selectedJob.taskId),
                    })}
                  />
                </DetailSection>
              </div>
            ) : null}

            {selectedIntervention ? (
              <div className="space-y-[20px]">
                <DetailSection title="Intervention detail">
                  <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
                    <DetailField label="Status" value={<Badge state={selectedIntervention.status} />} />
                    <DetailField label="Code" value={selectedIntervention.code} />
                    <DetailField label="Run" value={selectedIntervention.runId ?? '--'} mono />
                    <DetailField label="Created" value={formatTime(selectedIntervention.createdAt)} />
                    <DetailField label="Resolved" value={formatTime(selectedIntervention.resolvedAt)} />
                    <DetailField label="Project" value={selectedIntervention.runId ? getTaskProjectId(taskMap, runMap.get(selectedIntervention.runId)?.taskId ?? '') ?? '--' : '--'} />
                  </div>
                  <div className="mt-[12px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-muted)] p-[12px]">
                    <p className="text-[12px] uppercase tracking-wide text-[var(--color-fg-muted)]">Reason</p>
                    <p className="mt-[8px] text-[14px] text-[var(--color-fg)]">{selectedIntervention.reason}</p>
                  </div>
                </DetailSection>

                <DetailSection title="Quick open">
                  <div className="flex flex-wrap gap-[8px]">
                    <QuickLink to="/interventions" label="Interventions" />
                    {selectedIntervention.runId ? <QuickLink to={`/runs/${selectedIntervention.runId}`} label="Related run" /> : null}
                    <QuickLink to="/jobs" label="Jobs" />
                  </div>
                </DetailSection>

                <DetailSection title="Related tools">
                  <RelatedCommands
                    snippets={buildRelatedCommandSnippets({
                      runId: selectedIntervention.runId,
                      jobId: selectedIntervention.runId ? runMap.get(selectedIntervention.runId)?.jobId ?? null : null,
                      taskTitle: selectedIntervention.runId ? getTaskTitle(taskMap, runMap.get(selectedIntervention.runId)?.taskId ?? '') : 'operator intervention',
                    })}
                  />
                </DetailSection>
              </div>
            ) : null}
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
