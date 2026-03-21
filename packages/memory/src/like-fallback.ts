import type Database from 'better-sqlite3';

import { buildLocationCondition } from './location.js';
import type { MemoryType } from './types.js';

/** Same shape as FtsCandidate from fts5-search — defined here to avoid circular import. */
export interface LikeFallbackCandidate {
  memoryId: string;
  description: string;
  content: string;
  memoryType: MemoryType;
  confidence: number;
  scope: string;
  workspaceId: string | null;
  projectId: string | null;
  sourceType: string;
  createdAt: string;
  lastReinforcedAt: string | null;
  durable: boolean;
  domain?: string | undefined;
  ftsRank: number;
}

/**
 * Split a search query into individual tokens for LIKE matching.
 * Strips FTS5 special characters, lowercases, removes empty tokens.
 */
export function splitQueryTokens(query: string): string[] {
  // Remove FTS5 operators: quotes, OR, AND, NOT, NEAR, *, ^, etc.
  const cleaned = query
    .replace(/['"(){}[\]^*]/g, ' ')
    .replace(/\b(OR|AND|NOT|NEAR)\b/gi, ' ')
    .toLowerCase()
    .trim();
  return cleaned.split(/\s+/).filter((t) => t.length > 1);
}

/**
 * Build a LIKE-based SQL query as fallback when FTS5 is broken.
 */
export function buildLikeQuery(
  query: string,
  filters: {
    scope?: string;
    workspaceId?: string | null;
    projectId?: string | null;
    includeGlobal?: boolean;
    minConfidence?: number;
    memoryTypes?: MemoryType[];
    domains?: string[];
    limit?: number;
  },
  limit = 60,
): { sql: string; params: unknown[] } {
  const tokens = splitQueryTokens(query);
  if (tokens.length === 0) return { sql: '', params: [] };

  const effectiveLimit = filters.limit ?? limit;
  const params: unknown[] = [];
  const conditions: string[] = ['archived_at IS NULL'];

  // Token matching — each token matches description OR content
  const tokenConditions: string[] = [];
  for (const token of tokens) {
    const pattern = `%${token}%`;
    tokenConditions.push('(LOWER(description) LIKE ? OR LOWER(content) LIKE ?)');
    params.push(pattern, pattern);
  }
  conditions.push(`(${tokenConditions.join(' OR ')})`);

  if (filters.minConfidence !== undefined) {
    conditions.push('confidence >= ?');
    params.push(filters.minConfidence);
  }
  if (filters.scope !== undefined) {
    conditions.push('scope = ?');
    params.push(filters.scope);
  } else if (filters.workspaceId !== undefined || filters.projectId !== undefined || filters.includeGlobal) {
    const location = buildLocationCondition('', {
      workspaceId: filters.workspaceId ?? null,
      projectId: filters.projectId ?? null,
      includeGlobal: filters.includeGlobal,
    });
    if (location.sql) {
      conditions.push(location.sql);
      params.push(...location.params);
    }
  }
  if (filters.memoryTypes !== undefined && filters.memoryTypes.length > 0) {
    const placeholders = filters.memoryTypes.map(() => '?').join(', ');
    conditions.push(`memory_type IN (${placeholders})`);
    params.push(...filters.memoryTypes);
  }
  if (filters.domains !== undefined && filters.domains.length > 0) {
    const placeholders = filters.domains.map(() => '?').join(', ');
    conditions.push(`domain IN (${placeholders})`);
    params.push(...filters.domains);
  }

  params.push(effectiveLimit);

  const sql = `SELECT id, description, content, memory_type, confidence, scope, workspace_id, project_id, source_type, created_at, last_reinforced_at, durable, domain
FROM memories
WHERE ${conditions.join(' AND ')}
ORDER BY confidence DESC
LIMIT ?`;

  return { sql, params };
}

/**
 * Compute a synthetic FTS rank matching FTS5 convention:
 * closer to 0 = more relevant, further from 0 = less relevant.
 */
function computeSyntheticRank(description: string, content: string, tokens: string[]): number {
  if (tokens.length === 0) return -1;
  const text = `${description} ${content}`.toLowerCase();
  let matched = 0;
  for (const token of tokens) {
    if (text.includes(token)) matched++;
  }
  // FTS5 convention: closer to 0 = more relevant
  // All matched → -0.01, none matched → -1.01
  const matchRatio = matched / tokens.length;
  return -(1 - matchRatio) - 0.01;
}

/**
 * LIKE-based fallback search when FTS5 fails.
 */
export function searchLikeFallback(
  db: Database.Database,
  query: string,
  filters: {
    scope?: string;
    workspaceId?: string | null;
    projectId?: string | null;
    includeGlobal?: boolean;
    minConfidence?: number;
    memoryTypes?: MemoryType[];
    domains?: string[];
    limit?: number;
  },
  limit = 60,
): LikeFallbackCandidate[] {
  const { sql, params } = buildLikeQuery(query, filters, limit);
  if (!sql) return [];

  const tokens = splitQueryTokens(query);

  const rows = db.prepare(sql).all(...params) as Array<{
    id: string;
    description: string;
    content: string;
    memory_type: string;
    confidence: number;
    scope: string;
    workspace_id: string | null;
    project_id: string | null;
    source_type: string;
    created_at: string;
    last_reinforced_at: string | null;
    durable: number;
    domain: string | null;
  }>;

  return rows.map((row) => ({
    memoryId: row.id,
    description: row.description,
    content: row.content,
    memoryType: row.memory_type as MemoryType,
    confidence: row.confidence,
    scope: row.scope,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    sourceType: row.source_type,
    createdAt: row.created_at,
    lastReinforcedAt: row.last_reinforced_at,
    durable: Boolean(row.durable),
    domain: row.domain ?? undefined,
    ftsRank: computeSyntheticRank(row.description, row.content, tokens),
  }));
}
