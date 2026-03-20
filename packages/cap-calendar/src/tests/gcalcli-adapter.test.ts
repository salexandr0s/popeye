import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as childProcess from 'node:child_process';

import { GcalcliAdapter } from '../providers/gcalcli-adapter.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

const mockedExecFile = vi.mocked(childProcess.execFile);

function mockGcalcliSuccess(stdout: string) {
  mockedExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
    if (typeof callback === 'function') {
      (callback as (err: Error | null, stdout: string, stderr: string) => void)(null, stdout, '');
    }
    return {} as ReturnType<typeof childProcess.execFile>;
  });
}

function mockGcalcliFailure(error: string) {
  mockedExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
    if (typeof callback === 'function') {
      const err = new Error(error);
      (callback as (err: Error | null, stdout: string, stderr: string) => void)(err, '', error);
    }
    return {} as ReturnType<typeof childProcess.execFile>;
  });
}

describe('GcalcliAdapter', () => {
  let adapter: GcalcliAdapter;

  beforeEach(() => {
    adapter = new GcalcliAdapter();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- getProfile ---

  it('getProfile parses gcalcli list output and extracts email', async () => {
    const listOutput = [
      ' Access  Title',
      ' ------  -----',
      ' owner   john.doe@gmail.com',
      ' reader  Holidays in United States',
      ' reader  Birthdays',
    ].join('\n');

    mockGcalcliSuccess(listOutput);
    const profile = await adapter.getProfile();
    expect(profile.email).toBe('john.doe@gmail.com');
    expect(profile.timeZone).toBeTruthy();
  });

  it('getProfile returns empty email when no email found', async () => {
    mockGcalcliSuccess(' Access  Title\n ------  -----\n reader  Holidays\n');
    const profile = await adapter.getProfile();
    expect(profile.email).toBe('');
    expect(profile.timeZone).toBeTruthy();
  });

  it('getProfile returns fallback on error', async () => {
    mockGcalcliFailure('gcalcli: command not found');
    const profile = await adapter.getProfile();
    expect(profile.email).toBe('');
    expect(profile.timeZone).toBeTruthy();
  });

  // --- listEvents ---

  it('listEvents parses TSV output into NormalizedCalendarEvent[]', async () => {
    const tsvOutput = [
      '2025-06-10\t09:00\t2025-06-10\t10:00\tTeam standup\tRoom 42',
      '2025-06-10\t14:00\t2025-06-10\t15:30\tDesign review\t',
    ].join('\n');

    mockGcalcliSuccess(tsvOutput);
    const result = await adapter.listEvents({ timeMin: '2025-06-10', timeMax: '2025-06-11' });
    const { events } = result;

    expect(events.length).toBe(2);
    expect(result.nextSyncToken).toBeTruthy();

    const first = events[0]!;
    expect(first.title).toBe('Team standup');
    expect(first.startTime).toBe('2025-06-10T09:00:00');
    expect(first.endTime).toBe('2025-06-10T10:00:00');
    expect(first.location).toBe('Room 42');
    expect(first.isAllDay).toBe(false);
    expect(first.status).toBe('confirmed');
    expect(first.eventId).toMatch(/^gcalcli-[0-9a-f]{16}$/);
    expect(first.attendees).toEqual([]);
    expect(first.description).toBe('');

    const second = events[1]!;
    expect(second.title).toBe('Design review');
    expect(second.startTime).toBe('2025-06-10T14:00:00');
    expect(second.endTime).toBe('2025-06-10T15:30:00');
    expect(second.location).toBe('');
  });

  it('listEvents handles all-day events (no start/end time)', async () => {
    const tsvOutput = '2025-06-10\t\t2025-06-10\t\tCompany Holiday\t';

    mockGcalcliSuccess(tsvOutput);
    const { events, nextSyncToken } = await adapter.listEvents();

    expect(events.length).toBe(1);
    expect(nextSyncToken).toBeTruthy();
    const event = events[0]!;
    expect(event.title).toBe('Company Holiday');
    expect(event.isAllDay).toBe(true);
    expect(event.startTime).toBe('2025-06-10T00:00:00');
    expect(event.endTime).toBe('2025-06-10T23:59:59');
  });

  it('listEvents handles empty output', async () => {
    mockGcalcliSuccess('');
    const result = await adapter.listEvents();
    expect(result.events).toEqual([]);
    expect(result.nextSyncToken).toBeTruthy();
  });

  it('listEvents handles whitespace-only output', async () => {
    mockGcalcliSuccess('   \n  \n\n');
    const result = await adapter.listEvents();
    expect(result.events).toEqual([]);
    expect(result.nextSyncToken).toBeTruthy();
  });

  it('listEvents skips malformed lines with fewer than 4 columns', async () => {
    const tsvOutput = [
      '2025-06-10\t09:00\t2025-06-10\t10:00\tValid meeting\tRoom 1',
      'not\tenough\tcolumns',
      '2025-06-10\t11:00\t2025-06-10\t12:00\tAnother meeting\t',
    ].join('\n');

    mockGcalcliSuccess(tsvOutput);
    const { events } = await adapter.listEvents();
    expect(events.length).toBe(2);
    expect(events[0]!.title).toBe('Valid meeting');
    expect(events[1]!.title).toBe('Another meeting');
  });

  it('listEvents skips lines with missing startDate or title', async () => {
    // 4+ columns but empty startDate
    const tsvOutput = [
      '\t09:00\t2025-06-10\t10:00\tNo start date\t',
      '2025-06-10\t09:00\t2025-06-10\t10:00\t\t', // empty title
    ].join('\n');

    mockGcalcliSuccess(tsvOutput);
    const { events } = await adapter.listEvents();
    expect(events.length).toBe(0);
  });

  it('listEvents calls gcalcli with correct args', async () => {
    mockGcalcliSuccess('');
    await adapter.listEvents({ timeMin: '2025-06-01T00:00:00Z', timeMax: '2025-06-30T23:59:59Z' });

    expect(mockedExecFile).toHaveBeenCalledTimes(1);
    const callArgs = mockedExecFile.mock.calls[0]!;
    expect(callArgs[0]).toBe('gcalcli');
    const args = callArgs[1] as string[];
    expect(args[0]).toBe('agenda');
    expect(args[1]).toBe('2025-06-01');
    expect(args[2]).toBe('2025-06-30');
    expect(args).toContain('--tsv');
    expect(args).toContain('--nocolor');
  });

  it('listEvents throws on gcalcli failure', async () => {
    mockGcalcliFailure('gcalcli: connection error');
    await expect(adapter.listEvents()).rejects.toThrow('gcalcli');
  });

  // --- listEventsIncremental ---

  it('listEventsIncremental returns events with nextSyncToken', async () => {
    const tsvOutput = '2025-06-10\t09:00\t2025-06-10\t10:00\tStandup\tRoom A';
    mockGcalcliSuccess(tsvOutput);

    const syncToken = '2025-06-09T00:00:00Z';
    const result = await adapter.listEventsIncremental(syncToken);

    expect(result.events.length).toBe(1);
    expect(result.events[0]!.title).toBe('Standup');
    expect(result.nextSyncToken).toBeTruthy();
    // nextSyncToken should be an ISO date string
    expect(() => new Date(result.nextSyncToken!)).not.toThrow();
  });

  it('listEventsIncremental uses syncToken as timeMin', async () => {
    mockGcalcliSuccess('');
    const syncToken = '2025-06-15T12:00:00Z';
    await adapter.listEventsIncremental(syncToken);

    const callArgs = mockedExecFile.mock.calls[0]!;
    const args = callArgs[1] as string[];
    // timeMin should be derived from the sync token
    expect(args[1]).toBe('2025-06-15');
  });

  // --- stableEventId ---

  it('stableEventId generates deterministic IDs for same inputs', async () => {
    const tsvLine = '2025-06-10\t09:00\t2025-06-10\t10:00\tMeeting\tRoom 1';
    mockGcalcliSuccess(tsvLine);
    const events1 = (await adapter.listEvents()).events;

    mockGcalcliSuccess(tsvLine);
    const events2 = (await adapter.listEvents()).events;

    expect(events1[0]!.eventId).toBe(events2[0]!.eventId);
  });

  it('stableEventId produces different IDs for different times', async () => {
    const line1 = '2025-06-10\t09:00\t2025-06-10\t10:00\tMeeting\tRoom 1';
    const line2 = '2025-06-10\t11:00\t2025-06-10\t12:00\tMeeting\tRoom 1';
    const tsvOutput = `${line1}\n${line2}`;

    mockGcalcliSuccess(tsvOutput);
    const events = (await adapter.listEvents()).events;

    expect(events.length).toBe(2);
    expect(events[0]!.eventId).not.toBe(events[1]!.eventId);
  });

  it('stableEventId format is gcalcli- prefix with 16 hex chars', async () => {
    const tsvOutput = '2025-06-10\t09:00\t2025-06-10\t10:00\tTest\t';
    mockGcalcliSuccess(tsvOutput);
    const events = (await adapter.listEvents()).events;
    expect(events[0]!.eventId).toMatch(/^gcalcli-[0-9a-f]{16}$/);
  });
});
