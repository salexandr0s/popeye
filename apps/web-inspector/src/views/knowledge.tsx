import { useEffect, useMemo, useState } from 'react';

import type {
  KnowledgeAuditReport,
  KnowledgeBetaRunDetail,
  KnowledgeConverterAvailability,
  KnowledgeDocumentDetail,
  KnowledgeDocumentRecord,
  KnowledgeNeighborhood,
  KnowledgeSourceRecord,
} from '@popeye/contracts';

import { useApi } from '../api/provider';
import { Card } from '../components/card';
import { EmptyState } from '../components/empty-state';
import { ErrorDisplay } from '../components/error-display';
import { Loading } from '../components/loading';
import { PageHeader } from '../components/page-header';

type KnowledgeMode = 'sources' | 'wiki' | 'outputs';

const workspaceId = 'default';

function kindForMode(mode: KnowledgeMode): 'source_normalized' | 'wiki_article' | 'output_note' {
  switch (mode) {
    case 'sources':
      return 'source_normalized';
    case 'outputs':
      return 'output_note';
    default:
      return 'wiki_article';
  }
}

export function Knowledge() {
  const api = useApi();
  const [mode, setMode] = useState<KnowledgeMode>('wiki');
  const [query, setQuery] = useState('');
  const [documents, setDocuments] = useState<KnowledgeDocumentRecord[]>([]);
  const [sources, setSources] = useState<KnowledgeSourceRecord[]>([]);
  const [converters, setConverters] = useState<KnowledgeConverterAvailability[]>([]);
  const [audit, setAudit] = useState<KnowledgeAuditReport | null>(null);
  const [latestBetaRun, setLatestBetaRun] = useState<KnowledgeBetaRunDetail | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<KnowledgeDocumentDetail | null>(null);
  const [neighborhood, setNeighborhood] = useState<KnowledgeNeighborhood | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [loadedSources, loadedDocuments, loadedAudit, loadedConverters, loadedBetaRuns] = await Promise.all([
          api.get<KnowledgeSourceRecord[]>(`/v1/knowledge/sources?workspaceId=${encodeURIComponent(workspaceId)}`),
          api.get<KnowledgeDocumentRecord[]>(
            `/v1/knowledge/documents?workspaceId=${encodeURIComponent(workspaceId)}&kind=${encodeURIComponent(kindForMode(mode))}${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ''}`,
          ),
          api.get<KnowledgeAuditReport>(`/v1/knowledge/audit?workspaceId=${encodeURIComponent(workspaceId)}`),
          api.get<KnowledgeConverterAvailability[]>('/v1/knowledge/converters'),
          api.get<Array<{ id: string }>>(`/v1/knowledge/beta-runs?workspaceId=${encodeURIComponent(workspaceId)}&limit=1`),
        ]);
        const betaRun = loadedBetaRuns[0]
          ? await api.get<KnowledgeBetaRunDetail>(`/v1/knowledge/beta-runs/${encodeURIComponent(loadedBetaRuns[0].id)}`)
          : null;
        if (cancelled) return;
        setSources(loadedSources);
        setDocuments(loadedDocuments);
        setAudit(loadedAudit);
        setConverters(loadedConverters);
        setLatestBetaRun(betaRun);
        setSelectedDocumentId((current) => {
          if (current && loadedDocuments.some((document) => document.id === current)) return current;
          return loadedDocuments[0]?.id ?? null;
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load knowledge');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [api, mode, query]);

  useEffect(() => {
    if (!selectedDocumentId) {
      setSelectedDocument(null);
      setNeighborhood(null);
      return;
    }

    let cancelled = false;
    const loadDetail = async () => {
      try {
        const [detail, links] = await Promise.all([
          api.get<KnowledgeDocumentDetail>(`/v1/knowledge/documents/${encodeURIComponent(selectedDocumentId)}`),
          api.get<KnowledgeNeighborhood>(`/v1/knowledge/documents/${encodeURIComponent(selectedDocumentId)}/neighborhood`),
        ]);
        if (cancelled) return;
        setSelectedDocument(detail);
        setNeighborhood(links);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load knowledge document');
      }
    };

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [api, selectedDocumentId]);

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === selectedDocument?.sourceIds[0] || source.id === selectedDocument?.sourceId) ?? null,
    [selectedDocument, sources],
  );
  const converterCounts = useMemo(() => ({
    ready: converters.filter((converter) => converter.status === 'ready').length,
    degraded: converters.filter((converter) => converter.status === 'degraded').length,
    missing: converters.filter((converter) => converter.status === 'missing').length,
  }), [converters]);
  const betaIssues = useMemo(
    () => (latestBetaRun
      ? [...latestBetaRun.imports, ...latestBetaRun.reingests].filter((row) => (
        Boolean(row.error)
        || row.status === 'degraded'
        || row.status === 'compiled_with_warnings'
        || row.status === 'conversion_failed'
        || row.assetStatus === 'partial_failure'
        || row.assetStatus === 'failed'
      ))
      : []),
    [latestBetaRun],
  );

  return (
    <div>
      <PageHeader title="Knowledge" description="Read-only knowledge documents, audit state, and converter readiness." />

      <div className="mb-[24px] grid gap-[16px] md:grid-cols-4">
        <Card label="Documents" value={String(audit?.totalDocuments ?? documents.length)} description="Current workspace" />
        <Card label="Drafts" value={String(audit?.totalDraftRevisions ?? 0)} description="Pending revision proposals" />
        <Card label="Converters Ready" value={String(converterCounts.ready)} description={`${converterCounts.degraded} degraded · ${converterCounts.missing} missing`} />
        <Card label="Warnings" value={String((audit?.warningSources ?? 0) + (audit?.degradedSources ?? 0))} description="Source conversion warnings + degraded imports" />
      </div>

      {latestBetaRun ? (
        <div className="mb-[24px] grid gap-[16px] lg:grid-cols-[1.1fr,0.9fr]">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[16px]">
            <div className="flex items-start justify-between gap-[16px]">
              <div>
                <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Latest beta corpus run</h2>
                <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">
                  {latestBetaRun.manifestPath ?? 'No manifest path recorded'}
                </p>
              </div>
              <span className={`rounded-full px-[10px] py-[4px] text-[12px] font-medium ${
                latestBetaRun.gate.status === 'passed'
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'bg-amber-500/15 text-amber-300'
              }`}
              >
                {latestBetaRun.gate.status}
              </span>
            </div>
            <div className="mt-[12px] grid gap-[12px] md:grid-cols-3">
              <Card label="Import success" value={`${Math.round(latestBetaRun.importSuccessRate * 100)}%`} description={`${latestBetaRun.hardFailureCount} hard failures`} />
              <Card label="Imports" value={String(latestBetaRun.importCount)} description={`${latestBetaRun.reingestCount} reingests`} />
              <Card label="Updated" value={new Date(latestBetaRun.createdAt).toLocaleString()} description="Latest stored beta run" />
            </div>
          </div>

          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[16px]">
            <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Beta issues</h2>
            <div className="mt-[12px] space-y-[8px] text-[13px] text-[var(--color-fg-muted)]">
              {betaIssues.length === 0 ? (
                <p>No degraded imports or hard failures in the latest beta run.</p>
              ) : betaIssues.slice(0, 5).map((row) => (
                <div key={`${row.label}-${row.outcome}-${row.error ?? 'ok'}`} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[10px]">
                  <p className="font-medium text-[var(--color-fg)]">{row.label}</p>
                  <p>{row.outcome}{row.status ? ` · ${row.status}` : ''}</p>
                  {row.error ? <p>{row.error}</p> : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="mb-[16px] flex gap-[8px]">
        {(['sources', 'wiki', 'outputs'] as KnowledgeMode[]).map((candidate) => (
          <button
            key={candidate}
            className={`rounded-[var(--radius-sm)] px-[12px] py-[8px] text-[13px] font-medium ${
              mode === candidate
                ? 'bg-[var(--color-accent)] text-white'
                : 'bg-[var(--color-surface)] text-[var(--color-fg)] border border-[var(--color-border)]'
            }`}
            onClick={() => setMode(candidate)}
            type="button"
          >
            {candidate[0]!.toUpperCase() + candidate.slice(1)}
          </button>
        ))}
        <input
          className="ml-auto w-[280px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px] text-[14px]"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search knowledge…"
          value={query}
        />
      </div>

      {error ? <ErrorDisplay message={error} /> : null}
      {loading ? <Loading /> : null}

      {!loading ? (
        <div className="grid gap-[20px] xl:grid-cols-[320px,1fr]">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[16px]">
            <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Documents</h2>
            <div className="mt-[12px] space-y-[8px]">
              {documents.length === 0 ? (
                <EmptyState title="No knowledge documents" description="Import a source or adjust the current search." />
              ) : documents.map((document) => (
                <button
                  key={document.id}
                  className={`block w-full rounded-[var(--radius-sm)] border p-[12px] text-left ${
                    selectedDocumentId === document.id
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5'
                      : 'border-[var(--color-border)]'
                  }`}
                  onClick={() => setSelectedDocumentId(document.id)}
                  type="button"
                >
                  <p className="font-medium text-[var(--color-fg)]">{document.title}</p>
                  <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">{document.relativePath}</p>
                  <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">{document.status}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-[16px]">
            {selectedDocument ? (
              <>
                <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[16px]">
                  <div className="flex items-start justify-between gap-[16px]">
                    <div>
                      <h2 className="text-[18px] font-semibold text-[var(--color-fg)]">{selectedDocument.title}</h2>
                      <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">{selectedDocument.relativePath}</p>
                    </div>
                    <div className="text-right text-[12px] text-[var(--color-fg-muted)]">
                      <p>{selectedDocument.kind}</p>
                      <p>{selectedDocument.status}</p>
                    </div>
                  </div>
                  {selectedSource ? (
                    <div className="mt-[12px] rounded-[var(--radius-sm)] bg-[var(--color-bg-muted)] p-[12px] text-[12px] text-[var(--color-fg-muted)]">
                      <p><strong>Source:</strong> {selectedSource.title}</p>
                      <p><strong>Adapter:</strong> {selectedSource.adapter}</p>
                      <p><strong>Status:</strong> {selectedSource.status} · {selectedSource.assetStatus}</p>
                    </div>
                  ) : null}
                  <pre className="mt-[12px] max-h-[420px] overflow-auto whitespace-pre-wrap rounded-[var(--radius-sm)] bg-[var(--color-bg-muted)] p-[12px] text-[13px] text-[var(--color-fg)]">
                    {selectedDocument.markdownText || 'No persisted markdown yet.'}
                  </pre>
                </div>

                <div className="grid gap-[16px] lg:grid-cols-2">
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[16px]">
                    <h3 className="text-[15px] font-semibold text-[var(--color-fg)]">Links</h3>
                    <div className="mt-[12px] space-y-[8px] text-[13px] text-[var(--color-fg-muted)]">
                      {(neighborhood?.outgoing ?? []).slice(0, 6).map((link) => (
                        <div key={link.id} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[10px]">
                          <p className="font-medium text-[var(--color-fg)]">{link.targetLabel}</p>
                          <p>{link.linkKind} · {link.linkStatus}</p>
                        </div>
                      ))}
                      {(neighborhood?.outgoing?.length ?? 0) === 0 ? (
                        <p>No outgoing links.</p>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[16px]">
                    <h3 className="text-[15px] font-semibold text-[var(--color-fg)]">Converter Health</h3>
                    <div className="mt-[12px] space-y-[8px] text-[13px] text-[var(--color-fg-muted)]">
                      {converters.slice(0, 4).map((converter) => (
                        <div key={converter.id} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[10px]">
                          <p className="font-medium text-[var(--color-fg)]">{converter.id}</p>
                          <p>{converter.status} · {converter.provenance} · {converter.details}</p>
                          {converter.installHint && converter.provenance !== 'bundled' ? <p>{converter.installHint}</p> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <EmptyState title="Select a document" description="Choose a knowledge document to inspect its content." />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
