/**
 * Provider-neutral adapter interface for GitHub data sources.
 * All adapters (gh CLI, direct API) implement this contract.
 * GithubSyncService consumes this interface — it never sees provider-specific types.
 */

// --- Normalized output types (provider-neutral) ---

export interface NormalizedGithubProfile {
  username: string;
  name: string;
  id: number;
}

export interface NormalizedGithubRepo {
  id: number;
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
}

export interface NormalizedGithubPR {
  number: number;
  title: string;
  bodyPreview: string;
  author: string;
  state: 'open' | 'closed' | 'merged';
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
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
}

export interface NormalizedGithubIssue {
  number: number;
  title: string;
  bodyPreview: string;
  author: string;
  state: 'open' | 'closed';
  labels: string[];
  assignees: string[];
  milestone: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface NormalizedGithubNotification {
  id: string;
  repoFullName: string;
  subjectTitle: string;
  subjectType: string;
  reason: string;
  isUnread: boolean;
  updatedAt: string;
}

// --- Adapter interface ---

export interface GithubProviderAdapter {
  /** Return profile info for the authenticated user. */
  getProfile(): Promise<NormalizedGithubProfile>;

  /** List repos for the authenticated user. */
  listRepos(opts?: { perPage?: number | undefined; type?: string | undefined }): Promise<NormalizedGithubRepo[]>;

  /** List pull requests for a repo. */
  listPullRequests(owner: string, repo: string, opts?: {
    state?: 'open' | 'closed' | 'all' | undefined;
    limit?: number | undefined;
  }): Promise<NormalizedGithubPR[]>;

  /** List issues for a repo. */
  listIssues(owner: string, repo: string, opts?: {
    state?: 'open' | 'closed' | 'all' | undefined;
    limit?: number | undefined;
    assignee?: string | undefined;
  }): Promise<NormalizedGithubIssue[]>;

  /** List notifications for the authenticated user. */
  listNotifications(opts?: {
    all?: boolean | undefined;
    since?: string | undefined;
  }): Promise<NormalizedGithubNotification[]>;

  /** Create an issue/PR comment. */
  createIssueComment?(owner: string, repo: string, issueNumber: number, body: string): Promise<{
    id: string;
    bodyPreview: string;
    htmlUrl: string | null;
    createdAt: string;
  }>;

  /** Mark a notification thread as read. */
  markNotificationRead?(notificationId: string): Promise<void>;
}
