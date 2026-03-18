import { randomUUID } from 'node:crypto';

import type {
  CalendarAccountRecord,
  CalendarAccountRegistrationInput,
  CalendarEventRecord,
  CalendarDigestRecord,
  CalendarAvailabilitySlot,
} from '@popeye/contracts';
import { nowIso } from '@popeye/contracts';

import type {
  CalendarCapabilityDb,
  CalendarAccountRow,
  CalendarEventRow,
  CalendarDigestRow,
} from './types.js';
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

const VALID_EVENT_STATUS = new Set(['confirmed', 'tentative', 'cancelled']);

function mapAccountRow(row: CalendarAccountRow): CalendarAccountRecord {
  return {
    id: row.id,
    connectionId: row.connection_id,
    calendarEmail: row.calendar_email,
    displayName: row.display_name,
    timeZone: row.time_zone,
    syncCursorSyncToken: row.sync_cursor_sync_token,
    lastSyncAt: row.last_sync_at,
    eventCount: row.event_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEventRow(row: CalendarEventRow): CalendarEventRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    googleEventId: row.google_event_id,
    title: row.title,
    description: row.description,
    location: row.location,
    startTime: row.start_time,
    endTime: row.end_time,
    isAllDay: row.is_all_day === 1,
    status: VALID_EVENT_STATUS.has(row.status) ? row.status as CalendarEventRecord['status'] : 'confirmed',
    organizer: row.organizer,
    attendees: parseJsonArray(row.attendees),
    recurrenceRule: row.recurrence_rule,
    htmlLink: row.html_link,
    createdAtGoogle: row.created_at_google,
    updatedAtGoogle: row.updated_at_google,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDigestRow(row: CalendarDigestRow): CalendarDigestRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    workspaceId: row.workspace_id,
    date: row.date,
    todayEventCount: row.today_event_count,
    upcomingCount: row.upcoming_count,
    summaryMarkdown: row.summary_markdown,
    generatedAt: row.generated_at,
  };
}

// --- Helpers ---

/** Parse hours/minutes from ISO time string (avoids timezone conversion). */
function parseTimeMinutes(isoTime: string): number {
  const timePart = isoTime.slice(11, 16); // "HH:MM"
  const [h, m] = timePart.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Return the next calendar day in YYYY-MM-DD format. */
function nextDay(dateStr: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 0, (mo ?? 1) - 1, (d ?? 0) + 1));
  const yy = String(dt.getUTCFullYear()).padStart(4, '0');
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// --- Service ---

export class CalendarService {
  constructor(private readonly db: CalendarCapabilityDb) {}

  // --- Accounts ---

  registerAccount(input: CalendarAccountRegistrationInput): CalendarAccountRecord {
    const id = randomUUID();
    const now = nowIso();
    prepareRun(this.db,
      `INSERT INTO calendar_accounts (id, connection_id, calendar_email, display_name, time_zone, event_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    )(id, input.connectionId, input.calendarEmail, input.displayName, input.timeZone, now, now);
    const result = this.getAccount(id);
    if (!result) throw new Error('Failed to register calendar account');
    return result;
  }

  getAccount(id: string): CalendarAccountRecord | null {
    const row = prepareGet<CalendarAccountRow>(this.db, 'SELECT * FROM calendar_accounts WHERE id = ?')(id);
    return row ? mapAccountRow(row) : null;
  }

  getAccountByConnection(connectionId: string): CalendarAccountRecord | null {
    const row = prepareGet<CalendarAccountRow>(this.db, 'SELECT * FROM calendar_accounts WHERE connection_id = ?')(connectionId);
    return row ? mapAccountRow(row) : null;
  }

  listAccounts(): CalendarAccountRecord[] {
    const rows = prepareAll<CalendarAccountRow>(this.db, 'SELECT * FROM calendar_accounts ORDER BY calendar_email')();
    return rows.map(mapAccountRow);
  }

  updateSyncCursor(accountId: string, syncToken: string | null): void {
    const now = nowIso();
    prepareRun(this.db,
      'UPDATE calendar_accounts SET sync_cursor_sync_token = ?, last_sync_at = ?, updated_at = ? WHERE id = ?',
    )(syncToken, now, now, accountId);
  }

  updateEventCount(accountId: string): void {
    const now = nowIso();
    const result = prepareGet<{ cnt: number }>(this.db, 'SELECT COUNT(*) as cnt FROM calendar_events WHERE account_id = ?')(accountId);
    const count = result?.cnt ?? 0;
    prepareRun(this.db, 'UPDATE calendar_accounts SET event_count = ?, updated_at = ? WHERE id = ?')(count, now, accountId);
  }

  // --- Events ---

  getEvent(id: string): CalendarEventRecord | null {
    const row = prepareGet<CalendarEventRow>(this.db, 'SELECT * FROM calendar_events WHERE id = ?')(id);
    return row ? mapEventRow(row) : null;
  }

  getEventByGoogleId(accountId: string, googleEventId: string): CalendarEventRecord | null {
    const row = prepareGet<CalendarEventRow>(this.db,
      'SELECT * FROM calendar_events WHERE account_id = ? AND google_event_id = ?',
    )(accountId, googleEventId);
    return row ? mapEventRow(row) : null;
  }

  listEvents(accountId: string, options: { limit?: number | undefined; dateFrom?: string | undefined; dateTo?: string | undefined } = {}): CalendarEventRecord[] {
    const clauses = ['account_id = ?'];
    const params: unknown[] = [accountId];

    if (options.dateFrom) {
      clauses.push('start_time >= ?');
      params.push(options.dateFrom);
    }
    if (options.dateTo) {
      clauses.push('start_time <= ?');
      params.push(options.dateTo);
    }

    const limit = options.limit ?? 100;
    const rows = prepareAll<CalendarEventRow>(this.db,
      `SELECT * FROM calendar_events WHERE ${clauses.join(' AND ')} ORDER BY start_time ASC LIMIT ?`,
    )(...params, limit);
    return rows.map(mapEventRow);
  }

  listToday(accountId: string): CalendarEventRecord[] {
    const today = nowIso().slice(0, 10);
    const rows = prepareAll<CalendarEventRow>(this.db,
      `SELECT * FROM calendar_events WHERE account_id = ? AND start_time >= ? AND start_time < ?
       ORDER BY start_time ASC`,
    )(accountId, `${today}T00:00:00`, `${nextDay(today)}T00:00:00`);
    return rows.map(mapEventRow);
  }

  listUpcoming(accountId: string, days = 7): CalendarEventRecord[] {
    const now = nowIso();
    const endDate = nowIso().slice(0, 10);
    // Compute the exclusive upper-bound date (endDate + days)
    const [y, mo, d] = endDate.split('-').map(Number);
    const upper = new Date(Date.UTC(y ?? 0, (mo ?? 1) - 1, (d ?? 0) + days));
    const uy = String(upper.getUTCFullYear()).padStart(4, '0');
    const um = String(upper.getUTCMonth() + 1).padStart(2, '0');
    const ud = String(upper.getUTCDate()).padStart(2, '0');
    const endBound = `${uy}-${um}-${ud}T00:00:00`;
    const rows = prepareAll<CalendarEventRow>(this.db,
      `SELECT * FROM calendar_events WHERE account_id = ? AND start_time >= ? AND start_time < ?
       ORDER BY start_time ASC`,
    )(accountId, now, endBound);
    return rows.map(mapEventRow);
  }

  upsertEvent(accountId: string, data: {
    googleEventId: string;
    title: string;
    description: string;
    location: string;
    startTime: string;
    endTime: string;
    isAllDay: boolean;
    status: string;
    organizer: string;
    attendees: string[];
    recurrenceRule: string | null;
    htmlLink: string | null;
    createdAtGoogle: string | null;
    updatedAtGoogle: string | null;
  }): CalendarEventRecord {
    const now = nowIso();
    const existing = this.getEventByGoogleId(accountId, data.googleEventId);

    if (existing) {
      prepareRun(this.db,
        `UPDATE calendar_events SET title = ?, description = ?, location = ?,
         start_time = ?, end_time = ?, is_all_day = ?, status = ?, organizer = ?,
         attendees = ?, recurrence_rule = ?, html_link = ?,
         created_at_google = ?, updated_at_google = ?, updated_at = ? WHERE id = ?`,
      )(
        data.title, data.description, data.location,
        data.startTime, data.endTime, data.isAllDay ? 1 : 0, data.status, data.organizer,
        JSON.stringify(data.attendees), data.recurrenceRule, data.htmlLink,
        data.createdAtGoogle, data.updatedAtGoogle, now, existing.id,
      );
      return this.getEvent(existing.id)!;
    }

    const id = randomUUID();
    prepareRun(this.db,
      `INSERT INTO calendar_events (id, account_id, google_event_id, title, description, location,
       start_time, end_time, is_all_day, status, organizer, attendees, recurrence_rule, html_link,
       created_at_google, updated_at_google, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )(
      id, accountId, data.googleEventId, data.title, data.description, data.location,
      data.startTime, data.endTime, data.isAllDay ? 1 : 0, data.status, data.organizer,
      JSON.stringify(data.attendees), data.recurrenceRule, data.htmlLink,
      data.createdAtGoogle, data.updatedAtGoogle, now, now,
    );
    return this.getEvent(id)!;
  }

  // --- Digests ---

  getDigest(id: string): CalendarDigestRecord | null {
    const row = prepareGet<CalendarDigestRow>(this.db, 'SELECT * FROM calendar_digests WHERE id = ?')(id);
    return row ? mapDigestRow(row) : null;
  }

  getLatestDigest(accountId: string): CalendarDigestRecord | null {
    const row = prepareGet<CalendarDigestRow>(this.db,
      'SELECT * FROM calendar_digests WHERE account_id = ? ORDER BY date DESC LIMIT 1',
    )(accountId);
    return row ? mapDigestRow(row) : null;
  }

  listDigests(accountId: string, options: { limit?: number | undefined } = {}): CalendarDigestRecord[] {
    const limit = options.limit ?? 10;
    const rows = prepareAll<CalendarDigestRow>(this.db,
      'SELECT * FROM calendar_digests WHERE account_id = ? ORDER BY date DESC LIMIT ?',
    )(accountId, limit);
    return rows.map(mapDigestRow);
  }

  insertDigest(data: {
    accountId: string;
    workspaceId: string;
    date: string;
    todayEventCount: number;
    upcomingCount: number;
    summaryMarkdown: string;
  }): CalendarDigestRecord {
    const now = nowIso();
    const existing = prepareGet<CalendarDigestRow>(this.db,
      'SELECT * FROM calendar_digests WHERE account_id = ? AND date = ?',
    )(data.accountId, data.date);

    if (existing) {
      prepareRun(this.db,
        `UPDATE calendar_digests SET today_event_count = ?, upcoming_count = ?,
         summary_markdown = ?, generated_at = ? WHERE id = ?`,
      )(data.todayEventCount, data.upcomingCount, data.summaryMarkdown, now, existing.id);
      return this.getDigest(existing.id)!;
    }

    const id = randomUUID();
    prepareRun(this.db,
      `INSERT INTO calendar_digests (id, account_id, workspace_id, date, today_event_count,
       upcoming_count, summary_markdown, generated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )(id, data.accountId, data.workspaceId, data.date, data.todayEventCount,
      data.upcomingCount, data.summaryMarkdown, now);
    return this.getDigest(id)!;
  }

  // --- Availability ---

  computeAvailability(accountId: string, date: string, startHour = 9, endHour = 17, slotMinutes = 30): CalendarAvailabilitySlot[] {
    // Query events for the date
    const events = this.listEvents(accountId, {
      dateFrom: `${date}T00:00:00`,
      dateTo: `${date}T23:59:59`,
    });

    // Build busy intervals from events (in minutes from midnight)
    const busyIntervals: Array<{ start: number; end: number }> = [];
    for (const event of events) {
      if (event.status === 'cancelled') continue;

      // Handle all-day events — block the full working window
      if (event.isAllDay) {
        busyIntervals.push({ start: startHour * 60, end: endHour * 60 });
      } else {
        // Parse hours/minutes from ISO string directly (avoids timezone conversion)
        const eventStartMin = parseTimeMinutes(event.startTime);
        const eventEndMin = parseTimeMinutes(event.endTime);
        busyIntervals.push({ start: eventStartMin, end: eventEndMin });
      }
    }

    // Build free slots
    const freeSlots: CalendarAvailabilitySlot[] = [];
    let currentMin = startHour * 60;
    const endMin = endHour * 60;

    while (currentMin + slotMinutes <= endMin) {
      const slotEnd = currentMin + slotMinutes;

      // Check if slot overlaps with any busy interval
      const isBusy = busyIntervals.some((interval) =>
        currentMin < interval.end && slotEnd > interval.start,
      );

      if (!isBusy) {
        const startH = String(Math.floor(currentMin / 60)).padStart(2, '0');
        const startM = String(currentMin % 60).padStart(2, '0');
        const endH = String(Math.floor(slotEnd / 60)).padStart(2, '0');
        const endM = String(slotEnd % 60).padStart(2, '0');

        freeSlots.push({
          startTime: `${date}T${startH}:${startM}:00`,
          endTime: `${date}T${endH}:${endM}:00`,
          durationMinutes: slotMinutes,
        });
      }

      currentMin += slotMinutes;
    }

    return freeSlots;
  }
}
