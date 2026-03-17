import type { CapabilityContext } from '@popeye/contracts';

export interface GithubAccountRow {
  id: string;
  connection_id: string;
  github_username: string;
  display_name: string;
  sync_cursor_since: string | null;
  last_sync_at: string | null;
  repo_count: number;
  created_at: string;
  updated_at: string;
}

export interface GithubRepoRow {
  id: string;
  account_id: string;
  github_repo_id: number;
  owner: string;
  name: string;
  full_name: string;
  description: string;
  is_private: number; // 0 or 1
  is_fork: number; // 0 or 1
  default_branch: string;
  language: string | null;
  stars_count: number;
  open_issues_count: number;
  last_pushed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GithubPullRequestRow {
  id: string;
  account_id: string;
  repo_id: string;
  github_pr_number: number;
  title: string;
  body_preview: string;
  author: string;
  state: string;
  is_draft: number; // 0 or 1
  review_decision: string | null;
  ci_status: string | null;
  head_branch: string;
  base_branch: string;
  additions: number;
  deletions: number;
  changed_files: number;
  labels: string; // JSON array
  requested_reviewers: string; // JSON array
  created_at_gh: string;
  updated_at_gh: string;
  merged_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GithubIssueRow {
  id: string;
  account_id: string;
  repo_id: string;
  github_issue_number: number;
  title: string;
  body_preview: string;
  author: string;
  state: string;
  labels: string; // JSON array
  assignees: string; // JSON array
  milestone: string | null;
  is_assigned_to_me: number; // 0 or 1
  is_mentioned: number; // 0 or 1
  created_at_gh: string;
  updated_at_gh: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GithubNotificationRow {
  id: string;
  account_id: string;
  github_notification_id: string;
  repo_full_name: string;
  subject_title: string;
  subject_type: string;
  reason: string;
  is_unread: number; // 0 or 1
  updated_at_gh: string;
  created_at: string;
  updated_at: string;
}

export interface GithubDigestRow {
  id: string;
  account_id: string;
  workspace_id: string;
  date: string;
  open_prs_count: number;
  review_requests_count: number;
  assigned_issues_count: number;
  unread_notifications_count: number;
  summary_markdown: string;
  generated_at: string;
}

export type GithubCapabilityDb = CapabilityContext['appDb'];

// --- Typed DB helpers ---

interface PreparedStatement<TRow> {
  get(...args: unknown[]): TRow | undefined;
  all(...args: unknown[]): TRow[];
  run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint };
}

export function prepareGet<TRow>(db: GithubCapabilityDb, sql: string): (...args: unknown[]) => TRow | undefined {
  const stmt = (db.prepare as (sql: string) => PreparedStatement<TRow>)(sql);
  return (...args: unknown[]) => stmt.get(...args);
}

export function prepareAll<TRow>(db: GithubCapabilityDb, sql: string): (...args: unknown[]) => TRow[] {
  const stmt = (db.prepare as (sql: string) => PreparedStatement<TRow>)(sql);
  return (...args: unknown[]) => stmt.all(...args);
}

export function prepareRun(db: GithubCapabilityDb, sql: string): (...args: unknown[]) => { changes: number } {
  const stmt = (db.prepare as (sql: string) => PreparedStatement<never>)(sql);
  return (...args: unknown[]) => {
    const result = stmt.run(...args);
    return { changes: result.changes };
  };
}
