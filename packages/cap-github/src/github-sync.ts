import type { CapabilityContext, GithubAccountRecord, GithubSyncResult } from '@popeye/contracts';
import { redactText } from '@popeye/observability';

import type { GithubProviderAdapter } from './providers/adapter-interface.js';
import type { GithubService } from './github-service.js';

function extractRedactionPatterns(config: Record<string, unknown>): string[] {
  if (typeof config !== 'object' || config === null) return [];
  const security = config['security'];
  if (typeof security !== 'object' || security === null) return [];
  const patterns = (security as Record<string, unknown>)['redactionPatterns'];
  if (!Array.isArray(patterns)) return [];
  return patterns.filter((p): p is string => typeof p === 'string');
}

export class GithubSyncService {
  private readonly redactionPatterns: string[];

  constructor(
    private readonly githubService: GithubService,
    private readonly ctx: CapabilityContext,
  ) {
    this.redactionPatterns = extractRedactionPatterns(ctx.config);
  }

  async syncAccount(account: GithubAccountRecord, adapter: GithubProviderAdapter): Promise<GithubSyncResult> {
    const result: GithubSyncResult = {
      accountId: account.id,
      reposSynced: 0,
      prsSynced: 0,
      issuesSynced: 0,
      notificationsSynced: 0,
      errors: [],
    };

    try {
      // 1. Sync repos
      const repos = await adapter.listRepos();
      for (const repo of repos) {
        try {
          this.githubService.upsertRepo(account.id, {
            githubRepoId: repo.id,
            owner: repo.owner,
            name: repo.name,
            fullName: repo.fullName,
            description: this.redact(repo.description),
            isPrivate: repo.isPrivate,
            isFork: repo.isFork,
            defaultBranch: repo.defaultBranch,
            language: repo.language,
            starsCount: repo.starsCount,
            openIssuesCount: repo.openIssuesCount,
            lastPushedAt: repo.lastPushedAt,
          });
          result.reposSynced++;
        } catch (err) {
          result.errors.push(`Repo ${repo.fullName}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      this.githubService.updateRepoCount(account.id);

      // 2. Sync PRs and issues for each non-fork, non-archived repo
      const storedRepos = this.githubService.listRepos(account.id);
      for (const repo of storedRepos) {
        if (repo.isFork) continue;

        // PRs
        try {
          const prs = await adapter.listPullRequests(repo.owner, repo.name, { state: 'open' });
          for (const pr of prs) {
            this.githubService.upsertPullRequest(account.id, repo.id, {
              githubPrNumber: pr.number,
              title: this.redact(pr.title),
              bodyPreview: this.redact(pr.bodyPreview),
              author: pr.author,
              state: pr.state,
              isDraft: pr.isDraft,
              reviewDecision: pr.reviewDecision,
              ciStatus: pr.ciStatus,
              headBranch: pr.headBranch,
              baseBranch: pr.baseBranch,
              additions: pr.additions,
              deletions: pr.deletions,
              changedFiles: pr.changedFiles,
              labels: pr.labels,
              requestedReviewers: pr.requestedReviewers,
              createdAtGh: pr.createdAt,
              updatedAtGh: pr.updatedAt,
              mergedAt: pr.mergedAt,
            });
            result.prsSynced++;
          }
        } catch (err) {
          result.errors.push(`PRs ${repo.fullName}: ${err instanceof Error ? err.message : String(err)}`);
        }

        // Issues
        try {
          const issues = await adapter.listIssues(repo.owner, repo.name, { state: 'open' });
          for (const issue of issues) {
            this.githubService.upsertIssue(account.id, repo.id, {
              githubIssueNumber: issue.number,
              title: this.redact(issue.title),
              bodyPreview: this.redact(issue.bodyPreview),
              author: issue.author,
              state: issue.state,
              labels: issue.labels,
              assignees: issue.assignees,
              milestone: issue.milestone,
              isAssignedToMe: issue.assignees.includes(account.githubUsername),
              isMentioned: false, // gh CLI doesn't expose this directly
              createdAtGh: issue.createdAt,
              updatedAtGh: issue.updatedAt,
              closedAt: issue.closedAt,
            });
            result.issuesSynced++;
          }
        } catch (err) {
          result.errors.push(`Issues ${repo.fullName}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // 3. Sync notifications
      try {
        const since = account.syncCursorSince ?? undefined;
        const notifications = await adapter.listNotifications({ since });
        for (const notif of notifications) {
          this.githubService.upsertNotification(account.id, {
            githubNotificationId: notif.id,
            repoFullName: notif.repoFullName,
            subjectTitle: this.redact(notif.subjectTitle),
            subjectType: notif.subjectType,
            reason: notif.reason,
            isUnread: notif.isUnread,
            updatedAtGh: notif.updatedAt,
          });
          result.notificationsSynced++;
        }
      } catch (err) {
        result.errors.push(`Notifications: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Update sync cursor
      this.githubService.updateSyncCursor(account.id, new Date().toISOString());

      // Derive memories
      this.deriveCollaboratorMemories(account);
      this.deriveHotRepoMemories(account);

      this.ctx.auditCallback({
        eventType: 'github_sync_completed',
        details: {
          accountId: account.id,
          reposSynced: result.reposSynced,
          prsSynced: result.prsSynced,
          issuesSynced: result.issuesSynced,
          notificationsSynced: result.notificationsSynced,
        },
        severity: 'info',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(message);
      this.ctx.log.error('GitHub sync failed', { accountId: account.id, error: message });
      this.ctx.auditCallback({
        eventType: 'github_sync_failed',
        details: { accountId: account.id, error: message },
        severity: 'error',
      });
    }

    return result;
  }

  private deriveCollaboratorMemories(account: GithubAccountRecord): void {
    const collaborators = this.githubService.getTopCollaborators(account.id);
    for (const collab of collaborators) {
      if (collab.count >= 3 && collab.author !== account.githubUsername) {
        this.ctx.memoryInsert({
          description: `Frequent GitHub collaborator: ${collab.author} (${collab.count} interactions)`,
          classification: 'internal',
          sourceType: 'capability_sync',
          content: `Frequent GitHub collaborator ${collab.author} with ${collab.count} PRs/issues involving account ${account.id}`,
          confidence: Math.min(0.6 + collab.count * 0.02, 0.9),
          scope: 'workspace',
          memoryType: 'semantic',
          sourceRef: `github:${account.id}:collaborator:${collab.author}`,
          sourceRefType: 'github_collaborator',
          domain: 'github',
          contextReleasePolicy: 'summary',
          dedupKey: `github-collaborator:${account.id}:${collab.author}`,
        });
      }
    }
  }

  private deriveHotRepoMemories(account: GithubAccountRecord): void {
    const hotRepos = this.githubService.getHotRepos(account.id);
    for (const repo of hotRepos) {
      if (repo.activity >= 2) {
        this.ctx.memoryInsert({
          description: `Active GitHub repo: ${repo.fullName} (${repo.activity} open PRs)`,
          classification: 'internal',
          sourceType: 'capability_sync',
          content: `Active GitHub repo ${repo.fullName} with ${repo.activity} open PRs for account ${account.id}`,
          confidence: Math.min(0.5 + repo.activity * 0.05, 0.85),
          scope: 'workspace',
          memoryType: 'semantic',
          sourceRef: `github:${account.id}:hot-repo:${repo.repoId}`,
          sourceRefType: 'github_hot_repo',
          domain: 'github',
          contextReleasePolicy: 'summary',
          dedupKey: `github-hot-repo:${account.id}:${repo.repoId}`,
        });
      }
    }
  }

  private redact(text: string): string {
    return redactText(text, this.redactionPatterns).text;
  }
}
