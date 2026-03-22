import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';

export interface RetrievalTrace {
  /** Unique trace identifier. */
  traceId: string;
  /** SHA-256 hash of the raw query text (privacy-preserving lookup key). */
  queryHash: string;
  /** Optional redacted query text for local debugging. */
  queryTextRedacted?: string | undefined;
  /** Query strategy classification. */
  strategy: string;
  /** Effective filters applied during this retrieval. */
  filters: Record<string, unknown>;
  /** Candidate counts by layer and stage. */
  candidateCounts: Record<string, number>;
  /** IDs of the finally selected results. */
  selected: Array<{ id: string; layer?: string | undefined; score: number }>;
  /** Per-result ranking feature traces (keyed by result id). */
  featureTraces: Record<string, Record<string, number>>;
  /** Wall-clock retrieval latency in milliseconds. */
  latencyMs: number;
  /** ISO timestamp of the retrieval. */
  createdAt: string;
}

export interface RetrievalLogQuery {
  /** Maximum number of logs to return. */
  limit?: number;
  /** Filter by strategy. */
  strategy?: string;
  /** Only return logs created after this ISO timestamp. */
  after?: string;
  /** Only return logs created before this ISO timestamp. */
  before?: string;
}

export interface RetrievalLogRecord {
  id: string;
  queryHash: string;
  queryTextRedacted: string | null;
  strategy: string;
  filtersJson: Record<string, unknown>;
  candidateCountsJson: Record<string, number>;
  selectedJson: Array<{ id: string; layer?: string | undefined; score: number }>;
  featureTracesJson: Record<string, Record<string, number>>;
  latencyMs: number;
  createdAt: string;
}

/**
 * Hash the raw query text for privacy-preserving storage.
 * Uses SHA-256 truncated to 16 hex chars — enough for lookup dedup,
 * not enough to reverse.
 */
export function hashQueryText(query: string): string {
  return createHash('sha256').update(query).digest('hex').slice(0, 16);
}

/**
 * Build a RetrievalTrace from search results. This is a pure helper
 * that does not touch the database.
 */
export function buildRetrievalTrace(input: {
  queryText: string;
  queryTextRedacted?: string | undefined;
  strategy: string;
  filters: Record<string, unknown>;
  candidateCounts: Record<string, number>;
  selected: Array<{ id: string; layer?: string | undefined; score: number; scoreBreakdown: Record<string, number> }>;
  latencyMs: number;
}): RetrievalTrace {
  const featureTraces: Record<string, Record<string, number>> = {};
  for (const item of input.selected) {
    featureTraces[item.id] = item.scoreBreakdown;
  }

  return {
    traceId: randomUUID(),
    queryHash: hashQueryText(input.queryText),
    queryTextRedacted: input.queryTextRedacted,
    strategy: input.strategy,
    filters: input.filters,
    candidateCounts: input.candidateCounts,
    selected: input.selected.map((s) => ({ id: s.id, layer: s.layer, score: s.score })),
    featureTraces,
    latencyMs: input.latencyMs,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Persist a retrieval trace to the memory_retrieval_logs table.
 */
export function logRetrievalTrace(db: Database.Database, trace: RetrievalTrace): void {
  db.prepare(
    `INSERT INTO memory_retrieval_logs
      (id, query_hash, query_text_redacted, strategy, filters_json, candidate_counts_json, selected_json, feature_traces_json, latency_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    trace.traceId,
    trace.queryHash,
    trace.queryTextRedacted ?? null,
    trace.strategy,
    JSON.stringify(trace.filters),
    JSON.stringify(trace.candidateCounts),
    JSON.stringify(trace.selected),
    JSON.stringify(trace.featureTraces),
    trace.latencyMs,
    trace.createdAt,
  );
}

/**
 * Query retrieval logs with optional filters.
 */
export function queryRetrievalLogs(db: Database.Database, opts?: RetrievalLogQuery): RetrievalLogRecord[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts?.strategy) {
    conditions.push('strategy = ?');
    params.push(opts.strategy);
  }
  if (opts?.after) {
    conditions.push('created_at > ?');
    params.push(opts.after);
  }
  if (opts?.before) {
    conditions.push('created_at < ?');
    params.push(opts.before);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = opts?.limit ?? 100;

  const rows = db.prepare(
    `SELECT id, query_hash, query_text_redacted, strategy, filters_json, candidate_counts_json, selected_json, feature_traces_json, latency_ms, created_at
     FROM memory_retrieval_logs
     ${where}
     ORDER BY created_at DESC
     LIMIT ?`,
  ).all(...params, limit) as Array<{
    id: string;
    query_hash: string;
    query_text_redacted: string | null;
    strategy: string;
    filters_json: string;
    candidate_counts_json: string;
    selected_json: string;
    feature_traces_json: string;
    latency_ms: number;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    queryHash: row.query_hash,
    queryTextRedacted: row.query_text_redacted,
    strategy: row.strategy,
    filtersJson: JSON.parse(row.filters_json) as Record<string, unknown>,
    candidateCountsJson: JSON.parse(row.candidate_counts_json) as Record<string, number>,
    selectedJson: JSON.parse(row.selected_json) as Array<{ id: string; layer?: string; score: number }>,
    featureTracesJson: JSON.parse(row.feature_traces_json) as Record<string, Record<string, number>>,
    latencyMs: row.latency_ms,
    createdAt: row.created_at,
  }));
}

/**
 * Delete retrieval logs older than the given ISO timestamp.
 * Returns the number of deleted rows.
 */
export function pruneRetrievalLogs(db: Database.Database, olderThan: string): number {
  const result = db.prepare('DELETE FROM memory_retrieval_logs WHERE created_at < ?').run(olderThan);
  return result.changes;
}
