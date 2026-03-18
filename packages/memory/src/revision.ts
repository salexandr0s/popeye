import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';
import type { MemoryRevisionRecord, MemoryRevisionRelation } from '@popeye/contracts';

export function recordRevision(
  db: Database.Database,
  input: { relation: MemoryRevisionRelation; sourceFactId: string; targetFactId: string; reason?: string | undefined },
): MemoryRevisionRecord {
  const record: MemoryRevisionRecord = {
    id: randomUUID(),
    relation: input.relation,
    sourceFactId: input.sourceFactId,
    targetFactId: input.targetFactId,
    reason: input.reason ?? '',
    createdAt: new Date().toISOString(),
  };

  db.prepare(
    'INSERT INTO memory_revisions (id, relation_type, source_fact_id, target_fact_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(record.id, record.relation, record.sourceFactId, record.targetFactId, record.reason, record.createdAt);

  if (record.relation === 'supersedes') {
    db.prepare("UPDATE memory_facts SET revision_status = 'superseded' WHERE id = ?").run(record.targetFactId);
    db.prepare("UPDATE memory_facts SET revision_status = 'active' WHERE id = ?").run(record.sourceFactId);
  }

  return record;
}
