import type { CapabilityContext, CalendarAccountRecord, CalendarDigestRecord } from '@popeye/contracts';
import { nowIso } from '@popeye/contracts';

import type { CalendarService } from './calendar-service.js';

export class CalendarDigestService {
  constructor(
    private readonly calendarService: CalendarService,
    private readonly ctx: CapabilityContext,
  ) {}

  generateDigest(account: CalendarAccountRecord, date?: string, workspaceId = 'default'): CalendarDigestRecord {
    const targetDate = date ?? nowIso().slice(0, 10);

    // Today's events
    const todayEvents = this.calendarService.listEvents(account.id, {
      dateFrom: `${targetDate}T00:00:00`,
      dateTo: `${targetDate}T23:59:59`,
    });
    const todayEventCount = todayEvents.length;

    // Upcoming this week (next 7 days)
    const upcomingEnd = new Date(new Date(targetDate).getTime() + 7 * 24 * 3600_000).toISOString().slice(0, 10);
    const upcomingEvents = this.calendarService.listEvents(account.id, {
      dateFrom: `${targetDate}T00:00:00`,
      dateTo: `${upcomingEnd}T23:59:59`,
    });
    const upcomingCount = upcomingEvents.length;

    // Build markdown
    const sections: string[] = [];
    sections.push(`# Calendar Digest — ${targetDate}`);
    sections.push(`**Account:** ${account.calendarEmail}`);
    sections.push('');
    sections.push('## Summary');
    sections.push(`- **Today's events:** ${todayEventCount}`);
    sections.push(`- **Upcoming (7 days):** ${upcomingCount}`);

    if (todayEvents.length > 0) {
      sections.push('');
      sections.push("## Today's Events");
      for (const event of todayEvents.slice(0, 20)) {
        const time = event.isAllDay ? 'All day' : `${event.startTime.slice(11, 16)} - ${event.endTime.slice(11, 16)}`;
        const loc = event.location ? ` @ ${event.location}` : '';
        sections.push(`- **${event.title}** (${time})${loc}`);
      }
    }

    // Upcoming this week (excluding today)
    const tomorrowDate = new Date(new Date(targetDate).getTime() + 24 * 3600_000).toISOString().slice(0, 10);
    const upcomingAfterToday = upcomingEvents.filter((e) => e.startTime >= `${tomorrowDate}T00:00:00`);
    if (upcomingAfterToday.length > 0) {
      sections.push('');
      sections.push('## Upcoming This Week');
      for (const event of upcomingAfterToday.slice(0, 20)) {
        const day = event.startTime.slice(0, 10);
        const time = event.isAllDay ? 'All day' : `${event.startTime.slice(11, 16)} - ${event.endTime.slice(11, 16)}`;
        const loc = event.location ? ` @ ${event.location}` : '';
        sections.push(`- **${event.title}** (${day}, ${time})${loc}`);
      }
    }

    // Busy/free summary (events per day this week)
    sections.push('');
    sections.push('## Weekly Busy/Free Summary');
    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(new Date(targetDate).getTime() + i * 24 * 3600_000).toISOString().slice(0, 10);
      const dayEvents = upcomingEvents.filter((e) =>
        e.startTime >= `${dayDate}T00:00:00` && e.startTime <= `${dayDate}T23:59:59`,
      );
      const status = dayEvents.length === 0 ? 'free' : `${dayEvents.length} event${dayEvents.length > 1 ? 's' : ''}`;
      sections.push(`- ${dayDate}: ${status}`);
    }

    const summaryMarkdown = sections.join('\n');

    const digest = this.calendarService.insertDigest({
      accountId: account.id,
      workspaceId,
      date: targetDate,
      todayEventCount,
      upcomingCount,
      summaryMarkdown,
    });

    // Store in memory as episodic
    this.ctx.memoryInsert({
      description: `Calendar digest for ${account.calendarEmail} on ${targetDate}: ${todayEventCount} events today, ${upcomingCount} upcoming`,
      classification: 'internal',
      sourceType: 'capability_sync',
      content: summaryMarkdown,
      confidence: 0.7,
      scope: 'workspace',
      memoryType: 'episodic',
      sourceRef: `calendar:${account.id}:digest:${targetDate}`,
      sourceRefType: 'calendar_digest',
      domain: 'calendar',
      contextReleasePolicy: 'summary',
      dedupKey: `calendar-digest:${account.id}:${targetDate}`,
    });

    this.ctx.auditCallback({
      eventType: 'calendar_digest_generated',
      details: { accountId: account.id, date: targetDate, todayEventCount, upcomingCount },
      severity: 'info',
    });

    return digest;
  }
}
