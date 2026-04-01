import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';
import {
  MutationReceiptRecordSchema,
  type AuthRole,
  type MutationReceiptKind,
  type MutationReceiptRecord,
  type MutationReceiptStatus,
  type RuntimePaths,
  type SecurityAuditEvent,
  type UsageMetrics,
} from '@popeye/contracts';
import { redactText } from '@popeye/observability';

const ZERO_USAGE: UsageMetrics = {
  provider: 'control-plane',
  model: 'mutation',
  tokensIn: 0,
  tokensOut: 0,
  estimatedCostUsd: 0,
};

export interface MutationReceiptManagerOptions {
  db: Database.Database;
  paths: RuntimePaths;
  redactionPatterns: string[];
  recordSecurityAudit?: (event: SecurityAuditEvent) => void;
}

export interface MutationReceiptWriteInput {
  kind: MutationReceiptKind;
  component: string;
  status: MutationReceiptStatus;
  summary: string;
  details: string;
  actorRole: AuthRole;
  workspaceId?: string | null;
  usage?: UsageMetrics;
  metadata?: Record<string, string>;
}

function parseReceiptRow(row: Record<string, unknown>): MutationReceiptRecord {
  return MutationReceiptRecordSchema.parse({
    id: row['id'],
    kind: row['kind'],
    component: row['component'],
    status: row['status'],
    summary: row['summary'],
    details: row['details'],
    actorRole: row['actor_role'],
    workspaceId: row['workspace_id'],
    usage: JSON.parse(String(row['usage_json'])),
    metadata: JSON.parse(String(row['metadata_json'])),
    createdAt: row['created_at'],
  });
}

export class MutationReceiptManager {
  private readonly db: Database.Database;
  private readonly artifactDir: string;
  private readonly redactionPatterns: string[];
  private readonly recordSecurityAudit?: MutationReceiptManagerOptions['recordSecurityAudit'];

  constructor(options: MutationReceiptManagerOptions) {
    this.db = options.db;
    this.redactionPatterns = options.redactionPatterns;
    this.recordSecurityAudit = options.recordSecurityAudit;
    this.artifactDir = join(options.paths.receiptsDir, 'mutations');
    mkdirSync(this.artifactDir, { recursive: true, mode: 0o700 });
  }

  writeReceipt(input: MutationReceiptWriteInput): MutationReceiptRecord {
    const summaryRedaction = redactText(input.summary, this.redactionPatterns);
    const detailsRedaction = redactText(input.details, this.redactionPatterns);
    for (const event of [...summaryRedaction.events, ...detailsRedaction.events]) {
      this.recordSecurityAudit?.(event);
    }

    const record: MutationReceiptRecord = {
      id: randomUUID(),
      kind: input.kind,
      component: input.component,
      status: input.status,
      summary: summaryRedaction.text,
      details: detailsRedaction.text,
      actorRole: input.actorRole,
      workspaceId: input.workspaceId ?? null,
      usage: input.usage ?? ZERO_USAGE,
      metadata: input.metadata ?? {},
      createdAt: new Date().toISOString(),
    };

    this.db.prepare(
      `INSERT INTO mutation_receipts (
        id,
        kind,
        component,
        status,
        summary,
        details,
        actor_role,
        workspace_id,
        usage_json,
        metadata_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id,
      record.kind,
      record.component,
      record.status,
      record.summary,
      record.details,
      record.actorRole,
      record.workspaceId,
      JSON.stringify(record.usage),
      JSON.stringify(record.metadata),
      record.createdAt,
    );

    writeFileSync(join(this.artifactDir, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });

    return record;
  }

  listReceipts(component?: string, limit = 50): MutationReceiptRecord[] {
    const statement = component
      ? this.db.prepare(
        `SELECT * FROM mutation_receipts
         WHERE component = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      : this.db.prepare(
        `SELECT * FROM mutation_receipts
         ORDER BY created_at DESC
         LIMIT ?`
      );
    const rows = (component ? statement.all(component, limit) : statement.all(limit)) as Array<Record<string, unknown>>;
    return rows.map(parseReceiptRow);
  }

  getReceipt(id: string): MutationReceiptRecord | null {
    const row = this.db.prepare('SELECT * FROM mutation_receipts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? parseReceiptRow(row) : null;
  }

  readArtifact(id: string): string | null {
    try {
      return readFileSync(join(this.artifactDir, `${id}.json`), 'utf8');
    } catch {
      return null;
    }
  }
}
