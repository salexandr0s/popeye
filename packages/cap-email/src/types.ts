export { type CapabilityDb, prepareGet, prepareAll, prepareRun } from '@popeye/cap-common';
import type { CapabilityDb } from '@popeye/cap-common';

export type EmailCapabilityDb = CapabilityDb;

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

export interface EmailDraftRow {
  id: string;
  account_id: string;
  connection_id: string;
  provider_draft_id: string;
  provider_message_id: string | null;
  to_addresses: string;
  cc_addresses: string;
  subject: string;
  body_preview: string;
  created_at: string;
  updated_at: string;
}

