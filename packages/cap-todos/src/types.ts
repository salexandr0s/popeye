import type { CapabilityContext } from '@popeye/contracts';

export interface TodoAccountRow {
  id: string;
  connection_id: string | null;
  provider_kind: string;
  display_name: string;
  sync_cursor_since: string | null;
  last_sync_at: string | null;
  todo_count: number;
  created_at: string;
  updated_at: string;
}

export interface TodoProjectRow {
  id: string;
  account_id: string;
  external_id: string | null;
  name: string;
  color: string | null;
  todo_count: number;
  created_at: string;
  updated_at: string;
}

export interface TodoItemRow {
  id: string;
  account_id: string;
  external_id: string | null;
  title: string;
  description: string;
  priority: number;
  status: string;
  due_date: string | null;
  due_time: string | null;
  labels: string; // JSON array
  project_name: string | null;
  parent_id: string | null;
  completed_at: string | null;
  created_at_external: string | null;
  updated_at_external: string | null;
  created_at: string;
  updated_at: string;
}

export interface TodoDigestRow {
  id: string;
  account_id: string;
  workspace_id: string;
  date: string;
  pending_count: number;
  overdue_count: number;
  completed_today_count: number;
  summary_markdown: string;
  generated_at: string;
}

export type TodoCapabilityDb = CapabilityContext['appDb'];

// --- Typed DB helpers ---

interface PreparedStatement<TRow> {
  get(...args: unknown[]): TRow | undefined;
  all(...args: unknown[]): TRow[];
  run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint };
}

export function prepareGet<TRow>(db: TodoCapabilityDb, sql: string): (...args: unknown[]) => TRow | undefined {
  const stmt = (db.prepare as (sql: string) => PreparedStatement<TRow>)(sql);
  return (...args: unknown[]) => stmt.get(...args);
}

export function prepareAll<TRow>(db: TodoCapabilityDb, sql: string): (...args: unknown[]) => TRow[] {
  const stmt = (db.prepare as (sql: string) => PreparedStatement<TRow>)(sql);
  return (...args: unknown[]) => stmt.all(...args);
}

export function prepareRun(db: TodoCapabilityDb, sql: string): (...args: unknown[]) => { changes: number } {
  const stmt = (db.prepare as (sql: string) => PreparedStatement<never>)(sql);
  return (...args: unknown[]) => {
    const result = stmt.run(...args);
    return { changes: result.changes };
  };
}
