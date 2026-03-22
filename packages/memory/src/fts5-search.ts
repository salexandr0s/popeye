import type Database from 'better-sqlite3';

import { buildLocationCondition, normalizeMemoryLocation } from './location.js';
import type { MemoryLayer, MemoryType } from './types.js';

import { buildFts5MatchExpression } from './pure-functions.js';

export interface FtsCandidate {
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
  ftsRank: number;
  layer?: MemoryLayer | undefined;
  namespaceId?: string | undefined;
  occurredAt?: string | null | undefined;
  validFrom?: string | null | undefined;
  validTo?: string | null | undefined;
  evidenceCount?: number | undefined;
  revisionStatus?: 'active' | 'superseded' | undefined;
  domain?: string | undefined;
}

export function searchFactsFts5(
  db: Database.Database,
  query: string,
  filters: {
    scope?: string;
    workspaceId?: string | null;
    projectId?: string | null;
    includeGlobal?: boolean;
    minConfidence?: number;
    memoryTypes?: MemoryType[];
    namespaceIds?: string[];
    tags?: string[];
    domains?: string[];
    includeSuperseded?: boolean;
    occurredAfter?: string;
    occurredBefore?: string;
    limit?: number;
  },
  limit = 60,
): FtsCandidate[] {
  const matchExpr = buildFts5MatchExpression(query);
  if (matchExpr === '""') return [];

  const effectiveLimit = filters.limit ?? limit;
  const hasExplicitLocation = filters.workspaceId !== undefined || filters.projectId !== undefined;
  const params: unknown[] = [matchExpr];
  const conditions: string[] = [
    'memory_facts_fts MATCH ?',
    'f.archived_at IS NULL',
  ];

  if (filters.minConfidence !== undefined) {
    conditions.push('f.confidence >= ?');
    params.push(filters.minConfidence);
  }
  if (hasExplicitLocation || (filters.scope === undefined && filters.includeGlobal !== undefined)) {
    const location = buildLocationCondition('f', {
      workspaceId: filters.workspaceId ?? null,
      projectId: filters.projectId ?? null,
      includeGlobal: filters.includeGlobal,
    });
    if (location.sql) {
      conditions.push(location.sql);
      params.push(...location.params);
    }
  } else if (filters.scope !== undefined) {
    conditions.push('f.scope = ?');
    params.push(filters.scope);
  }
  if (!filters.includeSuperseded) {
    conditions.push("f.revision_status = 'active'");
    conditions.push('f.is_latest = 1');
  }
  if (filters.memoryTypes && filters.memoryTypes.length > 0) {
    const placeholders = filters.memoryTypes.map(() => '?').join(', ');
    conditions.push(`f.memory_type IN (${placeholders})`);
    params.push(...filters.memoryTypes);
  }
  if (filters.namespaceIds && filters.namespaceIds.length > 0) {
    const placeholders = filters.namespaceIds.map(() => '?').join(', ');
    conditions.push(`f.namespace_id IN (${placeholders})`);
    params.push(...filters.namespaceIds);
  }
  if (filters.occurredAfter !== undefined) {
    conditions.push('(f.occurred_at IS NOT NULL AND f.occurred_at >= ?)');
    params.push(filters.occurredAfter);
  }
  if (filters.occurredBefore !== undefined) {
    conditions.push('(f.occurred_at IS NOT NULL AND f.occurred_at <= ?)');
    params.push(filters.occurredBefore);
  }
  if (filters.tags && filters.tags.length > 0) {
    const placeholders = filters.tags.map(() => '?').join(', ');
    conditions.push(`EXISTS (SELECT 1 FROM memory_tags mt WHERE mt.owner_kind = 'fact' AND mt.owner_id = f.id AND mt.tag IN (${placeholders}))`);
    params.push(...filters.tags.map((tag) => tag.toLowerCase()));
  }
  if (filters.domains && filters.domains.length > 0) {
    const placeholders = filters.domains.map(() => '?').join(', ');
    conditions.push(`f.domain IN (${placeholders})`);
    params.push(...filters.domains);
  }

  params.push(effectiveLimit);

  const sql = `SELECT
    f.id,
    substr(f.text, 1, 160) AS description,
    f.text AS content,
    f.memory_type,
    f.confidence,
    f.scope,
    f.workspace_id,
    f.project_id,
    f.source_type,
    f.created_at,
    f.last_reinforced_at,
    f.durable,
    f.domain,
    f.namespace_id,
    f.occurred_at,
    f.valid_from,
    f.valid_to,
    f.revision_status,
    (
      SELECT COUNT(*)
      FROM memory_fact_sources fs
      WHERE fs.fact_id = f.id
    ) AS evidence_count,
    rank
  FROM memory_facts_fts
  JOIN memory_facts f ON f.id = memory_facts_fts.fact_id
  WHERE ${conditions.join(' AND ')}
  ORDER BY rank
  LIMIT ?`;

  try {
    return (db.prepare(sql).all(...params) as Array<{
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
      namespace_id: string;
      occurred_at: string | null;
      valid_from: string | null;
      valid_to: string | null;
      revision_status: 'active' | 'superseded';
      evidence_count: number;
      rank: number;
    }>).map((row) => {
      const location = normalizeMemoryLocation({
        scope: row.scope,
        workspaceId: row.workspace_id,
        projectId: row.project_id,
      });
      return {
        memoryId: row.id,
        description: row.description,
        content: row.content,
        memoryType: row.memory_type as MemoryType,
        confidence: row.confidence,
        scope: row.scope,
        workspaceId: location.workspaceId,
        projectId: location.projectId,
        sourceType: row.source_type,
        createdAt: row.created_at,
        lastReinforcedAt: row.last_reinforced_at,
        durable: Boolean(row.durable),
        domain: row.domain ?? undefined,
        ftsRank: row.rank,
        layer: 'fact',
        namespaceId: row.namespace_id,
        occurredAt: row.occurred_at,
        validFrom: row.valid_from,
        validTo: row.valid_to,
        evidenceCount: row.evidence_count,
        revisionStatus: row.revision_status,
      };
    });
  } catch {
    return [];
  }
}

export function searchSynthesesFts5(
  db: Database.Database,
  query: string,
  filters: {
    scope?: string;
    workspaceId?: string | null;
    projectId?: string | null;
    includeGlobal?: boolean;
    minConfidence?: number;
    namespaceIds?: string[];
    tags?: string[];
    domains?: string[];
    limit?: number;
  },
  limit = 40,
): FtsCandidate[] {
  const matchExpr = buildFts5MatchExpression(query);
  if (matchExpr === '""') return [];

  const effectiveLimit = filters.limit ?? limit;
  const hasExplicitLocation = filters.workspaceId !== undefined || filters.projectId !== undefined;
  const params: unknown[] = [matchExpr];
  const conditions: string[] = [
    'memory_syntheses_fts MATCH ?',
    's.archived_at IS NULL',
  ];

  if (filters.minConfidence !== undefined) {
    conditions.push('s.confidence >= ?');
    params.push(filters.minConfidence);
  }
  if (hasExplicitLocation || (filters.scope === undefined && filters.includeGlobal !== undefined)) {
    const location = buildLocationCondition('s', {
      workspaceId: filters.workspaceId ?? null,
      projectId: filters.projectId ?? null,
      includeGlobal: filters.includeGlobal,
    });
    if (location.sql) {
      conditions.push(location.sql);
      params.push(...location.params);
    }
  } else if (filters.scope !== undefined) {
    conditions.push('s.scope = ?');
    params.push(filters.scope);
  }
  if (filters.namespaceIds && filters.namespaceIds.length > 0) {
    const placeholders = filters.namespaceIds.map(() => '?').join(', ');
    conditions.push(`s.namespace_id IN (${placeholders})`);
    params.push(...filters.namespaceIds);
  }
  if (filters.tags && filters.tags.length > 0) {
    const placeholders = filters.tags.map(() => '?').join(', ');
    conditions.push(`EXISTS (SELECT 1 FROM memory_tags mt WHERE mt.owner_kind = 'synthesis' AND mt.owner_id = s.id AND mt.tag IN (${placeholders}))`);
    params.push(...filters.tags.map((tag) => tag.toLowerCase()));
  }
  if (filters.domains && filters.domains.length > 0) {
    const placeholders = filters.domains.map(() => '?').join(', ');
    conditions.push(`s.domain IN (${placeholders})`);
    params.push(...filters.domains);
  }

  params.push(effectiveLimit);

  const sql = `SELECT
    s.id,
    s.title AS description,
    s.text AS content,
    'semantic' AS memory_type,
    s.confidence,
    s.scope,
    s.workspace_id,
    s.project_id,
    'curated_memory' AS source_type,
    s.updated_at AS created_at,
    s.updated_at AS last_reinforced_at,
    1 AS durable,
    s.domain,
    s.namespace_id,
    (
      SELECT COUNT(*)
      FROM memory_synthesis_sources ss
      WHERE ss.synthesis_id = s.id
    ) AS evidence_count,
    rank
  FROM memory_syntheses_fts
  JOIN memory_syntheses s ON s.id = memory_syntheses_fts.synthesis_id
  WHERE ${conditions.join(' AND ')}
  ORDER BY rank
  LIMIT ?`;

  try {
    return (db.prepare(sql).all(...params) as Array<{
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
      last_reinforced_at: string;
      durable: number;
      domain: string | null;
      namespace_id: string;
      evidence_count: number;
      rank: number;
    }>).map((row) => {
      const location = normalizeMemoryLocation({
        scope: row.scope,
        workspaceId: row.workspace_id,
        projectId: row.project_id,
      });
      return {
        memoryId: row.id,
        description: row.description,
        content: row.content,
        memoryType: row.memory_type as MemoryType,
        confidence: row.confidence,
        scope: row.scope,
        workspaceId: location.workspaceId,
        projectId: location.projectId,
        sourceType: row.source_type,
        createdAt: row.created_at,
        lastReinforcedAt: row.last_reinforced_at,
        durable: Boolean(row.durable),
        domain: row.domain ?? undefined,
        ftsRank: row.rank,
        layer: 'synthesis',
        namespaceId: row.namespace_id,
        evidenceCount: row.evidence_count,
        revisionStatus: 'active',
      };
    });
  } catch {
    return [];
  }
}

export function searchChunksFts5(
  db: Database.Database,
  query: string,
  filters: {
    scope?: string;
    workspaceId?: string | null;
    projectId?: string | null;
    includeGlobal?: boolean;
    domains?: string[];
    limit?: number;
  },
  limit = 40,
): FtsCandidate[] {
  const matchExpr = buildFts5MatchExpression(query);
  if (matchExpr === '""') return [];

  const effectiveLimit = filters.limit ?? limit;
  const hasExplicitLocation = filters.workspaceId !== undefined || filters.projectId !== undefined;
  const params: unknown[] = [matchExpr];
  const conditions: string[] = [
    'memory_artifact_chunks_fts MATCH ?',
    'c.invalidated_at IS NULL',
    'a.invalidated_at IS NULL',
  ];

  if (hasExplicitLocation || (filters.scope === undefined && filters.includeGlobal !== undefined)) {
    const location = buildLocationCondition('a', {
      workspaceId: filters.workspaceId ?? null,
      projectId: filters.projectId ?? null,
      includeGlobal: filters.includeGlobal,
    });
    if (location.sql) {
      conditions.push(location.sql);
      params.push(...location.params);
    }
  } else if (filters.scope !== undefined) {
    conditions.push('a.scope = ?');
    params.push(filters.scope);
  }
  if (filters.domains && filters.domains.length > 0) {
    const placeholders = filters.domains.map(() => '?').join(', ');
    conditions.push(`a.domain IN (${placeholders})`);
    params.push(...filters.domains);
  }

  params.push(effectiveLimit);

  const sql = `SELECT
    c.id,
    substr(c.text, 1, 160) AS description,
    c.text AS content,
    a.source_type,
    a.scope,
    a.workspace_id,
    a.project_id,
    a.domain,
    a.trust_score,
    c.created_at,
    rank
  FROM memory_artifact_chunks_fts
  JOIN memory_artifact_chunks c ON c.id = memory_artifact_chunks_fts.chunk_id
  JOIN memory_artifacts a ON a.id = c.artifact_id
  WHERE ${conditions.join(' AND ')}
  ORDER BY rank
  LIMIT ?`;

  try {
    return (db.prepare(sql).all(...params) as Array<{
      id: string;
      description: string;
      content: string;
      source_type: string;
      scope: string;
      workspace_id: string | null;
      project_id: string | null;
      domain: string | null;
      trust_score: number | null;
      created_at: string;
      rank: number;
    }>).map((row) => {
      const location = normalizeMemoryLocation({
        scope: row.scope,
        workspaceId: row.workspace_id,
        projectId: row.project_id,
      });
      return {
        memoryId: row.id,
        description: row.description,
        content: row.content,
        memoryType: 'semantic' as MemoryType,
        confidence: row.trust_score ?? 0.7,
        scope: row.scope,
        workspaceId: location.workspaceId,
        projectId: location.projectId,
        sourceType: row.source_type,
        createdAt: row.created_at,
        lastReinforcedAt: null,
        durable: true,
        domain: row.domain ?? undefined,
        ftsRank: row.rank,
        layer: 'artifact' as const,
      };
    });
  } catch {
    return [];
  }
}
