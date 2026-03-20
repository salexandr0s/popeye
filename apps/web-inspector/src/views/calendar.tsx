import { useMemo, useState } from 'react';
import { useApi } from '../api/provider';
import { useCalendarAccounts, useConnections } from '../api/hooks';
import { PageHeader } from '../components/page-header';
import { Loading } from '../components/loading';
import { ErrorDisplay } from '../components/error-display';
import { EmptyState } from '../components/empty-state';
import { Card } from '../components/card';

interface CalendarSearchResponse {
  query: string;
  results: Array<{
    eventId: string;
    title: string;
    startTime: string;
    endTime: string;
    location: string;
    organizer: string;
    score: number;
  }>;
}

interface CalendarDigestRecord {
  summaryMarkdown: string;
  todayEventCount: number;
  upcomingCount: number;
}

interface CalendarEventRecord {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  location: string;
}

export function Calendar() {
  const api = useApi();
  const accounts = useCalendarAccounts();
  const connections = useConnections('calendar');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CalendarSearchResponse['results']>([]);
  const [events, setEvents] = useState<CalendarEventRecord[]>([]);
  const [digest, setDigest] = useState<CalendarDigestRecord | null>(null);
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');

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
      await api.post('/v1/calendar/sync', { accountId: account.id });
      refetchAll();
      const refreshed = await api.get<CalendarEventRecord[]>(
        `/v1/calendar/events?accountId=${encodeURIComponent(account.id)}&limit=10`,
      );
      setEvents(refreshed);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Calendar sync failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleLoadDigest = async () => {
    if (!account) return;
    try {
      setBusyAction('digest');
      setActionError(null);
      const response = await api.get<CalendarDigestRecord | null>(
        `/v1/calendar/digest?accountId=${encodeURIComponent(account.id)}`,
      );
      setDigest(response);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Calendar digest failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSearch = async () => {
    if (!account || query.trim().length === 0) return;
    try {
      setBusyAction('search');
      setActionError(null);
      const response = await api.get<CalendarSearchResponse>(
        `/v1/calendar/search?query=${encodeURIComponent(query)}&accountId=${encodeURIComponent(account.id)}`,
      );
      setSearchResults(response.results);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Calendar search failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreateEvent = async () => {
    if (!account) return;
    try {
      setBusyAction('create-event');
      setActionError(null);
      const created = await api.post<CalendarEventRecord>('/v1/calendar/events', {
        accountId: account.id,
        title,
        location,
        description: '',
        startTime,
        endTime,
        attendees: [],
      });
      setEvents((current) => [created, ...current].slice(0, 10));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Calendar event creation failed');
    } finally {
      setBusyAction(null);
    }
  };

  if (!account || !connection) {
    return (
      <>
        <PageHeader
          title="Calendar"
          description="Search cached events, generate digests, and create low-risk Google Calendar events."
        />
        <EmptyState title="No calendar account connected" description="Connect Google Calendar from the Connections view first." />
      </>
    );
  }

  return (
    <div>
      <PageHeader
        title="Calendar"
        description="Search cached events, generate digests, and create low-risk Google Calendar events."
      />

      <div className="mb-[24px] grid gap-[16px] md:grid-cols-3">
        <Card label="Calendar" value={account.calendarEmail} description={connection.label} />
        <Card label="Events" value={account.eventCount} description={`Last sync: ${account.lastSyncAt ?? 'never'}`} />
        <Card label="Health" value={connection.health?.status ?? 'unknown'} description={connection.sync?.lagSummary || 'No sync summary yet'} />
      </div>

      <div className="mb-[24px] flex flex-wrap gap-[12px]">
        <button
          className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[14px] py-[8px] text-[13px] font-medium text-white"
          onClick={() => void handleSync()}
          type="button"
        >
          {busyAction === 'sync' ? 'Syncing…' : 'Sync Calendar'}
        </button>
        <button
          className="rounded-[var(--radius-sm)] bg-[var(--color-fg)]/[0.08] px-[14px] py-[8px] text-[13px] font-medium text-[var(--color-fg)]"
          onClick={() => void handleLoadDigest()}
          type="button"
        >
          {busyAction === 'digest' ? 'Generating…' : 'Load Digest'}
        </button>
      </div>

      {actionError ? (
        <div className="mb-[16px]">
          <ErrorDisplay message={actionError} />
        </div>
      ) : null}

      <div className="mb-[24px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
        <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Search Events</h2>
        <div className="mt-[12px] flex gap-[12px]">
          <input
            className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px]"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search cached events"
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
            <div key={result.eventId} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[12px]">
              <p className="font-medium">{result.title}</p>
              <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">
                {result.startTime} → {result.endTime}
              </p>
              <p className="mt-[8px] text-[14px] text-[var(--color-fg-muted)]">
                {result.location || result.organizer || 'No location or organizer metadata'}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-[24px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
        <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Create Event</h2>
        <div className="mt-[12px] grid gap-[12px]">
          <input
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px]"
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Event title"
            value={title}
          />
          <input
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px]"
            onChange={(event) => setLocation(event.target.value)}
            placeholder="Location"
            value={location}
          />
          <input
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px]"
            onChange={(event) => setStartTime(event.target.value)}
            placeholder="Start time (ISO)"
            value={startTime}
          />
          <input
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px]"
            onChange={(event) => setEndTime(event.target.value)}
            placeholder="End time (ISO)"
            value={endTime}
          />
          <button
            className="w-fit rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[14px] py-[8px] text-[13px] font-medium text-white"
            onClick={() => void handleCreateEvent()}
            type="button"
          >
            {busyAction === 'create-event' ? 'Creating…' : 'Create Event'}
          </button>
        </div>
      </div>

      <div className="grid gap-[24px] md:grid-cols-2">
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
          <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Recent Events</h2>
          <div className="mt-[12px] space-y-[12px]">
            {events.length === 0 ? (
              <p className="text-[14px] text-[var(--color-fg-muted)]">Sync calendar data to load recent events.</p>
            ) : events.map((event) => (
              <div key={event.id} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[12px]">
                <p className="font-medium">{event.title}</p>
                <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">
                  {event.startTime} → {event.endTime}
                </p>
                <p className="mt-[8px] text-[14px] text-[var(--color-fg-muted)]">{event.location || 'No location'}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
          <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Latest Digest</h2>
          {digest ? (
            <div className="mt-[12px]">
              <p className="text-[12px] text-[var(--color-fg-muted)]">
                Today: {digest.todayEventCount} · Upcoming: {digest.upcomingCount}
              </p>
              <pre className="mt-[12px] whitespace-pre-wrap text-[14px] text-[var(--color-fg-muted)]">{digest.summaryMarkdown}</pre>
            </div>
          ) : (
            <p className="mt-[12px] text-[14px] text-[var(--color-fg-muted)]">Load a digest to see the latest calendar summary.</p>
          )}
        </div>
      </div>
    </div>
  );
}
