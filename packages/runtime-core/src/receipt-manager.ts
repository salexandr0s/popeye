import { randomUUID } from 'node:crypto';

import type {
  AppConfig,
  ReceiptRecord,
  UsageSummary,
} from '@popeye/contracts';
import {
  ReceiptRecordSchema,
} from '@popeye/contracts';
import { readReceiptArtifact, renderReceipt, writeReceiptArtifact } from '@popeye/receipts';

import type { RuntimeDatabases } from './database.js';
import type { MemoryLifecycleService } from './memory-lifecycle.js';

function nowIso(): string {
  return new Date().toISOString();
}

function readJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

export class ReceiptManager {
  constructor(
    private readonly databases: RuntimeDatabases,
    private readonly config: AppConfig,
    private readonly memoryLifecycle: MemoryLifecycleService,
  ) {}

  writeReceipt(input: Omit<ReceiptRecord, 'id' | 'createdAt'>): ReceiptRecord {
    const receipt = ReceiptRecordSchema.parse({ ...input, id: randomUUID(), createdAt: nowIso() });
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
    this.memoryLifecycle.insertMemory({
      description: receipt.summary,
      classification: receipt.status === 'succeeded' ? 'internal' : 'sensitive',
      sourceType: 'receipt',
      content: receipt.details,
      confidence: 1,
      scope: receipt.workspaceId,
      memoryType: 'episodic',
      sourceRef: receipt.id,
      sourceRefType: 'receipt',
    });
  }

  listReceipts(): ReceiptRecord[] {
    const rows = this.databases.app.prepare('SELECT * FROM receipts ORDER BY created_at DESC').all() as Array<Record<string, string>>;
    return rows.map((row) =>
      ReceiptRecordSchema.parse({
        id: row.id,
        runId: row.run_id,
        jobId: row.job_id,
        taskId: row.task_id,
        workspaceId: row.workspace_id,
        status: row.status,
        summary: row.summary,
        details: row.details,
        usage: readJson(row.usage_json),
        createdAt: row.created_at,
      }),
    );
  }

  getReceipt(receiptId: string): ReceiptRecord | null {
    const row = this.databases.app.prepare('SELECT * FROM receipts WHERE id = ?').get(receiptId) as Record<string, string> | undefined;
    if (!row) return null;
    return ReceiptRecordSchema.parse({
      id: row.id,
      runId: row.run_id,
      jobId: row.job_id,
      taskId: row.task_id,
      workspaceId: row.workspace_id,
      status: row.status,
      summary: row.summary,
      details: readReceiptArtifact(this.databases.paths, receiptId) ?? row.details,
      usage: readJson(row.usage_json),
      createdAt: row.created_at,
    });
  }

  writeAbandonedReceiptIfMissing(runId: string, jobId: string, taskId: string, workspaceId: string, summary: string, details: string): void {
    const existingReceipt = this.databases.app.prepare('SELECT id FROM receipts WHERE run_id = ? AND status = ?').get(runId, 'abandoned') as { id: string } | undefined;
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

  getUsageSummary(): UsageSummary {
    const receipts = this.listReceipts();
    return {
      runs: receipts.length,
      tokensIn: receipts.reduce((sum, receipt) => sum + receipt.usage.tokensIn, 0),
      tokensOut: receipts.reduce((sum, receipt) => sum + receipt.usage.tokensOut, 0),
      estimatedCostUsd: receipts.reduce((sum, receipt) => sum + receipt.usage.estimatedCostUsd, 0),
    };
  }
}
