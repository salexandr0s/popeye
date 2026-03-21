import type {
  ActionApprovalRequestInput,
  ApprovalRecord,
  CapabilityContext,
  ConnectionHealthSummary,
  ConnectionRecord,
  ConnectionSyncSummary,
  GithubAccountRecord,
  GithubCommentCreateInput,
  GithubCommentRecord,
  GithubDigestRecord,
  GithubIssueRecord,
  GithubNotificationMarkReadInput,
  GithubNotificationRecord,
  GithubPullRequestRecord,
  GithubRepoRecord,
  GithubSearchQuery,
  GithubSearchResult,
  GithubSyncResult,
  SecurityAuditEvent,
} from '@popeye/contracts';
import { nowIso } from '@popeye/contracts';
import type { GithubApiAdapter } from '@popeye/cap-github';
import { GithubService, GithubSyncService, GithubDigestService } from '@popeye/cap-github';
import BetterSqlite3 from 'better-sqlite3';

import type { CapabilityFacade } from './capability-facade.js';
import type { CapabilityRegistry } from './capability-registry.js';
import { RuntimeNotFoundError, RuntimeValidationError } from './errors.js';
import { connectionCursorKindForProvider } from './row-mappers.js';
import type { PopeyeLogger } from '@popeye/observability';
import type { GithubSearchService as GithubSearchServiceType } from '@popeye/cap-github';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GithubFacadeDeps {
  githubFacade: CapabilityFacade<GithubService, GithubSearchServiceType>;
  capabilityRegistry: CapabilityRegistry;
  capabilityStoresDir: string;
  log: PopeyeLogger;

  // Callbacks for shared RuntimeService helpers
  recordSecurityAudit: (event: SecurityAuditEvent) => void;
  buildCapabilityContext: () => CapabilityContext;
  requireGithubAccountForOperation: (
    service: GithubService,
    accountId: string,
    purpose: string,
  ) => { account: GithubAccountRecord; connection: ConnectionRecord };
  resolveGithubAdapterForConnection: (connectionId: string) => Promise<{
    adapter: GithubApiAdapter;
    account: { id: string; connectionId: string; githubUsername: string };
  } | null>;
  updateConnectionRollups: (input: {
    connectionId: string;
    health?: Partial<ConnectionHealthSummary> | undefined;
    sync?: Partial<ConnectionSyncSummary> | undefined;
  }) => ConnectionRecord | null;
  classifyConnectionFailure: (message: string) => Pick<ConnectionHealthSummary, 'status' | 'authState'>;
  requireReadWriteConnection: (connection: ConnectionRecord, purpose: string) => void;
  requireAllowlistedConnectionResource: (connection: ConnectionRecord, purpose: string, resourceType: string, resourceId: string) => void;
  requireApprovedExternalWrite: (input: ActionApprovalRequestInput) => ApprovalRecord;

  // People ops callback
  refreshPeopleProjectionForGithubAccount: (service: GithubService, accountId: string) => void;
}

// ---------------------------------------------------------------------------
// GithubFacade
// ---------------------------------------------------------------------------

export class GithubFacade {
  private readonly githubFacade: CapabilityFacade<GithubService, GithubSearchServiceType>;
  private readonly capabilityRegistry: CapabilityRegistry;
  private readonly capabilityStoresDir: string;
  private readonly log: PopeyeLogger;
  private readonly recordSecurityAudit: (event: SecurityAuditEvent) => void;
  private readonly buildCapabilityContext: () => CapabilityContext;
  private readonly requireGithubAccountForOperation: GithubFacadeDeps['requireGithubAccountForOperation'];
  private readonly resolveGithubAdapterForConnection: GithubFacadeDeps['resolveGithubAdapterForConnection'];
  private readonly updateConnectionRollups: GithubFacadeDeps['updateConnectionRollups'];
  private readonly classifyConnectionFailure: GithubFacadeDeps['classifyConnectionFailure'];
  private readonly requireReadWriteConnection: GithubFacadeDeps['requireReadWriteConnection'];
  private readonly requireAllowlistedConnectionResource: GithubFacadeDeps['requireAllowlistedConnectionResource'];
  private readonly requireApprovedExternalWrite: GithubFacadeDeps['requireApprovedExternalWrite'];
  private readonly refreshPeopleProjectionForGithubAccount: GithubFacadeDeps['refreshPeopleProjectionForGithubAccount'];

  constructor(deps: GithubFacadeDeps) {
    this.githubFacade = deps.githubFacade;
    this.capabilityRegistry = deps.capabilityRegistry;
    this.capabilityStoresDir = deps.capabilityStoresDir;
    this.log = deps.log;
    this.recordSecurityAudit = deps.recordSecurityAudit;
    this.buildCapabilityContext = deps.buildCapabilityContext;
    this.requireGithubAccountForOperation = deps.requireGithubAccountForOperation;
    this.resolveGithubAdapterForConnection = deps.resolveGithubAdapterForConnection;
    this.updateConnectionRollups = deps.updateConnectionRollups;
    this.classifyConnectionFailure = deps.classifyConnectionFailure;
    this.requireReadWriteConnection = deps.requireReadWriteConnection;
    this.requireAllowlistedConnectionResource = deps.requireAllowlistedConnectionResource;
    this.requireApprovedExternalWrite = deps.requireApprovedExternalWrite;
    this.refreshPeopleProjectionForGithubAccount = deps.refreshPeopleProjectionForGithubAccount;
  }

  // --- Read-only facade methods ---

  listGithubAccounts(): GithubAccountRecord[] {
    return this.githubFacade.getService()?.listAccounts() ?? [];
  }

  listGithubRepos(accountId: string, options?: { limit?: number | undefined }): GithubRepoRecord[] {
    const svc = this.githubFacade.getService();
    if (!svc) return [];
    this.requireGithubAccountForOperation(svc, accountId, 'github_repo_list');
    return svc.listRepos(accountId, options);
  }

  listGithubPullRequests(accountId: string, options?: { state?: string | undefined; limit?: number | undefined; repoId?: string | undefined }): GithubPullRequestRecord[] {
    const svc = this.githubFacade.getService();
    if (!svc) return [];
    this.requireGithubAccountForOperation(svc, accountId, 'github_pr_list');
    return svc.listPullRequests(accountId, options);
  }

  listGithubIssues(accountId: string, options?: { state?: string | undefined; limit?: number | undefined; assignedOnly?: boolean | undefined }): GithubIssueRecord[] {
    const svc = this.githubFacade.getService();
    if (!svc) return [];
    this.requireGithubAccountForOperation(svc, accountId, 'github_issue_list');
    return svc.listIssues(accountId, options);
  }

  listGithubNotifications(accountId: string, options?: { unreadOnly?: boolean | undefined; limit?: number | undefined }): GithubNotificationRecord[] {
    const svc = this.githubFacade.getService();
    if (!svc) return [];
    this.requireGithubAccountForOperation(svc, accountId, 'github_notification_list');
    return svc.listNotifications(accountId, options);
  }

  getGithubPullRequest(id: string): GithubPullRequestRecord | null {
    const svc = this.githubFacade.getService();
    if (!svc) return null;
    const pullRequest = svc.getPullRequest(id);
    if (!pullRequest) return null;
    try {
      this.requireGithubAccountForOperation(svc, pullRequest.accountId, 'github_pr_read');
      return pullRequest;
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return null;
      }
      throw error;
    }
  }

  getGithubIssue(id: string): GithubIssueRecord | null {
    const svc = this.githubFacade.getService();
    if (!svc) return null;
    const issue = svc.getIssue(id);
    if (!issue) return null;
    try {
      this.requireGithubAccountForOperation(svc, issue.accountId, 'github_issue_read');
      return issue;
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return null;
      }
      throw error;
    }
  }

  searchGithub(query: GithubSearchQuery): { query: string; results: GithubSearchResult[] } {
    const svc = this.githubFacade.getService();
    if (query.accountId && svc) {
      this.requireGithubAccountForOperation(svc, query.accountId, 'github_search');
    }
    return this.githubFacade.getSearch()?.search(query) ?? { query: query.query, results: [] };
  }

  getGithubDigest(accountId: string): GithubDigestRecord | null {
    const svc = this.githubFacade.getService();
    if (!svc) return null;
    this.requireGithubAccountForOperation(svc, accountId, 'github_digest_read');
    return svc.getLatestDigest(accountId);
  }

  // --- Mutation methods ---

  async syncGithubAccount(accountId: string): Promise<GithubSyncResult> {
    const githubCap = this.capabilityRegistry.getCapability('github');
    if (!githubCap) throw new Error('GitHub capability not initialized');

    const dbPath = `${this.capabilityStoresDir}/github.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new GithubService(writeDb as unknown as CapabilityContext['appDb']);
      const { account, connection } = this.requireGithubAccountForOperation(svc, accountId, 'github_sync');
      const resolved = await this.resolveGithubAdapterForConnection(connection.id);
      if (!resolved) {
        throw new RuntimeValidationError(`Connection ${connection.id} could not resolve a GitHub adapter`);
      }

      const attemptAt = nowIso();
      this.updateConnectionRollups({
        connectionId: connection.id,
        health: {
          checkedAt: attemptAt,
        },
        sync: {
          lastAttemptAt: attemptAt,
          cursorKind: connectionCursorKindForProvider(connection.providerKind),
        },
      });

      const ctx = this.buildCapabilityContext();
      const syncService = new GithubSyncService(svc, ctx);
      const result = await syncService.syncAccount(account, resolved.adapter);
      const refreshedAccount = svc.getAccount(account.id) ?? account;
      const successCount = result.reposSynced + result.prsSynced + result.issuesSynced + result.notificationsSynced;
      const syncStatus = result.errors.length === 0
        ? 'success'
        : successCount > 0
          ? 'partial'
          : 'failed';
      const failureSummary = result.errors[0] ?? null;
      const failureState = failureSummary ? this.classifyConnectionFailure(failureSummary) : null;
      const successAt = syncStatus === 'failed' ? null : nowIso();

      this.updateConnectionRollups({
        connectionId: connection.id,
        health: failureSummary
          ? {
            status: syncStatus === 'partial' ? 'degraded' : failureState?.status ?? 'error',
            authState: syncStatus === 'partial' ? 'configured' : failureState?.authState ?? 'configured',
            checkedAt: nowIso(),
            lastError: failureSummary,
          }
          : {
            status: 'healthy',
            authState: 'configured',
            checkedAt: nowIso(),
            lastError: null,
          },
        sync: {
          ...(successAt ? { lastSuccessAt: successAt } : {}),
          status: syncStatus,
          cursorKind: connectionCursorKindForProvider(connection.providerKind),
          cursorPresent: Boolean(refreshedAccount.syncCursorSince),
          lagSummary: refreshedAccount.syncCursorSince
            ? `Cursor checkpoint stored at ${refreshedAccount.syncCursorSince}`
            : 'Awaiting first notification checkpoint',
        },
      });

      this.githubFacade.invalidate();
      try {
        this.refreshPeopleProjectionForGithubAccount(svc, account.id);
      } catch (error) {
        this.log.warn('github people projection failed', {
          accountId: account.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return result;
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      const failure = this.classifyConnectionFailure(message);
      const account = this.listGithubAccounts().find((entry) => entry.id === accountId) ?? null;
      if (account) {
        this.updateConnectionRollups({
          connectionId: account.connectionId,
          health: {
            status: failure.status,
            authState: failure.authState,
            checkedAt: nowIso(),
            lastError: message,
          },
          sync: {
            lastAttemptAt: nowIso(),
            status: 'failed',
            cursorKind: 'since',
            lagSummary: 'Sync failed before a checkpoint could be updated',
          },
        });
      }
      throw error;
    } finally {
      writeDb.close();
    }
  }

  triggerGithubDigest(accountId?: string): GithubDigestRecord | null {
    const githubCap = this.capabilityRegistry.getCapability('github');
    if (!githubCap) return null;

    const dbPath = `${this.capabilityStoresDir}/github.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new GithubService(writeDb as unknown as CapabilityContext['appDb']);
      const candidateAccounts = accountId ? [svc.getAccount(accountId)].filter(Boolean) : svc.listAccounts();
      if (candidateAccounts.length === 0) return null;
      const accounts = candidateAccounts.map((account) => {
        if (!account) {
          throw new RuntimeValidationError(`GitHub account ${accountId} not found`);
        }
        return this.requireGithubAccountForOperation(svc, account.id, 'github_digest_generate').account;
      });

      const ctx = this.buildCapabilityContext();
      const digestService = new GithubDigestService(svc, ctx);

      let lastDigest: GithubDigestRecord | null = null;
      for (const account of accounts) {
        if (!account) continue;
        lastDigest = digestService.generateDigest(account);
      }

      this.githubFacade.invalidate();

      return lastDigest;
    } finally {
      writeDb.close();
    }
  }

  async createGithubComment(input: GithubCommentCreateInput): Promise<GithubCommentRecord> {
    const githubCap = this.capabilityRegistry.getCapability('github');
    if (!githubCap) throw new Error('GitHub capability not initialized');

    const repoParts = input.repoFullName.split('/');
    if (repoParts.length !== 2 || !repoParts[0] || !repoParts[1]) {
      throw new RuntimeValidationError(`Invalid GitHub repo full name: ${input.repoFullName}`);
    }
    const [owner, repo] = repoParts;

    const dbPath = `${this.capabilityStoresDir}/github.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new GithubService(writeDb as unknown as CapabilityContext['appDb']);
      const { account, connection } = this.requireGithubAccountForOperation(svc, input.accountId, 'github_comment_create');
      this.requireReadWriteConnection(connection, 'github_comment_create');
      this.requireAllowlistedConnectionResource(connection, 'github_comment_create', 'repo', input.repoFullName);

      const resolved = await this.resolveGithubAdapterForConnection(connection.id);
      if (!resolved?.adapter.createIssueComment) {
        throw new RuntimeValidationError(`Connection ${connection.id} does not support GitHub comments`);
      }

      const approval = this.requireApprovedExternalWrite({
        scope: 'external_write',
        domain: 'github',
        actionKind: 'write',
        resourceScope: 'resource',
        resourceType: 'github_repo',
        resourceId: input.repoFullName,
        requestedBy: 'github_comment_create',
        payloadPreview: `Comment on ${input.repoFullName}#${input.issueNumber}: ${input.body.slice(0, 240)}`,
      });

      const comment = await resolved.adapter.createIssueComment(owner, repo, input.issueNumber, input.body);
      this.recordSecurityAudit({
        code: 'github_comment_created',
        severity: 'info',
        message: 'GitHub comment created',
        component: 'runtime-core',
        timestamp: nowIso(),
        details: {
          connectionId: connection.id,
          accountId: account.id,
          repoFullName: input.repoFullName,
          issueNumber: String(input.issueNumber),
          providerCommentId: comment.id,
          approvalId: approval.id,
          resolvedBy: approval.resolvedBy ?? '',
          resolvedByGrantId: approval.resolvedByGrantId ?? '',
        },
      });

      return {
        id: comment.id,
        accountId: account.id,
        repoFullName: input.repoFullName,
        issueNumber: input.issueNumber,
        bodyPreview: comment.bodyPreview,
        htmlUrl: comment.htmlUrl,
        createdAt: comment.createdAt,
      };
    } finally {
      writeDb.close();
    }
  }

  async markGithubNotificationRead(input: GithubNotificationMarkReadInput): Promise<GithubNotificationRecord> {
    const githubCap = this.capabilityRegistry.getCapability('github');
    if (!githubCap) throw new Error('GitHub capability not initialized');

    const dbPath = `${this.capabilityStoresDir}/github.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new GithubService(writeDb as unknown as CapabilityContext['appDb']);
      const notification = svc.getNotification(input.notificationId);
      if (!notification) {
        throw new RuntimeNotFoundError(`GitHub notification ${input.notificationId} not found`);
      }
      const { account, connection } = this.requireGithubAccountForOperation(
        svc,
        notification.accountId,
        'github_notification_mark_read',
      );
      this.requireReadWriteConnection(connection, 'github_notification_mark_read');
      this.requireAllowlistedConnectionResource(
        connection,
        'github_notification_mark_read',
        'repo',
        notification.repoFullName,
      );

      const resolved = await this.resolveGithubAdapterForConnection(connection.id);
      if (!resolved?.adapter.markNotificationRead) {
        throw new RuntimeValidationError(`Connection ${connection.id} does not support notification mutations`);
      }

      const approval = this.requireApprovedExternalWrite({
        scope: 'external_write',
        domain: 'github',
        actionKind: 'write',
        resourceScope: 'resource',
        resourceType: 'github_notification',
        resourceId: notification.githubNotificationId,
        requestedBy: 'github_notification_mark_read',
        payloadPreview: `Mark GitHub notification as read: ${notification.subjectTitle}`,
      });

      await resolved.adapter.markNotificationRead(notification.githubNotificationId);
      const updated = svc.markNotificationRead(notification.id);
      const record = updated ?? { ...notification, isUnread: false, updatedAt: nowIso() };
      this.githubFacade.invalidate();

      this.recordSecurityAudit({
        code: 'github_notification_marked_read',
        severity: 'info',
        message: 'GitHub notification marked as read',
        component: 'runtime-core',
        timestamp: nowIso(),
        details: {
          connectionId: connection.id,
          accountId: account.id,
          notificationId: notification.id,
          providerNotificationId: notification.githubNotificationId,
          repoFullName: notification.repoFullName,
          approvalId: approval.id,
          resolvedBy: approval.resolvedBy ?? '',
          resolvedByGrantId: approval.resolvedByGrantId ?? '',
        },
      });

      return record;
    } finally {
      writeDb.close();
    }
  }
}
