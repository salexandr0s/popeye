import { useMemo, useState } from 'react';
import { useApi } from '../api/provider';
import { useAutomationGrants } from '../api/hooks';
import { PageHeader } from '../components/page-header';
import { Loading } from '../components/loading';
import { ErrorDisplay } from '../components/error-display';
import { EmptyState } from '../components/empty-state';
import { DataTable, type Column } from '../components/data-table';
import { Badge } from '../components/badge';
import { Card } from '../components/card';

const scopeOptions = ['secret_access', 'vault_open', 'context_release', 'data_source_connect', 'external_write'] as const;
const domainOptions = ['general', 'email', 'calendar', 'todos', 'github', 'files', 'people', 'finance', 'medical'] as const;
const actionOptions = ['read', 'search', 'sync', 'import', 'digest', 'classify', 'triage', 'draft', 'connect', 'release_context', 'open_vault', 'write', 'send', 'delete'] as const;

export function AutomationGrants() {
  const { data, error, loading, refetch } = useAutomationGrants();
  const api = useApi();
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'revoked' | 'expired'>('all');
  const [domainFilter, setDomainFilter] = useState<'all' | (typeof domainOptions)[number]>('all');
  const [actionFilter, setActionFilter] = useState<'all' | (typeof actionOptions)[number]>('all');
  const [createError, setCreateError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [form, setForm] = useState({
    scope: 'external_write',
    domain: 'general',
    actionKind: 'digest',
    resourceType: '',
    resourceId: '',
    requestedBy: '',
    workspaceId: '',
    projectId: '',
    expiresAt: '',
    note: '',
  });

  const filtered = useMemo(() => (data ?? []).filter((record) => {
    if (statusFilter !== 'all' && record.status !== statusFilter) return false;
    if (domainFilter !== 'all' && record.domain !== domainFilter) return false;
    if (actionFilter !== 'all' && record.actionKind !== actionFilter) return false;
    return true;
  }), [actionFilter, data, domainFilter, statusFilter]);

  if (loading) return <Loading />;
  if (error) return <ErrorDisplay message={error} />;

  const handleCreate = async () => {
    try {
      setCreateError(null);
      await api.post('/v1/policies/automation-grants', {
        scope: form.scope,
        domain: form.domain,
        actionKind: form.actionKind,
        resourceType: form.resourceType.trim(),
        ...(form.resourceId.trim() ? { resourceId: form.resourceId.trim() } : {}),
        ...(form.requestedBy.trim() ? { requestedBy: form.requestedBy.trim() } : {}),
        ...(form.workspaceId.trim() ? { workspaceId: form.workspaceId.trim() } : {}),
        ...(form.projectId.trim() ? { projectId: form.projectId.trim() } : {}),
        ...(form.expiresAt.trim() ? { expiresAt: form.expiresAt.trim() } : {}),
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
        createdBy: 'web_inspector',
      });
      setForm({
        scope: 'external_write',
        domain: 'general',
        actionKind: 'digest',
        resourceType: '',
        resourceId: '',
        requestedBy: '',
        workspaceId: '',
        projectId: '',
        expiresAt: '',
        note: '',
      });
      refetch();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Automation grant creation failed');
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      setActionError(null);
      await api.post(`/v1/policies/automation-grants/${id}/revoke`, { revokedBy: 'web_inspector' });
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Automation grant revoke failed');
    }
  };

  const columns: Column<(typeof filtered)[number]>[] = [
    {
      key: 'status',
      header: 'Status',
      width: '120px',
      render: (row) => <Badge state={row.status} />,
    },
    {
      key: 'scope',
      header: 'Scope',
      render: (row) => row.scope,
    },
    {
      key: 'domain',
      header: 'Domain',
      render: (row) => row.domain,
    },
    {
      key: 'actionKind',
      header: 'Action',
      render: (row) => (
        <div>
          <p>{row.actionKind}</p>
          <p className="text-[12px] text-[var(--color-fg-muted)]">{row.resourceScope}</p>
        </div>
      ),
    },
    {
      key: 'resource',
      header: 'Resource',
      render: (row) => (
        <div>
          <p>{row.resourceType}</p>
          <p className="text-[12px] text-[var(--color-fg-muted)]">{row.resourceId ?? '*'}</p>
        </div>
      ),
    },
    {
      key: 'requestedBy',
      header: 'Requested by',
      render: (row) => row.requestedBy ?? '*',
    },
    {
      key: 'taskSources',
      header: 'Task sources',
      render: (row) => row.taskSources.join(', '),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '140px',
      render: (row) => row.status === 'active' ? (
        <button
          className="rounded-[var(--radius-sm)] bg-[var(--color-danger)]/10 px-[10px] py-[6px] text-[12px] font-medium text-[var(--color-danger)]"
          onClick={() => void handleRevoke(row.id)}
          type="button"
        >
          Revoke
        </button>
      ) : (
        <span className="text-[12px] text-[var(--color-fg-muted)]">No action</span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Automation Grants"
        description="Grant unattended automation permission to matching approval requests when the policy matrix marks them eligible."
      />

      <div className="mb-[24px] grid gap-[16px] md:grid-cols-3">
        <Card label="Total grants" value={data?.length ?? 0} description="Automation grants stored by the runtime" />
        <Card label="Active" value={(data ?? []).filter((record) => record.status === 'active').length} description="Eligible for automated resolution when policy allows" />
        <Card label="Filtered" value={filtered.length} description="Records visible under the current filters" />
      </div>

      <section className="mb-[24px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
        <h2 className="text-[16px] font-semibold">Create automation grant</h2>
        <div className="mt-[16px] grid gap-[12px] md:grid-cols-2 xl:grid-cols-3">
          <select value={form.scope} onChange={(event) => setForm((current) => ({ ...current, scope: event.target.value }))} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] px-[12px] py-[8px] text-[14px] text-[var(--color-fg)]">
            {scopeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <select value={form.domain} onChange={(event) => setForm((current) => ({ ...current, domain: event.target.value }))} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] px-[12px] py-[8px] text-[14px] text-[var(--color-fg)]">
            {domainOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <select value={form.actionKind} onChange={(event) => setForm((current) => ({ ...current, actionKind: event.target.value }))} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] px-[12px] py-[8px] text-[14px] text-[var(--color-fg)]">
            {actionOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <input value={form.resourceType} onChange={(event) => setForm((current) => ({ ...current, resourceType: event.target.value }))} placeholder="Resource type (required)" className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px] text-[14px] text-[var(--color-fg)]" />
          <input value={form.resourceId} onChange={(event) => setForm((current) => ({ ...current, resourceId: event.target.value }))} placeholder="Resource ID" className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px] text-[14px] text-[var(--color-fg)]" />
          <input value={form.requestedBy} onChange={(event) => setForm((current) => ({ ...current, requestedBy: event.target.value }))} placeholder="Requested by" className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px] text-[14px] text-[var(--color-fg)]" />
          <input value={form.workspaceId} onChange={(event) => setForm((current) => ({ ...current, workspaceId: event.target.value }))} placeholder="Workspace ID" className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px] text-[14px] text-[var(--color-fg)]" />
          <input value={form.projectId} onChange={(event) => setForm((current) => ({ ...current, projectId: event.target.value }))} placeholder="Project ID" className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px] text-[14px] text-[var(--color-fg)]" />
          <input value={form.expiresAt} onChange={(event) => setForm((current) => ({ ...current, expiresAt: event.target.value }))} placeholder="Expires at (ISO timestamp)" className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px] text-[14px] text-[var(--color-fg)]" />
        </div>
        <textarea value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder="Operator note" className="mt-[12px] min-h-[96px] w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[12px] py-[8px] text-[14px] text-[var(--color-fg)]" />
        <div className="mt-[12px] flex items-center gap-[12px]">
          <button
            className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[14px] py-[8px] text-[14px] font-medium text-white disabled:opacity-50"
            disabled={!form.resourceType.trim()}
            onClick={() => void handleCreate()}
            type="button"
          >
            Create automation grant
          </button>
          <p className="text-[12px] text-[var(--color-fg-muted)]">Uses default task sources from the control API unless configured elsewhere.</p>
        </div>
        {createError ? <div className="mt-[12px]"><ErrorDisplay message={createError} /></div> : null}
      </section>

      <div className="mb-[16px] flex flex-col gap-[12px] lg:flex-row">
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] px-[12px] py-[8px] text-[14px] text-[var(--color-fg)]">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="revoked">Revoked</option>
          <option value="expired">Expired</option>
        </select>
        <select value={domainFilter} onChange={(event) => setDomainFilter(event.target.value as typeof domainFilter)} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] px-[12px] py-[8px] text-[14px] text-[var(--color-fg)]">
          <option value="all">All domains</option>
          {domainOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value as typeof actionFilter)} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] px-[12px] py-[8px] text-[14px] text-[var(--color-fg)]">
          <option value="all">All actions</option>
          {actionOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </div>

      {actionError ? (
        <div className="mb-[16px]">
          <ErrorDisplay message={actionError} />
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState title="No automation grants" description="Create one above or adjust the filters to see existing grants." />
      ) : (
        <DataTable columns={columns} data={filtered} keyFn={(row) => row.id} />
      )}
    </div>
  );
}
