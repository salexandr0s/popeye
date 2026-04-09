/**
 * Gmail-specific normalization helpers.
 * Shared between GmailAdapter (direct API) and GwsCliAdapter (CLI wrapper).
 * Converts raw Gmail API response shapes into NormalizedThread/NormalizedMessage.
 */

import type { NormalizedThread, NormalizedMessage } from './adapter-interface.js';
import type {
  GmailThread,
  GmailMessage,
  GmailHeader,
  GmailMessagePart,
} from './gmail-types.js';

const BODY_PREVIEW_MAX_CHARS = 500;

export function normalizeGmailThread(raw: GmailThread): NormalizedThread {
  const messages = (raw.messages ?? []).map((m) => normalizeGmailMessage(m));
  const allLabels = new Set<string>();
  let isUnread = false;
  let isStarred = false;
  let lastMessageAt = '';

  for (const msg of messages) {
    for (const label of msg.labelIds) allLabels.add(label);
    if (msg.labelIds.includes('UNREAD')) isUnread = true;
    if (msg.labelIds.includes('STARRED')) isStarred = true;
    if (msg.receivedAt > lastMessageAt) lastMessageAt = msg.receivedAt;
  }

  const firstMessage = messages[0];
  return {
    threadId: raw.id,
    subject: firstMessage?.subject ?? raw.snippet ?? '',
    snippet: raw.snippet ?? firstMessage?.snippet ?? '',
    lastMessageAt: lastMessageAt || new Date().toISOString(),
    messageCount: messages.length,
    labelIds: [...allLabels],
    isUnread,
    isStarred,
    messages,
  };
}

export function normalizeGmailMessage(raw: GmailMessage): NormalizedMessage {
  const headers = raw.payload.headers;
  return {
    messageId: raw.id,
    threadId: raw.threadId,
    from: getHeader(headers, 'From') ?? '',
    to: parseAddressList(getHeader(headers, 'To') ?? ''),
    cc: parseAddressList(getHeader(headers, 'Cc') ?? ''),
    subject: getHeader(headers, 'Subject') ?? '',
    snippet: raw.snippet,
    bodyPreview: extractBodyPreview(raw.payload),
    receivedAt: new Date(parseInt(raw.internalDate, 10)).toISOString(),
    sizeEstimate: raw.sizeEstimate,
    labelIds: raw.labelIds ?? [],
  };
}

export function getHeader(headers: GmailHeader[], name: string): string | undefined {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

export function parseAddressList(value: string): string[] {
  if (!value.trim()) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

export function extractBodyPreview(payload: GmailMessagePart): string {
  return extractBodyText(payload).slice(0, BODY_PREVIEW_MAX_CHARS);
}

export function extractBodyText(payload: GmailMessagePart): string {
  const textPart = findPart(payload, 'text/plain') ?? findPart(payload, 'text/html');
  if (!textPart?.body.data) return '';

  const decoded = Buffer.from(textPart.body.data, 'base64url').toString('utf-8');

  const text = textPart.mimeType === 'text/html'
    ? decoded.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    : decoded;

  return text;
}

function findPart(part: GmailMessagePart, mimeType: string): GmailMessagePart | undefined {
  if (part.mimeType === mimeType && part.body.data) return part;
  if (part.parts) {
    for (const child of part.parts) {
      const found = findPart(child, mimeType);
      if (found) return found;
    }
  }
  return undefined;
}
