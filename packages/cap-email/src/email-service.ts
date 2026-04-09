import { randomUUID } from 'node:crypto';

import type {
  EmailAccountRecord,
  EmailAccountRegistrationInput,
  EmailDraftRecord,
  EmailThreadRecord,
  EmailMessageRecord,
  EmailDigestRecord,
} from '@popeye/contracts';
import { nowIso } from '@popeye/contracts';

import type { EmailCapabilityDb, EmailAccountRow, EmailThreadRow, EmailMessageRow, EmailDigestRow, EmailDraftRow } from './types.js';
import { prepareGet, prepareAll, prepareRun } from './types.js';

// --- Row mappers ---

function parseJsonArray(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function mapAccountRow(row: EmailAccountRow): EmailAccountRecord {
  return {
    id: row.id,
    connectionId: row.connection_id,
    emailAddress: row.email_address,
    displayName: row.display_name,
    syncCursorPageToken: row.sync_cursor_page_token,
    syncCursorHistoryId: row.sync_cursor_history_id,
    lastSyncAt: row.last_sync_at,
    messageCount: row.message_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const VALID_IMPORTANCE = new Set(['low', 'normal', 'high', 'critical']);

function mapThreadRow(row: EmailThreadRow): EmailThreadRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    gmailThreadId: row.gmail_thread_id,
    subject: row.subject,
    snippet: row.snippet,
    lastMessageAt: row.last_message_at,
    messageCount: row.message_count,
    labelIds: parseJsonArray(row.label_ids),
    isUnread: row.is_unread === 1,
    isStarred: row.is_starred === 1,
    importance: VALID_IMPORTANCE.has(row.importance) ? row.importance as EmailThreadRecord['importance'] : 'normal',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessageRow(row: EmailMessageRow): EmailMessageRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    accountId: row.account_id,
    gmailMessageId: row.gmail_message_id,
    from: row.from_address,
    to: parseJsonArray(row.to_addresses),
    cc: parseJsonArray(row.cc_addresses),
    subject: row.subject,
    snippet: row.snippet,
    bodyPreview: row.body_preview,
    receivedAt: row.received_at,
    sizeEstimate: row.size_estimate,
    labelIds: parseJsonArray(row.label_ids),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDigestRow(row: EmailDigestRow): EmailDigestRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    workspaceId: row.workspace_id,
    date: row.date,
    unreadCount: row.unread_count,
    highSignalCount: row.high_signal_count,
    summaryMarkdown: row.summary_markdown,
    generatedAt: row.generated_at,
  };
}

function mapDraftRow(row: EmailDraftRow): EmailDraftRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    connectionId: row.connection_id,
    providerDraftId: row.provider_draft_id,
    providerMessageId: row.provider_message_id,
    to: parseJsonArray(row.to_addresses),
    cc: parseJsonArray(row.cc_addresses),
    subject: row.subject,
    bodyPreview: row.body_preview,
    updatedAt: row.updated_at,
  };
}

// --- Service ---

export class EmailService {
  constructor(private readonly db: EmailCapabilityDb) {}

  registerAccount(input: EmailAccountRegistrationInput): EmailAccountRecord {
    const id = randomUUID();
    const now = nowIso();

    prepareRun(this.db,
      `INSERT INTO email_accounts (id, connection_id, email_address, display_name, message_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )(id, input.connectionId, input.emailAddress, input.displayName, now, now);

    const result = this.getAccount(id);
    if (!result) throw new Error('Failed to register email account');
    return result;
  }

  getAccount(id: string): EmailAccountRecord | null {
    const row = prepareGet<EmailAccountRow>(this.db, 'SELECT * FROM email_accounts WHERE id = ?')(id);
    return row ? mapAccountRow(row) : null;
  }

  getAccountByConnection(connectionId: string): EmailAccountRecord | null {
    const row = prepareGet<EmailAccountRow>(this.db, 'SELECT * FROM email_accounts WHERE connection_id = ?')(connectionId);
    return row ? mapAccountRow(row) : null;
  }

  listAccounts(): EmailAccountRecord[] {
    const rows = prepareAll<EmailAccountRow>(this.db, 'SELECT * FROM email_accounts ORDER BY email_address')();
    return rows.map(mapAccountRow);
  }

  updateSyncCursor(accountId: string, pageToken: string | null, historyId: string | null): void {
    const now = nowIso();
    prepareRun(this.db,
      `UPDATE email_accounts SET sync_cursor_page_token = ?, sync_cursor_history_id = ?, last_sync_at = ?, updated_at = ? WHERE id = ?`,
    )(pageToken, historyId, now, now, accountId);
  }

  updateMessageCount(accountId: string): void {
    const now = nowIso();
    const result = prepareGet<{ cnt: number }>(this.db, 'SELECT COUNT(*) as cnt FROM email_messages WHERE account_id = ?')(accountId);
    const count = result?.cnt ?? 0;
    prepareRun(this.db, 'UPDATE email_accounts SET message_count = ?, updated_at = ? WHERE id = ?')(count, now, accountId);
  }

  // --- Threads ---

  getThread(id: string): EmailThreadRecord | null {
    const row = prepareGet<EmailThreadRow>(this.db, 'SELECT * FROM email_threads WHERE id = ?')(id);
    return row ? mapThreadRow(row) : null;
  }

  getThreadByGmailId(accountId: string, gmailThreadId: string): EmailThreadRecord | null {
    const row = prepareGet<EmailThreadRow>(this.db,
      'SELECT * FROM email_threads WHERE account_id = ? AND gmail_thread_id = ?',
    )(accountId, gmailThreadId);
    return row ? mapThreadRow(row) : null;
  }

  listThreads(accountId: string, options: {
    limit?: number | undefined;
    offset?: number | undefined;
    unreadOnly?: boolean | undefined;
    labelFilter?: string[] | undefined;
  } = {}): EmailThreadRecord[] {
    const clauses = ['account_id = ?'];
    const params: unknown[] = [accountId];

    if (options.unreadOnly) {
      clauses.push('is_unread = 1');
    }

    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    const rows = prepareAll<EmailThreadRow>(this.db,
      `SELECT * FROM email_threads WHERE ${clauses.join(' AND ')} ORDER BY last_message_at DESC LIMIT ? OFFSET ?`,
    )(...params, limit, offset);

    let threads = rows.map(mapThreadRow);

    if (options.labelFilter?.length) {
      threads = threads.filter((t) =>
        options.labelFilter!.some((label) => t.labelIds.includes(label)),
      );
    }

    return threads;
  }

  /** List threads with high signal: starred or high message count. */
  listHighSignalThreads(accountId: string, limit = 100): EmailThreadRecord[] {
    const rows = prepareAll<EmailThreadRow>(this.db,
      `SELECT * FROM email_threads WHERE account_id = ? AND (is_starred = 1 OR message_count >= 5)
       ORDER BY last_message_at DESC LIMIT ?`,
    )(accountId, limit);
    return rows.map(mapThreadRow);
  }

  upsertThread(accountId: string, data: {
    gmailThreadId: string;
    subject: string;
    snippet: string;
    lastMessageAt: string;
    messageCount: number;
    labelIds: string[];
    isUnread: boolean;
    isStarred: boolean;
  }): EmailThreadRecord {
    const now = nowIso();
    const existing = this.getThreadByGmailId(accountId, data.gmailThreadId);

    if (existing) {
      prepareRun(this.db,
        `UPDATE email_threads SET subject = ?, snippet = ?, last_message_at = ?, message_count = ?,
         label_ids = ?, is_unread = ?, is_starred = ?, updated_at = ? WHERE id = ?`,
      )(
        data.subject, data.snippet, data.lastMessageAt, data.messageCount,
        JSON.stringify(data.labelIds), data.isUnread ? 1 : 0, data.isStarred ? 1 : 0,
        now, existing.id,
      );
      return this.getThread(existing.id)!;
    }

    const id = randomUUID();
    prepareRun(this.db,
      `INSERT INTO email_threads (id, account_id, gmail_thread_id, subject, snippet, last_message_at,
       message_count, label_ids, is_unread, is_starred, importance, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'normal', ?, ?)`,
    )(
      id, accountId, data.gmailThreadId, data.subject, data.snippet, data.lastMessageAt,
      data.messageCount, JSON.stringify(data.labelIds), data.isUnread ? 1 : 0,
      data.isStarred ? 1 : 0, now, now,
    );
    return this.getThread(id)!;
  }

  // --- Messages ---

  getMessage(id: string): EmailMessageRecord | null {
    const row = prepareGet<EmailMessageRow>(this.db, 'SELECT * FROM email_messages WHERE id = ?')(id);
    return row ? mapMessageRow(row) : null;
  }

  getMessageByGmailId(accountId: string, gmailMessageId: string): EmailMessageRecord | null {
    const row = prepareGet<EmailMessageRow>(this.db,
      'SELECT * FROM email_messages WHERE account_id = ? AND gmail_message_id = ?',
    )(accountId, gmailMessageId);
    return row ? mapMessageRow(row) : null;
  }

  listMessages(threadId: string): EmailMessageRecord[] {
    const rows = prepareAll<EmailMessageRow>(this.db,
      'SELECT * FROM email_messages WHERE thread_id = ? ORDER BY received_at ASC',
    )(threadId);
    return rows.map(mapMessageRow);
  }

  upsertMessage(accountId: string, threadId: string, data: {
    gmailMessageId: string;
    from: string;
    to: string[];
    cc: string[];
    subject: string;
    snippet: string;
    bodyPreview: string;
    receivedAt: string;
    sizeEstimate: number;
    labelIds: string[];
  }): EmailMessageRecord {
    const now = nowIso();
    const existing = this.getMessageByGmailId(accountId, data.gmailMessageId);

    if (existing) {
      prepareRun(this.db,
        `UPDATE email_messages SET from_address = ?, to_addresses = ?, cc_addresses = ?, subject = ?,
         snippet = ?, body_preview = ?, label_ids = ?, updated_at = ? WHERE id = ?`,
      )(
        data.from, JSON.stringify(data.to), JSON.stringify(data.cc), data.subject,
        data.snippet, data.bodyPreview, JSON.stringify(data.labelIds), now, existing.id,
      );
      return this.getMessage(existing.id)!;
    }

    const id = randomUUID();
    prepareRun(this.db,
      `INSERT INTO email_messages (id, thread_id, account_id, gmail_message_id, from_address,
       to_addresses, cc_addresses, subject, snippet, body_preview, received_at, size_estimate,
       label_ids, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )(
      id, threadId, accountId, data.gmailMessageId, data.from,
      JSON.stringify(data.to), JSON.stringify(data.cc), data.subject,
      data.snippet, data.bodyPreview, data.receivedAt, data.sizeEstimate,
      JSON.stringify(data.labelIds), now, now,
    );
    return this.getMessage(id)!;
  }

  // --- Digests ---

  getDigest(id: string): EmailDigestRecord | null {
    const row = prepareGet<EmailDigestRow>(this.db, 'SELECT * FROM email_digests WHERE id = ?')(id);
    return row ? mapDigestRow(row) : null;
  }

  // --- Drafts ---

  getDraft(id: string): EmailDraftRecord | null {
    const row = prepareGet<EmailDraftRow>(this.db, 'SELECT * FROM email_drafts WHERE id = ?')(id);
    return row ? mapDraftRow(row) : null;
  }

  getDraftByProviderDraftId(providerDraftId: string): EmailDraftRecord | null {
    const row = prepareGet<EmailDraftRow>(this.db, 'SELECT * FROM email_drafts WHERE provider_draft_id = ?')(providerDraftId);
    return row ? mapDraftRow(row) : null;
  }

  listDrafts(accountId: string, options: { limit?: number | undefined } = {}): EmailDraftRecord[] {
    const limit = options.limit ?? 20;
    const rows = prepareAll<EmailDraftRow>(this.db,
      'SELECT * FROM email_drafts WHERE account_id = ? ORDER BY updated_at DESC, created_at DESC, provider_draft_id DESC LIMIT ?',
    )(accountId, limit);
    return rows.map(mapDraftRow);
  }

  upsertDraft(input: {
    accountId: string;
    connectionId: string;
    providerDraftId: string;
    providerMessageId: string | null;
    to: string[];
    cc: string[];
    subject: string;
    bodyPreview: string;
  }): EmailDraftRecord {
    const now = nowIso();
    const existing = this.getDraftByProviderDraftId(input.providerDraftId);
    if (existing) {
      prepareRun(this.db,
        `UPDATE email_drafts
         SET account_id = ?, connection_id = ?, provider_message_id = ?, to_addresses = ?, cc_addresses = ?,
             subject = ?, body_preview = ?, updated_at = ?
         WHERE id = ?`,
      )(
        input.accountId,
        input.connectionId,
        input.providerMessageId,
        JSON.stringify(input.to),
        JSON.stringify(input.cc),
        input.subject,
        input.bodyPreview,
        now,
        existing.id,
      );
      return this.getDraft(existing.id)!;
    }

    const id = randomUUID();
    prepareRun(this.db,
      `INSERT INTO email_drafts (
         id, account_id, connection_id, provider_draft_id, provider_message_id,
         to_addresses, cc_addresses, subject, body_preview, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )(
      id,
      input.accountId,
      input.connectionId,
      input.providerDraftId,
      input.providerMessageId,
      JSON.stringify(input.to),
      JSON.stringify(input.cc),
      input.subject,
      input.bodyPreview,
      now,
      now,
    );
    return this.getDraft(id)!;
  }

  getLatestDigest(accountId: string): EmailDigestRecord | null {
    const row = prepareGet<EmailDigestRow>(this.db,
      'SELECT * FROM email_digests WHERE account_id = ? ORDER BY date DESC LIMIT 1',
    )(accountId);
    return row ? mapDigestRow(row) : null;
  }

  listDigests(accountId: string, options: { limit?: number | undefined } = {}): EmailDigestRecord[] {
    const limit = options.limit ?? 10;
    const rows = prepareAll<EmailDigestRow>(this.db,
      'SELECT * FROM email_digests WHERE account_id = ? ORDER BY date DESC LIMIT ?',
    )(accountId, limit);
    return rows.map(mapDigestRow);
  }

  insertDigest(data: {
    accountId: string;
    workspaceId: string;
    date: string;
    unreadCount: number;
    highSignalCount: number;
    summaryMarkdown: string;
  }): EmailDigestRecord {
    const now = nowIso();

    // Check for existing digest for same account+date
    const existing = prepareGet<EmailDigestRow>(this.db,
      'SELECT * FROM email_digests WHERE account_id = ? AND date = ?',
    )(data.accountId, data.date);

    if (existing) {
      // Update in place — preserves the existing ID
      prepareRun(this.db,
        `UPDATE email_digests SET unread_count = ?, high_signal_count = ?, summary_markdown = ?, generated_at = ?
         WHERE id = ?`,
      )(data.unreadCount, data.highSignalCount, data.summaryMarkdown, now, existing.id);
      return this.getDigest(existing.id)!;
    }

    const id = randomUUID();
    prepareRun(this.db,
      `INSERT INTO email_digests (id, account_id, workspace_id, date, unread_count,
       high_signal_count, summary_markdown, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )(id, data.accountId, data.workspaceId, data.date, data.unreadCount,
      data.highSignalCount, data.summaryMarkdown, now);

    return this.getDigest(id)!;
  }

  // --- Stats ---

  getThreadCount(accountId: string): number {
    const result = prepareGet<{ cnt: number }>(this.db,
      'SELECT COUNT(*) as cnt FROM email_threads WHERE account_id = ?',
    )(accountId);
    return result?.cnt ?? 0;
  }

  getUnreadCount(accountId: string): number {
    const result = prepareGet<{ cnt: number }>(this.db,
      'SELECT COUNT(*) as cnt FROM email_threads WHERE account_id = ? AND is_unread = 1',
    )(accountId);
    return result?.cnt ?? 0;
  }

  /** Top senders by message count — used for memory derivation. */
  getTopSenders(accountId: string, limit = 20): Array<{ fromAddress: string; count: number }> {
    const rows = prepareAll<{ from_address: string; cnt: number }>(this.db,
      `SELECT from_address, COUNT(*) as cnt FROM email_messages
       WHERE account_id = ? GROUP BY from_address ORDER BY cnt DESC LIMIT ?`,
    )(accountId, limit);
    return rows.map((r) => ({ fromAddress: r.from_address, count: r.cnt }));
  }
}
