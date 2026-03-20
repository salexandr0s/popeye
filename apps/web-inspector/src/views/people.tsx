import { useEffect, useMemo, useState } from 'react';
import { useApi } from '../api/provider';
import { usePeople, type PersonRecord } from '../api/hooks';
import { PageHeader } from '../components/page-header';
import { Loading } from '../components/loading';
import { ErrorDisplay } from '../components/error-display';
import { EmptyState } from '../components/empty-state';
import { Card } from '../components/card';

interface PersonSearchResponse {
  query: string;
  results: Array<{
    personId: string;
    displayName: string;
    canonicalEmail: string | null;
    githubLogin: string | null;
    score: number;
  }>;
}

export function People() {
  const api = useApi();
  const people = usePeople();
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PersonSearchResponse['results']>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [attachProvider, setAttachProvider] = useState<'email' | 'calendar' | 'github'>('email');
  const [attachExternalId, setAttachExternalId] = useState('');
  const [attachDisplayName, setAttachDisplayName] = useState('');
  const [attachHandle, setAttachHandle] = useState('');

  const selected = useMemo(
    () => (people.data ?? []).find((person) => person.id === selectedId) ?? people.data?.[0] ?? null,
    [people.data, selectedId],
  );

  useEffect(() => {
    setNotes(selected?.notes ?? '');
    setTags(selected?.tags.join(', ') ?? '');
  }, [selected]);

  if (people.loading) return <Loading />;
  if (people.error) return <ErrorDisplay message={people.error} />;

  const items = people.data ?? [];

  const handleSearch = async () => {
    try {
      setBusyAction('search');
      setActionError(null);
      const response = await api.get<PersonSearchResponse>(`/v1/people/search?query=${encodeURIComponent(query)}`);
      setSearchResults(response.results);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'People search failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSave = async () => {
    if (!selected) return;
    try {
      setBusyAction('save');
      setActionError(null);
      await api.patch(`/v1/people/${encodeURIComponent(selected.id)}`, {
        notes,
        tags: tags.split(',').map((value) => value.trim()).filter(Boolean),
      });
      people.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'People update failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleMerge = async () => {
    if (!selected || !mergeTargetId.trim()) return;
    try {
      setBusyAction('merge');
      setActionError(null);
      const merged = await api.post(`/v1/people/merge`, {
        sourcePersonId: selected.id,
        targetPersonId: mergeTargetId.trim(),
        requestedBy: 'web-inspector',
      });
      setSelectedId((merged as { id: string }).id);
      setMergeTargetId('');
      people.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'People merge failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleAttachIdentity = async () => {
    if (!selected || !attachExternalId.trim()) return;
    try {
      setBusyAction('attach');
      setActionError(null);
      const updated = await api.post(`/v1/people/identities/attach`, {
        personId: selected.id,
        provider: attachProvider,
        externalId: attachExternalId.trim(),
        displayName: attachDisplayName.trim() || null,
        handle: attachProvider === 'github' ? (attachHandle.trim() || null) : null,
        requestedBy: 'web-inspector',
      });
      setSelectedId((updated as { id: string }).id);
      setAttachExternalId('');
      setAttachDisplayName('');
      setAttachHandle('');
      people.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Attach identity failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDetachIdentity = async (identityId: string) => {
    try {
      setBusyAction(`detach:${identityId}`);
      setActionError(null);
      const detached = await api.post(`/v1/people/identities/${encodeURIComponent(identityId)}/detach`, {
        requestedBy: 'web-inspector',
      });
      setSelectedId((detached as { id: string }).id);
      people.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Detach identity failed');
    } finally {
      setBusyAction(null);
    }
  };

  if (items.length === 0) {
    return (
      <>
        <PageHeader
          title="People"
          description="Canonical identity graph derived from Gmail, Google Calendar, and GitHub."
        />
        <EmptyState
          title="No people projected yet"
          description="Sync Gmail, Google Calendar, or GitHub to start building the People graph."
        />
      </>
    );
  }

  return (
    <div>
      <PageHeader
        title="People"
        description="Canonical identity graph derived from Gmail, Google Calendar, and GitHub."
      />

      <div className="mb-[24px] grid gap-[16px] md:grid-cols-3">
        <Card label="People" value={items.length} description="Canonical profiles" />
        <Card
          label="With Email"
          value={items.filter((person) => Boolean(person.canonicalEmail)).length}
          description="Profiles linked to an email identity"
        />
        <Card
          label="With GitHub"
          value={items.filter((person) => Boolean(person.githubLogin)).length}
          description="Profiles linked to a GitHub identity"
        />
      </div>

      {actionError ? (
        <div className="mb-[16px]">
          <ErrorDisplay message={actionError} />
        </div>
      ) : null}

      <div className="mb-[24px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
        <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Search People</h2>
        <div className="mt-[12px] flex gap-[12px]">
          <input
            className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px]"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, email, or GitHub login"
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
            <p className="text-[14px] text-[var(--color-fg-muted)]">Run a search to inspect matches.</p>
          ) : searchResults.map((result) => (
            <button
              key={result.personId}
              className="block w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[12px] text-left"
              onClick={() => setSelectedId(result.personId)}
              type="button"
            >
              <p className="font-medium">{result.displayName}</p>
              <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">
                {result.canonicalEmail ?? result.githubLogin ?? 'No primary identity'} · score {result.score}
              </p>
            </button>
          ))}
        </div>
      </div>

      {selected ? (
        <div className="grid gap-[24px] md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
            <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">{selected.displayName}</h2>
            <p className="mt-[4px] text-[14px] text-[var(--color-fg-muted)]">
              {selected.canonicalEmail ?? selected.githubLogin ?? 'No primary identity'}
            </p>
            <div className="mt-[16px] space-y-[12px]">
              <div>
                <p className="text-[12px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">Identities</p>
                <div className="mt-[8px] space-y-[8px]">
                  {selected.identities.map((identity: PersonRecord['identities'][number]) => (
                    <div key={identity.id} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[10px]">
                      <div className="flex items-start justify-between gap-[12px]">
                        <div>
                          <p className="font-medium">{identity.provider}</p>
                          <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">{identity.externalId}</p>
                        </div>
                        <button
                          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[10px] py-[6px] text-[12px] font-medium"
                          onClick={() => void handleDetachIdentity(identity.id)}
                          type="button"
                        >
                          {busyAction === `detach:${identity.id}` ? 'Detaching…' : 'Detach'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[12px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">Contacts</p>
                <div className="mt-[8px] space-y-[8px]">
                  {selected.contactMethods.map((contact: PersonRecord['contactMethods'][number]) => (
                    <div key={contact.id} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[10px]">
                      <p className="font-medium">{contact.type}</p>
                      <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">{contact.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-[24px]">
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
              <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Manual Notes</h2>
              <div className="mt-[12px] grid gap-[12px]">
                <input
                  className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px]"
                  onChange={(event) => setTags(event.target.value)}
                  placeholder="Tags (comma-separated)"
                  value={tags}
                />
                <textarea
                  className="min-h-[160px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px]"
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Operator notes"
                  value={notes}
                />
                <button
                  className="w-fit rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[14px] py-[8px] text-[13px] font-medium text-white"
                  onClick={() => void handleSave()}
                  type="button"
                >
                  {busyAction === 'save' ? 'Saving…' : 'Save Notes'}
                </button>
              </div>
            </div>

            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
              <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Identity Repair</h2>
              <div className="mt-[12px] grid gap-[12px]">
                <label className="grid gap-[6px] text-[13px]">
                  <span className="text-[var(--color-fg-muted)]">Provider</span>
                  <select
                    className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px]"
                    onChange={(event) => setAttachProvider(event.target.value as 'email' | 'calendar' | 'github')}
                    value={attachProvider}
                  >
                    <option value="email">Email</option>
                    <option value="calendar">Calendar</option>
                    <option value="github">GitHub</option>
                  </select>
                </label>
                <input
                  className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px]"
                  onChange={(event) => setAttachExternalId(event.target.value)}
                  placeholder="External identity"
                  value={attachExternalId}
                />
                <input
                  className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px]"
                  onChange={(event) => setAttachDisplayName(event.target.value)}
                  placeholder="Display name (optional)"
                  value={attachDisplayName}
                />
                {attachProvider === 'github' ? (
                  <input
                    className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px]"
                    onChange={(event) => setAttachHandle(event.target.value)}
                    placeholder="GitHub handle (optional)"
                    value={attachHandle}
                  />
                ) : null}
                <button
                  className="w-fit rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[14px] py-[8px] text-[13px] font-medium"
                  onClick={() => void handleAttachIdentity()}
                  type="button"
                >
                  {busyAction === 'attach' ? 'Attaching…' : 'Attach Identity'}
                </button>
              </div>
            </div>

            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
              <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Merge</h2>
              <div className="mt-[12px] grid gap-[12px]">
                <input
                  className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[12px] py-[8px]"
                  onChange={(event) => setMergeTargetId(event.target.value)}
                  placeholder="Target person ID"
                  value={mergeTargetId}
                />
                <button
                  className="w-fit rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[14px] py-[8px] text-[13px] font-medium"
                  onClick={() => void handleMerge()}
                  type="button"
                >
                  {busyAction === 'merge' ? 'Merging…' : 'Merge Into Target'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
