/**
 * Provider-neutral adapter interface for calendar data sources.
 * All adapters (gcalcli, direct API) implement this contract.
 * CalendarSyncService consumes this interface — it never sees provider-specific types.
 */

// --- Normalized output types (provider-neutral) ---

export interface NormalizedCalendarEvent {
  eventId: string;
  title: string;
  description: string;
  location: string;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  status: 'confirmed' | 'tentative' | 'cancelled';
  organizer: string;
  attendees: string[];
  recurrenceRule: string | null;
  htmlLink: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

// --- Adapter interface ---

export interface CalendarProviderAdapter {
  /** Return profile info for the calendar account. */
  getProfile(): Promise<{ email: string; timeZone: string }>;

  /** List events within a date range. */
  listEvents(opts?: {
    timeMin?: string | undefined;
    timeMax?: string | undefined;
    maxResults?: number | undefined;
    syncToken?: string | undefined;
  }): Promise<{
    events: NormalizedCalendarEvent[];
    nextSyncToken: string | null;
  }>;

  /** Incremental sync using a sync token. */
  listEventsIncremental(syncToken: string): Promise<{
    events: NormalizedCalendarEvent[];
    nextSyncToken: string | null;
  }>;

  /** Create a calendar event on the authenticated user's primary calendar. */
  createEvent?(input: {
    title: string;
    description?: string | undefined;
    location?: string | undefined;
    startTime: string;
    endTime: string;
    attendees?: string[] | undefined;
  }): Promise<NormalizedCalendarEvent>;

  /** Update an existing calendar event on the authenticated user's primary calendar. */
  updateEvent?(eventId: string, input: {
    title?: string | undefined;
    description?: string | undefined;
    location?: string | undefined;
    startTime?: string | undefined;
    endTime?: string | undefined;
    attendees?: string[] | undefined;
    status?: 'confirmed' | 'tentative' | 'cancelled' | undefined;
  }): Promise<NormalizedCalendarEvent>;
}
