import type Database from 'better-sqlite3';

import type { MemoryType } from './types.js';

import { buildFts5MatchExpression } from './pure-functions.js';

export interface FtsCandidate {
  memoryId: string;
  description: string;
  content: string;
  memoryType: MemoryType;
  confidence: number;
  scope: string;
  sourceType: string;
  createdAt: string;
  lastReinforcedAt: string | null;
  ftsRank: number;
}

export function searchFts5(
  db: Database.Database,
  query: string,
  filters: { scope?: string; minConfidence?: number; memoryTypes?: MemoryType[]; limit?: number },
  limit = 60,
): FtsCandidate[] {
  const matchExpr = buildFts5MatchExpression(query);
  if (matchExpr === '""') return [];

  const effectiveLimit = filters.limit ?? limit;
  const params: unknown[] = [matchExpr];
  const conditions: string[] = [
    'memories_fts MATCH ?',
    'm.archived_at IS NULL',
  ];

  if (filters.minConfidence !== undefined) {
    conditions.push('m.confidence >= ?');
    params.push(filters.minConfidence);
  }

  if (filters.scope !== undefined) {
    conditions.push('m.scope = ?');
    params.push(filters.scope);
  }

  if (filters.memoryTypes !== undefined && filters.memoryTypes.length > 0) {
    const placeholders = filters.memoryTypes.map(() => '?').join(', ');
    conditions.push(`m.memory_type IN (${placeholders})`);
    params.push(...filters.memoryTypes);
  }

  params.push(effectiveLimit);

  const sql = `SELECT m.id, m.description, m.content, m.memory_type, m.confidence, m.scope, m.source_type, m.created_at, m.last_reinforced_at, rank
FROM memories_fts
JOIN memories m ON m.rowid = memories_fts.rowid
WHERE ${conditions.join(' AND ')}
ORDER BY rank
LIMIT ?`;

  const rows = db.prepare(sql).all(...params) as Array<{
    id: string;
    description: string;
    content: string;
    memory_type: string;
    confidence: number;
    scope: string;
    source_type: string;
    created_at: string;
    last_reinforced_at: string | null;
    rank: number;
  }>;

  return rows.map((row) => ({
    memoryId: row.id,
    description: row.description,
    content: row.content,
    memoryType: row.memory_type as MemoryType,
    confidence: row.confidence,
    scope: row.scope,
    sourceType: row.source_type,
    createdAt: row.created_at,
    lastReinforcedAt: row.last_reinforced_at,
    ftsRank: row.rank,
  }));
}

export function syncFtsInsert(db: Database.Database, rowid: number, description: string, content: string): void {
  db.prepare('INSERT INTO memories_fts(rowid, description, content) VALUES (?, ?, ?)').run(rowid, description, content);
}

export function syncFtsDelete(db: Database.Database, rowid: number, _description: string, _content: string): void {
  db.prepare('DELETE FROM memories_fts WHERE rowid = ?').run(rowid);
}
