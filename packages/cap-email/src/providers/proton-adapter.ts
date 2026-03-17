/**
 * Email adapter for Proton Mail via Proton Bridge IMAP.
 *
 * Prerequisites:
 * - Proton Mail Bridge running on localhost
 * - Bridge-generated IMAP password (NOT the Proton account password)
 *
 * Bridge exposes IMAP on 127.0.0.1:1143 (STARTTLS).
 * All encryption/decryption is handled internally by Bridge.
 *
 * Performance design:
 * - listThreads fetches envelopes only (no body download)
 * - getThread uses a cached thread map from the last listThreads call
 * - getMessage is the only method that downloads the full RFC822 source
 * - Connection is reused within a single withConnection session
 */

import { createHash } from 'node:crypto';

import { ImapFlow, type FetchMessageObject } from 'imapflow';

import type {
  EmailProviderAdapter,
  NormalizedThread,
  NormalizedMessage,
  ThreadListPage,
} from './adapter-interface.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 1143;
const DEFAULT_MAX_MESSAGES = 500;
const BODY_PREVIEW_MAX_CHARS = 500;

export interface ProtonBridgeAdapterConfig {
  /** Proton email address. */
  username: string;
  /** Bridge-generated IMAP password. */
  password: string;
  /** Bridge IMAP host. Defaults to 127.0.0.1. */
  host?: string | undefined;
  /** Bridge IMAP port. Defaults to 1143. */
  port?: number | undefined;
  /** Use implicit TLS. Defaults to false (STARTTLS). */
  tls?: boolean | undefined;
  /** Maximum messages to fetch per sync. Defaults to 500. */
  maxMessages?: number | undefined;
}

/** Internal representation of a fetched message envelope (no body). */
interface InternalMessage {
  uid: number;
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  date: string;
  messageId: string;
  flags: Set<string>;
  size: number;
  references: string[];
  bodyPreview: string;
}

export class ProtonBridgeAdapter implements EmailProviderAdapter {
  private readonly host: string;
  private readonly port: number;
  private readonly tls: boolean;
  private readonly maxMessages: number;
  private readonly username: string;
  private readonly password: string;

  /** Cached thread map from the last listThreads call. Avoids re-fetching all messages for getThread. */
  private threadCache: Map<string, NormalizedThread> | null = null;
  /** UIDs grouped by thread ID — used for targeted body fetching in getThread. */
  private threadUidCache: Map<string, number[]> | null = null;

  constructor(config: ProtonBridgeAdapterConfig) {
    this.username = config.username;
    this.password = config.password;
    this.host = config.host ?? DEFAULT_HOST;
    this.port = config.port ?? DEFAULT_PORT;
    this.tls = config.tls ?? false;
    this.maxMessages = config.maxMessages ?? DEFAULT_MAX_MESSAGES;
  }

  async getProfile(): Promise<{ emailAddress: string; historyId?: string }> {
    return { emailAddress: this.username };
  }

  async listThreads(options?: {
    maxResults?: number | undefined;
    pageToken?: string | undefined;
  }): Promise<ThreadListPage> {
    const maxResults = options?.maxResults ?? 50;
    const startUid = options?.pageToken ? parseInt(options.pageToken, 10) : undefined;

    return this.withConnection(async (client) => {
      const lock = await client.getMailboxLock('INBOX');
      try {
        // Lightweight fetch — envelopes only, no body download
        const messages = await this.fetchEnvelopes(client, maxResults, startUid);
        const { threads: threadMap, uidMap } = this.groupIntoThreads(messages);

        // Cache for getThread lookups
        this.threadCache = threadMap;
        this.threadUidCache = uidMap;

        const threads = [...threadMap.values()].sort(
          (a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt),
        );

        // Determine next page token from the oldest UID
        let nextPageToken: string | undefined;
        if (messages.length >= maxResults) {
          const minUid = Math.min(...messages.map((m) => m.uid));
          if (minUid > 1) {
            nextPageToken = String(minUid - 1);
          }
        }

        return { threads, nextPageToken };
      } finally {
        lock.release();
      }
    });
  }

  async getThread(threadId: string): Promise<NormalizedThread> {
    // Try cache first (populated by listThreads during sync)
    if (this.threadCache?.has(threadId)) {
      return this.threadCache.get(threadId)!;
    }

    // Cache miss — fetch only the UIDs for this thread if we have them,
    // otherwise fall back to a targeted envelope scan
    return this.withConnection(async (client) => {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const cachedUids = this.threadUidCache?.get(threadId);
        if (cachedUids?.length) {
          // Targeted fetch — only the UIDs in this thread, with source for body preview
          const messages = await this.fetchByUids(client, cachedUids, true);
          const { threads } = this.groupIntoThreads(messages);
          const thread = threads.get(threadId);
          if (thread) return thread;
        }

        // Full fallback — envelope scan (still no source download)
        const messages = await this.fetchEnvelopes(client, this.maxMessages);
        const { threads } = this.groupIntoThreads(messages);
        const thread = threads.get(threadId);
        if (!thread) throw new Error(`Thread ${threadId} not found`);
        return thread;
      } finally {
        lock.release();
      }
    });
  }

  async getMessage(messageId: string): Promise<NormalizedMessage> {
    const uid = parseInt(messageId, 10);
    return this.withConnection(async (client) => {
      const lock = await client.getMailboxLock('INBOX');
      try {
        // Single message — fetch with source for full body preview
        const msg = await this.fetchSingleMessage(client, uid);
        if (!msg) throw new Error(`Message UID ${uid} not found`);
        return this.toNormalizedMessage(msg, 'unknown');
      } finally {
        lock.release();
      }
    });
  }

  // listHistory not implemented — IMAP has no equivalent.
  // EmailSyncService falls back to full sync when this is absent.

  // --- Internal helpers ---

  private async withConnection<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = new ImapFlow({
      host: this.host,
      port: this.port,
      secure: this.tls,
      auth: {
        user: this.username,
        pass: this.password,
      },
      logger: false,
    });

    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.logout();
    }
  }

  /**
   * Fetch message envelopes (metadata only — no body download).
   * Used for listThreads where we need threading info but not content.
   */
  private async fetchEnvelopes(client: ImapFlow, limit: number, beforeUid?: number): Promise<InternalMessage[]> {
    const range = beforeUid ? `1:${beforeUid}` : '1:*';
    const messages: InternalMessage[] = [];

    for await (const msg of client.fetch(range, {
      envelope: true,
      flags: true,
      size: true,
      headers: ['references', 'in-reply-to'],
      // No source: true — lightweight envelope-only fetch
    }, { uid: true })) {
      messages.push(this.convertFetchedMessage(msg));
      if (messages.length >= limit) break;
    }

    // Sort by UID descending (newest first)
    messages.sort((a, b) => b.uid - a.uid);
    return messages.slice(0, limit);
  }

  /**
   * Fetch specific messages by UID set, optionally with source.
   * Used for targeted getThread when we know which UIDs belong to a thread.
   */
  private async fetchByUids(client: ImapFlow, uids: number[], includeSource: boolean): Promise<InternalMessage[]> {
    const range = uids.join(',');
    const messages: InternalMessage[] = [];

    for await (const msg of client.fetch(range, {
      envelope: true,
      flags: true,
      size: true,
      headers: ['references', 'in-reply-to'],
      ...(includeSource ? { source: true } : {}),
    }, { uid: true })) {
      messages.push(this.convertFetchedMessage(msg));
    }

    return messages;
  }

  /** Fetch a single message with full source for body preview. */
  private async fetchSingleMessage(client: ImapFlow, uid: number): Promise<InternalMessage | null> {
    for await (const msg of client.fetch(String(uid), {
      envelope: true,
      flags: true,
      size: true,
      source: true,
      headers: ['references', 'in-reply-to'],
    }, { uid: true })) {
      return this.convertFetchedMessage(msg);
    }
    return null;
  }

  private convertFetchedMessage(msg: FetchMessageObject): InternalMessage {
    const envelope = msg.envelope;
    const flags = msg.flags ?? new Set<string>();
    const size = msg.size ?? 0;

    const refs = msg.headers ? parseReferencesFromBuffer(msg.headers) : [];

    // Body preview only available when source was fetched
    let bodyPreview = '';
    if (msg.source) {
      bodyPreview = extractTextFromSource(msg.source);
    }

    const from = envelope
      ? formatAddress(envelope.from)
      : '';
    const to = envelope?.to
      ? envelope.to.map((a) => a.name ? `${a.name} <${a.address ?? ''}>` : (a.address ?? '')).filter(Boolean)
      : [];
    const cc = envelope?.cc
      ? envelope.cc.map((a) => a.name ? `${a.name} <${a.address ?? ''}>` : (a.address ?? '')).filter(Boolean)
      : [];

    return {
      uid: msg.uid,
      subject: envelope?.subject ?? '',
      from,
      to,
      cc,
      date: envelope?.date ? envelope.date.toISOString() : new Date().toISOString(),
      messageId: envelope?.messageId ?? `uid:${msg.uid}`,
      flags,
      size,
      references: refs,
      bodyPreview,
    };
  }

  private groupIntoThreads(messages: InternalMessage[]): { threads: Map<string, NormalizedThread>; uidMap: Map<string, number[]> } {
    const threadGroups = new Map<string, InternalMessage[]>();

    for (const msg of messages) {
      const rootId = msg.references.length > 0 ? msg.references[0]! : msg.messageId;
      const group = threadGroups.get(rootId) ?? [];
      group.push(msg);
      threadGroups.set(rootId, group);
    }

    const threads = new Map<string, NormalizedThread>();
    const uidMap = new Map<string, number[]>();

    for (const [rootId, group] of threadGroups) {
      const threadId = hashThreadId(rootId);
      const normalized = group.map((m) => this.toNormalizedMessage(m, threadId));
      normalized.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));

      // Track UIDs per thread for targeted fetching
      uidMap.set(threadId, group.map((m) => m.uid));

      const allLabels = new Set<string>();
      let isUnread = false;
      let isStarred = false;
      let lastMessageAt = '';

      for (const nm of normalized) {
        for (const label of nm.labelIds) allLabels.add(label);
        if (nm.labelIds.includes('UNREAD')) isUnread = true;
        if (nm.labelIds.includes('STARRED')) isStarred = true;
        if (nm.receivedAt > lastMessageAt) lastMessageAt = nm.receivedAt;
      }

      threads.set(threadId, {
        threadId,
        subject: normalized[0]?.subject ?? '',
        snippet: normalized[normalized.length - 1]?.snippet ?? '',
        lastMessageAt: lastMessageAt || new Date().toISOString(),
        messageCount: normalized.length,
        labelIds: [...allLabels],
        isUnread,
        isStarred,
        messages: normalized,
      });
    }

    return { threads, uidMap };
  }

  private toNormalizedMessage(msg: InternalMessage, threadId: string): NormalizedMessage {
    const labelIds: string[] = ['INBOX'];
    if (!msg.flags.has('\\Seen')) labelIds.push('UNREAD');
    if (msg.flags.has('\\Flagged')) labelIds.push('STARRED');
    if (msg.flags.has('\\Draft')) labelIds.push('DRAFT');

    return {
      messageId: String(msg.uid),
      threadId,
      from: msg.from,
      to: msg.to,
      cc: msg.cc,
      subject: msg.subject,
      snippet: msg.bodyPreview || msg.subject.slice(0, 200),
      bodyPreview: msg.bodyPreview,
      receivedAt: msg.date,
      sizeEstimate: msg.size,
      labelIds,
    };
  }
}

// --- Helpers ---

function formatAddress(addrs: Array<{ name?: string; address?: string }> | undefined): string {
  if (!addrs?.length) return '';
  const first = addrs[0]!;
  return first.name ? `${first.name} <${first.address ?? ''}>` : (first.address ?? '');
}

function hashThreadId(rootMessageId: string): string {
  return createHash('sha256').update(rootMessageId).digest('hex').slice(0, 24);
}

function parseReferencesFromBuffer(headersBuf: Buffer): string[] {
  const text = headersBuf.toString('utf-8');
  const refs: string[] = [];
  let current = '';

  // Handle folded headers: continuation lines start with whitespace
  for (const line of text.split(/\r?\n/)) {
    if (/^\s/.test(line) && current) {
      // Continuation of previous header
      current += ' ' + line.trim();
    } else {
      if (current) processHeaderLine(current, refs);
      current = line;
    }
  }
  if (current) processHeaderLine(current, refs);

  return refs;
}

function processHeaderLine(line: string, refs: string[]): void {
  const lower = line.toLowerCase();
  if (lower.startsWith('references:') || lower.startsWith('in-reply-to:')) {
    const value = line.slice(line.indexOf(':') + 1).trim();
    for (const token of value.split(/\s+/)) {
      if (token && !refs.includes(token)) refs.push(token);
    }
  }
}

function extractTextFromSource(source: Buffer): string {
  const text = source.toString('utf-8');
  const bodyStart = text.indexOf('\r\n\r\n');
  if (bodyStart === -1) return '';
  const body = text.slice(bodyStart + 4);
  const cleaned = body
    .replace(/<[^>]+>/g, ' ')
    .replace(/=\r?\n/g, '')
    .replace(/=[0-9A-F]{2}/gi, (m) => String.fromCharCode(parseInt(m.slice(1), 16)))
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, BODY_PREVIEW_MAX_CHARS);
}
