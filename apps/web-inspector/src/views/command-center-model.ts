import type { InterventionRecord, JobRecord, RunEventRecord, RunRecord, TaskRecord } from '../api/hooks';

export const COMMAND_CENTER_STORAGE_KEY = 'popeye.command-center.layout';
export const IDLE_HINT_MS = 10 * 60 * 1000;
export const STUCK_RISK_MS = 30 * 60 * 1000;
export const PANEL_STALE_MS = 20 * 1000;

export const PANEL_KEYS = ['summary', 'runs', 'jobs', 'attention', 'detail'] as const;
export type PanelKey = typeof PANEL_KEYS[number];

export type DetailPaneWidth = 'compact' | 'wide';

export type SelectedCommandCenterItem =
  | { kind: 'none'; id: null }
  | { kind: 'run'; id: string }
  | { kind: 'job'; id: string }
  | { kind: 'intervention'; id: string };

export interface CommandCenterLayout {
  focusMode: boolean;
  denseMode: boolean;
  workspaceId: string;
  panels: Record<PanelKey, boolean>;
  selectedItem: SelectedCommandCenterItem;
  detailPane: {
    width: DetailPaneWidth;
  };
}

export type RunActivitySource =
  | 'fallback_started_at'
  | 'run_started'
  | 'run_event'
  | 'run_completed'
  | 'selected_run_events';

export interface RunActivityState {
  lastActivityAt: string;
  source: RunActivitySource;
}

export interface RunAttentionState {
  level: 'none' | 'idle' | 'stuck-risk';
  label: string | null;
  reason: string | null;
  lastActivityAt: string | null;
  activitySource: RunActivitySource | null;
}

export const DEFAULT_COMMAND_CENTER_LAYOUT: CommandCenterLayout = {
  focusMode: false,
  denseMode: false,
  workspaceId: 'all',
  panels: {
    summary: true,
    runs: true,
    jobs: true,
    attention: true,
    detail: true,
  },
  selectedItem: {
    kind: 'none',
    id: null,
  },
  detailPane: {
    width: 'wide',
  },
};

export function loadCommandCenterLayout(storage: globalThis.Storage | null = getDefaultStorage()): CommandCenterLayout {
  if (!storage) return DEFAULT_COMMAND_CENTER_LAYOUT;

  try {
    const raw = storage.getItem(COMMAND_CENTER_STORAGE_KEY);
    if (!raw) return DEFAULT_COMMAND_CENTER_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<CommandCenterLayout>;
    const selectedItem = isSelectedCommandCenterItem(parsed.selectedItem)
      ? parsed.selectedItem
      : DEFAULT_COMMAND_CENTER_LAYOUT.selectedItem;
    return {
      focusMode: parsed.focusMode ?? DEFAULT_COMMAND_CENTER_LAYOUT.focusMode,
      denseMode: parsed.denseMode ?? DEFAULT_COMMAND_CENTER_LAYOUT.denseMode,
      workspaceId: parsed.workspaceId ?? DEFAULT_COMMAND_CENTER_LAYOUT.workspaceId,
      panels: {
        summary: parsed.panels?.summary ?? DEFAULT_COMMAND_CENTER_LAYOUT.panels.summary,
        runs: parsed.panels?.runs ?? DEFAULT_COMMAND_CENTER_LAYOUT.panels.runs,
        jobs: parsed.panels?.jobs ?? DEFAULT_COMMAND_CENTER_LAYOUT.panels.jobs,
        attention: parsed.panels?.attention ?? DEFAULT_COMMAND_CENTER_LAYOUT.panels.attention,
        detail: parsed.panels?.detail ?? DEFAULT_COMMAND_CENTER_LAYOUT.panels.detail,
      },
      selectedItem,
      detailPane: {
        width: parsed.detailPane?.width === 'compact' || parsed.detailPane?.width === 'wide'
          ? parsed.detailPane.width
          : DEFAULT_COMMAND_CENTER_LAYOUT.detailPane.width,
      },
    };
  } catch {
    return DEFAULT_COMMAND_CENTER_LAYOUT;
  }
}

export function saveCommandCenterLayout(
  layout: CommandCenterLayout,
  storage: globalThis.Storage | null = getDefaultStorage(),
): void {
  storage?.setItem(COMMAND_CENTER_STORAGE_KEY, JSON.stringify(layout));
}

export function buildTaskMap(tasks: TaskRecord[] | null | undefined): Map<string, TaskRecord> {
  return new Map((tasks ?? []).map((task) => [task.id, task]));
}

export function getTaskTitle(taskMap: Map<string, TaskRecord>, taskId: string): string {
  return taskMap.get(taskId)?.title ?? taskId;
}

export function getTaskProjectId(taskMap: Map<string, TaskRecord>, taskId: string): string | null {
  return taskMap.get(taskId)?.projectId ?? null;
}

export function getWorkspaceOptions(
  runs: RunRecord[] | null | undefined,
  jobs: JobRecord[] | null | undefined,
  tasks: TaskRecord[] | null | undefined,
): string[] {
  const ids = new Set<string>();
  for (const run of runs ?? []) ids.add(run.workspaceId);
  for (const job of jobs ?? []) ids.add(job.workspaceId);
  for (const task of tasks ?? []) ids.add(task.workspaceId);
  return ['all', ...Array.from(ids).sort((a, b) => a.localeCompare(b))];
}

export function isActiveRun(run: RunRecord): boolean {
  return run.state === 'starting' || run.state === 'running';
}

export function isFailedRun(run: RunRecord): boolean {
  return run.state === 'failed_final' || run.state === 'failed_retryable';
}

export function isActiveJob(job: JobRecord): boolean {
  return ['queued', 'leased', 'running', 'waiting_retry', 'paused', 'blocked_operator'].includes(job.status);
}

export function isFailedJob(job: JobRecord): boolean {
  return job.status === 'failed_final';
}

export function filterByWorkspace<T>(items: T[], workspaceId: string, getWorkspaceId: (item: T) => string): T[] {
  if (workspaceId === 'all') return items;
  return items.filter((item) => getWorkspaceId(item) === workspaceId);
}

export function sortByNewest<T>(items: T[], getIso: (item: T) => string): T[] {
  return [...items].sort((left, right) => Date.parse(getIso(right)) - Date.parse(getIso(left)));
}

export function getRunActivity(
  run: RunRecord,
  activityByRunId: Record<string, RunActivityState> = {},
  events: RunEventRecord[] | null | undefined = null,
): RunActivityState {
  const fromStream = activityByRunId[run.id] ?? null;
  const fromEvents = getLatestRunEventActivity(events, run.id);
  if (fromStream && fromEvents) {
    return Date.parse(fromStream.lastActivityAt) >= Date.parse(fromEvents.lastActivityAt)
      ? fromStream
      : fromEvents;
  }
  return fromStream ?? fromEvents ?? {
    lastActivityAt: run.startedAt,
    source: 'fallback_started_at',
  };
}

export function getRunAttention(
  run: RunRecord,
  options: {
    now?: number;
    activity?: RunActivityState | null;
    hasOpenIntervention?: boolean;
    isBlockedOperator?: boolean;
  } = {},
): RunAttentionState {
  if (!isActiveRun(run)) {
    return {
      level: 'none',
      label: null,
      reason: null,
      lastActivityAt: null,
      activitySource: null,
    };
  }

  const activity = options.activity ?? {
    lastActivityAt: run.startedAt,
    source: 'fallback_started_at' as const,
  };
  const now = options.now ?? Date.now();
  const inactivityMs = Math.max(0, now - Date.parse(activity.lastActivityAt));
  const qualifiers = [
    options.hasOpenIntervention ? 'Open intervention also present.' : null,
    options.isBlockedOperator ? 'Job is operator-blocked.' : null,
    activity.source === 'fallback_started_at'
      ? 'No prior run events loaded yet; using start time as fallback.'
      : null,
  ].filter(Boolean);

  if (inactivityMs >= STUCK_RISK_MS) {
    return {
      level: 'stuck-risk',
      label: 'Stuck risk',
      reason: `No observed activity for ${formatDuration(inactivityMs)}. Heuristic only.${qualifiers.length > 0 ? ` ${qualifiers.join(' ')}` : ''}`,
      lastActivityAt: activity.lastActivityAt,
      activitySource: activity.source,
    };
  }
  if (inactivityMs >= IDLE_HINT_MS) {
    return {
      level: 'idle',
      label: 'Idle hint',
      reason: `No observed activity for ${formatDuration(inactivityMs)}. Heuristic only.${qualifiers.length > 0 ? ` ${qualifiers.join(' ')}` : ''}`,
      lastActivityAt: activity.lastActivityAt,
      activitySource: activity.source,
    };
  }

  return {
    level: 'none',
    label: null,
    reason: null,
    lastActivityAt: activity.lastActivityAt,
    activitySource: activity.source,
  };
}

export function getAttentionItems(
  runs: RunRecord[] | null | undefined,
  jobs: JobRecord[] | null | undefined,
  interventions: InterventionRecord[] | null | undefined,
  workspaceId: string,
  activityByRunId: Record<string, RunActivityState> = {},
): {
  attentionRuns: Array<{ run: RunRecord; attention: RunAttentionState }>;
  blockedJobs: JobRecord[];
  failedJobs: JobRecord[];
  openInterventions: InterventionRecord[];
} {
  const filteredRuns = filterByWorkspace(runs ?? [], workspaceId, (run) => run.workspaceId);
  const filteredJobs = filterByWorkspace(jobs ?? [], workspaceId, (job) => job.workspaceId);
  const blockedJobRunIds = new Set(
    filteredJobs
      .filter((job) => job.status === 'blocked_operator' && job.lastRunId)
      .map((job) => job.lastRunId as string),
  );
  const interventionRunIds = new Set(
    (interventions ?? [])
      .filter((intervention) => intervention.status === 'open' && intervention.runId)
      .map((intervention) => intervention.runId as string),
  );
  const attentionRuns = sortByNewest(
    filteredRuns
      .map((run) => ({
        run,
        attention: getRunAttention(run, {
          activity: getRunActivity(run, activityByRunId),
          hasOpenIntervention: interventionRunIds.has(run.id),
          isBlockedOperator: blockedJobRunIds.has(run.id),
        }),
      }))
      .filter((entry) => entry.attention.level !== 'none'),
    (entry) => entry.run.startedAt,
  );
  const blockedJobs = sortByNewest(filteredJobs.filter((job) => job.status === 'blocked_operator'), (job) => job.updatedAt);
  const failedJobs = sortByNewest(filteredJobs.filter(isFailedJob), (job) => job.updatedAt);
  const openInterventions = sortByNewest(
    filterByWorkspace(interventions ?? [], workspaceId, () => workspaceId === 'all' ? 'all' : workspaceId)
      .filter((intervention) => intervention.status === 'open'),
    (intervention) => intervention.createdAt,
  );

  return { attentionRuns, blockedJobs, failedJobs, openInterventions };
}

export function applyStreamEventToRunActivity(
  activityByRunId: Record<string, RunActivityState>,
  envelope: { event: string; data: string },
): Record<string, RunActivityState> {
  const parsed = parseStreamPayload(envelope);
  if (!parsed) return activityByRunId;
  const current = activityByRunId[parsed.runId];
  if (current && Date.parse(current.lastActivityAt) >= Date.parse(parsed.activity.lastActivityAt)) {
    return activityByRunId;
  }
  return {
    ...activityByRunId,
    [parsed.runId]: parsed.activity,
  };
}

export function getLatestRunEventActivity(
  events: RunEventRecord[] | null | undefined,
  runId: string,
): RunActivityState | null {
  const latest = sortByNewest(
    (events ?? []).filter((event) => event.runId === runId),
    (event) => event.createdAt,
  )[0];
  if (!latest) return null;
  return {
    lastActivityAt: latest.createdAt,
    source: 'selected_run_events',
  };
}

export function getRunActivityLabel(source: RunActivitySource | null): string {
  switch (source) {
    case 'run_started':
      return 'Run started';
    case 'run_event':
      return 'Live run event';
    case 'run_completed':
      return 'Run completion';
    case 'selected_run_events':
      return 'Recent run event';
    case 'fallback_started_at':
      return 'Start time fallback';
    default:
      return 'Unknown';
  }
}

export function isPanelStale(updatedAt: string | null | undefined, now = Date.now()): boolean {
  if (!updatedAt) return true;
  return now - Date.parse(updatedAt) > PANEL_STALE_MS;
}

export interface RelatedCommandSnippet {
  label: string;
  command: string;
}

export function buildRelatedCommandSnippets(input: {
  runId?: string | null;
  jobId?: string | null;
  receiptId?: string | null;
  taskTitle?: string | null;
}): RelatedCommandSnippet[] {
  const snippets: RelatedCommandSnippet[] = [];
  if (input.runId) snippets.push({ label: 'Run', command: `pop run show ${shellEscape(input.runId)}` });
  if (input.jobId) snippets.push({ label: 'Jobs', command: 'pop jobs list' });
  if (input.receiptId) snippets.push({ label: 'Receipt', command: `pop receipt show ${shellEscape(input.receiptId)}` });
  snippets.push({ label: 'Runs tail', command: 'pop runs tail' });
  snippets.push({ label: 'Interventions', command: 'pop interventions list' });
  if (input.taskTitle) snippets.push({ label: 'Memory', command: `pop memory search ${shellEscape(input.taskTitle)}` });
  return snippets;
}

export function normalizeSelection(
  selectedItem: SelectedCommandCenterItem,
  runs: RunRecord[] | null | undefined,
  jobs: JobRecord[] | null | undefined,
  interventions: InterventionRecord[] | null | undefined,
): SelectedCommandCenterItem {
  switch (selectedItem.kind) {
    case 'run':
      return (runs ?? []).some((run) => run.id === selectedItem.id)
        ? selectedItem
        : DEFAULT_COMMAND_CENTER_LAYOUT.selectedItem;
    case 'job':
      return (jobs ?? []).some((job) => job.id === selectedItem.id)
        ? selectedItem
        : DEFAULT_COMMAND_CENTER_LAYOUT.selectedItem;
    case 'intervention':
      return (interventions ?? []).some((intervention) => intervention.id === selectedItem.id)
        ? selectedItem
        : DEFAULT_COMMAND_CENTER_LAYOUT.selectedItem;
    default:
      return DEFAULT_COMMAND_CENTER_LAYOUT.selectedItem;
  }
}

function getDefaultStorage(): globalThis.Storage | null {
  return typeof globalThis.window === 'undefined' ? null : globalThis.window.localStorage;
}

function isSelectedCommandCenterItem(value: unknown): value is SelectedCommandCenterItem {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { kind?: string; id?: unknown };
  if (candidate.kind === 'none') return candidate.id === null || typeof candidate.id === 'undefined';
  if (candidate.kind === 'run' || candidate.kind === 'job' || candidate.kind === 'intervention') {
    return typeof candidate.id === 'string' && candidate.id.length > 0;
  }
  return false;
}

function parseStreamPayload(
  envelope: { event: string; data: string },
  receivedAt = new Date().toISOString(),
): { runId: string; activity: RunActivityState } | null {
  const parsed = safeParseJson(envelope.data);
  if (!parsed || typeof parsed !== 'object') return null;
  switch (envelope.event) {
    case 'run_started': {
      const runId = getStringProp(parsed, 'id');
      const startedAt = getStringProp(parsed, 'startedAt') ?? receivedAt;
      if (!runId) return null;
      return { runId, activity: { lastActivityAt: startedAt, source: 'run_started' } };
    }
    case 'run_event': {
      const runId = getStringProp(parsed, 'runId');
      const createdAt = getStringProp(parsed, 'createdAt') ?? receivedAt;
      if (!runId) return null;
      return { runId, activity: { lastActivityAt: createdAt, source: 'run_event' } };
    }
    case 'run_completed': {
      const runId = getStringProp(parsed, 'runId');
      const createdAt = getStringProp(parsed, 'createdAt') ?? receivedAt;
      if (!runId) return null;
      return { runId, activity: { lastActivityAt: createdAt, source: 'run_completed' } };
    }
    default:
      return null;
  }
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getStringProp(value: object, key: string): string | null {
  const candidate = Reflect.get(value, key);
  return typeof candidate === 'string' ? candidate : null;
}

function formatDuration(durationMs: number): string {
  const minutes = Math.max(1, Math.round(durationMs / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`;
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
