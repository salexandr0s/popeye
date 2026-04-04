import { useMemo, useState } from 'react';
import type { OAuthSessionResponse, ConnectionResourceRule } from '@popeye/contracts';
import { useApi } from '../api/provider';
import {
  useCalendarAccounts,
  useConnectionDiagnostics,
  useConnectionResourceRules,
  useConnections,
  useEmailAccounts,
  useGithubAccounts,
  useOAuthProviders,
  useTodoAccounts,
} from '../api/hooks';
import { PageHeader } from '../components/page-header';
import { Loading } from '../components/loading';
import { ErrorDisplay } from '../components/error-display';
import { EmptyState } from '../components/empty-state';
import { DataTable, type Column } from '../components/data-table';
import { Badge } from '../components/badge';
import { Card } from '../components/card';

type OAuthSessionRecord = OAuthSessionResponse;
type OAuthProviderKind = 'gmail' | 'google_calendar' | 'google_tasks' | 'github';

const MANUAL_SYNC_DOMAINS = new Set(['email', 'calendar', 'github', 'todos']);
const OAUTH_PROVIDER_KINDS = new Set<OAuthProviderKind>(['gmail', 'google_calendar', 'google_tasks', 'github']);

function isOAuthProviderKind(value: string): value is OAuthProviderKind {
  return OAUTH_PROVIDER_KINDS.has(value as OAuthProviderKind);
}

export function Connections() {
  const api = useApi();
  const connections = useConnections();
  const emailAccounts = useEmailAccounts();
  const calendarAccounts = useCalendarAccounts();
  const githubAccounts = useGithubAccounts();
  const todoAccounts = useTodoAccounts();
  const oauthProviders = useOAuthProviders();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [ruleType, setRuleType] = useState<string>('resource');
  const [ruleId, setRuleId] = useState('');
  const [ruleName, setRuleName] = useState('');
  const [ruleWrite, setRuleWrite] = useState(false);

  const accountIdsByConnection = useMemo(() => {
    const map = new Map<string, string>();
    for (const account of emailAccounts.data ?? []) map.set(account.connectionId, account.id);
    for (const account of calendarAccounts.data ?? []) map.set(account.connectionId, account.id);
    for (const account of githubAccounts.data ?? []) map.set(account.connectionId, account.id);
    for (const account of todoAccounts.data ?? []) {
      if (account.connectionId) {
        map.set(account.connectionId, account.id);
      }
    }
    return map;
  }, [calendarAccounts.data, emailAccounts.data, githubAccounts.data, todoAccounts.data]);

  const resourceRules = useConnectionResourceRules(selectedConnectionId ?? '');
  const diagnostics = useConnectionDiagnostics(selectedConnectionId ?? '');
  const oauthProvidersByKind = useMemo(
    () => new Map((oauthProviders.data ?? []).map((provider) => [provider.providerKind, provider])),
    [oauthProviders.data],
  );
  const blockedProviders = (oauthProviders.data ?? []).filter((provider) => provider.status !== 'ready');

  if (
    connections.loading ||
    emailAccounts.loading ||
    calendarAccounts.loading ||
    githubAccounts.loading ||
    todoAccounts.loading ||
    oauthProviders.loading
  ) {
    return <Loading />;
  }

  const loadError =
    connections.error ??
    emailAccounts.error ??
    calendarAccounts.error ??
    githubAccounts.error ??
    todoAccounts.error ??
    oauthProviders.error;
  if (loadError) {
    return <ErrorDisplay message={loadError} />;
  }

  const items = connections.data ?? [];

  const refetchAll = () => {
    connections.refetch();
    emailAccounts.refetch();
    calendarAccounts.refetch();
    githubAccounts.refetch();
    todoAccounts.refetch();
    oauthProviders.refetch();
  };

  const pollOAuthSession = async (sessionId: string): Promise<void> => {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
      const latest = await api.get<OAuthSessionRecord>(`/v1/connections/oauth/sessions/${encodeURIComponent(sessionId)}`);
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

  const handleConnect = async (
    providerKind: OAuthProviderKind,
    connectionId?: string,
  ) => {
    const availability = oauthProvidersByKind.get(providerKind);
    if (availability && availability.status !== 'ready') {
      setActionError(availability.details);
      return;
    }

    try {
      setBusyKey(connectionId ? `reconnect:${connectionId}` : `connect:${providerKind}`);
      setActionError(null);
      const session = await api.post<OAuthSessionRecord>('/v1/connections/oauth/start', {
        providerKind,
        mode: providerKind === 'google_tasks' ? 'read_write' : 'read_only',
        syncIntervalSeconds: 900,
        ...(connectionId ? { connectionId } : {}),
      });
      window.open(session.authorizationUrl, '_blank', 'noopener,noreferrer');
      await pollOAuthSession(session.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setBusyKey(null);
    }
  };

  const handleToggleConnection = async (connectionId: string, enabled: boolean) => {
    try {
      setBusyKey(`toggle:${connectionId}`);
      setActionError(null);
      await api.patch(`/v1/connections/${encodeURIComponent(connectionId)}`, { enabled });
      refetchAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Connection update failed');
    } finally {
      setBusyKey(null);
    }
  };

  const handleSync = async (connectionId: string, domain: string) => {
    if (!MANUAL_SYNC_DOMAINS.has(domain)) {
      setActionError(`Manual sync is not available for ${domain} connections from this view`);
      return;
    }

    const accountId = accountIdsByConnection.get(connectionId);
    if (!accountId) {
      setActionError(`No registered account found for connection ${connectionId}`);
      return;
    }

    const path = domain === 'email'
      ? '/v1/email/sync'
      : domain === 'calendar'
        ? '/v1/calendar/sync'
        : domain === 'github'
          ? '/v1/github/sync'
          : '/v1/todos/sync';

    try {
      setBusyKey(`sync:${connectionId}`);
      setActionError(null);
      await api.post(path, { accountId });
      refetchAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setBusyKey(null);
    }
  };

  const selectedConnection = items.find((item) => item.id === selectedConnectionId) ?? null;

  const handleAddRule = async () => {
    if (!selectedConnectionId || !ruleId.trim() || !ruleName.trim()) return;
    try {
      setBusyKey('add-rule');
      setActionError(null);
      await api.post(`/v1/connections/${encodeURIComponent(selectedConnectionId)}/resource-rules`, {
        resourceType: ruleType,
        resourceId: ruleId.trim(),
        displayName: ruleName.trim(),
        writeAllowed: ruleWrite,
      });
      setRuleId('');
      setRuleName('');
      setRuleWrite(false);
      resourceRules.refetch();
      refetchAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Add rule failed');
    } finally {
      setBusyKey(null);
    }
  };

  const handleRemoveRule = async (rule: ConnectionResourceRule) => {
    if (!selectedConnectionId) return;
    try {
      setBusyKey(`remove-rule:${rule.resourceType}:${rule.resourceId}`);
      setActionError(null);
      await api.post(`/v1/connections/${encodeURIComponent(selectedConnectionId)}/resource-rules/delete`, {
        resourceType: rule.resourceType,
        resourceId: rule.resourceId,
      });
      resourceRules.refetch();
      refetchAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Remove rule failed');
    } finally {
      setBusyKey(null);
    }
  };

  const handleReconnect = async () => {
    if (!selectedConnectionId) return;
    try {
      setBusyKey('reconnect-diag');
      setActionError(null);
      await api.post(`/v1/connections/${encodeURIComponent(selectedConnectionId)}/reconnect`, {
        action: 'reconnect',
      });
      diagnostics.refetch();
      refetchAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Reconnect failed');
    } finally {
      setBusyKey(null);
    }
  };

  const columns: Column<(typeof items)[number]>[] = [
    {
      key: 'label',
      header: 'Connection',
      render: (row) => (
        <div>
          <p className="font-medium">{row.label}</p>
          <p className="text-[12px] text-[var(--color-fg-muted)]">{row.providerKind}</p>
        </div>
      ),
    },
    {
      key: 'domain',
      header: 'Domain',
      render: (row) => row.domain,
    },
    {
      key: 'policy',
      header: 'Policy',
      render: (row) => (
        <div>
          <Badge state={row.policy?.status ?? 'ready'} />
          <p className="mt-[6px] text-[12px] text-[var(--color-fg-muted)]">
            secret: {row.policy?.secretStatus ?? 'unknown'}
          </p>
        </div>
      ),
    },
    {
      key: 'health',
      header: 'Health',
      render: (row) => (
        <div>
          <Badge state={row.health?.status ?? 'unknown'} />
          <p className="mt-[6px] text-[12px] text-[var(--color-fg-muted)]">
            auth: {row.health?.authState ?? 'unknown'}
          </p>
          {row.health?.remediation ? (
            <p className="mt-[6px] text-[12px] text-[var(--color-fg-muted)]">
              next: {row.health.remediation.action}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'sync',
      header: 'Sync',
      render: (row) => (
        <div>
          <p>{row.sync?.status ?? 'idle'}</p>
          <p className="text-[12px] text-[var(--color-fg-muted)]">
            {row.sync?.lagSummary || 'No sync summary yet'}
          </p>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '240px',
      render: (row) => {
        const oauthProviderKind = isOAuthProviderKind(row.providerKind) ? row.providerKind : null;
        const oauthAvailability = oauthProviderKind ? oauthProvidersByKind.get(oauthProviderKind) : undefined;

        return (
          <div className="flex flex-wrap gap-[8px]">
            {MANUAL_SYNC_DOMAINS.has(row.domain) ? (
              <button
                className="rounded-[var(--radius-sm)] bg-[var(--color-accent)]/10 px-[10px] py-[6px] text-[12px] font-medium text-[var(--color-accent)]"
                onClick={() => void handleSync(row.id, row.domain)}
                type="button"
              >
                {busyKey === `sync:${row.id}` ? 'Syncing…' : 'Sync'}
              </button>
            ) : null}
            {oauthProviderKind ? (
              row.health?.remediation ? (
                oauthAvailability && oauthAvailability.status !== 'ready' ? (
                  <p className="w-full text-[12px] text-[var(--color-fg-muted)]">
                    {oauthAvailability.details}
                  </p>
                ) : (
                  <button
                    className="rounded-[var(--radius-sm)] bg-[var(--color-fg)]/[0.06] px-[10px] py-[6px] text-[12px] font-medium text-[var(--color-fg)]"
                    onClick={() => void handleConnect(oauthProviderKind, row.id)}
                    type="button"
                  >
                    {busyKey === `reconnect:${row.id}` ? 'Opening…' : 'Reconnect'}
                  </button>
                )
              ) : null
            ) : null}
            <button
              className="rounded-[var(--radius-sm)] bg-[var(--color-fg)]/[0.06] px-[10px] py-[6px] text-[12px] font-medium text-[var(--color-fg)]"
              onClick={() => void handleToggleConnection(row.id, !row.enabled)}
              type="button"
            >
              {busyKey === `toggle:${row.id}` ? 'Saving…' : row.enabled ? 'Disable' : 'Enable'}
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Connections"
        description="Start blessed provider OAuth flows, inspect health and sync rollups, and trigger manual syncs."
      />

      <div className="mb-[24px] grid gap-[16px] md:grid-cols-3">
        <Card label="Connections" value={items.length} description="Configured provider links" />
        <Card
          label="Healthy"
          value={items.filter((item) => item.health?.status === 'healthy').length}
          description="Connections ready for normal operation"
        />
        <Card
          label="Reauth Required"
          value={items.filter((item) => item.health?.status === 'reauth_required').length}
          description="Operator intervention required"
        />
      </div>

      <div className="mb-[24px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
        <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Connect Blessed Providers</h2>
        <p className="mt-[4px] text-[14px] text-[var(--color-fg-muted)]">
          Browser OAuth is the blessed path for Gmail, Google Calendar, Google Tasks, and GitHub.
        </p>
        <div className="mt-[16px] flex flex-wrap gap-[12px]">
          {renderConnectButton('gmail', 'Gmail', busyKey, oauthProvidersByKind, handleConnect)}
          {renderConnectButton('google_calendar', 'Google Calendar', busyKey, oauthProvidersByKind, handleConnect)}
          {renderConnectButton('google_tasks', 'Google Tasks', busyKey, oauthProvidersByKind, handleConnect)}
          {renderConnectButton('github', 'GitHub', busyKey, oauthProvidersByKind, handleConnect)}
        </div>
        {blockedProviders.length > 0 ? (
          <div className="mt-[12px] space-y-[6px]">
            {blockedProviders.map((provider) => (
              <p key={provider.providerKind} className="text-[13px] text-[var(--color-fg-muted)]">
                {formatProviderLabel(provider.providerKind)}: {provider.details}
              </p>
            ))}
          </div>
        ) : null}
        <p className="mt-[12px] text-[13px] text-[var(--color-fg-muted)]">
          Google Tasks maps task lists to Popeye projects. Native priorities, labels, and due times are not supported.
        </p>
      </div>

      {actionError ? (
        <div className="mb-[16px]">
          <ErrorDisplay message={actionError} />
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          title="No connections yet"
          description="Start with one of the blessed browser OAuth flows above."
        />
      ) : (
        <DataTable
          columns={columns}
          data={items}
          keyFn={(row) => row.id}
          onRowClick={(row) => setSelectedConnectionId(row.id === selectedConnectionId ? null : row.id)}
        />
      )}

      {selectedConnection ? (
        <div className="mt-[24px] grid gap-[24px] md:grid-cols-2">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
            <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Resource Rules</h2>
            <p className="mt-[4px] text-[14px] text-[var(--color-fg-muted)]">
              Scoped resources for {selectedConnection.label}
            </p>
            <div className="mt-[16px] space-y-[8px]">
              {(resourceRules.data ?? selectedConnection.resourceRules ?? []).length === 0 ? (
                <p className="text-[14px] text-[var(--color-fg-muted)]">No resource rules configured.</p>
              ) : (resourceRules.data ?? selectedConnection.resourceRules ?? []).map((rule: ConnectionResourceRule) => (
                <div key={`${rule.resourceType}:${rule.resourceId}`} className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[10px]">
                  <div>
                    <p className="font-medium">{rule.displayName}</p>
                    <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">
                      {rule.resourceType} / {rule.resourceId}
                    </p>
                  </div>
                  <div className="flex items-center gap-[8px]">
                    {rule.writeAllowed ? (
                      <Badge state="ready" />
                    ) : (
                      <span className="text-[12px] text-[var(--color-fg-muted)]">read-only</span>
                    )}
                    <button
                      className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[10px] py-[6px] text-[12px] font-medium"
                      onClick={() => void handleRemoveRule(rule)}
                      type="button"
                    >
                      {busyKey === `remove-rule:${rule.resourceType}:${rule.resourceId}` ? 'Removing…' : 'Remove'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-[16px] grid gap-[12px]">
              <p className="text-[12px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">Add Rule</p>
              <select
                className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px]"
                onChange={(event) => setRuleType(event.target.value)}
                value={ruleType}
              >
                <option value="resource">resource</option>
                <option value="mailbox">mailbox</option>
                <option value="calendar">calendar</option>
                <option value="repo">repo</option>
                <option value="project">project</option>
              </select>
              <input
                className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px]"
                onChange={(event) => setRuleId(event.target.value)}
                placeholder="Resource ID"
                value={ruleId}
              />
              <input
                className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px]"
                onChange={(event) => setRuleName(event.target.value)}
                placeholder="Display name"
                value={ruleName}
              />
              <label className="flex items-center gap-[8px] text-[13px]">
                <input
                  checked={ruleWrite}
                  onChange={(event) => setRuleWrite(event.target.checked)}
                  type="checkbox"
                />
                <span>Write allowed</span>
              </label>
              <button
                className="w-fit rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[14px] py-[8px] text-[13px] font-medium text-white"
                disabled={!ruleId.trim() || !ruleName.trim()}
                onClick={() => void handleAddRule()}
                type="button"
              >
                {busyKey === 'add-rule' ? 'Adding…' : 'Add Rule'}
              </button>
            </div>
          </div>

          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
            <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Diagnostics</h2>
            <p className="mt-[4px] text-[14px] text-[var(--color-fg-muted)]">
              Health and sync details for {selectedConnection.label}
            </p>
            <div className="mt-[16px] space-y-[12px]">
              <div>
                <p className="text-[12px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">Health</p>
                <div className="mt-[8px]">
                  <Badge state={diagnostics.data?.health?.status ?? selectedConnection.health?.status ?? 'unknown'} />
                </div>
              </div>
              <div>
                <p className="text-[12px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">Sync Status</p>
                <p className="mt-[8px] text-[14px]">
                  {diagnostics.data?.sync?.status ?? selectedConnection.sync?.status ?? 'idle'}
                </p>
                <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">
                  {diagnostics.data?.sync?.lagSummary ?? selectedConnection.sync?.lagSummary ?? 'No sync summary'}
                </p>
              </div>
              {diagnostics.data?.humanSummary ? (
                <div>
                  <p className="text-[12px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">Summary</p>
                  <p className="mt-[8px] text-[14px]">{diagnostics.data.humanSummary}</p>
                </div>
              ) : null}
              <button
                className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[14px] py-[8px] text-[13px] font-medium text-white"
                onClick={() => void handleReconnect()}
                type="button"
              >
                {busyKey === 'reconnect-diag' ? 'Reconnecting…' : 'Reconnect'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function renderConnectButton(
  providerKind: OAuthProviderKind,
  label: string,
  busyKey: string | null,
  providersByKind: Map<string, { status: string }>,
  handleConnect: (providerKind: OAuthProviderKind, connectionId?: string) => Promise<void>,
) {
  const isReady = providersByKind.get(providerKind)?.status === 'ready' || !providersByKind.get(providerKind);

  return (
    <button
      className={`rounded-[var(--radius-sm)] px-[14px] py-[8px] text-[13px] font-medium ${
        isReady
          ? 'bg-[var(--color-accent)] text-white'
          : 'bg-[var(--color-fg)]/[0.06] text-[var(--color-fg-muted)]'
      }`}
      disabled={!isReady}
      onClick={() => void handleConnect(providerKind)}
      type="button"
    >
      {busyKey === `connect:${providerKind}` ? `Connecting ${label}…` : `Connect ${label}`}
    </button>
  );
}

function formatProviderLabel(providerKind: string): string {
  switch (providerKind) {
    case 'gmail':
      return 'Gmail';
    case 'google_calendar':
      return 'Google Calendar';
    case 'google_tasks':
      return 'Google Tasks';
    case 'github':
      return 'GitHub';
    default:
      return providerKind;
  }
}
