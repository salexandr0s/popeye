export interface MemoryLocation {
  workspaceId: string | null;
  projectId: string | null;
}

export interface MemoryLocationFilter extends MemoryLocation {
  includeGlobal?: boolean | undefined;
}

export interface CanonicalMemoryLocation extends MemoryLocation {
  scope: string;
}

export function formatMemoryScope(input: MemoryLocation): string {
  if (!input.workspaceId) {
    return 'global';
  }
  if (!input.projectId) {
    return input.workspaceId;
  }
  return `${input.workspaceId}/${input.projectId}`;
}

export function normalizeMemoryLocation(input: {
  scope?: string | undefined;
  workspaceId?: string | null | undefined;
  projectId?: string | null | undefined;
}): MemoryLocation {
  if (input.workspaceId !== undefined || input.projectId !== undefined) {
    return {
      workspaceId: input.workspaceId ?? null,
      projectId: input.projectId ?? null,
    };
  }

  const scope = input.scope?.trim();
  if (!scope || scope === 'global') {
    return { workspaceId: null, projectId: null };
  }
  const separator = scope.indexOf('/');
  if (separator === -1) {
    return { workspaceId: scope, projectId: null };
  }
  const workspaceId = scope.slice(0, separator).trim();
  const projectId = scope.slice(separator + 1).trim();
  return {
    workspaceId: workspaceId.length > 0 ? workspaceId : null,
    projectId: projectId.length > 0 ? projectId : null,
  };
}

export function hasExplicitMemoryLocation(input: {
  workspaceId?: string | null | undefined;
  projectId?: string | null | undefined;
}): boolean {
  return input.workspaceId !== undefined || input.projectId !== undefined;
}

export function canonicalizeMemoryLocation(input: {
  scope?: string | undefined;
  workspaceId?: string | null | undefined;
  projectId?: string | null | undefined;
}): CanonicalMemoryLocation {
  const location = normalizeMemoryLocation(input);
  return {
    ...location,
    scope: formatMemoryScope(location),
  };
}

export function resolveMemoryLocationFilter(input: {
  scope?: string | undefined;
  workspaceId?: string | null | undefined;
  projectId?: string | null | undefined;
  includeGlobal?: boolean | undefined;
}): MemoryLocationFilter | undefined {
  const hasExplicitLocation = hasExplicitMemoryLocation(input);
  if (!hasExplicitLocation && input.scope === undefined && input.includeGlobal === undefined) {
    return undefined;
  }

  const location = hasExplicitLocation
    ? normalizeMemoryLocation({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
      })
    : normalizeMemoryLocation({
        scope: input.scope,
      });

  return {
    ...location,
    ...(input.includeGlobal !== undefined ? { includeGlobal: input.includeGlobal } : {}),
  };
}

export function buildLocationCondition(
  alias: string,
  filter: MemoryLocationFilter,
): { sql: string; params: unknown[] } {
  const column = (name: string): string => alias.length > 0 ? `${alias}.${name}` : name;

  if (filter.workspaceId && filter.projectId) {
    if (filter.includeGlobal) {
      return {
        sql: `(${column('workspace_id')} IS NULL OR (${column('workspace_id')} = ? AND (${column('project_id')} = ? OR ${column('project_id')} IS NULL)))`,
        params: [filter.workspaceId, filter.projectId],
      };
    }
    return {
      sql: `${column('workspace_id')} = ? AND (${column('project_id')} = ? OR ${column('project_id')} IS NULL)`,
      params: [filter.workspaceId, filter.projectId],
    };
  }

  if (filter.workspaceId) {
    if (filter.includeGlobal) {
      return {
        sql: `(${column('workspace_id')} IS NULL OR ${column('workspace_id')} = ?)`,
        params: [filter.workspaceId],
      };
    }
    return {
      sql: `${column('workspace_id')} = ?`,
      params: [filter.workspaceId],
    };
  }

  if (filter.includeGlobal) {
    return {
      sql: `${column('workspace_id')} IS NULL`,
      params: [],
    };
  }

  if (filter.projectId) {
    return {
      sql: `${column('project_id')} = ?`,
      params: [filter.projectId],
    };
  }

  return { sql: '', params: [] };
}

export function buildLegacyScopeCondition(
  columnName: string,
  filter: MemoryLocationFilter,
): { sql: string; params: unknown[] } {
  if (filter.workspaceId && filter.projectId) {
    const params: unknown[] = [`${filter.workspaceId}/${filter.projectId}`, filter.workspaceId];
    const scopeConditions = [`${columnName} = ?`, `${columnName} = ?`];
    if (filter.includeGlobal) {
      scopeConditions.push(`${columnName} = ?`);
      params.push('global');
    }
    return {
      sql: `(${scopeConditions.join(' OR ')})`,
      params,
    };
  }

  if (filter.workspaceId) {
    if (filter.includeGlobal) {
      return {
        sql: `(${columnName} = ? OR ${columnName} = 'global')`,
        params: [filter.workspaceId],
      };
    }
    return {
      sql: `${columnName} = ?`,
      params: [filter.workspaceId],
    };
  }

  if (filter.includeGlobal) {
    return {
      sql: `${columnName} = 'global'`,
      params: [],
    };
  }

  if (filter.projectId) {
    return {
      sql: `${columnName} LIKE ?`,
      params: [`%/${filter.projectId}`],
    };
  }

  return { sql: '', params: [] };
}

export function computeLocationScopeMatchScore(
  memory: MemoryLocation,
  query: MemoryLocationFilter | undefined,
): number {
  if (!query) return 0.5;
  if (memory.workspaceId === null) return query.includeGlobal ? 0.7 : 0.1;
  if (query.workspaceId === null) return memory.workspaceId === null ? 1.0 : 0.1;
  if (memory.workspaceId !== query.workspaceId) return 0.1;
  if (!query.projectId) return 1.0;
  if (!memory.projectId) return 0.85;
  return memory.projectId === query.projectId ? 1.0 : 0.1;
}

export function matchesMemoryLocation(
  memory: MemoryLocation,
  filter: MemoryLocationFilter | undefined,
): boolean {
  if (!filter) return true;

  if (filter.workspaceId && filter.projectId) {
    if (memory.workspaceId === filter.workspaceId && (memory.projectId === filter.projectId || memory.projectId === null)) {
      return true;
    }
    return Boolean(filter.includeGlobal && memory.workspaceId === null);
  }

  if (filter.workspaceId) {
    if (memory.workspaceId === filter.workspaceId) {
      return true;
    }
    return Boolean(filter.includeGlobal && memory.workspaceId === null);
  }

  if (filter.projectId) {
    return memory.projectId === filter.projectId;
  }

  if (filter.includeGlobal) {
    return memory.workspaceId === null;
  }

  return true;
}
