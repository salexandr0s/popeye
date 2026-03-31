import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { usePlaybookProposal } from '../api/hooks';
import { useApi } from '../api/provider';
import { Badge } from '../components/badge';
import { ErrorDisplay } from '../components/error-display';
import { Loading } from '../components/loading';
import { PageHeader } from '../components/page-header';

function parseAllowedProfileIds(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  ).sort();
}

function parseDiff(diff: string): Array<{ kind: 'add' | 'remove' | 'context'; line: string }> {
  return diff.split('\n').map((line) => {
    if (line.startsWith('+')) return { kind: 'add' as const, line };
    if (line.startsWith('-')) return { kind: 'remove' as const, line };
    return { kind: 'context' as const, line };
  });
}

export function PlaybookProposalDetailView() {
  const { proposalId } = useParams<{ proposalId: string }>();
  const api = useApi();
  const proposal = usePlaybookProposal(proposalId);
  const [busyAction, setBusyAction] = useState<'approve' | 'reject' | 'apply' | 'save' | 'submit' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [allowedProfileIdsText, setAllowedProfileIdsText] = useState('');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => {
    if (!proposal.data) return;
    setTitle(proposal.data.title);
    setAllowedProfileIdsText(proposal.data.allowedProfileIds.join(', '));
    setSummary(proposal.data.summary);
    setBody(proposal.data.body);
  }, [proposal.data?.id, proposal.data?.updatedAt]);

  const parsedDiff = useMemo(() => parseDiff(proposal.data?.diffPreview ?? ''), [proposal.data?.diffPreview]);

  if (!proposalId) return <ErrorDisplay message="Playbook proposal ID is required." />;
  if (proposal.loading && !proposal.data) return <Loading />;
  if (proposal.error) return <ErrorDisplay message={proposal.error} />;
  if (!proposal.data) return <ErrorDisplay message="Playbook proposal not found." />;

  const isDrafting = proposal.data.status === 'drafting';
  const hasDiff = proposal.data.diffPreview.trim().length > 0;

  const handleReview = async (decision: 'approved' | 'rejected') => {
    try {
      setBusyAction(decision === 'approved' ? 'approve' : 'reject');
      setActionError(null);
      await api.post(`/v1/playbook-proposals/${encodeURIComponent(proposalId)}/review`, {
        decision,
        reviewedBy: 'web-inspector',
        note: '',
      });
      proposal.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Proposal review failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleApply = async () => {
    try {
      setBusyAction('apply');
      setActionError(null);
      await api.post(`/v1/playbook-proposals/${encodeURIComponent(proposalId)}/apply`, {
        appliedBy: 'web-inspector',
      });
      proposal.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Proposal apply failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveDraft = async () => {
    try {
      setBusyAction('save');
      setActionError(null);
      await api.patch(`/v1/playbook-proposals/${encodeURIComponent(proposalId)}`, {
        title: title.trim(),
        allowedProfileIds: parseAllowedProfileIds(allowedProfileIdsText),
        summary: summary.trim(),
        body: body.trim(),
        updatedBy: 'web-inspector',
      });
      proposal.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Proposal save failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSubmitReview = async () => {
    try {
      setBusyAction('submit');
      setActionError(null);
      await api.post(`/v1/playbook-proposals/${encodeURIComponent(proposalId)}/submit-review`, {
        submittedBy: 'web-inspector',
      });
      proposal.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Proposal submit failed');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div>
      <PageHeader title={proposal.data.title} description={`${proposal.data.kind} proposal · ${proposal.data.id}`} />

      {actionError ? (
        <div className="mb-[16px]">
          <ErrorDisplay message={actionError} />
        </div>
      ) : null}

      <div className="mb-[24px] flex flex-wrap gap-[12px]">
        {isDrafting ? (
          <>
            <button
              className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[14px] py-[8px] text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
              disabled={busyAction !== null}
              onClick={() => void handleSaveDraft()}
              type="button"
            >
              {busyAction === 'save' ? 'Saving…' : 'Save draft'}
            </button>
            <button
              className="rounded-[var(--radius-sm)] bg-[var(--color-success)]/10 px-[14px] py-[8px] text-[13px] font-medium text-[var(--color-success)] disabled:cursor-not-allowed disabled:opacity-70"
              disabled={busyAction !== null}
              onClick={() => void handleSubmitReview()}
              type="button"
            >
              {busyAction === 'submit' ? 'Submitting…' : 'Submit for review'}
            </button>
          </>
        ) : null}
        {proposal.data.status === 'pending_review' ? (
          <>
            <button
              className="rounded-[var(--radius-sm)] bg-[var(--color-success)]/10 px-[14px] py-[8px] text-[13px] font-medium text-[var(--color-success)] disabled:cursor-not-allowed disabled:opacity-70"
              disabled={busyAction !== null}
              onClick={() => void handleReview('approved')}
              type="button"
            >
              {busyAction === 'approve' ? 'Approving…' : 'Approve'}
            </button>
            <button
              className="rounded-[var(--radius-sm)] bg-[var(--color-danger)]/10 px-[14px] py-[8px] text-[13px] font-medium text-[var(--color-danger)] disabled:cursor-not-allowed disabled:opacity-70"
              disabled={busyAction !== null}
              onClick={() => void handleReview('rejected')}
              type="button"
            >
              {busyAction === 'reject' ? 'Rejecting…' : 'Reject'}
            </button>
          </>
        ) : null}
        {proposal.data.status === 'approved' ? (
          <button
            className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[14px] py-[8px] text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
            disabled={busyAction !== null}
            onClick={() => void handleApply()}
            type="button"
          >
            {busyAction === 'apply' ? 'Applying…' : 'Apply to canonical file'}
          </button>
        ) : null}
      </div>

      <div className="mb-[24px] grid gap-[16px] md:grid-cols-2 xl:grid-cols-4">
        <InfoCard label="Kind">
          <p className="text-[14px] text-[var(--color-fg)]">{proposal.data.kind}</p>
        </InfoCard>
        <InfoCard label="Status">
          <Badge state={proposal.data.status} />
        </InfoCard>
        <InfoCard label="Scope">
          <p className="text-[14px] text-[var(--color-fg)]">{proposal.data.scope}</p>
        </InfoCard>
        <InfoCard label="Scan">
          <Badge state={proposal.data.scanVerdict} />
        </InfoCard>
      </div>

      <section className="mb-[24px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
        <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Metadata</h2>
        <dl className="mt-[16px] grid gap-[12px] md:grid-cols-2">
          <MetadataRow label="Playbook" value={proposal.data.playbookId} />
          <div>
            <dt className="text-[12px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">Target</dt>
            <dd className="mt-[4px] text-[14px] text-[var(--color-fg)]">
              {proposal.data.targetRecordId ? (
                <Link
                  className="text-[var(--color-accent)] hover:underline"
                  to={`/playbooks/${encodeURIComponent(proposal.data.targetRecordId)}`}
                >
                  {proposal.data.targetRecordId}
                </Link>
              ) : (
                'new draft'
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">Source run</dt>
            <dd className="mt-[4px] text-[14px] text-[var(--color-fg)]">
              {proposal.data.sourceRunId ? (
                <Link
                  className="text-[var(--color-accent)] hover:underline"
                  to={`/runs/${encodeURIComponent(proposal.data.sourceRunId)}`}
                >
                  {proposal.data.sourceRunId}
                </Link>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <MetadataRow label="Base revision" mono value={proposal.data.baseRevisionHash ?? 'n/a'} />
          <MetadataRow label="Proposed by" value={proposal.data.proposedBy} />
          <MetadataRow
            label="Review"
            value={
              proposal.data.reviewedBy
                ? `${proposal.data.reviewedBy} · ${proposal.data.reviewedAt ?? 'pending timestamp'}`
                : 'pending'
            }
          />
          <div>
            <dt className="text-[12px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">Applied</dt>
            <dd className="mt-[4px] text-[14px] text-[var(--color-fg)]">
              {proposal.data.appliedRecordId ? (
                <Link
                  className="text-[var(--color-accent)] hover:underline"
                  to={`/playbooks/${encodeURIComponent(proposal.data.appliedRecordId)}`}
                >
                  {proposal.data.appliedRecordId}
                </Link>
              ) : (
                'not applied'
              )}
            </dd>
          </div>
          {proposal.data.scanMatchedRules.length > 0 ? (
            <div className="md:col-span-2">
              <dt className="text-[12px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">Matched rules</dt>
              <dd className="mt-[4px] text-[14px] text-[var(--color-fg)]">
                {proposal.data.scanMatchedRules.join(', ')}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      {proposal.data.evidence ? (
        <section className="mb-[24px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
          <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Evidence</h2>
          <div className="mt-[16px] grid gap-[16px] md:grid-cols-3">
            <InfoCard label="Uses (30d)">
              <p className="text-[18px] font-semibold text-[var(--color-fg)]">{proposal.data.evidence.metrics30d.useCount30d}</p>
            </InfoCard>
            <InfoCard label="Failed runs (30d)">
              <p className="text-[18px] font-semibold text-[var(--color-fg)]">{proposal.data.evidence.metrics30d.failedRuns30d}</p>
            </InfoCard>
            <InfoCard label="Interventions (30d)">
              <p className="text-[18px] font-semibold text-[var(--color-fg)]">{proposal.data.evidence.metrics30d.interventions30d}</p>
            </InfoCard>
          </div>
          {proposal.data.evidence.suggestedPatchNote ? (
            <div className="mt-[16px] rounded-[var(--radius-sm)] bg-[var(--color-bg-muted)] p-[12px] text-[14px] text-[var(--color-fg)]">
              {proposal.data.evidence.suggestedPatchNote}
            </div>
          ) : null}
          <div className="mt-[16px] grid gap-[16px] md:grid-cols-2">
            <div>
              <h3 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">Recent failed runs</h3>
              {proposal.data.evidence.runIds.length === 0 ? (
                <p className="mt-[8px] text-[14px] text-[var(--color-fg-muted)]">No recent failed runs recorded.</p>
              ) : (
                <ul className="mt-[8px] space-y-[4px] text-[14px] text-[var(--color-fg)]">
                  {proposal.data.evidence.runIds.map((runId) => (
                    <li key={runId}>
                      <Link className="text-[var(--color-accent)] hover:underline" to={`/runs/${encodeURIComponent(runId)}`}>
                        {runId}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">Recent interventions</h3>
              {proposal.data.evidence.interventionIds.length === 0 ? (
                <p className="mt-[8px] text-[14px] text-[var(--color-fg-muted)]">No recent interventions recorded.</p>
              ) : (
                <ul className="mt-[8px] space-y-[4px] text-[14px] text-[var(--color-fg)]">
                  {proposal.data.evidence.interventionIds.map((interventionId) => (
                    <li key={interventionId}>
                      <Link className="text-[var(--color-accent)] hover:underline" to="/interventions">
                        {interventionId}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {isDrafting ? (
        <section className="mb-[24px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
          <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Edit drafting proposal</h2>
          {!hasDiff ? (
            <div className="mt-[12px] rounded-[var(--radius-sm)] border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 p-[12px] text-[13px] text-[var(--color-fg)]">
              No canonical diff yet. Edit the proposed body before submitting for review.
            </div>
          ) : null}
          <div className="mt-[16px] grid gap-[16px] md:grid-cols-2">
            <label>
              <span className="mb-[6px] block text-[12px] font-medium text-[var(--color-fg-muted)]">Title</span>
              <input
                className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px]"
                onChange={(event) => setTitle(event.target.value)}
                value={title}
              />
            </label>
            <label>
              <span className="mb-[6px] block text-[12px] font-medium text-[var(--color-fg-muted)]">Allowed profiles</span>
              <input
                className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px]"
                onChange={(event) => setAllowedProfileIdsText(event.target.value)}
                value={allowedProfileIdsText}
              />
            </label>
            <label className="md:col-span-2">
              <span className="mb-[6px] block text-[12px] font-medium text-[var(--color-fg-muted)]">Summary</span>
              <input
                className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px]"
                onChange={(event) => setSummary(event.target.value)}
                value={summary}
              />
            </label>
            <label className="md:col-span-2">
              <span className="mb-[6px] block text-[12px] font-medium text-[var(--color-fg-muted)]">Body</span>
              <textarea
                className="min-h-[260px] w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[10px] font-[var(--font-mono)] text-[13px]"
                onChange={(event) => setBody(event.target.value)}
                value={body}
              />
            </label>
          </div>
        </section>
      ) : null}

      <section className="mb-[24px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
        <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Diff preview</h2>
        {hasDiff ? (
          <div className="mt-[12px] max-h-[360px] overflow-y-auto rounded-[var(--radius-sm)] bg-[var(--color-bg-muted)] p-[12px] font-[var(--font-mono)] text-[13px]">
            {parsedDiff.map((line, index) => (
              <div
                className={
                  line.kind === 'add'
                    ? 'text-[var(--color-success)]'
                    : line.kind === 'remove'
                      ? 'text-[var(--color-danger)]'
                      : 'text-[var(--color-fg)]'
                }
                key={`${line.line}-${index}`}
              >
                {line.line || ' '}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-[12px] rounded-[var(--radius-sm)] bg-[var(--color-bg-muted)] p-[12px] text-[13px] text-[var(--color-fg-muted)]">
            No canonical diff available yet.
          </div>
        )}
      </section>

      <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
        <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Proposed canonical markdown</h2>
        <pre className="mt-[12px] max-h-[520px] overflow-y-auto whitespace-pre-wrap rounded-[var(--radius-sm)] bg-[var(--color-bg-muted)] p-[12px] font-[var(--font-mono)] text-[13px] text-[var(--color-fg)]">
          {proposal.data.markdownText}
        </pre>
      </section>
    </div>
  );
}

function InfoCard({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[16px]">
      <p className="text-[12px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">{label}</p>
      <div className="mt-[8px]">{children}</div>
    </div>
  );
}

function MetadataRow({
  className,
  label,
  mono = false,
  value,
}: {
  className?: string;
  label: string;
  mono?: boolean;
  value: string;
}) {
  return (
    <div className={className}>
      <dt className="text-[12px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)]">{label}</dt>
      <dd className={`mt-[4px] text-[14px] text-[var(--color-fg)] ${mono ? 'font-mono text-[12px]' : ''}`}>{value}</dd>
    </div>
  );
}
