import type { CapabilityContext, CapabilityToolDescriptor } from '@popeye/contracts';
import { z } from 'zod';

import type { CalendarService } from './calendar-service.js';
import type { CalendarSearchService } from './calendar-search.js';
import type { CalendarDigestService } from './calendar-digest.js';

export function createCalendarTools(
  calendarService: CalendarService,
  searchService: CalendarSearchService,
  digestService: CalendarDigestService,
  ctx: CapabilityContext,
  taskContext: { workspaceId: string; runId?: string },
): CapabilityToolDescriptor[] {
  function authorizeRelease(input: {
    sourceRef: string;
    releaseLevel: 'summary';
    tokenEstimate: number;
    payloadPreview?: string;
  }): { ok: true; approvalId?: string } | { ok: false; text: string } {
    if (!taskContext.runId || !ctx.authorizeContextRelease) {
      return { ok: true };
    }
    const authorization = ctx.authorizeContextRelease({
      runId: taskContext.runId,
      domain: 'calendar',
      sourceRef: input.sourceRef,
      requestedLevel: input.releaseLevel,
      tokenEstimate: input.tokenEstimate,
      resourceType: 'calendar_context',
      resourceId: input.sourceRef,
      requestedBy: 'cap-calendar',
      ...(input.payloadPreview !== undefined ? { payloadPreview: input.payloadPreview } : {}),
    });
    if (authorization.outcome === 'deny') {
      return { ok: false, text: authorization.reason };
    }
    if (authorization.outcome === 'approval_required') {
      return {
        ok: false,
        text: `${authorization.reason} Approval ID: ${authorization.approvalId ?? 'pending'}`,
      };
    }
    return authorization.approvalId ? { ok: true, approvalId: authorization.approvalId } : { ok: true };
  }

  return [
    {
      name: 'popeye_calendar_today',
      label: 'Popeye Calendar Today',
      description: "Get today's calendar events with times and locations.",
      inputSchema: {
        type: 'object',
        properties: {
          accountId: { type: 'string', description: 'Calendar account ID (uses first account if omitted)' },
        },
        required: [],
        additionalProperties: false,
      },
      execute: async (params) => {
        const parsed = z.object({
          accountId: z.string().optional(),
        }).parse(params ?? {});

        const accounts = calendarService.listAccounts();
        if (accounts.length === 0) {
          return { content: [{ type: 'text', text: 'No calendar accounts registered.' }] };
        }

        const account = parsed.accountId
          ? calendarService.getAccount(parsed.accountId)
          : accounts[0]!;

        if (!account) {
          return { content: [{ type: 'text', text: 'Calendar account not found.' }] };
        }

        const events = calendarService.listToday(account.id);
        if (events.length === 0) {
          return { content: [{ type: 'text', text: 'No events scheduled for today.' }] };
        }

        const lines = events.map((e, i) => {
          const time = e.isAllDay ? 'All day' : `${e.startTime.slice(11, 16)} - ${e.endTime.slice(11, 16)}`;
          const loc = e.location ? ` @ ${e.location}` : '';
          return `${i + 1}. **${e.title}** (${time})${loc}`;
        });
        const text = lines.join('\n');

        const release = authorizeRelease({
          sourceRef: `calendar:today:${account.id}`,
          releaseLevel: 'summary',
          tokenEstimate: Math.ceil(text.length / 4),
          payloadPreview: `calendar today ${account.id}`,
        });
        if (!release.ok) {
          return { content: [{ type: 'text', text: release.text }] };
        }

        ctx.contextReleaseRecord({
          domain: 'calendar',
          sourceRef: `calendar:today:${account.id}`,
          releaseLevel: 'summary',
          ...(release.approvalId !== undefined ? { approvalId: release.approvalId } : {}),
          ...(taskContext.runId !== undefined ? { runId: taskContext.runId } : {}),
          tokenEstimate: Math.ceil(text.length / 4),
        });

        return { content: [{ type: 'text', text }], details: { count: events.length } };
      },
    },
    {
      name: 'popeye_calendar_search',
      label: 'Popeye Calendar Search',
      description: 'Search locally cached calendar events by query. Returns titles, times, and locations.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query for event titles and descriptions' },
          accountId: { type: 'string', description: 'Optional: restrict to specific calendar account' },
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
          return { content: [{ type: 'text', text: 'No matching calendar events found.' }] };
        }

        const lines = response.results.map((r, i) => {
          const loc = r.location ? ` @ ${r.location}` : '';
          return `${i + 1}. **${r.title}** (${r.startTime.slice(0, 16)} - ${r.endTime.slice(0, 16)})${loc}`;
        });
        const text = lines.join('\n');

        const release = authorizeRelease({
          sourceRef: `calendar:search:${parsed.query}`,
          releaseLevel: 'summary',
          tokenEstimate: Math.ceil(text.length / 4),
          payloadPreview: parsed.query,
        });
        if (!release.ok) {
          return { content: [{ type: 'text', text: release.text }] };
        }

        ctx.contextReleaseRecord({
          domain: 'calendar',
          sourceRef: `calendar:search:${parsed.query}`,
          releaseLevel: 'summary',
          ...(release.approvalId !== undefined ? { approvalId: release.approvalId } : {}),
          ...(taskContext.runId !== undefined ? { runId: taskContext.runId } : {}),
          tokenEstimate: Math.ceil(text.length / 4),
        });

        return { content: [{ type: 'text', text }], details: response };
      },
    },
    {
      name: 'popeye_calendar_availability',
      label: 'Popeye Calendar Availability',
      description: 'Get free time slots for a given date. Returns available slots between start and end hours.',
      inputSchema: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date to check (YYYY-MM-DD)' },
          accountId: { type: 'string', description: 'Calendar account ID (uses first account if omitted)' },
          startHour: { type: 'number', description: 'Start hour (0-23, default 9)' },
          endHour: { type: 'number', description: 'End hour (1-24, default 17)' },
          slotMinutes: { type: 'number', description: 'Slot duration in minutes (default 30)' },
        },
        required: ['date'],
        additionalProperties: false,
      },
      execute: async (params) => {
        const parsed = z.object({
          date: z.string().min(1),
          accountId: z.string().optional(),
          startHour: z.number().int().min(0).max(23).optional(),
          endHour: z.number().int().min(1).max(24).optional(),
          slotMinutes: z.number().int().positive().optional(),
        }).parse(params ?? {});

        const accounts = calendarService.listAccounts();
        if (accounts.length === 0) {
          return { content: [{ type: 'text', text: 'No calendar accounts registered.' }] };
        }

        const account = parsed.accountId
          ? calendarService.getAccount(parsed.accountId)
          : accounts[0]!;

        if (!account) {
          return { content: [{ type: 'text', text: 'Calendar account not found.' }] };
        }

        const slots = calendarService.computeAvailability(
          account.id,
          parsed.date,
          parsed.startHour ?? 9,
          parsed.endHour ?? 17,
          parsed.slotMinutes ?? 30,
        );

        if (slots.length === 0) {
          return { content: [{ type: 'text', text: `No free slots available on ${parsed.date}.` }] };
        }

        const lines = slots.map((s, i) =>
          `${i + 1}. ${s.startTime.slice(11, 16)} - ${s.endTime.slice(11, 16)} (${s.durationMinutes}min)`,
        );

        const release = authorizeRelease({
          sourceRef: `calendar:availability:${parsed.date}`,
          releaseLevel: 'summary',
          tokenEstimate: Math.ceil(lines.join('\n').length / 4),
          payloadPreview: parsed.date,
        });
        if (!release.ok) {
          return { content: [{ type: 'text', text: release.text }] };
        }

        ctx.contextReleaseRecord({
          domain: 'calendar',
          sourceRef: `calendar:availability:${parsed.date}`,
          releaseLevel: 'summary',
          ...(release.approvalId !== undefined ? { approvalId: release.approvalId } : {}),
          ...(taskContext.runId !== undefined ? { runId: taskContext.runId } : {}),
          tokenEstimate: Math.ceil(lines.join('\n').length / 4),
          redacted: false,
        });

        return { content: [{ type: 'text', text: lines.join('\n') }], details: { count: slots.length, date: parsed.date } };
      },
    },
    {
      name: 'popeye_calendar_digest',
      label: 'Popeye Calendar Digest',
      description: "Get the latest calendar digest or generate one for today. Shows today's events, upcoming week, and busy/free summary.",
      inputSchema: {
        type: 'object',
        properties: {
          accountId: { type: 'string', description: 'Calendar account ID (uses first account if omitted)' },
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

        const accounts = calendarService.listAccounts();
        if (accounts.length === 0) {
          return { content: [{ type: 'text', text: 'No calendar accounts registered.' }] };
        }

        const account = parsed.accountId
          ? calendarService.getAccount(parsed.accountId)
          : accounts[0]!;

        if (!account) {
          return { content: [{ type: 'text', text: 'Calendar account not found.' }] };
        }

        if (!parsed.date) {
          const latest = calendarService.getLatestDigest(account.id);
          if (latest && latest.date === new Date().toISOString().slice(0, 10)) {
            const release = authorizeRelease({
              sourceRef: `calendar:digest:${account.id}`,
              releaseLevel: 'summary',
              tokenEstimate: Math.ceil(latest.summaryMarkdown.length / 4),
              payloadPreview: `calendar digest ${account.id}`,
            });
            if (!release.ok) {
              return { content: [{ type: 'text', text: release.text }] };
            }

            ctx.contextReleaseRecord({
              domain: 'calendar',
              sourceRef: `calendar:digest:${account.id}`,
              releaseLevel: 'summary',
              ...(release.approvalId !== undefined ? { approvalId: release.approvalId } : {}),
              ...(taskContext.runId !== undefined ? { runId: taskContext.runId } : {}),
              tokenEstimate: Math.ceil(latest.summaryMarkdown.length / 4),
            });
            return { content: [{ type: 'text', text: latest.summaryMarkdown }], details: latest };
          }
        }

        const digest = digestService.generateDigest(account, parsed.date);

        const release = authorizeRelease({
          sourceRef: `calendar:digest:${account.id}`,
          releaseLevel: 'summary',
          tokenEstimate: Math.ceil(digest.summaryMarkdown.length / 4),
          payloadPreview: `calendar digest ${account.id}`,
        });
        if (!release.ok) {
          return { content: [{ type: 'text', text: release.text }] };
        }

        ctx.contextReleaseRecord({
          domain: 'calendar',
          sourceRef: `calendar:digest:${account.id}`,
          releaseLevel: 'summary',
          ...(release.approvalId !== undefined ? { approvalId: release.approvalId } : {}),
          ...(taskContext.runId !== undefined ? { runId: taskContext.runId } : {}),
          tokenEstimate: Math.ceil(digest.summaryMarkdown.length / 4),
        });

        return { content: [{ type: 'text', text: digest.summaryMarkdown }], details: digest };
      },
    },
  ];
}
