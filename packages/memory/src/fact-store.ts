import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';
import type { DomainKind, EvidenceLink, MemoryArtifactRecord, MemoryFactRecord, RevisionStatus } from '@popeye/contracts';
import { sha256 } from '@popeye/observability';

import type { ExtractedFact } from './fact-extractor.js';
import { computeClaimKey, resolveFact } from './fact-resolver.js';
import { canonicalizeMemoryLocation } from './location.js';
import { replaceOwnerTags } from './namespace.js';
import { createRelation } from './relations.js';

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
  domain?: DomainKind | undefined;
}

export interface UpsertFactsResult {
  records: MemoryFactRecord[];
  inserted: number;
  reinforced: number;
  updated: number;
}

interface ExistingFactRow {
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
  root_fact_id: string | null;
  claim_key: string | null;
  support_count: number;
  source_trust_score: number;
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
  let updated = 0;
  const records: MemoryFactRecord[] = [];

  const tx = db.transaction(() => {
    for (const fact of input.facts) {
      const dedupKey = buildFactDedupKey(location.scope, fact.factKind, fact.text);
      const claimKey = computeClaimKey(location.scope, fact.factKind, fact.text);

      // Use claim-key-based resolver first, then fall back to dedup_key for legacy facts
      const resolution = resolveFact(db, { claimKey, dedupKey });

      let record: MemoryFactRecord;

      if (resolution.action === 'duplicate') {
        // Exact match — reinforce existing fact, bump support_count
        record = reinforceFact(db, resolution.existingFactId, fact, input, location, claimKey, dedupKey, now);
        reinforced++;
      } else if (resolution.action === 'update') {
        // Same claim, different text — create version chain
        record = createVersionedFact(db, resolution.existingFactId, resolution.existingRootFactId, fact, input, location, claimKey, dedupKey, now);
        updated++;
      } else {
        // No claim_key match — check legacy dedup_key as fallback for old facts with claim_key=NULL
        const legacyExisting = db.prepare(
          `SELECT id, confidence, source_reliability, extraction_confidence, human_confirmed,
                  occurred_at, valid_from, valid_to, last_reinforced_at, archived_at, created_at,
                  durable, revision_status, root_fact_id, claim_key, support_count, source_trust_score
           FROM memory_facts
           WHERE dedup_key = ? AND archived_at IS NULL
           LIMIT 1`,
        ).get(dedupKey) as ExistingFactRow | undefined;

        if (legacyExisting) {
          // Legacy match — reinforce and backfill claim_key
          record = reinforceFact(db, legacyExisting.id, fact, input, location, claimKey, dedupKey, now);
          reinforced++;
        } else {
          // Genuinely new fact
          record = insertNewFact(db, fact, input, location, claimKey, dedupKey, now);
          inserted++;
        }
      }

      db.prepare('INSERT OR IGNORE INTO memory_fact_sources (id, fact_id, artifact_id, excerpt, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(randomUUID(), record.id, input.artifact.id, fact.text.slice(0, 500), now);
      replaceOwnerTags(db, { ownerKind: 'fact', ownerId: record.id, tags: input.tags });
      records.push(record);
    }
  });

  tx();
  return { records, inserted, reinforced, updated };
}

function reinforceFact(
  db: Database.Database,
  existingId: string,
  fact: ExtractedFact,
  input: UpsertFactsInput,
  location: { scope: string; workspaceId: string | null; projectId: string | null },
  claimKey: string,
  dedupKey: string,
  now: string,
): MemoryFactRecord {
  const existing = db.prepare(
    `SELECT id, confidence, source_reliability, extraction_confidence, human_confirmed,
            occurred_at, valid_from, valid_to, last_reinforced_at, archived_at, created_at,
            durable, revision_status, root_fact_id, claim_key, support_count, source_trust_score
     FROM memory_facts WHERE id = ?`,
  ).get(existingId) as ExistingFactRow;

  const newConfidence = Math.min(1, Math.max(existing.confidence, fact.confidence) + 0.05);
  const newSupportCount = existing.support_count + 1;
  // Weighted average for trust score
  const newTrustScore = (existing.source_trust_score * existing.support_count + 0.7) / newSupportCount;

  const newSourceReliability = Math.max(existing.source_reliability, fact.sourceReliability);
  const newExtractionConfidence = Math.max(existing.extraction_confidence, fact.extractionConfidence);
  const newDurable = Boolean(existing.durable || fact.durable);

  db.prepare(
    `UPDATE memory_facts
     SET scope = ?, workspace_id = ?, project_id = ?, confidence = ?, last_reinforced_at = ?,
         archived_at = NULL, occurred_at = COALESCE(occurred_at, ?), valid_from = COALESCE(valid_from, ?),
         valid_to = COALESCE(valid_to, ?), revision_status = ?, domain = COALESCE(?, domain),
         claim_key = COALESCE(claim_key, ?), support_count = ?, source_trust_score = ?,
         source_reliability = ?, extraction_confidence = ?, durable = ?
     WHERE id = ?`,
  ).run(
    location.scope, location.workspaceId, location.projectId, newConfidence, now,
    fact.occurredAt, fact.validFrom, fact.validTo, 'active', input.domain,
    claimKey, newSupportCount, newTrustScore,
    newSourceReliability, newExtractionConfidence, newDurable ? 1 : 0,
    existing.id,
  );

  return {
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
    sourceReliability: newSourceReliability,
    extractionConfidence: newExtractionConfidence,
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
    durable: newDurable,
    revisionStatus: 'active',
    domain: input.domain ?? 'general',
    rootFactId: existing.root_fact_id,
    parentFactId: null,
    isLatest: true,
    claimKey: existing.claim_key ?? claimKey,
    salience: 0.5,
    supportCount: newSupportCount,
    sourceTrustScore: newTrustScore,
    contextReleasePolicy: 'full',
    forgetAfter: null,
    staleAfter: null,
    expiredAt: null,
    invalidatedAt: null,
    operatorStatus: 'normal',
  };
}

function createVersionedFact(
  db: Database.Database,
  existingId: string,
  existingRootFactId: string | null,
  fact: ExtractedFact,
  input: UpsertFactsInput,
  location: { scope: string; workspaceId: string | null; projectId: string | null },
  claimKey: string,
  dedupKey: string,
  now: string,
): MemoryFactRecord {
  // Mark the old fact as no longer latest
  db.prepare('UPDATE memory_facts SET is_latest = 0 WHERE id = ?').run(existingId);

  // Root is the original fact in the chain
  const rootFactId = existingRootFactId ?? existingId;

  const record: MemoryFactRecord = {
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
    domain: input.domain ?? 'general',
    rootFactId,
    parentFactId: existingId,
    isLatest: true,
    claimKey,
    salience: 0.5,
    supportCount: 1,
    sourceTrustScore: 0.7,
    contextReleasePolicy: 'full',
    forgetAfter: null,
    staleAfter: null,
    expiredAt: null,
    invalidatedAt: null,
    operatorStatus: 'normal',
  };

  db.prepare(
    `INSERT INTO memory_facts (id, namespace_id, scope, workspace_id, project_id, classification,
      source_type, memory_type, fact_kind, text, confidence, source_reliability, extraction_confidence,
      human_confirmed, occurred_at, valid_from, valid_to, source_run_id, source_timestamp, dedup_key,
      last_reinforced_at, archived_at, created_at, durable, revision_status, domain,
      root_fact_id, parent_fact_id, is_latest, claim_key, salience, support_count,
      source_trust_score, context_release_policy, operator_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id, record.namespaceId, record.scope, record.workspaceId, record.projectId,
    record.classification, record.sourceType, record.memoryType, record.factKind, record.text,
    record.confidence, record.sourceReliability, record.extractionConfidence,
    record.humanConfirmed ? 1 : 0, record.occurredAt, record.validFrom, record.validTo,
    record.sourceRunId, record.sourceTimestamp, record.dedupKey, record.lastReinforcedAt,
    record.archivedAt, record.createdAt, record.durable ? 1 : 0, record.revisionStatus,
    input.domain ?? 'general', record.rootFactId, record.parentFactId, record.isLatest ? 1 : 0,
    record.claimKey, record.salience, record.supportCount, record.sourceTrustScore,
    record.contextReleasePolicy, record.operatorStatus,
  );

  syncFactFtsInsert(db, record.id, record.text);

  // Create 'updates' relation linking new fact → old fact
  createRelation(db, {
    relationType: 'updates',
    sourceKind: 'fact',
    sourceId: record.id,
    targetKind: 'fact',
    targetId: existingId,
    createdBy: 'resolver',
    reason: 'Claim key match with different text — version update',
  });

  return record;
}

function insertNewFact(
  db: Database.Database,
  fact: ExtractedFact,
  input: UpsertFactsInput,
  location: { scope: string; workspaceId: string | null; projectId: string | null },
  claimKey: string,
  dedupKey: string,
  now: string,
): MemoryFactRecord {
  const record: MemoryFactRecord = {
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
    domain: input.domain ?? 'general',
    rootFactId: null,
    parentFactId: null,
    isLatest: true,
    claimKey,
    salience: 0.5,
    supportCount: 1,
    sourceTrustScore: 0.7,
    contextReleasePolicy: 'full',
    forgetAfter: null,
    staleAfter: null,
    expiredAt: null,
    invalidatedAt: null,
    operatorStatus: 'normal',
  };

  db.prepare(
    `INSERT INTO memory_facts (id, namespace_id, scope, workspace_id, project_id, classification,
      source_type, memory_type, fact_kind, text, confidence, source_reliability, extraction_confidence,
      human_confirmed, occurred_at, valid_from, valid_to, source_run_id, source_timestamp, dedup_key,
      last_reinforced_at, archived_at, created_at, durable, revision_status, domain,
      root_fact_id, parent_fact_id, is_latest, claim_key, salience, support_count,
      source_trust_score, context_release_policy, operator_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id, record.namespaceId, record.scope, record.workspaceId, record.projectId,
    record.classification, record.sourceType, record.memoryType, record.factKind, record.text,
    record.confidence, record.sourceReliability, record.extractionConfidence,
    record.humanConfirmed ? 1 : 0, record.occurredAt, record.validFrom, record.validTo,
    record.sourceRunId, record.sourceTimestamp, record.dedupKey, record.lastReinforcedAt,
    record.archivedAt, record.createdAt, record.durable ? 1 : 0, record.revisionStatus,
    input.domain ?? 'general', record.rootFactId, record.parentFactId, record.isLatest ? 1 : 0,
    record.claimKey, record.salience, record.supportCount, record.sourceTrustScore,
    record.contextReleasePolicy, record.operatorStatus,
  );

  syncFactFtsInsert(db, record.id, record.text);
  return record;
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
