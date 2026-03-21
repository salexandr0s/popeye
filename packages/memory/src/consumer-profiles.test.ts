import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyConsumerProfile, CONSUMER_PROFILES, getExcludedDomains } from './consumer-profiles.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE memory_namespaces (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      external_ref TEXT,
      label TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_memory_namespaces_kind_ref ON memory_namespaces(kind, external_ref);
  `);
  return db;
}

function insertNamespace(db: Database.Database, id: string, kind: string, externalRef: string | null = null): void {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, kind, externalRef, `${kind} namespace`, now, now,
  );
}

describe('consumer-profiles', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    insertNamespace(db, 'ns-global', 'global');
    insertNamespace(db, 'ns-workspace', 'workspace', 'popeye');
    insertNamespace(db, 'ns-project', 'project', 'popeye');
    insertNamespace(db, 'ns-coding', 'coding', 'popeye');
    insertNamespace(db, 'ns-comms', 'communications', 'telegram');
  });

  afterEach(() => {
    db.close();
  });

  describe('CONSUMER_PROFILES', () => {
    it('defines assistant and coding profiles', () => {
      expect(CONSUMER_PROFILES.assistant).toBeDefined();
      expect(CONSUMER_PROFILES.coding).toBeDefined();
    });

    it('assistant excludes coding domain', () => {
      expect(CONSUMER_PROFILES.assistant.excludedDomains).toContain('coding');
    });

    it('coding includes coding, general, github domains', () => {
      expect(CONSUMER_PROFILES.coding.defaultDomains).toEqual(['coding', 'general', 'github']);
    });
  });

  describe('applyConsumerProfile', () => {
    it('returns empty filters for unknown profile', () => {
      const result = applyConsumerProfile('nonexistent', {}, db);
      expect(result).toEqual({});
    });

    it('returns empty filters for undefined profile', () => {
      const result = applyConsumerProfile(undefined, {}, db);
      expect(result).toEqual({});
    });

    it('resolves coding profile domains', () => {
      const result = applyConsumerProfile('coding', {}, db);
      expect(result.domains).toEqual(['coding', 'general', 'github']);
    });

    it('resolves coding profile namespace IDs', () => {
      const result = applyConsumerProfile('coding', {}, db);
      expect(result.namespaceIds).toBeDefined();
      expect(result.namespaceIds).toContain('ns-coding');
      expect(result.namespaceIds).toContain('ns-workspace');
      expect(result.namespaceIds).toContain('ns-project');
      expect(result.namespaceIds).toContain('ns-global');
    });

    it('explicit query domains override profile defaults', () => {
      const result = applyConsumerProfile('coding', { domains: ['email'] }, db);
      expect(result.domains).toEqual(['email']);
    });

    it('explicit query namespaceIds prevent profile resolution', () => {
      const result = applyConsumerProfile('coding', { namespaceIds: ['custom-ns'] }, db);
      // Profile should not add namespace IDs when query already has them
      expect(result.namespaceIds).toBeUndefined();
    });

    it('sets includeGlobal from profile when not in query', () => {
      const result = applyConsumerProfile('coding', {}, db);
      expect(result.includeGlobal).toBe(true);
    });

    it('does not override explicit includeGlobal', () => {
      const result = applyConsumerProfile('coding', { includeGlobal: false }, db);
      expect(result.includeGlobal).toBeUndefined();
    });
  });

  describe('getExcludedDomains', () => {
    it('returns excluded domains for assistant profile', () => {
      const excluded = getExcludedDomains('assistant');
      expect(excluded).toContain('coding');
    });

    it('returns excluded domains for coding profile', () => {
      const excluded = getExcludedDomains('coding');
      expect(excluded).toContain('email');
      expect(excluded).toContain('finance');
      expect(excluded).toContain('medical');
    });

    it('returns empty for unknown profile', () => {
      expect(getExcludedDomains('nonexistent')).toEqual([]);
    });

    it('returns empty for undefined profile', () => {
      expect(getExcludedDomains(undefined)).toEqual([]);
    });
  });
});
