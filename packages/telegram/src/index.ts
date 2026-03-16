import { createHash } from 'node:crypto';
import type { PopeyeLogger } from '@popeye/observability';
import type {
  IngestMessageInput,
  JobRecord,
  MessageIngressResponse,
  RunReply,
  ReceiptRecord,
  RunEventRecord,
  TelegramChatType,
  TelegramDeliveryRecord,
  TelegramDeliveryState,
  TelegramRelayCheckpoint,
  TelegramRelayCheckpointCommitRequest,
  TelegramSendAttemptRecord,
} from '@popeye/contracts';
import { extractCanonicalRunReplyText } from '@popeye/contracts';

export interface TelegramUserRef {
  id: number | string;
}

export interface TelegramChatRef {
  id: number | string;
  type: TelegramChatType;
}

export interface TelegramMessageUpdate {
  message_id: number;
  from?: TelegramUserRef;
  chat: TelegramChatRef;
  text?: string;
  caption?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessageUpdate;
  edited_message?: TelegramMessageUpdate;
}

export interface NormalizedTelegramUpdate {
  senderId: string;
  chatId: string;
  chatType: TelegramChatType;
  telegramMessageId: number;
  text: string;
}

export interface TelegramIngressClient {
  ingestMessage(input: IngestMessageInput): Promise<MessageIngressResponse>;
}

export interface TelegramRunTrackingClient extends TelegramIngressClient {
  getJob(jobId: string): Promise<JobRecord>;
  getRunReply(runId: string): Promise<RunReply>;
  getTelegramRelayCheckpoint(workspaceId: string): Promise<TelegramRelayCheckpoint | null>;
  commitTelegramRelayCheckpoint(input: TelegramRelayCheckpointCommitRequest): Promise<TelegramRelayCheckpoint>;
  markTelegramReplySending(
    chatId: string,
    telegramMessageId: number,
    input: { workspaceId: string; runId?: string | null },
  ): Promise<TelegramDeliveryState>;
  markTelegramReplyPending(
    chatId: string,
    telegramMessageId: number,
    input: { workspaceId: string; runId?: string | null },
  ): Promise<TelegramDeliveryState>;
  markTelegramReplyUncertain(
    chatId: string,
    telegramMessageId: number,
    input: { workspaceId: string; runId?: string | null; reason?: string | null },
  ): Promise<TelegramDeliveryState>;
  markTelegramReplySent(
    chatId: string,
    telegramMessageId: number,
    input: { workspaceId: string; runId?: string | null; sentTelegramMessageId?: number | null },
  ): Promise<TelegramDeliveryState>;
  getResendableDeliveries(workspaceId: string): Promise<TelegramDeliveryRecord[]>;
  recordSendAttempt(input: {
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
  }): Promise<TelegramSendAttemptRecord>;
}

export interface TelegramSendMessageInput {
  chatId: string;
  text: string;
  replyToMessageId?: number;
}

export interface TelegramSentMessage {
  messageId: number;
}

export interface TelegramBotClient {
  getUpdates(options?: { offset?: number; timeoutSeconds?: number }): Promise<TelegramUpdate[]>;
  sendMessage(input: TelegramSendMessageInput): Promise<TelegramSentMessage>;
}

export interface TelegramBotClientOptions {
  token: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface TelegramLongPollRelayOptions {
  bot: TelegramBotClient;
  control: TelegramRunTrackingClient;
  workspaceId: string;
  longPollTimeoutSeconds?: number;
  retryDelayMs?: number;
  jobPollIntervalMs?: number;
  jobTimeoutMs?: number;
  sendRetryAttempts?: number;
  sendRetryDelayMs?: number;
  maxConcurrentPreparations?: number;
  /** Optional structured logger for relay operational events. */
  logger?: PopeyeLogger;
}

const TERMINAL_JOB_STATUSES = new Set<JobRecord['status']>(['succeeded', 'failed_final', 'cancelled']);
const TELEGRAM_MESSAGE_LIMIT = 4096;

export class TelegramBotApiError extends Error {
  readonly kind = 'api';

  constructor(
    readonly method: string,
    readonly status: number,
    message?: string,
  ) {
    super(message ?? `Telegram Bot API ${method} failed with ${status}`);
    this.name = 'TelegramBotApiError';
  }
}

export class TelegramBotTransportError extends Error {
  readonly kind = 'transport';
  override readonly cause: unknown;

  constructor(
    readonly method: string,
    cause?: unknown,
  ) {
    super(`Telegram Bot API ${method} transport failed`);
    this.name = 'TelegramBotTransportError';
    this.cause = cause;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateTelegramText(text: string): string {
  if (text.length <= TELEGRAM_MESSAGE_LIMIT) return text;
  return `${text.slice(0, TELEGRAM_MESSAGE_LIMIT - 1)}…`;
}

export function normalizeTelegramUpdate(update: TelegramUpdate): NormalizedTelegramUpdate | null {
  const message = update.message ?? update.edited_message;
  if (!message?.from) return null;

  const text = message.text ?? message.caption;
  if (!text) return null;

  return {
    senderId: String(message.from.id),
    chatId: String(message.chat.id),
    chatType: message.chat.type,
    telegramMessageId: message.message_id,
    text,
  };
}

export function formatTelegramReply(text: string): string {
  return truncateTelegramText(text.replace(/\r\n/g, '\n').trim());
}

export async function ingestTelegramUpdate(
  client: TelegramIngressClient,
  update: TelegramUpdate,
  workspaceId: string,
): Promise<MessageIngressResponse | null> {
  const normalized = normalizeTelegramUpdate(update);
  if (!normalized) return null;

  return client.ingestMessage({
    source: 'telegram',
    senderId: normalized.senderId,
    text: normalized.text,
    chatId: normalized.chatId,
    chatType: normalized.chatType,
    telegramMessageId: normalized.telegramMessageId,
    workspaceId,
  });
}

export function extractTelegramReplyFromRunEvents(events: RunEventRecord[]): string | null {
  return extractCanonicalRunReplyText(events);
}

export function buildTelegramRunReply(receipt: ReceiptRecord): string {
  const statusPrefix = receipt.status === 'succeeded'
    ? '✅'
    : receipt.status === 'cancelled'
      ? '⏹️'
      : '⚠️';
  const parts = [
    `${statusPrefix} ${receipt.summary}`,
    `Status: ${receipt.status}`,
    `Model: ${receipt.usage.provider}/${receipt.usage.model}`,
    `Tokens: ${receipt.usage.tokensIn}/${receipt.usage.tokensOut}`,
    `Cost: $${receipt.usage.estimatedCostUsd.toFixed(4)}`,
  ];
  if (receipt.status !== 'succeeded' && receipt.details.trim().length > 0) {
    parts.push(`Details: ${receipt.details}`);
  }
  return formatTelegramReply(parts.join('\n'));
}

export function createTelegramBotClient(options: TelegramBotClientOptions): TelegramBotClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? 'https://api.telegram.org').replace(/\/$/, '');

  async function request<T>(method: string, body: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}/bot${options.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new TelegramBotTransportError(method, error);
    }
    if (!response.ok) {
      throw new TelegramBotApiError(method, response.status);
    }
    const payload = await response.json() as { ok?: boolean; result?: T; description?: string };
    if (!payload.ok) {
      throw new TelegramBotApiError(method, response.status, payload.description ?? `Telegram Bot API ${method} returned not ok`);
    }
    return payload.result as T;
  }

  return {
    async getUpdates(options = {}) {
      return request<TelegramUpdate[]>('getUpdates', {
        offset: options.offset,
        timeout: options.timeoutSeconds ?? 30,
        allowed_updates: ['message', 'edited_message'],
      });
    },
    async sendMessage(input) {
      const result = await request<{ message_id: number }>('sendMessage', {
        chat_id: input.chatId,
        text: truncateTelegramText(input.text),
        reply_to_message_id: input.replyToMessageId,
      });
      return { messageId: result.message_id };
    },
  };
}

function isRetryableTelegramSendError(error: unknown): error is TelegramBotApiError {
  return error instanceof TelegramBotApiError && (error.status === 429 || error.status >= 500);
}

async function waitForTerminalJob(
  client: TelegramRunTrackingClient,
  jobId: string,
  pollIntervalMs: number,
  timeoutMs: number,
): Promise<JobRecord | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const job = await client.getJob(jobId);
    if (TERMINAL_JOB_STATUSES.has(job.status)) {
      return job;
    }
    await sleep(pollIntervalMs);
  }
  return null;
}

function computeContentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

interface SendWithRetryContext {
  deliveryId?: string;
  chatId: string;
  telegramMessageId: number;
  workspaceId: string;
  runId?: string;
  control: TelegramRunTrackingClient;
}

async function sendTelegramReplyWithRetry(
  bot: TelegramBotClient,
  input: TelegramSendMessageInput,
  options: { attempts: number; delayMs: number },
  auditContext?: SendWithRetryContext,
): Promise<TelegramSentMessage> {
  const maxAttempts = Math.max(1, options.attempts);
  const contentHash = auditContext ? computeContentHash(input.text) : '';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = new Date().toISOString();
    try {
      const result = await bot.sendMessage(input);
      if (auditContext) {
        await auditContext.control.recordSendAttempt({
          ...(auditContext.deliveryId !== undefined && { deliveryId: auditContext.deliveryId }),
          chatId: auditContext.chatId,
          telegramMessageId: auditContext.telegramMessageId,
          workspaceId: auditContext.workspaceId,
          startedAt,
          finishedAt: new Date().toISOString(),
          ...(auditContext.runId !== undefined && { runId: auditContext.runId }),
          contentHash,
          outcome: 'sent',
          sentTelegramMessageId: result.messageId,
        }).catch(() => { /* best-effort audit */ });
      }
      return result;
    } catch (error) {
      if (auditContext) {
        const isRetryable = isRetryableTelegramSendError(error);
        const isLast = attempt >= maxAttempts;
        await auditContext.control.recordSendAttempt({
          ...(auditContext.deliveryId !== undefined && { deliveryId: auditContext.deliveryId }),
          chatId: auditContext.chatId,
          telegramMessageId: auditContext.telegramMessageId,
          workspaceId: auditContext.workspaceId,
          startedAt,
          finishedAt: new Date().toISOString(),
          ...(auditContext.runId !== undefined && { runId: auditContext.runId }),
          contentHash,
          outcome: isRetryable ? 'retryable_failure' : (isLast ? 'ambiguous' : 'permanent_failure'),
          errorSummary: describeTelegramSendFailure(error).slice(0, 500),
        }).catch(() => { /* best-effort audit */ });
      }
      if (attempt >= maxAttempts || !isRetryableTelegramSendError(error)) {
        throw error;
      }
      await sleep(options.delayMs);
    }
  }
  throw new Error('unreachable: retry loop completed without return or throw');
}

function buildTelegramDeliveryKey(workspaceId: string, chatId: string, telegramMessageId: number): string {
  return `${workspaceId}:${chatId}:${telegramMessageId}`;
}

function describeTelegramSendFailure(error: unknown): string {
  if (error instanceof TelegramBotApiError) {
    return `Telegram Bot API sendMessage failed with status ${error.status}: ${error.message}`;
  }
  if (error instanceof TelegramBotTransportError) {
    return `${error.message}${error.cause instanceof Error ? `: ${error.cause.message}` : ''}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

interface PreparedTelegramAckUpdate {
  kind: 'ack';
  updateId: number;
}

interface PreparedTelegramSendUpdate {
  kind: 'send';
  updateId: number;
  deliveryKey: string;
  chatId: string;
  telegramMessageId: number;
  runId: string;
  text: string;
}

interface PreparedTelegramUncertainUpdate {
  kind: 'uncertain';
  updateId: number;
  deliveryKey: string;
  chatId: string;
  telegramMessageId: number;
  runId: string | null;
  reason: string;
}

type PreparedTelegramUpdate =
  | PreparedTelegramAckUpdate
  | PreparedTelegramSendUpdate
  | PreparedTelegramUncertainUpdate;

export class TelegramLongPollRelay {
  private nextOffset: number | undefined;
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private checkpointLoaded = false;
  private readonly activeDeliveryKeys = new Set<string>();
  private readonly log: PopeyeLogger | null;

  constructor(private readonly options: TelegramLongPollRelayOptions) {
    this.log = options.logger ?? null;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.log?.info('relay started');
    this.loopPromise = this.pollLoop();
  }

  async stop(): Promise<void> {
    this.log?.info('relay stopping');
    this.running = false;
    await this.loopPromise;
  }

  private async pollLoop(): Promise<void> {
    const longPollTimeoutSeconds = this.options.longPollTimeoutSeconds ?? 30;
    const retryDelayMs = this.options.retryDelayMs ?? 1_000;
    while (this.running) {
      try {
        await this.ensureCheckpointLoaded();
        const updates = await this.options.bot.getUpdates(
          this.nextOffset === undefined
            ? { timeoutSeconds: longPollTimeoutSeconds }
            : { offset: this.nextOffset, timeoutSeconds: longPollTimeoutSeconds },
        );
        await this.processUpdates([...updates].sort((left, right) => left.update_id - right.update_id));
      } catch (error) {
        if (!this.running) break;
        this.log?.warn('poll loop error, retrying', { error: error instanceof Error ? error.message : String(error) });
        await sleep(retryDelayMs);
      }
    }
  }

  private async ensureCheckpointLoaded(): Promise<void> {
    if (this.checkpointLoaded) return;
    const checkpoint = await this.options.control.getTelegramRelayCheckpoint(this.options.workspaceId);
    this.nextOffset = checkpoint ? checkpoint.lastAcknowledgedUpdateId + 1 : undefined;
    this.checkpointLoaded = true;
  }

  private async acknowledgeUpdate(updateId: number): Promise<void> {
    await this.options.control.commitTelegramRelayCheckpoint({
      relayKey: 'telegram_long_poll',
      workspaceId: this.options.workspaceId,
      lastAcknowledgedUpdateId: updateId,
    });
    this.nextOffset = updateId + 1;
  }

  private async processUpdates(updates: TelegramUpdate[]): Promise<void> {
    if (updates.length === 0) {
      await this.sweepResendableDeliveries();
      return;
    }

    const maxConcurrentPreparations = Math.max(1, this.options.maxConcurrentPreparations ?? 4);
    const pendingPreparations = updates
      .slice(0, maxConcurrentPreparations)
      .map((update) => this.prepareUpdate(update));

    let nextIndex = pendingPreparations.length;
    try {
      while (pendingPreparations.length > 0) {
        const prepared = await pendingPreparations[0]!;
        void pendingPreparations.shift();
        if (nextIndex < updates.length) {
          pendingPreparations.push(this.prepareUpdate(updates[nextIndex]!));
          nextIndex += 1;
        }
        await this.completePreparedUpdate(prepared);
      }
    } catch (error) {
      this.log?.error('batch processing failed', { error: error instanceof Error ? error.message : String(error) });
      await Promise.allSettled(pendingPreparations);
      this.activeDeliveryKeys.clear();
      throw error;
    }

    await this.sweepResendableDeliveries();
  }

  private async sweepResendableDeliveries(): Promise<void> {
    let deliveries: TelegramDeliveryRecord[];
    try {
      deliveries = await this.options.control.getResendableDeliveries(this.options.workspaceId);
    } catch (error) {
      this.log?.debug('resendable sweep failed', { error: error instanceof Error ? error.message : String(error) });
      return; // best-effort
    }
    for (const delivery of deliveries) {
      const deliveryKey = buildTelegramDeliveryKey(this.options.workspaceId, delivery.chatId, delivery.telegramMessageId);
      if (this.activeDeliveryKeys.has(deliveryKey)) continue;
      if (!delivery.runId) continue;

      this.activeDeliveryKeys.add(deliveryKey);
      try {
        const reply = await this.options.control.getRunReply(delivery.runId);
        const prepared: PreparedTelegramSendUpdate = {
          kind: 'send',
          updateId: -1, // synthetic — no checkpoint ack
          deliveryKey,
          chatId: delivery.chatId,
          telegramMessageId: delivery.telegramMessageId,
          runId: delivery.runId,
          text: formatTelegramReply(reply.text),
        };
        await this.completePreparedUpdate(prepared);
      } catch (error) {
        this.log?.warn('delivery retry failed', { deliveryKey, error: error instanceof Error ? error.message : String(error) });
        this.activeDeliveryKeys.delete(deliveryKey);
      }
    }
  }

  private async prepareUpdate(update: TelegramUpdate): Promise<PreparedTelegramUpdate> {
    const normalized = normalizeTelegramUpdate(update);
    if (!normalized) {
      this.log?.debug('skipping non-normalizable update', { updateId: update.update_id });
      return { kind: 'ack', updateId: update.update_id };
    }

    const deliveryKey = buildTelegramDeliveryKey(this.options.workspaceId, normalized.chatId, normalized.telegramMessageId);
    const ingress = await ingestTelegramUpdate(this.options.control, update, this.options.workspaceId);
    if (!ingress) {
      return { kind: 'ack', updateId: update.update_id };
    }
    if (!ingress.accepted) {
      return { kind: 'ack', updateId: update.update_id };
    }
    if (ingress.duplicate) {
      if (ingress.telegramDelivery?.status === 'sent' || ingress.telegramDelivery?.status === 'uncertain') {
        return { kind: 'ack', updateId: update.update_id };
      }
      if (this.activeDeliveryKeys.has(deliveryKey)) {
        return { kind: 'ack', updateId: update.update_id };
      }
      if (ingress.telegramDelivery?.status === 'sending') {
        return {
          kind: 'uncertain',
          updateId: update.update_id,
          deliveryKey,
          chatId: normalized.chatId,
          telegramMessageId: normalized.telegramMessageId,
          runId: ingress.runId ?? null,
          reason: 'Telegram delivery replay observed after a durable send claim; original send may have succeeded before relay recovery.',
        };
      }
    }
    if (!ingress.jobId) {
      throw new Error(`Telegram ingress ${ingress.taskId ?? 'unknown'} is missing job linkage`);
    }

    this.activeDeliveryKeys.add(deliveryKey);

    try {
      const job = await waitForTerminalJob(
        this.options.control,
        ingress.jobId,
        this.options.jobPollIntervalMs ?? 500,
        this.options.jobTimeoutMs ?? 300_000,
      );
      if (!job?.lastRunId) {
        throw new Error(`Telegram job ${ingress.jobId} reached terminal state without a run`);
      }

      const reply = await this.options.control.getRunReply(job.lastRunId);
      return {
        kind: 'send',
        updateId: update.update_id,
        deliveryKey,
        chatId: normalized.chatId,
        telegramMessageId: normalized.telegramMessageId,
        runId: job.lastRunId,
        text: formatTelegramReply(reply.text),
      };
    } catch (error) {
      this.activeDeliveryKeys.delete(deliveryKey);
      throw error;
    }
  }

  private async acknowledgeIfReal(updateId: number): Promise<void> {
    if (updateId >= 0) {
      await this.acknowledgeUpdate(updateId);
    }
  }

  private async completePreparedUpdate(prepared: PreparedTelegramUpdate): Promise<void> {
    if (prepared.kind === 'ack') {
      await this.acknowledgeIfReal(prepared.updateId);
      return;
    }

    try {
      if (prepared.kind === 'uncertain') {
        this.log?.info('delivery marked uncertain', { chatId: prepared.chatId, telegramMessageId: prepared.telegramMessageId });
        await this.options.control.markTelegramReplyUncertain(prepared.chatId, prepared.telegramMessageId, {
          workspaceId: this.options.workspaceId,
          runId: prepared.runId,
          reason: prepared.reason,
        });
        await this.acknowledgeIfReal(prepared.updateId);
        return;
      }

      const delivery = await this.options.control.markTelegramReplySending(prepared.chatId, prepared.telegramMessageId, {
        workspaceId: this.options.workspaceId,
        runId: prepared.runId,
      });
      if (delivery.status === 'sent' || delivery.status === 'uncertain') {
        await this.acknowledgeIfReal(prepared.updateId);
        return;
      }

      try {
        const sentMessage = await sendTelegramReplyWithRetry(this.options.bot, {
          chatId: prepared.chatId,
          text: prepared.text,
          replyToMessageId: prepared.telegramMessageId,
        }, {
          attempts: this.options.sendRetryAttempts ?? 3,
          delayMs: this.options.sendRetryDelayMs ?? (this.options.retryDelayMs ?? 1_000),
        }, {
          chatId: prepared.chatId,
          telegramMessageId: prepared.telegramMessageId,
          workspaceId: this.options.workspaceId,
          runId: prepared.runId,
          control: this.options.control,
        });
        await this.options.control.markTelegramReplySent(prepared.chatId, prepared.telegramMessageId, {
          workspaceId: this.options.workspaceId,
          runId: prepared.runId,
          sentTelegramMessageId: sentMessage.messageId,
        });
        await this.acknowledgeIfReal(prepared.updateId);
      } catch (error) {
        if (isRetryableTelegramSendError(error)) {
          this.log?.warn('send failed (retryable)', { chatId: prepared.chatId, telegramMessageId: prepared.telegramMessageId, error: error instanceof Error ? error.message : String(error) });
          await this.options.control.markTelegramReplyPending(prepared.chatId, prepared.telegramMessageId, {
            workspaceId: this.options.workspaceId,
            runId: prepared.runId,
          });
          throw error;
        }

        this.log?.warn('send failed, marking uncertain', { chatId: prepared.chatId, telegramMessageId: prepared.telegramMessageId, error: describeTelegramSendFailure(error) });
        await this.options.control.markTelegramReplyUncertain(prepared.chatId, prepared.telegramMessageId, {
          workspaceId: this.options.workspaceId,
          runId: prepared.runId,
          reason: describeTelegramSendFailure(error),
        });
        await this.acknowledgeIfReal(prepared.updateId);
      }
    } finally {
      this.activeDeliveryKeys.delete(prepared.deliveryKey);
    }
  }
}
