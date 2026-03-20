import type {
  CalendarProviderAdapter,
  NormalizedCalendarEvent,
} from './adapter-interface.js';

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const MAX_BACKOFF_MS = 32_000;
const MAX_RETRIES = 3;

export interface GoogleCalendarAdapterConfig {
  accessToken: string;
  refreshToken?: string | undefined;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
}

interface GoogleCalendarListEntry {
  id: string;
  summary?: string;
  timeZone?: string;
}

interface GoogleCalendarEventsResponse {
  items?: GoogleCalendarEvent[];
  nextSyncToken?: string;
}

interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  organizer?: { email?: string };
  attendees?: Array<{ email?: string }>;
  recurrence?: string[];
  htmlLink?: string;
  created?: string;
  updated?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
}

export class GoogleCalendarAdapter implements CalendarProviderAdapter {
  private accessToken: string;
  private readonly refreshToken: string | undefined;
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;

  constructor(config: GoogleCalendarAdapterConfig) {
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
  }

  async getProfile(): Promise<{ email: string; timeZone: string }> {
    const primary = await this.request<GoogleCalendarListEntry>('/users/me/calendarList/primary');
    return {
      email: primary.id,
      timeZone: primary.timeZone ?? 'UTC',
    };
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
    const params = new URLSearchParams();
    params.set('singleEvents', 'true');
    params.set('showDeleted', 'true');
    params.set('maxResults', String(opts?.maxResults ?? 250));
    if (opts?.timeMin) params.set('timeMin', opts.timeMin);
    if (opts?.timeMax) params.set('timeMax', opts.timeMax);
    if (opts?.syncToken) params.set('syncToken', opts.syncToken);

    const response = await this.request<GoogleCalendarEventsResponse>(`/calendars/primary/events?${params.toString()}`);
    return {
      events: (response.items ?? []).map(normalizeEvent),
      nextSyncToken: response.nextSyncToken ?? null,
    };
  }

  async listEventsIncremental(syncToken: string): Promise<{
    events: NormalizedCalendarEvent[];
    nextSyncToken: string | null;
  }> {
    const params = new URLSearchParams({
      singleEvents: 'true',
      showDeleted: 'true',
      syncToken,
    });
    const response = await this.request<GoogleCalendarEventsResponse>(`/calendars/primary/events?${params.toString()}`);
    return {
      events: (response.items ?? []).map(normalizeEvent),
      nextSyncToken: response.nextSyncToken ?? null,
    };
  }

  async createEvent(input: {
    title: string;
    description?: string | undefined;
    location?: string | undefined;
    startTime: string;
    endTime: string;
    attendees?: string[] | undefined;
  }): Promise<NormalizedCalendarEvent> {
    const response = await this.request<GoogleCalendarEvent>('/calendars/primary/events', 0, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(serializeEventBody(input)),
    });
    return normalizeEvent(response);
  }

  async updateEvent(eventId: string, input: {
    title?: string | undefined;
    description?: string | undefined;
    location?: string | undefined;
    startTime?: string | undefined;
    endTime?: string | undefined;
    attendees?: string[] | undefined;
    status?: 'confirmed' | 'tentative' | 'cancelled' | undefined;
  }): Promise<NormalizedCalendarEvent> {
    const response = await this.request<GoogleCalendarEvent>(`/calendars/primary/events/${encodeURIComponent(eventId)}`, 0, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(serializeEventBody(input)),
    });
    return normalizeEvent(response);
  }

  private async request<T>(path: string, retryCount = 0, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${CALENDAR_API_BASE}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...(init.headers as Record<string, string> | undefined),
      },
      ...(init.body !== undefined ? { body: init.body } : {}),
    });

    if (response.status === 401 && retryCount === 0 && this.refreshToken) {
      await this.refreshAccessToken();
      return this.request<T>(path, retryCount + 1, init);
    }

    if (response.status === 429 && retryCount < MAX_RETRIES) {
      const backoff = Math.min(1000 * Math.pow(2, retryCount), MAX_BACKOFF_MS);
      await new Promise((resolve) => setTimeout(resolve, backoff));
      return this.request<T>(path, retryCount + 1, init);
    }

    if (!response.ok) {
      throw new Error(`Google Calendar API error ${response.status}: ${await response.text()}`);
    }
    return response.json() as Promise<T>;
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken || !this.clientId || !this.clientSecret) {
      throw new Error('Cannot refresh Google Calendar token: missing refresh token or client credentials');
    }
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });
    if (!response.ok) {
      throw new Error(`Google Calendar token refresh failed: ${response.status}`);
    }
    const data = await response.json() as { access_token: string };
    this.accessToken = data.access_token;
  }
}

function normalizeEvent(event: GoogleCalendarEvent): NormalizedCalendarEvent {
  const startDateTime = event.start?.dateTime ?? `${event.start?.date ?? ''}T00:00:00`;
  const endDateTime = event.end?.dateTime ?? `${event.end?.date ?? event.start?.date ?? ''}T23:59:59`;
  const isAllDay = Boolean(event.start?.date && !event.start?.dateTime);
  return {
    eventId: event.id,
    title: event.summary ?? '(untitled event)',
    description: event.description ?? '',
    location: event.location ?? '',
    startTime: startDateTime,
    endTime: endDateTime,
    isAllDay,
    status: event.status ?? 'confirmed',
    organizer: event.organizer?.email ?? '',
    attendees: (event.attendees ?? []).map((entry) => entry.email ?? '').filter((value) => value.length > 0),
    recurrenceRule: event.recurrence?.[0] ?? null,
    htmlLink: event.htmlLink ?? null,
    createdAt: event.created ?? null,
    updatedAt: event.updated ?? null,
  };
}

function serializeEventBody(input: {
  title?: string | undefined;
  description?: string | undefined;
  location?: string | undefined;
  startTime?: string | undefined;
  endTime?: string | undefined;
  attendees?: string[] | undefined;
  status?: 'confirmed' | 'tentative' | 'cancelled' | undefined;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.title !== undefined) body['summary'] = input.title;
  if (input.description !== undefined) body['description'] = input.description;
  if (input.location !== undefined) body['location'] = input.location;
  if (input.startTime !== undefined) {
    body['start'] = serializeCalendarDateTime(input.startTime);
  }
  if (input.endTime !== undefined) {
    body['end'] = serializeCalendarDateTime(input.endTime);
  }
  if (input.attendees !== undefined) {
    body['attendees'] = input.attendees.map((email) => ({ email }));
  }
  if (input.status !== undefined) body['status'] = input.status;
  return body;
}

function serializeCalendarDateTime(value: string): Record<string, string> {
  if (value.length === 10) {
    return { date: value };
  }
  return { dateTime: value };
}
