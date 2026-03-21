import type { CommandContext } from '../formatters.js';
import { getFlagValue } from '../formatters.js';
import { runOAuthConnectFlow } from './email.js';

export async function handleCalendar(ctx: CommandContext): Promise<void> {
  const { client, subcommand, arg1, jsonFlag } = ctx;

  if (subcommand === 'connect') {
    const reconnectId = getFlagValue('--reconnect');
    await runOAuthConnectFlow(client, {
      providerKind: 'google_calendar',
      mode: process.argv.includes('--read-write') ? 'read_write' : 'read_only',
      syncIntervalSeconds: 900,
      ...(reconnectId ? { connectionId: reconnectId } : {}),
    });
    console.info('Run "pop calendar sync" to fetch upcoming events.');
    return;
  }

  if (subcommand === 'sync') {
    const accounts = await client.listCalendarAccounts();
    if (accounts.length === 0) {
      console.error('No calendar accounts registered. Run "pop calendar connect" first.');
      process.exit(1);
    }
    const targetId = arg1 ?? accounts[0]!.id;
    console.info(`Syncing calendar account ${targetId}...`);
    const result = await client.syncCalendarAccount(targetId);
    if (jsonFlag) {
      console.info(JSON.stringify(result, null, 2));
    } else {
      console.info(`  Events: ${result.eventsSynced} new, ${result.eventsUpdated} updated`);
      if (result.errors.length > 0) {
        console.info(`  Errors: ${result.errors.length}`);
        for (const err of result.errors.slice(0, 5)) console.info(`    - ${err}`);
      }
    }
    return;
  }

  if (subcommand === 'accounts') {
    const accounts = await client.listCalendarAccounts();
    if (jsonFlag) {
      console.info(JSON.stringify(accounts, null, 2));
    } else {
      if (accounts.length === 0) {
        console.info('No calendar accounts registered.');
      } else {
        for (const acct of accounts) {
          console.info(`  ${acct.id}  ${acct.calendarEmail.padEnd(30)} ${acct.displayName}  tz: ${acct.timeZone}  events: ${acct.eventCount}  last sync: ${acct.lastSyncAt ?? 'never'}`);
        }
      }
    }
    return;
  }

  if (subcommand === 'events') {
    const limitIdx = process.argv.indexOf('--limit');
    const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1] ?? '50', 10) : 50;
    const today = process.argv.includes('--today');
    const upcoming = process.argv.includes('--upcoming');
    const now = new Date();
    const dateFrom = today ? now.toISOString().slice(0, 10) : upcoming ? now.toISOString().slice(0, 10) : undefined;
    const dateTo = today ? now.toISOString().slice(0, 10) + 'T23:59:59' : upcoming ? new Date(now.getTime() + 7 * 24 * 3600_000).toISOString().slice(0, 10) : undefined;
    const events = await client.listCalendarEvents(undefined, { ...(dateFrom !== undefined ? { dateFrom } : {}), ...(dateTo !== undefined ? { dateTo } : {}), limit });
    if (jsonFlag) {
      console.info(JSON.stringify(events, null, 2));
    } else {
      if (events.length === 0) {
        console.info('No calendar events found.');
      } else {
        for (const ev of events) {
          const time = ev.isAllDay ? 'all-day' : `${ev.startTime.slice(11, 16)}-${ev.endTime.slice(11, 16)}`;
          const loc = ev.location ? ` @ ${ev.location}` : '';
          console.info(`  ${ev.startTime.slice(0, 10)} ${time.padEnd(12)} ${ev.title.slice(0, 50)}${loc}`);
        }
      }
    }
    return;
  }

  if (subcommand === 'search' && arg1) {
    const limitIdx = process.argv.indexOf('--limit');
    const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1] ?? '20', 10) : 20;
    const response = await client.searchCalendar(arg1, { limit });
    if (jsonFlag) {
      console.info(JSON.stringify(response, null, 2));
    } else {
      if (response.results.length === 0) {
        console.info('No matching calendar events found.');
      } else {
        for (const r of response.results) {
          const loc = r.location ? ` @ ${r.location}` : '';
          console.info(`  ${r.startTime.slice(0, 10)} ${r.startTime.slice(11, 16)}-${r.endTime.slice(11, 16)}  ${r.title.slice(0, 50)}${loc}`);
        }
      }
    }
    return;
  }

  if (subcommand === 'availability') {
    const dateIdx = process.argv.indexOf('--date');
    const date = dateIdx !== -1 ? (process.argv[dateIdx + 1] ?? new Date().toISOString().slice(0, 10)) : new Date().toISOString().slice(0, 10);
    const slots = await client.getCalendarAvailability({ date });
    if (jsonFlag) {
      console.info(JSON.stringify(slots, null, 2));
    } else {
      if (slots.length === 0) {
        console.info('No free slots available.');
      } else {
        console.info(`Free slots for ${date}:`);
        for (const slot of slots) {
          console.info(`  ${slot.startTime.slice(11, 16)} - ${slot.endTime.slice(11, 16)}  (${slot.durationMinutes}min)`);
        }
      }
    }
    return;
  }

  if (subcommand === 'digest') {
    const digest = await client.getCalendarDigest();
    if (jsonFlag) {
      console.info(JSON.stringify(digest, null, 2));
    } else if (!digest) {
      console.info('No calendar digest available. Sync first with the daemon running.');
    } else {
      console.info(digest.summaryMarkdown);
    }
    return;
  }
}
