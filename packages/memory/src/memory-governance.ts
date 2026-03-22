import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';
import type { MemoryOperatorActionRecord, OperatorStatus } from '@popeye/contracts';

import { invalidateChunksByArtifact } from './chunk-store.js';

// --- TTL Expiry ---

export function runTtlExpiry(db: Database.Database): { expired: number } {
  const now = new Date().toISOString();
  const rows = db.prepare(
    `SELECT id FROM memory_facts
     WHERE forget_after IS NOT NULL AND forget_after < ? AND expired_at IS NULL AND archived_at IS NULL`,
  ).all(now) as Array<{ id: string }>;

  if (rows.length === 0) return { expired: 0 };

  const tx = db.transaction(() => {
    const stmt = db.prepare('UPDATE memory_facts SET expired_at = ?, archived_at = ? WHERE id = ?');
    for (const row of rows) {
      stmt.run(now, now, row.id);
    }
  });
  tx();

  return { expired: rows.length };
}

// --- Staleness Marking ---

export function runStalenessMarking(db: Database.Database): { marked: number } {
  const now = new Date().toISOString();
  const rows = db.prepare(
    `SELECT id FROM memory_facts
     WHERE stale_after IS NOT NULL AND stale_after < ? AND expired_at IS NULL AND archived_at IS NULL`,
  ).all(now) as Array<{ id: string }>;

  if (rows.length === 0) return { marked: 0 };

  const tx = db.transaction(() => {
    const stmt = db.prepare('UPDATE memory_facts SET confidence = MAX(0.01, confidence * 0.5), stale_after = NULL WHERE id = ?');
    for (const row of rows) {
      stmt.run(row.id);
    }
  });
  tx();

  return { marked: rows.length };
}

// --- Source Deletion Cascade ---

export interface CascadeResult {
  artifactsInvalidated: number;
  chunksInvalidated: number;
  factsInvalidated: number;
  synthesisRefreshQueued: number;
}

export function runSourceDeletionCascade(db: Database.Database, sourceStreamId: string): CascadeResult {
  const now = new Date().toISOString();
  let artifactsInvalidated = 0;
  let chunksInvalidated = 0;
  let factsInvalidated = 0;
  let synthesisRefreshQueued = 0;

  const tx = db.transaction(() => {
    // 1. Find and invalidate artifacts from this source
    const artifacts = db.prepare(
      'SELECT id FROM memory_artifacts WHERE source_stream_id = ? AND invalidated_at IS NULL',
    ).all(sourceStreamId) as Array<{ id: string }>;

    for (const art of artifacts) {
      chunksInvalidated += invalidateChunksByArtifact(db, art.id);
      db.prepare('UPDATE memory_artifacts SET invalidated_at = ? WHERE id = ?').run(now, art.id);
      artifactsInvalidated++;
    }

    // 2. Find facts linked to this cascade's artifacts that have no remaining valid evidence
    const unsupportedFacts = db.prepare(
      `SELECT DISTINCT f.id FROM memory_facts f
       JOIN memory_fact_sources fs ON fs.fact_id = f.id
       WHERE fs.artifact_id IN (SELECT id FROM memory_artifacts WHERE source_stream_id = ? AND invalidated_at IS NOT NULL)
         AND f.archived_at IS NULL AND f.invalidated_at IS NULL AND f.is_latest = 1
         AND NOT EXISTS (
           SELECT 1 FROM memory_fact_sources fs2
           JOIN memory_artifacts a ON a.id = fs2.artifact_id
           WHERE fs2.fact_id = f.id AND a.invalidated_at IS NULL
         )`,
    ).all(sourceStreamId) as Array<{ id: string }>;

    const invalidateFactStmt = db.prepare('UPDATE memory_facts SET invalidated_at = ? WHERE id = ?');
    for (const fact of unsupportedFacts) {
      invalidateFactStmt.run(now, fact.id);
      factsInvalidated++;
    }

    // 3. Queue synthesis refresh for syntheses linked to facts invalidated in this cascade
    const invalidatedFactIds = unsupportedFacts.map((f) => f.id);
    const affectedSyntheses = invalidatedFactIds.length > 0
      ? db.prepare(
        `SELECT DISTINCT s.id FROM memory_syntheses s
         JOIN memory_synthesis_sources ss ON ss.synthesis_id = s.id
         WHERE ss.fact_id IN (${invalidatedFactIds.map(() => '?').join(', ')})
           AND s.archived_at IS NULL`,
      ).all(...invalidatedFactIds) as Array<{ id: string }>
      : [];

    const refreshStmt = db.prepare('UPDATE memory_syntheses SET refresh_due_at = ? WHERE id = ?');
    for (const syn of affectedSyntheses) {
      refreshStmt.run(now, syn.id);
      synthesisRefreshQueued++;
    }
  });
  tx();

  return { artifactsInvalidated, chunksInvalidated, factsInvalidated, synthesisRefreshQueued };
}

// --- Operator Actions ---

function recordOperatorAction(
  db: Database.Database,
  actionKind: string,
  targetKind: string,
  targetId: string,
  reason: string,
): MemoryOperatorActionRecord {
  const record: MemoryOperatorActionRecord = {
    id: randomUUID(),
    actionKind,
    targetKind,
    targetId,
    reason,
    payloadJson: {},
    createdAt: new Date().toISOString(),
  };

  db.prepare(
    'INSERT INTO memory_operator_actions (id, action_kind, target_kind, target_id, reason, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(record.id, record.actionKind, record.targetKind, record.targetId, record.reason, JSON.stringify(record.payloadJson), record.createdAt);

  return record;
}

const OPERATOR_STATUS_TABLES = new Set(['memory_facts', 'memory_syntheses']);

function setOperatorStatus(db: Database.Database, table: string, id: string, status: OperatorStatus): void {
  if (!OPERATOR_STATUS_TABLES.has(table)) {
    throw new Error(`Invalid table for operator status: ${table}`);
  }
  db.prepare(`UPDATE ${table} SET operator_status = ? WHERE id = ?`).run(status, id);
}

export function pinFact(db: Database.Database, factId: string, reason: string): MemoryOperatorActionRecord {
  setOperatorStatus(db, 'memory_facts', factId, 'pinned');
  return recordOperatorAction(db, 'pin', 'fact', factId, reason);
}

export function protectFact(db: Database.Database, factId: string, reason: string): MemoryOperatorActionRecord {
  setOperatorStatus(db, 'memory_facts', factId, 'protected');
  return recordOperatorAction(db, 'protect', 'fact', factId, reason);
}

export function forgetFact(db: Database.Database, factId: string, reason: string): MemoryOperatorActionRecord {
  const now = new Date().toISOString();
  db.prepare('UPDATE memory_facts SET operator_status = ?, archived_at = ?, expired_at = ? WHERE id = ?').run('rejected', now, now, factId);
  return recordOperatorAction(db, 'forget', 'fact', factId, reason);
}

export function unpinFact(db: Database.Database, factId: string, reason: string): MemoryOperatorActionRecord {
  setOperatorStatus(db, 'memory_facts', factId, 'normal');
  return recordOperatorAction(db, 'unpin', 'fact', factId, reason);
}

export function pinSynthesis(db: Database.Database, synthesisId: string, reason: string): MemoryOperatorActionRecord {
  setOperatorStatus(db, 'memory_syntheses', synthesisId, 'pinned');
  return recordOperatorAction(db, 'pin', 'synthesis', synthesisId, reason);
}
