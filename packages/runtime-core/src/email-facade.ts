import type {
  ActionApprovalRequestInput,
  ApprovalRecord,
  CapabilityContext,
  ConnectionHealthSummary,
  DomainKind,
  ConnectionRecord,
  ConnectionSyncSummary,
  EmailAccountRecord,
  EmailAccountRegistrationInput,
  EmailDigestRecord,
  EmailDraftCreateInput,
  EmailDraftDetailRecord,
  EmailDraftRecord,
  EmailDraftUpdateInput,
  EmailMessageRecord,
  EmailSearchQuery,
  EmailSearchResult,
  EmailSyncResult,
  EmailThreadRecord,
  SecurityAuditEvent,
} from '@popeye/contracts';
import { nowIso } from '@popeye/contracts';
import { EmailService, EmailSyncService, EmailDigestService, type EmailProviderAdapter } from '@popeye/cap-email';
import type { EmailSearchService } from '@popeye/cap-email';
import BetterSqlite3 from 'better-sqlite3';

import type { CapabilityFacade } from './capability-facade.js';
import type { CapabilityRegistry } from './capability-registry.js';
import { RuntimeValidationError } from './errors.js';
import { connectionCursorKindForProvider } from './row-mappers.js';
import type { PopeyeLogger } from '@popeye/observability';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmailFacadeDeps {
  emailFacade: CapabilityFacade<EmailService, EmailSearchService>;
  capabilityRegistry: CapabilityRegistry;
  capabilityStoresDir: string;
  log: PopeyeLogger;

  // Callbacks for shared RuntimeService helpers
  recordSecurityAudit: (event: SecurityAuditEvent) => void;
  buildCapabilityContext: () => CapabilityContext;
  requireConnectionForOperation: (input: {
    connectionId: string;
    purpose: string;
    expectedDomain: DomainKind;
    allowedProviderKinds?: Array<ConnectionRecord['providerKind']>;
    requireSecret?: boolean | undefined;
    runId?: string | undefined;
    jobId?: string | undefined;
    taskId?: string | undefined;
  }) => ConnectionRecord;
  requireEmailAccountForOperation: (
    service: EmailService,
    accountId: string,
    purpose: string,
  ) => { account: EmailAccountRecord; connection: ConnectionRecord };
  resolveEmailAdapterForConnection: (connectionId: string) => Promise<{
    adapter: EmailProviderAdapter;
    account: { id: string; connectionId: string; emailAddress: string };
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
  refreshPeopleProjectionForEmailAccount: (service: EmailService, accountId: string) => void;
}

// ---------------------------------------------------------------------------
// EmailFacade
// ---------------------------------------------------------------------------

export class EmailFacade {
  private readonly emailFacade: CapabilityFacade<EmailService, EmailSearchService>;
  private readonly capabilityRegistry: CapabilityRegistry;
  private readonly capabilityStoresDir: string;
  private readonly log: PopeyeLogger;
  private readonly recordSecurityAudit: (event: SecurityAuditEvent) => void;
  private readonly buildCapabilityContext: () => CapabilityContext;
  private readonly requireConnectionForOperation: EmailFacadeDeps['requireConnectionForOperation'];
  private readonly requireEmailAccountForOperation: EmailFacadeDeps['requireEmailAccountForOperation'];
  private readonly resolveEmailAdapterForConnection: EmailFacadeDeps['resolveEmailAdapterForConnection'];
  private readonly updateConnectionRollups: EmailFacadeDeps['updateConnectionRollups'];
  private readonly classifyConnectionFailure: EmailFacadeDeps['classifyConnectionFailure'];
  private readonly requireReadWriteConnection: EmailFacadeDeps['requireReadWriteConnection'];
  private readonly requireAllowlistedConnectionResource: EmailFacadeDeps['requireAllowlistedConnectionResource'];
  private readonly requireApprovedExternalWrite: EmailFacadeDeps['requireApprovedExternalWrite'];
  private readonly refreshPeopleProjectionForEmailAccount: EmailFacadeDeps['refreshPeopleProjectionForEmailAccount'];

  constructor(deps: EmailFacadeDeps) {
    this.emailFacade = deps.emailFacade;
    this.capabilityRegistry = deps.capabilityRegistry;
    this.capabilityStoresDir = deps.capabilityStoresDir;
    this.log = deps.log;
    this.recordSecurityAudit = deps.recordSecurityAudit;
    this.buildCapabilityContext = deps.buildCapabilityContext;
    this.requireConnectionForOperation = deps.requireConnectionForOperation;
    this.requireEmailAccountForOperation = deps.requireEmailAccountForOperation;
    this.resolveEmailAdapterForConnection = deps.resolveEmailAdapterForConnection;
    this.updateConnectionRollups = deps.updateConnectionRollups;
    this.classifyConnectionFailure = deps.classifyConnectionFailure;
    this.requireReadWriteConnection = deps.requireReadWriteConnection;
    this.requireAllowlistedConnectionResource = deps.requireAllowlistedConnectionResource;
    this.requireApprovedExternalWrite = deps.requireApprovedExternalWrite;
    this.refreshPeopleProjectionForEmailAccount = deps.refreshPeopleProjectionForEmailAccount;
  }

  // --- Helper: open writable email DB ---

  private withWriteDb<T>(fn: (svc: EmailService) => T): T {
    const emailCap = this.capabilityRegistry.getCapability('email');
    if (!emailCap) throw new Error('Email capability not initialized');
    const dbPath = `${this.capabilityStoresDir}/email.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new EmailService(writeDb as unknown as CapabilityContext['appDb']);
      const result = fn(svc);
      this.emailFacade.invalidate();
      return result;
    } finally {
      writeDb.close();
    }
  }

  private async withWriteDbAsync<T>(fn: (svc: EmailService) => Promise<T>): Promise<T> {
    const emailCap = this.capabilityRegistry.getCapability('email');
    if (!emailCap) throw new Error('Email capability not initialized');
    const dbPath = `${this.capabilityStoresDir}/email.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new EmailService(writeDb as unknown as CapabilityContext['appDb']);
      const result = await fn(svc);
      this.emailFacade.invalidate();
      return result;
    } finally {
      writeDb.close();
    }
  }

  // --- Read-only facade methods ---

  listEmailAccounts(): EmailAccountRecord[] {
    return this.emailFacade.getService()?.listAccounts() ?? [];
  }

  listEmailThreads(accountId: string, options?: { limit?: number | undefined; unreadOnly?: boolean | undefined }): EmailThreadRecord[] {
    const svc = this.emailFacade.getService();
    if (!svc) return [];
    this.requireEmailAccountForOperation(svc, accountId, 'email_thread_list');
    return svc.listThreads(accountId, options);
  }

  getEmailThread(id: string): EmailThreadRecord | null {
    const svc = this.emailFacade.getService();
    if (!svc) return null;
    const thread = svc.getThread(id);
    if (!thread) return null;
    try {
      this.requireEmailAccountForOperation(svc, thread.accountId, 'email_thread_read');
      return thread;
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return null;
      }
      throw error;
    }
  }

  searchEmail(query: EmailSearchQuery): { query: string; results: EmailSearchResult[] } {
    const svc = this.emailFacade.getService();
    if (query.accountId && svc) {
      this.requireEmailAccountForOperation(svc, query.accountId, 'email_search');
    }
    return this.emailFacade.getSearch()?.search(query) ?? { query: query.query, results: [] };
  }

  getEmailDigest(accountId: string): EmailDigestRecord | null {
    const svc = this.emailFacade.getService();
    if (!svc) return null;
    this.requireEmailAccountForOperation(svc, accountId, 'email_digest_read');
    return svc.getLatestDigest(accountId);
  }

  listEmailDrafts(accountId: string, options?: { limit?: number | undefined }): EmailDraftRecord[] {
    const svc = this.emailFacade.getService();
    if (!svc) return [];
    this.requireEmailAccountForOperation(svc, accountId, 'email_draft_list');
    return svc.listDrafts(accountId, options);
  }

  async getEmailDraft(id: string): Promise<EmailDraftDetailRecord | null> {
    const svc = this.emailFacade.getService();
    if (!svc) return null;

    const draft = svc.getDraftByProviderDraftId(id) ?? svc.getDraft(id);
    if (!draft) return null;

    let connection: ConnectionRecord;
    try {
      connection = this.requireEmailAccountForOperation(svc, draft.accountId, 'email_draft_read').connection;
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return null;
      }
      throw error;
    }

    const resolved = await this.resolveEmailAdapterForConnection(connection.id);
    if (!resolved?.adapter.getDraft) {
      throw new RuntimeValidationError(`Connection ${connection.id} does not support draft retrieval`);
    }

    const detail = await resolved.adapter.getDraft(draft.providerDraftId);
    return {
      ...draft,
      providerMessageId: detail.messageId ?? draft.providerMessageId,
      to: detail.to,
      cc: detail.cc,
      subject: detail.subject,
      bodyPreview: detail.bodyPreview,
      updatedAt: detail.updatedAt,
      body: detail.body,
    };
  }

  getEmailMessage(id: string): EmailMessageRecord | null {
    const svc = this.emailFacade.getService();
    if (!svc) return null;
    const message = svc.getMessage(id);
    if (!message) return null;
    try {
      this.requireEmailAccountForOperation(svc, message.accountId, 'email_message_read');
      return message;
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return null;
      }
      throw error;
    }
  }

  // --- Mutation methods ---

  registerEmailAccount(input: EmailAccountRegistrationInput): EmailAccountRecord {
    this.requireConnectionForOperation({
      connectionId: input.connectionId,
      purpose: 'email_account_register',
      expectedDomain: 'email',
      allowedProviderKinds: ['gmail', 'proton'],
      requireSecret: false,
    });

    return this.withWriteDb((svc) => svc.registerAccount(input));
  }

  async syncEmailAccount(accountId: string): Promise<EmailSyncResult> {
    const emailCap = this.capabilityRegistry.getCapability('email');
    if (!emailCap) throw new Error('Email capability not initialized');

    const dbPath = `${this.capabilityStoresDir}/email.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new EmailService(writeDb as unknown as CapabilityContext['appDb']);
      const { account, connection } = this.requireEmailAccountForOperation(svc, accountId, 'email_sync');
      const resolved = await this.resolveEmailAdapterForConnection(connection.id);
      if (!resolved) {
        throw new RuntimeValidationError(`Connection ${connection.id} could not resolve an email adapter`);
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
      const syncService = new EmailSyncService(svc, ctx);
      const result = await syncService.syncAccount(account, resolved.adapter);
      const refreshedAccount = svc.getAccount(account.id) ?? account;
      const successCount = result.synced + result.updated;
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
          cursorPresent: Boolean(refreshedAccount.syncCursorHistoryId || refreshedAccount.syncCursorPageToken),
          lagSummary: refreshedAccount.syncCursorHistoryId
            ? `History cursor stored at ${refreshedAccount.syncCursorHistoryId}`
            : refreshedAccount.syncCursorPageToken
              ? 'Pagination cursor stored during mailbox sync'
              : 'Awaiting first sync cursor',
        },
      });

      this.emailFacade.invalidate();
      try {
        this.refreshPeopleProjectionForEmailAccount(svc, account.id);
      } catch (error) {
        this.log.warn('email people projection failed', {
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
      const account = this.listEmailAccounts().find((entry) => entry.id === accountId) ?? null;
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
            cursorKind: 'history_id',
            lagSummary: 'Sync failed before a cursor could be updated',
          },
        });
      }
      throw error;
    } finally {
      writeDb.close();
    }
  }

  triggerEmailDigest(accountId?: string): EmailDigestRecord | null {
    const emailCap = this.capabilityRegistry.getCapability('email');
    if (!emailCap) return null;

    const dbPath = `${this.capabilityStoresDir}/email.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new EmailService(writeDb as unknown as CapabilityContext['appDb']);
      const candidateAccounts = accountId ? [svc.getAccount(accountId)].filter(Boolean) : svc.listAccounts();
      if (candidateAccounts.length === 0) return null;
      const accounts = candidateAccounts.map((account) => {
        if (!account) {
          throw new RuntimeValidationError(`Email account ${accountId} not found`);
        }
        return this.requireEmailAccountForOperation(svc, account.id, 'email_digest_generate').account;
      });

      const ctx = this.buildCapabilityContext();
      const digestService = new EmailDigestService(svc, ctx);

      let lastDigest: EmailDigestRecord | null = null;
      for (const account of accounts) {
        if (!account) continue;
        lastDigest = digestService.generateDigest(account);
      }

      this.emailFacade.invalidate();

      return lastDigest;
    } finally {
      writeDb.close();
    }
  }

  async createEmailDraft(input: EmailDraftCreateInput): Promise<EmailDraftRecord> {
    return this.withWriteDbAsync(async (svc) => {
      const { account, connection } = this.requireEmailAccountForOperation(svc, input.accountId, 'email_draft_create');
      this.requireReadWriteConnection(connection, 'email_draft_create');
      this.requireAllowlistedConnectionResource(connection, 'email_draft_create', 'mailbox', account.emailAddress);

      const resolved = await this.resolveEmailAdapterForConnection(connection.id);
      if (!resolved?.adapter.createDraft) {
        throw new RuntimeValidationError(`Connection ${connection.id} does not support draft creation`);
      }

      const approval = this.requireApprovedExternalWrite({
        scope: 'external_write',
        domain: 'email',
        actionKind: 'write',
        resourceScope: 'resource',
        resourceType: 'email_mailbox',
        resourceId: account.emailAddress,
        requestedBy: 'email_draft_create',
        payloadPreview: `Draft email to ${input.to.join(', ')}: ${input.subject}`,
      });

      const draft = await resolved.adapter.createDraft({
        to: input.to,
        cc: input.cc,
        subject: input.subject,
        body: input.body,
      });
      const stored = svc.upsertDraft({
        accountId: account.id,
        connectionId: connection.id,
        providerDraftId: draft.draftId,
        providerMessageId: draft.messageId ?? null,
        to: draft.to,
        cc: draft.cc,
        subject: draft.subject,
        bodyPreview: draft.bodyPreview,
      });

      this.recordSecurityAudit({
        code: 'email_draft_created',
        severity: 'info',
        message: 'Email draft created',
        component: 'runtime-core',
        timestamp: nowIso(),
        details: {
          connectionId: connection.id,
          accountId: account.id,
          mailbox: account.emailAddress,
          providerDraftId: draft.draftId,
          providerMessageId: draft.messageId ?? '',
          approvalId: approval.id,
          resolvedBy: approval.resolvedBy ?? '',
          resolvedByGrantId: approval.resolvedByGrantId ?? '',
        },
      });

      return {
        ...stored,
        updatedAt: draft.updatedAt,
      };
    });
  }

  async updateEmailDraft(id: string, input: EmailDraftUpdateInput): Promise<EmailDraftRecord> {
    return this.withWriteDbAsync(async (svc) => {
      const mappedDraft = svc.getDraftByProviderDraftId(id) ?? svc.getDraft(id);
      let accountId = mappedDraft?.accountId ?? input.accountId ?? null;
      if (!accountId) {
        throw new RuntimeValidationError(
          `Email draft ${id} is not mapped to an account. Provide accountId or recreate the draft through Popeye.`,
        );
      }
      const account = svc.getAccount(accountId);
      if (!account) {
        throw new RuntimeValidationError(`Email draft ${id} resolves to unknown account ${accountId}`);
      }
      const { connection } = this.requireEmailAccountForOperation(svc, account.id, 'email_draft_update');
      this.requireReadWriteConnection(connection, 'email_draft_update');
      this.requireAllowlistedConnectionResource(connection, 'email_draft_update', 'mailbox', account.emailAddress);

      const resolved = await this.resolveEmailAdapterForConnection(connection.id);
      if (!resolved?.adapter.updateDraft) {
        throw new RuntimeValidationError(`Connection ${connection.id} does not support draft updates`);
      }

      const approval = this.requireApprovedExternalWrite({
        scope: 'external_write',
        domain: 'email',
        actionKind: 'write',
        resourceScope: 'resource',
        resourceType: 'email_draft',
        resourceId: id,
        requestedBy: 'email_draft_update',
        payloadPreview: `Update email draft ${id}`,
      });

      const draft = await resolved.adapter.updateDraft(id, input);
      const stored = svc.upsertDraft({
        accountId: account.id,
        connectionId: connection.id,
        providerDraftId: draft.draftId,
        providerMessageId: draft.messageId ?? null,
        to: draft.to,
        cc: draft.cc,
        subject: draft.subject,
        bodyPreview: draft.bodyPreview,
      });
      this.recordSecurityAudit({
        code: 'email_draft_updated',
        severity: 'info',
        message: 'Email draft updated',
        component: 'runtime-core',
        timestamp: nowIso(),
        details: {
          connectionId: connection.id,
          accountId: account.id,
          mailbox: account.emailAddress,
          providerDraftId: draft.draftId,
          providerMessageId: draft.messageId ?? '',
          approvalId: approval.id,
          resolvedBy: approval.resolvedBy ?? '',
          resolvedByGrantId: approval.resolvedByGrantId ?? '',
        },
      });

      return {
        ...stored,
        updatedAt: draft.updatedAt,
      };
    });
  }
}
