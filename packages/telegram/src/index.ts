import type {
  IngestMessageInput,
  JobRecord,
  MessageIngressResponse,
  RunReply,
  ReceiptRecord,
  RunEventRecord,
  TelegramChatType,
  TelegramDeliveryState,
  TelegramRelayCheckpoint,
  TelegramRelayCheckpointCommitRequest,
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
  markTelegramReplySent(
    chatId: string,
    telegramMessageId: number,
    input: { workspaceId: string; runId?: string | null },
  ): Promise<TelegramDeliveryState>;
}

export interface TelegramSendMessageInput {
  chatId: string;
  text: string;
  replyToMessageId?: number;
}

export interface TelegramBotClient {
  getUpdates(options?: { offset?: number; timeoutSeconds?: number }): Promise<TelegramUpdate[]>;
  sendMessage(input: TelegramSendMessageInput): Promise<void>;
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
}

const TERMINAL_JOB_STATUSES = new Set<JobRecord['status']>(['succeeded', 'failed_final', 'cancelled']);
const TELEGRAM_MESSAGE_LIMIT = 4096;

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
    const response = await fetchImpl(`${baseUrl}/bot${options.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Telegram Bot API ${method} failed with ${response.status}`);
    }
    const payload = await response.json() as { ok?: boolean; result?: T; description?: string };
    if (!payload.ok) {
      throw new Error(payload.description ?? `Telegram Bot API ${method} returned not ok`);
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
      await request('sendMessage', {
        chat_id: input.chatId,
        text: truncateTelegramText(input.text),
        reply_to_message_id: input.replyToMessageId,
      });
    },
  };
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

async function sendTelegramReplyWithRetry(
  bot: TelegramBotClient,
  input: TelegramSendMessageInput,
  options: { attempts: number; delayMs: number },
): Promise<void> {
  const maxAttempts = Math.max(1, options.attempts);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await bot.sendMessage(input);
      return;
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error;
      }
      await sleep(options.delayMs);
    }
  }
}

export class TelegramLongPollRelay {
  private nextOffset: number | undefined;
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private checkpointLoaded = false;

  constructor(private readonly options: TelegramLongPollRelayOptions) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.pollLoop();
  }

  async stop(): Promise<void> {
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
        for (const update of [...updates].sort((left, right) => left.update_id - right.update_id)) {
          await this.handleUpdate(update);
        }
      } catch {
        if (!this.running) break;
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

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const normalized = normalizeTelegramUpdate(update);
    if (!normalized) {
      await this.acknowledgeUpdate(update.update_id);
      return;
    }

    const ingress = await ingestTelegramUpdate(this.options.control, update, this.options.workspaceId);
    if (!ingress) {
      await this.acknowledgeUpdate(update.update_id);
      return;
    }
    if (!ingress.accepted) {
      await this.acknowledgeUpdate(update.update_id);
      return;
    }
    if (ingress.duplicate && ingress.telegramDelivery?.status === 'sent') {
      await this.acknowledgeUpdate(update.update_id);
      return;
    }
    if (!ingress.jobId) {
      throw new Error(`Telegram ingress ${ingress.taskId ?? 'unknown'} is missing job linkage`);
    }

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

    await sendTelegramReplyWithRetry(this.options.bot, {
      chatId: normalized.chatId,
      text: formatTelegramReply(reply.text),
      replyToMessageId: normalized.telegramMessageId,
    }, {
      attempts: this.options.sendRetryAttempts ?? 3,
      delayMs: this.options.sendRetryDelayMs ?? (this.options.retryDelayMs ?? 1_000),
    });
    await this.options.control.markTelegramReplySent(normalized.chatId, normalized.telegramMessageId, {
      workspaceId: this.options.workspaceId,
      runId: job.lastRunId,
    });
    await this.acknowledgeUpdate(update.update_id);
  }
}
