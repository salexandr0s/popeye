export { type CapabilityDb, prepareGet, prepareAll, prepareRun } from '@popeye/cap-common';
import type { CapabilityDb } from '@popeye/cap-common';

export type TodoCapabilityDb = CapabilityDb;

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

