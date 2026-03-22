import type Database from 'better-sqlite3';
import { sha256 } from '@popeye/observability';

/**
 * Compute a claim key that groups semantically equivalent facts.
 * Coarser than dedup_key (which uses full text) — claim_key uses the first
 * 100 chars of normalized text so that updated versions of the same claim
 * share the same key even if the wording changes slightly.
 */
export function computeClaimKey(scope: string, factKind: string, text: string): string {
  const normalized = text.trim().toLowerCase().slice(0, 100);
  return sha256(`claim:${scope}:${factKind}:${normalized}`);
}

export type FactResolution =
  | { action: 'duplicate'; existingFactId: string }
  | { action: 'update'; existingFactId: string; existingRootFactId: string | null }
  | { action: 'insert' };

/**
 * Resolve how a new fact relates to existing facts.
 *
 * Conservative v1: only claim_key exact match triggers resolution.
 * No fuzzy or semantic matching.
 */
export function resolveFact(
  db: Database.Database,
  opts: { claimKey: string; dedupKey: string },
): FactResolution {
  const existing = db.prepare(
    `SELECT id, dedup_key, root_fact_id
     FROM memory_facts
     WHERE claim_key = ? AND is_latest = 1 AND archived_at IS NULL
     LIMIT 1`,
  ).get(opts.claimKey) as { id: string; dedup_key: string | null; root_fact_id: string | null } | undefined;

  if (!existing) {
    return { action: 'insert' };
  }

  if (existing.dedup_key === opts.dedupKey) {
    return { action: 'duplicate', existingFactId: existing.id };
  }

  return {
    action: 'update',
    existingFactId: existing.id,
    existingRootFactId: existing.root_fact_id,
  };
}
