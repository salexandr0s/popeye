import { execFile } from 'node:child_process';

import type {
  GithubProviderAdapter,
  NormalizedGithubProfile,
  NormalizedGithubRepo,
  NormalizedGithubPR,
  NormalizedGithubIssue,
  NormalizedGithubNotification,
} from './adapter-interface.js';

const GH_TIMEOUT_MS = 30_000;
const BODY_PREVIEW_MAX = 500;

function truncateBody(body: string | null | undefined): string {
  if (!body) return '';
  return body.length > BODY_PREVIEW_MAX ? body.slice(0, BODY_PREVIEW_MAX) + '...' : body;
}

function runGh(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { timeout: GH_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`gh ${args.join(' ')} failed: ${stderr || err.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

interface GhApiUser {
  login: string;
  name?: string;
  id: number;
}

interface GhApiRepo {
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

interface GhPrJson {
  number: number;
  title: string;
  body?: string;
  author: { login: string };
  state: string;
  isDraft: boolean;
  reviewDecision?: string;
  statusCheckRollup?: Array<{ conclusion: string }>;
  headRefName: string;
  baseRefName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: Array<{ name: string }>;
  reviewRequests: Array<{ login?: string; name?: string }>;
  createdAt: string;
  updatedAt: string;
  mergedAt?: string | null;
}

interface GhIssueJson {
  number: number;
  title: string;
  body?: string;
  author: { login: string };
  state: string;
  labels: Array<{ name: string }>;
  assignees: Array<{ login: string }>;
  milestone?: { title: string } | null;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
}

interface GhNotificationJson {
  id: string;
  repository: { full_name: string };
  subject: { title: string; type: string };
  reason: string;
  unread: boolean;
  updated_at: string;
}

export class GhCliAdapter implements GithubProviderAdapter {
  async getProfile(): Promise<NormalizedGithubProfile> {
    const raw = await runGh(['api', '/user']);
    const user = parseJson<GhApiUser>(raw, { login: '', name: '', id: 0 });
    return {
      username: user.login,
      name: user.name ?? user.login,
      id: user.id,
    };
  }

  async listRepos(opts?: { perPage?: number | undefined; type?: string | undefined }): Promise<NormalizedGithubRepo[]> {
    const perPage = opts?.perPage ?? 100;
    const raw = await runGh(['api', '/user/repos', '--paginate', '-q', '.[]', '--jq', '.', '--method', 'GET',
      '-f', `per_page=${perPage}`,
      '-f', `type=${opts?.type ?? 'owner'}`,
      '-f', 'sort=pushed',
    ]);

    // gh api --paginate returns newline-separated JSON objects
    const repos: NormalizedGithubRepo[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const repo = parseJson<GhApiRepo | null>(trimmed, null);
      if (!repo) continue;
      repos.push({
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
      });
    }
    return repos;
  }

  async listPullRequests(owner: string, repo: string, opts?: {
    state?: 'open' | 'closed' | 'all' | undefined;
    limit?: number | undefined;
  }): Promise<NormalizedGithubPR[]> {
    const state = opts?.state ?? 'open';
    const limit = opts?.limit ?? 100;
    const raw = await runGh([
      'pr', 'list',
      '--repo', `${owner}/${repo}`,
      '--state', state,
      '--limit', String(limit),
      '--json', 'number,title,body,author,state,isDraft,reviewDecision,statusCheckRollup,headRefName,baseRefName,additions,deletions,changedFiles,labels,reviewRequests,createdAt,updatedAt,mergedAt',
    ]);

    const prs = parseJson<GhPrJson[]>(raw, []);
    return prs.map((pr) => {
      // Derive CI status from statusCheckRollup
      let ciStatus: string | null = null;
      if (pr.statusCheckRollup && pr.statusCheckRollup.length > 0) {
        const conclusions = pr.statusCheckRollup.map((c) => c.conclusion?.toLowerCase());
        if (conclusions.every((c) => c === 'success')) ciStatus = 'success';
        else if (conclusions.some((c) => c === 'failure' || c === 'error')) ciStatus = 'failure';
        else ciStatus = 'pending';
      }

      // Derive state: gh uses 'OPEN', 'CLOSED', 'MERGED'
      let state: 'open' | 'closed' | 'merged' = 'open';
      if (pr.mergedAt) state = 'merged';
      else if (pr.state?.toUpperCase() === 'CLOSED') state = 'closed';

      return {
        number: pr.number,
        title: pr.title,
        bodyPreview: truncateBody(pr.body),
        author: pr.author?.login ?? '',
        state,
        isDraft: pr.isDraft ?? false,
        reviewDecision: pr.reviewDecision?.toLowerCase() ?? null,
        ciStatus,
        headBranch: pr.headRefName ?? '',
        baseBranch: pr.baseRefName ?? '',
        additions: pr.additions ?? 0,
        deletions: pr.deletions ?? 0,
        changedFiles: pr.changedFiles ?? 0,
        labels: (pr.labels ?? []).map((l) => l.name),
        requestedReviewers: (pr.reviewRequests ?? []).map((r) => r.login ?? r.name ?? ''),
        createdAt: pr.createdAt ?? '',
        updatedAt: pr.updatedAt ?? '',
        mergedAt: pr.mergedAt ?? null,
      };
    });
  }

  async listIssues(owner: string, repo: string, opts?: {
    state?: 'open' | 'closed' | 'all' | undefined;
    limit?: number | undefined;
    assignee?: string | undefined;
  }): Promise<NormalizedGithubIssue[]> {
    const state = opts?.state ?? 'open';
    const limit = opts?.limit ?? 100;
    const args = [
      'issue', 'list',
      '--repo', `${owner}/${repo}`,
      '--state', state,
      '--limit', String(limit),
      '--json', 'number,title,body,author,state,labels,assignees,milestone,createdAt,updatedAt,closedAt',
    ];
    if (opts?.assignee) {
      args.push('--assignee', opts.assignee);
    }
    const raw = await runGh(args);
    const issues = parseJson<GhIssueJson[]>(raw, []);
    return issues.map((issue) => ({
      number: issue.number,
      title: issue.title,
      bodyPreview: truncateBody(issue.body),
      author: issue.author?.login ?? '',
      state: issue.state?.toUpperCase() === 'CLOSED' ? 'closed' as const : 'open' as const,
      labels: (issue.labels ?? []).map((l) => l.name),
      assignees: (issue.assignees ?? []).map((a) => a.login),
      milestone: issue.milestone?.title ?? null,
      createdAt: issue.createdAt ?? '',
      updatedAt: issue.updatedAt ?? '',
      closedAt: issue.closedAt ?? null,
    }));
  }

  async listNotifications(opts?: {
    all?: boolean | undefined;
    since?: string | undefined;
  }): Promise<NormalizedGithubNotification[]> {
    const args = ['api', '/notifications', '--method', 'GET'];
    if (opts?.all) args.push('-f', 'all=true');
    if (opts?.since) args.push('-f', `since=${opts.since}`);
    const raw = await runGh(args);
    const notifications = parseJson<GhNotificationJson[]>(raw, []);
    return notifications.map((n) => ({
      id: n.id,
      repoFullName: n.repository.full_name,
      subjectTitle: n.subject.title,
      subjectType: n.subject.type,
      reason: n.reason,
      isUnread: n.unread,
      updatedAt: n.updated_at,
    }));
  }
}
