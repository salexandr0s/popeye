import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { MemorySummaryRecord, SummaryDAGNode } from '@popeye/contracts';

/**
 * Estimate token count from text (chars / 4, conservative for English).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface InsertSummaryInput {
  runId: string;
  workspaceId: string;
  parentId?: string | null;
  depth: number;
  content: string;
  startTime: string;
  endTime: string;
}

/**
 * Insert a summary node into the DAG.
 */
export function insertSummary(db: Database.Database, input: InsertSummaryInput): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  const tokenEstimate = estimateTokens(input.content);

  db.prepare(
    `INSERT INTO memory_summaries (id, run_id, workspace_id, parent_id, depth, content, token_estimate, start_time, end_time, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.runId, input.workspaceId, input.parentId ?? null, input.depth, input.content, tokenEstimate, input.startTime, input.endTime, now);

  return id;
}

/**
 * Link a summary to source memories.
 */
export function linkSummarySource(db: Database.Database, summaryId: string, memoryId: string): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO memory_summary_sources (id, summary_id, memory_id, created_at) VALUES (?, ?, ?, ?)',
  ).run(id, summaryId, memoryId, now);
  return id;
}

interface SummaryRow {
  id: string;
  run_id: string;
  workspace_id: string;
  parent_id: string | null;
  depth: number;
  content: string;
  token_estimate: number;
  start_time: string;
  end_time: string;
  created_at: string;
}

function rowToRecord(row: SummaryRow): MemorySummaryRecord {
  return {
    id: row.id,
    runId: row.run_id,
    workspaceId: row.workspace_id,
    parentId: row.parent_id,
    depth: row.depth,
    content: row.content,
    tokenEstimate: row.token_estimate,
    startTime: row.start_time,
    endTime: row.end_time,
    createdAt: row.created_at,
  };
}

/**
 * Get direct children of a summary node.
 */
export function getSummaryChildren(db: Database.Database, parentId: string): MemorySummaryRecord[] {
  const rows = db.prepare('SELECT * FROM memory_summaries WHERE parent_id = ? ORDER BY start_time').all(parentId) as SummaryRow[];
  return rows.map(rowToRecord);
}

/**
 * Get ancestors of a summary node using recursive CTE.
 */
export function getSummaryAncestors(db: Database.Database, summaryId: string): MemorySummaryRecord[] {
  const rows = db.prepare(`
    WITH RECURSIVE ancestors AS (
      SELECT * FROM memory_summaries WHERE id = ?
      UNION ALL
      SELECT ms.* FROM memory_summaries ms
      JOIN ancestors a ON ms.id = a.parent_id
    )
    SELECT * FROM ancestors WHERE id != ? ORDER BY depth DESC
  `).all(summaryId, summaryId) as SummaryRow[];
  return rows.map(rowToRecord);
}

/**
 * Build the full DAG tree from a root summary.
 */
export function getSummaryTree(db: Database.Database, rootId: string): SummaryDAGNode | null {
  const rootRow = db.prepare('SELECT * FROM memory_summaries WHERE id = ?').get(rootId) as SummaryRow | undefined;
  if (!rootRow) return null;

  // Fetch all descendants using recursive CTE
  const allRows = db.prepare(`
    WITH RECURSIVE tree AS (
      SELECT * FROM memory_summaries WHERE id = ?
      UNION ALL
      SELECT ms.* FROM memory_summaries ms
      JOIN tree t ON ms.parent_id = t.id
    )
    SELECT * FROM tree ORDER BY depth, start_time
  `).all(rootId) as SummaryRow[];

  // Build tree from flat list
  const nodeMap = new Map<string, SummaryDAGNode>();
  for (const row of allRows) {
    nodeMap.set(row.id, { summary: rowToRecord(row), children: [] });
  }
  for (const row of allRows) {
    if (row.parent_id && nodeMap.has(row.parent_id)) {
      nodeMap.get(row.parent_id)!.children.push(nodeMap.get(row.id)!);
    }
  }

  return nodeMap.get(rootId) ?? null;
}

/**
 * Get leaf summaries (depth 0) for a run.
 */
export function getLeafSummaries(db: Database.Database, runId: string): MemorySummaryRecord[] {
  const rows = db.prepare('SELECT * FROM memory_summaries WHERE run_id = ? AND depth = 0 ORDER BY start_time').all(runId) as SummaryRow[];
  return rows.map(rowToRecord);
}

/**
 * Get summaries at a specific depth for a run.
 */
export function getSummariesByDepth(db: Database.Database, runId: string, depth: number): MemorySummaryRecord[] {
  const rows = db.prepare('SELECT * FROM memory_summaries WHERE run_id = ? AND depth = ? ORDER BY start_time').all(runId, depth) as SummaryRow[];
  return rows.map(rowToRecord);
}

/**
 * Get the latest (most recent) summary for a run.
 */
export function getLatestSummary(db: Database.Database, runId: string): MemorySummaryRecord | null {
  const row = db.prepare('SELECT * FROM memory_summaries WHERE run_id = ? ORDER BY depth DESC, created_at DESC LIMIT 1').get(runId) as SummaryRow | undefined;
  return row ? rowToRecord(row) : null;
}

/**
 * Delete a summary and all its descendants. Returns count of deleted rows.
 */
export function deleteSummaryChain(db: Database.Database, rootId: string): number {
  // First delete sources for all nodes in the chain
  const deleteSourcesSql = `
    WITH RECURSIVE chain AS (
      SELECT id FROM memory_summaries WHERE id = ?
      UNION ALL
      SELECT ms.id FROM memory_summaries ms
      JOIN chain c ON ms.parent_id = c.id
    )
    DELETE FROM memory_summary_sources WHERE summary_id IN (SELECT id FROM chain)
  `;
  db.prepare(deleteSourcesSql).run(rootId);

  // Then delete the summaries themselves
  const deleteSql = `
    WITH RECURSIVE chain AS (
      SELECT id FROM memory_summaries WHERE id = ?
      UNION ALL
      SELECT ms.id FROM memory_summaries ms
      JOIN chain c ON ms.parent_id = c.id
    )
    DELETE FROM memory_summaries WHERE id IN (SELECT id FROM chain)
  `;
  const result = db.prepare(deleteSql).run(rootId);
  return result.changes;
}
