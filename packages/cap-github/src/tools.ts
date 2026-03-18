import type { CapabilityContext, CapabilityToolDescriptor } from '@popeye/contracts';
import { extractRedactionPatterns, redactText } from '@popeye/observability';
import { z } from 'zod';

import type { GithubService } from './github-service.js';
import type { GithubSearchService } from './github-search.js';
import type { GithubDigestService } from './github-digest.js';

export function createGithubTools(
  githubService: GithubService,
  searchService: GithubSearchService,
  digestService: GithubDigestService,
  ctx: CapabilityContext,
  taskContext: { workspaceId: string; runId?: string },
): CapabilityToolDescriptor[] {
  const redactionPatterns = extractRedactionPatterns(ctx.config);

  function authorizeRelease(input: {
    sourceRef: string;
    releaseLevel: 'summary';
    tokenEstimate: number;
    payloadPreview?: string;
  }): { ok: true; approvalId?: string } | { ok: false; text: string } {
    if (!taskContext.runId || !ctx.authorizeContextRelease) {
      return { ok: true };
    }
    const authorization = ctx.authorizeContextRelease({
      runId: taskContext.runId,
      domain: 'github',
      sourceRef: input.sourceRef,
      requestedLevel: input.releaseLevel,
      tokenEstimate: input.tokenEstimate,
      resourceType: 'github_context',
      resourceId: input.sourceRef,
      requestedBy: 'cap-github',
      ...(input.payloadPreview !== undefined ? { payloadPreview: input.payloadPreview } : {}),
    });
    if (authorization.outcome === 'deny') {
      return { ok: false, text: authorization.reason };
    }
    if (authorization.outcome === 'approval_required') {
      return {
        ok: false,
        text: `${authorization.reason} Approval ID: ${authorization.approvalId ?? 'pending'}`,
      };
    }
    return authorization.approvalId ? { ok: true, approvalId: authorization.approvalId } : { ok: true };
  }

  return [
    {
      name: 'popeye_github_search',
      label: 'Popeye GitHub Search',
      description: 'Search locally cached GitHub PRs and issues by query. Returns titles, authors, and state.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query for PR/issue titles and body previews' },
          accountId: { type: 'string', description: 'Optional: restrict to specific GitHub account' },
          entityType: { type: 'string', enum: ['pr', 'issue', 'all'], description: 'Filter by entity type (default: all)' },
          limit: { type: 'number', description: 'Maximum results (default 20)' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      execute: async (params) => {
        const parsed = z.object({
          query: z.string().min(1),
          accountId: z.string().optional(),
          entityType: z.enum(['pr', 'issue', 'all']).optional(),
          limit: z.number().int().positive().max(100).optional(),
        }).parse(params ?? {});

        const response = searchService.search({
          query: parsed.query,
          accountId: parsed.accountId,
          entityType: parsed.entityType,
          limit: parsed.limit ?? 20,
        });

        if (response.results.length === 0) {
          return { content: [{ type: 'text', text: 'No matching GitHub PRs or issues found.' }] };
        }

        const lines = response.results.map((r, i) =>
          `${i + 1}. [${r.entityType.toUpperCase()}] **${r.title}** (#${r.number}) — ${r.repoFullName} by ${r.author} (${r.state})`,
        );
        return { content: [{ type: 'text', text: lines.join('\n') }], details: response };
      },
    },
    {
      name: 'popeye_github_digest',
      label: 'Popeye GitHub Digest',
      description: 'Get the latest GitHub digest or generate one for today. Shows open PRs, review requests, assigned issues, CI failures, stale PRs.',
      inputSchema: {
        type: 'object',
        properties: {
          accountId: { type: 'string', description: 'GitHub account ID (uses first account if omitted)' },
          date: { type: 'string', description: 'Date for digest (YYYY-MM-DD, default today)' },
        },
        required: [],
        additionalProperties: false,
      },
      execute: async (params) => {
        const parsed = z.object({
          accountId: z.string().optional(),
          date: z.string().optional(),
        }).parse(params ?? {});

        const accounts = githubService.listAccounts();
        if (accounts.length === 0) {
          return { content: [{ type: 'text', text: 'No GitHub accounts registered.' }] };
        }

        const account = parsed.accountId
          ? githubService.getAccount(parsed.accountId)
          : accounts[0]!;

        if (!account) {
          return { content: [{ type: 'text', text: 'GitHub account not found.' }] };
        }

        if (!parsed.date) {
          const latest = githubService.getLatestDigest(account.id);
          if (latest && latest.date === new Date().toISOString().slice(0, 10)) {
            return { content: [{ type: 'text', text: latest.summaryMarkdown }], details: latest };
          }
        }

        const digest = digestService.generateDigest(account, parsed.date);
        return { content: [{ type: 'text', text: digest.summaryMarkdown }], details: digest };
      },
    },
    {
      name: 'popeye_github_pr',
      label: 'Popeye GitHub PR',
      description: 'Get pull request detail: title, author, branch, review status, CI status, labels. Redacts body preview.',
      inputSchema: {
        type: 'object',
        properties: {
          prId: { type: 'string', description: 'Pull request ID to retrieve' },
        },
        required: ['prId'],
        additionalProperties: false,
      },
      execute: async (params) => {
        const parsed = z.object({
          prId: z.string().min(1),
        }).parse(params ?? {});

        const pr = githubService.getPullRequest(parsed.prId);
        if (!pr) {
          return { content: [{ type: 'text', text: 'Pull request not found.' }] };
        }

        const redactedBody = redactText(pr.bodyPreview, redactionPatterns).text;
        const lines: string[] = [];
        lines.push(`**${pr.title}** (#${pr.githubPrNumber})`);
        lines.push(`**Author:** ${pr.author} | **State:** ${pr.state} | **Draft:** ${pr.isDraft ? 'yes' : 'no'}`);
        lines.push(`**Branch:** ${pr.headBranch} → ${pr.baseBranch}`);
        lines.push(`**Changes:** +${pr.additions} -${pr.deletions} (${pr.changedFiles} files)`);
        if (pr.reviewDecision) lines.push(`**Review:** ${pr.reviewDecision}`);
        if (pr.ciStatus) lines.push(`**CI:** ${pr.ciStatus}`);
        if (pr.labels.length > 0) lines.push(`**Labels:** ${pr.labels.join(', ')}`);
        if (pr.requestedReviewers.length > 0) lines.push(`**Reviewers:** ${pr.requestedReviewers.join(', ')}`);
        if (redactedBody) {
          lines.push('');
          lines.push(redactedBody);
        }

        const release = authorizeRelease({
          sourceRef: `github:pr:${pr.id}`,
          releaseLevel: 'summary',
          tokenEstimate: Math.ceil(lines.join('\n').length / 4),
          payloadPreview: pr.title,
        });
        if (!release.ok) {
          return { content: [{ type: 'text', text: release.text }] };
        }

        ctx.contextReleaseRecord({
          domain: 'github',
          sourceRef: `github:pr:${pr.id}`,
          releaseLevel: 'summary',
          ...(release.approvalId !== undefined ? { approvalId: release.approvalId } : {}),
          ...(taskContext.runId !== undefined ? { runId: taskContext.runId } : {}),
          tokenEstimate: Math.ceil(lines.join('\n').length / 4),
          redacted: true,
        });

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          details: { prId: pr.id, repoId: pr.repoId },
        };
      },
    },
    {
      name: 'popeye_github_issue',
      label: 'Popeye GitHub Issue',
      description: 'Get issue detail: title, author, state, labels, assignees, milestone. Redacts body preview.',
      inputSchema: {
        type: 'object',
        properties: {
          issueId: { type: 'string', description: 'Issue ID to retrieve' },
        },
        required: ['issueId'],
        additionalProperties: false,
      },
      execute: async (params) => {
        const parsed = z.object({
          issueId: z.string().min(1),
        }).parse(params ?? {});

        const issue = githubService.getIssue(parsed.issueId);
        if (!issue) {
          return { content: [{ type: 'text', text: 'Issue not found.' }] };
        }

        const redactedBody = redactText(issue.bodyPreview, redactionPatterns).text;
        const lines: string[] = [];
        lines.push(`**${issue.title}** (#${issue.githubIssueNumber})`);
        lines.push(`**Author:** ${issue.author} | **State:** ${issue.state}`);
        if (issue.labels.length > 0) lines.push(`**Labels:** ${issue.labels.join(', ')}`);
        if (issue.assignees.length > 0) lines.push(`**Assignees:** ${issue.assignees.join(', ')}`);
        if (issue.milestone) lines.push(`**Milestone:** ${issue.milestone}`);
        if (redactedBody) {
          lines.push('');
          lines.push(redactedBody);
        }

        const release = authorizeRelease({
          sourceRef: `github:issue:${issue.id}`,
          releaseLevel: 'summary',
          tokenEstimate: Math.ceil(lines.join('\n').length / 4),
          payloadPreview: issue.title,
        });
        if (!release.ok) {
          return { content: [{ type: 'text', text: release.text }] };
        }

        ctx.contextReleaseRecord({
          domain: 'github',
          sourceRef: `github:issue:${issue.id}`,
          releaseLevel: 'summary',
          ...(release.approvalId !== undefined ? { approvalId: release.approvalId } : {}),
          ...(taskContext.runId !== undefined ? { runId: taskContext.runId } : {}),
          tokenEstimate: Math.ceil(lines.join('\n').length / 4),
          redacted: true,
        });

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          details: { issueId: issue.id, repoId: issue.repoId },
        };
      },
    },
    {
      name: 'popeye_github_notifications',
      label: 'Popeye GitHub Notifications',
      description: 'List unread GitHub notifications.',
      inputSchema: {
        type: 'object',
        properties: {
          accountId: { type: 'string', description: 'GitHub account ID (uses first account if omitted)' },
          limit: { type: 'number', description: 'Maximum results (default 20)' },
        },
        required: [],
        additionalProperties: false,
      },
      execute: async (params) => {
        const parsed = z.object({
          accountId: z.string().optional(),
          limit: z.number().int().positive().max(100).optional(),
        }).parse(params ?? {});

        const accounts = githubService.listAccounts();
        if (accounts.length === 0) {
          return { content: [{ type: 'text', text: 'No GitHub accounts registered.' }] };
        }

        const account = parsed.accountId
          ? githubService.getAccount(parsed.accountId)
          : accounts[0]!;

        if (!account) {
          return { content: [{ type: 'text', text: 'GitHub account not found.' }] };
        }

        const notifications = githubService.listNotifications(account.id, {
          unreadOnly: true,
          limit: parsed.limit ?? 20,
        });

        if (notifications.length === 0) {
          return { content: [{ type: 'text', text: 'No unread GitHub notifications.' }] };
        }

        const lines = notifications.map((n, i) =>
          `${i + 1}. [${n.subjectType}] **${n.subjectTitle}** — ${n.repoFullName} (${n.reason})`,
        );
        return { content: [{ type: 'text', text: lines.join('\n') }], details: { count: notifications.length } };
      },
    },
  ];
}
