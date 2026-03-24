import type {
  AnalyticsGranularity,
  AnalyticsModelBreakdown,
  AnalyticsProjectCost,
  AnalyticsStatusBreakdown,
  AnalyticsTimeBucket,
  DbConnection,
} from '@popeye/contracts';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Row schemas (coerce because SQLite returns integer-typed columns as number
// but SUM/COUNT may return bigint or real depending on context)
// ---------------------------------------------------------------------------

const TimeBucketRowSchema = z.object({
  bucket: z.string(),
  runs: z.coerce.number().int().nonnegative(),
  tokensIn: z.coerce.number().int().nonnegative(),
  tokensOut: z.coerce.number().int().nonnegative(),
  estimatedCostUsd: z.coerce.number().nonnegative(),
});

const ModelBreakdownRowSchema = z.object({
  provider: z.coerce.string(),
  model: z.coerce.string(),
  runs: z.coerce.number().int().nonnegative(),
  tokensIn: z.coerce.number().int().nonnegative(),
  tokensOut: z.coerce.number().int().nonnegative(),
  estimatedCostUsd: z.coerce.number().nonnegative(),
});

const StatusBreakdownRowSchema = z.object({
  status: z.string(),
  count: z.coerce.number().int().nonnegative(),
});

const ProjectCostRowSchema = z.object({
  workspaceId: z.string(),
  runs: z.coerce.number().int().nonnegative(),
  tokensIn: z.coerce.number().int().nonnegative(),
  tokensOut: z.coerce.number().int().nonnegative(),
  estimatedCostUsd: z.coerce.number().nonnegative(),
});

// ---------------------------------------------------------------------------
// Granularity → strftime format mapping
// ---------------------------------------------------------------------------

const GRANULARITY_FORMAT: Record<AnalyticsGranularity, string> = {
  hourly: '%Y-%m-%dT%H:00:00Z',
  daily: '%Y-%m-%d',
  weekly: '%Y-W%W',
  monthly: '%Y-%m',
};

// ---------------------------------------------------------------------------
// Shared WHERE clause builder
// ---------------------------------------------------------------------------

interface TimeRangeFilter {
  from?: string | undefined;
  to?: string | undefined;
  workspaceId?: string | undefined;
}

function buildWhereClause(filter: TimeRangeFilter): { clause: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.from) {
    conditions.push('created_at >= ?');
    params.push(filter.from);
  }
  if (filter.to) {
    conditions.push('created_at <= ?');
    params.push(filter.to);
  }
  if (filter.workspaceId) {
    conditions.push('workspace_id = ?');
    params.push(filter.workspaceId);
  }

  const clause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  return { clause, params };
}

// ---------------------------------------------------------------------------
// Query functions
// ---------------------------------------------------------------------------

export interface TimeBucketedUsageOptions {
  from?: string | undefined;
  to?: string | undefined;
  granularity: AnalyticsGranularity;
  workspaceId?: string | undefined;
}

export function queryTimeBucketedUsage(
  db: DbConnection,
  options: TimeBucketedUsageOptions,
): AnalyticsTimeBucket[] {
  const format = GRANULARITY_FORMAT[options.granularity];
  const { clause, params } = buildWhereClause(options);

  const sql = `
    SELECT
      strftime('${format}', created_at) AS bucket,
      COUNT(*) AS runs,
      COALESCE(SUM(json_extract(usage_json, '$.tokensIn')), 0) AS tokensIn,
      COALESCE(SUM(json_extract(usage_json, '$.tokensOut')), 0) AS tokensOut,
      COALESCE(SUM(json_extract(usage_json, '$.estimatedCostUsd')), 0) AS estimatedCostUsd
    FROM receipts${clause}
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  const rows = db.prepare(sql).all(...params);
  return rows.map((row) => TimeBucketRowSchema.parse(row));
}

export interface ModelBreakdownOptions {
  from?: string | undefined;
  to?: string | undefined;
  workspaceId?: string | undefined;
}

export function queryModelBreakdown(
  db: DbConnection,
  options: ModelBreakdownOptions,
): AnalyticsModelBreakdown[] {
  const { clause, params } = buildWhereClause(options);

  const sql = `
    SELECT
      json_extract(usage_json, '$.provider') AS provider,
      json_extract(usage_json, '$.model') AS model,
      COUNT(*) AS runs,
      COALESCE(SUM(json_extract(usage_json, '$.tokensIn')), 0) AS tokensIn,
      COALESCE(SUM(json_extract(usage_json, '$.tokensOut')), 0) AS tokensOut,
      COALESCE(SUM(json_extract(usage_json, '$.estimatedCostUsd')), 0) AS estimatedCostUsd
    FROM receipts${clause}
    GROUP BY provider, model
    ORDER BY estimatedCostUsd DESC
  `;

  const rows = db.prepare(sql).all(...params);
  return rows.map((row) => ModelBreakdownRowSchema.parse(row));
}

export interface StatusBreakdownOptions {
  from?: string | undefined;
  to?: string | undefined;
  workspaceId?: string | undefined;
}

export function queryStatusBreakdown(
  db: DbConnection,
  options: StatusBreakdownOptions,
): AnalyticsStatusBreakdown[] {
  const { clause, params } = buildWhereClause(options);

  const sql = `
    SELECT
      status,
      COUNT(*) AS count
    FROM receipts${clause}
    GROUP BY status
    ORDER BY count DESC
  `;

  const rows = db.prepare(sql).all(...params);
  return rows.map((row) => StatusBreakdownRowSchema.parse(row));
}

export interface ProjectCostsOptions {
  from?: string | undefined;
  to?: string | undefined;
}

export function queryProjectCosts(
  db: DbConnection,
  options: ProjectCostsOptions,
): AnalyticsProjectCost[] {
  const { clause, params } = buildWhereClause(options);

  const sql = `
    SELECT
      workspace_id AS workspaceId,
      COUNT(*) AS runs,
      COALESCE(SUM(json_extract(usage_json, '$.tokensIn')), 0) AS tokensIn,
      COALESCE(SUM(json_extract(usage_json, '$.tokensOut')), 0) AS tokensOut,
      COALESCE(SUM(json_extract(usage_json, '$.estimatedCostUsd')), 0) AS estimatedCostUsd
    FROM receipts${clause}
    GROUP BY workspace_id
    ORDER BY estimatedCostUsd DESC
  `;

  const rows = db.prepare(sql).all(...params);
  return rows.map((row) => ProjectCostRowSchema.parse(row));
}
