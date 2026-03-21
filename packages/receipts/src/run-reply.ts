import type { RunEventRecord } from '@popeye/contracts';
import type { ReceiptRecord } from '@popeye/contracts';
import type { CanonicalRunReply } from '@popeye/contracts';

function parseEventPayload(event: RunEventRecord): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(event.payload) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function extractCanonicalRunReply(events: RunEventRecord[]): CanonicalRunReply | null {
  for (const event of [...events].reverse()) {
    if (event.type !== 'completed') continue;
    const payload = parseEventPayload(event);
    if (!payload) continue;
    const output = payload.output;
    if (typeof output === 'string' && output.trim().length > 0) {
      return {
        source: 'completed_output',
        text: output,
      };
    }
  }

  for (const event of [...events].reverse()) {
    if (event.type !== 'message') continue;
    const payload = parseEventPayload(event);
    if (!payload) continue;
    if (payload.role === 'assistant' && typeof payload.text === 'string' && payload.text.trim().length > 0) {
      return {
        source: 'assistant_message',
        text: payload.text,
      };
    }
  }

  return null;
}

export function extractCanonicalRunReplyText(events: RunEventRecord[]): string | null {
  return extractCanonicalRunReply(events)?.text ?? null;
}

export function buildCanonicalRunReply(
  events: RunEventRecord[],
  receipt: ReceiptRecord | null,
  buildReceiptFallback: (receipt: ReceiptRecord) => string,
): CanonicalRunReply | null {
  const eventReply = extractCanonicalRunReply(events);
  if (eventReply) {
    return eventReply;
  }
  if (!receipt) {
    return null;
  }
  return {
    source: 'receipt_fallback',
    text: buildReceiptFallback(receipt),
  };
}

export function buildCanonicalRunReplyText(
  events: RunEventRecord[],
  receipt: ReceiptRecord | null,
  buildReceiptFallback: (receipt: ReceiptRecord) => string,
): string | null {
  return buildCanonicalRunReply(events, receipt, buildReceiptFallback)?.text ?? null;
}
