import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';
import type { EvidenceLink, MemoryArtifactRecord, MemoryFactRecord, RevisionStatus } from '@popeye/contracts';
import { sha256 } from '@popeye/observability';

import type { ExtractedFact } from './fact-extractor.js';
import { canonicalizeMemoryLocation } from './location.js';
import { replaceOwnerTags } from './namespace.js';

function buildFactDedupKey(scope: string, factKind: string, text: string): string {
  return sha256(`${scope}:${factKind}:${text.trim().toLowerCase().slice(0, 400)}`);
}

function syncFactFtsInsert(db: Database.Database, factId: string, text: string): void {
  db.prepare('INSERT INTO memory_facts_fts (fact_id, text) VALUES (?, ?)').run(factId, text);
}

export interface UpsertFactsInput {
  artifact: MemoryArtifactRecord;
  sourceType: MemoryFactRecord['sourceType'];
  scope: string;
  workspaceId?: string | null | undefined;
  projectId?: string | null | undefined;
  classification: MemoryFactRecord['classification'];
  memoryType: MemoryFactRecord['memoryType'];
  sourceRunId?: string | null | undefined;
  sourceTimestamp?: string | null | undefined;
  facts: ExtractedFact[];
  tags?: string[] | undefined;
}

export interface UpsertFactsResult {
  records: MemoryFactRecord[];
  inserted: number;
  reinforced: number;
}

export function upsertFacts(db: Database.Database, input: UpsertFactsInput): UpsertFactsResult {
  const now = new Date().toISOString();
  const location = canonicalizeMemoryLocation({
    scope: input.scope,
    workspaceId: input.workspaceId ?? input.artifact.workspaceId,
    projectId: input.projectId ?? input.artifact.projectId,
  });
  let inserted = 0;
  let reinforced = 0;
  const records: MemoryFactRecord[] = [];

  const tx = db.transaction(() => {
    for (const fact of input.facts) {
      const dedupKey = buildFactDedupKey(location.scope, fact.factKind, fact.text);
      const existing = db.prepare(
        `SELECT id, confidence, source_reliability, extraction_confidence, human_confirmed, occurred_at, valid_from, valid_to, last_reinforced_at, archived_at, created_at, durable, revision_status
         FROM memory_facts
         WHERE dedup_key = ? AND archived_at IS NULL
         LIMIT 1`,
      ).get(dedupKey) as {
        id: string;
        confidence: number;
        source_reliability: number;
        extraction_confidence: number;
        human_confirmed: number;
        occurred_at: string | null;
        valid_from: string | null;
        valid_to: string | null;
        last_reinforced_at: string | null;
        archived_at: string | null;
        created_at: string;
        durable: number;
        revision_status: RevisionStatus;
      } | undefined;

      let record: MemoryFactRecord;
      if (existing) {
        const newConfidence = Math.min(1, Math.max(existing.confidence, fact.confidence) + 0.05);
        db.prepare(
          'UPDATE memory_facts SET scope = ?, workspace_id = ?, project_id = ?, confidence = ?, last_reinforced_at = ?, archived_at = NULL, occurred_at = COALESCE(occurred_at, ?), valid_from = COALESCE(valid_from, ?), valid_to = COALESCE(valid_to, ?), revision_status = ? WHERE id = ?',
        ).run(location.scope, location.workspaceId, location.projectId, newConfidence, now, fact.occurredAt, fact.validFrom, fact.validTo, 'active', existing.id);
        record = {
          id: existing.id,
          namespaceId: input.artifact.namespaceId,
          scope: location.scope,
          workspaceId: location.workspaceId,
          projectId: location.projectId,
          classification: input.classification,
          sourceType: input.sourceType,
          memoryType: input.memoryType,
          factKind: fact.factKind,
          text: fact.text,
          confidence: newConfidence,
          sourceReliability: Math.max(existing.source_reliability, fact.sourceReliability),
          extractionConfidence: Math.max(existing.extraction_confidence, fact.extractionConfidence),
          humanConfirmed: Boolean(existing.human_confirmed),
          occurredAt: existing.occurred_at ?? fact.occurredAt,
          validFrom: existing.valid_from ?? fact.validFrom,
          validTo: existing.valid_to ?? fact.validTo,
          sourceRunId: input.sourceRunId ?? input.artifact.sourceRunId,
          sourceTimestamp: input.sourceTimestamp ?? input.artifact.capturedAt,
          dedupKey,
          lastReinforcedAt: now,
          archivedAt: null,
          createdAt: existing.created_at,
          durable: Boolean(existing.durable || fact.durable),
          revisionStatus: 'active',
        };
        reinforced++;
      } else {
        record = {
          id: randomUUID(),
          namespaceId: input.artifact.namespaceId,
          scope: location.scope,
          workspaceId: location.workspaceId,
          projectId: location.projectId,
          classification: input.classification,
          sourceType: input.sourceType,
          memoryType: input.memoryType,
          factKind: fact.factKind,
          text: fact.text,
          confidence: fact.confidence,
          sourceReliability: fact.sourceReliability,
          extractionConfidence: fact.extractionConfidence,
          humanConfirmed: false,
          occurredAt: fact.occurredAt,
          validFrom: fact.validFrom,
          validTo: fact.validTo,
          sourceRunId: input.sourceRunId ?? input.artifact.sourceRunId,
          sourceTimestamp: input.sourceTimestamp ?? input.artifact.capturedAt,
          dedupKey,
          lastReinforcedAt: now,
          archivedAt: null,
          createdAt: now,
          durable: fact.durable,
          revisionStatus: 'active',
        };
        db.prepare(
          'INSERT INTO memory_facts (id, namespace_id, scope, workspace_id, project_id, classification, source_type, memory_type, fact_kind, text, confidence, source_reliability, extraction_confidence, human_confirmed, occurred_at, valid_from, valid_to, source_run_id, source_timestamp, dedup_key, last_reinforced_at, archived_at, created_at, durable, revision_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          record.id,
          record.namespaceId,
          record.scope,
          record.workspaceId,
          record.projectId,
          record.classification,
          record.sourceType,
          record.memoryType,
          record.factKind,
          record.text,
          record.confidence,
          record.sourceReliability,
          record.extractionConfidence,
          record.humanConfirmed ? 1 : 0,
          record.occurredAt,
          record.validFrom,
          record.validTo,
          record.sourceRunId,
          record.sourceTimestamp,
          record.dedupKey,
          record.lastReinforcedAt,
          record.archivedAt,
          record.createdAt,
          record.durable ? 1 : 0,
          record.revisionStatus,
        );
        syncFactFtsInsert(db, record.id, record.text);
        inserted++;
      }

      db.prepare('INSERT OR IGNORE INTO memory_fact_sources (id, fact_id, artifact_id, excerpt, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(randomUUID(), record.id, input.artifact.id, fact.text.slice(0, 500), now);
      replaceOwnerTags(db, { ownerKind: 'fact', ownerId: record.id, tags: input.tags });
      records.push(record);
    }
  });

  tx();
  return { records, inserted, reinforced };
}

export function getEvidenceLinks(db: Database.Database, ownerKind: 'fact' | 'synthesis', ownerId: string): EvidenceLink[] {
  if (ownerKind === 'fact') {
    return db.prepare(
      `SELECT id, fact_id, artifact_id, excerpt, created_at
       FROM memory_fact_sources
       WHERE fact_id = ?
       ORDER BY created_at ASC`,
    ).all(ownerId).map((row) => {
      const value = row as { id: string; fact_id: string; artifact_id: string; excerpt: string | null; created_at: string };
      return {
        id: value.id,
        sourceKind: 'fact' as const,
        sourceId: value.fact_id,
        targetKind: 'artifact' as const,
        targetId: value.artifact_id,
        excerpt: value.excerpt,
        createdAt: value.created_at,
      };
    });
  }

  return db.prepare(
    `SELECT id, synthesis_id, fact_id, created_at
     FROM memory_synthesis_sources
     WHERE synthesis_id = ?
     ORDER BY created_at ASC`,
  ).all(ownerId).map((row) => {
    const value = row as { id: string; synthesis_id: string; fact_id: string; created_at: string };
    return {
      id: value.id,
      sourceKind: 'synthesis' as const,
      sourceId: value.synthesis_id,
      targetKind: 'fact' as const,
      targetId: value.fact_id,
      excerpt: null,
      createdAt: value.created_at,
    };
  });
}
