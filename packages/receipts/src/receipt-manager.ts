import { randomUUID } from 'node:crypto';

import type {
  AppConfig,
  ReceiptRecord,
  UsageSummary,
} from '@popeye/contracts';
import {
  ReceiptRecordSchema,
  nowIso,
} from '@popeye/contracts';
import { redactText } from '@popeye/observability';

import { readReceiptArtifact, writeReceiptArtifact } from './receipt-artifacts.js';
import { mapReceiptRow, ReceiptIdRowSchema, UsageSummaryRowSchema } from './row-mappers.js';
import { renderReceipt } from './render-receipt.js';
import type { ReceiptCallbacks, ReceiptDeps } from './types.js';

export class ReceiptManager {
  constructor(
    private readonly databases: ReceiptDeps,
    private readonly config: AppConfig,
    private readonly callbacks: ReceiptCallbacks,
  ) {}

  writeReceipt(input: Omit<ReceiptRecord, 'id' | 'createdAt'>): ReceiptRecord {
    const { text: redactedSummary } = redactText(input.summary, this.config.security.redactionPatterns);
    const { text: redactedDetails } = redactText(input.details, this.config.security.redactionPatterns);
    const receipt = ReceiptRecordSchema.parse({ ...input, summary: redactedSummary, details: redactedDetails, id: randomUUID(), createdAt: nowIso() });
    this.databases.app.prepare('INSERT INTO receipts (id, run_id, job_id, task_id, workspace_id, status, summary, details, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      receipt.id,
      receipt.runId,
      receipt.jobId,
      receipt.taskId,
      receipt.workspaceId,
      receipt.status,
      receipt.summary,
      receipt.details,
      JSON.stringify(receipt.usage),
      receipt.createdAt,
    );
    writeReceiptArtifact(this.databases.paths, receipt.id, JSON.stringify({ receipt, rendered: renderReceipt(receipt) }, null, 2));
    return receipt;
  }

  captureMemoryFromReceipt(receipt: ReceiptRecord): void {
    this.callbacks.captureMemory({
      description: receipt.summary,
      classification: receipt.status === 'succeeded' ? 'internal' : 'sensitive',
      sourceType: 'receipt',
      content: receipt.details,
      confidence: 1,
      scope: receipt.workspaceId,
      memoryType: 'episodic',
      sourceRef: receipt.id,
      sourceRefType: 'receipt',
      sourceRunId: receipt.runId,
      sourceTimestamp: receipt.createdAt,
      occurredAt: receipt.createdAt,
      tags: ['receipt', `receipt-status:${receipt.status}`],
      sourceMetadata: {
        receiptId: receipt.id,
        status: receipt.status,
        taskId: receipt.taskId,
        jobId: receipt.jobId,
        usage: receipt.usage,
      },
    });
  }

  listReceipts(): ReceiptRecord[] {
    return this.databases.app.prepare('SELECT * FROM receipts ORDER BY created_at DESC').all().map((row) => mapReceiptRow(row));
  }

  getReceipt(receiptId: string): ReceiptRecord | null {
    const row = this.databases.app.prepare('SELECT * FROM receipts WHERE id = ?').get(receiptId);
    if (!row) return null;
    const receipt = mapReceiptRow(row);
    return ReceiptRecordSchema.parse({
      ...receipt,
      details: readReceiptArtifact(this.databases.paths, receiptId) ?? receipt.details,
    });
  }

  writeAbandonedReceiptIfMissing(runId: string, jobId: string, taskId: string, workspaceId: string, summary: string, details: string): void {
    const rawExistingReceipt = this.databases.app.prepare('SELECT id FROM receipts WHERE run_id = ? AND status = ?').get(runId, 'abandoned');
    const existingReceipt = rawExistingReceipt ? ReceiptIdRowSchema.parse(rawExistingReceipt) : null;
    if (existingReceipt) return;
    const receipt = this.writeReceipt({
      runId,
      jobId,
      taskId,
      workspaceId,
      status: 'abandoned',
      summary,
      details,
      usage: { provider: this.config.engine.kind, model: 'unknown', tokensIn: 0, tokensOut: 0, estimatedCostUsd: 0 },
    });
    this.captureMemoryFromReceipt(receipt);
  }

  getReceiptByRunId(runId: string): ReceiptRecord | null {
    const row = this.databases.app.prepare('SELECT * FROM receipts WHERE run_id = ? ORDER BY created_at DESC LIMIT 1').get(runId);
    return row ? mapReceiptRow(row) : null;
  }

  getReceiptByTaskId(taskId: string): ReceiptRecord | null {
    const row = this.databases.app.prepare('SELECT * FROM receipts WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(taskId);
    return row ? mapReceiptRow(row) : null;
  }

  getUsageSummary(): UsageSummary {
    const row = UsageSummaryRowSchema.parse(this.databases.app.prepare(`
      SELECT
        COUNT(*) as totalRuns,
        COALESCE(SUM(json_extract(usage_json, '$.tokensIn')), 0) as tokensIn,
        COALESCE(SUM(json_extract(usage_json, '$.tokensOut')), 0) as tokensOut,
        COALESCE(SUM(json_extract(usage_json, '$.estimatedCostUsd')), 0) as estimatedCostUsd
      FROM receipts
    `).get());
    return {
      runs: row.totalRuns,
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
      estimatedCostUsd: row.estimatedCostUsd,
    };
  }
}
