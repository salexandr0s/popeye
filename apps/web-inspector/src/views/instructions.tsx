import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  InstructionPreviewDiffResponse,
  InstructionPreviewExplainResponse,
  InstructionResolutionContext,
  PlaybookRecommendation,
} from '@popeye/contracts';
import { useApi } from '../api/provider';
import {
  buildInstructionDiffPath,
  buildInstructionPreviewPath,
  buildPlaybookRecommendPath,
} from '../api/routes';
import { Loading } from '../components/loading';
import { ErrorDisplay } from '../components/error-display';
import { PageHeader } from '../components/page-header';

function createContext(
  workspaceId: string,
  projectId: string,
  profileId: string,
  identity: string,
  cwd: string,
  taskBrief: string,
): InstructionResolutionContext {
  return {
    workspaceId,
    ...(projectId ? { projectId } : {}),
    ...(profileId ? { profileId } : {}),
    ...(identity ? { identity } : {}),
    ...(cwd ? { cwd } : {}),
    ...(taskBrief.trim() ? { taskBrief: taskBrief.trim() } : {}),
  };
}

export function Instructions() {
  const api = useApi();
  const [searchParams, setSearchParams] = useSearchParams();
  const workspaceFromParams = searchParams.get('workspaceId') ?? '';
  const projectFromParams = searchParams.get('projectId') ?? '';
  const profileFromParams = searchParams.get('profileId') ?? '';
  const identityFromParams = searchParams.get('identity') ?? '';
  const cwdFromParams = searchParams.get('cwd') ?? '';
  const [workspaceId, setWorkspaceId] = useState(workspaceFromParams || 'default');
  const [projectId, setProjectId] = useState(projectFromParams);
  const [profileId, setProfileId] = useState(profileFromParams);
  const [identity, setIdentity] = useState(identityFromParams);
  const [cwd, setCwd] = useState(cwdFromParams);
  const [taskBrief, setTaskBrief] = useState('');
  const [preview, setPreview] = useState<InstructionPreviewExplainResponse | null>(null);
  const [diff, setDiff] = useState<InstructionPreviewDiffResponse | null>(null);
  const [recommendations, setRecommendations] = useState<PlaybookRecommendation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const skipNextAutoFetchKeyRef = useRef<string | null>(null);

  const fetchPreview = useCallback(async (
    nextWorkspaceId: string,
    nextProjectId: string,
    nextProfileId: string,
    nextIdentity: string,
    nextCwd: string,
    nextTaskBrief: string,
  ) => {
    setLoading(true);
    setError(null);
    setPreview(null);
    setDiff(null);
    setDiffError(null);
    setRecommendations([]);
    try {
      const nextPreview = await api.get<InstructionPreviewExplainResponse>(
        buildInstructionPreviewPath(nextWorkspaceId, {
          projectId: nextProjectId || undefined,
          profileId: nextProfileId || undefined,
          identity: nextIdentity || undefined,
          cwd: nextCwd || undefined,
          explain: true,
        }),
      );
      setPreview(nextPreview);
      if (nextTaskBrief.trim().length > 0) {
        const nextRecommendations = await api.get<PlaybookRecommendation[]>(
          buildPlaybookRecommendPath({
            query: nextTaskBrief.trim(),
            workspaceId: nextWorkspaceId,
            projectId: nextProjectId || undefined,
            profileId: nextProfileId || undefined,
            identityId: nextIdentity || undefined,
            limit: 5,
          }),
        );
        setRecommendations(nextRecommendations);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setPreview(null);
      setRecommendations([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  const fetchDiff = useCallback(async (
    left: InstructionResolutionContext,
    right: InstructionResolutionContext,
  ) => {
    setDiffLoading(true);
    setDiffError(null);
    setDiff(null);
    try {
      const nextDiff = await api.post<InstructionPreviewDiffResponse>(buildInstructionDiffPath(), {
        left,
        right,
      });
      setDiff(nextDiff);
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : 'Unknown error');
      setDiff(null);
    } finally {
      setDiffLoading(false);
    }
  }, [api]);

  useEffect(() => {
    setWorkspaceId(workspaceFromParams || 'default');
    setProjectId(projectFromParams);
    setProfileId(profileFromParams);
    setIdentity(identityFromParams);
    setCwd(cwdFromParams);
  }, [cwdFromParams, identityFromParams, profileFromParams, projectFromParams, workspaceFromParams]);

  useEffect(() => {
    const fetchKey = [
      workspaceFromParams.trim(),
      projectFromParams.trim(),
      profileFromParams.trim(),
      identityFromParams.trim(),
      cwdFromParams.trim(),
    ].join('\u0000');
    if (!workspaceFromParams.trim()) return;
    if (skipNextAutoFetchKeyRef.current === fetchKey) {
      skipNextAutoFetchKeyRef.current = null;
      return;
    }
    void fetchPreview(
      workspaceFromParams.trim(),
      projectFromParams.trim(),
      profileFromParams.trim(),
      identityFromParams.trim(),
      cwdFromParams.trim(),
      '',
    );
  }, [cwdFromParams, fetchPreview, identityFromParams, profileFromParams, projectFromParams, workspaceFromParams]);

  const handleFetch = () => {
    const normalizedWorkspaceId = workspaceId.trim();
    const normalizedProjectId = projectId.trim();
    const normalizedProfileId = profileId.trim();
    const normalizedIdentity = identity.trim();
    const normalizedCwd = cwd.trim();
    if (!normalizedWorkspaceId) return;

    const params = new URLSearchParams({ workspaceId: normalizedWorkspaceId });
    if (normalizedProjectId) params.set('projectId', normalizedProjectId);
    if (normalizedProfileId) params.set('profileId', normalizedProfileId);
    if (normalizedIdentity) params.set('identity', normalizedIdentity);
    if (normalizedCwd) params.set('cwd', normalizedCwd);
    skipNextAutoFetchKeyRef.current = [
      normalizedWorkspaceId,
      normalizedProjectId,
      normalizedProfileId,
      normalizedIdentity,
      normalizedCwd,
    ].join('\u0000');
    setSearchParams(params);
    void fetchPreview(
      normalizedWorkspaceId,
      normalizedProjectId,
      normalizedProfileId,
      normalizedIdentity,
      normalizedCwd,
      taskBrief,
    );
  };

  const handleCompare = () => {
    if (!preview) return;
    const right = createContext(
      workspaceId.trim(),
      projectId.trim(),
      profileId.trim(),
      identity.trim(),
      cwd.trim(),
      taskBrief,
    );
    if (!right.workspaceId) return;
    void fetchDiff(preview.context, right);
  };

  return (
    <div>
      <PageHeader
        title="Instructions"
        description="Preview compiled instruction bundles and inspect how context composes"
      />

      <div className="grid gap-[12px] md:grid-cols-2 xl:grid-cols-3 mb-[24px]">
        <label className="block text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide">
          Workspace ID
          <input
            id="instructions-workspace-id"
            type="text"
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            className="mt-[4px] w-full px-[12px] py-[8px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[14px]"
          />
        </label>
        <label className="block text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide">
          Project ID
          <input
            id="instructions-project-id"
            type="text"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="mt-[4px] w-full px-[12px] py-[8px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[14px]"
          />
        </label>
        <label className="block text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide">
          Profile ID
          <input
            id="instructions-profile-id"
            type="text"
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            className="mt-[4px] w-full px-[12px] py-[8px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[14px]"
          />
        </label>
        <label className="block text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide">
          Identity
          <input
            id="instructions-identity-id"
            type="text"
            value={identity}
            onChange={(e) => setIdentity(e.target.value)}
            className="mt-[4px] w-full px-[12px] py-[8px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[14px]"
          />
        </label>
        <label className="block text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide md:col-span-2 xl:col-span-2">
          Effective CWD
          <input
            id="instructions-cwd"
            type="text"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            className="mt-[4px] w-full px-[12px] py-[8px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[14px]"
          />
        </label>
        <label className="block text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide md:col-span-2 xl:col-span-3">
          Task brief for playbook recommendations
          <textarea
            id="instructions-task-brief"
            value={taskBrief}
            onChange={(e) => setTaskBrief(e.target.value)}
            rows={3}
            className="mt-[4px] w-full px-[12px] py-[8px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[14px]"
          />
        </label>
      </div>

      <button
        onClick={handleFetch}
        disabled={loading || !workspaceId.trim()}
        className="px-[16px] py-[8px] rounded-[var(--radius-sm)] text-[14px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors duration-[var(--duration-fast)] mb-[24px]"
      >
        {loading ? 'Fetching...' : 'Preview'}
      </button>
      <button
        onClick={handleCompare}
        disabled={diffLoading || !preview || !workspaceId.trim()}
        className="ml-[12px] px-[16px] py-[8px] rounded-[var(--radius-sm)] text-[14px] font-medium border border-[var(--color-border)] text-[var(--color-fg)] bg-[var(--color-surface)] hover:bg-[var(--color-bg-muted)] disabled:opacity-50 transition-colors duration-[var(--duration-fast)] mb-[24px]"
      >
        {diffLoading ? 'Comparing...' : 'Compare'}
      </button>

      {error ? <ErrorDisplay message={error} /> : null}
      {diffError ? <ErrorDisplay message={diffError} /> : null}
      {loading ? <Loading /> : null}
      {diffLoading ? <Loading /> : null}

      {preview ? (
        <div className="space-y-[20px]">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
            <h2 className="text-[14px] font-medium text-[var(--color-fg-muted)] uppercase tracking-wide mb-[12px]">
              Effective context
            </h2>
            <pre className="text-[13px] text-[var(--color-fg)] font-[var(--font-mono)] whitespace-pre-wrap bg-[var(--color-bg-muted)] rounded-[var(--radius-sm)] p-[12px]">
              {JSON.stringify(preview.context, null, 2)}
            </pre>
          </div>

          {recommendations.length > 0 ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
              <h2 className="text-[14px] font-medium text-[var(--color-fg-muted)] uppercase tracking-wide mb-[12px]">
                Recommended playbooks
              </h2>
              <div className="space-y-[10px]">
                {recommendations.map((recommendation) => (
                  <div key={recommendation.recordId} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[12px]">
                    <div className="flex items-center justify-between gap-[12px]">
                      <div>
                        <div className="text-[14px] font-medium text-[var(--color-fg)]">{recommendation.title}</div>
                        <div className="text-[12px] text-[var(--color-fg-muted)]">{recommendation.scope} · score {recommendation.score.toFixed(2)}</div>
                      </div>
                      <code className="text-[11px] text-[var(--color-fg-muted)]">{recommendation.recordId}</code>
                    </div>
                    <p className="text-[13px] text-[var(--color-fg)] mt-[8px]">{recommendation.reason}</p>
                    {recommendation.snippet ? (
                      <pre className="mt-[8px] text-[12px] whitespace-pre-wrap text-[var(--color-fg-muted)] bg-[var(--color-bg-muted)] rounded-[var(--radius-sm)] p-[8px]">{recommendation.snippet}</pre>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {diff ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
              <h2 className="text-[14px] font-medium text-[var(--color-fg-muted)] uppercase tracking-wide mb-[12px]">
                Bundle diff
              </h2>
              <div className="grid gap-[16px] lg:grid-cols-2 mb-[16px]">
                <div>
                  <div className="text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide mb-[6px]">Left context</div>
                  <pre className="text-[12px] text-[var(--color-fg)] font-[var(--font-mono)] whitespace-pre-wrap bg-[var(--color-bg-muted)] rounded-[var(--radius-sm)] p-[12px]">
                    {JSON.stringify(diff.leftContext, null, 2)}
                  </pre>
                </div>
                <div>
                  <div className="text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide mb-[6px]">Right context</div>
                  <pre className="text-[12px] text-[var(--color-fg)] font-[var(--font-mono)] whitespace-pre-wrap bg-[var(--color-bg-muted)] rounded-[var(--radius-sm)] p-[12px]">
                    {JSON.stringify(diff.rightContext, null, 2)}
                  </pre>
                </div>
              </div>
              <div className="grid gap-[12px] md:grid-cols-3 mb-[16px]">
                <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[12px]">
                  <div className="text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide">Bundle hashes</div>
                  <div className="text-[12px] font-mono text-[var(--color-fg)] mt-[8px] break-all">{diff.leftBundleHash}</div>
                  <div className="text-[12px] font-mono text-[var(--color-fg-muted)] mt-[4px] break-all">{diff.rightBundleHash}</div>
                </div>
                <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[12px]">
                  <div className="text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide">Compiled text changed</div>
                  <div className="text-[14px] text-[var(--color-fg)] mt-[8px]">{diff.compiledTextChanged ? 'Yes' : 'No'}</div>
                </div>
                <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[12px]">
                  <div className="text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide">Source delta</div>
                  <div className="text-[14px] text-[var(--color-fg)] mt-[8px]">
                    +{diff.addedSources.length} / -{diff.removedSources.length} / ↕{diff.reorderedSources.length}
                  </div>
                </div>
              </div>
              <div className="grid gap-[16px] xl:grid-cols-3">
                <div>
                  <h3 className="text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide mb-[8px]">Added sources</h3>
                  {diff.addedSources.length > 0 ? (
                    <div className="space-y-[8px]">
                      {diff.addedSources.map((source, index) => (
                        <div key={`added:${source.contentHash}:${index}`} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[10px]">
                          <div className="text-[13px] font-medium text-[var(--color-fg)]">{source.type}</div>
                          <div className="text-[12px] text-[var(--color-fg-muted)]">P{source.precedence} · #{source.bandOrder}</div>
                          <div className="text-[12px] font-mono text-[var(--color-fg-muted)] break-all mt-[4px]">{source.path ?? source.inlineId ?? '(inline)'}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[13px] text-[var(--color-fg-muted)]">No added sources.</div>
                  )}
                </div>
                <div>
                  <h3 className="text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide mb-[8px]">Removed sources</h3>
                  {diff.removedSources.length > 0 ? (
                    <div className="space-y-[8px]">
                      {diff.removedSources.map((source, index) => (
                        <div key={`removed:${source.contentHash}:${index}`} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[10px]">
                          <div className="text-[13px] font-medium text-[var(--color-fg)]">{source.type}</div>
                          <div className="text-[12px] text-[var(--color-fg-muted)]">P{source.precedence} · #{source.bandOrder}</div>
                          <div className="text-[12px] font-mono text-[var(--color-fg-muted)] break-all mt-[4px]">{source.path ?? source.inlineId ?? '(inline)'}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[13px] text-[var(--color-fg-muted)]">No removed sources.</div>
                  )}
                </div>
                <div>
                  <h3 className="text-[12px] text-[var(--color-fg-muted)] uppercase tracking-wide mb-[8px]">Reordered sources</h3>
                  {diff.reorderedSources.length > 0 ? (
                    <div className="space-y-[8px]">
                      {diff.reorderedSources.map((entry, index) => (
                        <div key={`reordered:${entry.source.contentHash}:${index}`} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-[10px]">
                          <div className="text-[13px] font-medium text-[var(--color-fg)]">{entry.source.type}</div>
                          <div className="text-[12px] text-[var(--color-fg-muted)]">{entry.leftIndex} → {entry.rightIndex}</div>
                          <div className="text-[12px] font-mono text-[var(--color-fg-muted)] break-all mt-[4px]">{entry.source.path ?? entry.source.inlineId ?? '(inline)'}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[13px] text-[var(--color-fg-muted)]">No reordered sources.</div>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
            <h2 className="text-[14px] font-medium text-[var(--color-fg-muted)] uppercase tracking-wide mb-[12px]">
              Sources ({preview.sources.length})
            </h2>
            <div className="space-y-[8px]">
              {preview.sources.map((src, i) => (
                <div key={`${src.type}:${src.contentHash}:${i}`} className="grid gap-[8px] md:grid-cols-[48px_64px_140px_1fr_auto] items-center py-[4px]">
                  <span className="text-[12px] font-mono text-[var(--color-fg-muted)]">P{src.precedence}</span>
                  <span className="text-[12px] font-mono text-[var(--color-fg-muted)]">#{src.bandOrder}</span>
                  <span className="text-[13px] font-medium text-[var(--color-fg)]">{src.type}</span>
                  <span className="text-[12px] font-mono text-[var(--color-fg-muted)] break-all">{src.path ?? src.inlineId ?? '(inline)'}</span>
                  <span className="text-[11px] font-mono text-[var(--color-fg-muted)]/60">{src.contentHash.slice(0, 8)}</span>
                </div>
              ))}
            </div>
          </div>

          {preview.bundle.warnings.length > 0 ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 p-[20px]">
              <h2 className="text-[14px] font-medium text-[var(--color-warning)] uppercase tracking-wide mb-[8px]">Warnings</h2>
              <ul className="space-y-[4px]">
                {preview.bundle.warnings.map((warning, index) => (
                  <li key={`${warning}:${index}`} className="text-[14px] text-[var(--color-warning)]">{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px]">
            <h2 className="text-[14px] font-medium text-[var(--color-fg-muted)] uppercase tracking-wide mb-[8px]">Compiled Output</h2>
            <pre className="text-[13px] text-[var(--color-fg)] font-[var(--font-mono)] whitespace-pre-wrap bg-[var(--color-bg-muted)] rounded-[var(--radius-sm)] p-[12px] max-h-[600px] overflow-y-auto">
              {preview.bundle.compiledText}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
