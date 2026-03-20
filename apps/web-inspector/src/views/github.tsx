import { useMemo, useState } from 'react';
import { useApi } from '../api/provider';
import { useConnections, useGithubAccounts } from '../api/hooks';
import { PageHeader } from '../components/page-header';
import { Loading } from '../components/loading';
import { ErrorDisplay } from '../components/error-display';
import { EmptyState } from '../components/empty-state';
import { Card } from '../components/card';

interface GithubSearchResponse {
  query: string;
  results: Array<{
    entityType: 'pr' | 'issue';
    entityId: string;
    repoFullName: string;
    number: number;
    title: string;
    author: string;
    state: string;
    updatedAt: string;
    score: number;
  }>;
}

interface GithubDigestRecord {
  summaryMarkdown: string;
  openPrsCount: number;
  reviewRequestsCount: number;
  assignedIssuesCount: number;
  unreadNotificationsCount: number;
}

interface GithubNotificationRecord {
  id: string;
  githubNotificationId: string;
  repoFullName: string;
  subjectTitle: string;
  reason: string;
  isUnread: boolean;
}

export function Github() {
  const api = useApi();
  const accounts = useGithubAccounts();
  const connections = useConnections('github');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GithubSearchResponse['results']>([]);
  const [notifications, setNotifications] = useState<GithubNotificationRecord[]>([]);
  const [digest, setDigest] = useState<GithubDigestRecord | null>(null);
  const [repoFullName, setRepoFullName] = useState('');
  const [issueNumber, setIssueNumber] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [commentResult, setCommentResult] = useState<{ id: string; htmlUrl: string | null; bodyPreview: string } | null>(null);

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
      await api.post('/v1/github/sync', { accountId: account.id });
      refetchAll();
      const latestNotifications = await api.get<GithubNotificationRecord[]>(
        `/v1/github/notifications?accountId=${encodeURIComponent(account.id)}&limit=10`,
      );
      setNotifications(latestNotifications);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'GitHub sync failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleLoadDigest = async () => {
    if (!account) return;
    try {
      setBusyAction('digest');
      setActionError(null);
      const response = await api.get<GithubDigestRecord | null>(
        `/v1/github/digest?accountId=${encodeURIComponent(account.id)}`,
      );
      setDigest(response);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'GitHub digest failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSearch = async () => {
    if (!account || query.trim().length === 0) return;
    try {
      setBusyAction('search');
      setActionError(null);
      const response = await api.get<GithubSearchResponse>(
        `/v1/github/search?query=${encodeURIComponent(query)}&accountId=${encodeURIComponent(account.id)}`,
      );
      setSearchResults(response.results);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'GitHub search failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleComment = async () => {
    if (!account) return;
    try {
      setBusyAction('comment');
      setActionError(null);
      const response = await api.post<{ id: string; htmlUrl: string | null; bodyPreview: string }>('/v1/github/comments', {
        accountId: account.id,
        repoFullName,
        issueNumber: Number(issueNumber),
        body: commentBody,
      });
      setCommentResult(response);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'GitHub comment failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleMarkRead = async (notificationId: string) => {
    try {
      setBusyAction(`notification:${notificationId}`);
      setActionError(null);
      const updated = await api.post<GithubNotificationRecord>('/v1/github/notifications/mark-read', {
        notificationId,
      });
      setNotifications((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Mark-read failed');
    } finally {
      setBusyAction(null);
    }
  };

  if (!account || !connection) {
    return (
      <>
        <PageHeader
          title="GitHub"
          description="Search cached GitHub data, inspect notifications, and perform allowlisted low-risk actions."
        />
        <EmptyState title="No GitHub account connected" description="Connect GitHub from the Connections view first." />
      </>
    );
  }

  return (
    <div>
      <PageHeader
        title="GitHub"
        description="Search cached GitHub data, inspect notifications, and perform allowlisted low-risk actions."
      />

      <div className="mb-[24px] grid gap-[16px] md:grid-cols-3">
        <Card label="Account" value={account.githubUsername} description={connection.label} />
        <Card label="Repos" value={account.repoCount} description={`Last sync: ${account.lastSyncAt ?? 'never'}`} />
        <Card label="Health" value={connection.health?.status ?? 'unknown'} description={connection.sync?.lagSummary || 'No sync summary yet'} />
      </div>

      <div className="mb-[24px] flex flex-wrap gap-[12px]">
        <button
          className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[14px] py-[8px] text-[13px] font-medium text-white"
          onClick={() => void handleSync()}
          type="button"
        >
          {busyAction === 'sync' ? 'Syncing…' : 'Sync GitHub'}
        </button>
        <button
          className="rounded-[var(--radius-sm)] bg-[var(--color-fg)]/[0.08] px-[14px] py-[8px] text-[13px] font-medium text-[var(--color-fg)]"
          onClick={() => void handleLoadDigest()}
          type="button"
        >
          {busyAction === 'digest' ? 'Loading…' : 'Load Digest'}
        </button>
      </div>

      {actionError ? (
        <div className="mb-[16px]">
          <ErrorDisplay message={actionError} />
        </div>
      ) : null}

      <div className="mb-[24px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
        <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Search PRs and Issues</h2>
        <div className="mt-[12px] flex gap-[12px]">
          <input
            className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px]"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search synced GitHub items"
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
            <div key={result.entityId} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[12px]">
              <p className="font-medium">{result.title}</p>
              <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">
                {result.repoFullName} · {result.entityType.toUpperCase()} #{result.number} · {result.state}
              </p>
              <p className="mt-[8px] text-[14px] text-[var(--color-fg-muted)]">by {result.author} · {result.updatedAt}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-[24px] grid gap-[24px] md:grid-cols-2">
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
          <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Add Comment</h2>
          <p className="mt-[4px] text-[14px] text-[var(--color-fg-muted)]">
            Comment creation is restricted to allowlisted repos on read-write connections.
          </p>
          <div className="mt-[12px] grid gap-[12px]">
            <input
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px]"
              onChange={(event) => setRepoFullName(event.target.value)}
              placeholder="repo owner/name"
              value={repoFullName}
            />
            <input
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px]"
              onChange={(event) => setIssueNumber(event.target.value)}
              placeholder="Issue or PR number"
              value={issueNumber}
            />
            <textarea
              className="min-h-[140px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px]"
              onChange={(event) => setCommentBody(event.target.value)}
              placeholder="Comment body"
              value={commentBody}
            />
            <button
              className="w-fit rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[14px] py-[8px] text-[13px] font-medium text-white"
              onClick={() => void handleComment()}
              type="button"
            >
              {busyAction === 'comment' ? 'Posting…' : 'Add Comment'}
            </button>
          </div>
          {commentResult ? (
            <div className="mt-[16px] rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[12px]">
              <p className="font-medium">Comment created</p>
              <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">{commentResult.id}</p>
              <p className="mt-[8px] text-[14px] text-[var(--color-fg-muted)]">{commentResult.bodyPreview}</p>
            </div>
          ) : null}
        </div>

        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
          <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Latest Digest</h2>
          {digest ? (
            <div className="mt-[12px]">
              <p className="text-[12px] text-[var(--color-fg-muted)]">
                Open PRs: {digest.openPrsCount} · Reviews: {digest.reviewRequestsCount} · Assigned: {digest.assignedIssuesCount} · Unread: {digest.unreadNotificationsCount}
              </p>
              <pre className="mt-[12px] whitespace-pre-wrap text-[14px] text-[var(--color-fg-muted)]">{digest.summaryMarkdown}</pre>
            </div>
          ) : (
            <p className="mt-[12px] text-[14px] text-[var(--color-fg-muted)]">Load a digest to see the current GitHub summary.</p>
          )}
        </div>
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
        <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Unread Notifications</h2>
        <div className="mt-[12px] space-y-[12px]">
          {notifications.length === 0 ? (
            <p className="text-[14px] text-[var(--color-fg-muted)]">Sync GitHub to load unread notifications.</p>
          ) : notifications.map((notification) => (
            <div key={notification.id} className="flex items-start justify-between gap-[12px] rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[12px]">
              <div>
                <p className="font-medium">{notification.subjectTitle}</p>
                <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">
                  {notification.repoFullName} · {notification.reason}
                </p>
              </div>
              <button
                className="rounded-[var(--radius-sm)] bg-[var(--color-fg)]/[0.08] px-[10px] py-[6px] text-[12px] font-medium text-[var(--color-fg)]"
                onClick={() => void handleMarkRead(notification.id)}
                type="button"
              >
                {busyAction === `notification:${notification.id}` ? 'Updating…' : 'Mark Read'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
