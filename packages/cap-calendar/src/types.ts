import type { CapabilityContext } from '@popeye/contracts';

export interface CalendarAccountRow {
  id: string;
  connection_id: string;
  calendar_email: string;
  display_name: string;
  time_zone: string;
  sync_cursor_sync_token: string | null;
  last_sync_at: string | null;
  event_count: number;
  created_at: string;
  updated_at: string;
}

export interface CalendarEventRow {
  id: string;
  account_id: string;
  google_event_id: string;
  title: string;
  description: string;
  location: string;
  start_time: string;
  end_time: string;
  is_all_day: number; // 0 or 1
  status: string;
  organizer: string;
  attendees: string; // JSON array
  recurrence_rule: string | null;
  html_link: string | null;
  created_at_google: string | null;
  updated_at_google: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarDigestRow {
  id: string;
  account_id: string;
  workspace_id: string;
  date: string;
  today_event_count: number;
  upcoming_count: number;
  summary_markdown: string;
  generated_at: string;
}

export type CalendarCapabilityDb = CapabilityContext['appDb'];

// --- Typed DB helpers ---

interface PreparedStatement<TRow> {
  get(...args: unknown[]): TRow | undefined;
  all(...args: unknown[]): TRow[];
  run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint };
}

export function prepareGet<TRow>(db: CalendarCapabilityDb, sql: string): (...args: unknown[]) => TRow | undefined {
  const stmt = (db.prepare as (sql: string) => PreparedStatement<TRow>)(sql);
  return (...args: unknown[]) => stmt.get(...args);
}

export function prepareAll<TRow>(db: CalendarCapabilityDb, sql: string): (...args: unknown[]) => TRow[] {
  const stmt = (db.prepare as (sql: string) => PreparedStatement<TRow>)(sql);
  return (...args: unknown[]) => stmt.all(...args);
}

export function prepareRun(db: CalendarCapabilityDb, sql: string): (...args: unknown[]) => { changes: number } {
  const stmt = (db.prepare as (sql: string) => PreparedStatement<never>)(sql);
  return (...args: unknown[]) => {
    const result = stmt.run(...args);
    return { changes: result.changes };
  };
}
