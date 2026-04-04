import { useMemo, useState } from 'react';
import type { OAuthSessionResponse } from '@popeye/contracts';
import { useApi } from '../api/provider';
import { useConnections, useOAuthProviders, useTodoAccounts, useTodoProjects } from '../api/hooks';
import { PageHeader } from '../components/page-header';
import { Loading } from '../components/loading';
import { ErrorDisplay } from '../components/error-display';
import { EmptyState } from '../components/empty-state';
import { Card } from '../components/card';

interface TodoSearchResponse {
  query: string;
  results: Array<{
    todoId: string;
    title: string;
    priority: number;
    status: string;
    dueDate: string | null;
    projectName: string | null;
    score: number;
  }>;
}

interface TodoItemRecord {
  id: string;
  accountId: string;
  title: string;
  description: string;
  priority: number;
  status: string;
  dueDate: string | null;
  dueTime: string | null;
  labels: string[];
  projectId: string | null;
  projectName: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TodoDigestRecord {
  id: string;
  accountId: string;
  date: string;
  pendingCount: number;
  overdueCount: number;
  completedTodayCount: number;
  summaryMarkdown: string;
  generatedAt: string;
}

export function Todos() {
  const api = useApi();
  const accounts = useTodoAccounts();
  const connections = useConnections('todos');
  const oauthProviders = useOAuthProviders();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<TodoSearchResponse['results']>([]);
  const [todos, setTodos] = useState<TodoItemRecord[]>([]);
  const [digest, setDigest] = useState<TodoDigestRecord | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [projectFilter, setProjectFilter] = useState<string>('');
  const [reprioritizeId, setReprioritizeId] = useState<string | null>(null);
  const [reprioritizeValue, setReprioritizeValue] = useState<string>('4');
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [moveId, setMoveId] = useState<string | null>(null);
  const [moveProject, setMoveProject] = useState('');

  const account = accounts.data?.[0] ?? null;
  const connection = useMemo(
    () => connections.data?.find((item) => item.id === account?.connectionId) ?? null,
    [account?.connectionId, connections.data],
  );
  const projects = useTodoProjects(account?.id ?? '');
  const supportsReprioritize = account?.providerKind !== 'google_tasks';
  const googleTasksAvailability = useMemo(
    () => oauthProviders.data?.find((provider) => provider.providerKind === 'google_tasks') ?? null,
    [oauthProviders.data],
  );
  const googleTasksReady = googleTasksAvailability?.status === 'ready' || googleTasksAvailability == null;

  if (accounts.loading || connections.loading || oauthProviders.loading) return <Loading />;
  if (accounts.error || connections.error || oauthProviders.error) {
    return <ErrorDisplay message={accounts.error ?? connections.error ?? oauthProviders.error ?? 'Unknown error'} />;
  }

  const refetchAll = () => {
    accounts.refetch();
    connections.refetch();
    oauthProviders.refetch();
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    try {
      setBusyAction('search');
      setActionError(null);
      const response = await api.get<TodoSearchResponse>(
        `/v1/todos/search?query=${encodeURIComponent(query)}${account ? `&accountId=${encodeURIComponent(account.id)}` : ''}&status=${statusFilter || 'all'}`,
      );
      setSearchResults(response.results);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Todo search failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleLoadTodos = async () => {
    if (!account) return;
    try {
      setBusyAction('load');
      setActionError(null);
      const params = new URLSearchParams();
      params.set('accountId', account.id);
      if (statusFilter) params.set('status', statusFilter);
      if (priorityFilter) params.set('priority', priorityFilter);
      if (projectFilter) params.set('project', projectFilter);
      const result = await api.get<TodoItemRecord[]>(`/v1/todos/items?${params.toString()}`);
      setTodos(result);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to load todos');
    } finally {
      setBusyAction(null);
    }
  };

  const handleComplete = async (todoId: string) => {
    try {
      setBusyAction(`complete:${todoId}`);
      setActionError(null);
      await api.post(`/v1/todos/items/${encodeURIComponent(todoId)}/complete`);
      await handleLoadTodos();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Complete failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleReprioritize = async (todoId: string) => {
    try {
      setBusyAction(`reprioritize:${todoId}`);
      setActionError(null);
      await api.post(`/v1/todos/items/${encodeURIComponent(todoId)}/reprioritize`, {
        priority: Number(reprioritizeValue),
      });
      setReprioritizeId(null);
      await handleLoadTodos();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Reprioritize failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleReschedule = async (todoId: string) => {
    if (!rescheduleDate.trim()) return;
    try {
      setBusyAction(`reschedule:${todoId}`);
      setActionError(null);
      await api.post(`/v1/todos/items/${encodeURIComponent(todoId)}/reschedule`, {
        dueDate: rescheduleDate.trim(),
      });
      setRescheduleId(null);
      setRescheduleDate('');
      await handleLoadTodos();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Reschedule failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleMove = async (todoId: string) => {
    if (!moveProject.trim()) return;
    try {
      setBusyAction(`move:${todoId}`);
      setActionError(null);
      await api.post(`/v1/todos/items/${encodeURIComponent(todoId)}/move`, {
        projectName: moveProject.trim(),
      });
      setMoveId(null);
      setMoveProject('');
      await handleLoadTodos();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Move failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSync = async () => {
    if (!account) return;
    try {
      setBusyAction('sync');
      setActionError(null);
      await api.post('/v1/todos/sync', { accountId: account.id });
      refetchAll();
      await handleLoadTodos();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Sync failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleReconcile = async () => {
    if (!account) return;
    try {
      setBusyAction('reconcile');
      setActionError(null);
      await api.post('/v1/todos/reconcile', { accountId: account.id });
      refetchAll();
      await handleLoadTodos();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Reconcile failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleGenerateDigest = async () => {
    if (!account) return;
    try {
      setBusyAction('digest');
      setActionError(null);
      const result = await api.post<TodoDigestRecord>('/v1/todos/digest', { accountId: account.id });
      setDigest(result);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Digest generation failed');
    } finally {
      setBusyAction(null);
    }
  };

  const pollOAuthSession = async (sessionId: string): Promise<void> => {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
      const latest = await api.get<OAuthSessionResponse>(`/v1/connections/oauth/sessions/${encodeURIComponent(sessionId)}`);
      if (latest.status === 'pending') {
        continue;
      }
      if (latest.status === 'completed') {
        refetchAll();
        return;
      }
      throw new Error(latest.error ?? `OAuth session ${latest.status}`);
    }
    throw new Error('OAuth connection timed out');
  };

  const handleGoogleTasksConnect = async () => {
    if (!googleTasksReady) {
      setActionError(googleTasksAvailability?.details ?? 'Google Tasks OAuth is not configured.');
      return;
    }

    try {
      setBusyAction('connect');
      setActionError(null);
      const session = await api.post<OAuthSessionResponse>('/v1/connections/oauth/start', {
        providerKind: 'google_tasks',
        mode: 'read_write',
        syncIntervalSeconds: 900,
      });
      window.open(session.authorizationUrl, '_blank', 'noopener,noreferrer');
      await pollOAuthSession(session.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Google Tasks connection failed');
    } finally {
      setBusyAction(null);
    }
  };

  if (!account) {
    return (
      <>
        <PageHeader
          title="Todos"
          description="Task management with Google Tasks sync, project mapping, and digest views."
        />
        <div className="mb-[24px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
          <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Connect Google Tasks</h2>
          <p className="mt-[4px] text-[14px] text-[var(--color-fg-muted)]">
            Browser OAuth is the blessed path. Task lists map to projects; priorities, labels, and due times are unsupported.
          </p>
          {actionError ? (
            <div className="mt-[12px]">
              <ErrorDisplay message={actionError} />
            </div>
          ) : null}
          {googleTasksReady ? null : (
            <p className="mt-[12px] text-[13px] text-[var(--color-fg-muted)]">
              {googleTasksAvailability?.details}
            </p>
          )}
          <div className="mt-[16px] flex gap-[12px]">
            <button
              className={`rounded-[var(--radius-sm)] px-[14px] py-[8px] text-[13px] font-medium ${
                googleTasksReady
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'bg-[var(--color-fg)]/[0.06] text-[var(--color-fg-muted)]'
              }`}
              disabled={!googleTasksReady}
              onClick={() => void handleGoogleTasksConnect()}
              type="button"
            >
              {busyAction === 'connect' ? 'Connecting…' : 'Connect Google Tasks'}
            </button>
          </div>
        </div>
        <EmptyState
          title="No todo accounts"
          description="Connect Google Tasks to start managing synced task lists."
        />
      </>
    );
  }

  return (
    <div>
      <PageHeader
        title="Todos"
        description="Task management with Google Tasks sync, project mapping, and digest views."
      />

      <div className="mb-[24px] grid gap-[16px] md:grid-cols-3">
        <Card label="Account" value={account.displayName} description={`${account.providerKind} · ${account.todoCount} todos`} />
        <Card
          label="Connection"
          value={connection?.health?.status ?? 'unknown'}
          description={connection?.label ?? 'No connection'}
        />
        <Card
          label="Last Sync"
          value={account.lastSyncAt ? new Date(account.lastSyncAt).toLocaleString() : 'Never'}
          description="Most recent sync timestamp"
        />
      </div>

      {actionError ? (
        <div className="mb-[16px]">
          <ErrorDisplay message={actionError} />
        </div>
      ) : null}

      <div className="mb-[24px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
        <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Search Todos</h2>
        <div className="mt-[12px] flex gap-[12px]">
          <input
            className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px]"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by title or description"
            value={query}
          />
          <button
            className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[14px] py-[8px] text-[13px] font-medium text-white"
            onClick={() => void handleSearch()}
            type="button"
          >
            {busyAction === 'search' ? 'Searching…' : 'Search'}
          </button>
        </div>
        <div className="mt-[16px] space-y-[8px]">
          {searchResults.length === 0 ? (
            <p className="text-[14px] text-[var(--color-fg-muted)]">Run a search to find todos.</p>
          ) : searchResults.map((result) => (
            <div
              key={result.todoId}
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[12px]"
            >
              <p className="font-medium">{result.title}</p>
              <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">
                P{result.priority} · {result.status}{result.dueDate ? ` · due ${result.dueDate}` : ''}{result.projectName ? ` · ${result.projectName}` : ''} · score {result.score}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-[24px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
        {account.providerKind === 'google_tasks' ? (
          <p className="mb-[12px] text-[13px] text-[var(--color-fg-muted)]">
            Google Tasks maps task lists to projects. Native priorities and labels are unsupported; due dates are date-only.
          </p>
        ) : null}
        <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Todo List</h2>
        <div className="mt-[12px] flex flex-wrap gap-[12px]">
          <select
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px] text-[13px]"
            onChange={(event) => setStatusFilter(event.target.value)}
            value={statusFilter}
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px] text-[13px]"
            onChange={(event) => setPriorityFilter(event.target.value)}
            value={priorityFilter}
          >
            <option value="">All priorities</option>
            <option value="1">P1 (Urgent)</option>
            <option value="2">P2 (High)</option>
            <option value="3">P3 (Medium)</option>
            <option value="4">P4 (Low)</option>
          </select>
          <input
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px] text-[13px]"
            onChange={(event) => setProjectFilter(event.target.value)}
            placeholder="Project filter"
            value={projectFilter}
          />
          <button
            className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[14px] py-[8px] text-[13px] font-medium text-white"
            onClick={() => void handleLoadTodos()}
            type="button"
          >
            {busyAction === 'load' ? 'Loading…' : 'Load'}
          </button>
        </div>
        <div className="mt-[16px] space-y-[8px]">
          {todos.length === 0 ? (
            <p className="text-[14px] text-[var(--color-fg-muted)]">No todos loaded. Apply filters and click Load.</p>
          ) : todos.map((todo) => (
            <div key={todo.id} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[12px]">
              <div className="flex items-start justify-between gap-[12px]">
                <div>
                  <p className="font-medium">{todo.title}</p>
                  <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">
                    P{todo.priority} · {todo.status}{todo.dueDate ? ` · due ${todo.dueDate}` : ''}{todo.projectName ? ` · ${todo.projectName}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-[8px]">
                  {todo.status === 'pending' ? (
                    <button
                      className="rounded-[var(--radius-sm)] bg-[var(--color-accent)]/10 px-[10px] py-[6px] text-[12px] font-medium text-[var(--color-accent)]"
                      onClick={() => void handleComplete(todo.id)}
                      type="button"
                    >
                      {busyAction === `complete:${todo.id}` ? 'Completing…' : 'Complete'}
                    </button>
                  ) : null}
                  {supportsReprioritize ? (
                    <button
                      className="rounded-[var(--radius-sm)] bg-[var(--color-fg)]/[0.06] px-[10px] py-[6px] text-[12px] font-medium text-[var(--color-fg)]"
                      onClick={() => setReprioritizeId(reprioritizeId === todo.id ? null : todo.id)}
                      type="button"
                    >
                      Reprioritize
                    </button>
                  ) : null}
                  <button
                    className="rounded-[var(--radius-sm)] bg-[var(--color-fg)]/[0.06] px-[10px] py-[6px] text-[12px] font-medium text-[var(--color-fg)]"
                    onClick={() => setRescheduleId(rescheduleId === todo.id ? null : todo.id)}
                    type="button"
                  >
                    Reschedule
                  </button>
                  <button
                    className="rounded-[var(--radius-sm)] bg-[var(--color-fg)]/[0.06] px-[10px] py-[6px] text-[12px] font-medium text-[var(--color-fg)]"
                    onClick={() => setMoveId(moveId === todo.id ? null : todo.id)}
                    type="button"
                  >
                    Move
                  </button>
                </div>
              </div>
              {reprioritizeId === todo.id ? (
                <div className="mt-[12px] flex gap-[8px]">
                  <select
                    className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[6px] text-[13px]"
                    onChange={(event) => setReprioritizeValue(event.target.value)}
                    value={reprioritizeValue}
                  >
                    <option value="1">P1 (Urgent)</option>
                    <option value="2">P2 (High)</option>
                    <option value="3">P3 (Medium)</option>
                    <option value="4">P4 (Low)</option>
                  </select>
                  <button
                    className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[10px] py-[6px] text-[12px] font-medium text-white"
                    onClick={() => void handleReprioritize(todo.id)}
                    type="button"
                  >
                    {busyAction === `reprioritize:${todo.id}` ? 'Saving…' : 'Apply'}
                  </button>
                </div>
              ) : null}
              {rescheduleId === todo.id ? (
                <div className="mt-[12px] flex gap-[8px]">
                  <input
                    className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[6px] text-[13px]"
                    onChange={(event) => setRescheduleDate(event.target.value)}
                    placeholder="YYYY-MM-DD"
                    type="date"
                    value={rescheduleDate}
                  />
                  <button
                    className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[10px] py-[6px] text-[12px] font-medium text-white"
                    disabled={!rescheduleDate.trim()}
                    onClick={() => void handleReschedule(todo.id)}
                    type="button"
                  >
                    {busyAction === `reschedule:${todo.id}` ? 'Saving…' : 'Apply'}
                  </button>
                </div>
              ) : null}
              {moveId === todo.id ? (
                <div className="mt-[12px] flex gap-[8px]">
                  <input
                    className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[6px] text-[13px]"
                    onChange={(event) => setMoveProject(event.target.value)}
                    placeholder="Project name"
                    value={moveProject}
                  />
                  <button
                    className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[10px] py-[6px] text-[12px] font-medium text-white"
                    disabled={!moveProject.trim()}
                    onClick={() => void handleMove(todo.id)}
                    type="button"
                  >
                    {busyAction === `move:${todo.id}` ? 'Saving…' : 'Apply'}
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="mb-[24px] flex flex-wrap gap-[12px]">
        <button
          className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[14px] py-[8px] text-[13px] font-medium text-white"
          onClick={() => void handleSync()}
          type="button"
        >
          {busyAction === 'sync' ? 'Syncing…' : 'Sync'}
        </button>
        <button
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[14px] py-[8px] text-[13px] font-medium"
          onClick={() => void handleReconcile()}
          type="button"
        >
          {busyAction === 'reconcile' ? 'Reconciling…' : 'Reconcile'}
        </button>
        <button
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[14px] py-[8px] text-[13px] font-medium"
          onClick={() => void handleGenerateDigest()}
          type="button"
        >
          {busyAction === 'digest' ? 'Generating…' : 'Generate Digest'}
        </button>
      </div>

      <div className="grid gap-[24px] md:grid-cols-2">
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
          <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Projects</h2>
          <div className="mt-[12px] space-y-[8px]">
            {projects.loading ? (
              <p className="text-[14px] text-[var(--color-fg-muted)]">Loading projects...</p>
            ) : (projects.data ?? []).length === 0 ? (
              <p className="text-[14px] text-[var(--color-fg-muted)]">No projects found.</p>
            ) : (projects.data ?? []).map((project) => (
              <div key={project.id} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[10px]">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{project.name}</p>
                  <span className="text-[12px] text-[var(--color-fg-muted)]">{project.todoCount} todos</span>
                </div>
                {project.color ? (
                  <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">color: {project.color}</p>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
          <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Digest</h2>
          {digest ? (
            <div className="mt-[12px] space-y-[8px]">
              <div className="grid grid-cols-3 gap-[8px]">
                <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[10px] text-center">
                  <p className="text-[20px] font-semibold">{digest.pendingCount}</p>
                  <p className="text-[12px] text-[var(--color-fg-muted)]">Pending</p>
                </div>
                <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[10px] text-center">
                  <p className="text-[20px] font-semibold">{digest.overdueCount}</p>
                  <p className="text-[12px] text-[var(--color-fg-muted)]">Overdue</p>
                </div>
                <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[10px] text-center">
                  <p className="text-[20px] font-semibold">{digest.completedTodayCount}</p>
                  <p className="text-[12px] text-[var(--color-fg-muted)]">Completed</p>
                </div>
              </div>
              <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[12px]">
                <pre className="whitespace-pre-wrap text-[13px]">{digest.summaryMarkdown}</pre>
              </div>
              <p className="text-[12px] text-[var(--color-fg-muted)]">
                Generated {new Date(digest.generatedAt).toLocaleString()}
              </p>
            </div>
          ) : (
            <p className="mt-[12px] text-[14px] text-[var(--color-fg-muted)]">
              Click &quot;Generate Digest&quot; to create a task summary.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
