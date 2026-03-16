import type Database from 'better-sqlite3';
import type { IntegrityCheckName, IntegrityReport, IntegrityViolation } from '@popeye/contracts';

interface IntegrityCheckOptions {
  fix?: boolean;
  checks?: IntegrityCheckName[];
}

/**
 * Check if sqlite-vec virtual table is available.
 */
export function isVecTableAvailable(db: Database.Database): boolean {
  try {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_vec'").get() as { name: string } | undefined;
    return row !== undefined;
  } catch {
    return false;
  }
}

/**
 * Check if memory_summaries table exists.
 */
function isSummaryTableAvailable(db: Database.Database): boolean {
  try {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_summaries'").get() as { name: string } | undefined;
    return row !== undefined;
  } catch {
    return false;
  }
}

type CheckFn = (db: Database.Database, violations: IntegrityViolation[], fix: boolean) => void;

const checks: Record<IntegrityCheckName, CheckFn> = {
  fts5_index_sync(db, violations, fix) {
    // Active memories missing FTS5 rows
    const missing = db.prepare(`
      SELECT m.id FROM memories m
      LEFT JOIN memories_fts f ON f.memory_id = m.id
      WHERE m.archived_at IS NULL AND f.memory_id IS NULL
    `).all() as Array<{ id: string }>;

    for (const row of missing) {
      violations.push({
        check: 'fts5_index_sync',
        memoryId: row.id,
        detail: `Active memory ${row.id} missing from FTS5 index`,
        autoFixable: true,
      });
      if (fix) {
        const mem = db.prepare('SELECT description, content FROM memories WHERE id = ?').get(row.id) as { description: string; content: string } | undefined;
        if (mem) {
          db.prepare('INSERT INTO memories_fts(memory_id, description, content) VALUES (?, ?, ?)').run(row.id, mem.description, mem.content);
        }
      }
    }
  },

  vec_index_sync(db, violations, _fix) {
    if (!isVecTableAvailable(db)) return;

    const missing = db.prepare(`
      SELECT m.id FROM memories m
      WHERE m.archived_at IS NULL
        AND m.classification = 'embeddable'
        AND m.id NOT IN (SELECT memory_id FROM memory_vec)
    `).all() as Array<{ id: string }>;

    for (const row of missing) {
      violations.push({
        check: 'vec_index_sync',
        memoryId: row.id,
        detail: `Embeddable memory ${row.id} missing from vec index`,
        autoFixable: false,
      });
    }
  },

  orphaned_embeddings(db, violations, fix) {
    if (!isVecTableAvailable(db)) return;

    const orphaned = db.prepare(`
      SELECT v.memory_id FROM memory_vec v
      LEFT JOIN memories m ON m.id = v.memory_id
      WHERE m.id IS NULL
    `).all() as Array<{ memory_id: string }>;

    for (const row of orphaned) {
      violations.push({
        check: 'orphaned_embeddings',
        memoryId: row.memory_id,
        detail: `Vec embedding for non-existent memory ${row.memory_id}`,
        autoFixable: true,
      });
      if (fix) {
        db.prepare('DELETE FROM memory_vec WHERE memory_id = ?').run(row.memory_id);
      }
    }
  },

  dedup_key_consistency(db, violations, _fix) {
    const dupes = db.prepare(`
      SELECT dedup_key, COUNT(*) as cnt FROM memories
      WHERE archived_at IS NULL AND dedup_key IS NOT NULL
      GROUP BY dedup_key HAVING cnt > 1
    `).all() as Array<{ dedup_key: string; cnt: number }>;

    for (const row of dupes) {
      violations.push({
        check: 'dedup_key_consistency',
        detail: `Duplicate dedup_key "${row.dedup_key}" found on ${row.cnt} active memories`,
        autoFixable: false,
      });
    }
  },

  entity_mention_consistency(db, violations, fix) {
    // Mentions pointing to deleted memories
    const orphanedByMemory = db.prepare(`
      SELECT em.id, em.memory_id FROM memory_entity_mentions em
      LEFT JOIN memories m ON m.id = em.memory_id
      WHERE m.id IS NULL
    `).all() as Array<{ id: string; memory_id: string }>;

    for (const row of orphanedByMemory) {
      violations.push({
        check: 'entity_mention_consistency',
        memoryId: row.memory_id,
        detail: `Entity mention ${row.id} references non-existent memory ${row.memory_id}`,
        autoFixable: true,
      });
      if (fix) {
        db.prepare('DELETE FROM memory_entity_mentions WHERE id = ?').run(row.id);
      }
    }

    // Mentions pointing to deleted entities
    const orphanedByEntity = db.prepare(`
      SELECT em.id, em.entity_id FROM memory_entity_mentions em
      LEFT JOIN memory_entities e ON e.id = em.entity_id
      WHERE e.id IS NULL
    `).all() as Array<{ id: string; entity_id: string }>;

    for (const row of orphanedByEntity) {
      violations.push({
        check: 'entity_mention_consistency',
        detail: `Entity mention ${row.id} references non-existent entity ${row.entity_id}`,
        autoFixable: true,
      });
      if (fix) {
        db.prepare('DELETE FROM memory_entity_mentions WHERE id = ?').run(row.id);
      }
    }
  },

  consolidation_chain_integrity(db, violations, _fix) {
    const broken = db.prepare(`
      SELECT mc.id, mc.memory_id, mc.merged_into_id FROM memory_consolidations mc
      LEFT JOIN memories m ON m.id = mc.merged_into_id
      WHERE m.id IS NULL
    `).all() as Array<{ id: string; memory_id: string; merged_into_id: string }>;

    for (const row of broken) {
      violations.push({
        check: 'consolidation_chain_integrity',
        memoryId: row.memory_id,
        detail: `Consolidation ${row.id} references non-existent merge target ${row.merged_into_id}`,
        autoFixable: false,
      });
    }
  },

  confidence_bounds(db, violations, fix) {
    const outOfBounds = db.prepare(`
      SELECT id, confidence FROM memories
      WHERE confidence < 0 OR confidence > 1
    `).all() as Array<{ id: string; confidence: number }>;

    for (const row of outOfBounds) {
      violations.push({
        check: 'confidence_bounds',
        memoryId: row.id,
        detail: `Memory ${row.id} has confidence ${row.confidence} outside [0, 1]`,
        autoFixable: true,
      });
      if (fix) {
        const clamped = Math.max(0, Math.min(1, row.confidence));
        db.prepare('UPDATE memories SET confidence = ? WHERE id = ?').run(clamped, row.id);
      }
    }
  },

  summary_dag_integrity(db, violations, fix) {
    if (!isSummaryTableAvailable(db)) return;

    const orphaned = db.prepare(`
      SELECT s.id, s.parent_id FROM memory_summaries s
      LEFT JOIN memory_summaries p ON p.id = s.parent_id
      WHERE s.parent_id IS NOT NULL AND p.id IS NULL
    `).all() as Array<{ id: string; parent_id: string }>;

    for (const row of orphaned) {
      violations.push({
        check: 'summary_dag_integrity',
        detail: `Summary ${row.id} references non-existent parent ${row.parent_id}`,
        autoFixable: true,
      });
      if (fix) {
        db.prepare('UPDATE memory_summaries SET parent_id = NULL WHERE id = ?').run(row.id);
      }
    }
  },

  event_log_completeness(db, violations, _fix) {
    const missing = db.prepare(`
      SELECT m.id FROM memories m
      LEFT JOIN memory_events e ON e.memory_id = m.id AND e.type = 'created'
      WHERE e.id IS NULL
    `).all() as Array<{ id: string }>;

    for (const row of missing) {
      violations.push({
        check: 'event_log_completeness',
        memoryId: row.id,
        detail: `Memory ${row.id} has no 'created' event`,
        autoFixable: false,
      });
    }
  },
};

/**
 * Run integrity checks against the memory database.
 */
export function runIntegrityChecks(db: Database.Database, options?: IntegrityCheckOptions): IntegrityReport {
  const start = performance.now();
  const fix = options?.fix ?? false;
  const selectedChecks = options?.checks ?? (Object.keys(checks) as IntegrityCheckName[]);

  const violations: IntegrityViolation[] = [];

  for (const checkName of selectedChecks) {
    const checkFn = checks[checkName];
    if (checkFn) {
      checkFn(db, violations, fix);
    }
  }

  const fixesApplied = fix ? violations.filter((v) => v.autoFixable).length : 0;
  const durationMs = performance.now() - start;

  return {
    checksRun: selectedChecks,
    violations,
    fixesApplied,
    durationMs,
  };
}
