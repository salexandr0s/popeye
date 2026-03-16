import { randomUUID } from 'node:crypto';

import type {
  AppConfig,
  IngestMessageInput,
  InterventionRecord,
  MessageIngressDecisionCode,
  MessageIngressRecord,
  MessageIngressResponse,
  MessageRecord,
  SecurityAuditEvent,
  TaskCreateInput,
  TaskRecord,
  JobRecord,
  RunRecord,
  TelegramDeliveryState,
} from '@popeye/contracts';
import {
  IngestMessageInputSchema,
  MessageIngressRecordSchema,
  MessageIngressResponseSchema,
  MessageRecordSchema,
  TelegramDeliveryStateSchema,
} from '@popeye/contracts';
import { redactText } from '@popeye/observability';
import { z } from 'zod';

import type { RuntimeDatabases } from './database.js';
import { scanPrompt, type PromptScanOptions } from './prompt.js';
import { nowIso } from '@popeye/contracts';

function buildMessageIngressKey(input: Pick<IngestMessageInput, 'source' | 'chatId' | 'telegramMessageId' | 'workspaceId'>): string | null {
  if (input.source !== 'telegram' || !input.chatId || typeof input.telegramMessageId !== 'number') {
    return null;
  }
  return `${input.source}:${input.workspaceId}:${input.chatId}:${input.telegramMessageId}`;
}

function readStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

function readNumberField(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === 'number' ? value : undefined;
}

function readTelegramChatTypeField(input: Record<string, unknown>, key: string): IngestMessageInput['chatType'] | undefined {
  const value = input[key];
  if (value === 'private' || value === 'group' || value === 'supergroup' || value === 'channel') {
    return value;
  }
  return undefined;
}

const MessageIngressDbRowSchema = z.object({
  id: z.string(),
  source: z.enum(['telegram', 'manual', 'api']),
  sender_id: z.string(),
  chat_id: z.string().nullable(),
  chat_type: z.enum(['private', 'group', 'supergroup', 'channel']).nullable(),
  telegram_message_id: z.number().int().nullable(),
  idempotency_key: z.string().nullable(),
  workspace_id: z.string(),
  body: z.string(),
  accepted: z.union([z.number().int(), z.boolean()]),
  decision_code: z.enum([
    'accepted',
    'duplicate_replayed',
    'telegram_disabled',
    'telegram_private_chat_required',
    'telegram_not_allowlisted',
    'telegram_rate_limited',
    'telegram_prompt_injection',
    'telegram_invalid_message',
    'prompt_injection_quarantined',
  ]),
  decision_reason: z.string(),
  http_status: z.number().int(),
  message_id: z.string().nullable(),
  task_id: z.string().nullable(),
  job_id: z.string().nullable(),
  run_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const MessageDbRowSchema = z.object({
  id: z.string(),
  source: z.enum(['telegram', 'manual', 'api']),
  sender_id: z.string(),
  body: z.string(),
  accepted: z.union([z.number().int(), z.boolean()]),
  related_run_id: z.string().nullable(),
  created_at: z.string(),
});

const CountRowSchema = z.object({
  count: z.number().int().nonnegative(),
});

const TelegramReplyDeliveryDbRowSchema = z.object({
  chat_id: z.string(),
  telegram_message_id: z.number().int(),
  status: z.enum(['pending', 'sending', 'sent', 'uncertain']),
  sent_telegram_message_id: z.number().int().nullable().optional(),
  sent_at: z.string().nullable().optional(),
});

const InputRecordSchema = z.record(z.string(), z.unknown());

function asInputRecord(input: unknown): Record<string, unknown> {
  const parsed = InputRecordSchema.safeParse(input);
  return parsed.success ? parsed.data : {};
}

function parseAccepted(value: number | boolean): boolean {
  return typeof value === 'boolean' ? value : value !== 0;
}

export class MessageIngressError extends Error {
  readonly statusCode: number;
  readonly decisionCode: MessageIngressDecisionCode;
  readonly response: MessageIngressResponse;

  constructor(response: MessageIngressResponse) {
    super(response.decisionReason);
    this.name = 'MessageIngressError';
    this.statusCode = response.httpStatus;
    this.decisionCode = response.decisionCode;
    this.response = response;
  }
}

export interface MessageIngestionCallbacks {
  recordSecurityAudit(event: SecurityAuditEvent): void;
  createTask(input: { workspaceId: string; projectId: string | null; title: string; prompt: string; source: TaskCreateInput['source']; coalesceKey: string | null; autoEnqueue: boolean }): { task: TaskRecord; job: JobRecord | null; run: RunRecord | null };
  createIntervention(code: InterventionRecord['code'], runId: string | null, reason: string): void;
}

export class MessageIngestionService {
  constructor(
    private readonly databases: RuntimeDatabases,
    private readonly config: AppConfig,
    private readonly callbacks: MessageIngestionCallbacks,
  ) {}

  private promptScanOptions(): PromptScanOptions | undefined {
    const customQuarantinePatterns = this.config.security.promptScanQuarantinePatterns ?? [];
    const customSanitizePatterns = this.config.security.promptScanSanitizePatterns ?? [];
    if (
      customQuarantinePatterns.length === 0 &&
      customSanitizePatterns.length === 0
    ) {
      return undefined;
    }
    return {
      customQuarantinePatterns,
      customSanitizePatterns,
    };
  }

  getMessageIngressByKey(idempotencyKey: string): MessageIngressRecord | null {
    const rawRow = this.databases.app.prepare('SELECT * FROM message_ingress WHERE idempotency_key = ?').get(idempotencyKey);
    if (!rawRow) return null;
    const row = MessageIngressDbRowSchema.parse(rawRow);
    return MessageIngressRecordSchema.parse({
      id: row.id,
      source: row.source,
      senderId: row.sender_id,
      chatId: row.chat_id,
      chatType: row.chat_type,
      telegramMessageId: row.telegram_message_id,
      idempotencyKey: row.idempotency_key,
      workspaceId: row.workspace_id,
      body: row.body,
      accepted: parseAccepted(row.accepted),
      decisionCode: row.decision_code,
      decisionReason: row.decision_reason,
      httpStatus: row.http_status,
      messageId: row.message_id,
      taskId: row.task_id,
      jobId: row.job_id,
      runId: row.run_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  insertMessageIngress(record: MessageIngressRecord): void {
    this.databases.app
      .prepare(`
        INSERT INTO message_ingress (
          id, source, sender_id, chat_id, chat_type, telegram_message_id, idempotency_key, workspace_id, body, accepted,
          decision_code, decision_reason, http_status, message_id, task_id, job_id, run_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.id,
        record.source,
        record.senderId,
        record.chatId,
        record.chatType,
        record.telegramMessageId,
        record.idempotencyKey,
        record.workspaceId,
        record.body,
        record.accepted ? 1 : 0,
        record.decisionCode,
        record.decisionReason,
        record.httpStatus,
        record.messageId,
        record.taskId,
        record.jobId,
        record.runId,
        record.createdAt,
        record.updatedAt,
      );
  }

  updateMessageIngressLinks(recordId: string, updates: Pick<MessageIngressRecord, 'messageId' | 'taskId' | 'jobId' | 'runId'>): void {
    this.databases.app
      .prepare('UPDATE message_ingress SET message_id = ?, task_id = ?, job_id = ?, run_id = ?, updated_at = ? WHERE id = ?')
      .run(updates.messageId, updates.taskId, updates.jobId, updates.runId, nowIso(), recordId);
  }

  upsertTelegramReplyDelivery(input: {
    workspaceId: string;
    chatId: string;
    telegramMessageId: number;
    messageIngressId: string;
    taskId: string | null;
    jobId: string | null;
    runId: string | null;
  }): void {
    const timestamp = nowIso();
    this.databases.app.prepare(`
      INSERT INTO telegram_reply_deliveries (
        id,
        workspace_id,
        chat_id,
        telegram_message_id,
        message_ingress_id,
        task_id,
        job_id,
        run_id,
        status,
        sent_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)
      ON CONFLICT(workspace_id, chat_id, telegram_message_id) DO UPDATE SET
        message_ingress_id = excluded.message_ingress_id,
        task_id = excluded.task_id,
        job_id = excluded.job_id,
        run_id = COALESCE(excluded.run_id, telegram_reply_deliveries.run_id),
        updated_at = excluded.updated_at
    `).run(
      randomUUID(),
      input.workspaceId,
      input.chatId,
      input.telegramMessageId,
      input.messageIngressId,
      input.taskId,
      input.jobId,
      input.runId,
      timestamp,
      timestamp,
    );
  }

  getTelegramDeliveryState(workspaceId: string, chatId: string | null, telegramMessageId: number | null): TelegramDeliveryState | null {
    if (!workspaceId || !chatId || typeof telegramMessageId !== 'number') {
      return null;
    }
    const rawRow = this.databases.app
      .prepare(
        'SELECT chat_id, telegram_message_id, status, sent_telegram_message_id, sent_at FROM telegram_reply_deliveries WHERE workspace_id = ? AND chat_id = ? AND telegram_message_id = ?',
      )
      .get(workspaceId, chatId, telegramMessageId);
    if (!rawRow) return null;
    const row = TelegramReplyDeliveryDbRowSchema.parse(rawRow);
    return TelegramDeliveryStateSchema.parse({
      chatId: row.chat_id,
      telegramMessageId: row.telegram_message_id,
      status: row.status,
    });
  }

  linkAcceptedIngressToRun(taskId: string, jobId: string, runId: string): void {
    const updatedAt = nowIso();
    this.databases.app
      .prepare('UPDATE message_ingress SET run_id = ?, updated_at = ? WHERE accepted = 1 AND (task_id = ? OR job_id = ?)')
      .run(runId, updatedAt, taskId, jobId);
    this.databases.app
      .prepare(`
        UPDATE messages
        SET related_run_id = ?
        WHERE id IN (
          SELECT message_id
          FROM message_ingress
          WHERE accepted = 1
            AND message_id IS NOT NULL
            AND (task_id = ? OR job_id = ?)
        )
      `)
      .run(runId, taskId, jobId);
    this.databases.app
      .prepare(`
        UPDATE telegram_reply_deliveries
        SET run_id = ?, updated_at = ?
        WHERE message_ingress_id IN (
          SELECT id
          FROM message_ingress
          WHERE accepted = 1
            AND (task_id = ? OR job_id = ?)
        )
      `)
      .run(runId, updatedAt, taskId, jobId);
  }

  buildIngressResponse(record: MessageIngressRecord, duplicate: boolean): MessageIngressResponse {
    return MessageIngressResponseSchema.parse({
      accepted: record.accepted,
      duplicate,
      httpStatus: record.httpStatus,
      decisionCode: duplicate && record.accepted ? 'duplicate_replayed' : record.decisionCode,
      decisionReason: duplicate ? `duplicate delivery replayed: ${record.decisionReason}` : record.decisionReason,
      message: record.messageId ? this.getMessage(record.messageId) : null,
      taskId: record.taskId,
      jobId: record.jobId,
      runId: record.runId,
      telegramDelivery: this.getTelegramDeliveryState(record.workspaceId, record.chatId, record.telegramMessageId),
    });
  }

  persistDeniedIngress(
    input: IngestMessageInput,
    body: string,
    decisionCode: Extract<MessageIngressDecisionCode, 'telegram_disabled' | 'telegram_private_chat_required' | 'telegram_not_allowlisted' | 'telegram_rate_limited' | 'telegram_prompt_injection' | 'telegram_invalid_message'>,
    decisionReason: string,
    httpStatus: number,
  ): MessageIngressRecord {
    const timestamp = nowIso();
    const record = MessageIngressRecordSchema.parse({
      id: randomUUID(),
      source: input.source,
      senderId: input.senderId,
      chatId: input.chatId ?? null,
      chatType: input.chatType ?? null,
      telegramMessageId: input.telegramMessageId ?? null,
      idempotencyKey: buildMessageIngressKey(input),
      workspaceId: input.workspaceId,
      body,
      accepted: false,
      decisionCode,
      decisionReason,
      httpStatus,
      messageId: null,
      taskId: null,
      jobId: null,
      runId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    this.insertMessageIngress(record);
    this.callbacks.recordSecurityAudit({
      code: decisionCode,
      severity: decisionCode === 'telegram_rate_limited' ? 'warn' : 'error',
      message: decisionReason,
      component: 'runtime-core',
      timestamp,
      details: {
        source: input.source,
        senderId: input.senderId,
        chatId: input.chatId ?? '',
        telegramMessageId: String(input.telegramMessageId ?? ''),
      },
    });
    return record;
  }

  countRecentTelegramIngressAttempts(senderId: string, chatId: string): number {
    const windowStart = new Date(Date.now() - this.config.telegram.rateLimitWindowSeconds * 1000).toISOString();
    return CountRowSchema.parse(this.databases.app
      .prepare(`
        SELECT COUNT(*) AS count
        FROM message_ingress
        WHERE source = 'telegram'
          AND created_at >= ?
          AND (sender_id = ? OR chat_id = ?)
      `)
      .get(windowStart, senderId, chatId)).count;
  }

  countRecentTelegramIngress(): number {
    const windowStart = new Date(Date.now() - this.config.telegram.rateLimitWindowSeconds * 1000).toISOString();
    return CountRowSchema.parse(this.databases.app
      .prepare(`
        SELECT COUNT(*) AS count
        FROM message_ingress
        WHERE source = 'telegram'
          AND accepted = 1
          AND created_at >= ?
      `)
      .get(windowStart)).count;
  }

  getMessage(messageId: string): MessageRecord | null {
    const rawRow = this.databases.app.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
    if (!rawRow) return null;
    const row = MessageDbRowSchema.parse(rawRow);
    return MessageRecordSchema.parse({
      id: row.id,
      source: row.source,
      senderId: row.sender_id,
      body: row.body,
      accepted: parseAccepted(row.accepted),
      relatedRunId: row.related_run_id,
      createdAt: row.created_at,
    });
  }

  ingestMessage(input: unknown): MessageIngressResponse {
    const parsedResult = IngestMessageInputSchema.safeParse(input);
    if (!parsedResult.success) {
      const raw = asInputRecord(input);
      const source = readStringField(raw, 'source');
      const telegramCandidate = source === 'telegram';
      if (telegramCandidate) {
        const timestamp = nowIso();
        const record = MessageIngressRecordSchema.parse({
          id: randomUUID(),
          source: 'telegram',
          senderId: readStringField(raw, 'senderId') ?? 'unknown',
          chatId: readStringField(raw, 'chatId') ?? null,
          chatType: readTelegramChatTypeField(raw, 'chatType') ?? null,
          telegramMessageId: readNumberField(raw, 'telegramMessageId') ?? null,
          idempotencyKey: null,
          workspaceId: readStringField(raw, 'workspaceId') ?? 'default',
          body: readStringField(raw, 'text') ?? '',
          accepted: false,
          decisionCode: 'telegram_invalid_message',
          decisionReason: 'Telegram ingress payload failed validation',
          httpStatus: 400,
          messageId: null,
          taskId: null,
          jobId: null,
          runId: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        this.insertMessageIngress(record);
        this.callbacks.recordSecurityAudit({
          code: 'telegram_invalid_message',
          severity: 'error',
          message: 'Telegram ingress payload failed validation',
          component: 'runtime-core',
          timestamp,
          details: { issues: String(parsedResult.error.issues.length) },
        });
        throw new MessageIngressError(this.buildIngressResponse(record, false));
      }
      throw parsedResult.error;
    }

    const parsed = parsedResult.data;
    const idempotencyKey = buildMessageIngressKey(parsed);

    if (idempotencyKey) {
      const existing = this.getMessageIngressByKey(idempotencyKey);
      if (existing) {
        const response = this.buildIngressResponse(existing, true);
        if (!existing.accepted) {
          throw new MessageIngressError(response);
        }
        return response;
      }
    }

    if (parsed.source === 'telegram') {
      const chatId = parsed.chatId;
      const telegramMessageId = parsed.telegramMessageId;
      if (!chatId || typeof telegramMessageId !== 'number') {
        throw new Error('Validated telegram ingress is missing chat linkage');
      }
      const redacted = redactText(parsed.text, this.config.security.redactionPatterns);
      for (const event of redacted.events) this.callbacks.recordSecurityAudit(event);

      if (!this.config.telegram.enabled) {
        const denied = this.persistDeniedIngress(parsed, redacted.text, 'telegram_disabled', 'Telegram ingress is disabled', 403);
        throw new MessageIngressError(this.buildIngressResponse(denied, false));
      }

      if (parsed.chatType !== 'private') {
        const denied = this.persistDeniedIngress(parsed, redacted.text, 'telegram_private_chat_required', 'Telegram ingress requires a private chat', 403);
        throw new MessageIngressError(this.buildIngressResponse(denied, false));
      }

      if (!this.config.telegram.allowedUserId || parsed.senderId !== this.config.telegram.allowedUserId) {
        const denied = this.persistDeniedIngress(parsed, redacted.text, 'telegram_not_allowlisted', 'Telegram sender is not allowlisted', 403);
        throw new MessageIngressError(this.buildIngressResponse(denied, false));
      }

      if (this.countRecentTelegramIngress() >= this.config.telegram.globalMaxMessagesPerMinute) {
        const denied = this.persistDeniedIngress(parsed, redacted.text, 'telegram_rate_limited', 'Global Telegram rate limit exceeded', 429);
        throw new MessageIngressError(this.buildIngressResponse(denied, false));
      }

      if (this.countRecentTelegramIngressAttempts(parsed.senderId, chatId) >= this.config.telegram.maxMessagesPerMinute) {
        const denied = this.persistDeniedIngress(parsed, redacted.text, 'telegram_rate_limited', 'Telegram rate limit exceeded', 429);
        throw new MessageIngressError(this.buildIngressResponse(denied, false));
      }

      const promptScan = scanPrompt(redacted.text, this.promptScanOptions());
      const redactedPrompt = redactText(promptScan.sanitizedText, this.config.security.redactionPatterns);
      for (const event of redactedPrompt.events) this.callbacks.recordSecurityAudit(event);

      if (promptScan.verdict === 'quarantine') {
        const denied = this.persistDeniedIngress(parsed, redactedPrompt.text, 'telegram_prompt_injection', 'Telegram message was quarantined by prompt-injection detection', 400);
        this.callbacks.recordSecurityAudit({
          code: 'prompt_scan_quarantined',
          severity: 'error',
          message: 'Prompt scan quarantined a telegram message',
          component: 'runtime-core',
          timestamp: nowIso(),
          details: {
            source: parsed.source,
            senderId: parsed.senderId,
            verdict: promptScan.verdict,
            matchedRules: promptScan.matchedRules.join(', '),
          },
        });
        this.callbacks.createIntervention('prompt_injection_quarantined', null, `Prompt scan blocked telegram message ${denied.id}`);
        throw new MessageIngressError(this.buildIngressResponse(denied, false));
      }

      if (promptScan.verdict === 'sanitize' && promptScan.matchedRules.length > 0) {
        this.callbacks.recordSecurityAudit({
          code: 'prompt_scan_sanitized',
          severity: 'info',
          message: 'Prompt scan sanitized a telegram message',
          component: 'runtime-core',
          timestamp: nowIso(),
          details: {
            source: parsed.source,
            senderId: parsed.senderId,
            verdict: promptScan.verdict,
            matchedRules: promptScan.matchedRules.join(', '),
          },
        });
      }

      const timestamp = nowIso();
      const message: MessageRecord = MessageRecordSchema.parse({
        id: randomUUID(),
        source: parsed.source,
        senderId: parsed.senderId,
        body: redactedPrompt.text,
        accepted: true,
        relatedRunId: null,
        createdAt: timestamp,
      });
      this.databases.app.prepare('INSERT INTO messages (id, source, sender_id, body, accepted, related_run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        message.id,
        message.source,
        message.senderId,
        message.body,
        1,
        message.relatedRunId,
        message.createdAt,
      );

      const ingressRecord = MessageIngressRecordSchema.parse({
        id: randomUUID(),
        source: parsed.source,
        senderId: parsed.senderId,
        chatId,
        chatType: parsed.chatType,
        telegramMessageId,
        idempotencyKey,
        workspaceId: parsed.workspaceId,
        body: message.body,
        accepted: true,
        decisionCode: 'accepted',
        decisionReason: promptScan.verdict === 'sanitize' ? 'Telegram message accepted after sanitization' : 'Telegram message accepted',
        httpStatus: 200,
        messageId: message.id,
        taskId: null,
        jobId: null,
        runId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      this.insertMessageIngress(ingressRecord);

      const created = this.callbacks.createTask({
        workspaceId: parsed.workspaceId,
        projectId: null,
        title: `message:${message.id}`,
        prompt: message.body,
        source: 'telegram',
        coalesceKey: null,
        autoEnqueue: true,
      });
      this.updateMessageIngressLinks(ingressRecord.id, {
        messageId: message.id,
        taskId: created.task.id,
        jobId: created.job?.id ?? null,
        runId: created.run?.id ?? null,
      });
      this.upsertTelegramReplyDelivery({
        workspaceId: parsed.workspaceId,
        chatId,
        telegramMessageId,
        messageIngressId: ingressRecord.id,
        taskId: created.task.id,
        jobId: created.job?.id ?? null,
        runId: created.run?.id ?? null,
      });

      return MessageIngressResponseSchema.parse({
        accepted: true,
        duplicate: false,
        httpStatus: 200,
        decisionCode: 'accepted',
        decisionReason: ingressRecord.decisionReason,
        message,
        taskId: created.task.id,
        jobId: created.job?.id ?? null,
        runId: created.run?.id ?? null,
        telegramDelivery: {
          chatId,
          telegramMessageId,
          status: 'pending',
        },
      });
    }

    const promptScan = scanPrompt(parsed.text, this.promptScanOptions());
    const redacted = redactText(promptScan.sanitizedText, this.config.security.redactionPatterns);
    for (const event of redacted.events) this.callbacks.recordSecurityAudit(event);
    if (promptScan.verdict === 'quarantine') {
      this.callbacks.createIntervention('prompt_injection_quarantined', null, 'Prompt scan blocked a non-telegram message');
      this.callbacks.recordSecurityAudit({
        code: 'prompt_scan_quarantined',
        severity: 'error',
        message: 'Prompt scan quarantined a non-telegram message',
        component: 'runtime-core',
        timestamp: nowIso(),
        details: {
          source: parsed.source,
          senderId: parsed.senderId,
          verdict: promptScan.verdict,
          matchedRules: promptScan.matchedRules.join(', '),
        },
      });
      throw new MessageIngressError(
        MessageIngressResponseSchema.parse({
          accepted: false,
          duplicate: false,
          httpStatus: 400,
          decisionCode: 'prompt_injection_quarantined',
          decisionReason: 'Message was quarantined by prompt-injection detection',
          message: null,
          taskId: null,
          jobId: null,
          runId: null,
        }),
      );
    }

    if (promptScan.verdict === 'sanitize' && promptScan.matchedRules.length > 0) {
      this.callbacks.recordSecurityAudit({
        code: 'prompt_scan_sanitized',
        severity: 'info',
        message: 'Prompt scan sanitized a non-telegram message',
        component: 'runtime-core',
        timestamp: nowIso(),
        details: {
          source: parsed.source,
          senderId: parsed.senderId,
          verdict: promptScan.verdict,
          matchedRules: promptScan.matchedRules.join(', '),
        },
      });
    }

    const message: MessageRecord = MessageRecordSchema.parse({
      id: randomUUID(),
      source: parsed.source,
      senderId: parsed.senderId,
      body: redacted.text,
      accepted: true,
      relatedRunId: null,
      createdAt: nowIso(),
    });
    this.databases.app.prepare('INSERT INTO messages (id, source, sender_id, body, accepted, related_run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      message.id,
      message.source,
      message.senderId,
      message.body,
      1,
      message.relatedRunId,
      message.createdAt,
    );
    const created = this.callbacks.createTask({ workspaceId: parsed.workspaceId, projectId: null, title: `message:${message.id}`, prompt: message.body, source: parsed.source === 'manual' ? 'manual' : 'api', coalesceKey: null, autoEnqueue: true });
    return MessageIngressResponseSchema.parse({
      accepted: true,
      duplicate: false,
      httpStatus: 200,
      decisionCode: 'accepted',
      decisionReason: 'Message accepted',
      message,
      taskId: created.task.id,
      jobId: created.job?.id ?? null,
      runId: created.run?.id ?? null,
    });
  }
}
