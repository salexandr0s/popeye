export interface MemorySearchPathOptions {
  query: string;
  scope?: string;
  types?: string[];
  includeContent?: boolean;
  limit?: number;
}

export interface PlaybookListPathOptions {
  q?: string;
  scope?: string;
  status?: string;
  workspaceId?: string;
  projectId?: string;
  limit?: number;
  offset?: number;
}

export interface PlaybookProposalListPathOptions {
  q?: string;
  status?: string;
  kind?: string;
  scope?: string;
  sourceRunId?: string;
  targetRecordId?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}

export interface PlaybookUsageListPathOptions {
  limit?: number;
  offset?: number;
}

export interface InstructionPreviewPathOptions {
  projectId?: string;
  profileId?: string;
  cwd?: string;
  identity?: string;
  explain?: boolean;
}

export interface PlaybookRecommendPathOptions {
  query: string;
  workspaceId: string;
  projectId?: string;
  profileId?: string;
  identityId?: string;
  limit?: number;
}

export function buildInstructionPreviewPath(
  scope: string,
  projectIdOrOptions: string | InstructionPreviewPathOptions = {},
): string {
  const options = typeof projectIdOrOptions === 'string'
    ? { projectId: projectIdOrOptions }
    : projectIdOrOptions;
  const basePath = options.explain
    ? `/v1/instruction-previews/${encodeURIComponent(scope)}/explain`
    : `/v1/instruction-previews/${encodeURIComponent(scope)}`;
  const params = new URLSearchParams();
  if (options.projectId) params.set('projectId', options.projectId);
  if (options.profileId) params.set('profileId', options.profileId);
  if (options.cwd) params.set('cwd', options.cwd);
  if (options.identity) params.set('identity', options.identity);
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function buildPlaybookRecommendPath(options: PlaybookRecommendPathOptions): string {
  const params = new URLSearchParams({
    q: options.query,
    workspaceId: options.workspaceId,
  });
  if (options.projectId) params.set('projectId', options.projectId);
  if (options.profileId) params.set('profileId', options.profileId);
  if (options.identityId) params.set('identityId', options.identityId);
  if (typeof options.limit === 'number') params.set('limit', String(options.limit));
  return `/v1/playbooks/recommend?${params.toString()}`;
}

export function buildInstructionDiffPath(): string {
  return '/v1/instruction-previews/diff';
}

export function buildMemorySearchPath(options: MemorySearchPathOptions): string {
  const params = new URLSearchParams({ q: options.query });
  if (options.scope) params.set('scope', options.scope);
  if (options.types && options.types.length > 0) params.set('types', options.types.join(','));
  if (typeof options.limit === 'number') params.set('limit', String(options.limit));
  if (options.includeContent) params.set('full', 'true');
  return `/v1/memory/search?${params.toString()}`;
}

export function buildPlaybookListPath(options: PlaybookListPathOptions = {}): string {
  const params = new URLSearchParams();
  if (options.q && options.q.trim().length > 0) params.set('q', options.q.trim());
  if (options.scope) params.set('scope', options.scope);
  if (options.status) params.set('status', options.status);
  if (options.workspaceId) params.set('workspaceId', options.workspaceId);
  if (options.projectId) params.set('projectId', options.projectId);
  if (typeof options.limit === 'number') params.set('limit', String(options.limit));
  if (typeof options.offset === 'number') params.set('offset', String(options.offset));
  const query = params.toString();
  return query ? `/v1/playbooks?${query}` : '/v1/playbooks';
}

export function buildPlaybookProposalListPath(options: PlaybookProposalListPathOptions = {}): string {
  const params = new URLSearchParams();
  if (options.q && options.q.trim().length > 0) params.set('q', options.q.trim());
  if (options.status) params.set('status', options.status);
  if (options.kind) params.set('kind', options.kind);
  if (options.scope) params.set('scope', options.scope);
  if (options.sourceRunId) params.set('sourceRunId', options.sourceRunId);
  if (options.targetRecordId) params.set('targetRecordId', options.targetRecordId);
  if (options.sort) params.set('sort', options.sort);
  if (typeof options.limit === 'number') params.set('limit', String(options.limit));
  if (typeof options.offset === 'number') params.set('offset', String(options.offset));
  const query = params.toString();
  return query ? `/v1/playbook-proposals?${query}` : '/v1/playbook-proposals';
}

export function buildPlaybookUsagePath(recordId: string, options: PlaybookUsageListPathOptions = {}): string {
  const params = new URLSearchParams();
  if (typeof options.limit === 'number') params.set('limit', String(options.limit));
  if (typeof options.offset === 'number') params.set('offset', String(options.offset));
  const query = params.toString();
  const base = `/v1/playbooks/${encodeURIComponent(recordId)}/usage`;
  return query ? `${base}?${query}` : base;
}
