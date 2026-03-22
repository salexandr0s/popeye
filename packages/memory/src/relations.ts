import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';
import type { MemoryRelationRecord, MemoryRelationType } from '@popeye/contracts';

export interface CreateRelationInput {
  relationType: MemoryRelationType;
  sourceKind: string;
  sourceId: string;
  targetKind: string;
  targetId: string;
  confidence?: number | undefined;
  createdBy: string;
  reason?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

/** Maximum relations allowed per source entity. */
const MAX_RELATIONS_PER_SOURCE = 20;

export function countRelationsForSource(db: Database.Database, sourceKind: string, sourceId: string): number {
  const row = db.prepare(
    'SELECT COUNT(*) AS cnt FROM memory_relations WHERE source_kind = ? AND source_id = ?',
  ).get(sourceKind, sourceId) as { cnt: number };
  return row.cnt;
}

export function createRelation(db: Database.Database, input: CreateRelationInput): MemoryRelationRecord {
  const existing = countRelationsForSource(db, input.sourceKind, input.sourceId);
  if (existing >= MAX_RELATIONS_PER_SOURCE) {
    throw new Error(`Relation cap exceeded: source ${input.sourceKind}:${input.sourceId} already has ${existing} relations (max ${MAX_RELATIONS_PER_SOURCE})`);
  }

  const record: MemoryRelationRecord = {
    id: randomUUID(),
    relationType: input.relationType,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    targetKind: input.targetKind,
    targetId: input.targetId,
    confidence: input.confidence ?? 1.0,
    createdBy: input.createdBy,
    reason: input.reason ?? '',
    metadataJson: input.metadata ?? {},
    createdAt: new Date().toISOString(),
  };

  db.prepare(
    'INSERT INTO memory_relations (id, relation_type, source_kind, source_id, target_kind, target_id, confidence, created_by, reason, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    record.id,
    record.relationType,
    record.sourceKind,
    record.sourceId,
    record.targetKind,
    record.targetId,
    record.confidence,
    record.createdBy,
    record.reason,
    JSON.stringify(record.metadataJson),
    record.createdAt,
  );

  return record;
}

export function getRelationsForSource(db: Database.Database, sourceKind: string, sourceId: string): MemoryRelationRecord[] {
  return (db.prepare(
    'SELECT id, relation_type, source_kind, source_id, target_kind, target_id, confidence, created_by, reason, metadata_json, created_at FROM memory_relations WHERE source_kind = ? AND source_id = ? ORDER BY created_at ASC',
  ).all(sourceKind, sourceId) as Array<{
    id: string;
    relation_type: string;
    source_kind: string;
    source_id: string;
    target_kind: string;
    target_id: string;
    confidence: number;
    created_by: string;
    reason: string;
    metadata_json: string;
    created_at: string;
  }>).map(mapRowToRecord);
}

export function getRelationsForTarget(db: Database.Database, targetKind: string, targetId: string): MemoryRelationRecord[] {
  return (db.prepare(
    'SELECT id, relation_type, source_kind, source_id, target_kind, target_id, confidence, created_by, reason, metadata_json, created_at FROM memory_relations WHERE target_kind = ? AND target_id = ? ORDER BY created_at ASC',
  ).all(targetKind, targetId) as Array<{
    id: string;
    relation_type: string;
    source_kind: string;
    source_id: string;
    target_kind: string;
    target_id: string;
    confidence: number;
    created_by: string;
    reason: string;
    metadata_json: string;
    created_at: string;
  }>).map(mapRowToRecord);
}

function mapRowToRecord(row: {
  id: string;
  relation_type: string;
  source_kind: string;
  source_id: string;
  target_kind: string;
  target_id: string;
  confidence: number;
  created_by: string;
  reason: string;
  metadata_json: string;
  created_at: string;
}): MemoryRelationRecord {
  return {
    id: row.id,
    relationType: row.relation_type as MemoryRelationType,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    confidence: row.confidence,
    createdBy: row.created_by,
    reason: row.reason,
    metadataJson: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}
