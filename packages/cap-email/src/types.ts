import type { CapabilityContext } from '@popeye/contracts';

export interface EmailAccountRow {
  id: string;
  connection_id: string;
  email_address: string;
  display_name: string;
  sync_cursor_page_token: string | null;
  sync_cursor_history_id: string | null;
  last_sync_at: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface EmailThreadRow {
  id: string;
  account_id: string;
  gmail_thread_id: string;
  subject: string;
  snippet: string;
  last_message_at: string;
  message_count: number;
  label_ids: string; // JSON array
  is_unread: number; // 0 or 1
  is_starred: number; // 0 or 1
  importance: string;
  created_at: string;
  updated_at: string;
}

export interface EmailMessageRow {
  id: string;
  thread_id: string;
  account_id: string;
  gmail_message_id: string;
  from_address: string;
  to_addresses: string; // JSON array
  cc_addresses: string; // JSON array
  subject: string;
  snippet: string;
  body_preview: string;
  received_at: string;
  size_estimate: number;
  label_ids: string; // JSON array
  created_at: string;
  updated_at: string;
}

export interface EmailDigestRow {
  id: string;
  account_id: string;
  workspace_id: string;
  date: string;
  unread_count: number;
  high_signal_count: number;
  summary_markdown: string;
  generated_at: string;
}

export type EmailCapabilityDb = CapabilityContext['appDb'];

// --- Typed DB helpers ---
// Eliminates per-call `as` casts by providing typed wrappers over CapabilityDbHandle.

interface PreparedStatement<TRow> {
  get(...args: unknown[]): TRow | undefined;
  all(...args: unknown[]): TRow[];
  run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint };
}

/** Typed wrapper over CapabilityDbHandle.prepare to avoid per-call casts. */
export function prepareGet<TRow>(db: EmailCapabilityDb, sql: string): (...args: unknown[]) => TRow | undefined {
  const stmt = (db.prepare as (sql: string) => PreparedStatement<TRow>)(sql);
  return (...args: unknown[]) => stmt.get(...args);
}

export function prepareAll<TRow>(db: EmailCapabilityDb, sql: string): (...args: unknown[]) => TRow[] {
  const stmt = (db.prepare as (sql: string) => PreparedStatement<TRow>)(sql);
  return (...args: unknown[]) => stmt.all(...args);
}

export function prepareRun(db: EmailCapabilityDb, sql: string): (...args: unknown[]) => { changes: number } {
  const stmt = (db.prepare as (sql: string) => PreparedStatement<never>)(sql);
  return (...args: unknown[]) => {
    const result = stmt.run(...args);
    return { changes: result.changes };
  };
}
