import type Database from 'better-sqlite3';

import type {
  SessionSearchQuery,
  SessionSearchResult,
  SessionSearchResponse,
} from '@popeye/contracts';

// ---------------------------------------------------------------------------
// FTS5 query sanitization (local to avoid circular dep on @popeye/memory)
// ---------------------------------------------------------------------------

const FTS5_SPECIAL = /["""{}()*:^~]/g;

/**
 * Sanitize a raw user query into a safe FTS5 MATCH expression.
 *
 * Strips FTS5 operators that could cause syntax errors (unmatched quotes,
 * bare NOT at start, special chars) and wraps each remaining token in
 * double-quotes for prefix matching, joined with OR.
 */
export function sanitizeFtsQuery(query: string): string {
  const tokens = query
    .replace(FTS5_SPECIAL, ' ')
    .split(/\s+/)
    .filter(Boolean)
    // Strip a leading bare NOT — it is not valid as the first token
    .filter((t, i) => !(i === 0 && t.toUpperCase() === 'NOT'));
  if (tokens.length === 0) return '""';
  return tokens.map((t) => `"${t}"`).join(' OR ');
}

// ---------------------------------------------------------------------------
// Run-event FTS5 search
// ---------------------------------------------------------------------------

interface FtsRow {
  event_id: string;
  run_id: string;
  type: string;
  payload: string;
  created_at: string;
  rank: number;
}

export function searchRunEvents(
  db: Database.Database,
  query: SessionSearchQuery,
): SessionSearchResponse {
  const matchExpr = sanitizeFtsQuery(query.q);
  if (matchExpr === '""') {
    return { query: query.q, results: [], totalMatches: 0 };
  }

  const params: unknown[] = [matchExpr];
  const conditions: string[] = ['run_events_fts MATCH ?'];

  if (query.type !== undefined) {
    conditions.push('f.type = ?');
    params.push(query.type);
  }
  if (query.workspaceId !== undefined) {
    conditions.push('r.workspace_id = ?');
    params.push(query.workspaceId);
  }
  if (query.from !== undefined) {
    conditions.push('re.created_at >= ?');
    params.push(query.from);
  }
  if (query.to !== undefined) {
    conditions.push('re.created_at <= ?');
    params.push(query.to);
  }

  params.push(query.limit);

  const sql = `SELECT
    f.event_id,
    f.run_id,
    f.type,
    f.payload,
    re.created_at,
    rank
  FROM run_events_fts f
  JOIN run_events re ON re.id = f.event_id
  JOIN runs r ON r.id = f.run_id
  WHERE ${conditions.join(' AND ')}
  ORDER BY rank
  LIMIT ?`;

  try {
    const rows = db.prepare(sql).all(...params) as FtsRow[];
    const results: SessionSearchResult[] = rows.map((row) => ({
      eventId: row.event_id,
      runId: row.run_id,
      type: row.type,
      payload: row.payload,
      createdAt: row.created_at,
      rank: row.rank,
    }));
    return { query: query.q, results, totalMatches: results.length };
  } catch {
    return { query: query.q, results: [], totalMatches: 0 };
  }
}
