export interface MemorySearchPathOptions {
  query: string;
  scope?: string;
  types?: string[];
  includeContent?: boolean;
  limit?: number;
}

export function buildInstructionPreviewPath(scope: string, projectId?: string): string {
  const basePath = `/v1/instruction-previews/${encodeURIComponent(scope)}`;
  if (!projectId) return basePath;
  const params = new URLSearchParams({ projectId });
  return `${basePath}?${params.toString()}`;
}

export function buildMemorySearchPath(options: MemorySearchPathOptions): string {
  const params = new URLSearchParams({ q: options.query });
  if (options.scope) params.set('scope', options.scope);
  if (options.types && options.types.length > 0) params.set('types', options.types.join(','));
  if (typeof options.limit === 'number') params.set('limit', String(options.limit));
  if (options.includeContent) params.set('full', 'true');
  return `/v1/memory/search?${params.toString()}`;
}
