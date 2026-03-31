import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import type { PlaybookProposalRecord } from '../api/hooks';
import { usePlaybook, useProjects, useWorkspaces } from '../api/hooks';
import { useApi } from '../api/provider';
import { ErrorDisplay } from '../components/error-display';
import { Loading } from '../components/loading';
import { PageHeader } from '../components/page-header';
import { buildPlaybookProposalAuthoringPath } from './playbook-utils';

type DraftScope = 'global' | 'workspace' | 'project';

type ProposalKind = 'draft' | 'patch';

interface DraftFormState {
  playbookId: string;
  title: string;
  scope: DraftScope;
  workspaceId: string;
  projectId: string;
  allowedProfileIdsText: string;
  summary: string;
  body: string;
}

interface PatchFormState {
  title: string;
  allowedProfileIdsText: string;
  summary: string;
  body: string;
}

function parseAllowedProfileIds(value: string): string[] {
  return Array.from(new Set(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )).sort();
}

function emptyDraftFormState(): DraftFormState {
  return {
    playbookId: '',
    title: '',
    scope: 'global',
    workspaceId: '',
    projectId: '',
    allowedProfileIdsText: '',
    summary: '',
    body: '',
  };
}

function emptyPatchFormState(repairSummary: string): PatchFormState {
  return {
    title: '',
    allowedProfileIdsText: '',
    summary: repairSummary,
    body: '',
  };
}

export function PlaybookProposalNewView() {
  const api = useApi();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const kind = searchParams.get('kind') === 'patch' ? 'patch' : 'draft';
  const recordId = searchParams.get('recordId');
  const repairSummary = searchParams.get('repairSummary')?.trim() ?? '';
  const playbook = usePlaybook(kind === 'patch' ? recordId ?? undefined : undefined);
  const workspaces = useWorkspaces();
  const projects = useProjects();
  const [draftForm, setDraftForm] = useState<DraftFormState>(() => emptyDraftFormState());
  const [patchForm, setPatchForm] = useState<PatchFormState>(() => emptyPatchFormState(repairSummary));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const patchInitializedForRecordId = useRef<string | null>(null);
  const previousKind = useRef<ProposalKind>(kind);

  useEffect(() => {
    if (previousKind.current === kind) return;
    previousKind.current = kind;
    setSubmitError(null);
    if (kind === 'draft') {
      setDraftForm((current) => ({ ...emptyDraftFormState(), scope: current.scope }));
      return;
    }
    setPatchForm(emptyPatchFormState(repairSummary));
    patchInitializedForRecordId.current = null;
  }, [kind, repairSummary]);

  useEffect(() => {
    if (kind !== 'patch' || !playbook.data) return;
    if (patchInitializedForRecordId.current === playbook.data.recordId) return;
    setPatchForm({
      title: playbook.data.title,
      allowedProfileIdsText: playbook.data.allowedProfileIds.join(', '),
      summary: repairSummary,
      body: playbook.data.body,
    });
    patchInitializedForRecordId.current = playbook.data.recordId;
  }, [kind, playbook.data, repairSummary]);

  const availableProjects = useMemo(
    () => (projects.data ?? []).filter((project) => project.workspaceId === draftForm.workspaceId),
    [draftForm.workspaceId, projects.data],
  );

  useEffect(() => {
    if (kind !== 'draft') return;
    if (draftForm.scope === 'global') {
      if (draftForm.workspaceId !== '' || draftForm.projectId !== '') {
        setDraftForm((current) => ({ ...current, workspaceId: '', projectId: '' }));
      }
      return;
    }
    if (draftForm.scope === 'workspace' && draftForm.projectId !== '') {
      setDraftForm((current) => ({ ...current, projectId: '' }));
      return;
    }
    if (draftForm.scope === 'project' && draftForm.projectId !== '' && !availableProjects.some((project) => project.id === draftForm.projectId)) {
      setDraftForm((current) => ({ ...current, projectId: '' }));
    }
  }, [availableProjects, draftForm.projectId, draftForm.scope, draftForm.workspaceId, kind]);

  if (kind === 'patch' && !recordId) {
    return <ErrorDisplay message="Patch proposals require a canonical playbook record ID." />;
  }

  if (kind === 'patch' && playbook.loading && !playbook.data) {
    return <Loading />;
  }

  if (kind === 'patch' && playbook.error) {
    return <ErrorDisplay message={playbook.error} />;
  }

  if (kind === 'patch' && !playbook.data) {
    return <ErrorDisplay message="Canonical playbook not found for patch proposal." />;
  }

  const patchPlaybook = kind === 'patch' ? playbook.data : null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setSubmitting(true);
      setSubmitError(null);

      if (kind === 'draft') {
        if (draftForm.playbookId.trim().length === 0) throw new Error('Playbook ID is required.');
        if (draftForm.title.trim().length === 0) throw new Error('Title is required.');
        if (draftForm.body.trim().length === 0) throw new Error('Body is required.');
        if (draftForm.scope !== 'global' && draftForm.workspaceId.trim().length === 0) {
          throw new Error('Workspace selection is required for this scope.');
        }
        if (draftForm.scope === 'project' && draftForm.projectId.trim().length === 0) {
          throw new Error('Project selection is required for project-scoped drafts.');
        }
      } else {
        if (patchForm.title.trim().length === 0) throw new Error('Title is required.');
        if (patchForm.body.trim().length === 0) throw new Error('Body is required.');
      }

      const created = kind === 'draft'
        ? await api.post<PlaybookProposalRecord>('/v1/playbook-proposals', {
            kind: 'draft',
            playbookId: draftForm.playbookId.trim(),
            scope: draftForm.scope,
            workspaceId: draftForm.scope === 'global' ? null : draftForm.workspaceId || null,
            projectId: draftForm.scope === 'project' ? draftForm.projectId || null : null,
            title: draftForm.title.trim(),
            allowedProfileIds: parseAllowedProfileIds(draftForm.allowedProfileIdsText),
            summary: draftForm.summary.trim(),
            body: draftForm.body.trim(),
          })
        : await api.post<PlaybookProposalRecord>('/v1/playbook-proposals', {
            kind: 'patch',
            targetRecordId: patchPlaybook!.recordId,
            baseRevisionHash: patchPlaybook!.currentRevisionHash,
            title: patchForm.title.trim(),
            allowedProfileIds: parseAllowedProfileIds(patchForm.allowedProfileIdsText),
            summary: patchForm.summary.trim(),
            body: patchForm.body.trim(),
          });

      navigate(`/playbook-proposals/${encodeURIComponent(created.id)}`);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Proposal creation failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={kind === 'draft' ? 'New Playbook Proposal' : 'New Patch Proposal'}
        description={kind === 'draft'
          ? 'Create a draft playbook proposal for operator review before any canonical file is written.'
          : `${patchPlaybook!.title} · ${patchPlaybook!.recordId}`}
      />

      <div className="mb-[20px] flex flex-wrap gap-[12px]">
        <Link
          className={`rounded-[var(--radius-sm)] border px-[14px] py-[8px] text-[13px] font-medium ${kind === 'draft' ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-[var(--color-border)]'}`}
          to={buildPlaybookProposalAuthoringPath({ kind: 'draft' })}
        >
          Draft proposal
        </Link>
        <Link
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[14px] py-[8px] text-[13px] font-medium"
          to="/playbook-proposals"
        >
          Review proposals
        </Link>
        {kind === 'patch' ? (
          <Link
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[14px] py-[8px] text-[13px] font-medium"
            to={`/playbooks/${encodeURIComponent(patchPlaybook!.recordId)}`}
          >
            Back to playbook
          </Link>
        ) : null}
      </div>

      {submitError ? (
        <div className="mb-[16px]">
          <ErrorDisplay message={submitError} />
        </div>
      ) : null}

      <form className="space-y-[24px]" noValidate onSubmit={(event) => void handleSubmit(event)}>
        {kind === 'draft' ? (
          <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
            <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Draft proposal</h2>
            <div className="mt-[16px] grid gap-[16px] md:grid-cols-2">
              <label>
                <span className="mb-[6px] block text-[12px] font-medium text-[var(--color-fg-muted)]">Playbook ID</span>
                <input
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px]"
                  onChange={(event) => setDraftForm((current) => ({ ...current, playbookId: event.target.value }))}
                  placeholder="triage"
                  required
                  value={draftForm.playbookId}
                />
              </label>
              <label>
                <span className="mb-[6px] block text-[12px] font-medium text-[var(--color-fg-muted)]">Title</span>
                <input
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px]"
                  onChange={(event) => setDraftForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="Inbox triage"
                  required
                  value={draftForm.title}
                />
              </label>
              <label>
                <span className="mb-[6px] block text-[12px] font-medium text-[var(--color-fg-muted)]">Scope</span>
                <select
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px]"
                  onChange={(event) => setDraftForm((current) => ({ ...current, scope: event.target.value as DraftScope }))}
                  value={draftForm.scope}
                >
                  <option value="global">Global</option>
                  <option value="workspace">Workspace</option>
                  <option value="project">Project</option>
                </select>
              </label>
              <label>
                <span className="mb-[6px] block text-[12px] font-medium text-[var(--color-fg-muted)]">Allowed profiles</span>
                <input
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px]"
                  onChange={(event) => setDraftForm((current) => ({ ...current, allowedProfileIdsText: event.target.value }))}
                  placeholder="default, reviewer"
                  value={draftForm.allowedProfileIdsText}
                />
              </label>
              {draftForm.scope !== 'global' ? (
                <label>
                  <span className="mb-[6px] block text-[12px] font-medium text-[var(--color-fg-muted)]">Workspace</span>
                  <select
                    className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px]"
                    onChange={(event) => setDraftForm((current) => ({ ...current, workspaceId: event.target.value }))}
                    required
                    value={draftForm.workspaceId}
                  >
                    <option value="">Select workspace</option>
                    {(workspaces.data ?? []).map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              {draftForm.scope === 'project' ? (
                <label>
                  <span className="mb-[6px] block text-[12px] font-medium text-[var(--color-fg-muted)]">Project</span>
                  <select
                    className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px]"
                    onChange={(event) => setDraftForm((current) => ({ ...current, projectId: event.target.value }))}
                    required
                    value={draftForm.projectId}
                  >
                    <option value="">Select project</option>
                    {availableProjects.map((project) => (
                      <option key={project.id} value={project.id}>{project.name}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="md:col-span-2">
                <span className="mb-[6px] block text-[12px] font-medium text-[var(--color-fg-muted)]">Summary</span>
                <input
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px]"
                  onChange={(event) => setDraftForm((current) => ({ ...current, summary: event.target.value }))}
                  placeholder="Why this draft should exist"
                  value={draftForm.summary}
                />
              </label>
              <label className="md:col-span-2">
                <span className="mb-[6px] block text-[12px] font-medium text-[var(--color-fg-muted)]">Body</span>
                <textarea
                  className="min-h-[260px] w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[10px] font-[var(--font-mono)] text-[13px]"
                  onChange={(event) => setDraftForm((current) => ({ ...current, body: event.target.value }))}
                  placeholder="Write the canonical playbook body..."
                  required
                  value={draftForm.body}
                />
              </label>
            </div>
          </section>
        ) : (
          <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
            <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">Patch proposal</h2>
            <div className="mt-[16px] grid gap-[16px] md:grid-cols-2">
              <ReadOnlyField label="Target record" value={patchPlaybook!.recordId} />
              <ReadOnlyField label="Base revision" mono value={patchPlaybook!.currentRevisionHash} />
              <label>
                <span className="mb-[6px] block text-[12px] font-medium text-[var(--color-fg-muted)]">Title</span>
                <input
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px]"
                  onChange={(event) => setPatchForm((current) => ({ ...current, title: event.target.value }))}
                  required
                  value={patchForm.title}
                />
              </label>
              <label>
                <span className="mb-[6px] block text-[12px] font-medium text-[var(--color-fg-muted)]">Allowed profiles</span>
                <input
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px]"
                  onChange={(event) => setPatchForm((current) => ({ ...current, allowedProfileIdsText: event.target.value }))}
                  value={patchForm.allowedProfileIdsText}
                />
              </label>
              <label className="md:col-span-2">
                <span className="mb-[6px] block text-[12px] font-medium text-[var(--color-fg-muted)]">Summary</span>
                <input
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px]"
                  onChange={(event) => setPatchForm((current) => ({ ...current, summary: event.target.value }))}
                  value={patchForm.summary}
                />
              </label>
              <label className="md:col-span-2">
                <span className="mb-[6px] block text-[12px] font-medium text-[var(--color-fg-muted)]">Body</span>
                <textarea
                  className="min-h-[260px] w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[10px] font-[var(--font-mono)] text-[13px]"
                  onChange={(event) => setPatchForm((current) => ({ ...current, body: event.target.value }))}
                  required
                  value={patchForm.body}
                />
              </label>
            </div>
          </section>
        )}

        {workspaces.error ? <ErrorDisplay message={workspaces.error} /> : null}
        {projects.error ? <ErrorDisplay message={projects.error} /> : null}

        <div className="flex flex-wrap gap-[12px]">
          <button
            className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[16px] py-[9px] text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
            disabled={submitting}
            type="submit"
          >
            {submitting ? 'Creating…' : 'Create proposal'}
          </button>
          <Link
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[16px] py-[9px] text-[13px] font-medium"
            to={kind === 'patch' ? `/playbooks/${encodeURIComponent(patchPlaybook!.recordId)}` : '/playbook-proposals'}
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

function ReadOnlyField({
  label,
  mono = false,
  value,
}: {
  label: string;
  mono?: boolean;
  value: string;
}) {
  return (
    <div>
      <span className="mb-[6px] block text-[12px] font-medium text-[var(--color-fg-muted)]">{label}</span>
      <div className={`rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-[12px] py-[8px] ${mono ? 'font-[var(--font-mono)] text-[12px]' : ''}`}>
        {value}
      </div>
    </div>
  );
}
