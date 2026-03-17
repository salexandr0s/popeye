import type { CapabilityContext, CapabilityToolDescriptor } from '@popeye/contracts';
import { redactText } from '@popeye/observability';
import { z } from 'zod';

import type { EmailService } from './email-service.js';
import type { EmailSearchService } from './email-search.js';
import type { EmailDigestService } from './email-digest.js';

function extractRedactionPatterns(config: Record<string, unknown>): string[] {
  if (typeof config !== 'object' || config === null) return [];
  const security = config['security'];
  if (typeof security !== 'object' || security === null) return [];
  const patterns = (security as Record<string, unknown>)['redactionPatterns'];
  if (!Array.isArray(patterns)) return [];
  return patterns.filter((p): p is string => typeof p === 'string');
}

export function createEmailTools(
  emailService: EmailService,
  searchService: EmailSearchService,
  digestService: EmailDigestService,
  ctx: CapabilityContext,
): CapabilityToolDescriptor[] {
  const redactionPatterns = extractRedactionPatterns(ctx.config);

  return [
    {
      name: 'popeye_email_search',
      label: 'Popeye Email Search',
      description: 'Search locally cached email threads by query. Returns thread summaries.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query for email subject/snippet' },
          accountId: { type: 'string', description: 'Optional: restrict to specific email account' },
          limit: { type: 'number', description: 'Maximum results (default 20)' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      execute: async (params) => {
        const parsed = z.object({
          query: z.string().min(1),
          accountId: z.string().optional(),
          limit: z.number().int().positive().max(100).optional(),
        }).parse(params ?? {});

        const response = searchService.search({
          query: parsed.query,
          accountId: parsed.accountId,
          limit: parsed.limit ?? 20,
        });

        if (response.results.length === 0) {
          return { content: [{ type: 'text', text: 'No matching emails found.' }] };
        }

        const lines = response.results.map((r, i) =>
          `${i + 1}. **${r.subject}** — from: ${r.from} (${r.lastMessageAt.slice(0, 10)})`,
        );
        return { content: [{ type: 'text', text: lines.join('\n') }], details: response };
      },
    },
    {
      name: 'popeye_email_digest',
      label: 'Popeye Email Digest',
      description: 'Get the latest email digest or generate one for today. Shows unread summary, high-signal threads, and stale follow-ups.',
      inputSchema: {
        type: 'object',
        properties: {
          accountId: { type: 'string', description: 'Email account ID (uses first account if omitted)' },
          date: { type: 'string', description: 'Date for digest (YYYY-MM-DD, default today)' },
        },
        required: [],
        additionalProperties: false,
      },
      execute: async (params) => {
        const parsed = z.object({
          accountId: z.string().optional(),
          date: z.string().optional(),
        }).parse(params ?? {});

        const accounts = emailService.listAccounts();
        if (accounts.length === 0) {
          return { content: [{ type: 'text', text: 'No email accounts registered.' }] };
        }

        const account = parsed.accountId
          ? emailService.getAccount(parsed.accountId)
          : accounts[0]!;

        if (!account) {
          return { content: [{ type: 'text', text: 'Email account not found.' }] };
        }

        // Check for existing digest first
        if (!parsed.date) {
          const latest = emailService.getLatestDigest(account.id);
          if (latest && latest.date === new Date().toISOString().slice(0, 10)) {
            return { content: [{ type: 'text', text: latest.summaryMarkdown }], details: latest };
          }
        }

        // Generate fresh digest
        const digest = digestService.generateDigest(account, parsed.date);
        return { content: [{ type: 'text', text: digest.summaryMarkdown }], details: digest };
      },
    },
    {
      name: 'popeye_email_thread',
      label: 'Popeye Email Thread',
      description: 'Get thread detail: subject, participants, message summaries. Does NOT return raw message bodies by default.',
      inputSchema: {
        type: 'object',
        properties: {
          threadId: { type: 'string', description: 'Thread ID to retrieve' },
        },
        required: ['threadId'],
        additionalProperties: false,
      },
      execute: async (params) => {
        const parsed = z.object({
          threadId: z.string().min(1),
        }).parse(params ?? {});

        const thread = emailService.getThread(parsed.threadId);
        if (!thread) {
          return { content: [{ type: 'text', text: 'Thread not found.' }] };
        }

        const messages = emailService.listMessages(parsed.threadId);
        const lines: string[] = [];
        lines.push(`**${thread.subject}**`);
        lines.push(`Messages: ${thread.messageCount} | ${thread.isUnread ? 'Unread' : 'Read'} | ${thread.isStarred ? 'Starred' : ''}`);
        lines.push('');

        for (const msg of messages) {
          lines.push(`---`);
          lines.push(`**From:** ${msg.from}`);
          lines.push(`**Date:** ${msg.receivedAt}`);
          if (msg.to.length > 0) lines.push(`**To:** ${msg.to.join(', ')}`);
          lines.push(`**Snippet:** ${msg.snippet}`);
        }

        // Record context release — thread summary level
        ctx.contextReleaseRecord({
          domain: 'email',
          sourceRef: `email:thread:${thread.id}`,
          releaseLevel: 'summary',
          tokenEstimate: Math.ceil(lines.join('\n').length / 4),
        });

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          details: { thread, messageCount: messages.length },
        };
      },
    },
    {
      name: 'popeye_email_message',
      label: 'Popeye Email Message',
      description: 'Get a single message with body preview. Requires context-release recording and applies redaction.',
      inputSchema: {
        type: 'object',
        properties: {
          messageId: { type: 'string', description: 'Message ID to retrieve' },
        },
        required: ['messageId'],
        additionalProperties: false,
      },
      execute: async (params) => {
        const parsed = z.object({
          messageId: z.string().min(1),
        }).parse(params ?? {});

        const message = emailService.getMessage(parsed.messageId);
        if (!message) {
          return { content: [{ type: 'text', text: 'Message not found.' }] };
        }

        // Redact body preview before releasing
        const redactedPreview = redactText(message.bodyPreview, redactionPatterns).text;

        const lines: string[] = [];
        lines.push(`**Subject:** ${message.subject}`);
        lines.push(`**From:** ${message.from}`);
        lines.push(`**Date:** ${message.receivedAt}`);
        if (message.to.length > 0) lines.push(`**To:** ${message.to.join(', ')}`);
        if (message.cc.length > 0) lines.push(`**CC:** ${message.cc.join(', ')}`);
        lines.push('');
        lines.push(redactedPreview.length > 0 ? redactedPreview : redactText(message.snippet, redactionPatterns).text);

        // Record context release — full message content
        ctx.contextReleaseRecord({
          domain: 'email',
          sourceRef: `email:message:${message.id}`,
          releaseLevel: 'excerpt',
          tokenEstimate: Math.ceil(lines.join('\n').length / 4),
          redacted: true,
        });

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          details: { messageId: message.id, threadId: message.threadId },
        };
      },
    },
  ];
}
