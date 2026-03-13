import { useState } from 'react';
import { useApi } from '../api/provider';
import type { InstructionBundle } from '../api/hooks';
import { Loading } from '../components/loading';
import { ErrorDisplay } from '../components/error-display';
import { PageHeader } from '../components/page-header';

export function Instructions() {
  const api = useApi();
  const [workspaceId, setWorkspaceId] = useState('default');
  const [projectId, setProjectId] = useState('');
  const [bundle, setBundle] = useState<InstructionBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFetch = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ workspaceId });
      if (projectId) params.set('projectId', projectId);
      const result = await api.get<InstructionBundle>(
        `/v1/instructions/preview?${params.toString()}`,
      );
      setBundle(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setBundle(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Instructions"
        description="Preview compiled instruction bundles"
      />

      <div className="flex gap-[8px] items-end mb-[24px]">
        <div>
          <label className="block text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide mb-[4px]">
            Workspace ID
          </label>
          <input
            type="text"
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            className="px-[12px] py-[8px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[14px] text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)] transition-colors duration-[var(--duration-fast)] w-[200px]"
          />
        </div>
        <div>
          <label className="block text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide mb-[4px]">
            Project ID (optional)
          </label>
          <input
            type="text"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder="e.g. my-project"
            className="px-[12px] py-[8px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[14px] text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)] transition-colors duration-[var(--duration-fast)] w-[200px] placeholder:text-[var(--color-fg-muted)]/50"
          />
        </div>
        <button
          onClick={() => void handleFetch()}
          disabled={loading || !workspaceId}
          className="px-[16px] py-[8px] rounded-[var(--radius-sm)] text-[14px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors duration-[var(--duration-fast)]"
        >
          {loading ? 'Fetching...' : 'Preview'}
        </button>
      </div>

      {error ? <ErrorDisplay message={error} /> : null}
      {loading ? <Loading /> : null}

      {bundle ? (
        <div className="space-y-[20px]">
          {/* Sources */}
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
            <h2 className="text-[14px] font-medium text-[var(--color-fg-muted)] uppercase tracking-wide mb-[12px]">
              Sources ({bundle.sources.length})
            </h2>
            <div className="space-y-[8px]">
              {bundle.sources.map((src, i) => (
                <div
                  key={i}
                  className="flex items-center gap-[12px] py-[4px]"
                >
                  <span className="text-[12px] font-mono text-[var(--color-fg-muted)] w-[20px] text-right">
                    {src.precedence}
                  </span>
                  <span className="text-[13px] font-medium text-[var(--color-fg)]">
                    {src.type}
                  </span>
                  {src.path ? (
                    <span className="text-[12px] font-mono text-[var(--color-fg-muted)]">
                      {src.path}
                    </span>
                  ) : null}
                  <span className="text-[11px] font-mono text-[var(--color-fg-muted)]/60">
                    {src.contentHash.slice(0, 8)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Warnings */}
          {bundle.warnings.length > 0 ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 p-[20px]">
              <h2 className="text-[14px] font-medium text-[var(--color-warning)] uppercase tracking-wide mb-[8px]">
                Warnings
              </h2>
              <ul className="space-y-[4px]">
                {bundle.warnings.map((w, i) => (
                  <li key={i} className="text-[14px] text-[var(--color-warning)]">
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Compiled text */}
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
            <h2 className="text-[14px] font-medium text-[var(--color-fg-muted)] uppercase tracking-wide mb-[8px]">
              Compiled Output
            </h2>
            <pre className="text-[13px] text-[var(--color-fg)] font-[var(--font-mono)] whitespace-pre-wrap bg-[var(--color-bg-muted)] rounded-[var(--radius-sm)] p-[12px] max-h-[600px] overflow-y-auto">
              {bundle.compiledText}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
