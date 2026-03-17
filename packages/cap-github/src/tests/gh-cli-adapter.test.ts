import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as childProcess from 'node:child_process';

import { GhCliAdapter } from '../providers/gh-cli-adapter.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

const mockedExecFile = vi.mocked(childProcess.execFile);

function mockGhSuccess(stdout: string) {
  mockedExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
    if (typeof callback === 'function') {
      (callback as (err: Error | null, stdout: string, stderr: string) => void)(null, stdout, '');
    }
    return {} as ReturnType<typeof childProcess.execFile>;
  });
}

function mockGhFailure(error: string) {
  mockedExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
    if (typeof callback === 'function') {
      const err = new Error(error);
      (callback as (err: Error | null, stdout: string, stderr: string) => void)(err, '', error);
    }
    return {} as ReturnType<typeof childProcess.execFile>;
  });
}

describe('GhCliAdapter', () => {
  let adapter: GhCliAdapter;

  beforeEach(() => {
    adapter = new GhCliAdapter();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getProfile parses user JSON', async () => {
    mockGhSuccess(JSON.stringify({ login: 'testuser', name: 'Test User', id: 12345 }));
    const profile = await adapter.getProfile();
    expect(profile.username).toBe('testuser');
    expect(profile.name).toBe('Test User');
    expect(profile.id).toBe(12345);
  });

  it('listRepos parses newline-separated JSON', async () => {
    const repos = [
      { id: 1, owner: { login: 'u1' }, name: 'r1', full_name: 'u1/r1', description: 'A repo', private: false, fork: false, default_branch: 'main', language: 'TypeScript', stargazers_count: 5, open_issues_count: 2, pushed_at: '2025-01-01T00:00:00Z' },
      { id: 2, owner: { login: 'u1' }, name: 'r2', full_name: 'u1/r2', description: null, private: true, fork: true, default_branch: 'main', language: null, stargazers_count: 0, open_issues_count: 0, pushed_at: null },
    ];
    mockGhSuccess(repos.map((r) => JSON.stringify(r)).join('\n'));
    const result = await adapter.listRepos();
    expect(result.length).toBe(2);
    expect(result[0]!.fullName).toBe('u1/r1');
    expect(result[0]!.language).toBe('TypeScript');
    expect(result[1]!.isPrivate).toBe(true);
    expect(result[1]!.isFork).toBe(true);
    expect(result[1]!.language).toBeNull();
  });

  it('listPullRequests parses gh pr list JSON', async () => {
    const prs = [
      {
        number: 42, title: 'Fix bug', body: 'This fixes the bug', author: { login: 'alice' },
        state: 'OPEN', isDraft: false, reviewDecision: 'APPROVED',
        statusCheckRollup: [{ conclusion: 'success' }],
        headRefName: 'fix/bug', baseRefName: 'main',
        additions: 10, deletions: 5, changedFiles: 3,
        labels: [{ name: 'bug' }], reviewRequests: [{ login: 'bob' }],
        createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-02T00:00:00Z', mergedAt: null,
      },
    ];
    mockGhSuccess(JSON.stringify(prs));
    const result = await adapter.listPullRequests('u1', 'r1');
    expect(result.length).toBe(1);
    expect(result[0]!.number).toBe(42);
    expect(result[0]!.state).toBe('open');
    expect(result[0]!.reviewDecision).toBe('approved');
    expect(result[0]!.ciStatus).toBe('success');
    expect(result[0]!.labels).toEqual(['bug']);
    expect(result[0]!.requestedReviewers).toEqual(['bob']);
  });

  it('listIssues parses gh issue list JSON', async () => {
    const issues = [
      {
        number: 10, title: 'Bug report', body: 'Something broken', author: { login: 'carol' },
        state: 'OPEN', labels: [{ name: 'bug' }], assignees: [{ login: 'testuser' }],
        milestone: { title: 'v1.0' },
        createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z', closedAt: null,
      },
    ];
    mockGhSuccess(JSON.stringify(issues));
    const result = await adapter.listIssues('u1', 'r1');
    expect(result.length).toBe(1);
    expect(result[0]!.state).toBe('open');
    expect(result[0]!.milestone).toBe('v1.0');
    expect(result[0]!.assignees).toEqual(['testuser']);
  });

  it('listNotifications parses notification JSON', async () => {
    const notifs = [
      {
        id: 'n1', repository: { full_name: 'u1/r1' },
        subject: { title: 'New PR', type: 'PullRequest' },
        reason: 'review_requested', unread: true,
        updated_at: '2025-01-02T00:00:00Z',
      },
    ];
    mockGhSuccess(JSON.stringify(notifs));
    const result = await adapter.listNotifications();
    expect(result.length).toBe(1);
    expect(result[0]!.subjectTitle).toBe('New PR');
    expect(result[0]!.isUnread).toBe(true);
  });

  it('throws on gh CLI failure', async () => {
    mockGhFailure('gh: command not found');
    await expect(adapter.getProfile()).rejects.toThrow('gh');
  });

  it('handles empty JSON responses', async () => {
    mockGhSuccess('[]');
    const prs = await adapter.listPullRequests('u1', 'r1');
    expect(prs.length).toBe(0);
  });

  it('handles malformed JSON gracefully for repos', async () => {
    mockGhSuccess('not json at all');
    const repos = await adapter.listRepos();
    expect(repos.length).toBe(0);
  });
});
