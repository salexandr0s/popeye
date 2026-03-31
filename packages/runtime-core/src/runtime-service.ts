import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import type {
  ActionApprovalRequestInput,
  AgentProfileRecord,
  AppConfig,
  ApprovalRecord,
  ApprovalResolveInput,
  CompiledInstructionBundle,
  ConnectionCreateInput,
  ConnectionDiagnosticsResponse,
  ConnectionHealthSummary,
  ConnectionRecord,
  ConnectionRemediationAction,
  ConnectionResourceRule,
  ConnectionSyncSummary,
  ConnectionUpdateInput,
  ContextReleaseDecision,
  ContextReleasePreview,
  DaemonStateRecord,
  DaemonStatusResponse,
  DomainKind,
  EngineCapabilities,
  ExecutionEnvelope,
  IntegrityReport,
  InterventionRecord,
  JobLeaseRecord,
  JobRecord,
  MemoryAuditResponse,
  MemoryRecord,
  MemorySearchQuery,
  MemorySearchResponse,
  MemoryType,
  MessageIngressResponse,
  MessageRecord,
  ProjectRecord,
  ProjectRegistrationInput,
  RecallDetail,
  RecallQuery,
  RecallSearchResponse,
  RecallSourceKind,
  ReceiptRecord,
  ReceiptTimelineEvent,
  RunEventRecord,
  RunReply,
  RunRecord,
  SchedulerStatusResponse,
  SecretRefRecord,
  SecurityAuditEvent,
  SecurityPolicyResponse,
  TaskCreateInput,
  TaskRecord,
  TelegramDeliveryState,
  TelegramDeliveryRecord,
  TelegramDeliveryResolutionRecord,
  TelegramDeliveryResolutionRequest,
  TelegramRelayCheckpoint,
  TelegramRelayCheckpointCommitRequest,
  TelegramSendAttemptRecord,
  UsageSummary,
  AnalyticsGranularity,
  AnalyticsUsageResponse,
  AnalyticsModelsResponse,
  AnalyticsProjectsResponse,
  SessionSearchQuery,
  SessionSearchResponse,
  TrajectoryFormat,
  DelegationTreeNode,
  VaultRecord,
  WorkspaceRecord,
  WorkspaceRegistrationInput,
  OAuthConnectStartRequest,
  OAuthSessionRecord,
  PlaybookDetail,
  PlaybookEffectiveness,
  PlaybookLifecycleActionRequest,
  PlaybookProposalApplyRequest,
  PlaybookProposalCreateRequest,
  PlaybookProposalKind,
  PlaybookProposalRecord,
  PlaybookProposalReviewRequest,
  PlaybookProposalSubmitReviewRequest,
  PlaybookProposalUpdateRequest,
  PlaybookRecord,
  PlaybookRevisionRecord,
  PlaybookSearchResult,
  PlaybookScope,
  PlaybookStaleCandidate,
  PlaybookSuggestPatchRequest,
  PlaybookStatus,
  PlaybookUsageRunRecord,
} from '@popeye/contracts';
import type {
  CapabilityContext,
  CapabilityModule,
  CapabilityDescriptor,
  FileRootRecord,
  FileRootRegistrationInput,
  FileRootUpdateInput,
  FileDocumentRecord,
  FileSearchQuery,
  FileSearchResponse,
  FileIndexResult,
  FileWriteIntentCreateInput,
  FileWriteIntentRecord,
  FileWriteIntentReviewInput,
  EmailAccountRecord,
  EmailThreadRecord,
  EmailMessageRecord,
  EmailDigestRecord,
  EmailSearchQuery,
  EmailSearchResult,
  EmailAccountRegistrationInput,
  EmailDraftCreateInput,
  EmailDraftRecord,
  EmailDraftUpdateInput,
  EmailSyncResult,
  GithubAccountRecord,
  GithubCommentCreateInput,
  GithubCommentRecord,
  GithubRepoRecord,
  GithubPullRequestRecord,
  GithubIssueRecord,
  GithubNotificationMarkReadInput,
  GithubNotificationRecord,
  GithubDigestRecord,
  GithubSearchQuery,
  GithubSearchResult,
  GithubSyncResult,
  CalendarAccountRecord,
  CalendarEventCreateInput,
  CalendarEventRecord,
  CalendarDigestRecord,
  CalendarSearchQuery,
  CalendarSearchResult,
  CalendarAccountRegistrationInput,
  CalendarEventUpdateInput,
  CalendarSyncResult,
  CalendarAvailabilitySlot,
  TodoAccountRecord,
  TodoAccountRegistrationInput,
  TodoItemRecord,
  TodoDigestRecord,
  TodoSearchQuery,
  TodoSearchResult,
  TodoProjectRecord,
  TodoReconcileResult,
  TodoSyncResult,
  TodoCreateInput,
  TodoistConnectInput,
  TodoistConnectResult,
  PersonActivityRollup,
  PersonIdentityAttachInput,
  PersonIdentityDetachInput,
  PersonListItem,
  PersonMergeEventRecord,
  PersonMergeInput,
  PersonMergeSuggestion,
  PersonRecord,
  PersonSearchQuery,
  PersonSearchResult,
  PersonSplitInput,
  PersonUpdateInput,
  FinanceImportRecord,
  FinanceTransactionRecord,
  FinanceDocumentRecord,
  FinanceDigestRecord,
  FinanceSearchQuery,
  FinanceSearchResult,
  MedicalImportRecord,
  MedicalAppointmentRecord,
  MedicalMedicationRecord,
  MedicalDocumentRecord,
  MedicalDigestRecord,
  MedicalSearchResult,
} from '@popeye/contracts';
import {
  RunReplySchema,
  TaskCreateInputSchema,
} from '@popeye/contracts';
import {
  createEngineAdapter,
  type EngineAdapter,
  type EngineRunCompletion,
  type RuntimeToolDescriptor,
} from '@popeye/engine-pi';
import {
  MemorySearchService,
  createDisabledEmbeddingClient,
  createOpenAIEmbeddingClient,
  createOpenAISummarizationClient,
  createDisabledSummarizationClient,
  loadSqliteVec,
} from '@popeye/memory';
import { createLogger, redactText, type PopeyeLogger } from '@popeye/observability';
import { TaskManager } from '@popeye/scheduler';
import { SessionService } from '@popeye/sessions';

import { ReceiptManager, buildCanonicalRunReply } from '@popeye/receipts';

import { WorkspaceRegistry } from '@popeye/workspace';

import { openRuntimeDatabases, type RuntimeDatabases } from './database.js';
import { MemoryLifecycleService, type MemoryInsertInput } from './memory-lifecycle.js';
import { MessageIngestionService, MessageIngressError } from './message-ingestion.js';
import { QueryService } from './query-service.js';
import { SecretStore } from './secret-store.js';
import { OAuthSessionService } from './oauth-session-service.js';
import { ApprovalService } from './approval-service.js';
import { ActionPolicyEvaluator } from './action-policy-evaluator.js';
import { type VaultHandle, VaultManager } from './vault-manager.js';
import { ContextReleaseService } from './context-release-service.js';
import { ReceiptBuilder } from './receipt-builder.js';
import { RunExecutor, type RunExecutorDeps } from './run-executor.js';
import { loadPlugins } from './plugin-loader.js';
import { searchRunEvents as searchRunEventsFn } from './run-event-search.js';
import { formatTrajectoryJsonl, formatTrajectoryShareGPT } from './trajectory-export.js';
import { TelegramDeliveryService } from './telegram-delivery.js';
import { CapabilityFacade } from './capability-facade.js';
import { CapabilityRegistry } from './capability-registry.js';
import { ConnectionService, type ConnectionServiceDeps } from './connection-service.js';
import { MemoryFacade } from './memory-facade.js';
import { RecallService } from './recall-service.js';
import { PlaybookService } from './playbook-service.js';
import { PeopleFacade } from './people-facade.js';
import { EmailFacade } from './email-facade.js';
import { GithubFacade } from './github-facade.js';
import { CalendarFacade } from './calendar-facade.js';
import { TodoFacade } from './todo-facade.js';
import { OAuthConnectService } from './oauth-connect.js';
import { createFilesCapability, FileRootService, FileIndexer, FileSearchService } from '@popeye/cap-files';
import { createEmailCapability, EmailService, EmailSearchService, type EmailProviderAdapter } from '@popeye/cap-email';
import type { GithubApiAdapter } from '@popeye/cap-github';
import { createGithubCapability, GithubService, GithubSearchService } from '@popeye/cap-github';
import type { GoogleCalendarAdapter } from '@popeye/cap-calendar';
import { createCalendarCapability, CalendarService, CalendarSearchService } from '@popeye/cap-calendar';
import { createTodosCapability, TodoService, TodoSearchService } from '@popeye/cap-todos';
import { createPeopleCapability, PeopleService } from '@popeye/cap-people';
import { createFinanceCapability, FinanceService, FinanceSearchService } from '@popeye/cap-finance';
import { createMedicalCapability, MedicalService, MedicalSearchService } from '@popeye/cap-medical';
import BetterSqlite3 from 'better-sqlite3';
import {
  clearBrowserSessions,
  createBrowserSession as createRuntimeBrowserSession,
  type BrowserSessionValidationResult,
  validateBrowserSession as validateRuntimeBrowserSession,
} from './browser-sessions.js';
import {
  computeEffectiveContextReleaseLevel,
  validateProfileTaskContext,
} from './execution-envelopes.js';
import type {
  OAuthTokenPayload,
} from './provider-oauth.js';

import { nowIso, DOMAIN_POLICY_DEFAULTS } from '@popeye/contracts';
import { z } from 'zod';
import safe from 'safe-regex2';
import { initAuthStore, readAuthStore, readRoleAuthStore, rotateAuthStore } from './auth.js';

import {
  buildReceiptFallbackReplyText,
  buildTimelineMetadata,
  canonicalizeLocalPath,
  classifyFailureFromMessage,
  IdRowSchema,
  isPathWithinRoot,
  isTerminalJobStatus,
  isTerminalRunState,
  JobIdRowSchema,
  mapExecutionEnvelopeRow,
  mapRunEventDetail,
  mapRunEventRow,
  mapRunEventTitle,
  mapRunRow,
  mapSecurityAuditKind,
  parseCountRow,
  parseCreatedAt,
  parseRunEventPayload,
  ProjectPathRowSchema,
  RunEventRowSchema,
  RunRowSchema,
  ScheduleRowSchema,
  titleCase,
  WorkspacePathRowSchema,
  type StoredOAuthSecret,
} from './row-mappers.js';

export { classifyFailureFromMessage, MessageIngressError };
export { RuntimeNotFoundError, RuntimeConflictError, RuntimeValidationError } from './errors.js';
import { RuntimeNotFoundError, RuntimeConflictError, RuntimeValidationError } from './errors.js';


export interface RuntimeEvent {
  event: string;
  data: string;
}

interface SchedulerInternals {
  running: boolean;
  tickTimer: ReturnType<typeof setInterval> | null;
  leaseTimer: ReturnType<typeof setInterval> | null;
  tickIntervalMs: number;
  leaseRefreshIntervalMs: number;
  leaseTtlMs: number;
  shutdownGraceMs: number;
  lastSchedulerTickAt: string | null;
  lastLeaseSweepAt: string | null;
}

export class PopeyeRuntimeService {
  readonly events = new EventEmitter();
  readonly databases: RuntimeDatabases;
  readonly engine: EngineAdapter;
  readonly startedAt: string;
  readonly config: AppConfig;
  private closed = false;

  private readonly memorySearch: MemorySearchService;
  private readonly memoryLifecycle: MemoryLifecycleService;
  private memoryMaintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private docIndexTimer: ReturnType<typeof setInterval> | null = null;
  private tokenRotationTimer: ReturnType<typeof setInterval> | null = null;
  private readonly vecInitPromise: Promise<void>;

  private readonly log: PopeyeLogger;
  private readonly runExecutor: RunExecutor;
  private readonly scheduler: SchedulerInternals = {
    running: false,
    tickTimer: null,
    leaseTimer: null,
    tickIntervalMs: 250,
    leaseRefreshIntervalMs: 15_000,
    leaseTtlMs: 60_000,
    shutdownGraceMs: 30_000,
    lastSchedulerTickAt: null,
    lastLeaseSweepAt: null,
  };

  readonly startupProfile: { dbReadyMs: number; reconcileMs: number; schedulerReadyMs: number };

  // --- Delegate modules ---
  private readonly workspaceRegistry: WorkspaceRegistry;
  private readonly sessionService: SessionService;
  private readonly receiptManager: ReceiptManager;
  private readonly messageIngestion: MessageIngestionService;
  private readonly taskManager: TaskManager;
  private readonly queryService: QueryService;
  private readonly secretStore: SecretStore;
  private readonly oauthSessionService: OAuthSessionService;
  private readonly approvalService: ApprovalService;
  private readonly actionPolicyEvaluator: ActionPolicyEvaluator;
  private readonly vaultManager: VaultManager;
  private readonly contextReleaseService: ContextReleaseService;
  private readonly receiptBuilder: ReceiptBuilder;
  private readonly playbookService: PlaybookService;
  private readonly telegramDelivery: TelegramDeliveryService;
  private readonly capabilityRegistry: CapabilityRegistry;
  private readonly connectionService: ConnectionService;
  private readonly oauthConnect: OAuthConnectService;
  private readonly memoryOps: MemoryFacade;
  private readonly recallService: RecallService;
  private readonly peopleOps: PeopleFacade;
  private readonly emailOps: EmailFacade;
  private readonly githubOps: GithubFacade;
  private readonly calendarOps: CalendarFacade;
  private readonly todoOps: TodoFacade;
  private readonly pluginTools: RuntimeToolDescriptor[] = [];
  private capabilityInitPromise: Promise<void> | null = null;
  private approvalExpiryTimer: ReturnType<typeof setInterval> | null = null;

  // Capability facades — lazy read-only DB + service/search caches
  private readonly emailFacade: CapabilityFacade<EmailService, EmailSearchService>;
  private readonly githubFacade: CapabilityFacade<GithubService, GithubSearchService>;
  private readonly calendarFacade: CapabilityFacade<CalendarService, CalendarSearchService>;
  private readonly todosFacade: CapabilityFacade<TodoService, TodoSearchService>;
  private readonly peopleFacade: CapabilityFacade<PeopleService>;
  private readonly financeFacade: CapabilityFacade<FinanceService, FinanceSearchService>;
  private readonly medicalFacade: CapabilityFacade<MedicalService, MedicalSearchService>;

  private static validateRegexPatterns(config: AppConfig): void {
    const fields: Array<{ name: string; patterns: string[] }> = [
      { name: 'redactionPatterns', patterns: config.security.redactionPatterns ?? [] },
      { name: 'promptScanQuarantinePatterns', patterns: config.security.promptScanQuarantinePatterns ?? [] },
      { name: 'promptScanSanitizePatterns', patterns: (config.security.promptScanSanitizePatterns ?? []).map((p) => p.pattern) },
    ];
    for (const field of fields) {
      for (const pattern of field.patterns) {
        let regex: RegExp;
        try {
          regex = new RegExp(pattern, 'g');
        } catch (err: unknown) {
          const msg = err instanceof SyntaxError ? err.message : String(err);
          throw new Error(`Invalid regex in security.${field.name}: pattern "${pattern}" — ${msg}`, { cause: err });
        }
        if (!safe(regex)) {
          throw new Error(`ReDoS-vulnerable regex in security.${field.name}: pattern "${pattern}"`);
        }
      }
    }
  }

  constructor(config: AppConfig, engineOverride?: EngineAdapter, loggerOverride?: PopeyeLogger) {
    const startupStart = performance.now();
    if (config.security.bindHost !== '127.0.0.1') {
      throw new Error(`Popeye requires config.security.bindHost to be 127.0.0.1, received ${config.security.bindHost}`);
    }
    PopeyeRuntimeService.validateRegexPatterns(config);
    this.config = config;
    this.log = loggerOverride ?? createLogger('runtime', config.security.redactionPatterns);
    initAuthStore(config.authFile);
    this.startedAt = nowIso();
    this.databases = openRuntimeDatabases(config);
    this.engine = engineOverride ?? createEngineAdapter(config);
    const dbReadyMs = Math.round(performance.now() - startupStart);

    // Initialize memory services
    const embeddingClient = config.embeddings.provider === 'openai'
      ? createOpenAIEmbeddingClient({ model: config.embeddings.model, dimensions: config.embeddings.dimensions })
      : createDisabledEmbeddingClient();
    this.memorySearch = new MemorySearchService({
      db: this.databases.memory,
      embeddingClient,
      halfLifeDays: config.memory.confidenceHalfLifeDays,
      budgetConfig: config.memory.budgetAllocation,
      redactionPatterns: config.security.redactionPatterns,
      logger: this.log,
    });
    const summarizationClient = config.embeddings.provider === 'openai'
      ? createOpenAISummarizationClient({})
      : createDisabledSummarizationClient();
    this.memoryLifecycle = new MemoryLifecycleService(this.databases, config, this.memorySearch, summarizationClient);

    // Initialize memory facade
    this.memoryOps = new MemoryFacade({
      memoryDb: this.databases.memory,
      memorySearch: this.memorySearch,
      memoryLifecycle: this.memoryLifecycle,
      redactionPatterns: config.security.redactionPatterns,
      expandTokenCap: config.memory.expandTokenCap,
      recordSecurityAudit: (event) => this.recordSecurityAudit(event),
    });
    this.recallService = new RecallService({
      appDb: this.databases.app,
      searchMemory: (query) => this.searchMemory(query),
      getMemory: (memoryId) => this.getMemory(memoryId),
    });

    // Try loading sqlite-vec (non-blocking)
    this.vecInitPromise = loadSqliteVec(this.databases.memory, this.log).then(() => {});

    // Initialize delegate modules
    this.workspaceRegistry = new WorkspaceRegistry({ app: this.databases.app, paths: this.databases.paths });
    this.sessionService = new SessionService({ app: this.databases.app });

    // Initialize policy substrate services
    const sevMap: Record<string, 'info' | 'warn' | 'error'> = { info: 'info', warning: 'warn', warn: 'warn', error: 'error' };
    const auditCallback = (event: { eventType: string; details: Record<string, unknown>; severity: string }) => {
      this.recordSecurityAudit({
        code: event.eventType,
        severity: sevMap[event.severity] ?? 'info',
        message: event.eventType,
        component: 'policy-substrate',
        timestamp: nowIso(),
        details: Object.fromEntries(Object.entries(event.details).map(([k, v]) => [k, String(v)])),
      });
    };
    this.secretStore = new SecretStore(this.databases.app, this.log, this.databases.paths, auditCallback);
    this.oauthSessionService = new OAuthSessionService(this.databases.app);
    this.approvalService = new ApprovalService(
      this.databases.app,
      this.log,
      auditCallback,
      (event, data) => this.emit(event, data),
      { pendingExpiryMinutes: config.approvalPolicy?.pendingExpiryMinutes ?? 60 },
    );
    this.actionPolicyEvaluator = new ActionPolicyEvaluator(config.approvalPolicy);
    this.vaultManager = new VaultManager(this.databases.app, this.log, this.databases.paths, auditCallback);
    this.contextReleaseService = new ContextReleaseService(this.databases.app, this.log, auditCallback);
    this.connectionService = new ConnectionService({
      db: this.databases.app as unknown as ConnectionServiceDeps['db'],
      secretStore: this.secretStore,
      config: this.config,
      actionPolicyEvaluator: this.actionPolicyEvaluator,
      capabilityStoresDir: this.databases.paths.capabilityStoresDir,
      log: this.log,
      auditCallback: (event) => this.recordSecurityAudit(event),
    });
    this.oauthConnect = new OAuthConnectService({
      oauthSessionService: this.oauthSessionService,
      connectionService: this.connectionService,
      config: this.config,
      capabilityStoresDir: this.databases.paths.capabilityStoresDir,
      log: this.log,
    });
    this.playbookService = new PlaybookService(
      this.databases.app,
      this.databases.paths,
      this.workspaceRegistry,
      this.config,
      (event) => this.recordSecurityAudit(event),
    );
    this.receiptBuilder = new ReceiptBuilder({
      db: this.databases.app,
      listRunEvents: (runId) => this.listRunEvents(runId),
      getRun: (runId) => this.getRun(runId),
      getTask: (taskId) => this.getTask(taskId),
      getExecutionEnvelope: (runId) => this.getExecutionEnvelope(runId),
      summarizeRunReleases: (runId) => this.summarizeRunReleases(runId),
      listPlaybookUsage: (runId) => this.playbookService.listUsageForRun(runId),
      contextReleaseService: this.contextReleaseService,
      approvalService: this.approvalService,
    });
    this.telegramDelivery = new TelegramDeliveryService(
      this.databases.app,
      this.log,
      {
        getWorkspace: (id) => this.getWorkspace(id),
        createIntervention: (code, runId, reason) => this.createIntervention(code, runId, reason),
        resolveIntervention: (id, note) => this.resolveIntervention(id, note),
        emit: (event, payload) => this.emit(event, payload),
      },
    );

    this.receiptManager = new ReceiptManager(this.databases, config, {
      captureMemory: (input) => this.memoryLifecycle.insertMemory(input),
    });
    this.taskManager = new TaskManager(this.databases, {
      emit: (event, payload) => this.emit(event, payload),
      processSchedulerTick: () => this.processSchedulerTick(),
    });
    this.messageIngestion = new MessageIngestionService(this.databases, config, {
      recordSecurityAudit: (event) => this.recordSecurityAudit(event),
      createTask: (input) => this.createTask({ ...input, profileId: 'default' }),
      createIntervention: (code, runId, reason) => this.createIntervention(code, runId, reason),
    });
    const self = this;
    this.queryService = new QueryService(this.databases, config, {
      get schedulerRunning() { return self.scheduler.running; },
      get activeRunsCount() { return self.runExecutor.activeRunCount; },
      get startedAt() { return self.startedAt; },
      get lastSchedulerTickAt() { return self.scheduler.lastSchedulerTickAt; },
      get lastLeaseSweepAt() { return self.scheduler.lastLeaseSweepAt; },
      getEngineCapabilities: () => this.engine.getCapabilities(),
      computeNextHeartbeatDueAt: () => this.computeNextHeartbeatDueAt(),
    }, this.workspaceRegistry, this.playbookService);

    const clearedBrowserSessions = clearBrowserSessions(this.databases.app);
    if (clearedBrowserSessions > 0) {
      this.recordSecurityAudit({
        code: 'browser_sessions_cleared_on_startup',
        severity: 'info',
        message: `Cleared ${clearedBrowserSessions} browser session(s) during startup`,
        component: 'runtime-core',
        timestamp: nowIso(),
        details: { cleared: String(clearedBrowserSessions) },
      });
    }

    // Initialize capability registry
    this.capabilityRegistry = new CapabilityRegistry({
      appDb: this.databases.app,
      memoryDb: this.databases.memory,
      log: this.log,
      buildContext: () => this.buildCapabilityContext(),
    });

    // Register built-in capabilities
    this.capabilityRegistry.register(createFilesCapability());
    this.capabilityRegistry.register(createEmailCapability());
    this.capabilityRegistry.register(createGithubCapability());
    this.capabilityRegistry.register(createCalendarCapability());
    this.capabilityRegistry.register(createTodosCapability());
    this.capabilityRegistry.register(createPeopleCapability());
    this.capabilityRegistry.register(createFinanceCapability());
    this.capabilityRegistry.register(createMedicalCapability());

    // Initialize capability facades (lazy read-only DB + service/search caches)
    const storesDir = this.databases.paths.capabilityStoresDir;
    this.emailFacade = new CapabilityFacade(
      this.capabilityRegistry, storesDir, 'email', 'email.db',
      (db) => new EmailService(db),
      (db) => new EmailSearchService(db),
    );
    this.githubFacade = new CapabilityFacade(
      this.capabilityRegistry, storesDir, 'github', 'github.db',
      (db) => new GithubService(db),
      (db) => new GithubSearchService(db),
    );
    this.calendarFacade = new CapabilityFacade(
      this.capabilityRegistry, storesDir, 'calendar', 'calendar.db',
      (db) => new CalendarService(db),
      (db) => new CalendarSearchService(db),
    );
    this.todosFacade = new CapabilityFacade(
      this.capabilityRegistry, storesDir, 'todos', 'todos.db',
      (db) => new TodoService(db),
      (db) => new TodoSearchService(db),
    );
    this.peopleFacade = new CapabilityFacade(
      this.capabilityRegistry, storesDir, 'people', 'people.db',
      (db) => new PeopleService(db),
    );
    this.peopleOps = new PeopleFacade({
      peopleFacade: this.peopleFacade,
      capabilityRegistry: this.capabilityRegistry,
      capabilityStoresDir: storesDir,
      recordSecurityAudit: (event) => this.recordSecurityAudit(event),
    });
    this.emailOps = new EmailFacade({
      emailFacade: this.emailFacade,
      capabilityRegistry: this.capabilityRegistry,
      capabilityStoresDir: storesDir,
      log: this.log,
      recordSecurityAudit: (event) => this.recordSecurityAudit(event),
      buildCapabilityContext: () => this.buildCapabilityContext(),
      requireConnectionForOperation: (input) => this.requireConnectionForOperation(input),
      requireEmailAccountForOperation: (svc, accountId, purpose) => this.requireEmailAccountForOperation(svc, accountId, purpose),
      resolveEmailAdapterForConnection: (connectionId) => this.resolveEmailAdapterForConnection(connectionId),
      updateConnectionRollups: (input) => this.updateConnectionRollups(input),
      classifyConnectionFailure: (message) => this.classifyConnectionFailure(message),
      requireReadWriteConnection: (connection, purpose) => this.requireReadWriteConnection(connection, purpose),
      requireAllowlistedConnectionResource: (connection, purpose, resourceType, resourceId) => this.requireAllowlistedConnectionResource(connection, purpose, resourceType, resourceId),
      requireApprovedExternalWrite: (input) => this.requireApprovedExternalWrite(input),
      refreshPeopleProjectionForEmailAccount: (svc, accountId) => this.peopleOps.refreshPeopleProjectionForEmailAccount(svc, accountId),
    });
    this.githubOps = new GithubFacade({
      githubFacade: this.githubFacade,
      capabilityRegistry: this.capabilityRegistry,
      capabilityStoresDir: storesDir,
      log: this.log,
      recordSecurityAudit: (event) => this.recordSecurityAudit(event),
      buildCapabilityContext: () => this.buildCapabilityContext(),
      requireGithubAccountForOperation: (svc, accountId, purpose) => this.requireGithubAccountForOperation(svc, accountId, purpose),
      resolveGithubAdapterForConnection: (connectionId) => this.resolveGithubAdapterForConnection(connectionId),
      updateConnectionRollups: (input) => this.updateConnectionRollups(input),
      classifyConnectionFailure: (message) => this.classifyConnectionFailure(message),
      requireReadWriteConnection: (connection, purpose) => this.requireReadWriteConnection(connection, purpose),
      requireAllowlistedConnectionResource: (connection, purpose, resourceType, resourceId) => this.requireAllowlistedConnectionResource(connection, purpose, resourceType, resourceId),
      requireApprovedExternalWrite: (input) => this.requireApprovedExternalWrite(input),
      refreshPeopleProjectionForGithubAccount: (svc, accountId) => this.peopleOps.refreshPeopleProjectionForGithubAccount(svc, accountId),
    });
    this.calendarOps = new CalendarFacade({
      calendarFacade: this.calendarFacade,
      capabilityRegistry: this.capabilityRegistry,
      capabilityStoresDir: storesDir,
      log: this.log,
      recordSecurityAudit: (event) => this.recordSecurityAudit(event),
      buildCapabilityContext: () => this.buildCapabilityContext(),
      requireConnectionForOperation: (input) => this.requireConnectionForOperation(input),
      requireCalendarAccountForOperation: (svc, accountId, purpose) => this.requireCalendarAccountForOperation(svc, accountId, purpose),
      resolveCalendarAdapterForConnection: (connectionId) => this.resolveCalendarAdapterForConnection(connectionId),
      updateConnectionRollups: (input) => this.updateConnectionRollups(input),
      classifyConnectionFailure: (message) => this.classifyConnectionFailure(message),
      requireReadWriteConnection: (connection, purpose) => this.requireReadWriteConnection(connection, purpose),
      requireAllowlistedConnectionResource: (connection, purpose, resourceType, resourceId) => this.requireAllowlistedConnectionResource(connection, purpose, resourceType, resourceId),
      requireApprovedExternalWrite: (input) => this.requireApprovedExternalWrite(input),
      refreshPeopleProjectionForCalendarAccount: (svc, accountId) => this.peopleOps.refreshPeopleProjectionForCalendarAccount(svc, accountId),
    });
    this.todoOps = new TodoFacade({
      todosFacade: this.todosFacade,
      capabilityRegistry: this.capabilityRegistry,
      capabilityStoresDir: storesDir,
      log: this.log,
      buildCapabilityContext: () => this.buildCapabilityContext(),
      requireConnectionForOperation: (input) => this.requireConnectionForOperation(input),
      requireTodoAccountForOperation: (svc, accountId, purpose, options) => this.requireTodoAccountForOperation(svc, accountId, purpose, options),
      updateConnectionRollups: (input) => this.updateConnectionRollups(input),
      listConnections: (domain) => this.listConnections(domain),
      createConnection: (input) => this.createConnection(input),
      updateConnection: (id, input) => this.updateConnection(id, input),
      setSecret: (input) => this.secretStore.setSecret(input),
      rotateSecret: (id, newValue) => this.secretStore.rotateSecret(id, newValue),
      getSecretValue: (id) => this.secretStore.getSecretValue(id),
    });
    this.financeFacade = new CapabilityFacade(
      this.capabilityRegistry, storesDir, 'finance', 'finance.db',
      (db) => new FinanceService(db),
      (db) => new FinanceSearchService(db),
    );
    this.medicalFacade = new CapabilityFacade(
      this.capabilityRegistry, storesDir, 'medical', 'medical.db',
      (db) => new MedicalService(db),
      (db) => new MedicalSearchService(db),
    );

    // Defer async initialization (similar to vecInitPromise pattern)
    this.capabilityInitPromise = this.capabilityRegistry.initializeAll().catch((err) => {
      this.log.error('capability initialization failed', { error: err instanceof Error ? err.message : String(err) });
    });

    // Load operator plugins
    if (this.config.plugins?.enabled) {
      const pluginsDir = this.config.plugins.directory ?? this.databases.paths.pluginsDir;
      try {
        const loaded = loadPlugins(pluginsDir, this.log);
        for (const plugin of loaded) {
          this.pluginTools.push(...plugin.tools);
        }
        this.log.info('plugins loaded', { count: this.pluginTools.length });
      } catch (err) {
        this.log.error('plugin loading failed', { error: err instanceof Error ? err.message : String(err) });
      }
    }

    this.runExecutor = new RunExecutor({
      // better-sqlite3's Statement union type requires a structural cast here
      db: this.databases.app as RunExecutorDeps['db'],
      config: this.config,
      log: this.log,
      getEngine: () => this.engine,
      stateDir: this.databases.paths.stateDir,
      getJob: (id) => this.getJob(id),
      getTask: (id) => this.getTask(id),
      getRun: (id) => this.getRun(id),
      getWorkspace: (id) => this.getWorkspace(id),
      getProject: (id) => this.getProject(id),
      getAgentProfile: (id) => this.queryService.getAgentProfile(id),
      getReceiptByRunId: (id) => this.getReceiptByRunId(id),
      getExecutionEnvelope: (id) => this.getExecutionEnvelope(id),
      listJobs: () => this.listJobs(),
      listRunEvents: (id) => this.listRunEvents(id),
      writeRuntimeReceipt: (input) => this.writeRuntimeReceipt(input),
      persistExecutionEnvelope: (envelope) => this.persistExecutionEnvelope(envelope),
      acquireWorkspaceLock: (wid, owner) => this.acquireWorkspaceLock(wid, owner),
      releaseWorkspaceLock: (wid) => this.releaseWorkspaceLock(wid),
      refreshLease: (jid, owner) => this.refreshLease(jid, owner),
      redactError: (err) => this.redactError(err),
      recordSecurityAudit: (event) => this.recordSecurityAudit(event),
      createIntervention: (code, runId, reason) => this.createIntervention(code, runId, reason),
      emit: (event, payload) => this.emit(event, payload),
      receiptManager: this.receiptManager,
      sessionService: this.sessionService,
      messageIngestion: this.messageIngestion,
      resolveInstructionsForRun: (task) => this.queryService.resolveInstructionsForRun(task),
      recordPlaybookUsage: (runId, playbooks) => this.playbookService.recordUsage(runId, playbooks),
      capabilityRegistry: this.capabilityRegistry,
      memoryLifecycle: this.memoryLifecycle,
      searchRecall: (query) => this.searchRecall(query),
      searchMemory: (query) => this.searchMemory(query),
      describeMemory: (id, scope) => this.describeMemory(id, scope),
      expandMemory: (id, maxTokens, scope) => this.expandMemory(id, maxTokens, scope),
      explainMemoryRecall: (input, filter) => this.explainMemoryRecall(input, filter),
      searchPlaybooks: (input) => this.playbookService.searchPlaybooks(input),
      getPlaybook: (recordId) => this.getPlaybook(recordId),
      listPlaybookRevisions: (recordId) => this.listPlaybookRevisions(recordId),
      createPlaybookProposal: (input) => this.playbookService.createProposal(input),
      pluginTools: this.pluginTools,
    });

    this.seedReferenceData();
    this.reconcileStartupState();
    const reconcileMs = Math.round(performance.now() - startupStart);
    this.seedDaemonState();
    this.startScheduler();
    this.startMemoryMaintenance();
    this.startDocIndexing();
    this.startTokenRotationCheck();
    this.approvalExpiryTimer = setInterval(() => {
      this.approvalService.expireStaleApprovals();
    }, 5 * 60_000);
    const schedulerReadyMs = Math.round(performance.now() - startupStart);
    this.startupProfile = { dbReadyMs, reconcileMs, schedulerReadyMs };
    this.log.info('runtime started', { dbReadyMs, reconcileMs, schedulerReadyMs });
    this.events.emit('startup_profile', this.startupProfile);
  }

  async close(): Promise<void> {
    this.log.info('runtime closing');
    this.closed = true;
    if (this.memoryMaintenanceTimer) {
      clearInterval(this.memoryMaintenanceTimer);
      this.memoryMaintenanceTimer = null;
    }
    if (this.docIndexTimer) {
      clearInterval(this.docIndexTimer);
      this.docIndexTimer = null;
    }
    if (this.tokenRotationTimer) {
      clearInterval(this.tokenRotationTimer);
      this.tokenRotationTimer = null;
    }
    if (this.approvalExpiryTimer) {
      clearInterval(this.approvalExpiryTimer);
      this.approvalExpiryTimer = null;
    }
    this.vaultManager.closeAllVaults();
    // Close capability read-only DBs before capability shutdown
    this.emailFacade.invalidate();
    this.githubFacade.invalidate();
    this.calendarFacade.invalidate();
    this.todosFacade.invalidate();
    this.peopleFacade.invalidate();
    this.financeFacade.invalidate();
    this.medicalFacade.invalidate();
    if (this.capabilityInitPromise) await this.capabilityInitPromise;
    await this.capabilityRegistry.shutdownAll();
    await this.stopScheduler();
    await this.vecInitPromise;
    this.databases.app.prepare('UPDATE daemon_state SET last_shutdown_at = ? WHERE id = 1').run(nowIso());
    this.databases.app.close();
    this.databases.memory.close();
  }

  async shutdown(): Promise<void> {
    await this.close();
  }

  // --- Delegated: TaskManager ---

  createTask(input: TaskCreateInput): { task: TaskRecord; job: JobRecord | null; run: RunRecord | null } {
    const parsed = TaskCreateInputSchema.parse(input);
    const profile = this.getAgentProfile(parsed.profileId);
    if (!profile) {
      throw new RuntimeValidationError(`Execution profile not found: ${parsed.profileId}`);
    }
    const workspace = this.getWorkspace(parsed.workspaceId);
    if (!workspace) {
      throw new RuntimeValidationError(`Workspace not found: ${parsed.workspaceId}`);
    }
    if (parsed.projectId) {
      const project = this.getProject(parsed.projectId);
      if (!project) {
        throw new RuntimeValidationError(`Project not found: ${parsed.projectId}`);
      }
      if (project.workspaceId !== parsed.workspaceId) {
        throw new RuntimeValidationError(`Project ${parsed.projectId} does not belong to workspace ${parsed.workspaceId}`);
      }
    }
    const contextError = validateProfileTaskContext(profile, {
      workspaceId: parsed.workspaceId,
      projectId: parsed.projectId,
    });
    if (contextError) {
      throw new RuntimeValidationError(contextError);
    }
    return this.taskManager.createTask(parsed);
  }

  enqueueTask(taskId: string, options?: { availableAt?: string; retryCount?: number }): JobRecord | null {
    return this.taskManager.enqueueTask(taskId, options);
  }

  enqueueJob(jobId: string): JobRecord | null {
    return this.taskManager.enqueueJob(jobId);
  }

  requeueJob(jobId: string): JobRecord | null {
    return this.taskManager.requeueJob(jobId);
  }

  executeJob(jobId: string): JobRecord | null {
    return this.taskManager.executeJob(jobId);
  }

  listTasks(): TaskRecord[] {
    return this.taskManager.listTasks();
  }

  getTask(taskId: string): TaskRecord | null {
    return this.taskManager.getTask(taskId);
  }

  listJobs(): JobRecord[] {
    return this.taskManager.listJobs();
  }

  getJob(jobId: string): JobRecord | null {
    return this.taskManager.getJob(jobId);
  }

  getJobLease(jobId: string): JobLeaseRecord | null {
    return this.taskManager.getJobLease(jobId);
  }

  pauseJob(jobId: string): JobRecord | null {
    return this.taskManager.pauseJob(jobId);
  }

  resumeJob(jobId: string): JobRecord | null {
    return this.taskManager.resumeJob(jobId);
  }

  // --- Delegated: ReceiptManager ---

  private listSecurityAuditEventsForRun(runId: string): SecurityAuditEvent[] {
    const rows = this.databases.app
      .prepare('SELECT code, severity, message, component, timestamp, details_json FROM security_audit ORDER BY timestamp ASC')
      .all() as Array<{
        code: string;
        severity: SecurityAuditEvent['severity'];
        message: string;
        component: string;
        timestamp: string;
        details_json: string;
      }>;

    return rows
      .map((row) => {
        const details = JSON.parse(row.details_json || '{}') as Record<string, string>;
        return {
          code: row.code,
          severity: row.severity,
          message: row.message,
          component: row.component,
          timestamp: row.timestamp,
          details,
        } satisfies SecurityAuditEvent;
      })
      .filter((event) => event.details.runId === runId);
  }

  private buildReceiptTimeline(runId: string, status?: ReceiptRecord['status']): ReceiptTimelineEvent[] {
    const timeline: ReceiptTimelineEvent[] = [];

    for (const event of this.listRunEvents(runId)) {
      timeline.push({
        id: `run_event:${event.id}`,
        at: event.createdAt,
        kind: 'run',
        severity: event.type === 'failed' ? 'error' : 'info',
        code: `engine_${event.type}`,
        title: mapRunEventTitle(event.type),
        detail: mapRunEventDetail(event),
        source: 'run_event',
        metadata: buildTimelineMetadata(parseRunEventPayload(event.payload)),
      });
    }

    for (const event of this.listSecurityAuditEventsForRun(runId)) {
      if (event.code === 'context_released') continue;
      timeline.push({
        id: `security_audit:${event.timestamp}:${event.code}`,
        at: event.timestamp,
        kind: mapSecurityAuditKind(event.code),
        severity: event.severity,
        code: event.code,
        title: titleCase(event.code),
        detail: event.message,
        source: 'security_audit',
        metadata: buildTimelineMetadata(event.details),
      });
    }

    const releases = this.contextReleaseService.listReleasesForRun(runId);
    const approvalsById = new Map<string, ApprovalRecord>();
    for (const approval of this.approvalService.listApprovals({ runId })) {
      approvalsById.set(approval.id, approval);
    }
    for (const release of releases) {
      if (!release.approvalId) continue;
      const approval = this.approvalService.getApproval(release.approvalId);
      if (approval) approvalsById.set(approval.id, approval);
    }

    for (const approval of approvalsById.values()) {
      timeline.push({
        id: `approval:${approval.id}:requested`,
        at: approval.createdAt,
        kind: 'approval',
        severity: approval.riskClass === 'deny' ? 'error' : 'info',
        code: 'approval_requested',
        title: 'Approval requested',
        detail: `${approval.scope} · ${approval.actionKind} · ${approval.resourceType}/${approval.resourceId}`,
        source: 'approval',
        metadata: buildTimelineMetadata({
          approvalId: approval.id,
          domain: approval.domain,
          riskClass: approval.riskClass,
          actionKind: approval.actionKind,
          resourceScope: approval.resourceScope,
          runId: approval.runId ?? '',
          standingApprovalEligible: approval.standingApprovalEligible,
          automationGrantEligible: approval.automationGrantEligible,
          status: approval.status,
        }),
      });
      if (approval.resolvedAt) {
        timeline.push({
          id: `approval:${approval.id}:resolved`,
          at: approval.resolvedAt,
          kind: 'approval',
          severity: approval.status === 'approved' ? 'info' : approval.status === 'expired' ? 'warn' : 'error',
          code: `approval_${approval.status}`,
          title: `Approval ${approval.status}`,
        detail: approval.decisionReason ?? `${approval.scope} decision recorded.`,
        source: 'approval',
        metadata: buildTimelineMetadata({
          approvalId: approval.id,
          resolvedBy: approval.resolvedBy ?? '',
          resolvedByGrantId: approval.resolvedByGrantId ?? '',
          domain: approval.domain,
          actionKind: approval.actionKind,
        }),
      });
    }
    }

    for (const release of releases) {
      timeline.push({
        id: `context_release:${release.id}`,
        at: release.createdAt,
        kind: 'context_release',
        severity: 'info',
        code: 'context_released',
        title: `Context released to ${release.domain}`,
        detail: `${release.releaseLevel}${release.redacted ? ' · redacted' : ''}`,
        source: 'context_release',
        metadata: buildTimelineMetadata({
          releaseId: release.id,
          sourceRef: release.sourceRef,
          tokenEstimate: release.tokenEstimate,
          ...(release.approvalId ? { approvalId: release.approvalId } : {}),
        }),
      });
    }

    if (status) {
      const run = this.getRun(runId);
      timeline.push({
        id: `receipt:${runId}:${status}`,
        at: run?.finishedAt ?? nowIso(),
        kind: status === 'succeeded' ? 'run' : 'warning',
        severity: status === 'succeeded' ? 'info' : status === 'cancelled' || status === 'abandoned' ? 'warn' : 'error',
        code: `receipt_${status}`,
        title: `Receipt ${status}`,
        detail: `Run finished with status ${status}.`,
        source: 'receipt',
        metadata: {},
      });
    }

    return timeline.sort((left, right) => {
      const byTime = Date.parse(left.at) - Date.parse(right.at);
      return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
    });
  }

  private buildReceiptRuntimeSummary(
    runId: string,
    taskId: string,
    status?: ReceiptRecord['status'],
  ): NonNullable<ReceiptRecord['runtime']> | undefined {
    const run = this.getRun(runId);
    const task = this.getTask(taskId);
    const envelope = this.getExecutionEnvelope(runId);
    const contextReleases = this.summarizeRunReleases(runId);
    const playbooks = this.playbookService.listUsageForRun(runId);
    const timeline = this.buildReceiptTimeline(runId, status);

    const runtimeSummary: NonNullable<ReceiptRecord['runtime']> = {
      projectId: task?.projectId ?? null,
      profileId: run?.profileId ?? null,
      execution: envelope
        ? {
            mode: envelope.mode,
            memoryScope: envelope.memoryScope,
            recallScope: envelope.recallScope,
            filesystemPolicyClass: envelope.filesystemPolicyClass,
            contextReleasePolicy: envelope.contextReleasePolicy,
            sessionPolicy: envelope.provenance.sessionPolicy,
            warnings: envelope.provenance.warnings,
          }
        : null,
      contextReleases: contextReleases.totalReleases > 0
        ? contextReleases
        : null,
      playbooks,
      timeline,
      delegationSummary: null,
    };

    if (!runtimeSummary.projectId && !runtimeSummary.profileId && !runtimeSummary.execution && !runtimeSummary.contextReleases && runtimeSummary.playbooks.length === 0 && runtimeSummary.timeline.length === 0) {
      return undefined;
    }
    return runtimeSummary;
  }

  private mergeReceiptRuntimeSummary(receipt: ReceiptRecord): ReceiptRecord['runtime'] | undefined {
    const derived = this.buildReceiptRuntimeSummary(receipt.runId, receipt.taskId, receipt.status);
    if (!receipt.runtime) {
      return derived;
    }
    if (!derived) {
      return receipt.runtime;
    }
    const timelineById = new Map<string, ReceiptTimelineEvent>();
    for (const event of receipt.runtime.timeline) {
      timelineById.set(event.id, event);
    }
    for (const event of derived.timeline) {
      timelineById.set(event.id, event);
    }
    const mergedTimeline = Array.from(timelineById.values()).sort((left, right) => {
      const byTime = Date.parse(left.at) - Date.parse(right.at);
      return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
    });
    const playbooksByKey = new Map<string, NonNullable<ReceiptRecord['runtime']>['playbooks'][number]>();
    for (const playbook of receipt.runtime.playbooks) {
      playbooksByKey.set(`${playbook.scope}:${playbook.id}:${playbook.revisionHash}`, playbook);
    }
    for (const playbook of derived.playbooks) {
      playbooksByKey.set(`${playbook.scope}:${playbook.id}:${playbook.revisionHash}`, playbook);
    }
    return {
      projectId: receipt.runtime.projectId ?? derived.projectId ?? null,
      profileId: receipt.runtime.profileId ?? derived.profileId ?? null,
      execution: receipt.runtime.execution ?? derived.execution ?? null,
      contextReleases: receipt.runtime.contextReleases ?? derived.contextReleases ?? null,
      playbooks: Array.from(playbooksByKey.values()),
      timeline: mergedTimeline,
      delegationSummary: receipt.runtime.delegationSummary ?? derived.delegationSummary ?? null,
    };
  }

  private enrichReceipt(receipt: ReceiptRecord | null): ReceiptRecord | null {
    if (!receipt) return null;
    const runtime = this.mergeReceiptRuntimeSummary(receipt);
    return {
      ...receipt,
      ...(runtime !== undefined ? { runtime } : {}),
    };
  }

  private writeRuntimeReceipt(input: Omit<ReceiptRecord, 'id' | 'createdAt'>): ReceiptRecord {
    const runtime = input.runtime ?? this.buildReceiptRuntimeSummary(input.runId, input.taskId, input.status);
    const receipt = this.receiptManager.writeReceipt({
      ...input,
      ...(runtime !== undefined ? { runtime } : {}),
    });
    const enriched = this.enrichReceipt(receipt) ?? receipt;
    this.receiptManager.captureMemoryFromReceipt(enriched);
    return enriched;
  }

  listReceipts(): ReceiptRecord[] {
    return this.receiptManager.listReceipts().map((receipt) => this.enrichReceipt(receipt) ?? receipt);
  }

  getReceipt(receiptId: string): ReceiptRecord | null {
    return this.enrichReceipt(this.receiptManager.getReceipt(receiptId));
  }

  getReceiptByRunId(runId: string): ReceiptRecord | null {
    return this.enrichReceipt(this.receiptManager.getReceiptByRunId(runId));
  }

  getUsageSummary(): UsageSummary {
    return this.receiptManager.getUsageSummary();
  }

  // --- Analytics ---

  getAnalyticsUsage(options: { from?: string | undefined; to?: string | undefined; granularity: AnalyticsGranularity; workspaceId?: string | undefined }): AnalyticsUsageResponse {
    const buckets = this.receiptManager.getAnalyticsUsage(options);
    return { granularity: options.granularity, buckets };
  }

  getAnalyticsModels(options: { from?: string | undefined; to?: string | undefined; workspaceId?: string | undefined }): AnalyticsModelsResponse {
    return { models: this.receiptManager.getAnalyticsModels(options) };
  }

  getAnalyticsProjects(options: { from?: string | undefined; to?: string | undefined }): AnalyticsProjectsResponse {
    return { projects: this.receiptManager.getAnalyticsProjects(options) };
  }

  // --- Session search ---

  searchRunEvents(query: SessionSearchQuery): SessionSearchResponse {
    return searchRunEventsFn(this.databases.app, query);
  }

  async searchRecall(query: RecallQuery): Promise<RecallSearchResponse> {
    return this.recallService.search(query);
  }

  getRecallDetail(kind: RecallSourceKind, id: string): RecallDetail | null {
    return this.recallService.getDetail(kind, id);
  }

  // --- Trajectory ---

  getRunTrajectory(runId: string, options: { format: TrajectoryFormat; types?: string | undefined }): { contentType: string; body: string } | null {
    const run = this.getRun(runId);
    if (!run) return null;
    const events = this.listRunEvents(runId);
    const filterTypes = options.types ? options.types.split(',').map(t => t.trim()) : undefined;
    if (options.format === 'sharegpt') {
      const receipt = this.getReceiptByRunId(runId);
      const usage = receipt ? { model: receipt.usage.model, tokensIn: receipt.usage.tokensIn, tokensOut: receipt.usage.tokensOut, estimatedCostUsd: receipt.usage.estimatedCostUsd } : undefined;
      const conv = formatTrajectoryShareGPT(events, runId, run.state, usage, filterTypes);
      return { contentType: 'application/json', body: JSON.stringify(conv) };
    }
    return { contentType: 'application/x-ndjson', body: formatTrajectoryJsonl(events, filterTypes) };
  }

  // --- Delegation queries ---

  listDelegateRuns(runId: string): RunRecord[] {
    return z.array(RunRowSchema)
      .parse(this.databases.app.prepare('SELECT * FROM runs WHERE parent_run_id = ? ORDER BY started_at ASC').all(runId))
      .map(mapRunRow);
  }

  getDelegationTree(runId: string): DelegationTreeNode | null {
    const run = this.getRun(runId);
    if (!run) return null;
    const buildNode = (r: RunRecord): DelegationTreeNode => {
      const children = this.listDelegateRuns(r.id);
      return {
        runId: r.id,
        parentRunId: r.parentRunId,
        depth: r.delegationDepth,
        state: r.state,
        iterationsUsed: r.iterationsUsed,
        title: null,
        children: children.map(buildNode),
      };
    };
    return buildNode(run);
  }

  // --- Delegated: QueryService ---

  getStatus(): DaemonStatusResponse {
    return this.queryService.getStatus();
  }

  getEngineCapabilities(): EngineCapabilities {
    return this.queryService.getEngineCapabilities();
  }

  getDaemonState(): DaemonStateRecord {
    return this.queryService.getDaemonState();
  }

  getSchedulerStatus(): SchedulerStatusResponse {
    return this.queryService.getSchedulerStatus();
  }

  listWorkspaces(): WorkspaceRecord[] {
    return this.workspaceRegistry.listWorkspaces();
  }

  getWorkspace(id: string): WorkspaceRecord | null {
    return this.workspaceRegistry.getWorkspace(id);
  }

  listProjects(): ProjectRecord[] {
    return this.workspaceRegistry.listProjects();
  }

  getProject(id: string): ProjectRecord | null {
    return this.workspaceRegistry.getProject(id);
  }

  registerWorkspace(input: WorkspaceRegistrationInput): WorkspaceRecord {
    return this.workspaceRegistry.registerWorkspace(input);
  }

  registerProject(input: ProjectRegistrationInput): ProjectRecord {
    return this.workspaceRegistry.registerProject(input);
  }

  resolveWorkspaceFromCwd(cwd: string): { workspaceId: string; projectId: string | null } | null {
    const projects = z.array(ProjectPathRowSchema).parse(
      this.databases.app.prepare('SELECT id, workspace_id, path FROM projects WHERE path IS NOT NULL ORDER BY LENGTH(path) DESC').all(),
    );
    for (const project of projects) {
      if (cwd.startsWith(project.path)) {
        return { workspaceId: project.workspace_id, projectId: project.id };
      }
    }
    const workspaces = z.array(WorkspacePathRowSchema).parse(
      this.databases.app.prepare('SELECT id, root_path FROM workspaces WHERE root_path IS NOT NULL ORDER BY LENGTH(root_path) DESC').all(),
    );
    for (const workspace of workspaces) {
      if (cwd.startsWith(workspace.root_path)) {
        return { workspaceId: workspace.id, projectId: null };
      }
    }
    return null;
  }

  listAgentProfiles(): AgentProfileRecord[] {
    return this.queryService.listAgentProfiles();
  }

  getAgentProfile(profileId: string): AgentProfileRecord | null {
    return this.queryService.getAgentProfile(profileId);
  }

  getExecutionEnvelope(runId: string): ExecutionEnvelope | null {
    const row = this.databases.app.prepare('SELECT * FROM execution_envelopes WHERE run_id = ?').get(runId);
    return row ? mapExecutionEnvelopeRow(row) : null;
  }

  private persistExecutionEnvelope(envelope: ExecutionEnvelope): void {
    this.databases.app.prepare(`
      INSERT OR REPLACE INTO execution_envelopes (
        run_id, task_id, profile_id, workspace_id, project_id, mode, model_policy,
        allowed_runtime_tools_json, allowed_capability_ids_json, memory_scope, recall_scope,
        filesystem_policy_class, context_release_policy, read_roots_json, write_roots_json,
        protected_paths_json, scratch_root, cwd, provenance_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      envelope.runId,
      envelope.taskId,
      envelope.profileId,
      envelope.workspaceId,
      envelope.projectId,
      envelope.mode,
      envelope.modelPolicy,
      JSON.stringify(envelope.allowedRuntimeTools),
      JSON.stringify(envelope.allowedCapabilityIds),
      envelope.memoryScope,
      envelope.recallScope,
      envelope.filesystemPolicyClass,
      envelope.contextReleasePolicy,
      JSON.stringify(envelope.readRoots),
      JSON.stringify(envelope.writeRoots),
      JSON.stringify(envelope.protectedPaths),
      envelope.scratchRoot,
      envelope.cwd,
      JSON.stringify(envelope.provenance),
      envelope.provenance.derivedAt,
    );
  }

  authorizeContextRelease(input: {
    runId: string;
    domain: ContextReleasePreview['domain'];
    sourceRef: string;
    requestedLevel: ContextReleasePreview['releaseLevel'];
    tokenEstimate?: number;
    resourceType?: string;
    resourceId?: string;
    requestedBy?: string;
    payloadPreview?: string;
  }): {
    outcome: 'allow' | 'deny' | 'approval_required';
    approvedLevel: ContextReleasePreview['releaseLevel'] | null;
    approvalId: string | null;
    reason: string;
    redactionApplied: boolean;
  } {
    const envelope = this.getExecutionEnvelope(input.runId);
    if (!envelope) {
      return {
        outcome: 'deny',
        approvedLevel: null,
        approvalId: null,
        reason: 'Execution envelope not found for this run.',
        redactionApplied: false,
      };
    }

    const effectiveLevel = computeEffectiveContextReleaseLevel(
      envelope.contextReleasePolicy,
      input.requestedLevel,
    );
    const policy = this.actionPolicyEvaluator.evaluateContextRelease({
      domain: input.domain,
      requestedLevel: input.requestedLevel,
      profileLimit: envelope.contextReleasePolicy,
      resourceScope: 'resource',
    });

    if (policy.riskClass === 'deny') {
      return {
        outcome: 'deny',
        approvedLevel: null,
        approvalId: null,
        reason: policy.reason,
        redactionApplied: false,
      };
    }

    const approval = this.requestApproval({
      scope: 'context_release',
      domain: input.domain,
      riskClass: policy.riskClass,
      actionKind: 'release_context',
      resourceScope: 'resource',
      resourceType: input.resourceType ?? 'context_release',
      resourceId: input.resourceId ?? input.sourceRef,
      requestedBy: input.requestedBy ?? 'context_release_gate',
      runId: input.runId,
      standingApprovalEligible: policy.standingApprovalEligible,
      automationGrantEligible: policy.automationGrantEligible,
      payloadPreview: input.payloadPreview ?? input.sourceRef,
    });

    if (approval.status === 'approved') {
      return {
        outcome: 'allow',
        approvedLevel: input.requestedLevel,
        approvalId: approval.id,
        reason: approval.decisionReason ?? policy.reason,
        redactionApplied: false,
      };
    }

    return {
      outcome: 'approval_required',
      approvedLevel: effectiveLevel,
      approvalId: approval.id,
      reason: policy.reason,
      redactionApplied: false,
    };
  }

  listSessionRoots(): Array<{ id: string; kind: string; scope: string; createdAt: string }> {
    return this.sessionService.listSessionRoots();
  }

  getInstructionPreview(scope: string, projectId?: string): CompiledInstructionBundle {
    return this.queryService.getInstructionPreview(scope, projectId);
  }

  listPlaybooks(filter?: {
    q?: string | null;
    scope?: PlaybookScope;
    workspaceId?: string | null;
    projectId?: string | null;
    status?: PlaybookStatus;
    limit?: number;
    offset?: number;
  }): PlaybookRecord[] {
    return this.playbookService.listPlaybooks(filter).map((playbook) => this.enrichPlaybookRecord(playbook));
  }

  searchPlaybooks(input: {
    query: string;
    status?: PlaybookStatus;
  }): PlaybookSearchResult[] {
    return this.playbookService.searchPlaybooks(input);
  }

  getPlaybook(recordId: string): PlaybookDetail | null {
    const playbook = this.playbookService.getPlaybook(recordId);
    if (!playbook) return null;
    return this.enrichPlaybookDetail(playbook);
  }

  listPlaybookRevisions(recordId: string): PlaybookRevisionRecord[] {
    return this.playbookService.listRevisions(recordId);
  }

  listPlaybookProposals(filter?: {
    q?: string | null;
    status?: PlaybookProposalRecord['status'];
    kind?: PlaybookProposalKind;
    scope?: PlaybookScope;
    sourceRunId?: string | null;
    targetRecordId?: string | null;
    sort?: 'created_desc' | 'created_asc' | 'updated_desc' | 'updated_asc' | 'title_asc' | 'title_desc';
    limit?: number;
    offset?: number;
  }): PlaybookProposalRecord[] {
    return this.playbookService.listProposals(filter);
  }

  getPlaybookProposal(id: string): PlaybookProposalRecord | null {
    return this.playbookService.getProposal(id);
  }

  createPlaybookProposal(input: PlaybookProposalCreateRequest): PlaybookProposalRecord {
    return this.playbookService.createProposal(
      input.kind === 'draft'
        ? {
            kind: 'draft',
            playbookId: input.playbookId,
            scope: input.scope,
            title: input.title,
            body: input.body,
            proposedBy: 'operator_api',
            sourceRunId: null,
            ...(input.allowedProfileIds !== undefined ? { allowedProfileIds: input.allowedProfileIds } : {}),
            ...(input.summary !== undefined ? { summary: input.summary } : {}),
            ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
            ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
          }
        : {
            kind: 'patch',
            targetRecordId: input.targetRecordId,
            ...(input.baseRevisionHash !== undefined ? { baseRevisionHash: input.baseRevisionHash } : {}),
            title: input.title,
            body: input.body,
            proposedBy: 'operator_api',
            sourceRunId: null,
            ...(input.allowedProfileIds !== undefined ? { allowedProfileIds: input.allowedProfileIds } : {}),
            ...(input.summary !== undefined ? { summary: input.summary } : {}),
          },
    );
  }

  reviewPlaybookProposal(id: string, input: PlaybookProposalReviewRequest): PlaybookProposalRecord {
    return this.playbookService.reviewProposal(id, {
      decision: input.decision,
      reviewedBy: input.reviewedBy,
      note: input.note,
    });
  }

  updatePlaybookProposal(id: string, input: PlaybookProposalUpdateRequest): PlaybookProposalRecord {
    return this.playbookService.updateProposal(id, {
      title: input.title,
      allowedProfileIds: input.allowedProfileIds,
      summary: input.summary,
      body: input.body,
      updatedBy: input.updatedBy,
    });
  }

  submitPlaybookProposalForReview(id: string, input: PlaybookProposalSubmitReviewRequest): PlaybookProposalRecord {
    return this.playbookService.submitProposalForReview(id, {
      submittedBy: input.submittedBy,
    });
  }

  applyPlaybookProposal(id: string, input: PlaybookProposalApplyRequest): PlaybookProposalRecord {
    const proposal = this.playbookService.applyProposal(id, {
      appliedBy: input.appliedBy,
    });
    if (proposal.appliedRecordId) {
      const playbook = this.getPlaybook(proposal.appliedRecordId);
      if (playbook?.status === 'active') {
        this.memoryOps.syncActivePlaybookMemory(playbook);
      }
    }
    return proposal;
  }

  activatePlaybook(recordId: string, input: PlaybookLifecycleActionRequest): PlaybookDetail {
    const before = this.playbookService.getPlaybook(recordId);
    const updated = this.playbookService.activatePlaybook(recordId, {
      updatedBy: input.updatedBy,
    });
    if (before?.status !== 'active' && updated.status === 'active') {
      this.memoryOps.syncActivePlaybookMemory(updated);
    }
    return this.enrichPlaybookDetail(updated);
  }

  retirePlaybook(recordId: string, input: PlaybookLifecycleActionRequest): PlaybookDetail {
    const before = this.playbookService.getPlaybook(recordId);
    const updated = this.playbookService.retirePlaybook(recordId, {
      updatedBy: input.updatedBy,
    });
    if (before?.status !== 'retired' && updated.status === 'retired') {
      this.memoryOps.archivePlaybookMemory(recordId);
    }
    return this.enrichPlaybookDetail(updated);
  }

  suggestPlaybookPatch(recordId: string, _input: PlaybookSuggestPatchRequest): PlaybookProposalRecord {
    const playbook = this.playbookService.getPlaybook(recordId);
    if (!playbook) {
      throw new RuntimeNotFoundError(`Playbook ${recordId} not found`);
    }
    const signal = this.collectPlaybookSignal(playbook);
    if (!signal.lastProblemAt || (signal.failedRunIds.length === 0 && signal.interventionIds.length === 0)) {
      throw new RuntimeValidationError(`Playbook ${recordId} does not have recent failure or intervention evidence to suggest a patch`);
    }
    return this.playbookService.createProposal({
      kind: 'patch',
      targetRecordId: playbook.recordId,
      baseRevisionHash: playbook.currentRevisionHash,
      title: playbook.title,
      allowedProfileIds: playbook.allowedProfileIds,
      summary: signal.suggestedPatchNote,
      body: playbook.body,
      sourceRunId: null,
      proposedBy: 'operator_api',
      status: 'drafting',
      evidence: {
        runIds: signal.failedRunIds,
        interventionIds: signal.interventionIds,
        lastProblemAt: signal.lastProblemAt,
        metrics30d: {
          useCount30d: signal.useCount30d,
          failedRuns30d: signal.failedRuns30d,
          interventions30d: signal.interventions30d,
        },
        suggestedPatchNote: signal.suggestedPatchNote,
      },
    });
  }

  listPlaybookUsage(recordId: string, options?: { limit?: number; offset?: number }): PlaybookUsageRunRecord[] {
    return this.playbookService.listUsage(recordId, options);
  }

  listPlaybookStaleCandidates(): PlaybookStaleCandidate[] {
    return this.playbookService.listPlaybooks({ status: 'active' })
      .map((playbook) => this.collectPlaybookSignal(playbook))
      .filter((candidate) => {
        if (candidate.useCount30d < 3) return false;
        if (candidate.failedRuns30d < 2 && candidate.interventions30d < 1) return false;
        if (!candidate.lastProblemAt) return false;
        return candidate.lastProposalAt === null || candidate.lastProposalAt <= candidate.lastProblemAt;
      })
      .sort((left, right) => {
        const byFailedRuns = right.failedRuns30d - left.failedRuns30d;
        if (byFailedRuns !== 0) return byFailedRuns;
        const byInterventions = right.interventions30d - left.interventions30d;
        if (byInterventions !== 0) return byInterventions;
        const byUsage = right.useCount30d - left.useCount30d;
        if (byUsage !== 0) return byUsage;
        const byLastUsed = (right.lastUsedAt ?? '').localeCompare(left.lastUsedAt ?? '');
        if (byLastUsed !== 0) return byLastUsed;
        const byScope = ({ global: 0, workspace: 1, project: 2 } as const)[left.scope] - ({ global: 0, workspace: 1, project: 2 } as const)[right.scope];
        if (byScope !== 0) return byScope;
        const byTitle = left.title.localeCompare(right.title);
        if (byTitle !== 0) return byTitle;
        return left.recordId.localeCompare(right.recordId);
      })
      .map(({ lastProblemAt: _lastProblemAt, failedRunIds: _failedRunIds, interventionIds: _interventionIds, suggestedPatchNote: _suggestedPatchNote, ...candidate }) => candidate);
  }

  triggerPlaybookAutoDraftSweep(): PlaybookProposalRecord[] {
    return this.runPlaybookAutoDraftSweep();
  }

  private enrichPlaybookRecord(playbook: PlaybookRecord): PlaybookRecord {
    return {
      ...playbook,
      effectiveness: this.buildPlaybookEffectiveness(playbook),
    };
  }

  private enrichPlaybookDetail(playbook: PlaybookDetail): PlaybookDetail {
    return {
      ...playbook,
      indexedMemoryId: this.memoryOps.getIndexedPlaybookMemoryId(playbook.recordId),
      effectiveness: this.buildPlaybookEffectiveness(playbook),
    };
  }

  private buildPlaybookEffectiveness(playbook: Pick<PlaybookRecord, 'recordId' | 'updatedAt'>): PlaybookEffectiveness {
    const windowStart = this.getPlaybookWindowStart();
    const row = this.databases.app.prepare(`
      SELECT
        COUNT(DISTINCT pu.run_id) AS use_count,
        COUNT(DISTINCT CASE WHEN r.state = 'succeeded' THEN pu.run_id END) AS succeeded_count,
        COUNT(DISTINCT CASE WHEN r.state IN ('failed_final', 'abandoned') THEN pu.run_id END) AS failed_count,
        COUNT(DISTINCT CASE WHEN i.id IS NOT NULL THEN pu.run_id END) AS intervened_count,
        MAX(pu.created_at) AS last_used_at
      FROM playbook_usage pu
      LEFT JOIN runs r ON r.id = pu.run_id
      LEFT JOIN interventions i ON i.run_id = pu.run_id
      WHERE pu.playbook_record_id = ?
        AND pu.created_at >= ?
    `).get(playbook.recordId, windowStart);

    const parsed = z.object({
      use_count: z.coerce.number().int().nonnegative(),
      succeeded_count: z.coerce.number().int().nonnegative(),
      failed_count: z.coerce.number().int().nonnegative(),
      intervened_count: z.coerce.number().int().nonnegative(),
      last_used_at: z.string().nullable(),
    }).parse(row);
    const denominator = parsed.use_count === 0 ? 1 : parsed.use_count;

    return {
      useCount30d: parsed.use_count,
      succeededRuns30d: parsed.succeeded_count,
      failedRuns30d: parsed.failed_count,
      intervenedRuns30d: parsed.intervened_count,
      successRate30d: parsed.use_count === 0 ? 0 : parsed.succeeded_count / denominator,
      failureRate30d: parsed.use_count === 0 ? 0 : parsed.failed_count / denominator,
      interventionRate30d: parsed.use_count === 0 ? 0 : parsed.intervened_count / denominator,
      lastUsedAt: parsed.last_used_at,
      lastUpdatedAt: playbook.updatedAt,
    };
  }

  private collectPlaybookSignal(playbook: PlaybookRecord): PlaybookStaleCandidate & {
    lastProblemAt: string | null;
    failedRunIds: string[];
    interventionIds: string[];
    suggestedPatchNote: string;
  } {
    const windowStart = this.getPlaybookWindowStart();
    const effectiveness = this.buildPlaybookEffectiveness(playbook);
    const failedRunsRow = this.databases.app.prepare(`
      SELECT MAX(COALESCE(r.finished_at, pu.created_at)) AS last_failed_at
      FROM playbook_usage pu
      JOIN runs r ON r.id = pu.run_id
      WHERE pu.playbook_record_id = ?
        AND pu.created_at >= ?
        AND r.state IN ('failed_final', 'abandoned')
    `).get(playbook.recordId, windowStart);
    const interventionRow = this.databases.app.prepare(`
      SELECT MAX(i.created_at) AS last_intervention_at
      FROM playbook_usage pu
      JOIN interventions i ON i.run_id = pu.run_id
      WHERE pu.playbook_record_id = ?
        AND i.created_at >= ?
    `).get(playbook.recordId, windowStart);
    const proposalRow = this.databases.app.prepare(`
      SELECT MAX(created_at) AS last_proposal_at
      FROM playbook_proposals
      WHERE target_record_id = ? OR applied_record_id = ?
    `).get(playbook.recordId, playbook.recordId);
    const failedRunIds = z.array(z.object({ run_id: z.string() })).parse(this.databases.app.prepare(`
      SELECT DISTINCT pu.run_id
      FROM playbook_usage pu
      JOIN runs r ON r.id = pu.run_id
      WHERE pu.playbook_record_id = ?
        AND pu.created_at >= ?
        AND r.state IN ('failed_final', 'abandoned')
      ORDER BY COALESCE(r.finished_at, pu.created_at) DESC, pu.run_id DESC
      LIMIT 10
    `).all(playbook.recordId, windowStart)).map((row) => row.run_id);
    const interventionIds = z.array(z.object({ id: z.string() })).parse(this.databases.app.prepare(`
      SELECT DISTINCT i.id
      FROM playbook_usage pu
      JOIN interventions i ON i.run_id = pu.run_id
      WHERE pu.playbook_record_id = ?
        AND i.created_at >= ?
      ORDER BY i.created_at DESC, i.id DESC
      LIMIT 10
    `).all(playbook.recordId, windowStart)).map((row) => row.id);
    const lastFailedAt = z.object({ last_failed_at: z.string().nullable() }).parse(failedRunsRow).last_failed_at;
    const lastInterventionAt = z.object({ last_intervention_at: z.string().nullable() }).parse(interventionRow).last_intervention_at;
    const lastProposalAt = z.object({ last_proposal_at: z.string().nullable() }).parse(proposalRow).last_proposal_at;
    const lastProblemAt = [lastFailedAt, lastInterventionAt]
      .filter((value): value is string => value !== null)
      .sort((left, right) => right.localeCompare(left))[0] ?? null;
    const indexedMemoryId = this.memoryOps.getIndexedPlaybookMemoryId(playbook.recordId);

    const reasons: string[] = [];
    if (effectiveness.failedRuns30d >= 2) {
      reasons.push(`Repeated failed runs in the last 30 days (${effectiveness.failedRuns30d}).`);
    }
    const interventionLabel = effectiveness.intervenedRuns30d === 1 ? 'intervention' : 'interventions';
    if (effectiveness.intervenedRuns30d >= 1) {
      reasons.push(`Operator ${interventionLabel} in the last 30 days (${effectiveness.intervenedRuns30d}).`);
    }
    if (!indexedMemoryId) {
      reasons.push('Missing active procedural-memory index.');
    }
    if (!lastProposalAt || (lastProblemAt && lastProposalAt <= lastProblemAt)) {
      reasons.push('No newer proposal exists after the latest problem signal.');
    }

    return {
      recordId: playbook.recordId,
      title: playbook.title,
      scope: playbook.scope,
      currentRevisionHash: playbook.currentRevisionHash,
      lastUsedAt: effectiveness.lastUsedAt,
      useCount30d: effectiveness.useCount30d,
      failedRuns30d: effectiveness.failedRuns30d,
      interventions30d: effectiveness.intervenedRuns30d,
      lastProposalAt,
      indexedMemoryId,
      reasons,
      lastProblemAt,
      failedRunIds,
      interventionIds,
      suggestedPatchNote: this.buildPlaybookRepairSummary({
        recordId: playbook.recordId,
        title: playbook.title,
        scope: playbook.scope,
        currentRevisionHash: playbook.currentRevisionHash,
        lastUsedAt: effectiveness.lastUsedAt,
        useCount30d: effectiveness.useCount30d,
        failedRuns30d: effectiveness.failedRuns30d,
        interventions30d: effectiveness.intervenedRuns30d,
        lastProposalAt,
        indexedMemoryId,
        reasons,
      }),
    };
  }

  private buildPlaybookRepairSummary(candidate: PlaybookStaleCandidate): string {
    const interventionLabel = candidate.interventions30d === 1 ? 'intervention' : 'interventions';
    const normalizedReasons = candidate.reasons
      .map((reason) => reason.trim().replace(/\.$/, ''))
      .filter((reason) => reason.length > 0);
    const reasonsSuffix = normalizedReasons.length > 0
      ? ` Reasons: ${normalizedReasons.join(', ')}.`
      : '';
    return `Stale follow-up: ${candidate.useCount30d} uses / ${candidate.failedRuns30d} failed runs / ${candidate.interventions30d} ${interventionLabel} in trailing 30 days.${reasonsSuffix}`;
  }

  private getPlaybookWindowStart(): string {
    return new Date(Date.now() - (30 * 24 * 60 * 60 * 1000)).toISOString();
  }

  private runPlaybookAutoDraftSweep(): PlaybookProposalRecord[] {
    const created: PlaybookProposalRecord[] = [];
    for (const playbook of this.playbookService.listPlaybooks({ status: 'active' })) {
      const signal = this.collectPlaybookSignal(playbook);
      const qualifies = signal.useCount30d >= 3
        && (signal.failedRuns30d >= 2 || signal.interventions30d >= 1)
        && signal.lastProblemAt !== null
        && (signal.lastProposalAt === null || signal.lastProposalAt <= signal.lastProblemAt);
      if (!qualifies) continue;

      const existingOpenProposal = this.databases.app.prepare(`
        SELECT id
        FROM playbook_proposals
        WHERE target_record_id = ?
          AND base_revision_hash = ?
          AND status IN ('drafting', 'pending_review')
        LIMIT 1
      `).get(playbook.recordId, playbook.currentRevisionHash) as { id: string } | undefined;

      if (existingOpenProposal) {
        this.recordSecurityAudit({
          code: 'playbook_proposal_auto_draft_skipped',
          severity: 'info',
          message: 'Skipped auto-drafting because an open proposal already exists for the same playbook revision',
          component: 'runtime-service',
          timestamp: nowIso(),
          details: {
            recordId: playbook.recordId,
            proposalId: existingOpenProposal.id,
          },
        });
        continue;
      }

      const currentPlaybook = this.playbookService.getPlaybook(playbook.recordId);
      if (!currentPlaybook) continue;

      const proposal = this.playbookService.createProposal({
        kind: 'patch',
        targetRecordId: playbook.recordId,
        baseRevisionHash: playbook.currentRevisionHash,
        title: playbook.title,
        allowedProfileIds: playbook.allowedProfileIds,
        summary: signal.suggestedPatchNote,
        body: currentPlaybook.body,
        sourceRunId: null,
        proposedBy: 'maintenance_job',
        status: 'drafting',
        evidence: {
          runIds: signal.failedRunIds,
          interventionIds: signal.interventionIds,
          lastProblemAt: signal.lastProblemAt,
          metrics30d: {
            useCount30d: signal.useCount30d,
            failedRuns30d: signal.failedRuns30d,
            interventions30d: signal.interventions30d,
          },
          suggestedPatchNote: signal.suggestedPatchNote,
        },
      });
      created.push(proposal);
      this.recordSecurityAudit({
        code: 'playbook_proposal_auto_drafted',
        severity: 'info',
        message: 'Auto-drafted a playbook patch proposal from stale signals',
        component: 'runtime-service',
        timestamp: nowIso(),
        details: {
          proposalId: proposal.id,
          recordId: playbook.recordId,
          failedRuns30d: String(signal.failedRuns30d),
          interventions30d: String(signal.interventions30d),
        },
      });
    }

    return created;
  }

  listInterventions(): InterventionRecord[] {
    return this.sessionService.listInterventions();
  }

  resolveIntervention(interventionId: string, resolutionNote?: string): InterventionRecord | null {
    return this.sessionService.resolveIntervention(interventionId, resolutionNote);
  }

  getSecurityAuditFindings() {
    return this.queryService.getSecurityAuditFindings();
  }

  recordSecurityAuditEvent(event: SecurityAuditEvent): void {
    this.recordSecurityAudit(event);
  }

  loadAuthStore() {
    return readAuthStore(this.config.authFile);
  }

  loadRoleAuthStore() {
    return readRoleAuthStore(this.config.authFile);
  }

  issueCsrfToken(): string {
    return this.queryService.issueCsrfToken();
  }

  createBrowserSession() {
    return createRuntimeBrowserSession(this.databases.app);
  }

  validateBrowserSession(sessionId: string): BrowserSessionValidationResult {
    return validateRuntimeBrowserSession(this.databases.app, sessionId);
  }

  startOAuthConnectSession(input: OAuthConnectStartRequest): OAuthSessionRecord {
    return this.oauthConnect.startOAuthConnectSession(input);
  }

  getOAuthSession(id: string): OAuthSessionRecord | null {
    this.oauthSessionService.expirePendingSessions();
    return this.oauthSessionService.getSession(id);
  }

  async completeOAuthConnectCallback(input: {
    code?: string | undefined;
    state?: string | undefined;
    error?: string | undefined;
    errorDescription?: string | undefined;
  }): Promise<OAuthSessionRecord> {
    return this.oauthConnect.completeOAuthConnectCallback(input);
  }

  // --- Delegated: MessageIngestion ---

  ingestMessage(input: unknown): MessageIngressResponse {
    return this.messageIngestion.ingestMessage(input);
  }

  getMessage(messageId: string): MessageRecord | null {
    return this.messageIngestion.getMessage(messageId);
  }

  // --- Telegram delivery (delegated to TelegramDeliveryService) ---

  getTelegramRelayCheckpoint(workspaceId: string, relayKey: 'telegram_long_poll' = 'telegram_long_poll'): TelegramRelayCheckpoint | null {
    return this.telegramDelivery.getTelegramRelayCheckpoint(workspaceId, relayKey);
  }

  commitTelegramRelayCheckpoint(input: TelegramRelayCheckpointCommitRequest): TelegramRelayCheckpoint {
    try {
      return this.telegramDelivery.commitTelegramRelayCheckpoint(input);
    } catch (error) {
      if (error instanceof Error && 'errorCode' in error && error.errorCode === 'not_found') {
        throw new RuntimeNotFoundError(error.message);
      }
      throw error;
    }
  }

  markTelegramReplySending(
    chatId: string,
    telegramMessageId: number,
    input: { workspaceId: string; runId?: string | null },
  ): TelegramDeliveryState | null {
    return this.telegramDelivery.markTelegramReplySending(chatId, telegramMessageId, input);
  }

  markTelegramReplyPending(
    chatId: string,
    telegramMessageId: number,
    input: { workspaceId: string; runId?: string | null },
  ): TelegramDeliveryState | null {
    return this.telegramDelivery.markTelegramReplyPending(chatId, telegramMessageId, input);
  }

  markTelegramReplyUncertain(
    chatId: string,
    telegramMessageId: number,
    input: { workspaceId: string; runId?: string | null; reason?: string | null },
  ): TelegramDeliveryState | null {
    return this.telegramDelivery.markTelegramReplyUncertain(chatId, telegramMessageId, input);
  }

  markTelegramReplySent(
    chatId: string,
    telegramMessageId: number,
    input: { workspaceId: string; runId?: string | null; sentTelegramMessageId?: number | null },
  ): TelegramDeliveryState | null {
    return this.telegramDelivery.markTelegramReplySent(chatId, telegramMessageId, input);
  }

  listUncertainDeliveries(workspaceId?: string): TelegramDeliveryRecord[] {
    return this.telegramDelivery.listUncertainDeliveries(workspaceId);
  }

  getDeliveryById(id: string): TelegramDeliveryRecord | null {
    return this.telegramDelivery.getDeliveryById(id);
  }

  resolveTelegramDelivery(deliveryId: string, input: TelegramDeliveryResolutionRequest): TelegramDeliveryResolutionRecord {
    return this.telegramDelivery.resolveTelegramDelivery(deliveryId, input);
  }

  listDeliveryResolutions(deliveryId: string): TelegramDeliveryResolutionRecord[] {
    return this.telegramDelivery.listDeliveryResolutions(deliveryId);
  }

  getResendableDeliveries(workspaceId: string): TelegramDeliveryRecord[] {
    return this.telegramDelivery.getResendableDeliveries(workspaceId);
  }

  recordTelegramSendAttempt(input: {
    deliveryId?: string;
    chatId?: string;
    telegramMessageId?: number;
    workspaceId: string;
    startedAt: string;
    finishedAt?: string;
    runId?: string;
    contentHash: string;
    outcome: string;
    sentTelegramMessageId?: number;
    errorSummary?: string;
    source?: string;
  }): TelegramSendAttemptRecord {
    return this.telegramDelivery.recordTelegramSendAttempt(input);
  }

  listTelegramSendAttempts(deliveryId: string): TelegramSendAttemptRecord[] {
    return this.telegramDelivery.listTelegramSendAttempts(deliveryId);
  }

  // --- Run lifecycle (stays in facade -- tightly coupled to event loop) ---

  getRun(runId: string): RunRecord | null {
    const row = this.databases.app.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
    if (!row) return null;
    return mapRunRow(row);
  }

  listRuns(): RunRecord[] {
    return z.array(RunRowSchema)
      .parse(this.databases.app.prepare('SELECT * FROM runs ORDER BY started_at DESC').all())
      .map(mapRunRow);
  }

  listFailedRuns(): RunRecord[] {
    return z.array(RunRowSchema)
      .parse(this.databases.app.prepare("SELECT * FROM runs WHERE state IN ('failed_retryable', 'failed_final', 'abandoned') ORDER BY started_at DESC").all())
      .map(mapRunRow);
  }

  listRunEvents(runId: string): RunEventRecord[] {
    return z.array(RunEventRowSchema)
      .parse(this.databases.app.prepare('SELECT * FROM run_events WHERE run_id = ? ORDER BY created_at ASC').all(runId))
      .map(mapRunEventRow);
  }

  getRunReply(runId: string): RunReply | null {
    const run = this.getRun(runId);
    if (!run) return null;
    const receipt = this.getReceiptByRunId(runId);
    if (!receipt) return null;
    const reply = buildCanonicalRunReply(this.listRunEvents(runId), receipt, buildReceiptFallbackReplyText);
    if (!reply) return null;
    return RunReplySchema.parse({
      runId,
      terminalStatus: receipt.status,
      source: reply.source,
      text: reply.text,
    });
  }

  retryRun(runId: string): JobRecord | null {
    const run = this.getRun(runId);
    if (!run) return null;
    return this.enqueueTask(run.taskId);
  }

  async cancelRun(runId: string): Promise<RunRecord | null> {
    const run = this.getRun(runId);
    if (!run) return null;
    if (isTerminalRunState(run.state)) return run;

    // Cascade: cancel active delegate runs first
    const activeDelegates = this.listDelegateRuns(runId).filter(d => !isTerminalRunState(d.state));
    for (const delegate of activeDelegates) {
      await this.cancelRun(delegate.id);
    }

    const activeRun = this.runExecutor.getActiveRun(runId);
    if (activeRun) {
      await activeRun.handle.cancel();
      return this.getRun(runId);
    }
    this.databases.app.prepare('UPDATE runs SET state = ?, finished_at = ? WHERE id = ?').run('cancelled', nowIso(), runId);
    this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('cancelled', nowIso(), run.jobId);
    this.databases.app.prepare('DELETE FROM job_leases WHERE job_id = ?').run(run.jobId);
    const receipt = this.writeRuntimeReceipt({
      runId,
      jobId: run.jobId,
      taskId: run.taskId,
      workspaceId: run.workspaceId,
      status: 'cancelled',
      summary: 'Run cancelled',
      details: '',
      usage: { provider: this.config.engine.kind, model: 'n/a', tokensIn: 0, tokensOut: 0, estimatedCostUsd: 0 },
    });
    this.emit('run_completed', receipt);
    return this.getRun(runId);
  }

  async waitForJobTerminalState(jobId: string, timeoutMs = 10_000): Promise<{ job: JobRecord; run: RunRecord | null; receipt: ReceiptRecord | null } | null> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const job = this.getJob(jobId);
      if (job && isTerminalJobStatus(job.status)) {
        const run = job.lastRunId ? this.getRun(job.lastRunId) : null;
        const receipt = run ? this.getReceiptByRunId(run.id) : null;
        return { job, run, receipt };
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  }

  async waitForTaskTerminalReceipt(taskId: string, timeoutMs = 10_000): Promise<ReceiptRecord | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const receipt = this.enrichReceipt(this.receiptManager.getReceiptByTaskId(taskId));
      if (receipt) return receipt;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  }

  // --- Scheduler (stays in facade -- tightly coupled to run lifecycle) ---

  startScheduler(): void {
    if (this.scheduler.running) return;
    this.scheduler.running = true;
    this.ensureConfiguredHeartbeatSchedules();
    this.scheduler.tickTimer = setInterval(() => void this.processSchedulerTick(), this.scheduler.tickIntervalMs);
    this.scheduler.leaseTimer = setInterval(() => void this.processLeaseSweep(), this.scheduler.leaseRefreshIntervalMs);
    void this.processSchedulerTick();
    void this.processLeaseSweep();
    this.log.info('scheduler started');
  }

  async runSchedulerCycle(): Promise<void> {
    await this.processSchedulerTick();
    await this.processLeaseSweep();
  }

  async stopScheduler(): Promise<void> {
    this.log.info('scheduler stopping', { activeRuns: this.runExecutor.activeRunCount });
    if (this.scheduler.tickTimer) clearInterval(this.scheduler.tickTimer);
    if (this.scheduler.leaseTimer) clearInterval(this.scheduler.leaseTimer);
    this.scheduler.tickTimer = null;
    this.scheduler.leaseTimer = null;
    this.scheduler.running = false;

    if (this.runExecutor.activeRunCount === 0) return;

    for (const activeRun of this.runExecutor.getActiveRuns().values()) {
      await activeRun.handle.cancel();
    }

    const waiters = Array.from(this.runExecutor.getActiveRuns().values()).map((activeRun) =>
      Promise.race([
        activeRun.handle.wait(),
        new Promise<EngineRunCompletion>((resolve) => {
          setTimeout(() => resolve({ engineSessionRef: null, usage: { provider: this.config.engine.kind, model: 'unknown', tokensIn: 0, tokensOut: 0, estimatedCostUsd: 0 }, failureClassification: 'cancelled' }), this.scheduler.shutdownGraceMs);
        }),
      ]).then(async () => {
        if (activeRun.finalizing) return;
        await this.runExecutor.abandonRun(activeRun.runId, 'Scheduler shutdown interrupted an in-flight run');
      }),
    );
    await Promise.all(waiters);
  }

  // --- Memory public API ---

  async searchMemory(query: MemorySearchQuery): Promise<MemorySearchResponse> {
    return this.memoryOps.searchMemory(query);
  }

  async explainMemoryRecall(input: {
    query: string;
    memoryId: string;
    scope?: string;
    workspaceId?: string | null;
    projectId?: string | null;
    includeGlobal?: boolean;
    memoryTypes?: MemoryType[];
    layers?: Array<'artifact' | 'fact' | 'synthesis' | 'curated'>;
    namespaceIds?: string[];
    tags?: string[];
    includeSuperseded?: boolean;
  }, locationFilter?: { workspaceId: string | null; projectId: string | null; includeGlobal?: boolean }) {
    return this.memoryOps.explainMemoryRecall(input, locationFilter);
  }

  getMemoryContent(memoryId: string, locationFilter?: { workspaceId: string | null; projectId: string | null; includeGlobal?: boolean }): MemoryRecord | null {
    return this.memoryOps.getMemoryContent(memoryId, locationFilter);
  }

  getMemoryAudit(): MemoryAuditResponse {
    return this.memoryOps.getMemoryAudit();
  }

  checkMemoryIntegrity(options?: { fix?: boolean }): IntegrityReport {
    return this.memoryOps.checkMemoryIntegrity(options);
  }

  insertMemory(input: MemoryInsertInput): MemoryRecord | null {
    return this.memoryOps.insertMemory(input);
  }

  listMemories(options?: {
    type?: string;
    scope?: string;
    workspaceId?: string | null;
    projectId?: string | null;
    includeGlobal?: boolean;
    limit?: number;
  }): MemoryRecord[] {
    return this.memoryOps.listMemories(options);
  }

  getMemory(memoryId: string, locationFilter?: { workspaceId: string | null; projectId: string | null; includeGlobal?: boolean }): MemoryRecord | null {
    return this.memoryOps.getMemory(memoryId, locationFilter);
  }

  async budgetFitMemory(query: {
    query: string;
    scope?: string;
    workspaceId?: string | null;
    projectId?: string | null;
    includeGlobal?: boolean;
    memoryTypes?: Array<'episodic' | 'semantic' | 'procedural'>;
    minConfidence?: number;
    maxTokens: number;
    limit?: number;
    domains?: string[];
    consumerProfile?: string;
  }) {
    return this.memoryOps.budgetFitMemory(query);
  }

  describeMemory(memoryId: string, locationFilter?: { workspaceId: string | null; projectId: string | null; includeGlobal?: boolean }) {
    return this.memoryOps.describeMemory(memoryId, locationFilter);
  }

  expandMemory(memoryId: string, maxTokens?: number, locationFilter?: { workspaceId: string | null; projectId: string | null; includeGlobal?: boolean }) {
    return this.memoryOps.expandMemory(memoryId, maxTokens, locationFilter);
  }

  triggerMemoryMaintenance(): { ttlExpired: number; staleMarked: number } {
    return this.memoryOps.triggerMemoryMaintenance();
  }

  importMemory(input: {
    description: string;
    content: string;
    sourceType?: MemoryInsertInput['sourceType'];
    memoryType?: 'episodic' | 'semantic' | 'procedural';
    scope?: string;
    workspaceId?: string | null;
    projectId?: string | null;
    confidence?: number;
    classification?: 'secret' | 'sensitive' | 'internal' | 'embeddable';
    domain?: MemoryInsertInput['domain'];
    tags?: string[];
    durable?: boolean;
    dedupKey?: string;
    sourceRunId?: string;
    sourceTimestamp?: string;
  }): { memoryId: string; embedded: boolean } {
    return this.memoryOps.importMemory(input);
  }

  proposeMemoryPromotion(memoryId: string, targetPath: string) {
    return this.memoryOps.proposeMemoryPromotion(memoryId, targetPath);
  }

  executeMemoryPromotion(request: { memoryId: string; targetPath: string; diff: string; approved: boolean; promoted: boolean }) {
    return this.memoryOps.executeMemoryPromotion(request);
  }

  async assembleMemoryContext(opts: { query: string; scope?: string; workspaceId?: string | null; projectId?: string | null; maxTokens?: number; consumerProfile?: string; includeProvenance?: boolean }) {
    return this.memoryOps.assembleContext(opts);
  }

  pinMemory(memoryId: string, targetKind: 'fact' | 'synthesis', reason: string) {
    return this.memoryOps.pinMemory(memoryId, targetKind, reason);
  }

  forgetMemory(memoryId: string, reason: string) {
    return this.memoryOps.forgetMemory(memoryId, reason);
  }

  getMemoryHistory(memoryId: string) {
    return this.memoryOps.getMemoryHistory(memoryId);
  }

  // --- Delegated: SecretStore ---

  setSecret(input: Parameters<SecretStore['setSecret']>[0]): SecretRefRecord {
    return this.secretStore.setSecret(input);
  }

  getSecretValue(id: string): string | null {
    return this.secretStore.getSecretValue(id);
  }

  hasSecret(id: string): boolean {
    return this.secretStore.hasSecret(id);
  }

  listSecrets(connectionId?: string): SecretRefRecord[] {
    return this.secretStore.listSecrets(connectionId);
  }

  deleteSecret(id: string): boolean {
    return this.secretStore.deleteSecret(id);
  }

  rotateSecret(id: string, newValue: string): SecretRefRecord | null {
    return this.secretStore.rotateSecret(id, newValue);
  }

  // --- Delegated: ApprovalService ---

  requestApproval(input: Parameters<ApprovalService['requestApproval']>[0]): ApprovalRecord {
    return this.approvalService.requestApproval(input);
  }

  requestActionApproval(input: ActionApprovalRequestInput): ApprovalRecord {
    const policy = this.actionPolicyEvaluator.evaluateAction(input);
    return this.approvalService.requestApproval({
      ...input,
      riskClass: policy.riskClass,
      standingApprovalEligible: policy.standingApprovalEligible,
      automationGrantEligible: policy.automationGrantEligible,
    });
  }

  resolveApproval(id: string, input: ApprovalResolveInput): ApprovalRecord {
    return this.approvalService.resolveApproval(id, input);
  }

  getApproval(id: string): ApprovalRecord | null {
    return this.approvalService.getApproval(id);
  }

  listApprovals(filter?: { scope?: string; status?: string; domain?: string; actionKind?: string; runId?: string; resolvedBy?: string }): ApprovalRecord[] {
    return this.approvalService.listApprovals(filter);
  }

  createStandingApproval(input: Parameters<ApprovalService['createStandingApproval']>[0]) {
    return this.approvalService.createStandingApproval(input);
  }

  listStandingApprovals(filter?: Parameters<ApprovalService['listStandingApprovals']>[0]) {
    return this.approvalService.listStandingApprovals(filter);
  }

  revokeStandingApproval(id: string, input: Parameters<ApprovalService['revokeStandingApproval']>[1]) {
    return this.approvalService.revokeStandingApproval(id, input);
  }

  createAutomationGrant(input: Parameters<ApprovalService['createAutomationGrant']>[0]) {
    return this.approvalService.createAutomationGrant(input);
  }

  listAutomationGrants(filter?: Parameters<ApprovalService['listAutomationGrants']>[0]) {
    return this.approvalService.listAutomationGrants(filter);
  }

  revokeAutomationGrant(id: string, input: Parameters<ApprovalService['revokeAutomationGrant']>[1]) {
    return this.approvalService.revokeAutomationGrant(id, input);
  }

  // --- Delegated: VaultManager ---

  createVault(input: { domain: DomainKind; name: string; kind?: 'capability' | 'restricted' }): VaultRecord {
    return this.vaultManager.createVault(input);
  }

  openVault(vaultId: string, approvalId: string): VaultHandle | null {
    const approval = this.approvalService.getApproval(approvalId);
    if (!approval || approval.status !== 'approved') {
      this.log.warn('vault open denied: approval not found or not approved', { vaultId, approvalId });
      return null;
    }
    return this.vaultManager.openVault(vaultId, approvalId);
  }

  closeVault(vaultId: string): boolean {
    return this.vaultManager.closeVault(vaultId);
  }

  sealVault(vaultId: string): boolean {
    return this.vaultManager.sealVault(vaultId);
  }

  listVaults(domain?: DomainKind): VaultRecord[] {
    return this.vaultManager.listVaults(domain);
  }

  getVault(vaultId: string): VaultRecord | null {
    return this.vaultManager.getVault(vaultId);
  }

  // --- Delegated: ContextReleaseService ---

  recordContextRelease(input: Parameters<ContextReleaseService['recordRelease']>[0]): ContextReleaseDecision {
    return this.contextReleaseService.recordRelease(input);
  }

  listContextReleases(runId: string): ContextReleaseDecision[] {
    return this.contextReleaseService.listReleasesForRun(runId);
  }

  summarizeRunReleases(runId: string): {
    totalReleases: number;
    totalTokenEstimate: number;
    byDomain: Record<string, { count: number; tokens: number }>;
  } {
    return this.contextReleaseService.summarizeRunReleases(runId);
  }

  previewContextRelease(input: { domain: DomainKind; sourceRef: string }): ContextReleasePreview {
    return this.contextReleaseService.previewRelease(input);
  }

  // --- Policy: domain policy + connections ---

  getSecurityPolicy(): SecurityPolicyResponse {
    const domainPolicies = Object.values(DOMAIN_POLICY_DEFAULTS);
    return {
      domainPolicies,
      approvalRules: this.actionPolicyEvaluator.listRules(),
      defaultRiskClass: this.actionPolicyEvaluator.getDefaultRiskClass(),
      actionDefaults: this.actionPolicyEvaluator.listActionDefaults(),
    };
  }

  // --- ConnectionService delegates (private helpers) ---

  private updateConnectionRollups(input: {
    connectionId: string;
    health?: Partial<ConnectionHealthSummary> | undefined;
    sync?: Partial<ConnectionSyncSummary> | undefined;
  }): ConnectionRecord | null {
    return this.connectionService.updateConnectionRollups(input);
  }

  private getOAuthRedirectUri(): string {
    return this.connectionService.getOAuthRedirectUri();
  }

  private getConnectionOAuthSecret(connection: ConnectionRecord): StoredOAuthSecret | null {
    return this.connectionService.getConnectionOAuthSecret(connection);
  }

  private storeOAuthSecret(connectionId: string | null, providerKind: ConnectionRecord['providerKind'], payload: OAuthTokenPayload, existingSecretRefId?: string | null): SecretRefRecord {
    return this.connectionService.storeOAuthSecret(connectionId, providerKind, payload, existingSecretRefId);
  }

  private async resolveEmailAdapterForConnection(connectionId: string): Promise<{
    adapter: EmailProviderAdapter;
    account: { id: string; connectionId: string; emailAddress: string };
  } | null> {
    return this.connectionService.resolveEmailAdapterForConnection(connectionId);
  }

  private async resolveCalendarAdapterForConnection(connectionId: string): Promise<{
    adapter: GoogleCalendarAdapter;
    account: { id: string; connectionId: string; calendarEmail: string };
  } | null> {
    return this.connectionService.resolveCalendarAdapterForConnection(connectionId);
  }

  private async resolveGithubAdapterForConnection(connectionId: string): Promise<{
    adapter: GithubApiAdapter;
    account: { id: string; connectionId: string; githubUsername: string };
  } | null> {
    return this.connectionService.resolveGithubAdapterForConnection(connectionId);
  }

  private requireConnectionForOperation(input: {
    connectionId: string;
    purpose: string;
    expectedDomain: DomainKind;
    allowedProviderKinds?: Array<ConnectionRecord['providerKind']>;
    requireSecret?: boolean | undefined;
    runId?: string | undefined;
    jobId?: string | undefined;
    taskId?: string | undefined;
  }): ConnectionRecord {
    return this.connectionService.requireConnectionForOperation(input);
  }

  private requireEmailAccountForOperation(
    service: EmailService,
    accountId: string,
    purpose: string,
  ): { account: EmailAccountRecord; connection: ConnectionRecord } {
    return this.connectionService.requireEmailAccountForOperation(service, accountId, purpose);
  }

  private requireGithubAccountForOperation(
    service: GithubService,
    accountId: string,
    purpose: string,
  ): { account: GithubAccountRecord; connection: ConnectionRecord } {
    return this.connectionService.requireGithubAccountForOperation(service, accountId, purpose);
  }

  private requireCalendarAccountForOperation(
    service: CalendarService,
    accountId: string,
    purpose: string,
  ): { account: CalendarAccountRecord; connection: ConnectionRecord } {
    return this.connectionService.requireCalendarAccountForOperation(service, accountId, purpose);
  }

  // Capability facade invalidation is now handled by CapabilityFacade.invalidate()
  // via this.emailFacade.invalidate(), this.calendarFacade.invalidate(), etc.

  private classifyConnectionFailure(message: string): Pick<ConnectionHealthSummary, 'status' | 'authState'> {
    return this.connectionService.classifyConnectionFailure(message);
  }

  private requireReadWriteConnection(connection: ConnectionRecord, purpose: string): void {
    this.connectionService.requireReadWriteConnection(connection, purpose);
  }

  private connectionAllowsResourceWrite(connection: ConnectionRecord, resourceType: string, resourceId: string): boolean {
    return this.connectionService.connectionAllowsResourceWrite(connection, resourceType, resourceId);
  }

  private requireAllowlistedConnectionResource(connection: ConnectionRecord, purpose: string, resourceType: string, resourceId: string): void {
    this.connectionService.requireAllowlistedConnectionResource(connection, purpose, resourceType, resourceId);
  }

  private requireApprovedExternalWrite(input: ActionApprovalRequestInput): ApprovalRecord {
    const approval = this.requestActionApproval(input);
    if (approval.status === 'approved') {
      return approval;
    }
    if (approval.status === 'denied') {
      throw new RuntimeValidationError(
        `External write denied for ${input.resourceType} ${input.resourceId}. Approval ${approval.id} is denied.`,
      );
    }
    throw new RuntimeConflictError(
      `External write requires approval for ${input.resourceType} ${input.resourceId}. Approval ${approval.id} is ${approval.status}.`,
    );
  }

  private requireTodoAccountForOperation(
    service: TodoService,
    accountId: string,
    purpose: string,
    options: { requireSecret?: boolean | undefined } = {},
  ): { account: TodoAccountRecord; connection: ConnectionRecord | null } {
    return this.connectionService.requireTodoAccountForOperation(service, accountId, purpose, options);
  }

  // --- ConnectionService delegates (public CRUD) ---

  listConnections(domain?: string): ConnectionRecord[] {
    return this.connectionService.listConnections(domain);
  }

  createConnection(input: ConnectionCreateInput): ConnectionRecord {
    return this.connectionService.createConnection(input);
  }

  updateConnection(id: string, input: ConnectionUpdateInput): ConnectionRecord | null {
    return this.connectionService.updateConnection(id, input);
  }

  deleteConnection(id: string): boolean {
    return this.connectionService.deleteConnection(id);
  }

  addConnectionResourceRule(connectionId: string, rule: { resourceType: string; resourceId: string; displayName: string; writeAllowed?: boolean }): ConnectionRecord | null {
    return this.connectionService.addConnectionResourceRule(connectionId, rule);
  }

  removeConnectionResourceRule(connectionId: string, resourceType: string, resourceId: string): ConnectionRecord | null {
    return this.connectionService.removeConnectionResourceRule(connectionId, resourceType, resourceId);
  }

  listConnectionResourceRules(connectionId: string): ConnectionResourceRule[] {
    return this.connectionService.listConnectionResourceRules(connectionId);
  }

  getConnectionDiagnostics(connectionId: string): ConnectionDiagnosticsResponse | null {
    return this.connectionService.getConnectionDiagnostics(connectionId);
  }

  reconnectConnection(connectionId: string, action: ConnectionRemediationAction): ConnectionRecord | null {
    return this.connectionService.reconnectConnection(connectionId, action);
  }

  private getConnection(id: string): ConnectionRecord | null {
    return this.connectionService.getConnection(id);
  }

  // --- Internal: event emission ---

  private emit(event: string, payload: unknown): void {
    this.events.emit('event', { event, data: JSON.stringify(payload) } satisfies RuntimeEvent);
  }

  // --- Internal: startup & seeding ---

  private seedDaemonState(): void {
    this.databases.app
      .prepare(`
        INSERT INTO daemon_state (id, started_at, last_shutdown_at, engine_kind, schema_version)
        VALUES (1, ?, NULL, ?, ?)
        ON CONFLICT(id) DO UPDATE SET started_at = excluded.started_at, engine_kind = excluded.engine_kind, schema_version = excluded.schema_version
      `)
      .run(this.startedAt, this.config.engine.kind, '1');
  }

  private seedReferenceData(): void {
    this.databases.app.prepare(
      `INSERT OR IGNORE INTO agent_profiles (
        id, name, description, mode, model_policy, allowed_runtime_tools_json,
        allowed_capability_ids_json, memory_scope, recall_scope,
        filesystem_policy_class, context_release_policy, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'default',
      'Default agent profile',
      'Default interactive profile',
      'interactive',
      'inherit',
      '[]',
      '[]',
      'workspace',
      'workspace',
      'workspace',
      'summary_only',
      this.startedAt,
      this.startedAt,
    );
    for (const workspace of this.config.workspaces) {
      this.databases.app.prepare('INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES (?, ?, ?)').run(workspace.id, workspace.name, this.startedAt);
      if (workspace.rootPath) {
        this.databases.app.prepare('UPDATE workspaces SET root_path = ? WHERE id = ?').run(workspace.rootPath, workspace.id);
      }
      for (const project of workspace.projects ?? []) {
        this.databases.app.prepare('INSERT OR IGNORE INTO projects (id, workspace_id, name, created_at) VALUES (?, ?, ?, ?)').run(project.id, workspace.id, project.name, this.startedAt);
        this.databases.app.prepare('UPDATE projects SET path = ? WHERE id = ?').run(project.path, project.id);
      }
    }
  }

  private ensureConfiguredHeartbeatSchedules(): void {
    for (const workspace of this.config.workspaces) {
      const heartbeatTaskId = `task:heartbeat:${workspace.id}`;
      const scheduleId = `schedule:heartbeat:${workspace.id}`;
      const heartbeatTitle = `heartbeat:${workspace.id}`;
      const heartbeatPrompt = `Heartbeat check for workspace ${workspace.name}`;
      const heartbeatStatus = workspace.heartbeatEnabled ? 'active' : 'paused';
      const retryPolicy = JSON.stringify({ maxAttempts: 3, baseDelaySeconds: 5, multiplier: 2, maxDelaySeconds: 900 });

      this.databases.app
        .prepare('INSERT OR IGNORE INTO tasks (id, workspace_id, project_id, profile_id, title, prompt, source, status, retry_policy_json, side_effect_profile, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(
          heartbeatTaskId,
          workspace.id,
          null,
          'default',
          heartbeatTitle,
          heartbeatPrompt,
          'heartbeat',
          heartbeatStatus,
          retryPolicy,
          'read_only',
          this.startedAt,
        );
      this.databases.app
        .prepare('UPDATE tasks SET title = ?, prompt = ?, profile_id = ?, status = ?, retry_policy_json = ?, side_effect_profile = ? WHERE id = ?')
        .run(heartbeatTitle, heartbeatPrompt, 'default', heartbeatStatus, retryPolicy, 'read_only', heartbeatTaskId);

      if (workspace.heartbeatEnabled) {
        this.databases.app
          .prepare('INSERT OR IGNORE INTO schedules (id, task_id, interval_seconds, created_at) VALUES (?, ?, ?, ?)')
          .run(scheduleId, heartbeatTaskId, workspace.heartbeatIntervalSeconds, this.startedAt);
        this.databases.app.prepare('UPDATE schedules SET interval_seconds = ? WHERE id = ?').run(workspace.heartbeatIntervalSeconds, scheduleId);
      } else {
        this.databases.app.prepare('DELETE FROM schedules WHERE id = ?').run(scheduleId);
      }
    }
  }

  private redactError(error: string | null): string | null {
    if (!error) return null;
    const result = redactText(error, this.config.security.redactionPatterns);
    for (const event of result.events) this.recordSecurityAudit(event);
    return result.text;
  }

  // --- Internal: reconciliation ---

  private reconcileStartupState(): void {
    const reconciledAt = nowIso();
    const staleRuns = z.array(RunRowSchema).parse(this.databases.app
      .prepare("SELECT * FROM runs WHERE state IN ('starting', 'running') AND finished_at IS NULL")
      .all());

    for (const row of staleRuns) {
      const run = mapRunRow(row);
      this.receiptManager.writeAbandonedReceiptIfMissing(
        run.id,
        run.jobId,
        run.taskId,
        run.workspaceId,
        'Run abandoned during daemon startup reconciliation',
        'Daemon restarted before the run reached a terminal state',
      );
      this.databases.app.prepare('UPDATE runs SET state = ?, finished_at = ?, error = ? WHERE id = ?').run('abandoned', reconciledAt, this.redactError('Daemon restarted before the run reached a terminal state'), run.id);
      void this.runExecutor.applyRecoveryDecision(run.jobId, run.id, 'Daemon restarted before the run reached a terminal state');
    }

    const staleLeasedJobs = z.array(IdRowSchema).parse(this.databases.app
      .prepare("SELECT j.id FROM jobs j LEFT JOIN job_leases l ON l.job_id = j.id WHERE j.status = 'leased' AND (l.job_id IS NULL OR l.lease_expires_at <= ?)")
      .all(reconciledAt));
    for (const job of staleLeasedJobs) {
      this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('queued', reconciledAt, job.id);
      this.databases.app.prepare('DELETE FROM job_leases WHERE job_id = ?').run(job.id);
    }

    if (staleRuns.length > 0 || staleLeasedJobs.length > 0) {
      this.recordSecurityAudit({
        code: 'startup_reconciliation',
        severity: 'warn',
        message: `Reconciled ${staleRuns.length} stale runs and ${staleLeasedJobs.length} leased jobs on startup`,
        component: 'runtime-core',
        timestamp: reconciledAt,
        details: {
          staleRuns: String(staleRuns.length),
          staleLeasedJobs: String(staleLeasedJobs.length),
        },
      });
    }
  }

  private recordSecurityAudit(event: SecurityAuditEvent): void {
    this.databases.app
      .prepare('INSERT INTO security_audit (id, code, severity, message, component, timestamp, details_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), event.code, event.severity, event.message, event.component, event.timestamp, JSON.stringify(event.details));
    this.emit('security_audit', event);
  }

  private createIntervention(code: InterventionRecord['code'], runId: string | null, reason: string): void {
    const intervention = this.sessionService.createIntervention(code, runId, reason);
    this.databases.app.prepare(
      'INSERT INTO interventions_fts (intervention_id, run_id, code, status, reason) VALUES (?, ?, ?, ?, ?)',
    ).run(
      intervention.id,
      intervention.runId,
      intervention.code,
      intervention.status,
      intervention.reason,
    );
    this.emit('intervention_created', intervention);
  }

  // --- Internal: scheduler tick & lease sweep ---

  private async processSchedulerTick(): Promise<void> {
    if (this.closed) return;
    try {
      this.scheduler.lastSchedulerTickAt = nowIso();
      this.ensureHeartbeatJobs();
      this.databases.app.prepare("UPDATE jobs SET status = 'queued', updated_at = ? WHERE status = 'waiting_retry' AND available_at <= ?").run(nowIso(), nowIso());
      const dueJobs = z.array(IdRowSchema).parse(this.databases.app
        .prepare("SELECT id FROM jobs WHERE status = 'queued' AND available_at <= ? ORDER BY available_at ASC, created_at ASC")
        .all(nowIso()));

      if (dueJobs.length > 0) {
        this.log.debug('scheduler tick', { dueJobs: dueJobs.length });
      }
      for (const row of dueJobs) {
        const job = this.getJob(row.id);
        if (!job) continue;
        const workspaceId = job.workspaceId;
        if (this.workspaceHasActiveExecution(workspaceId)) continue;
        await this.runExecutor.startJobExecution(job.id);
      }
    } catch (error) {
      if (!this.closed) throw error;
    }
  }

  private async processLeaseSweep(): Promise<void> {
    if (this.closed) return;
    try {
      this.scheduler.lastLeaseSweepAt = nowIso();

      for (const activeRun of Array.from(this.runExecutor.getActiveRuns().values())) {
        if (activeRun.handle.isAlive && !activeRun.handle.isAlive()) {
          await this.runExecutor.abandonRun(activeRun.runId, 'Worker liveness check failed during lease sweep');
          continue;
        }
        this.refreshLease(activeRun.jobId, activeRun.handle.pid ? `worker:${activeRun.handle.pid}` : `popeyed:${process.pid}`);
      }

      const expiredLeases = z.array(JobIdRowSchema).parse(this.databases.app
        .prepare('SELECT job_id FROM job_leases WHERE lease_expires_at <= ?')
        .all(nowIso()));
      if (expiredLeases.length > 0) {
        this.log.debug('lease sweep', { expired: expiredLeases.length });
      }
      for (const lease of expiredLeases) {
        const job = this.getJob(lease.job_id);
        if (!job) continue;
        if (job.status === 'leased') {
          this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('queued', nowIso(), job.id);
          this.databases.app.prepare('DELETE FROM job_leases WHERE job_id = ?').run(job.id);
          this.releaseWorkspaceLock(job.workspaceId);
        }
      }
    } catch (error) {
      if (!this.closed) throw error;
    }
  }

  // --- Internal: workspace locks & leases ---

  private workspaceHasActiveExecution(workspaceId: string): boolean {
    const rawLock = this.databases.app.prepare('SELECT id FROM locks WHERE scope = ?').get(`workspace:${workspaceId}`);
    const lock = rawLock ? IdRowSchema.parse(rawLock) : null;
    if (lock) return true;
    const active = parseCountRow(this.databases.app
      .prepare("SELECT COUNT(*) AS count FROM jobs WHERE workspace_id = ? AND status IN ('leased', 'running')")
      .get(workspaceId));
    return active > 0;
  }

  private acquireWorkspaceLock(workspaceId: string, owner: string): string | null {
    const lockId = `workspace:${workspaceId}`;
    const rawExisting = this.databases.app.prepare('SELECT id FROM locks WHERE id = ?').get(lockId);
    const existing = rawExisting ? IdRowSchema.parse(rawExisting) : null;
    if (existing) return null;
    this.databases.app.prepare('INSERT INTO locks (id, scope, owner, created_at) VALUES (?, ?, ?, ?)').run(lockId, lockId, owner, nowIso());
    return lockId;
  }

  private releaseWorkspaceLock(workspaceId: string): void {
    this.databases.app.prepare('DELETE FROM locks WHERE id = ?').run(`workspace:${workspaceId}`);
  }

  private refreshLease(jobId: string, owner: string): void {
    this.databases.app
      .prepare('INSERT OR REPLACE INTO job_leases (job_id, lease_owner, lease_expires_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(jobId, owner, new Date(Date.now() + this.scheduler.leaseTtlMs).toISOString(), nowIso());
  }

  // --- Internal: heartbeat scheduling ---

  private ensureHeartbeatJobs(): void {
    const schedules = z.array(ScheduleRowSchema).parse(this.databases.app.prepare('SELECT * FROM schedules ORDER BY created_at ASC').all());
    for (const schedule of schedules) {
      const task = this.getTask(schedule.task_id);
      if (!task || task.source !== 'heartbeat') continue;
      const existing = parseCountRow(this.databases.app
        .prepare("SELECT COUNT(*) AS count FROM jobs WHERE task_id = ? AND status IN ('queued', 'leased', 'running', 'waiting_retry')")
        .get(task.id));
      if (existing > 0) continue;
      const lastTime = parseCreatedAt(this.databases.app.prepare('SELECT created_at FROM jobs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(task.id)) ?? schedule.created_at;
      const dueAt = new Date(new Date(lastTime).getTime() + schedule.interval_seconds * 1000);
      if (Date.now() >= dueAt.getTime()) {
        this.enqueueTask(task.id, { availableAt: nowIso() });
      }
    }
  }

  private computeNextHeartbeatDueAt(): string | null {
    const schedules = z.array(ScheduleRowSchema).parse(this.databases.app.prepare('SELECT * FROM schedules ORDER BY created_at ASC').all());
    if (schedules.length === 0) return null;
    let nextDueAt: string | null = null;
    for (const schedule of schedules) {
      const lastTime = parseCreatedAt(this.databases.app.prepare('SELECT created_at FROM jobs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(schedule.task_id)) ?? schedule.created_at;
      const dueAt = new Date(new Date(lastTime).getTime() + schedule.interval_seconds * 1000).toISOString();
      if (!nextDueAt || dueAt < nextDueAt) nextDueAt = dueAt;
    }
    return nextDueAt;
  }

  // --- Internal: auth token rotation ---

  private startTokenRotationCheck(): void {
    const checkIntervalMs = 24 * 60 * 60 * 1000; // Check daily
    const check = () => {
      try {
        const store = readAuthStore(this.config.authFile);
        const createdAt = new Date(store.current.createdAt);
        const ageDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
        if (ageDays >= this.config.security.tokenRotationDays) {
          rotateAuthStore(this.config.authFile);
          this.recordSecurityAuditEvent({
            code: 'auth_token_rotated',
            severity: 'info',
            message: `Auth token auto-rotated after ${Math.floor(ageDays)} days`,
            component: 'runtime-core',
            timestamp: nowIso(),
            details: {},
          });
        }
      } catch (err) {
        this.recordSecurityAuditEvent({
          code: 'auth_token_rotation_failed',
          severity: 'warn',
          message: `Auth token rotation failed: ${err instanceof Error ? err.message : String(err)}`,
          component: 'runtime-core',
          timestamp: nowIso(),
          details: {},
        });
      }
    };
    check(); // Run immediately on startup
    this.tokenRotationTimer = setInterval(check, checkIntervalMs);
  }

  // --- Internal: memory maintenance ---

  private startDocIndexing(): void {
    if (!this.config.memory.docIndexEnabled) return;

    // If cap-files is registered, skip legacy doc indexing — cap-files handles it
    if (this.capabilityRegistry.getCapability('files')) {
      this.log.debug('doc indexing delegated to cap-files capability');
      return;
    }

    this.log.debug('doc indexing started (legacy)', { workspaces: this.config.workspaces.length });

    const runIndex = () => {
      if (this.closed) return;
      for (const ws of this.config.workspaces) {
        if (!ws.rootPath) continue;
        this.memoryLifecycle.indexWorkspaceDocs(ws.id, ws.rootPath);
      }
    };

    runIndex(); // Run immediately on startup
    const intervalMs = this.config.memory.docIndexIntervalHours * 3600_000;
    this.docIndexTimer = setInterval(runIndex, intervalMs);
  }

  private startMemoryMaintenance(): void {
    this.log.debug('memory maintenance started');
    // Check hourly for maintenance tasks
    this.memoryMaintenanceTimer = setInterval(() => {
      if (this.closed) return;
      const now = new Date();
      const hour = now.getUTCHours();

      // Run daily maintenance at configured hour
      if (hour === this.config.memory.dailySummaryHour) {
        const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
        for (const ws of this.config.workspaces) {
          this.memoryLifecycle.generateDailySummary(yesterday, ws.id);
        }
      }

      // Structured layer governance runs every hour (responsive TTL/staleness)
      this.memoryLifecycle.runStructuredGovernance();
      try {
        this.runPlaybookAutoDraftSweep();
      } catch (error) {
        this.log.warn('playbook auto-draft sweep failed', {
          err: error instanceof Error ? error.message : String(error),
        });
      }
    }, 3600_000); // 1 hour
  }

  // --- Capability registry ---

  registerCapability(cap: CapabilityModule): void {
    this.capabilityRegistry.register(cap);
  }

  listCapabilities(): CapabilityDescriptor[] {
    return this.capabilityRegistry.listCapabilities();
  }

  getCapabilityHealth(): Record<string, { healthy: boolean; details?: Record<string, unknown> }> {
    return this.capabilityRegistry.healthCheck();
  }

  getCapabilityRegistry(): CapabilityRegistry {
    return this.capabilityRegistry;
  }

  async initializeCapabilities(): Promise<void> {
    if (!this.capabilityInitPromise) {
      this.capabilityInitPromise = this.capabilityRegistry.initializeAll();
    }
    await this.capabilityInitPromise;
  }

  // --- File roots facade ---

  private getFilesRootService(): FileRootService | null {
    const cap = this.capabilityRegistry.getCapability('files');
    if (!cap) return null;
    // Access the internal service via a fresh context — actually, the capability
    // stores its own state. Use the DB directly.
    return new FileRootService(this.databases.app);
  }

  private getFilesIndexer(): FileIndexer | null {
    const cap = this.capabilityRegistry.getCapability('files');
    if (!cap) return null;
    const ctx = this.capabilityRegistry['deps'].buildContext();
    return new FileIndexer(this.databases.app, ctx);
  }

  private getFilesSearchService(): FileSearchService | null {
    const cap = this.capabilityRegistry.getCapability('files');
    if (!cap) return null;
    return new FileSearchService(this.databases.app);
  }

  private denyFileRootRegistration(reasonCode: string, message: string, details: Record<string, string>): never {
    this.log.warn('file root registration denied', { reasonCode, ...details });
    this.recordSecurityAudit({
      code: 'file_root_registration_denied',
      severity: 'warn',
      message,
      component: 'runtime-core',
      timestamp: nowIso(),
      details: {
        reasonCode,
        ...details,
      },
    });
    throw new RuntimeValidationError(message);
  }

  private denyFileRootOperation(reasonCode: string, message: string, details: Record<string, string>): never {
    this.log.warn('file root policy denied', { reasonCode, ...details });
    this.recordSecurityAudit({
      code: 'file_root_policy_denied',
      severity: 'warn',
      message,
      component: 'runtime-core',
      timestamp: nowIso(),
      details: {
        reasonCode,
        ...details,
      },
    });
    throw new RuntimeValidationError(message);
  }

  private validateFileRootRegistration(input: FileRootRegistrationInput): void {
    if (!this.getWorkspace(input.workspaceId)) {
      this.denyFileRootRegistration('workspace_not_found', `Workspace ${input.workspaceId} not found`, {
        workspaceId: input.workspaceId,
        rootPath: input.rootPath,
      });
    }

    const canonicalRootPath = canonicalizeLocalPath(input.rootPath);

    const protectedRuntimeRoots = [
      this.config.runtimeDataDir,
      this.databases.paths.stateDir,
      this.databases.paths.logsDir,
      this.databases.paths.receiptsDir,
      this.databases.paths.backupsDir,
      this.databases.paths.capabilityStoresDir,
      resolve(this.databases.paths.memoryDailyDir, '..'),
    ];

    for (const protectedRoot of protectedRuntimeRoots) {
      const resolvedProtectedRoot = canonicalizeLocalPath(protectedRoot);
      if (isPathWithinRoot(resolvedProtectedRoot, canonicalRootPath)) {
        this.denyFileRootRegistration(
          'runtime_directory_forbidden',
          'File roots cannot point at Popeye runtime data directories',
          {
            workspaceId: input.workspaceId,
            rootPath: canonicalRootPath,
            protectedRoot: resolvedProtectedRoot,
          },
        );
      }
    }

    const existingRoot = this.listFileRoots(input.workspaceId).find((root) => {
      return root.enabled && canonicalizeLocalPath(root.rootPath) === canonicalRootPath;
    });
    if (existingRoot) {
      this.denyFileRootRegistration(
        'duplicate_root',
        `File root ${canonicalRootPath} is already registered for workspace ${input.workspaceId}`,
        {
          workspaceId: input.workspaceId,
          rootPath: canonicalRootPath,
          existingRootId: existingRoot.id,
        },
      );
    }
  }

  private requireFileRootForOperation(input: {
    rootId: string;
    purpose: string;
    workspaceId?: string | undefined;
  }): FileRootRecord {
    const root = this.getFileRoot(input.rootId);
    if (!root) {
      return this.denyFileRootOperation('root_not_found', `File root ${input.rootId} not found`, {
        rootId: input.rootId,
        purpose: input.purpose,
        ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
      });
    }
    if (!root.enabled) {
      return this.denyFileRootOperation('root_disabled', `File root ${input.rootId} is disabled`, {
        rootId: input.rootId,
        purpose: input.purpose,
        workspaceId: root.workspaceId,
      });
    }
    if (input.workspaceId !== undefined && root.workspaceId !== input.workspaceId) {
      return this.denyFileRootOperation(
        'workspace_mismatch',
        `File root ${input.rootId} does not belong to workspace ${input.workspaceId}`,
        {
          rootId: input.rootId,
          purpose: input.purpose,
          workspaceId: input.workspaceId,
          rootWorkspaceId: root.workspaceId,
        },
      );
    }
    return root;
  }

  registerFileRoot(input: FileRootRegistrationInput): FileRootRecord {
    const svc = this.getFilesRootService();
    if (!svc) throw new Error('Files capability not available');
    this.validateFileRootRegistration(input);
    return svc.registerRoot(input);
  }

  listFileRoots(workspaceId?: string): FileRootRecord[] {
    const svc = this.getFilesRootService();
    if (!svc) return [];
    return svc.listRoots(workspaceId);
  }

  getFileRoot(id: string): FileRootRecord | null {
    const svc = this.getFilesRootService();
    if (!svc) return null;
    return svc.getRoot(id);
  }

  updateFileRoot(id: string, input: FileRootUpdateInput): FileRootRecord | null {
    const svc = this.getFilesRootService();
    if (!svc) return null;
    return svc.updateRoot(id, input);
  }

  disableFileRoot(id: string): boolean {
    const svc = this.getFilesRootService();
    if (!svc) return false;
    return svc.removeRoot(id);
  }

  searchFiles(query: FileSearchQuery): FileSearchResponse {
    const svc = this.getFilesSearchService();
    if (!svc) return { query: query.query, results: [], totalCandidates: 0 };
    if (query.rootId) {
      this.requireFileRootForOperation({
        rootId: query.rootId,
        purpose: 'file_search',
        ...(query.workspaceId !== undefined ? { workspaceId: query.workspaceId } : {}),
      });
    }
    return svc.search(query);
  }

  reindexFileRoot(rootId: string): FileIndexResult | null {
    const indexer = this.getFilesIndexer();
    const rootService = this.getFilesRootService();
    if (!indexer || !rootService) return null;
    this.requireFileRootForOperation({ rootId, purpose: 'file_reindex' });
    return indexer.reindexRoot(rootId, rootService);
  }

  getFileDocument(id: string): FileDocumentRecord | null {
    const svc = this.getFilesRootService();
    if (!svc) return null;
    const document = svc.getDocument(id);
    if (!document) return null;
    try {
      this.requireFileRootForOperation({
        rootId: document.fileRootId,
        purpose: 'file_document_read',
      });
      return document;
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return null;
      }
      throw error;
    }
  }

  // --- File write-intent facade ---

  private fileWriteIntents: Map<string, FileWriteIntentRecord> = new Map();

  createFileWriteIntent(input: FileWriteIntentCreateInput): FileWriteIntentRecord {
    const root = this.getFileRootRecord(input.fileRootId);
    if (!root) throw new RuntimeNotFoundError(`File root ${input.fileRootId} not found`);

    const writePosture = (root as Record<string, unknown>)['writePosture'] as string ?? 'read_only';
    if (writePosture === 'read_only') {
      throw new RuntimeValidationError(`File root ${input.fileRootId} is read-only`);
    }

    const id = randomUUID();
    const now = nowIso();
    const intent: FileWriteIntentRecord = {
      id,
      fileRootId: input.fileRootId,
      filePath: input.filePath,
      intentType: input.intentType,
      diffPreview: input.diffPreview ?? '',
      status: writePosture === 'agent_owned' ? 'applied' : 'pending',
      runId: input.runId ?? null,
      approvalId: null,
      receiptId: null,
      createdAt: now,
      reviewedAt: writePosture === 'agent_owned' ? now : null,
    };
    this.fileWriteIntents.set(id, intent);
    return intent;
  }

  listFileWriteIntents(rootId?: string, status?: string): FileWriteIntentRecord[] {
    const all = Array.from(this.fileWriteIntents.values());
    return all.filter((intent) => {
      if (rootId && intent.fileRootId !== rootId) return false;
      if (status && intent.status !== status) return false;
      return true;
    });
  }

  getFileWriteIntent(id: string): FileWriteIntentRecord | null {
    return this.fileWriteIntents.get(id) ?? null;
  }

  reviewFileWriteIntent(id: string, input: FileWriteIntentReviewInput): FileWriteIntentRecord | null {
    const intent = this.fileWriteIntents.get(id);
    if (!intent) return null;
    if (intent.status !== 'pending') {
      throw new RuntimeValidationError(`Write intent ${id} is already ${intent.status}`);
    }
    const now = nowIso();
    const updated: FileWriteIntentRecord = {
      ...intent,
      status: input.action === 'apply' ? 'applied' : 'rejected',
      reviewedAt: now,
    };
    this.fileWriteIntents.set(id, updated);
    return updated;
  }

  private getFileRootRecord(id: string): FileRootRecord | null {
    const svc = this.getFilesRootService();
    if (!svc) return null;
    return svc.getRoot(id);
  }

  // --- Email facade ---

  listEmailAccounts(): EmailAccountRecord[] {
    return this.emailOps.listEmailAccounts();
  }

  listEmailThreads(accountId: string, options?: { limit?: number | undefined; unreadOnly?: boolean | undefined }): EmailThreadRecord[] {
    return this.emailOps.listEmailThreads(accountId, options);
  }

  getEmailThread(id: string): EmailThreadRecord | null {
    return this.emailOps.getEmailThread(id);
  }

  searchEmail(query: EmailSearchQuery): { query: string; results: EmailSearchResult[] } {
    return this.emailOps.searchEmail(query);
  }

  getEmailDigest(accountId: string): EmailDigestRecord | null {
    return this.emailOps.getEmailDigest(accountId);
  }

  getEmailMessage(id: string): EmailMessageRecord | null {
    return this.emailOps.getEmailMessage(id);
  }

  // --- GitHub facade (delegated to GithubFacade) ---

  listGithubAccounts(): GithubAccountRecord[] {
    return this.githubOps.listGithubAccounts();
  }

  listGithubRepos(accountId: string, options?: { limit?: number | undefined }): GithubRepoRecord[] {
    return this.githubOps.listGithubRepos(accountId, options);
  }

  listGithubPullRequests(accountId: string, options?: { state?: string | undefined; limit?: number | undefined; repoId?: string | undefined }): GithubPullRequestRecord[] {
    return this.githubOps.listGithubPullRequests(accountId, options);
  }

  listGithubIssues(accountId: string, options?: { state?: string | undefined; limit?: number | undefined; assignedOnly?: boolean | undefined }): GithubIssueRecord[] {
    return this.githubOps.listGithubIssues(accountId, options);
  }

  listGithubNotifications(accountId: string, options?: { unreadOnly?: boolean | undefined; limit?: number | undefined }): GithubNotificationRecord[] {
    return this.githubOps.listGithubNotifications(accountId, options);
  }

  getGithubPullRequest(id: string): GithubPullRequestRecord | null {
    return this.githubOps.getGithubPullRequest(id);
  }

  getGithubIssue(id: string): GithubIssueRecord | null {
    return this.githubOps.getGithubIssue(id);
  }

  searchGithub(query: GithubSearchQuery): { query: string; results: GithubSearchResult[] } {
    return this.githubOps.searchGithub(query);
  }

  getGithubDigest(accountId: string): GithubDigestRecord | null {
    return this.githubOps.getGithubDigest(accountId);
  }

  async syncGithubAccount(accountId: string): Promise<GithubSyncResult> {
    return this.githubOps.syncGithubAccount(accountId);
  }

  triggerGithubDigest(accountId?: string): GithubDigestRecord | null {
    return this.githubOps.triggerGithubDigest(accountId);
  }

  async createGithubComment(input: GithubCommentCreateInput): Promise<GithubCommentRecord> {
    return this.githubOps.createGithubComment(input);
  }

  async markGithubNotificationRead(input: GithubNotificationMarkReadInput): Promise<GithubNotificationRecord> {
    return this.githubOps.markGithubNotificationRead(input);
  }

  // --- Email mutation methods ---

  registerEmailAccount(input: EmailAccountRegistrationInput): EmailAccountRecord {
    return this.emailOps.registerEmailAccount(input);
  }

  async syncEmailAccount(accountId: string): Promise<EmailSyncResult> {
    return this.emailOps.syncEmailAccount(accountId);
  }

  triggerEmailDigest(accountId?: string): EmailDigestRecord | null {
    return this.emailOps.triggerEmailDigest(accountId);
  }

  async createEmailDraft(input: EmailDraftCreateInput): Promise<EmailDraftRecord> {
    return this.emailOps.createEmailDraft(input);
  }

  async updateEmailDraft(id: string, input: EmailDraftUpdateInput): Promise<EmailDraftRecord> {
    return this.emailOps.updateEmailDraft(id, input);
  }

  // --- Calendar facade (delegated to CalendarFacade) ---

  listCalendarAccounts(): CalendarAccountRecord[] {
    return this.calendarOps.listCalendarAccounts();
  }

  listCalendarEvents(accountId: string, options?: { limit?: number | undefined; dateFrom?: string | undefined; dateTo?: string | undefined }): CalendarEventRecord[] {
    return this.calendarOps.listCalendarEvents(accountId, options);
  }

  getCalendarEvent(id: string): CalendarEventRecord | null {
    return this.calendarOps.getCalendarEvent(id);
  }

  searchCalendar(query: CalendarSearchQuery): { query: string; results: CalendarSearchResult[] } {
    return this.calendarOps.searchCalendar(query);
  }

  getCalendarDigest(accountId: string): CalendarDigestRecord | null {
    return this.calendarOps.getCalendarDigest(accountId);
  }

  getCalendarAvailability(accountId: string, date: string, startHour = 9, endHour = 17, slotMinutes = 30): CalendarAvailabilitySlot[] {
    return this.calendarOps.getCalendarAvailability(accountId, date, startHour, endHour, slotMinutes);
  }

  registerCalendarAccount(input: CalendarAccountRegistrationInput): CalendarAccountRecord {
    return this.calendarOps.registerCalendarAccount(input);
  }

  async syncCalendarAccount(accountId: string): Promise<CalendarSyncResult> {
    return this.calendarOps.syncCalendarAccount(accountId);
  }

  triggerCalendarDigest(accountId?: string): CalendarDigestRecord | null {
    return this.calendarOps.triggerCalendarDigest(accountId);
  }

  async createCalendarEvent(input: CalendarEventCreateInput): Promise<CalendarEventRecord> {
    return this.calendarOps.createCalendarEvent(input);
  }

  async updateCalendarEvent(id: string, input: CalendarEventUpdateInput): Promise<CalendarEventRecord> {
    return this.calendarOps.updateCalendarEvent(id, input);
  }

  // --- Todos facade (delegated to TodoFacade) ---

  listTodoAccounts(): TodoAccountRecord[] {
    return this.todoOps.listTodoAccounts();
  }

  listTodos(accountId: string, options?: { status?: string | undefined; priority?: number | undefined; projectName?: string | undefined; limit?: number | undefined }): TodoItemRecord[] {
    return this.todoOps.listTodos(accountId, options);
  }

  getTodo(id: string): TodoItemRecord | null {
    return this.todoOps.getTodo(id);
  }

  searchTodos(query: TodoSearchQuery): { query: string; results: TodoSearchResult[] } {
    return this.todoOps.searchTodos(query);
  }

  getTodoDigest(accountId: string): TodoDigestRecord | null {
    return this.todoOps.getTodoDigest(accountId);
  }

  connectTodoist(input: TodoistConnectInput): TodoistConnectResult {
    return this.todoOps.connectTodoist(input);
  }

  registerTodoAccount(input: TodoAccountRegistrationInput): TodoAccountRecord {
    return this.todoOps.registerTodoAccount(input);
  }

  createTodo(input: TodoCreateInput): TodoItemRecord {
    return this.todoOps.createTodo(input);
  }

  completeTodo(id: string): TodoItemRecord | null {
    return this.todoOps.completeTodo(id);
  }

  reprioritizeTodo(todoId: string, priority: number): TodoItemRecord | null {
    return this.todoOps.reprioritizeTodo(todoId, priority);
  }

  rescheduleTodo(todoId: string, dueDate: string, dueTime?: string | null): TodoItemRecord | null {
    return this.todoOps.rescheduleTodo(todoId, dueDate, dueTime);
  }

  moveTodo(todoId: string, projectName: string): TodoItemRecord | null {
    return this.todoOps.moveTodo(todoId, projectName);
  }

  listTodoProjects(accountId: string): TodoProjectRecord[] {
    return this.todoOps.listTodoProjects(accountId);
  }

  async reconcileTodos(accountId: string): Promise<TodoReconcileResult> {
    return this.todoOps.reconcileTodos(accountId);
  }

  async syncTodoAccount(accountId: string): Promise<TodoSyncResult> {
    return this.todoOps.syncTodoAccount(accountId);
  }

  triggerTodoDigest(accountId?: string): TodoDigestRecord | null {
    return this.todoOps.triggerTodoDigest(accountId);
  }

  // --- People facade (delegated to PeopleFacade) ---

  listPeople(): PersonListItem[] {
    return this.peopleOps.listPeople();
  }

  getPerson(id: string): PersonRecord | null {
    return this.peopleOps.getPerson(id);
  }

  searchPeople(query: PersonSearchQuery): { query: string; results: PersonSearchResult[] } {
    return this.peopleOps.searchPeople(query);
  }

  updatePerson(id: string, input: PersonUpdateInput): PersonRecord | null {
    return this.peopleOps.updatePerson(id, input);
  }

  mergePeople(input: PersonMergeInput): PersonRecord {
    return this.peopleOps.mergePeople(input);
  }

  splitPerson(personId: string, input: PersonSplitInput): PersonRecord {
    return this.peopleOps.splitPerson(personId, input);
  }

  attachPersonIdentity(input: PersonIdentityAttachInput): PersonRecord {
    return this.peopleOps.attachPersonIdentity(input);
  }

  detachPersonIdentity(identityId: string, input: PersonIdentityDetachInput): PersonRecord {
    return this.peopleOps.detachPersonIdentity(identityId, input);
  }

  listPersonMergeEvents(personId?: string): PersonMergeEventRecord[] {
    return this.peopleOps.listPersonMergeEvents(personId);
  }

  getPersonMergeSuggestions(): PersonMergeSuggestion[] {
    return this.peopleOps.getPersonMergeSuggestions();
  }

  getPersonActivityRollups(personId: string): PersonActivityRollup[] {
    return this.peopleOps.getPersonActivityRollups(personId);
  }

  // --- Finance facade ---

  listFinanceImports(): FinanceImportRecord[] {
    return this.financeFacade.getService()?.listImports() ?? [];
  }

  getFinanceImport(id: string): FinanceImportRecord | null {
    return this.financeFacade.getService()?.getImport(id) ?? null;
  }

  listFinanceTransactions(importId?: string, options?: { dateFrom?: string; dateTo?: string; category?: string; limit?: number }): FinanceTransactionRecord[] {
    return this.financeFacade.getService()?.listTransactions(importId, options) ?? [];
  }

  listFinanceDocuments(importId?: string): FinanceDocumentRecord[] {
    return this.financeFacade.getService()?.listDocuments(importId) ?? [];
  }

  searchFinance(query: FinanceSearchQuery): { query: string; results: FinanceSearchResult[] } {
    return this.financeFacade.getSearch()?.search(query) ?? { query: query.query, results: [] };
  }

  getFinanceDigest(period?: string): FinanceDigestRecord | null {
    return this.financeFacade.getService()?.getDigest(period) ?? null;
  }

  createFinanceImport(data: { vaultId: string; importType: FinanceImportRecord['importType']; fileName: string }): FinanceImportRecord {
    const cap = this.capabilityRegistry.getCapability('finance');
    if (!cap) throw new Error('Finance capability not initialized');
    const dbPath = `${this.databases.paths.capabilityStoresDir}/finance.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new FinanceService(writeDb as unknown as CapabilityContext['appDb']);
      const result = svc.createImport(data);
      this.financeFacade.invalidate();
      return result;
    } finally {
      writeDb.close();
    }
  }

  insertFinanceTransaction(data: {
    importId: string;
    date: string;
    description: string;
    amount: number;
    currency?: string;
    category?: string | null;
    merchantName?: string | null;
    accountLabel?: string | null;
    redactedSummary?: string;
  }): FinanceTransactionRecord {
    const cap = this.capabilityRegistry.getCapability('finance');
    if (!cap) throw new Error('Finance capability not initialized');
    const dbPath = `${this.databases.paths.capabilityStoresDir}/finance.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new FinanceService(writeDb as unknown as CapabilityContext['appDb']);
      const result = svc.insertTransaction(data);
      this.financeFacade.invalidate();
      return result;
    } finally {
      writeDb.close();
    }
  }

  insertFinanceTransactionBatch(data: {
    importId: string;
    transactions: Array<{
      date: string;
      description: string;
      amount: number;
      currency?: string;
      category?: string | null;
      merchantName?: string | null;
      accountLabel?: string | null;
      redactedSummary?: string;
    }>;
  }): FinanceTransactionRecord[] {
    const cap = this.capabilityRegistry.getCapability('finance');
    if (!cap) throw new Error('Finance capability not initialized');
    const dbPath = `${this.databases.paths.capabilityStoresDir}/finance.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new FinanceService(writeDb as unknown as CapabilityContext['appDb']);
      const records = data.transactions.map((tx) => ({ ...tx, importId: data.importId }));
      const result = svc.insertTransactionBatch(records);
      this.financeFacade.invalidate();
      return result;
    } finally {
      writeDb.close();
    }
  }

  insertFinanceDocument(data: {
    importId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    redactedSummary?: string;
  }): FinanceDocumentRecord {
    const cap = this.capabilityRegistry.getCapability('finance');
    if (!cap) throw new Error('Finance capability not initialized');
    const dbPath = `${this.databases.paths.capabilityStoresDir}/finance.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new FinanceService(writeDb as unknown as CapabilityContext['appDb']);
      const result = svc.insertDocument(data);
      this.financeFacade.invalidate();
      return result;
    } finally {
      writeDb.close();
    }
  }

  updateFinanceImportStatus(id: string, status: FinanceImportRecord['status'], recordCount?: number): void {
    const cap = this.capabilityRegistry.getCapability('finance');
    if (!cap) throw new Error('Finance capability not initialized');
    const dbPath = `${this.databases.paths.capabilityStoresDir}/finance.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new FinanceService(writeDb as unknown as CapabilityContext['appDb']);
      svc.updateImportStatus(id, status, recordCount);
      this.financeFacade.invalidate();
    } finally {
      writeDb.close();
    }
  }

  // --- Medical facade ---

  listMedicalImports(): MedicalImportRecord[] {
    return this.medicalFacade.getService()?.listImports() ?? [];
  }

  getMedicalImport(id: string): MedicalImportRecord | null {
    return this.medicalFacade.getService()?.getImport(id) ?? null;
  }

  listMedicalAppointments(importId?: string, options?: { limit?: number }): MedicalAppointmentRecord[] {
    return this.medicalFacade.getService()?.listAppointments(importId, options) ?? [];
  }

  listMedicalMedications(importId?: string): MedicalMedicationRecord[] {
    return this.medicalFacade.getService()?.listMedications(importId) ?? [];
  }

  listMedicalDocuments(importId?: string): MedicalDocumentRecord[] {
    return this.medicalFacade.getService()?.listDocuments(importId) ?? [];
  }

  searchMedical(query: string, limit?: number): { query: string; results: MedicalSearchResult[] } {
    return this.medicalFacade.getSearch()?.search(query, limit) ?? { query, results: [] };
  }

  getMedicalDigest(period?: string): MedicalDigestRecord | null {
    return this.medicalFacade.getService()?.getDigest(period) ?? null;
  }

  createMedicalImport(data: { vaultId: string; importType: MedicalImportRecord['importType']; fileName: string }): MedicalImportRecord {
    const cap = this.capabilityRegistry.getCapability('medical');
    if (!cap) throw new Error('Medical capability not initialized');
    const dbPath = `${this.databases.paths.capabilityStoresDir}/medical.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new MedicalService(writeDb as unknown as CapabilityContext['appDb']);
      const result = svc.createImport(data);
      this.medicalFacade.invalidate();
      return result;
    } finally {
      writeDb.close();
    }
  }

  insertMedicalAppointment(data: {
    importId: string;
    date: string;
    provider: string;
    specialty?: string | null;
    location?: string | null;
    redactedSummary?: string;
  }): MedicalAppointmentRecord {
    const cap = this.capabilityRegistry.getCapability('medical');
    if (!cap) throw new Error('Medical capability not initialized');
    const dbPath = `${this.databases.paths.capabilityStoresDir}/medical.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new MedicalService(writeDb as unknown as CapabilityContext['appDb']);
      const result = svc.insertAppointment(data);
      this.medicalFacade.invalidate();
      return result;
    } finally {
      writeDb.close();
    }
  }

  insertMedicalMedication(data: {
    importId: string;
    name: string;
    dosage?: string | null;
    frequency?: string | null;
    prescriber?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    redactedSummary?: string;
  }): MedicalMedicationRecord {
    const cap = this.capabilityRegistry.getCapability('medical');
    if (!cap) throw new Error('Medical capability not initialized');
    const dbPath = `${this.databases.paths.capabilityStoresDir}/medical.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new MedicalService(writeDb as unknown as CapabilityContext['appDb']);
      const result = svc.insertMedication(data);
      this.medicalFacade.invalidate();
      return result;
    } finally {
      writeDb.close();
    }
  }

  insertMedicalDocument(data: {
    importId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    redactedSummary?: string;
  }): MedicalDocumentRecord {
    const cap = this.capabilityRegistry.getCapability('medical');
    if (!cap) throw new Error('Medical capability not initialized');
    const dbPath = `${this.databases.paths.capabilityStoresDir}/medical.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new MedicalService(writeDb as unknown as CapabilityContext['appDb']);
      const result = svc.insertDocument(data);
      this.medicalFacade.invalidate();
      return result;
    } finally {
      writeDb.close();
    }
  }

  updateMedicalImportStatus(id: string, status: MedicalImportRecord['status']): void {
    const cap = this.capabilityRegistry.getCapability('medical');
    if (!cap) throw new Error('Medical capability not initialized');
    const dbPath = `${this.databases.paths.capabilityStoresDir}/medical.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new MedicalService(writeDb as unknown as CapabilityContext['appDb']);
      svc.updateImportStatus(id, status);
      this.medicalFacade.invalidate();
    } finally {
      writeDb.close();
    }
  }

  private buildCapabilityContext(): CapabilityContext {
    return {
      appDb: this.databases.app as unknown as CapabilityContext['appDb'],
      memoryDb: this.databases.memory as unknown as CapabilityContext['memoryDb'],
      paths: this.databases.paths,
      config: this.config as unknown as Record<string, unknown>,
      log: this.log,
      auditCallback: (event) => {
        this.recordSecurityAuditEvent({
          code: event.eventType,
          severity: event.severity === 'error' ? 'error' : event.severity === 'warning' ? 'warn' : 'info',
          message: event.eventType,
          component: 'cap-email',
          timestamp: nowIso(),
          details: Object.fromEntries(
            Object.entries(event.details).map(([k, v]) => [k, String(v)]),
          ),
        });
      },
      memoryInsert: (input) => {
        const insertInput = {
          description: input.description,
          classification: input.classification,
          sourceType: input.sourceType as MemoryInsertInput['sourceType'],
          content: input.content,
          confidence: input.confidence,
          scope: input.scope,
          ...(input.memoryType ? { memoryType: input.memoryType as MemoryInsertInput['memoryType'] } : {}),
          ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
          ...(input.sourceRefType ? { sourceRefType: input.sourceRefType } : {}),
          ...(input.domain ? { domain: input.domain as MemoryInsertInput['domain'] } : {}),
          ...(input.contextReleasePolicy ? { contextReleasePolicy: input.contextReleasePolicy as MemoryInsertInput['contextReleasePolicy'] } : {}),
          ...(input.dedupKey ? { dedupKey: input.dedupKey } : {}),
        } satisfies MemoryInsertInput;
        const result = this.memoryLifecycle.insertMemory(insertInput);
        return {
          memoryId: result.memoryId,
          embedded: result.embedded,
          ...(result.rejected !== undefined ? { rejected: result.rejected } : {}),
          ...(result.rejectionReason !== undefined ? { rejectionReason: result.rejectionReason } : {}),
        };
      },
      approvalRequest: (input) => this.requestApproval(input as Parameters<typeof this.requestApproval>[0]),
      actionApprovalRequest: (input) => this.requestActionApproval(input as ActionApprovalRequestInput),
      contextReleaseRecord: (input) => this.contextReleaseService.recordRelease(input),
      getExecutionEnvelope: (runId) => this.getExecutionEnvelope(runId),
      authorizeContextRelease: (input) => this.authorizeContextRelease(input),
      events: this.events,
      resolveEmailAdapter: (connectionId) => this.resolveEmailAdapterForConnection(connectionId),
      resolveCalendarAdapter: (connectionId) => this.resolveCalendarAdapterForConnection(connectionId),
      resolveGithubAdapter: (connectionId) => this.resolveGithubAdapterForConnection(connectionId),
    };
  }
}

export function createRuntimeService(config: AppConfig, engineOverride?: EngineAdapter, loggerOverride?: PopeyeLogger): PopeyeRuntimeService {
  return new PopeyeRuntimeService(config, engineOverride, loggerOverride);
}
