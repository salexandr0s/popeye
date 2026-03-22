import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';
import type { DataClassification, DomainKind, MemoryFactRecord, MemorySynthesisKind, MemorySynthesisRecord } from '@popeye/contracts';

import { canonicalizeMemoryLocation } from './location.js';
import { replaceOwnerTags } from './namespace.js';

function syncSynthesisFtsInsert(db: Database.Database, synthesisId: string, title: string, text: string): void {
  db.prepare('INSERT INTO memory_syntheses_fts (synthesis_id, title, text) VALUES (?, ?, ?)').run(synthesisId, title, text);
}

export interface CreateSynthesisInput {
  namespaceId: string;
  scope: string;
  workspaceId?: string | null | undefined;
  projectId?: string | null | undefined;
  classification: DataClassification;
  synthesisKind: MemorySynthesisKind;
  title: string;
  text: string;
  confidence: number;
  refreshPolicy?: string | undefined;
  sourceFacts: Array<Pick<MemoryFactRecord, 'id'>>;
  tags?: string[] | undefined;
  domain?: DomainKind | undefined;
  subjectKind?: string | null | undefined;
  subjectId?: string | null | undefined;
  refreshDueAt?: string | null | undefined;
  qualityScore?: number | undefined;
}

export function createSynthesis(db: Database.Database, input: CreateSynthesisInput): MemorySynthesisRecord {
  const now = new Date().toISOString();
  const location = canonicalizeMemoryLocation({
    scope: input.scope,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
  });
  const existing = db.prepare(
    'SELECT id, created_at FROM memory_syntheses WHERE scope = ? AND synthesis_kind = ? AND title = ? AND archived_at IS NULL LIMIT 1',
  ).get(location.scope, input.synthesisKind, input.title) as { id: string; created_at: string } | undefined;

  const record: MemorySynthesisRecord = {
    id: existing?.id ?? randomUUID(),
    namespaceId: input.namespaceId,
    scope: location.scope,
    workspaceId: location.workspaceId,
    projectId: location.projectId,
    classification: input.classification,
    synthesisKind: input.synthesisKind,
    title: input.title,
    text: input.text,
    confidence: input.confidence,
    refreshPolicy: input.refreshPolicy ?? 'manual',
    createdAt: existing?.created_at ?? now,
    updatedAt: now,
    archivedAt: null,
    domain: input.domain ?? 'general',
    subjectKind: input.subjectKind ?? null,
    subjectId: input.subjectId ?? null,
    refreshDueAt: input.refreshDueAt ?? null,
    salience: 0.5,
    qualityScore: input.qualityScore ?? 0.7,
    contextReleasePolicy: 'full',
    invalidatedAt: null,
    operatorStatus: 'normal',
  };

  if (existing) {
    db.prepare(
      `UPDATE memory_syntheses SET namespace_id = ?, scope = ?, workspace_id = ?, project_id = ?,
       classification = ?, text = ?, confidence = ?, refresh_policy = ?, updated_at = ?,
       archived_at = NULL, domain = COALESCE(?, domain),
       subject_kind = ?, subject_id = ?, refresh_due_at = ?, quality_score = ?
       WHERE id = ?`,
    ).run(
      record.namespaceId, record.scope, record.workspaceId, record.projectId,
      record.classification, record.text, record.confidence, record.refreshPolicy, record.updatedAt,
      input.domain, record.subjectKind, record.subjectId, record.refreshDueAt, record.qualityScore,
      record.id,
    );
    db.prepare('DELETE FROM memory_syntheses_fts WHERE synthesis_id = ?').run(record.id);
    db.prepare('DELETE FROM memory_synthesis_sources WHERE synthesis_id = ?').run(record.id);
  } else {
    db.prepare(
      `INSERT INTO memory_syntheses (id, namespace_id, scope, workspace_id, project_id, classification,
       synthesis_kind, title, text, confidence, refresh_policy, created_at, updated_at, archived_at, domain,
       subject_kind, subject_id, refresh_due_at, quality_score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.id, record.namespaceId, record.scope, record.workspaceId, record.projectId,
      record.classification, record.synthesisKind, record.title, record.text, record.confidence,
      record.refreshPolicy, record.createdAt, record.updatedAt, record.archivedAt,
      input.domain ?? 'general', record.subjectKind, record.subjectId, record.refreshDueAt,
      record.qualityScore,
    );
  }

  syncSynthesisFtsInsert(db, record.id, record.title, record.text);
  replaceOwnerTags(db, { ownerKind: 'synthesis', ownerId: record.id, tags: input.tags });

  const insertSource = db.prepare('INSERT INTO memory_synthesis_sources (id, synthesis_id, fact_id, created_at) VALUES (?, ?, ?, ?)');
  for (const fact of input.sourceFacts) {
    insertSource.run(randomUUID(), record.id, fact.id, now);
  }

  return record;
}
