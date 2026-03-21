import type {
  ActionApprovalRequestInput,
  ApprovalRecord,
  CalendarAccountRecord,
  CalendarAccountRegistrationInput,
  CalendarAvailabilitySlot,
  CalendarDigestRecord,
  CalendarEventCreateInput,
  CalendarEventRecord,
  CalendarEventUpdateInput,
  CalendarSearchQuery,
  CalendarSearchResult,
  CalendarSyncResult,
  CapabilityContext,
  ConnectionHealthSummary,
  ConnectionRecord,
  ConnectionSyncSummary,
  DomainKind,
  SecurityAuditEvent,
} from '@popeye/contracts';
import { nowIso } from '@popeye/contracts';
import type { GoogleCalendarAdapter } from '@popeye/cap-calendar';
import { CalendarService, CalendarSyncService, CalendarDigestService } from '@popeye/cap-calendar';
import type { CalendarSearchService as CalendarSearchServiceType } from '@popeye/cap-calendar';
import BetterSqlite3 from 'better-sqlite3';

import type { CapabilityFacade } from './capability-facade.js';
import type { CapabilityRegistry } from './capability-registry.js';
import { RuntimeNotFoundError, RuntimeValidationError } from './errors.js';
import { connectionCursorKindForProvider } from './row-mappers.js';
import type { PopeyeLogger } from '@popeye/observability';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CalendarFacadeDeps {
  calendarFacade: CapabilityFacade<CalendarService, CalendarSearchServiceType>;
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
  requireCalendarAccountForOperation: (
    service: CalendarService,
    accountId: string,
    purpose: string,
  ) => { account: CalendarAccountRecord; connection: ConnectionRecord };
  resolveCalendarAdapterForConnection: (connectionId: string) => Promise<{
    adapter: GoogleCalendarAdapter;
    account: { id: string; connectionId: string; calendarEmail: string };
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
  refreshPeopleProjectionForCalendarAccount: (service: CalendarService, accountId: string) => void;
}

// ---------------------------------------------------------------------------
// CalendarFacade
// ---------------------------------------------------------------------------

export class CalendarFacade {
  private readonly calendarFacade: CapabilityFacade<CalendarService, CalendarSearchServiceType>;
  private readonly capabilityRegistry: CapabilityRegistry;
  private readonly capabilityStoresDir: string;
  private readonly log: PopeyeLogger;
  private readonly recordSecurityAudit: (event: SecurityAuditEvent) => void;
  private readonly buildCapabilityContext: () => CapabilityContext;
  private readonly requireConnectionForOperation: CalendarFacadeDeps['requireConnectionForOperation'];
  private readonly requireCalendarAccountForOperation: CalendarFacadeDeps['requireCalendarAccountForOperation'];
  private readonly resolveCalendarAdapterForConnection: CalendarFacadeDeps['resolveCalendarAdapterForConnection'];
  private readonly updateConnectionRollups: CalendarFacadeDeps['updateConnectionRollups'];
  private readonly classifyConnectionFailure: CalendarFacadeDeps['classifyConnectionFailure'];
  private readonly requireReadWriteConnection: CalendarFacadeDeps['requireReadWriteConnection'];
  private readonly requireAllowlistedConnectionResource: CalendarFacadeDeps['requireAllowlistedConnectionResource'];
  private readonly requireApprovedExternalWrite: CalendarFacadeDeps['requireApprovedExternalWrite'];
  private readonly refreshPeopleProjectionForCalendarAccount: CalendarFacadeDeps['refreshPeopleProjectionForCalendarAccount'];

  constructor(deps: CalendarFacadeDeps) {
    this.calendarFacade = deps.calendarFacade;
    this.capabilityRegistry = deps.capabilityRegistry;
    this.capabilityStoresDir = deps.capabilityStoresDir;
    this.log = deps.log;
    this.recordSecurityAudit = deps.recordSecurityAudit;
    this.buildCapabilityContext = deps.buildCapabilityContext;
    this.requireConnectionForOperation = deps.requireConnectionForOperation;
    this.requireCalendarAccountForOperation = deps.requireCalendarAccountForOperation;
    this.resolveCalendarAdapterForConnection = deps.resolveCalendarAdapterForConnection;
    this.updateConnectionRollups = deps.updateConnectionRollups;
    this.classifyConnectionFailure = deps.classifyConnectionFailure;
    this.requireReadWriteConnection = deps.requireReadWriteConnection;
    this.requireAllowlistedConnectionResource = deps.requireAllowlistedConnectionResource;
    this.requireApprovedExternalWrite = deps.requireApprovedExternalWrite;
    this.refreshPeopleProjectionForCalendarAccount = deps.refreshPeopleProjectionForCalendarAccount;
  }

  // --- Read-only facade methods ---

  listCalendarAccounts(): CalendarAccountRecord[] {
    return this.calendarFacade.getService()?.listAccounts() ?? [];
  }

  listCalendarEvents(accountId: string, options?: { limit?: number | undefined; dateFrom?: string | undefined; dateTo?: string | undefined }): CalendarEventRecord[] {
    const svc = this.calendarFacade.getService();
    if (!svc) return [];
    this.requireCalendarAccountForOperation(svc, accountId, 'calendar_event_list');
    return svc.listEvents(accountId, options);
  }

  getCalendarEvent(id: string): CalendarEventRecord | null {
    const svc = this.calendarFacade.getService();
    if (!svc) return null;
    const event = svc.getEvent(id);
    if (!event) return null;
    try {
      this.requireCalendarAccountForOperation(svc, event.accountId, 'calendar_event_read');
      return event;
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return null;
      }
      throw error;
    }
  }

  searchCalendar(query: CalendarSearchQuery): { query: string; results: CalendarSearchResult[] } {
    const svc = this.calendarFacade.getService();
    if (query.accountId && svc) {
      this.requireCalendarAccountForOperation(svc, query.accountId, 'calendar_search');
    }
    return this.calendarFacade.getSearch()?.search(query) ?? { query: query.query, results: [] };
  }

  getCalendarDigest(accountId: string): CalendarDigestRecord | null {
    const svc = this.calendarFacade.getService();
    if (!svc) return null;
    this.requireCalendarAccountForOperation(svc, accountId, 'calendar_digest_read');
    return svc.getLatestDigest(accountId);
  }

  getCalendarAvailability(accountId: string, date: string, startHour = 9, endHour = 17, slotMinutes = 30): CalendarAvailabilitySlot[] {
    const svc = this.calendarFacade.getService();
    if (!svc) return [];
    this.requireCalendarAccountForOperation(svc, accountId, 'calendar_availability_read');
    return svc.computeAvailability(accountId, date, startHour, endHour, slotMinutes);
  }

  // --- Mutation methods ---

  registerCalendarAccount(input: CalendarAccountRegistrationInput): CalendarAccountRecord {
    this.requireConnectionForOperation({
      connectionId: input.connectionId,
      purpose: 'calendar_account_register',
      expectedDomain: 'calendar',
      allowedProviderKinds: ['google_calendar'],
      requireSecret: false,
    });

    const calCap = this.capabilityRegistry.getCapability('calendar');
    if (!calCap) throw new Error('Calendar capability not initialized');

    const dbPath = `${this.capabilityStoresDir}/calendar.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new CalendarService(writeDb as unknown as CapabilityContext['appDb']);
      return svc.registerAccount(input);
    } finally {
      writeDb.close();
    }
  }

  async syncCalendarAccount(accountId: string): Promise<CalendarSyncResult> {
    const calCap = this.capabilityRegistry.getCapability('calendar');
    if (!calCap) throw new Error('Calendar capability not initialized');

    const dbPath = `${this.capabilityStoresDir}/calendar.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new CalendarService(writeDb as unknown as CapabilityContext['appDb']);
      const { account, connection } = this.requireCalendarAccountForOperation(svc, accountId, 'calendar_sync');
      const resolved = await this.resolveCalendarAdapterForConnection(connection.id);
      if (!resolved) {
        throw new RuntimeValidationError(`Connection ${connection.id} could not resolve a calendar adapter`);
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
      const syncService = new CalendarSyncService(svc, ctx);
      const result = await syncService.syncAccount(account, resolved.adapter);
      const refreshedAccount = svc.getAccount(account.id) ?? account;
      const successCount = result.eventsSynced + result.eventsUpdated;
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
          cursorPresent: Boolean(refreshedAccount.syncCursorSyncToken),
          lagSummary: refreshedAccount.syncCursorSyncToken
            ? 'Sync token stored for incremental calendar sync'
            : 'Awaiting first calendar sync token',
        },
      });

      this.calendarFacade.invalidate();
      try {
        this.refreshPeopleProjectionForCalendarAccount(svc, account.id);
      } catch (error) {
        this.log.warn('calendar people projection failed', {
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
      const account = this.listCalendarAccounts().find((entry) => entry.id === accountId) ?? null;
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
            cursorKind: 'sync_token',
            lagSummary: 'Sync failed before a sync token could be updated',
          },
        });
      }
      throw error;
    } finally {
      writeDb.close();
    }
  }

  triggerCalendarDigest(accountId?: string): CalendarDigestRecord | null {
    const calCap = this.capabilityRegistry.getCapability('calendar');
    if (!calCap) return null;

    const dbPath = `${this.capabilityStoresDir}/calendar.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new CalendarService(writeDb as unknown as CapabilityContext['appDb']);
      const candidateAccounts = accountId ? [svc.getAccount(accountId)].filter(Boolean) : svc.listAccounts();
      if (candidateAccounts.length === 0) return null;
      const accounts = candidateAccounts.map((account) => {
        if (!account) {
          throw new RuntimeValidationError(`Calendar account ${accountId} not found`);
        }
        return this.requireCalendarAccountForOperation(svc, account.id, 'calendar_digest_generate').account;
      });

      const ctx = this.buildCapabilityContext();
      const digestService = new CalendarDigestService(svc, ctx);

      let lastDigest: CalendarDigestRecord | null = null;
      for (const account of accounts) {
        if (!account) continue;
        lastDigest = digestService.generateDigest(account);
      }

      this.calendarFacade.invalidate();

      return lastDigest;
    } finally {
      writeDb.close();
    }
  }

  async createCalendarEvent(input: CalendarEventCreateInput): Promise<CalendarEventRecord> {
    const calCap = this.capabilityRegistry.getCapability('calendar');
    if (!calCap) throw new Error('Calendar capability not initialized');

    const dbPath = `${this.capabilityStoresDir}/calendar.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new CalendarService(writeDb as unknown as CapabilityContext['appDb']);
      const { account, connection } = this.requireCalendarAccountForOperation(svc, input.accountId, 'calendar_event_create');
      this.requireReadWriteConnection(connection, 'calendar_event_create');
      this.requireAllowlistedConnectionResource(connection, 'calendar_event_create', 'calendar', account.calendarEmail);

      const resolved = await this.resolveCalendarAdapterForConnection(connection.id);
      if (!resolved?.adapter.createEvent) {
        throw new RuntimeValidationError(`Connection ${connection.id} does not support calendar writes`);
      }

      const approval = this.requireApprovedExternalWrite({
        scope: 'external_write',
        domain: 'calendar',
        actionKind: 'write',
        resourceScope: 'resource',
        resourceType: 'calendar',
        resourceId: account.calendarEmail,
        requestedBy: 'calendar_event_create',
        payloadPreview: `Create calendar event: ${input.title}`,
      });

      const event = await resolved.adapter.createEvent({
        title: input.title,
        description: input.description,
        location: input.location,
        startTime: input.startTime,
        endTime: input.endTime,
        attendees: input.attendees,
      });

      const stored = svc.upsertEvent(account.id, {
        googleEventId: event.eventId,
        title: event.title,
        description: event.description,
        location: event.location,
        startTime: event.startTime,
        endTime: event.endTime,
        isAllDay: event.isAllDay,
        status: event.status,
        organizer: event.organizer,
        attendees: event.attendees,
        recurrenceRule: event.recurrenceRule,
        htmlLink: event.htmlLink,
        createdAtGoogle: event.createdAt,
        updatedAtGoogle: event.updatedAt,
      });
      svc.updateEventCount(account.id);
      this.calendarFacade.invalidate();

      this.recordSecurityAudit({
        code: 'calendar_event_created',
        severity: 'info',
        message: 'Calendar event created',
        component: 'runtime-core',
        timestamp: nowIso(),
        details: {
          connectionId: connection.id,
          accountId: account.id,
          calendarEmail: account.calendarEmail,
          providerEventId: event.eventId,
          approvalId: approval.id,
          resolvedBy: approval.resolvedBy ?? '',
          resolvedByGrantId: approval.resolvedByGrantId ?? '',
        },
      });

      return stored;
    } finally {
      writeDb.close();
    }
  }

  async updateCalendarEvent(id: string, input: CalendarEventUpdateInput): Promise<CalendarEventRecord> {
    const calCap = this.capabilityRegistry.getCapability('calendar');
    if (!calCap) throw new Error('Calendar capability not initialized');

    const dbPath = `${this.capabilityStoresDir}/calendar.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new CalendarService(writeDb as unknown as CapabilityContext['appDb']);
      const existing = svc.getEvent(id);
      if (!existing) {
        throw new RuntimeNotFoundError(`Calendar event ${id} not found`);
      }
      const { account, connection } = this.requireCalendarAccountForOperation(svc, existing.accountId, 'calendar_event_update');
      this.requireReadWriteConnection(connection, 'calendar_event_update');
      this.requireAllowlistedConnectionResource(connection, 'calendar_event_update', 'calendar', account.calendarEmail);

      const resolved = await this.resolveCalendarAdapterForConnection(connection.id);
      if (!resolved?.adapter.updateEvent) {
        throw new RuntimeValidationError(`Connection ${connection.id} does not support calendar writes`);
      }

      const approval = this.requireApprovedExternalWrite({
        scope: 'external_write',
        domain: 'calendar',
        actionKind: 'write',
        resourceScope: 'resource',
        resourceType: 'calendar_event',
        resourceId: existing.googleEventId,
        requestedBy: 'calendar_event_update',
        payloadPreview: `Update calendar event: ${existing.title}`,
      });

      const event = await resolved.adapter.updateEvent(existing.googleEventId, input);
      const stored = svc.upsertEvent(account.id, {
        googleEventId: event.eventId,
        title: event.title,
        description: event.description,
        location: event.location,
        startTime: event.startTime,
        endTime: event.endTime,
        isAllDay: event.isAllDay,
        status: event.status,
        organizer: event.organizer,
        attendees: event.attendees,
        recurrenceRule: event.recurrenceRule,
        htmlLink: event.htmlLink,
        createdAtGoogle: event.createdAt,
        updatedAtGoogle: event.updatedAt,
      });
      svc.updateEventCount(account.id);
      this.calendarFacade.invalidate();

      this.recordSecurityAudit({
        code: 'calendar_event_updated',
        severity: 'info',
        message: 'Calendar event updated',
        component: 'runtime-core',
        timestamp: nowIso(),
        details: {
          connectionId: connection.id,
          accountId: account.id,
          calendarEmail: account.calendarEmail,
          providerEventId: event.eventId,
          approvalId: approval.id,
          resolvedBy: approval.resolvedBy ?? '',
          resolvedByGrantId: approval.resolvedByGrantId ?? '',
        },
      });

      return stored;
    } finally {
      writeDb.close();
    }
  }
}
