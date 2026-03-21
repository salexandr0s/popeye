import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';
import {
  type TelegramDeliveryState,
  type TelegramDeliveryRecord,
  type TelegramDeliveryResolutionRecord,
  type TelegramDeliveryResolutionRequest,
  type TelegramRelayCheckpoint,
  type TelegramRelayCheckpointCommitRequest,
  type TelegramSendAttemptRecord,
  type InterventionRecord,
  TelegramDeliveryRecordSchema,
  TelegramDeliveryResolutionRecordSchema,
  TelegramRelayCheckpointSchema,
  TelegramSendAttemptRecordSchema,
  nowIso,
} from '@popeye/contracts';
import { z } from 'zod';

import {
  mapTelegramDeliveryRow,
  TelegramDeliveryResolutionRowSchema,
  TelegramRelayCheckpointRowSchema,
  TelegramReplyDeliveryFullRowSchema,
  TelegramReplyDeliveryRowSchema,
  TelegramSendAttemptRowSchema,
} from './row-mappers.js';

export interface TelegramDeliveryCallbacks {
  getWorkspace: (id: string) => unknown | null;
  createIntervention: (code: InterventionRecord['code'], runId: string | null, reason: string) => void;
  resolveIntervention: (interventionId: string, resolutionNote?: string) => void;
  emit: (event: string, payload: unknown) => void;
}

interface TelegramDeliveryLog {
  info: (msg: string, details?: Record<string, unknown>) => void;
  warn: (msg: string, details?: Record<string, unknown>) => void;
  error: (msg: string, details?: Record<string, unknown>) => void;
}

export class TelegramDeliveryService {
  constructor(
    private readonly db: Database.Database,
    private readonly log: TelegramDeliveryLog,
    private readonly callbacks: TelegramDeliveryCallbacks,
  ) {}

  // --- Row mappers (private) ---

  private mapFullDeliveryRow(row: unknown): TelegramDeliveryRecord {
    const parsed = TelegramReplyDeliveryFullRowSchema.parse(row);
    return TelegramDeliveryRecordSchema.parse({
      id: parsed.id,
      workspaceId: parsed.workspace_id,
      chatId: parsed.chat_id,
      telegramMessageId: parsed.telegram_message_id,
      messageIngressId: parsed.message_ingress_id,
      taskId: parsed.task_id,
      jobId: parsed.job_id,
      runId: parsed.run_id,
      status: parsed.status,
      sentAt: parsed.sent_at,
      sentTelegramMessageId: parsed.sent_telegram_message_id ?? null,
      createdAt: parsed.created_at,
      updatedAt: parsed.updated_at,
    });
  }

  private mapResolutionRow(row: unknown): TelegramDeliveryResolutionRecord {
    const parsed = TelegramDeliveryResolutionRowSchema.parse(row);
    return TelegramDeliveryResolutionRecordSchema.parse({
      id: parsed.id,
      deliveryId: parsed.delivery_id,
      workspaceId: parsed.workspace_id,
      action: parsed.action,
      interventionId: parsed.intervention_id,
      operatorNote: parsed.operator_note,
      sentTelegramMessageId: parsed.sent_telegram_message_id ?? null,
      previousStatus: parsed.previous_status,
      newStatus: parsed.new_status,
      createdAt: parsed.created_at,
    });
  }

  private mapSendAttemptRow(row: unknown): TelegramSendAttemptRecord {
    const parsed = TelegramSendAttemptRowSchema.parse(row);
    return TelegramSendAttemptRecordSchema.parse({
      id: parsed.id,
      deliveryId: parsed.delivery_id,
      workspaceId: parsed.workspace_id,
      attemptNumber: parsed.attempt_number,
      startedAt: parsed.started_at,
      finishedAt: parsed.finished_at,
      runId: parsed.run_id,
      contentHash: parsed.content_hash,
      outcome: parsed.outcome,
      sentTelegramMessageId: parsed.sent_telegram_message_id ?? null,
      errorSummary: parsed.error_summary,
      source: parsed.source,
      createdAt: parsed.created_at,
    });
  }

  // --- Relay checkpoint ---

  getTelegramRelayCheckpoint(workspaceId: string, relayKey: 'telegram_long_poll' = 'telegram_long_poll'): TelegramRelayCheckpoint | null {
    const row = this.db
      .prepare('SELECT relay_key, workspace_id, last_acknowledged_update_id, updated_at FROM telegram_relay_checkpoints WHERE relay_key = ? AND workspace_id = ?')
      .get(relayKey, workspaceId);
    if (!row) return null;
    const parsed = TelegramRelayCheckpointRowSchema.parse(row);
    return TelegramRelayCheckpointSchema.parse({
      relayKey: parsed.relay_key,
      workspaceId: parsed.workspace_id,
      lastAcknowledgedUpdateId: parsed.last_acknowledged_update_id,
      updatedAt: parsed.updated_at,
    });
  }

  commitTelegramRelayCheckpoint(input: TelegramRelayCheckpointCommitRequest): TelegramRelayCheckpoint {
    if (!this.callbacks.getWorkspace(input.workspaceId)) {
      throw new TelegramDeliveryNotFoundError(`Workspace ${input.workspaceId} not found`);
    }
    const relayKey = input.relayKey ?? 'telegram_long_poll';
    const updatedAt = nowIso();
    this.db.prepare(`
      INSERT INTO telegram_relay_checkpoints (relay_key, workspace_id, last_acknowledged_update_id, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(relay_key, workspace_id) DO UPDATE SET
        last_acknowledged_update_id = MAX(telegram_relay_checkpoints.last_acknowledged_update_id, excluded.last_acknowledged_update_id),
        updated_at = excluded.updated_at
    `).run(relayKey, input.workspaceId, input.lastAcknowledgedUpdateId, updatedAt);
    const checkpoint = this.getTelegramRelayCheckpoint(input.workspaceId, relayKey);
    if (!checkpoint) {
      throw new Error(`Failed to persist Telegram relay checkpoint for workspace ${input.workspaceId}`);
    }
    return checkpoint;
  }

  // --- Delivery status transitions ---

  markTelegramReplySending(
    chatId: string,
    telegramMessageId: number,
    input: { workspaceId: string; runId?: string | null },
  ): TelegramDeliveryState | null {
    const updatedAt = nowIso();
    this.db.prepare(`
      UPDATE telegram_reply_deliveries
      SET status = CASE
            WHEN status = 'pending' THEN 'sending'
            ELSE status
          END,
          run_id = COALESCE(?, run_id),
          updated_at = ?
      WHERE workspace_id = ?
        AND chat_id = ?
        AND telegram_message_id = ?
    `).run(
      input.runId ?? null,
      updatedAt,
      input.workspaceId,
      chatId,
      telegramMessageId,
    );
    const row = this.db
      .prepare('SELECT chat_id, telegram_message_id, status, sent_telegram_message_id, sent_at, run_id FROM telegram_reply_deliveries WHERE workspace_id = ? AND chat_id = ? AND telegram_message_id = ?')
      .get(input.workspaceId, chatId, telegramMessageId);
    return row ? mapTelegramDeliveryRow(row) : null;
  }

  markTelegramReplyPending(
    chatId: string,
    telegramMessageId: number,
    input: { workspaceId: string; runId?: string | null },
  ): TelegramDeliveryState | null {
    const updatedAt = nowIso();
    this.db.prepare(`
      UPDATE telegram_reply_deliveries
      SET status = 'pending',
          run_id = COALESCE(?, run_id),
          updated_at = ?
      WHERE workspace_id = ?
        AND chat_id = ?
        AND telegram_message_id = ?
    `).run(
      input.runId ?? null,
      updatedAt,
      input.workspaceId,
      chatId,
      telegramMessageId,
    );
    const row = this.db
      .prepare('SELECT chat_id, telegram_message_id, status, sent_telegram_message_id, sent_at, run_id FROM telegram_reply_deliveries WHERE workspace_id = ? AND chat_id = ? AND telegram_message_id = ?')
      .get(input.workspaceId, chatId, telegramMessageId);
    return row ? mapTelegramDeliveryRow(row) : null;
  }

  markTelegramReplyUncertain(
    chatId: string,
    telegramMessageId: number,
    input: { workspaceId: string; runId?: string | null; reason?: string | null },
  ): TelegramDeliveryState | null {
    const updatedAt = nowIso();
    const row = this.db
      .prepare('SELECT chat_id, telegram_message_id, status, sent_telegram_message_id, sent_at, run_id FROM telegram_reply_deliveries WHERE workspace_id = ? AND chat_id = ? AND telegram_message_id = ?')
      .get(input.workspaceId, chatId, telegramMessageId);
    if (!row) return null;

    const previous = TelegramReplyDeliveryRowSchema.parse(row);
    this.db.prepare(`
      UPDATE telegram_reply_deliveries
      SET status = 'uncertain',
          run_id = COALESCE(?, run_id),
          updated_at = ?
      WHERE workspace_id = ?
        AND chat_id = ?
        AND telegram_message_id = ?
    `).run(
      input.runId ?? null,
      updatedAt,
      input.workspaceId,
      chatId,
      telegramMessageId,
    );
    if (previous.status !== 'uncertain') {
      this.callbacks.createIntervention(
        'needs_operator_input',
        input.runId ?? previous.run_id ?? null,
        input.reason ?? `Telegram delivery for chat ${chatId} message ${telegramMessageId} became uncertain and needs operator confirmation.`,
      );
    }

    const updatedRow = this.db
      .prepare('SELECT chat_id, telegram_message_id, status, sent_telegram_message_id, sent_at, run_id FROM telegram_reply_deliveries WHERE workspace_id = ? AND chat_id = ? AND telegram_message_id = ?')
      .get(input.workspaceId, chatId, telegramMessageId);
    return updatedRow ? mapTelegramDeliveryRow(updatedRow) : null;
  }

  markTelegramReplySent(
    chatId: string,
    telegramMessageId: number,
    input: { workspaceId: string; runId?: string | null; sentTelegramMessageId?: number | null },
  ): TelegramDeliveryState | null {
    const updatedAt = nowIso();
    this.db.prepare(`
      UPDATE telegram_reply_deliveries
      SET status = 'sent',
          sent_telegram_message_id = COALESCE(?, sent_telegram_message_id),
          sent_at = COALESCE(sent_at, ?),
          run_id = COALESCE(?, run_id),
          updated_at = ?
      WHERE workspace_id = ?
        AND chat_id = ?
        AND telegram_message_id = ?
    `).run(
      input.sentTelegramMessageId ?? null,
      updatedAt,
      input.runId ?? null,
      updatedAt,
      input.workspaceId,
      chatId,
      telegramMessageId,
    );
    const row = this.db
      .prepare('SELECT chat_id, telegram_message_id, status, sent_telegram_message_id, sent_at, run_id FROM telegram_reply_deliveries WHERE workspace_id = ? AND chat_id = ? AND telegram_message_id = ?')
      .get(input.workspaceId, chatId, telegramMessageId);
    return row ? mapTelegramDeliveryRow(row) : null;
  }

  // --- Delivery resolution ---

  listUncertainDeliveries(workspaceId?: string): TelegramDeliveryRecord[] {
    const sql = workspaceId
      ? "SELECT * FROM telegram_reply_deliveries WHERE status = 'uncertain' AND workspace_id = ?"
      : "SELECT * FROM telegram_reply_deliveries WHERE status = 'uncertain'";
    const rows = workspaceId
      ? this.db.prepare(sql).all(workspaceId)
      : this.db.prepare(sql).all();
    return rows.map((row) => this.mapFullDeliveryRow(row));
  }

  getDeliveryById(id: string): TelegramDeliveryRecord | null {
    const row = this.db.prepare('SELECT * FROM telegram_reply_deliveries WHERE id = ?').get(id);
    return row ? this.mapFullDeliveryRow(row) : null;
  }

  resolveTelegramDelivery(deliveryId: string, input: TelegramDeliveryResolutionRequest): TelegramDeliveryResolutionRecord {
    const delivery = this.getDeliveryById(deliveryId);
    if (!delivery) {
      throw new TelegramDeliveryNotFoundError(`Delivery ${deliveryId} not found`);
    }
    if (delivery.status !== 'uncertain') {
      throw new TelegramDeliveryConflictError(`Delivery ${deliveryId} status is '${delivery.status}', expected 'uncertain'`);
    }

    const actionToStatus: Record<string, string> = {
      confirm_sent: 'sent',
      resend: 'pending',
      abandon: 'abandoned',
    };
    const newStatus = actionToStatus[input.action]!;
    const now = nowIso();

    // Find linked open intervention
    const interventionRow = this.db
      .prepare("SELECT id FROM interventions WHERE run_id = ? AND code = 'needs_operator_input' AND status = 'open' ORDER BY created_at DESC LIMIT 1")
      .get(delivery.runId);
    const interventionId = interventionRow ? z.object({ id: z.string() }).parse(interventionRow).id : null;

    // Update delivery status
    const updateSql = newStatus === 'sent'
      ? `UPDATE telegram_reply_deliveries SET status = ?, sent_telegram_message_id = COALESCE(?, sent_telegram_message_id), sent_at = COALESCE(sent_at, ?), updated_at = ? WHERE id = ?`
      : 'UPDATE telegram_reply_deliveries SET status = ?, updated_at = ? WHERE id = ?';
    if (newStatus === 'sent') {
      this.db.prepare(updateSql).run(newStatus, input.sentTelegramMessageId ?? null, now, now, deliveryId);
    } else {
      this.db.prepare(updateSql).run(newStatus, now, deliveryId);
    }

    // Insert resolution record
    const resolutionId = randomUUID();
    this.db.prepare(`
      INSERT INTO telegram_delivery_resolutions (id, delivery_id, workspace_id, action, intervention_id, operator_note, sent_telegram_message_id, previous_status, new_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      resolutionId,
      deliveryId,
      input.workspaceId,
      input.action,
      interventionId,
      input.operatorNote ?? null,
      input.sentTelegramMessageId ?? null,
      delivery.status,
      newStatus,
      now,
    );

    // Resolve linked intervention
    if (interventionId) {
      this.callbacks.resolveIntervention(interventionId, input.operatorNote);
    }

    this.callbacks.emit('telegram_delivery_resolved', { deliveryId, action: input.action, newStatus });

    const resolutionRow = this.db
      .prepare('SELECT * FROM telegram_delivery_resolutions WHERE id = ?')
      .get(resolutionId);
    return this.mapResolutionRow(resolutionRow);
  }

  listDeliveryResolutions(deliveryId: string): TelegramDeliveryResolutionRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM telegram_delivery_resolutions WHERE delivery_id = ? ORDER BY created_at ASC')
      .all(deliveryId);
    return rows.map((row) => this.mapResolutionRow(row));
  }

  getResendableDeliveries(workspaceId: string): TelegramDeliveryRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM telegram_reply_deliveries WHERE status = 'pending' AND updated_at > created_at AND workspace_id = ?")
      .all(workspaceId);
    return rows.map((row) => this.mapFullDeliveryRow(row));
  }

  // --- Send-attempt audit ---

  recordTelegramSendAttempt(input: {
    deliveryId?: string;
    chatId?: string;
    telegramMessageId?: number;
    workspaceId: string;
    startedAt: string;
    finishedAt?: string;
    runId?: string;
    contentHash: string;
    outcome: string;
    sentTelegramMessageId?: number;
    errorSummary?: string;
    source?: string;
  }): TelegramSendAttemptRecord {
    let deliveryId = input.deliveryId;
    if (!deliveryId && input.chatId !== undefined && input.telegramMessageId !== undefined) {
      const row = this.db
        .prepare('SELECT id FROM telegram_reply_deliveries WHERE workspace_id = ? AND chat_id = ? AND telegram_message_id = ?')
        .get(input.workspaceId, input.chatId, input.telegramMessageId);
      if (row) {
        deliveryId = z.object({ id: z.string() }).parse(row).id;
      }
    }
    if (!deliveryId) {
      throw new TelegramDeliveryNotFoundError('Cannot resolve delivery for send-attempt recording');
    }
    const id = randomUUID();
    const now = nowIso();
    const countRow = this.db
      .prepare('SELECT COALESCE(MAX(attempt_number), 0) as max_attempt FROM telegram_send_attempts WHERE delivery_id = ?')
      .get(deliveryId);
    const attemptNumber = z.object({ max_attempt: z.coerce.number().int() }).parse(countRow).max_attempt + 1;
    const errorSummary = input.errorSummary ? input.errorSummary.slice(0, 500) : null;

    this.db.prepare(`
      INSERT INTO telegram_send_attempts (id, delivery_id, workspace_id, attempt_number, started_at, finished_at, run_id, content_hash, outcome, sent_telegram_message_id, error_summary, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      deliveryId,
      input.workspaceId,
      attemptNumber,
      input.startedAt,
      input.finishedAt ?? null,
      input.runId ?? null,
      input.contentHash,
      input.outcome,
      input.sentTelegramMessageId ?? null,
      errorSummary,
      input.source ?? 'relay',
      now,
    );

    const row = this.db.prepare('SELECT * FROM telegram_send_attempts WHERE id = ?').get(id);
    return this.mapSendAttemptRow(row);
  }

  listTelegramSendAttempts(deliveryId: string): TelegramSendAttemptRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM telegram_send_attempts WHERE delivery_id = ? ORDER BY created_at ASC')
      .all(deliveryId);
    return rows.map((row) => this.mapSendAttemptRow(row));
  }
}

// --- Error classes ---
// These mirror RuntimeNotFoundError / RuntimeConflictError but are scoped to this module.
// The runtime-service delegates catch and re-throw through the existing error types.

export class TelegramDeliveryNotFoundError extends Error {
  readonly errorCode = 'not_found';

  constructor(message: string) {
    super(message);
    this.name = 'TelegramDeliveryNotFoundError';
  }
}

export class TelegramDeliveryConflictError extends Error {
  readonly errorCode = 'conflict';

  constructor(message: string) {
    super(message);
    this.name = 'TelegramDeliveryConflictError';
  }
}
