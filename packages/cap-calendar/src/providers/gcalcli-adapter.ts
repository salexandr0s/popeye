import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';

import type {
  CalendarProviderAdapter,
  NormalizedCalendarEvent,
} from './adapter-interface.js';

const GCALCLI_TIMEOUT_MS = 30_000;

function runGcalcli(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gcalcli', args, { timeout: GCALCLI_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`gcalcli ${args.join(' ')} failed: ${stderr || err.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}

/** Deterministic event ID from start+end times. Stable across title edits. */
function stableEventId(startTime: string, endTime: string): string {
  const hash = createHash('sha256')
    .update(`${startTime}|${endTime}`)
    .digest('hex')
    .slice(0, 16);
  return `gcalcli-${hash}`;
}

function parseTsvLine(line: string): NormalizedCalendarEvent | null {
  const parts = line.split('\t');
  if (parts.length < 4) return null;

  const startDate = parts[0]?.trim() ?? '';
  const startTime = parts[1]?.trim() ?? '';
  const endDate = parts[2]?.trim() ?? '';
  const endTime = parts[3]?.trim() ?? '';
  const title = parts[4]?.trim() ?? '';

  if (!startDate || !title) return null;

  const isAllDay = !startTime && !endTime;
  const startIso = isAllDay ? `${startDate}T00:00:00` : `${startDate}T${startTime}:00`;
  const endIso = isAllDay ? `${endDate || startDate}T23:59:59` : `${endDate || startDate}T${endTime}:00`;

  return {
    eventId: stableEventId(startIso, endIso),
    title,
    description: '',
    location: parts[5]?.trim() ?? '',
    startTime: startIso,
    endTime: endIso,
    isAllDay,
    status: 'confirmed',
    organizer: '',
    attendees: [],
    recurrenceRule: null,
    htmlLink: null,
    createdAt: null,
    updatedAt: null,
  };
}

export class GcalcliAdapter implements CalendarProviderAdapter {
  async getProfile(): Promise<{ email: string; timeZone: string }> {
    try {
      const raw = await runGcalcli(['list']);
      const lines = raw.split('\n').filter((l) => l.trim());

      // Parse the first calendar entry for email
      let email = '';
      for (const line of lines) {
        const match = line.match(/[\w.+-]+@[\w.-]+/);
        if (match) {
          email = match[0];
          break;
        }
      }

      // Use system timezone as fallback
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      return { email, timeZone };
    } catch {
      return { email: '', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    }
  }

  async listEvents(opts?: {
    timeMin?: string | undefined;
    timeMax?: string | undefined;
    maxResults?: number | undefined;
    syncToken?: string | undefined;
  }): Promise<{
    events: NormalizedCalendarEvent[];
    nextSyncToken: string | null;
  }> {
    const now = new Date();
    const defaultMin = new Date(now.getTime() - 30 * 24 * 3600_000).toISOString().slice(0, 10);
    const defaultMax = new Date(now.getTime() + 90 * 24 * 3600_000).toISOString().slice(0, 10);

    const timeMin = opts?.timeMin?.slice(0, 10) ?? defaultMin;
    const timeMax = opts?.timeMax?.slice(0, 10) ?? defaultMax;

    const args = ['agenda', timeMin, timeMax, '--tsv', '--nocolor'];
    const raw = await runGcalcli(args);

    const events: NormalizedCalendarEvent[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const event = parseTsvLine(trimmed);
      if (event) events.push(event);
    }

    return {
      events,
      nextSyncToken: new Date().toISOString(),
    };
  }

  async listEventsIncremental(syncToken: string): Promise<{
    events: NormalizedCalendarEvent[];
    nextSyncToken: string | null;
  }> {
    // gcalcli does not natively support sync tokens.
    // Treat syncToken as an ISO date and do a full list from that point.
    const response = await this.listEvents({ timeMin: syncToken });
    return { events: response.events, nextSyncToken: response.nextSyncToken };
  }
}
