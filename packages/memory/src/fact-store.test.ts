import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { MemoryArtifactRecord } from '@popeye/contracts';
import { upsertFacts } from './fact-store.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE memory_namespaces (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, external_ref TEXT,
      label TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE memory_artifacts (
      id TEXT PRIMARY KEY, source_type TEXT NOT NULL, classification TEXT NOT NULL,
      scope TEXT NOT NULL, workspace_id TEXT, project_id TEXT, namespace_id TEXT NOT NULL,
      source_run_id TEXT, source_ref TEXT, source_ref_type TEXT, captured_at TEXT NOT NULL,
      occurred_at TEXT, content TEXT NOT NULL, content_hash TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}', domain TEXT NOT NULL DEFAULT 'general',
      source_stream_id TEXT, artifact_version INTEGER NOT NULL DEFAULT 1,
      context_release_policy TEXT NOT NULL DEFAULT 'full',
      trust_score REAL NOT NULL DEFAULT 0.7, invalidated_at TEXT
    );
    CREATE TABLE memory_facts (
      id TEXT PRIMARY KEY, namespace_id TEXT NOT NULL, scope TEXT NOT NULL,
      workspace_id TEXT, project_id TEXT, classification TEXT NOT NULL,
      source_type TEXT NOT NULL, memory_type TEXT NOT NULL, fact_kind TEXT NOT NULL,
      text TEXT NOT NULL, confidence REAL NOT NULL, source_reliability REAL NOT NULL,
      extraction_confidence REAL NOT NULL, human_confirmed INTEGER NOT NULL DEFAULT 0,
      occurred_at TEXT, valid_from TEXT, valid_to TEXT, source_run_id TEXT,
      source_timestamp TEXT, dedup_key TEXT, last_reinforced_at TEXT, archived_at TEXT,
      created_at TEXT NOT NULL, durable INTEGER NOT NULL DEFAULT 0,
      revision_status TEXT NOT NULL DEFAULT 'active', domain TEXT DEFAULT 'general',
      root_fact_id TEXT, parent_fact_id TEXT, is_latest INTEGER NOT NULL DEFAULT 1,
      claim_key TEXT, salience REAL NOT NULL DEFAULT 0.5,
      support_count INTEGER NOT NULL DEFAULT 1,
      source_trust_score REAL NOT NULL DEFAULT 0.7,
      context_release_policy TEXT NOT NULL DEFAULT 'full',
      forget_after TEXT, stale_after TEXT, expired_at TEXT, invalidated_at TEXT,
      operator_status TEXT NOT NULL DEFAULT 'normal'
    );
    CREATE UNIQUE INDEX idx_memory_facts_dedup_key ON memory_facts(dedup_key) WHERE dedup_key IS NOT NULL;
    CREATE INDEX idx_facts_claim_key ON memory_facts(claim_key);
    CREATE INDEX idx_facts_is_latest ON memory_facts(is_latest, archived_at);
    CREATE VIRTUAL TABLE memory_facts_fts USING fts5(fact_id UNINDEXED, text);
    CREATE TABLE memory_fact_sources (
      id TEXT PRIMARY KEY, fact_id TEXT NOT NULL, artifact_id TEXT NOT NULL,
      excerpt TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE memory_tags (
      id TEXT PRIMARY KEY, owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL,
      tag TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE memory_relations (
      id TEXT PRIMARY KEY, relation_type TEXT NOT NULL,
      source_kind TEXT NOT NULL, source_id TEXT NOT NULL,
      target_kind TEXT NOT NULL, target_id TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0, created_by TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '', metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_relations_source ON memory_relations(source_kind, source_id);
    CREATE INDEX idx_relations_target ON memory_relations(target_kind, target_id);
  `);
  return db;
}

const ARTIFACT: MemoryArtifactRecord = {
  id: 'art-1',
  sourceType: 'receipt',
  classification: 'internal',
  scope: 'workspace',
  workspaceId: 'ws-1',
  projectId: null,
  namespaceId: 'ns-1',
  sourceRunId: 'run-1',
  sourceRef: null,
  sourceRefType: null,
  capturedAt: new Date().toISOString(),
  occurredAt: null,
  content: 'test content',
  contentHash: 'hash',
  metadataJson: {},
  domain: 'general',
  sourceStreamId: null,
  artifactVersion: 1,
  contextReleasePolicy: 'full',
  trustScore: 0.7,
  invalidatedAt: null,
};

describe('upsertFacts', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('inserts a new fact with claim_key populated', () => {
    const result = upsertFacts(db, {
      artifact: ARTIFACT,
      sourceType: 'receipt',
      scope: 'workspace',
      classification: 'internal',
      memoryType: 'semantic',
      facts: [{
        factKind: 'preference',
        text: 'User prefers dark mode',
        confidence: 0.8,
        sourceReliability: 0.9,
        extractionConfidence: 0.85,
        durable: true,
        occurredAt: null,
        validFrom: null,
        validTo: null,
      }],
    });

    expect(result.inserted).toBe(1);
    expect(result.reinforced).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.records).toHaveLength(1);

    const rec = result.records[0]!;
    expect(rec.claimKey).toBeTruthy();
    expect(rec.rootFactId).toBeNull();
    expect(rec.parentFactId).toBeNull();
    expect(rec.isLatest).toBe(true);
    expect(rec.supportCount).toBe(1);

    // Verify persisted in DB
    const row = db.prepare('SELECT claim_key, is_latest, support_count, durable FROM memory_facts WHERE id = ?').get(rec.id) as Record<string, unknown>;
    expect(row.claim_key).toBe(rec.claimKey);
    expect(row.is_latest).toBe(1);
    expect(row.durable).toBe(1);
  });

  it('reinforces duplicate (same dedup_key) with support_count increment', () => {
    const facts = [{
      factKind: 'preference',
      text: 'User prefers dark mode',
      confidence: 0.8,
      sourceReliability: 0.7,
      extractionConfidence: 0.75,
      durable: false,
      occurredAt: null,
      validFrom: null,
      validTo: null,
    }];

    const first = upsertFacts(db, { artifact: ARTIFACT, sourceType: 'receipt', scope: 'workspace', classification: 'internal', memoryType: 'semantic', facts });
    expect(first.inserted).toBe(1);

    // Reinforce with higher reliability
    const reinforceFacts = [{
      ...facts[0]!,
      sourceReliability: 0.95,
      extractionConfidence: 0.9,
      durable: true,
    }];
    const second = upsertFacts(db, { artifact: ARTIFACT, sourceType: 'receipt', scope: 'workspace', classification: 'internal', memoryType: 'semantic', facts: reinforceFacts });
    expect(second.reinforced).toBe(1);
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(0);

    // Verify DB state
    const row = db.prepare('SELECT support_count, source_reliability, extraction_confidence, durable, confidence FROM memory_facts WHERE id = ?').get(first.records[0]!.id) as Record<string, number>;
    expect(row.support_count).toBe(2);
    expect(row.source_reliability).toBe(0.95); // max(0.7, 0.95)
    expect(row.extraction_confidence).toBe(0.9); // max(0.75, 0.9)
    expect(row.durable).toBe(1); // promoted to durable
    expect(row.confidence).toBeGreaterThan(0.8); // boosted
  });

  it('creates version chain when claim_key matches but text differs', () => {
    // Use a shared prefix >100 chars so claim_key matches, but full text differs for different dedup_key
    const sharedPrefix = 'The team has decided on the following architectural approach for the database layer which involves using PostgreSQL';
    const firstFacts = [{
      factKind: 'preference',
      text: sharedPrefix + ' version 14 with standard configuration',
      confidence: 0.8,
      sourceReliability: 0.9,
      extractionConfidence: 0.85,
      durable: true,
      occurredAt: null,
      validFrom: null,
      validTo: null,
    }];

    const first = upsertFacts(db, { artifact: ARTIFACT, sourceType: 'receipt', scope: 'workspace', classification: 'internal', memoryType: 'semantic', facts: firstFacts });
    const oldId = first.records[0]!.id;

    // Same claim key prefix (first 100 chars identical) but different full text
    const updatedFacts = [{
      ...firstFacts[0]!,
      text: sharedPrefix + ' version 16 with advanced partitioning',
    }];
    const second = upsertFacts(db, { artifact: ARTIFACT, sourceType: 'receipt', scope: 'workspace', classification: 'internal', memoryType: 'semantic', facts: updatedFacts });

    expect(second.updated).toBe(1);
    expect(second.inserted).toBe(0);
    expect(second.reinforced).toBe(0);

    const newRec = second.records[0]!;
    expect(newRec.parentFactId).toBe(oldId);
    expect(newRec.rootFactId).toBe(oldId);
    expect(newRec.isLatest).toBe(true);

    // Old fact should no longer be latest
    const oldRow = db.prepare('SELECT is_latest FROM memory_facts WHERE id = ?').get(oldId) as { is_latest: number };
    expect(oldRow.is_latest).toBe(0);

    // Relation should exist
    const relations = db.prepare('SELECT * FROM memory_relations WHERE source_id = ? AND target_id = ?').all(newRec.id, oldId) as Array<Record<string, unknown>>;
    expect(relations).toHaveLength(1);
    expect(relations[0]!.relation_type).toBe('updates');
  });

  it('falls back to dedup_key for legacy facts with claim_key=NULL', () => {
    const legacyFacts = [{
      factKind: 'preference',
      text: 'User prefers dark mode',
      confidence: 0.7,
      sourceReliability: 0.8,
      extractionConfidence: 0.8,
      durable: false,
      occurredAt: null,
      validFrom: null,
      validTo: null,
    }];

    // Insert via upsertFacts to get correct dedup_key
    const first = upsertFacts(db, { artifact: ARTIFACT, sourceType: 'receipt', scope: 'workspace', classification: 'internal', memoryType: 'semantic', facts: legacyFacts });
    const legacyId = first.records[0]!.id;

    // Simulate legacy state by clearing claim_key
    db.prepare('UPDATE memory_facts SET claim_key = NULL WHERE id = ?').run(legacyId);

    // Re-ingest same text — should find via dedup_key fallback
    const result = upsertFacts(db, {
      artifact: ARTIFACT,
      sourceType: 'receipt',
      scope: 'workspace',
      classification: 'internal',
      memoryType: 'semantic',
      facts: [{
        ...legacyFacts[0]!,
        confidence: 0.8,
        sourceReliability: 0.9,
        extractionConfidence: 0.85,
      }],
    });

    expect(result.reinforced).toBe(1);
    expect(result.inserted).toBe(0);
    expect(result.records[0]!.id).toBe(legacyId);

    // claim_key should be backfilled
    const row = db.prepare('SELECT claim_key, support_count FROM memory_facts WHERE id = ?').get(legacyId) as Record<string, unknown>;
    expect(row.claim_key).toBeTruthy();
    expect(row.support_count).toBe(2);
  });

  it('returns correct counters for mixed operations', () => {
    // First insert two facts
    const facts = [
      { factKind: 'preference', text: 'Likes TypeScript', confidence: 0.8, sourceReliability: 0.9, extractionConfidence: 0.85, durable: false, occurredAt: null, validFrom: null, validTo: null },
      { factKind: 'identity', text: 'Senior engineer', confidence: 0.9, sourceReliability: 0.9, extractionConfidence: 0.9, durable: true, occurredAt: null, validFrom: null, validTo: null },
    ];
    const first = upsertFacts(db, { artifact: ARTIFACT, sourceType: 'receipt', scope: 'workspace', classification: 'internal', memoryType: 'semantic', facts });
    expect(first.inserted).toBe(2);

    // Re-ingest same facts
    const second = upsertFacts(db, { artifact: ARTIFACT, sourceType: 'receipt', scope: 'workspace', classification: 'internal', memoryType: 'semantic', facts });
    expect(second.reinforced).toBe(2);
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(0);
  });
});
