import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../api/provider';
import { buildInstructionPreviewPath } from '../api/routes';
import type { InstructionBundle } from '../api/hooks';
import { Loading } from '../components/loading';
import { ErrorDisplay } from '../components/error-display';
import { PageHeader } from '../components/page-header';

export function Instructions() {
  const api = useApi();
  const [searchParams, setSearchParams] = useSearchParams();
  const workspaceFromParams = searchParams.get('workspaceId') ?? '';
  const projectFromParams = searchParams.get('projectId') ?? '';
  const [workspaceId, setWorkspaceId] = useState(workspaceFromParams || 'default');
  const [projectId, setProjectId] = useState(projectFromParams);
  const [bundle, setBundle] = useState<InstructionBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchPreview = useCallback(async (nextWorkspaceId: string, nextProjectId: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<InstructionBundle>(
        buildInstructionPreviewPath(nextWorkspaceId, nextProjectId || undefined),
      );
      setBundle(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setBundle(null);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    setWorkspaceId(workspaceFromParams || 'default');
    setProjectId(projectFromParams);
  }, [projectFromParams, workspaceFromParams]);

  useEffect(() => {
    if (!workspaceFromParams.trim()) return;
    void fetchPreview(workspaceFromParams.trim(), projectFromParams.trim());
  }, [fetchPreview, projectFromParams, workspaceFromParams]);

  const handleFetch = () => {
    const normalizedWorkspaceId = workspaceId.trim();
    const normalizedProjectId = projectId.trim();
    if (!normalizedWorkspaceId) return;

    const params = new URLSearchParams({ workspaceId: normalizedWorkspaceId });
    if (normalizedProjectId) params.set('projectId', normalizedProjectId);
    setSearchParams(params);
  };

  return (
    <div>
      <PageHeader
        title="Instructions"
        description="Preview compiled instruction bundles"
      />

      <div className="flex gap-[8px] items-end mb-[24px]">
        <div>
          <label
            className="block text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide mb-[4px]"
            htmlFor="instructions-workspace-id"
          >
            Workspace ID
          </label>
          <input
            id="instructions-workspace-id"
            type="text"
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            className="px-[12px] py-[8px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[14px] text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)] transition-colors duration-[var(--duration-fast)] w-[200px]"
          />
        </div>
        <div>
          <label
            className="block text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide mb-[4px]"
            htmlFor="instructions-project-id"
          >
            Project ID (optional)
          </label>
          <input
            id="instructions-project-id"
            type="text"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder="e.g. my-project"
            className="px-[12px] py-[8px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[14px] text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)] transition-colors duration-[var(--duration-fast)] w-[200px] placeholder:text-[var(--color-fg-muted)]/50"
          />
        </div>
        <button
          onClick={handleFetch}
          disabled={loading || !workspaceId.trim()}
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
              {bundle.sources.map((src: InstructionBundle['sources'][number], i: number) => (
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
                {bundle.warnings.map((w: string, i: number) => (
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
