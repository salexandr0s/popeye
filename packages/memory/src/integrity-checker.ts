import type Database from 'better-sqlite3';
import type { IntegrityCheckName, IntegrityReport, IntegrityViolation } from '@popeye/contracts';

import { invalidateChunksByArtifact } from './chunk-store.js';

interface IntegrityCheckOptions {
  fix?: boolean;
  checks?: IntegrityCheckName[];
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

  orphan_chunks(db, violations, fix) {
    try {
      const orphans = db.prepare(`
        SELECT c.id, c.artifact_id FROM memory_artifact_chunks c
        JOIN memory_artifacts a ON a.id = c.artifact_id
        WHERE a.invalidated_at IS NOT NULL AND c.invalidated_at IS NULL
      `).all() as Array<{ id: string; artifact_id: string }>;

      // Group by artifact for efficient batch fix
      const byArtifact = new Set<string>();
      for (const row of orphans) {
        violations.push({
          check: 'orphan_chunks',
          detail: `Chunk ${row.id} belongs to invalidated artifact ${row.artifact_id}`,
          autoFixable: true,
        });
        byArtifact.add(row.artifact_id);
      }
      if (fix && byArtifact.size > 0) {
        for (const artifactId of byArtifact) {
          invalidateChunksByArtifact(db, artifactId);
        }
      }
    } catch {
      // Tables may not exist in older schemas
    }
  },

  unsupported_facts(db, violations, fix) {
    try {
      const unsupported = db.prepare(`
        SELECT f.id FROM memory_facts f
        WHERE f.archived_at IS NULL AND f.invalidated_at IS NULL
          AND EXISTS (SELECT 1 FROM memory_fact_sources fs WHERE fs.fact_id = f.id)
          AND NOT EXISTS (
            SELECT 1 FROM memory_fact_sources fs
            JOIN memory_artifacts a ON a.id = fs.artifact_id
            WHERE fs.fact_id = f.id AND a.invalidated_at IS NULL
          )
      `).all() as Array<{ id: string }>;

      const now = new Date().toISOString();
      for (const row of unsupported) {
        violations.push({
          check: 'unsupported_facts',
          detail: `Fact ${row.id} has no valid (non-invalidated) evidence artifacts`,
          autoFixable: true,
        });
        if (fix) {
          db.prepare('UPDATE memory_facts SET invalidated_at = ? WHERE id = ?').run(now, row.id);
        }
      }
    } catch {
      // Tables may not exist in older schemas
    }
  },

  profile_refresh_debt(db, violations, _fix) {
    try {
      const now = new Date().toISOString();
      const overdue = db.prepare(`
        SELECT id, synthesis_kind FROM memory_syntheses
        WHERE refresh_due_at IS NOT NULL AND refresh_due_at < ? AND archived_at IS NULL
      `).all(now) as Array<{ id: string; synthesis_kind: string }>;

      for (const row of overdue) {
        violations.push({
          check: 'profile_refresh_debt',
          detail: `Synthesis ${row.id} (${row.synthesis_kind}) has overdue refresh`,
          autoFixable: false,
        });
      }
    } catch {
      // Tables may not exist in older schemas
    }
  },

  ttl_consistency(db, violations, fix) {
    try {
      const now = new Date().toISOString();
      const expired = db.prepare(`
        SELECT id FROM memory_facts
        WHERE forget_after IS NOT NULL AND forget_after < ? AND expired_at IS NULL AND archived_at IS NULL
      `).all(now) as Array<{ id: string }>;

      for (const row of expired) {
        violations.push({
          check: 'ttl_consistency',
          detail: `Fact ${row.id} has forget_after in the past but is not expired`,
          autoFixable: true,
        });
        if (fix) {
          db.prepare('UPDATE memory_facts SET expired_at = ?, archived_at = ? WHERE id = ?').run(now, now, row.id);
        }
      }
    } catch {
      // Tables may not exist in older schemas
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
