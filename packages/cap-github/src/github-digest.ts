import type { CapabilityContext, GithubAccountRecord, GithubDigestRecord } from '@popeye/contracts';
import { nowIso } from '@popeye/contracts';

import type { GithubService } from './github-service.js';

const STALE_PR_DAYS = 7;

export class GithubDigestService {
  constructor(
    private readonly githubService: GithubService,
    private readonly ctx: CapabilityContext,
  ) {}

  generateDigest(account: GithubAccountRecord, date?: string, workspaceId = 'default'): GithubDigestRecord {
    const targetDate = date ?? nowIso().slice(0, 10);

    const openPrsCount = this.githubService.getOpenPrCount(account.id);
    const reviewRequestsCount = this.githubService.getReviewRequestCount(account.id, account.githubUsername);
    const assignedIssuesCount = this.githubService.getAssignedIssueCount(account.id);
    const unreadNotificationsCount = this.githubService.getUnreadNotificationCount(account.id);

    // Gather detail lists
    const reviewRequests = this.githubService.listReviewRequests(account.id, account.githubUsername);
    const assignedIssues = this.githubService.listAssignedIssues(account.id);

    // CI failures: open PRs authored by user with ci_status = 'failure'
    const myOpenPrs = this.githubService.listPullRequests(account.id, { state: 'open' });
    const myPrs = myOpenPrs.filter((pr) => pr.author === account.githubUsername);
    const ciFailures = myPrs.filter((pr) => pr.ciStatus === 'failure');

    // Stale PRs: open PRs with no activity in 7+ days
    const staleCutoff = new Date(Date.now() - STALE_PR_DAYS * 24 * 3600_000).toISOString();
    const stalePrs = myOpenPrs.filter((pr) => pr.updatedAtGh < staleCutoff);

    // Build markdown
    const sections: string[] = [];
    sections.push(`# GitHub Digest — ${targetDate}`);
    sections.push(`**Account:** ${account.githubUsername}`);
    sections.push('');
    sections.push('## Summary');
    sections.push(`- **Open PRs:** ${openPrsCount}`);
    sections.push(`- **Review requests:** ${reviewRequestsCount}`);
    sections.push(`- **Assigned issues:** ${assignedIssuesCount}`);
    sections.push(`- **Unread notifications:** ${unreadNotificationsCount}`);

    if (reviewRequests.length > 0) {
      sections.push('');
      sections.push('## Review Requests');
      for (const pr of reviewRequests.slice(0, 10)) {
        sections.push(`- **${pr.title}** (#${pr.githubPrNumber}) by ${pr.author}`);
      }
    }

    if (assignedIssues.length > 0) {
      sections.push('');
      sections.push('## Assigned Issues');
      for (const issue of assignedIssues.slice(0, 10)) {
        const labels = issue.labels.length > 0 ? ` [${issue.labels.join(', ')}]` : '';
        sections.push(`- **${issue.title}** (#${issue.githubIssueNumber})${labels}`);
      }
    }

    if (ciFailures.length > 0) {
      sections.push('');
      sections.push('## CI Failures');
      for (const pr of ciFailures.slice(0, 10)) {
        sections.push(`- **${pr.title}** (#${pr.githubPrNumber}) — ${pr.headBranch}`);
      }
    }

    if (stalePrs.length > 0) {
      sections.push('');
      sections.push('## Stale PRs (7+ days inactive)');
      for (const pr of stalePrs.slice(0, 10)) {
        const daysSince = Math.floor((Date.now() - new Date(pr.updatedAtGh).getTime()) / (24 * 3600_000));
        sections.push(`- **${pr.title}** (#${pr.githubPrNumber}) — ${daysSince}d inactive`);
      }
    }

    const summaryMarkdown = sections.join('\n');

    const digest = this.githubService.insertDigest({
      accountId: account.id,
      workspaceId,
      date: targetDate,
      openPrsCount,
      reviewRequestsCount,
      assignedIssuesCount,
      unreadNotificationsCount,
      summaryMarkdown,
    });

    // Store in memory as episodic
    this.ctx.memoryInsert({
      description: `GitHub digest for ${account.githubUsername} on ${targetDate}: ${openPrsCount} open PRs, ${reviewRequestsCount} reviews, ${assignedIssuesCount} assigned issues`,
      classification: 'internal',
      sourceType: 'capability_sync',
      content: summaryMarkdown,
      confidence: 0.7,
      scope: 'workspace',
      memoryType: 'episodic',
      sourceRef: `github:${account.id}:digest:${targetDate}`,
      sourceRefType: 'github_digest',
      domain: 'github',
      contextReleasePolicy: 'summary',
      dedupKey: `github-digest:${account.id}:${targetDate}`,
    });

    this.ctx.auditCallback({
      eventType: 'github_digest_generated',
      details: { accountId: account.id, date: targetDate, openPrsCount, reviewRequestsCount, assignedIssuesCount, unreadNotificationsCount },
      severity: 'info',
    });

    return digest;
  }
}
