import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRelation, getRelationsForSource, getRelationsForTarget, countRelationsForSource } from './relations.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE memory_relations (
      id TEXT PRIMARY KEY,
      relation_type TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      created_by TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_relations_source ON memory_relations(source_kind, source_id);
    CREATE INDEX idx_relations_target ON memory_relations(target_kind, target_id);
    CREATE INDEX idx_relations_type ON memory_relations(relation_type);
  `);
  return db;
}

describe('relations', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('creates a relation and retrieves it by source', () => {
    const rel = createRelation(db, {
      relationType: 'updates',
      sourceKind: 'fact',
      sourceId: 'fact-new',
      targetKind: 'fact',
      targetId: 'fact-old',
      createdBy: 'resolver',
      reason: 'version update',
    });

    expect(rel.id).toBeDefined();
    expect(rel.relationType).toBe('updates');
    expect(rel.sourceId).toBe('fact-new');
    expect(rel.targetId).toBe('fact-old');
    expect(rel.confidence).toBe(1.0);
    expect(rel.reason).toBe('version update');

    const bySource = getRelationsForSource(db, 'fact', 'fact-new');
    expect(bySource).toHaveLength(1);
    expect(bySource[0]!.id).toBe(rel.id);
  });

  it('retrieves relations by target', () => {
    createRelation(db, {
      relationType: 'updates',
      sourceKind: 'fact',
      sourceId: 'fact-v2',
      targetKind: 'fact',
      targetId: 'fact-v1',
      createdBy: 'resolver',
    });

    const byTarget = getRelationsForTarget(db, 'fact', 'fact-v1');
    expect(byTarget).toHaveLength(1);
    expect(byTarget[0]!.sourceId).toBe('fact-v2');
  });

  it('counts relations for source', () => {
    expect(countRelationsForSource(db, 'fact', 'f1')).toBe(0);

    createRelation(db, {
      relationType: 'extends',
      sourceKind: 'fact',
      sourceId: 'f1',
      targetKind: 'fact',
      targetId: 'f2',
      createdBy: 'resolver',
    });

    expect(countRelationsForSource(db, 'fact', 'f1')).toBe(1);
  });

  it('enforces relation cap (max 20 per source)', () => {
    for (let i = 0; i < 20; i++) {
      createRelation(db, {
        relationType: 'related_to',
        sourceKind: 'fact',
        sourceId: 'capped-fact',
        targetKind: 'fact',
        targetId: `target-${i}`,
        createdBy: 'resolver',
      });
    }

    expect(() => createRelation(db, {
      relationType: 'related_to',
      sourceKind: 'fact',
      sourceId: 'capped-fact',
      targetKind: 'fact',
      targetId: 'target-overflow',
      createdBy: 'resolver',
    })).toThrow(/cap exceeded/i);
  });

  it('stores and retrieves metadata', () => {
    const rel = createRelation(db, {
      relationType: 'confirmed_by',
      sourceKind: 'fact',
      sourceId: 'f1',
      targetKind: 'fact',
      targetId: 'f2',
      createdBy: 'operator',
      metadata: { source: 'manual_review' },
    });

    const retrieved = getRelationsForSource(db, 'fact', 'f1');
    expect(retrieved[0]!.metadataJson).toEqual({ source: 'manual_review' });
    expect(rel.metadataJson).toEqual({ source: 'manual_review' });
  });

  it('stores custom confidence', () => {
    const rel = createRelation(db, {
      relationType: 'contradicts',
      sourceKind: 'fact',
      sourceId: 'f1',
      targetKind: 'fact',
      targetId: 'f2',
      confidence: 0.6,
      createdBy: 'resolver',
    });

    expect(rel.confidence).toBe(0.6);
  });
});
