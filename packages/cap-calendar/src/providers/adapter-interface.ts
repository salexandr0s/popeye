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
  }): Promise<NormalizedCalendarEvent[]>;

  /** Incremental sync using a sync token. */
  listEventsIncremental(syncToken: string): Promise<{
    events: NormalizedCalendarEvent[];
    nextSyncToken: string | null;
  }>;
}
