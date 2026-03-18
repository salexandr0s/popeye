import type { CapabilityContext, EmailAccountRecord, EmailSyncResult } from '@popeye/contracts';
import { extractRedactionPatterns, redactText } from '@popeye/observability';

import type { EmailProviderAdapter, NormalizedThread } from './providers/adapter-interface.js';
import type { EmailService } from './email-service.js';

const DEFAULT_MAX_THREADS_PER_SYNC = 500;
const DEFAULT_THREADS_PER_PAGE = 50;

export class EmailSyncService {
  private readonly redactionPatterns: string[];

  constructor(
    private readonly emailService: EmailService,
    private readonly ctx: CapabilityContext,
  ) {
    this.redactionPatterns = extractRedactionPatterns(ctx.config);
  }

  async syncAccount(account: EmailAccountRecord, adapter: EmailProviderAdapter): Promise<EmailSyncResult> {
    const result: EmailSyncResult = { accountId: account.id, synced: 0, updated: 0, errors: [] };

    try {
      // Attempt incremental sync if we have a history ID
      if (account.syncCursorHistoryId && adapter.listHistory) {
        try {
          const historyResult = await this.incrementalSync(account, adapter);
          result.synced = historyResult.synced;
          result.updated = historyResult.updated;
          result.errors = historyResult.errors;

          this.ctx.auditCallback({
            eventType: 'email_sync_completed',
            details: { accountId: account.id, mode: 'incremental', synced: result.synced, updated: result.updated },
            severity: 'info',
          });

          return result;
        } catch (err) {
          // History ID may be expired — fall back to full sync
          this.ctx.log.warn('Incremental sync failed, falling back to full sync', {
            accountId: account.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Full sync
      const fullResult = await this.fullSync(account, adapter);
      result.synced = fullResult.synced;
      result.updated = fullResult.updated;
      result.errors = fullResult.errors;

      this.ctx.auditCallback({
        eventType: 'email_sync_completed',
        details: { accountId: account.id, mode: 'full', synced: result.synced, updated: result.updated },
        severity: 'info',
      });

      // Derive sender importance memories after sync
      this.deriveSenderMemories(account);

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(message);
      this.ctx.log.error('Email sync failed', { accountId: account.id, error: message });
      this.ctx.auditCallback({
        eventType: 'email_sync_failed',
        details: { accountId: account.id, error: message },
        severity: 'error',
      });
    }

    return result;
  }

  private async incrementalSync(account: EmailAccountRecord, adapter: EmailProviderAdapter): Promise<EmailSyncResult> {
    const result: EmailSyncResult = { accountId: account.id, synced: 0, updated: 0, errors: [] };

    if (!adapter.listHistory) {
      throw new Error('Adapter does not support incremental sync');
    }

    const historyChange = await adapter.listHistory(account.syncCursorHistoryId!);

    // Fetch and store updated threads
    for (const threadId of historyChange.changedThreadIds) {
      try {
        const thread = await adapter.getThread(threadId);
        this.storeThread(account.id, thread);
        result.updated++;
      } catch (err) {
        result.errors.push(`Thread ${threadId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Update cursor with new history ID
    this.emailService.updateSyncCursor(account.id, null, historyChange.newHistoryId);
    this.emailService.updateMessageCount(account.id);

    return result;
  }

  async fullSync(account: EmailAccountRecord, adapter: EmailProviderAdapter): Promise<EmailSyncResult> {
    const result: EmailSyncResult = { accountId: account.id, synced: 0, updated: 0, errors: [] };
    let pageToken: string | undefined;
    let totalFetched = 0;

    do {
      const page = await adapter.listThreads({
        maxResults: DEFAULT_THREADS_PER_PAGE,
        pageToken,
      });

      for (const thread of page.threads) {
        try {
          const existing = this.emailService.getThreadByGmailId(account.id, thread.threadId);
          this.storeThread(account.id, thread);
          if (existing) {
            result.updated++;
          } else {
            result.synced++;
          }
        } catch (err) {
          result.errors.push(`Thread ${thread.threadId}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      totalFetched += page.threads.length;
      pageToken = page.nextPageToken;

      // Update cursor after each page
      if (pageToken) {
        this.emailService.updateSyncCursor(account.id, pageToken, account.syncCursorHistoryId);
      }
    } while (pageToken && totalFetched < DEFAULT_MAX_THREADS_PER_SYNC);

    // Get current history ID from profile for future incremental sync
    const profile = await adapter.getProfile();
    this.emailService.updateSyncCursor(account.id, null, profile.historyId ?? null);
    this.emailService.updateMessageCount(account.id);

    return result;
  }

  private storeThread(accountId: string, thread: NormalizedThread): void {
    // Upsert thread
    const storedThread = this.emailService.upsertThread(accountId, {
      gmailThreadId: thread.threadId,
      subject: this.redact(thread.subject),
      snippet: this.redact(thread.snippet),
      lastMessageAt: thread.lastMessageAt,
      messageCount: thread.messageCount,
      labelIds: thread.labelIds,
      isUnread: thread.isUnread,
      isStarred: thread.isStarred,
    });

    // Upsert messages
    for (const msg of thread.messages) {
      this.emailService.upsertMessage(accountId, storedThread.id, {
        gmailMessageId: msg.messageId,
        from: msg.from,
        to: msg.to,
        cc: msg.cc,
        subject: this.redact(msg.subject),
        snippet: this.redact(msg.snippet),
        bodyPreview: this.redact(msg.bodyPreview),
        receivedAt: msg.receivedAt,
        sizeEstimate: msg.sizeEstimate,
        labelIds: msg.labelIds,
      });
    }
  }

  private deriveSenderMemories(account: EmailAccountRecord): void {
    const topSenders = this.emailService.getTopSenders(account.id);

    for (const sender of topSenders) {
      if (sender.count >= 3) {
        this.ctx.memoryInsert({
          description: `Frequent email sender (${sender.count} messages)`,
          classification: 'internal',
          sourceType: 'capability_sync',
          content: `Frequent sender with ${sender.count} messages to account ${account.id}`,
          confidence: Math.min(0.6 + sender.count * 0.02, 0.9),
          scope: 'workspace',
          memoryType: 'semantic',
          sourceRef: `email:${account.id}:sender:${sender.fromAddress}`,
          sourceRefType: 'email_sender',
          domain: 'email',
          contextReleasePolicy: 'summary',
          dedupKey: `email-sender:${account.id}:${sender.fromAddress}`,
        });
      }
    }
  }

  private redact(text: string): string {
    return redactText(text, this.redactionPatterns).text;
  }
}
