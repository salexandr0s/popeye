import { z } from 'zod';

// --- Calendar Account Record ---

export const CalendarAccountRecordSchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  calendarEmail: z.string(),
  displayName: z.string(),
  timeZone: z.string(),
  syncCursorSyncToken: z.string().nullable().default(null),
  lastSyncAt: z.string().nullable().default(null),
  eventCount: z.number().int().nonnegative().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CalendarAccountRecord = z.infer<typeof CalendarAccountRecordSchema>;

// --- Calendar Account Registration Input ---

export const CalendarAccountRegistrationInputSchema = z.object({
  connectionId: z.string().min(1),
  calendarEmail: z.string().min(1),
  displayName: z.string().min(1),
  timeZone: z.string().min(1),
});
export type CalendarAccountRegistrationInput = z.infer<typeof CalendarAccountRegistrationInputSchema>;

// --- Calendar Event Record ---

export const CalendarEventStatusSchema = z.enum(['confirmed', 'tentative', 'cancelled']);
export type CalendarEventStatus = z.infer<typeof CalendarEventStatusSchema>;

export const CalendarEventRecordSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  googleEventId: z.string(),
  title: z.string(),
  description: z.string().default(''),
  location: z.string().default(''),
  startTime: z.string(),
  endTime: z.string(),
  isAllDay: z.boolean().default(false),
  status: CalendarEventStatusSchema.default('confirmed'),
  organizer: z.string().default(''),
  attendees: z.array(z.string()).default([]),
  recurrenceRule: z.string().nullable().default(null),
  htmlLink: z.string().nullable().default(null),
  createdAtGoogle: z.string().nullable().default(null),
  updatedAtGoogle: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CalendarEventRecord = z.infer<typeof CalendarEventRecordSchema>;

// --- Calendar Digest Record ---

export const CalendarDigestRecordSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  workspaceId: z.string(),
  date: z.string(),
  todayEventCount: z.number().int().nonnegative(),
  upcomingCount: z.number().int().nonnegative(),
  summaryMarkdown: z.string(),
  generatedAt: z.string(),
});
export type CalendarDigestRecord = z.infer<typeof CalendarDigestRecordSchema>;

// --- Calendar Search ---

export const CalendarSearchQuerySchema = z.object({
  query: z.string().min(1),
  accountId: z.string().optional(),
  limit: z.number().int().positive().max(100).default(20),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});
export type CalendarSearchQuery = z.infer<typeof CalendarSearchQuerySchema>;

export const CalendarSearchResultSchema = z.object({
  eventId: z.string(),
  title: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  location: z.string(),
  organizer: z.string(),
  score: z.number(),
});
export type CalendarSearchResult = z.infer<typeof CalendarSearchResultSchema>;

// --- Calendar Sync Result ---

export const CalendarSyncResultSchema = z.object({
  accountId: z.string(),
  eventsSynced: z.number().int().nonnegative(),
  eventsUpdated: z.number().int().nonnegative(),
  errors: z.array(z.string()),
});
export type CalendarSyncResult = z.infer<typeof CalendarSyncResultSchema>;

// --- Calendar Availability ---

export const CalendarAvailabilitySlotSchema = z.object({
  startTime: z.string(),
  endTime: z.string(),
  durationMinutes: z.number().int().positive(),
});
export type CalendarAvailabilitySlot = z.infer<typeof CalendarAvailabilitySlotSchema>;

export const CalendarAvailabilityQuerySchema = z.object({
  accountId: z.string().optional(),
  date: z.string(),
  startHour: z.number().int().min(0).max(23).default(9),
  endHour: z.number().int().min(1).max(24).default(17),
  slotMinutes: z.number().int().positive().default(30),
});
export type CalendarAvailabilityQuery = z.infer<typeof CalendarAvailabilityQuerySchema>;

export const CalendarEventCreateInputSchema = z.object({
  accountId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  location: z.string().default(''),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  attendees: z.array(z.string()).default([]),
});
export type CalendarEventCreateInput = z.infer<typeof CalendarEventCreateInputSchema>;

export const CalendarEventUpdateInputSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  attendees: z.array(z.string()).optional(),
  status: CalendarEventStatusSchema.optional(),
});
export type CalendarEventUpdateInput = z.infer<typeof CalendarEventUpdateInputSchema>;
