import type { IngestMessageInput, MessageIngressResponse, TelegramChatType } from '@popeye/contracts';

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
  return text.replace(/\r\n/g, '\n').trim();
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
