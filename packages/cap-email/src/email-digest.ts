import type { CapabilityContext, EmailAccountRecord, EmailDigestRecord } from '@popeye/contracts';
import { nowIso } from '@popeye/contracts';

import type { EmailService } from './email-service.js';

const STALE_FOLLOWUP_HOURS = 48;

export class EmailDigestService {
  constructor(
    private readonly emailService: EmailService,
    private readonly ctx: CapabilityContext,
  ) {}

  generateDigest(account: EmailAccountRecord, date?: string, workspaceId = 'default'): EmailDigestRecord {
    const targetDate = date ?? nowIso().slice(0, 10); // YYYY-MM-DD

    // Unread count
    const unreadCount = this.emailService.getUnreadCount(account.id);

    // High-signal threads: starred, or high message count with recent activity
    const starredThreads = this.emailService.listHighSignalThreads(account.id);
    const highSignalCount = starredThreads.length;

    // Stale follow-ups: threads where user was last sender, no reply in 48h+
    const staleFollowups = this.findStaleFollowups(account);

    // Build markdown summary
    const sections: string[] = [];
    sections.push(`# Email Digest — ${targetDate}`);
    sections.push(`**Account:** ${account.id}`);
    sections.push('');
    sections.push(`## Summary`);
    sections.push(`- **Unread:** ${unreadCount}`);
    sections.push(`- **High-signal threads:** ${highSignalCount}`);
    sections.push(`- **Stale follow-ups:** ${staleFollowups.length}`);

    if (starredThreads.length > 0) {
      sections.push('');
      sections.push('## High-Signal Threads');
      for (const t of starredThreads.slice(0, 10)) {
        const flags = [
          t.isStarred ? 'starred' : '',
          t.isUnread ? 'unread' : '',
          t.messageCount >= 5 ? `${t.messageCount} msgs` : '',
        ].filter(Boolean).join(', ');
        sections.push(`- **${t.subject}** (${flags})`);
      }
    }

    if (staleFollowups.length > 0) {
      sections.push('');
      sections.push('## Stale Follow-ups');
      for (const item of staleFollowups.slice(0, 10)) {
        sections.push(`- **${item.subject}** — last sent ${item.daysSince}d ago`);
      }
    }

    const summaryMarkdown = sections.join('\n');

    // Store digest
    const digest = this.emailService.insertDigest({
      accountId: account.id,
      workspaceId,
      date: targetDate,
      unreadCount,
      highSignalCount,
      summaryMarkdown,
    });

    // Store digest summary in memory as episodic
    this.ctx.memoryInsert({
      description: `Email digest for account ${account.id} on ${targetDate}: ${unreadCount} unread, ${highSignalCount} high-signal`,
      classification: 'internal',
      sourceType: 'capability_sync',
      content: summaryMarkdown,
      confidence: 0.7,
      scope: 'workspace',
      memoryType: 'episodic',
      sourceRef: `email:${account.id}:digest:${targetDate}`,
      sourceRefType: 'email_digest',
      domain: 'email',
      contextReleasePolicy: 'summary',
      dedupKey: `email-digest:${account.id}:${targetDate}`,
    });

    this.ctx.auditCallback({
      eventType: 'email_digest_generated',
      details: { accountId: account.id, date: targetDate, unreadCount, highSignalCount },
      severity: 'info',
    });

    return digest;
  }

  private findStaleFollowups(account: EmailAccountRecord): Array<{ subject: string; daysSince: number }> {
    const cutoff = new Date(Date.now() - STALE_FOLLOWUP_HOURS * 3600_000).toISOString();
    const results: Array<{ subject: string; daysSince: number }> = [];

    // Get recent threads
    const threads = this.emailService.listThreads(account.id, { limit: 100 });

    for (const thread of threads) {
      const messages = this.emailService.listMessages(thread.id);
      if (messages.length === 0) continue;

      const lastMessage = messages[messages.length - 1]!;

      // Check if user was the last sender (from address matches account)
      const isUserLastSender = lastMessage.from.toLowerCase().includes(account.emailAddress.toLowerCase());
      if (!isUserLastSender) continue;

      // Check if the last message is older than the cutoff
      if (lastMessage.receivedAt < cutoff) {
        const daysSince = Math.floor(
          (Date.now() - new Date(lastMessage.receivedAt).getTime()) / (24 * 3600_000),
        );
        results.push({ subject: thread.subject, daysSince });
      }
    }

    return results;
  }
}
