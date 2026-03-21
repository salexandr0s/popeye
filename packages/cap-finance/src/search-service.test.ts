import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, it, expect, afterEach } from 'vitest';

import type { CapabilityContext } from '@popeye/contracts';

import { getFinanceMigrations } from './migrations.js';
import { FinanceService } from './finance-service.js';
import { FinanceSearchService } from './search-service.js';

function createTestDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-finance-search-test-'));
  const dbPath = join(dir, 'finance-search-test.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const migration of getFinanceMigrations()) {
    for (const stmt of migration.statements) {
      db.exec(stmt);
    }
  }
  return db;
}

function seedData(svc: FinanceService): { importId: string } {
  const imp = svc.createImport({ vaultId: 'v1', importType: 'csv', fileName: 'seed.csv' });
  svc.insertTransaction({
    importId: imp.id,
    date: '2025-01-10',
    description: 'Whole Foods organic groceries',
    amount: -85.50,
    category: 'groceries',
    redactedSummary: 'Grocery store purchase for weekly essentials',
  });
  svc.insertTransaction({
    importId: imp.id,
    date: '2025-02-15',
    description: 'Shell gas station fuel',
    amount: -52.00,
    category: 'transport',
    redactedSummary: 'Fuel purchase at gas station',
  });
  svc.insertTransaction({
    importId: imp.id,
    date: '2025-03-20',
    description: 'Netflix subscription monthly',
    amount: -15.99,
    category: 'entertainment',
    redactedSummary: 'Monthly streaming subscription',
  });
  svc.insertTransaction({
    importId: imp.id,
    date: '2025-04-05',
    description: 'Trader Joe specialty items',
    amount: -42.30,
    category: 'groceries',
    redactedSummary: 'Grocery store specialty purchase',
  });
  return { importId: imp.id };
}

describe('FinanceSearchService', () => {
  let db: Database.Database;

  function setup(): { financeSvc: FinanceService; searchSvc: FinanceSearchService } {
    db = createTestDb();
    const capDb = db as unknown as CapabilityContext['appDb'];
    return {
      financeSvc: new FinanceService(capDb),
      searchSvc: new FinanceSearchService(capDb),
    };
  }

  afterEach(() => {
    if (db) db.close();
  });

  it('FTS5 match by description', () => {
    const { financeSvc, searchSvc } = setup();
    seedData(financeSvc);

    const result = searchSvc.search({ query: 'groceries' });
    expect(result.results.length).toBeGreaterThanOrEqual(1);
    expect(result.results.some((r) => r.description.includes('Whole Foods'))).toBe(true);
  });

  it('FTS5 match by redacted_summary', () => {
    const { financeSvc, searchSvc } = setup();
    seedData(financeSvc);

    const result = searchSvc.search({ query: 'streaming subscription' });
    expect(result.results.length).toBeGreaterThanOrEqual(1);
    expect(result.results.some((r) => r.description.includes('Netflix'))).toBe(true);
  });

  it('dateFrom/dateTo filter', () => {
    const { financeSvc, searchSvc } = setup();
    seedData(financeSvc);

    // Search for "grocery" but restrict to Feb-Mar (should exclude Jan and Apr hits)
    const result = searchSvc.search({
      query: 'grocery OR fuel OR subscription OR specialty',
      dateFrom: '2025-02-01',
      dateTo: '2025-03-31',
    });
    expect(result.results.length).toBe(2);
    expect(result.results.every((r) => r.date >= '2025-02-01' && r.date <= '2025-03-31')).toBe(true);
  });

  it('category filter', () => {
    const { financeSvc, searchSvc } = setup();
    seedData(financeSvc);

    // Match broad query but filter to groceries category only
    const result = searchSvc.search({
      query: 'purchase OR store OR station OR subscription',
      category: 'groceries',
    });
    expect(result.results.length).toBeGreaterThanOrEqual(1);
    // All matched transactions should have category = groceries via the JOIN
    for (const r of result.results) {
      const txn = financeSvc.getTransaction(r.transactionId);
      expect(txn).not.toBeNull();
      expect(txn!.category).toBe('groceries');
    }
  });

  it('empty result for unmatched query', () => {
    const { financeSvc, searchSvc } = setup();
    seedData(financeSvc);

    const result = searchSvc.search({ query: 'zyxwvutsrqp' });
    expect(result.results).toHaveLength(0);
  });

  it('malformed query fallback (special chars)', () => {
    const { financeSvc, searchSvc } = setup();
    seedData(financeSvc);

    // The search service should handle malformed FTS5 queries gracefully
    const result = searchSvc.search({ query: '"unclosed' });
    // Should not throw; returns either results from the escaped fallback or empty
    expect(Array.isArray(result.results)).toBe(true);
    expect(typeof result.query).toBe('string');
  });

  it('limit works', () => {
    const { financeSvc, searchSvc } = setup();
    seedData(financeSvc);

    // Search a broad term that should match multiple rows
    const result = searchSvc.search({
      query: 'purchase OR store OR station OR subscription',
      limit: 2,
    });
    expect(result.results.length).toBeLessThanOrEqual(2);
  });
});
