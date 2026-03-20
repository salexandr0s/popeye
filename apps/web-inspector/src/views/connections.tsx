import { useMemo, useState } from 'react';
import type { OAuthSessionResponse } from '@popeye/contracts';
import { useApi } from '../api/provider';
import { useCalendarAccounts, useConnections, useEmailAccounts, useGithubAccounts } from '../api/hooks';
import { PageHeader } from '../components/page-header';
import { Loading } from '../components/loading';
import { ErrorDisplay } from '../components/error-display';
import { EmptyState } from '../components/empty-state';
import { DataTable, type Column } from '../components/data-table';
import { Badge } from '../components/badge';
import { Card } from '../components/card';

type OAuthSessionRecord = OAuthSessionResponse;

const MANUAL_SYNC_DOMAINS = new Set(['email', 'calendar', 'github']);

export function Connections() {
  const api = useApi();
  const connections = useConnections();
  const emailAccounts = useEmailAccounts();
  const calendarAccounts = useCalendarAccounts();
  const githubAccounts = useGithubAccounts();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const accountIdsByConnection = useMemo(() => {
    const map = new Map<string, string>();
    for (const account of emailAccounts.data ?? []) map.set(account.connectionId, account.id);
    for (const account of calendarAccounts.data ?? []) map.set(account.connectionId, account.id);
    for (const account of githubAccounts.data ?? []) map.set(account.connectionId, account.id);
    return map;
  }, [calendarAccounts.data, emailAccounts.data, githubAccounts.data]);

  if (connections.loading || emailAccounts.loading || calendarAccounts.loading || githubAccounts.loading) {
    return <Loading />;
  }

  const loadError = connections.error ?? emailAccounts.error ?? calendarAccounts.error ?? githubAccounts.error;
  if (loadError) {
    return <ErrorDisplay message={loadError} />;
  }

  const items = connections.data ?? [];

  const refetchAll = () => {
    connections.refetch();
    emailAccounts.refetch();
    calendarAccounts.refetch();
    githubAccounts.refetch();
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

  const handleConnect = async (providerKind: 'gmail' | 'google_calendar' | 'github') => {
    try {
      setBusyKey(`connect:${providerKind}`);
      setActionError(null);
      const session = await api.post<OAuthSessionRecord>('/v1/connections/oauth/start', {
        providerKind,
        mode: 'read_only',
        syncIntervalSeconds: 900,
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
        : '/v1/github/sync';

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
      render: (row) => (
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
          <button
            className="rounded-[var(--radius-sm)] bg-[var(--color-fg)]/[0.06] px-[10px] py-[6px] text-[12px] font-medium text-[var(--color-fg)]"
            onClick={() => void handleToggleConnection(row.id, !row.enabled)}
            type="button"
          >
            {busyKey === `toggle:${row.id}` ? 'Saving…' : row.enabled ? 'Disable' : 'Enable'}
          </button>
        </div>
      ),
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
          Browser OAuth is the blessed path for Gmail, Google Calendar, and GitHub in this tranche.
        </p>
        <div className="mt-[16px] flex flex-wrap gap-[12px]">
          <button
            className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[14px] py-[8px] text-[13px] font-medium text-white"
            onClick={() => void handleConnect('gmail')}
            type="button"
          >
            {busyKey === 'connect:gmail' ? 'Connecting Gmail…' : 'Connect Gmail'}
          </button>
          <button
            className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[14px] py-[8px] text-[13px] font-medium text-white"
            onClick={() => void handleConnect('google_calendar')}
            type="button"
          >
            {busyKey === 'connect:google_calendar' ? 'Connecting Calendar…' : 'Connect Google Calendar'}
          </button>
          <button
            className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[14px] py-[8px] text-[13px] font-medium text-white"
            onClick={() => void handleConnect('github')}
            type="button"
          >
            {busyKey === 'connect:github' ? 'Connecting GitHub…' : 'Connect GitHub'}
          </button>
        </div>
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
        <DataTable columns={columns} data={items} keyFn={(row) => row.id} />
      )}
    </div>
  );
}
