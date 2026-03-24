import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DbConnection } from '@popeye/contracts';

import {
  queryModelBreakdown,
  queryProjectCosts,
  queryStatusBreakdown,
  queryTimeBucketedUsage,
} from './analytics-queries.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createReceiptsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE receipts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      details TEXT NOT NULL,
      usage_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
}

interface ReceiptSeed {
  id: string;
  runId?: string;
  jobId?: string;
  taskId?: string;
  workspaceId?: string;
  status?: string;
  summary?: string;
  details?: string;
  usageJson?: {
    provider?: string;
    model?: string;
    tokensIn?: number;
    tokensOut?: number;
    estimatedCostUsd?: number;
  };
  createdAt?: string;
}

function insertReceipt(db: Database.Database, seed: ReceiptSeed): void {
  const usage = seed.usageJson ?? {
    provider: 'anthropic',
    model: 'claude-3-opus',
    tokensIn: 100,
    tokensOut: 200,
    estimatedCostUsd: 0.05,
  };
  db.prepare(
    `INSERT INTO receipts (id, run_id, job_id, task_id, workspace_id, status, summary, details, usage_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    seed.id,
    seed.runId ?? `run-${seed.id}`,
    seed.jobId ?? `job-${seed.id}`,
    seed.taskId ?? `task-${seed.id}`,
    seed.workspaceId ?? 'ws-1',
    seed.status ?? 'succeeded',
    seed.summary ?? 'test summary',
    seed.details ?? '{}',
    JSON.stringify(usage),
    seed.createdAt ?? '2026-03-24T12:00:00Z',
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('analytics-queries', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    createReceiptsTable(db);
  });

  afterEach(() => {
    db.close();
  });

  // -------------------------------------------------------------------------
  // queryTimeBucketedUsage
  // -------------------------------------------------------------------------

  describe('queryTimeBucketedUsage', () => {
    it('buckets receipts by day', () => {
      insertReceipt(db, {
        id: 'r1',
        createdAt: '2026-03-22T08:00:00Z',
        usageJson: { provider: 'a', model: 'm', tokensIn: 100, tokensOut: 50, estimatedCostUsd: 0.01 },
      });
      insertReceipt(db, {
        id: 'r2',
        createdAt: '2026-03-22T16:00:00Z',
        usageJson: { provider: 'a', model: 'm', tokensIn: 200, tokensOut: 100, estimatedCostUsd: 0.02 },
      });
      insertReceipt(db, {
        id: 'r3',
        createdAt: '2026-03-23T10:00:00Z',
        usageJson: { provider: 'a', model: 'm', tokensIn: 300, tokensOut: 150, estimatedCostUsd: 0.03 },
      });

      const result = queryTimeBucketedUsage(db as unknown as DbConnection, {
        granularity: 'daily',
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        bucket: '2026-03-22',
        runs: 2,
        tokensIn: 300,
        tokensOut: 150,
        estimatedCostUsd: 0.03,
      });
      expect(result[1]).toEqual({
        bucket: '2026-03-23',
        runs: 1,
        tokensIn: 300,
        tokensOut: 150,
        estimatedCostUsd: 0.03,
      });
    });

    it('filters by workspaceId', () => {
      insertReceipt(db, {
        id: 'r1',
        workspaceId: 'ws-a',
        createdAt: '2026-03-22T08:00:00Z',
        usageJson: { provider: 'a', model: 'm', tokensIn: 100, tokensOut: 50, estimatedCostUsd: 0.01 },
      });
      insertReceipt(db, {
        id: 'r2',
        workspaceId: 'ws-b',
        createdAt: '2026-03-22T09:00:00Z',
        usageJson: { provider: 'a', model: 'm', tokensIn: 200, tokensOut: 100, estimatedCostUsd: 0.02 },
      });

      const result = queryTimeBucketedUsage(db as unknown as DbConnection, {
        granularity: 'daily',
        workspaceId: 'ws-a',
      });

      expect(result).toHaveLength(1);
      expect(result[0]!.runs).toBe(1);
      expect(result[0]!.tokensIn).toBe(100);
    });

    it('filters by from/to time range', () => {
      insertReceipt(db, {
        id: 'r1',
        createdAt: '2026-03-20T08:00:00Z',
        usageJson: { provider: 'a', model: 'm', tokensIn: 100, tokensOut: 50, estimatedCostUsd: 0.01 },
      });
      insertReceipt(db, {
        id: 'r2',
        createdAt: '2026-03-22T08:00:00Z',
        usageJson: { provider: 'a', model: 'm', tokensIn: 200, tokensOut: 100, estimatedCostUsd: 0.02 },
      });
      insertReceipt(db, {
        id: 'r3',
        createdAt: '2026-03-25T08:00:00Z',
        usageJson: { provider: 'a', model: 'm', tokensIn: 300, tokensOut: 150, estimatedCostUsd: 0.03 },
      });

      const result = queryTimeBucketedUsage(db as unknown as DbConnection, {
        granularity: 'daily',
        from: '2026-03-21T00:00:00Z',
        to: '2026-03-23T00:00:00Z',
      });

      expect(result).toHaveLength(1);
      expect(result[0]!.bucket).toBe('2026-03-22');
    });
  });

  // -------------------------------------------------------------------------
  // queryModelBreakdown
  // -------------------------------------------------------------------------

  describe('queryModelBreakdown', () => {
    it('groups receipts by provider and model', () => {
      insertReceipt(db, {
        id: 'r1',
        usageJson: { provider: 'anthropic', model: 'claude-3-opus', tokensIn: 100, tokensOut: 50, estimatedCostUsd: 0.10 },
      });
      insertReceipt(db, {
        id: 'r2',
        usageJson: { provider: 'anthropic', model: 'claude-3-opus', tokensIn: 200, tokensOut: 100, estimatedCostUsd: 0.20 },
      });
      insertReceipt(db, {
        id: 'r3',
        usageJson: { provider: 'openai', model: 'gpt-4o', tokensIn: 300, tokensOut: 150, estimatedCostUsd: 0.05 },
      });

      const result = queryModelBreakdown(db as unknown as DbConnection, {});

      expect(result).toHaveLength(2);
      // Ordered by cost DESC, so anthropic/opus first
      expect(result[0]!.provider).toBe('anthropic');
      expect(result[0]!.model).toBe('claude-3-opus');
      expect(result[0]!.runs).toBe(2);
      expect(result[0]!.tokensIn).toBe(300);
      expect(result[0]!.tokensOut).toBe(150);
      expect(result[0]!.estimatedCostUsd).toBeCloseTo(0.30, 5);
      expect(result[1]!.provider).toBe('openai');
      expect(result[1]!.model).toBe('gpt-4o');
      expect(result[1]!.runs).toBe(1);
      expect(result[1]!.tokensIn).toBe(300);
      expect(result[1]!.tokensOut).toBe(150);
      expect(result[1]!.estimatedCostUsd).toBeCloseTo(0.05, 5);
    });
  });

  // -------------------------------------------------------------------------
  // queryStatusBreakdown
  // -------------------------------------------------------------------------

  describe('queryStatusBreakdown', () => {
    it('counts receipts by status', () => {
      insertReceipt(db, { id: 'r1', status: 'succeeded' });
      insertReceipt(db, { id: 'r2', status: 'succeeded' });
      insertReceipt(db, { id: 'r3', status: 'failed' });
      insertReceipt(db, { id: 'r4', status: 'cancelled' });

      const result = queryStatusBreakdown(db as unknown as DbConnection, {});

      expect(result).toHaveLength(3);
      // Ordered by count DESC
      expect(result[0]).toEqual({ status: 'succeeded', count: 2 });
      expect(result[1]!.count).toBe(1);
      expect(result[2]!.count).toBe(1);
      // Both failed and cancelled have count 1, order between them is stable but unspecified
      const statuses = result.map((r) => r.status);
      expect(statuses).toContain('failed');
      expect(statuses).toContain('cancelled');
    });
  });

  // -------------------------------------------------------------------------
  // queryProjectCosts
  // -------------------------------------------------------------------------

  describe('queryProjectCosts', () => {
    it('groups receipts by workspace_id', () => {
      insertReceipt(db, {
        id: 'r1',
        workspaceId: 'ws-alpha',
        usageJson: { provider: 'a', model: 'm', tokensIn: 100, tokensOut: 50, estimatedCostUsd: 0.50 },
      });
      insertReceipt(db, {
        id: 'r2',
        workspaceId: 'ws-alpha',
        usageJson: { provider: 'a', model: 'm', tokensIn: 200, tokensOut: 100, estimatedCostUsd: 0.25 },
      });
      insertReceipt(db, {
        id: 'r3',
        workspaceId: 'ws-beta',
        usageJson: { provider: 'a', model: 'm', tokensIn: 50, tokensOut: 25, estimatedCostUsd: 0.10 },
      });

      const result = queryProjectCosts(db as unknown as DbConnection, {});

      expect(result).toHaveLength(2);
      // Ordered by cost DESC
      expect(result[0]).toEqual({
        workspaceId: 'ws-alpha',
        runs: 2,
        tokensIn: 300,
        tokensOut: 150,
        estimatedCostUsd: 0.75,
      });
      expect(result[1]).toEqual({
        workspaceId: 'ws-beta',
        runs: 1,
        tokensIn: 50,
        tokensOut: 25,
        estimatedCostUsd: 0.10,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Edge case: empty table
  // -------------------------------------------------------------------------

  describe('empty table', () => {
    it('queryTimeBucketedUsage returns empty array', () => {
      const result = queryTimeBucketedUsage(db as unknown as DbConnection, { granularity: 'daily' });
      expect(result).toEqual([]);
    });

    it('queryModelBreakdown returns empty array', () => {
      const result = queryModelBreakdown(db as unknown as DbConnection, {});
      expect(result).toEqual([]);
    });

    it('queryStatusBreakdown returns empty array', () => {
      const result = queryStatusBreakdown(db as unknown as DbConnection, {});
      expect(result).toEqual([]);
    });

    it('queryProjectCosts returns empty array', () => {
      const result = queryProjectCosts(db as unknown as DbConnection, {});
      expect(result).toEqual([]);
    });
  });
});
