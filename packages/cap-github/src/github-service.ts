import { randomUUID } from 'node:crypto';

import type {
  GithubAccountRecord,
  GithubAccountRegistrationInput,
  GithubRepoRecord,
  GithubPullRequestRecord,
  GithubIssueRecord,
  GithubNotificationRecord,
  GithubDigestRecord,
} from '@popeye/contracts';
import { nowIso } from '@popeye/contracts';

import type {
  GithubCapabilityDb,
  GithubAccountRow,
  GithubRepoRow,
  GithubPullRequestRow,
  GithubIssueRow,
  GithubNotificationRow,
  GithubDigestRow,
} from './types.js';
import { prepareGet, prepareAll, prepareRun } from './types.js';

// --- Row mappers ---

function parseJsonArray(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function mapAccountRow(row: GithubAccountRow): GithubAccountRecord {
  return {
    id: row.id,
    connectionId: row.connection_id,
    githubUsername: row.github_username,
    displayName: row.display_name,
    syncCursorSince: row.sync_cursor_since,
    lastSyncAt: row.last_sync_at,
    repoCount: row.repo_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRepoRow(row: GithubRepoRow): GithubRepoRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    githubRepoId: row.github_repo_id,
    owner: row.owner,
    name: row.name,
    fullName: row.full_name,
    description: row.description,
    isPrivate: row.is_private === 1,
    isFork: row.is_fork === 1,
    defaultBranch: row.default_branch,
    language: row.language,
    starsCount: row.stars_count,
    openIssuesCount: row.open_issues_count,
    lastPushedAt: row.last_pushed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const VALID_PR_STATE = new Set(['open', 'closed', 'merged']);

function mapPullRequestRow(row: GithubPullRequestRow): GithubPullRequestRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    repoId: row.repo_id,
    githubPrNumber: row.github_pr_number,
    title: row.title,
    bodyPreview: row.body_preview,
    author: row.author,
    state: VALID_PR_STATE.has(row.state) ? row.state as GithubPullRequestRecord['state'] : 'open',
    isDraft: row.is_draft === 1,
    reviewDecision: row.review_decision as GithubPullRequestRecord['reviewDecision'] ?? null,
    ciStatus: row.ci_status as GithubPullRequestRecord['ciStatus'] ?? null,
    headBranch: row.head_branch,
    baseBranch: row.base_branch,
    additions: row.additions,
    deletions: row.deletions,
    changedFiles: row.changed_files,
    labels: parseJsonArray(row.labels),
    requestedReviewers: parseJsonArray(row.requested_reviewers),
    createdAtGh: row.created_at_gh,
    updatedAtGh: row.updated_at_gh,
    mergedAt: row.merged_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const VALID_ISSUE_STATE = new Set(['open', 'closed']);

function mapIssueRow(row: GithubIssueRow): GithubIssueRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    repoId: row.repo_id,
    githubIssueNumber: row.github_issue_number,
    title: row.title,
    bodyPreview: row.body_preview,
    author: row.author,
    state: VALID_ISSUE_STATE.has(row.state) ? row.state as GithubIssueRecord['state'] : 'open',
    labels: parseJsonArray(row.labels),
    assignees: parseJsonArray(row.assignees),
    milestone: row.milestone,
    isAssignedToMe: row.is_assigned_to_me === 1,
    isMentioned: row.is_mentioned === 1,
    createdAtGh: row.created_at_gh,
    updatedAtGh: row.updated_at_gh,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapNotificationRow(row: GithubNotificationRow): GithubNotificationRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    githubNotificationId: row.github_notification_id,
    repoFullName: row.repo_full_name,
    subjectTitle: row.subject_title,
    subjectType: row.subject_type,
    reason: row.reason,
    isUnread: row.is_unread === 1,
    updatedAtGh: row.updated_at_gh,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDigestRow(row: GithubDigestRow): GithubDigestRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    workspaceId: row.workspace_id,
    date: row.date,
    openPrsCount: row.open_prs_count,
    reviewRequestsCount: row.review_requests_count,
    assignedIssuesCount: row.assigned_issues_count,
    unreadNotificationsCount: row.unread_notifications_count,
    summaryMarkdown: row.summary_markdown,
    generatedAt: row.generated_at,
  };
}

// --- Service ---

export class GithubService {
  constructor(private readonly db: GithubCapabilityDb) {}

  // --- Accounts ---

  registerAccount(input: GithubAccountRegistrationInput): GithubAccountRecord {
    const id = randomUUID();
    const now = nowIso();
    prepareRun(this.db,
      `INSERT INTO github_accounts (id, connection_id, github_username, display_name, repo_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )(id, input.connectionId, input.githubUsername, input.displayName, now, now);
    const result = this.getAccount(id);
    if (!result) throw new Error('Failed to register GitHub account');
    return result;
  }

  getAccount(id: string): GithubAccountRecord | null {
    const row = prepareGet<GithubAccountRow>(this.db, 'SELECT * FROM github_accounts WHERE id = ?')(id);
    return row ? mapAccountRow(row) : null;
  }

  getAccountByConnection(connectionId: string): GithubAccountRecord | null {
    const row = prepareGet<GithubAccountRow>(this.db, 'SELECT * FROM github_accounts WHERE connection_id = ?')(connectionId);
    return row ? mapAccountRow(row) : null;
  }

  listAccounts(): GithubAccountRecord[] {
    const rows = prepareAll<GithubAccountRow>(this.db, 'SELECT * FROM github_accounts ORDER BY github_username')();
    return rows.map(mapAccountRow);
  }

  updateSyncCursor(accountId: string, since: string | null): void {
    const now = nowIso();
    prepareRun(this.db,
      'UPDATE github_accounts SET sync_cursor_since = ?, last_sync_at = ?, updated_at = ? WHERE id = ?',
    )(since, now, now, accountId);
  }

  updateRepoCount(accountId: string): void {
    const now = nowIso();
    const result = prepareGet<{ cnt: number }>(this.db, 'SELECT COUNT(*) as cnt FROM github_repos WHERE account_id = ?')(accountId);
    const count = result?.cnt ?? 0;
    prepareRun(this.db, 'UPDATE github_accounts SET repo_count = ?, updated_at = ? WHERE id = ?')(count, now, accountId);
  }

  // --- Repos ---

  getRepo(id: string): GithubRepoRecord | null {
    const row = prepareGet<GithubRepoRow>(this.db, 'SELECT * FROM github_repos WHERE id = ?')(id);
    return row ? mapRepoRow(row) : null;
  }

  getRepoByGithubId(accountId: string, githubRepoId: number): GithubRepoRecord | null {
    const row = prepareGet<GithubRepoRow>(this.db,
      'SELECT * FROM github_repos WHERE account_id = ? AND github_repo_id = ?',
    )(accountId, githubRepoId);
    return row ? mapRepoRow(row) : null;
  }

  listRepos(accountId: string, options: { limit?: number | undefined } = {}): GithubRepoRecord[] {
    const limit = options.limit ?? 100;
    const rows = prepareAll<GithubRepoRow>(this.db,
      'SELECT * FROM github_repos WHERE account_id = ? ORDER BY full_name LIMIT ?',
    )(accountId, limit);
    return rows.map(mapRepoRow);
  }

  upsertRepo(accountId: string, data: {
    githubRepoId: number;
    owner: string;
    name: string;
    fullName: string;
    description: string;
    isPrivate: boolean;
    isFork: boolean;
    defaultBranch: string;
    language: string | null;
    starsCount: number;
    openIssuesCount: number;
    lastPushedAt: string | null;
  }): GithubRepoRecord {
    const now = nowIso();
    const existing = this.getRepoByGithubId(accountId, data.githubRepoId);

    if (existing) {
      prepareRun(this.db,
        `UPDATE github_repos SET owner = ?, name = ?, full_name = ?, description = ?,
         is_private = ?, is_fork = ?, default_branch = ?, language = ?,
         stars_count = ?, open_issues_count = ?, last_pushed_at = ?, updated_at = ? WHERE id = ?`,
      )(
        data.owner, data.name, data.fullName, data.description,
        data.isPrivate ? 1 : 0, data.isFork ? 1 : 0, data.defaultBranch, data.language,
        data.starsCount, data.openIssuesCount, data.lastPushedAt, now, existing.id,
      );
      return this.getRepo(existing.id)!;
    }

    const id = randomUUID();
    prepareRun(this.db,
      `INSERT INTO github_repos (id, account_id, github_repo_id, owner, name, full_name, description,
       is_private, is_fork, default_branch, language, stars_count, open_issues_count, last_pushed_at,
       created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )(
      id, accountId, data.githubRepoId, data.owner, data.name, data.fullName, data.description,
      data.isPrivate ? 1 : 0, data.isFork ? 1 : 0, data.defaultBranch, data.language,
      data.starsCount, data.openIssuesCount, data.lastPushedAt, now, now,
    );
    return this.getRepo(id)!;
  }

  // --- Pull Requests ---

  getPullRequest(id: string): GithubPullRequestRecord | null {
    const row = prepareGet<GithubPullRequestRow>(this.db, 'SELECT * FROM github_pull_requests WHERE id = ?')(id);
    return row ? mapPullRequestRow(row) : null;
  }

  getPullRequestByNumber(accountId: string, repoId: string, prNumber: number): GithubPullRequestRecord | null {
    const row = prepareGet<GithubPullRequestRow>(this.db,
      'SELECT * FROM github_pull_requests WHERE account_id = ? AND repo_id = ? AND github_pr_number = ?',
    )(accountId, repoId, prNumber);
    return row ? mapPullRequestRow(row) : null;
  }

  listPullRequests(accountId: string, options: {
    state?: string | undefined;
    limit?: number | undefined;
    repoId?: string | undefined;
  } = {}): GithubPullRequestRecord[] {
    const clauses = ['account_id = ?'];
    const params: unknown[] = [accountId];

    if (options.state) {
      clauses.push('state = ?');
      params.push(options.state);
    }
    if (options.repoId) {
      clauses.push('repo_id = ?');
      params.push(options.repoId);
    }

    const limit = options.limit ?? 50;
    const rows = prepareAll<GithubPullRequestRow>(this.db,
      `SELECT * FROM github_pull_requests WHERE ${clauses.join(' AND ')} ORDER BY updated_at_gh DESC LIMIT ?`,
    )(...params, limit);
    return rows.map(mapPullRequestRow);
  }

  listReviewRequests(accountId: string, username: string): GithubPullRequestRecord[] {
    const rows = prepareAll<GithubPullRequestRow>(this.db,
      `SELECT * FROM github_pull_requests WHERE account_id = ? AND state = 'open'
       AND instr(requested_reviewers, ?) > 0 ORDER BY updated_at_gh DESC`,
    )(accountId, `"${username}"`);
    return rows.map(mapPullRequestRow);
  }

  upsertPullRequest(accountId: string, repoId: string, data: {
    githubPrNumber: number;
    title: string;
    bodyPreview: string;
    author: string;
    state: string;
    isDraft: boolean;
    reviewDecision: string | null;
    ciStatus: string | null;
    headBranch: string;
    baseBranch: string;
    additions: number;
    deletions: number;
    changedFiles: number;
    labels: string[];
    requestedReviewers: string[];
    createdAtGh: string;
    updatedAtGh: string;
    mergedAt: string | null;
  }): GithubPullRequestRecord {
    const now = nowIso();
    const existing = this.getPullRequestByNumber(accountId, repoId, data.githubPrNumber);

    if (existing) {
      prepareRun(this.db,
        `UPDATE github_pull_requests SET title = ?, body_preview = ?, author = ?, state = ?,
         is_draft = ?, review_decision = ?, ci_status = ?, head_branch = ?, base_branch = ?,
         additions = ?, deletions = ?, changed_files = ?, labels = ?, requested_reviewers = ?,
         created_at_gh = ?, updated_at_gh = ?, merged_at = ?, updated_at = ? WHERE id = ?`,
      )(
        data.title, data.bodyPreview, data.author, data.state,
        data.isDraft ? 1 : 0, data.reviewDecision, data.ciStatus,
        data.headBranch, data.baseBranch,
        data.additions, data.deletions, data.changedFiles,
        JSON.stringify(data.labels), JSON.stringify(data.requestedReviewers),
        data.createdAtGh, data.updatedAtGh, data.mergedAt, now, existing.id,
      );
      return this.getPullRequest(existing.id)!;
    }

    const id = randomUUID();
    prepareRun(this.db,
      `INSERT INTO github_pull_requests (id, account_id, repo_id, github_pr_number, title, body_preview,
       author, state, is_draft, review_decision, ci_status, head_branch, base_branch,
       additions, deletions, changed_files, labels, requested_reviewers,
       created_at_gh, updated_at_gh, merged_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )(
      id, accountId, repoId, data.githubPrNumber, data.title, data.bodyPreview,
      data.author, data.state, data.isDraft ? 1 : 0, data.reviewDecision, data.ciStatus,
      data.headBranch, data.baseBranch,
      data.additions, data.deletions, data.changedFiles,
      JSON.stringify(data.labels), JSON.stringify(data.requestedReviewers),
      data.createdAtGh, data.updatedAtGh, data.mergedAt, now, now,
    );
    return this.getPullRequest(id)!;
  }

  // --- Issues ---

  getIssue(id: string): GithubIssueRecord | null {
    const row = prepareGet<GithubIssueRow>(this.db, 'SELECT * FROM github_issues WHERE id = ?')(id);
    return row ? mapIssueRow(row) : null;
  }

  getIssueByNumber(accountId: string, repoId: string, issueNumber: number): GithubIssueRecord | null {
    const row = prepareGet<GithubIssueRow>(this.db,
      'SELECT * FROM github_issues WHERE account_id = ? AND repo_id = ? AND github_issue_number = ?',
    )(accountId, repoId, issueNumber);
    return row ? mapIssueRow(row) : null;
  }

  listIssues(accountId: string, options: {
    state?: string | undefined;
    limit?: number | undefined;
    repoId?: string | undefined;
    assignedOnly?: boolean | undefined;
  } = {}): GithubIssueRecord[] {
    const clauses = ['account_id = ?'];
    const params: unknown[] = [accountId];

    if (options.state) {
      clauses.push('state = ?');
      params.push(options.state);
    }
    if (options.repoId) {
      clauses.push('repo_id = ?');
      params.push(options.repoId);
    }
    if (options.assignedOnly) {
      clauses.push('is_assigned_to_me = 1');
    }

    const limit = options.limit ?? 50;
    const rows = prepareAll<GithubIssueRow>(this.db,
      `SELECT * FROM github_issues WHERE ${clauses.join(' AND ')} ORDER BY updated_at_gh DESC LIMIT ?`,
    )(...params, limit);
    return rows.map(mapIssueRow);
  }

  listAssignedIssues(accountId: string, limit = 50): GithubIssueRecord[] {
    const rows = prepareAll<GithubIssueRow>(this.db,
      `SELECT * FROM github_issues WHERE account_id = ? AND is_assigned_to_me = 1 AND state = 'open'
       ORDER BY updated_at_gh DESC LIMIT ?`,
    )(accountId, limit);
    return rows.map(mapIssueRow);
  }

  upsertIssue(accountId: string, repoId: string, data: {
    githubIssueNumber: number;
    title: string;
    bodyPreview: string;
    author: string;
    state: string;
    labels: string[];
    assignees: string[];
    milestone: string | null;
    isAssignedToMe: boolean;
    isMentioned: boolean;
    createdAtGh: string;
    updatedAtGh: string;
    closedAt: string | null;
  }): GithubIssueRecord {
    const now = nowIso();
    const existing = this.getIssueByNumber(accountId, repoId, data.githubIssueNumber);

    if (existing) {
      prepareRun(this.db,
        `UPDATE github_issues SET title = ?, body_preview = ?, author = ?, state = ?,
         labels = ?, assignees = ?, milestone = ?, is_assigned_to_me = ?, is_mentioned = ?,
         created_at_gh = ?, updated_at_gh = ?, closed_at = ?, updated_at = ? WHERE id = ?`,
      )(
        data.title, data.bodyPreview, data.author, data.state,
        JSON.stringify(data.labels), JSON.stringify(data.assignees), data.milestone,
        data.isAssignedToMe ? 1 : 0, data.isMentioned ? 1 : 0,
        data.createdAtGh, data.updatedAtGh, data.closedAt, now, existing.id,
      );
      return this.getIssue(existing.id)!;
    }

    const id = randomUUID();
    prepareRun(this.db,
      `INSERT INTO github_issues (id, account_id, repo_id, github_issue_number, title, body_preview,
       author, state, labels, assignees, milestone, is_assigned_to_me, is_mentioned,
       created_at_gh, updated_at_gh, closed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )(
      id, accountId, repoId, data.githubIssueNumber, data.title, data.bodyPreview,
      data.author, data.state, JSON.stringify(data.labels), JSON.stringify(data.assignees),
      data.milestone, data.isAssignedToMe ? 1 : 0, data.isMentioned ? 1 : 0,
      data.createdAtGh, data.updatedAtGh, data.closedAt, now, now,
    );
    return this.getIssue(id)!;
  }

  // --- Notifications ---

  listNotifications(accountId: string, options: { unreadOnly?: boolean | undefined; limit?: number | undefined } = {}): GithubNotificationRecord[] {
    const clauses = ['account_id = ?'];
    const params: unknown[] = [accountId];

    if (options.unreadOnly) {
      clauses.push('is_unread = 1');
    }

    const limit = options.limit ?? 50;
    const rows = prepareAll<GithubNotificationRow>(this.db,
      `SELECT * FROM github_notifications WHERE ${clauses.join(' AND ')} ORDER BY updated_at_gh DESC LIMIT ?`,
    )(...params, limit);
    return rows.map(mapNotificationRow);
  }

  getNotification(id: string): GithubNotificationRecord | null {
    const row = prepareGet<GithubNotificationRow>(this.db, 'SELECT * FROM github_notifications WHERE id = ?')(id);
    return row ? mapNotificationRow(row) : null;
  }

  upsertNotification(accountId: string, data: {
    githubNotificationId: string;
    repoFullName: string;
    subjectTitle: string;
    subjectType: string;
    reason: string;
    isUnread: boolean;
    updatedAtGh: string;
  }): GithubNotificationRecord {
    const now = nowIso();
    const existing = prepareGet<GithubNotificationRow>(this.db,
      'SELECT * FROM github_notifications WHERE account_id = ? AND github_notification_id = ?',
    )(accountId, data.githubNotificationId);

    if (existing) {
      prepareRun(this.db,
        `UPDATE github_notifications SET subject_title = ?, subject_type = ?, reason = ?,
         is_unread = ?, updated_at_gh = ?, updated_at = ? WHERE id = ?`,
      )(data.subjectTitle, data.subjectType, data.reason, data.isUnread ? 1 : 0, data.updatedAtGh, now, existing.id);
      const result = prepareGet<GithubNotificationRow>(this.db, 'SELECT * FROM github_notifications WHERE id = ?')(existing.id);
      return result ? mapNotificationRow(result) : mapNotificationRow(existing);
    }

    const id = randomUUID();
    prepareRun(this.db,
      `INSERT INTO github_notifications (id, account_id, github_notification_id, repo_full_name,
       subject_title, subject_type, reason, is_unread, updated_at_gh, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )(
      id, accountId, data.githubNotificationId, data.repoFullName,
      data.subjectTitle, data.subjectType, data.reason, data.isUnread ? 1 : 0,
      data.updatedAtGh, now, now,
    );
    const result = prepareGet<GithubNotificationRow>(this.db, 'SELECT * FROM github_notifications WHERE id = ?')(id);
    return result ? mapNotificationRow(result) : {
      id, accountId, githubNotificationId: data.githubNotificationId,
      repoFullName: data.repoFullName, subjectTitle: data.subjectTitle,
      subjectType: data.subjectType, reason: data.reason,
      isUnread: data.isUnread, updatedAtGh: data.updatedAtGh,
      createdAt: now, updatedAt: now,
    };
  }

  clearNotifications(accountId: string): void {
    prepareRun(this.db,
      'UPDATE github_notifications SET is_unread = 0, updated_at = ? WHERE account_id = ? AND is_unread = 1',
    )(nowIso(), accountId);
  }

  markNotificationRead(id: string): GithubNotificationRecord | null {
    const existing = this.getNotification(id);
    if (!existing) return null;
    prepareRun(this.db,
      'UPDATE github_notifications SET is_unread = 0, updated_at = ? WHERE id = ?',
    )(nowIso(), id);
    return this.getNotification(id);
  }

  // --- Digests ---

  getDigest(id: string): GithubDigestRecord | null {
    const row = prepareGet<GithubDigestRow>(this.db, 'SELECT * FROM github_digests WHERE id = ?')(id);
    return row ? mapDigestRow(row) : null;
  }

  getLatestDigest(accountId: string): GithubDigestRecord | null {
    const row = prepareGet<GithubDigestRow>(this.db,
      'SELECT * FROM github_digests WHERE account_id = ? ORDER BY date DESC LIMIT 1',
    )(accountId);
    return row ? mapDigestRow(row) : null;
  }

  listDigests(accountId: string, options: { limit?: number | undefined } = {}): GithubDigestRecord[] {
    const limit = options.limit ?? 10;
    const rows = prepareAll<GithubDigestRow>(this.db,
      'SELECT * FROM github_digests WHERE account_id = ? ORDER BY date DESC LIMIT ?',
    )(accountId, limit);
    return rows.map(mapDigestRow);
  }

  insertDigest(data: {
    accountId: string;
    workspaceId: string;
    date: string;
    openPrsCount: number;
    reviewRequestsCount: number;
    assignedIssuesCount: number;
    unreadNotificationsCount: number;
    summaryMarkdown: string;
  }): GithubDigestRecord {
    const now = nowIso();
    const existing = prepareGet<GithubDigestRow>(this.db,
      'SELECT * FROM github_digests WHERE account_id = ? AND date = ?',
    )(data.accountId, data.date);

    if (existing) {
      prepareRun(this.db,
        `UPDATE github_digests SET open_prs_count = ?, review_requests_count = ?,
         assigned_issues_count = ?, unread_notifications_count = ?,
         summary_markdown = ?, generated_at = ? WHERE id = ?`,
      )(data.openPrsCount, data.reviewRequestsCount, data.assignedIssuesCount,
        data.unreadNotificationsCount, data.summaryMarkdown, now, existing.id);
      return this.getDigest(existing.id)!;
    }

    const id = randomUUID();
    prepareRun(this.db,
      `INSERT INTO github_digests (id, account_id, workspace_id, date, open_prs_count,
       review_requests_count, assigned_issues_count, unread_notifications_count,
       summary_markdown, generated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )(id, data.accountId, data.workspaceId, data.date, data.openPrsCount,
      data.reviewRequestsCount, data.assignedIssuesCount, data.unreadNotificationsCount,
      data.summaryMarkdown, now);
    return this.getDigest(id)!;
  }

  // --- Stats ---

  getOpenPrCount(accountId: string): number {
    const result = prepareGet<{ cnt: number }>(this.db,
      "SELECT COUNT(*) as cnt FROM github_pull_requests WHERE account_id = ? AND state = 'open'",
    )(accountId);
    return result?.cnt ?? 0;
  }

  getReviewRequestCount(accountId: string, username: string): number {
    const result = prepareGet<{ cnt: number }>(this.db,
      `SELECT COUNT(*) as cnt FROM github_pull_requests WHERE account_id = ? AND state = 'open'
       AND instr(requested_reviewers, ?) > 0`,
    )(accountId, `"${username}"`);
    return result?.cnt ?? 0;
  }

  getAssignedIssueCount(accountId: string): number {
    const result = prepareGet<{ cnt: number }>(this.db,
      "SELECT COUNT(*) as cnt FROM github_issues WHERE account_id = ? AND is_assigned_to_me = 1 AND state = 'open'",
    )(accountId);
    return result?.cnt ?? 0;
  }

  getUnreadNotificationCount(accountId: string): number {
    const result = prepareGet<{ cnt: number }>(this.db,
      'SELECT COUNT(*) as cnt FROM github_notifications WHERE account_id = ? AND is_unread = 1',
    )(accountId);
    return result?.cnt ?? 0;
  }

  getTopCollaborators(accountId: string, limit = 20): Array<{ author: string; count: number }> {
    const rows = prepareAll<{ author: string; cnt: number }>(this.db,
      `SELECT author, COUNT(*) as cnt FROM (
        SELECT author FROM github_pull_requests WHERE account_id = ?
        UNION ALL
        SELECT author FROM github_issues WHERE account_id = ?
      ) GROUP BY author ORDER BY cnt DESC LIMIT ?`,
    )(accountId, accountId, limit);
    return rows.map((r) => ({ author: r.author, count: r.cnt }));
  }

  getHotRepos(accountId: string, limit = 10): Array<{ repoId: string; fullName: string; activity: number }> {
    const rows = prepareAll<{ repo_id: string; full_name: string; activity: number }>(this.db,
      `SELECT r.id as repo_id, r.full_name, COUNT(p.id) as activity
       FROM github_repos r
       LEFT JOIN github_pull_requests p ON p.repo_id = r.id AND p.state = 'open'
       WHERE r.account_id = ?
       GROUP BY r.id
       ORDER BY activity DESC
       LIMIT ?`,
    )(accountId, limit);
    return rows.map((r) => ({ repoId: r.repo_id, fullName: r.full_name, activity: r.activity }));
  }
}
