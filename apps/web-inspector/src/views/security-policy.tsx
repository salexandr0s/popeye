import { useSecurityPolicy } from '../api/hooks';
import { PageHeader } from '../components/page-header';
import { Loading } from '../components/loading';
import { ErrorDisplay } from '../components/error-display';
import { EmptyState } from '../components/empty-state';
import { Card } from '../components/card';

export function SecurityPolicy() {
  const { data, error, loading } = useSecurityPolicy();

  if (loading) return <Loading />;
  if (error) return <ErrorDisplay message={error} />;
  if (!data) {
    return <EmptyState title="No policy data" description="Security policy details are unavailable." />;
  }

  return (
    <div>
      <PageHeader
        title="Security Policy"
        description="Current domain sensitivity defaults and explicit approval rules enforced by the runtime."
      />

      <div className="mb-[24px] grid gap-[16px] md:grid-cols-2 xl:grid-cols-4">
        <Card label="Domain policies" value={data.domainPolicies.length} description="Default domain-level sensitivity and context posture" />
        <Card label="Approval rules" value={data.approvalRules.length} description="Explicit rule overrides on top of the default risk class" />
        <Card label="Default risk class" value={data.defaultRiskClass} description="Fallback when no rule or built-in default matches" />
        <Card label="Action defaults" value={data.actionDefaults.length} description="Built-in runtime action-policy matrix" />
      </div>

      <div className="grid gap-[24px] xl:grid-cols-3">
        <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
          <h2 className="text-[16px] font-semibold">Domain policies</h2>
          <div className="mt-[16px] space-y-[12px]">
            {data.domainPolicies.map((policy) => (
              <div key={policy.domain} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[12px]">
                <div className="flex items-center justify-between gap-[12px]">
                  <p className="font-medium">{policy.domain}</p>
                  <span className="text-[12px] text-[var(--color-fg-muted)]">{policy.sensitivity}</span>
                </div>
                <p className="mt-[6px] text-[13px] text-[var(--color-fg-muted)]">
                  Embeddings: {policy.embeddingPolicy} | Context release: {policy.contextReleasePolicy}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
          <h2 className="text-[16px] font-semibold">Action defaults</h2>
          <p className="mt-[6px] text-[13px] text-[var(--color-fg-muted)]">
            Built-in policy fallbacks used when no explicit approval rule matches.
          </p>
          <div className="mt-[16px] space-y-[12px]">
            {data.actionDefaults.map((rule, index) => (
              <div key={`${rule.scope}-${rule.domain ?? 'all'}-${rule.actionKind}-${index}`} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[12px]">
                <div className="flex items-center justify-between gap-[12px]">
                  <p className="font-medium">{rule.actionKind}</p>
                  <span className="text-[12px] text-[var(--color-fg-muted)]">{rule.riskClass}</span>
                </div>
                <p className="mt-[4px] text-[13px] text-[var(--color-fg-muted)]">
                  Scope: {rule.scope} | Domain: {rule.domain ?? 'all'}
                </p>
                <p className="mt-[4px] text-[13px] text-[var(--color-fg-muted)]">
                  Standing approval: {rule.standingApprovalEligible ? 'yes' : 'no'} | Automation grant: {rule.automationGrantEligible ? 'yes' : 'no'}
                </p>
                <p className="mt-[6px] text-[13px] text-[var(--color-fg-muted)]">{rule.reason}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
          <h2 className="text-[16px] font-semibold">Approval rules</h2>
          {data.approvalRules.length === 0 ? (
            <EmptyState
              title="No explicit rules"
              description="The runtime will fall back to the configured default risk class."
            />
          ) : (
            <div className="mt-[16px] space-y-[12px]">
              {data.approvalRules.map((rule, index) => (
                <div key={`${rule.scope}-${rule.domain}-${index}`} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[12px]">
                  <p className="font-medium">{rule.scope}</p>
                  <p className="mt-[4px] text-[13px] text-[var(--color-fg-muted)]">
                    Domain: {rule.domain} | Risk class: {rule.riskClass}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
