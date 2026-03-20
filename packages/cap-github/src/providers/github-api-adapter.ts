import type {
  GithubProviderAdapter,
  NormalizedGithubIssue,
  NormalizedGithubNotification,
  NormalizedGithubPR,
  NormalizedGithubProfile,
  NormalizedGithubRepo,
} from './adapter-interface.js';

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const BODY_PREVIEW_MAX = 500;

interface GithubUserResponse {
  login: string;
  name?: string | null;
  id: number;
}

interface GithubRepoResponse {
  id: number;
  owner: { login: string };
  name: string;
  full_name: string;
  description?: string | null;
  private: boolean;
  fork: boolean;
  default_branch: string;
  language?: string | null;
  stargazers_count: number;
  open_issues_count: number;
  pushed_at?: string | null;
}

interface GithubPullSummaryResponse {
  number: number;
}

interface GithubPullResponse {
  number: number;
  title: string;
  body?: string | null;
  user?: { login?: string };
  state: 'open' | 'closed';
  draft?: boolean;
  mergeable_state?: string;
  merged_at?: string | null;
  head: { ref: string };
  base: { ref: string };
  additions: number;
  deletions: number;
  changed_files: number;
  labels?: Array<{ name: string }>;
  requested_reviewers?: Array<{ login?: string }>;
  created_at: string;
  updated_at: string;
}

interface GithubIssueResponse {
  number: number;
  title: string;
  body?: string | null;
  user?: { login?: string };
  state: 'open' | 'closed';
  labels?: Array<{ name: string }>;
  assignees?: Array<{ login?: string }>;
  milestone?: { title?: string | null } | null;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
  pull_request?: Record<string, unknown>;
}

interface GithubNotificationResponse {
  id: string;
  repository: { full_name: string };
  subject: { title: string; type: string };
  reason: string;
  unread: boolean;
  updated_at: string;
}

interface GithubIssueCommentResponse {
  id: number;
  body?: string | null;
  html_url?: string | null;
  created_at: string;
}

export interface GithubApiAdapterConfig {
  accessToken: string;
}

export class GithubApiAdapter implements GithubProviderAdapter {
  constructor(private readonly config: GithubApiAdapterConfig) {}

  async getProfile(): Promise<NormalizedGithubProfile> {
    const response = await this.request<GithubUserResponse>('/user');
    return {
      username: response.login,
      name: response.name ?? response.login,
      id: response.id,
    };
  }

  async listRepos(opts?: { perPage?: number | undefined; type?: string | undefined }): Promise<NormalizedGithubRepo[]> {
    const repos = await this.paginate<GithubRepoResponse>('/user/repos', {
      per_page: String(opts?.perPage ?? 100),
      type: opts?.type ?? 'owner',
      sort: 'pushed',
    });
    return repos.map((repo) => ({
      id: repo.id,
      owner: repo.owner.login,
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description ?? '',
      isPrivate: repo.private,
      isFork: repo.fork,
      defaultBranch: repo.default_branch,
      language: repo.language ?? null,
      starsCount: repo.stargazers_count,
      openIssuesCount: repo.open_issues_count,
      lastPushedAt: repo.pushed_at ?? null,
    }));
  }

  async listPullRequests(owner: string, repo: string, opts?: {
    state?: 'open' | 'closed' | 'all' | undefined;
    limit?: number | undefined;
  }): Promise<NormalizedGithubPR[]> {
    const state = opts?.state ?? 'open';
    const limit = opts?.limit ?? 100;
    const summaries = await this.paginate<GithubPullSummaryResponse>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
      { state, per_page: '100' },
      limit,
    );
    const pulls = await Promise.all(
      summaries.slice(0, limit).map((summary) =>
        this.request<GithubPullResponse>(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${summary.number}`,
        ),
      ),
    );
    return pulls.map((pr) => ({
      number: pr.number,
      title: pr.title,
      bodyPreview: truncateBody(pr.body),
      author: pr.user?.login ?? '',
      state: pr.merged_at ? 'merged' : pr.state,
      isDraft: pr.draft ?? false,
      reviewDecision: normalizeReviewDecision(pr.mergeable_state),
      ciStatus: null,
      headBranch: pr.head.ref,
      baseBranch: pr.base.ref,
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changed_files,
      labels: (pr.labels ?? []).map((label) => label.name),
      requestedReviewers: (pr.requested_reviewers ?? []).map((reviewer) => reviewer.login ?? '').filter(Boolean),
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      mergedAt: pr.merged_at ?? null,
    }));
  }

  async listIssues(owner: string, repo: string, opts?: {
    state?: 'open' | 'closed' | 'all' | undefined;
    limit?: number | undefined;
    assignee?: string | undefined;
  }): Promise<NormalizedGithubIssue[]> {
    const issues = await this.paginate<GithubIssueResponse>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
      {
        state: opts?.state ?? 'open',
        per_page: '100',
        ...(opts?.assignee ? { assignee: opts.assignee } : {}),
      },
      opts?.limit ?? 100,
    );
    return issues
      .filter((issue) => !issue.pull_request)
      .slice(0, opts?.limit ?? 100)
      .map((issue) => ({
        number: issue.number,
        title: issue.title,
        bodyPreview: truncateBody(issue.body),
        author: issue.user?.login ?? '',
        state: issue.state,
        labels: (issue.labels ?? []).map((label) => label.name),
        assignees: (issue.assignees ?? []).map((assignee) => assignee.login ?? '').filter(Boolean),
        milestone: issue.milestone?.title ?? null,
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        closedAt: issue.closed_at ?? null,
      }));
  }

  async listNotifications(opts?: {
    all?: boolean | undefined;
    since?: string | undefined;
  }): Promise<NormalizedGithubNotification[]> {
    const notifications = await this.paginate<GithubNotificationResponse>(
      '/notifications',
      {
        ...(opts?.all ? { all: 'true' } : {}),
        ...(opts?.since ? { since: opts.since } : {}),
        per_page: '100',
      },
    );
    return notifications.map((notification) => ({
      id: notification.id,
      repoFullName: notification.repository.full_name,
      subjectTitle: notification.subject.title,
      subjectType: notification.subject.type,
      reason: notification.reason,
      isUnread: notification.unread,
      updatedAt: notification.updated_at,
    }));
  }

  async createIssueComment(owner: string, repo: string, issueNumber: number, body: string): Promise<{
    id: string;
    bodyPreview: string;
    htmlUrl: string | null;
    createdAt: string;
  }> {
    const response = await this.request<GithubIssueCommentResponse>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/comments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      },
    );
    return {
      id: String(response.id),
      bodyPreview: truncateBody(response.body),
      htmlUrl: response.html_url ?? null,
      createdAt: response.created_at,
    };
  }

  async markNotificationRead(notificationId: string): Promise<void> {
    await this.requestVoid(`/notifications/threads/${encodeURIComponent(notificationId)}`, {
      method: 'PATCH',
    });
  }

  private async paginate<T>(
    path: string,
    query: Record<string, string> = {},
    limit = Number.POSITIVE_INFINITY,
  ): Promise<T[]> {
    const results: T[] = [];
    let page = 1;
    while (results.length < limit) {
      const pageItems = await this.request<T[]>(
        `${path}?${new URLSearchParams({ ...query, page: String(page) }).toString()}`,
      );
      if (pageItems.length === 0) break;
      results.push(...pageItems);
      if (pageItems.length < Number(query.per_page ?? '100')) break;
      page += 1;
    }
    return results.slice(0, limit);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${GITHUB_API_BASE}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.config.accessToken}`,
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        ...(init.headers as Record<string, string> | undefined),
      },
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
    if (!response.ok) {
      throw new Error(`GitHub API error ${response.status}: ${await response.text()}`);
    }
    return response.json() as Promise<T>;
  }

  private async requestVoid(path: string, init: RequestInit = {}): Promise<void> {
    const response = await fetch(`${GITHUB_API_BASE}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.config.accessToken}`,
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        ...(init.headers as Record<string, string> | undefined),
      },
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
    if (!response.ok) {
      throw new Error(`GitHub API error ${response.status}: ${await response.text()}`);
    }
  }
}

function normalizeReviewDecision(value: string | undefined): string | null {
  if (!value) return null;
  const lowered = value.toLowerCase();
  if (lowered.includes('clean') || lowered.includes('unstable')) return 'review_required';
  return 'review_required';
}

function truncateBody(body: string | null | undefined): string {
  if (!body) return '';
  return body.length > BODY_PREVIEW_MAX ? `${body.slice(0, BODY_PREVIEW_MAX)}...` : body;
}
