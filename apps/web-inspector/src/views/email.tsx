import { useMemo, useState } from 'react';
import { useApi } from '../api/provider';
import { useConnections, useEmailAccounts } from '../api/hooks';
import { PageHeader } from '../components/page-header';
import { Loading } from '../components/loading';
import { ErrorDisplay } from '../components/error-display';
import { EmptyState } from '../components/empty-state';
import { Card } from '../components/card';

interface EmailSearchResponse {
  query: string;
  results: Array<{
    threadId: string;
    subject: string;
    snippet: string;
    from: string;
    lastMessageAt: string;
    score: number;
  }>;
}

interface EmailDigestRecord {
  summaryMarkdown: string;
  unreadCount: number;
  highSignalCount: number;
}

interface EmailDraftRecord {
  providerDraftId: string;
  subject: string;
  bodyPreview: string;
}

export function Email() {
  const api = useApi();
  const accounts = useEmailAccounts();
  const connections = useConnections('email');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<EmailSearchResponse['results']>([]);
  const [digest, setDigest] = useState<EmailDigestRecord | null>(null);
  const [draftTo, setDraftTo] = useState('');
  const [draftSubject, setDraftSubject] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draft, setDraft] = useState<EmailDraftRecord | null>(null);

  const account = accounts.data?.[0] ?? null;
  const connection = useMemo(
    () => connections.data?.find((item) => item.id === account?.connectionId) ?? null,
    [account?.connectionId, connections.data],
  );

  if (accounts.loading || connections.loading) return <Loading />;
  if (accounts.error || connections.error) return <ErrorDisplay message={accounts.error ?? connections.error ?? 'Unknown error'} />;

  const refetchAll = () => {
    accounts.refetch();
    connections.refetch();
  };

  const handleSync = async () => {
    if (!account) return;
    try {
      setBusyAction('sync');
      setActionError(null);
      await api.post('/v1/email/sync', { accountId: account.id });
      refetchAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Email sync failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleLoadDigest = async () => {
    if (!account) return;
    try {
      setBusyAction('digest');
      setActionError(null);
      const response = await api.post<EmailDigestRecord | null>('/v1/email/digest', { accountId: account.id });
      setDigest(response);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Email digest failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSearch = async () => {
    if (!account || query.trim().length === 0) return;
    try {
      setBusyAction('search');
      setActionError(null);
      const response = await api.get<EmailSearchResponse>(
        `/v1/email/search?query=${encodeURIComponent(query)}&accountId=${encodeURIComponent(account.id)}`,
      );
      setSearchResults(response.results);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Email search failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreateDraft = async () => {
    if (!account) return;
    try {
      setBusyAction('draft');
      setActionError(null);
      const response = await api.post<EmailDraftRecord>('/v1/email/drafts', {
        accountId: account.id,
        to: draftTo.split(',').map((value) => value.trim()).filter(Boolean),
        subject: draftSubject,
        body: draftBody,
      });
      setDraft(response);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Draft creation failed');
    } finally {
      setBusyAction(null);
    }
  };

  if (!account || !connection) {
    return (
      <>
        <PageHeader
          title="Email"
          description="Search synced threads, generate digests, and create Gmail drafts on the blessed direct provider path."
        />
        <EmptyState title="No email account connected" description="Connect Gmail from the Connections view to start syncing mail." />
      </>
    );
  }

  return (
    <div>
      <PageHeader
        title="Email"
        description="Search synced threads, generate digests, and create Gmail drafts on the blessed direct provider path."
      />

      <div className="mb-[24px] grid gap-[16px] md:grid-cols-3">
        <Card label="Mailbox" value={account.emailAddress} description={connection.label} />
        <Card label="Messages" value={account.messageCount} description={`Last sync: ${account.lastSyncAt ?? 'never'}`} />
        <Card label="Health" value={connection.health?.status ?? 'unknown'} description={connection.sync?.lagSummary || 'No sync summary yet'} />
      </div>

      <div className="mb-[24px] flex flex-wrap gap-[12px]">
        <button
          className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[14px] py-[8px] text-[13px] font-medium text-white"
          onClick={() => void handleSync()}
          type="button"
        >
          {busyAction === 'sync' ? 'Syncing…' : 'Sync Mailbox'}
        </button>
        <button
          className="rounded-[var(--radius-sm)] bg-[var(--color-fg)]/[0.08] px-[14px] py-[8px] text-[13px] font-medium text-[var(--color-fg)]"
          onClick={() => void handleLoadDigest()}
          type="button"
        >
          {busyAction === 'digest' ? 'Generating…' : 'Generate Digest'}
        </button>
      </div>

      {actionError ? (
        <div className="mb-[16px]">
          <ErrorDisplay message={actionError} />
        </div>
      ) : null}

      <div className="mb-[24px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
        <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Search Mail</h2>
        <div className="mt-[12px] flex gap-[12px]">
          <input
            className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px]"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search cached mail"
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
        <div className="mt-[16px] space-y-[12px]">
          {searchResults.length === 0 ? (
            <p className="text-[14px] text-[var(--color-fg-muted)]">No search results yet.</p>
          ) : searchResults.map((result) => (
            <div key={result.threadId} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[12px]">
              <p className="font-medium">{result.subject}</p>
              <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">
                {result.from} · {result.lastMessageAt}
              </p>
              <p className="mt-[8px] text-[14px] text-[var(--color-fg-muted)]">{result.snippet}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-[24px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
        <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Draft Email</h2>
        <p className="mt-[4px] text-[14px] text-[var(--color-fg-muted)]">
          This uses the policy-driven Gmail draft path. Send remains out of scope in this tranche.
        </p>
        <div className="mt-[12px] grid gap-[12px]">
          <input
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px]"
            onChange={(event) => setDraftTo(event.target.value)}
            placeholder="To (comma-separated)"
            value={draftTo}
          />
          <input
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px]"
            onChange={(event) => setDraftSubject(event.target.value)}
            placeholder="Subject"
            value={draftSubject}
          />
          <textarea
            className="min-h-[140px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px]"
            onChange={(event) => setDraftBody(event.target.value)}
            placeholder="Draft body"
            value={draftBody}
          />
          <button
            className="w-fit rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[14px] py-[8px] text-[13px] font-medium text-white"
            onClick={() => void handleCreateDraft()}
            type="button"
          >
            {busyAction === 'draft' ? 'Creating…' : 'Create Draft'}
          </button>
        </div>
        {draft ? (
          <div className="mt-[16px] rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[12px]">
            <p className="font-medium">Draft created</p>
            <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">{draft.providerDraftId}</p>
            <p className="mt-[8px] text-[14px] text-[var(--color-fg-muted)]">{draft.bodyPreview}</p>
          </div>
        ) : null}
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
        <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Latest Digest</h2>
        {digest ? (
          <div className="mt-[12px]">
            <p className="text-[12px] text-[var(--color-fg-muted)]">
              Unread: {digest.unreadCount} · High signal: {digest.highSignalCount}
            </p>
            <pre className="mt-[12px] whitespace-pre-wrap text-[14px] text-[var(--color-fg-muted)]">{digest.summaryMarkdown}</pre>
          </div>
        ) : (
          <p className="mt-[12px] text-[14px] text-[var(--color-fg-muted)]">Generate a digest to see the latest mailbox summary.</p>
        )}
      </div>
    </div>
  );
}
