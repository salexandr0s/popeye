import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
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
  NormalizedEngineEvent,
  ProjectRecord,
  ProjectRegistrationInput,
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
  VaultRecord,
  WorkspaceRecord,
  WorkspaceRegistrationInput,
  OAuthConnectStartRequest,
  OAuthSessionRecord,
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
  MemoryRecordSchema,
  RunEventRecordSchema,
  RunReplySchema,
  TaskCreateInputSchema,
} from '@popeye/contracts';
import {
  createEngineAdapter,
  type EngineAdapter,
  type EngineRunCompletion,
  type EngineRunHandle,
  type EngineRunRequest,
  type RuntimeToolDescriptor,
} from '@popeye/engine-pi';
import {
  buildLocationCondition,
  formatMemoryScope,
  MemorySearchService,
  resolveMemoryLocationFilter,
  createDisabledEmbeddingClient,
  createOpenAIEmbeddingClient,
  createOpenAISummarizationClient,
  createDisabledSummarizationClient,
  loadSqliteVec,
} from '@popeye/memory';
import { createLogger, redactText, type PopeyeLogger } from '@popeye/observability';
import { calculateRetryDelaySeconds, TaskManager } from '@popeye/scheduler';
import { selectSessionRoot, SessionService } from '@popeye/sessions';

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
import { TelegramDeliveryService } from './telegram-delivery.js';
import { CapabilityFacade } from './capability-facade.js';
import { CapabilityRegistry } from './capability-registry.js';
import { ConnectionService, type ConnectionServiceDeps } from './connection-service.js';
import { OAuthConnectService } from './oauth-connect.js';
import { buildCoreRuntimeTools } from './runtime-tools.js';
import { createFilesCapability, FileRootService, FileIndexer, FileSearchService } from '@popeye/cap-files';
import { createEmailCapability, EmailService, EmailSearchService, EmailSyncService, EmailDigestService, type EmailProviderAdapter } from '@popeye/cap-email';
import type { GithubApiAdapter } from '@popeye/cap-github';
import { createGithubCapability, GithubService, GithubSearchService, GithubSyncService, GithubDigestService } from '@popeye/cap-github';
import type { GoogleCalendarAdapter } from '@popeye/cap-calendar';
import { createCalendarCapability, CalendarService, CalendarSearchService, CalendarSyncService, CalendarDigestService } from '@popeye/cap-calendar';
import { createTodosCapability, TodoService, TodoSearchService, TodoSyncService, TodoDigestService, LocalTodoAdapter, TodoistAdapter } from '@popeye/cap-todos';
import { createPeopleCapability, PeopleService, type PersonProjectionSeed } from '@popeye/cap-people';
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
  buildExecutionEnvelope,
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
  connectionCursorKindForProvider,
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
  MemoryListRowSchema,
  normalizeEmail,
  parseCountRow,
  parseCreatedAt,
  parseRunEventPayload,
  ProjectPathRowSchema,
  RunEventRowSchema,
  RunRowSchema,
  ScheduleRowSchema,
  selectSessionKind,
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

interface ActiveRunContext {
  runId: string;
  jobId: string;
  task: TaskRecord;
  workspaceLockId: string;
  handle: EngineRunHandle;
  finalizing: boolean;
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
  private vecAvailable = false;
  private readonly vecInitPromise: Promise<void>;

  private readonly log: PopeyeLogger;
  private readonly activeRuns = new Map<string, ActiveRunContext>();
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
  private readonly telegramDelivery: TelegramDeliveryService;
  private readonly capabilityRegistry: CapabilityRegistry;
  private readonly connectionService: ConnectionService;
  private readonly oauthConnect: OAuthConnectService;
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
          throw new Error(`Invalid regex in security.${field.name}: pattern "${pattern}" — ${msg}`);
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
      vecAvailable: () => this.vecAvailable,
      halfLifeDays: config.memory.confidenceHalfLifeDays,
      budgetConfig: config.memory.budgetAllocation,
      redactionPatterns: config.security.redactionPatterns,
      logger: this.log,
    });
    const summarizationClient = config.embeddings.provider === 'openai'
      ? createOpenAISummarizationClient({})
      : createDisabledSummarizationClient();
    this.memoryLifecycle = new MemoryLifecycleService(this.databases, config, this.memorySearch, summarizationClient);

    // Try loading sqlite-vec (non-blocking)
    this.vecInitPromise = loadSqliteVec(this.databases.memory, config.embeddings.dimensions, this.log).then((loaded) => {
      this.vecAvailable = loaded;
    });

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
    this.receiptBuilder = new ReceiptBuilder({
      db: this.databases.app,
      listRunEvents: (runId) => this.listRunEvents(runId),
      getRun: (runId) => this.getRun(runId),
      getTask: (taskId) => this.getTask(taskId),
      getExecutionEnvelope: (runId) => this.getExecutionEnvelope(runId),
      summarizeRunReleases: (runId) => this.summarizeRunReleases(runId),
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
      get activeRunsCount() { return self.activeRuns.size; },
      get startedAt() { return self.startedAt; },
      get lastSchedulerTickAt() { return self.scheduler.lastSchedulerTickAt; },
      get lastLeaseSweepAt() { return self.scheduler.lastLeaseSweepAt; },
      getEngineCapabilities: () => this.engine.getCapabilities(),
      computeNextHeartbeatDueAt: () => this.computeNextHeartbeatDueAt(),
    }, this.workspaceRegistry);

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
      timeline,
    };

    if (!runtimeSummary.projectId && !runtimeSummary.profileId && !runtimeSummary.execution && !runtimeSummary.contextReleases && runtimeSummary.timeline.length === 0) {
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
    return {
      projectId: receipt.runtime.projectId ?? derived.projectId ?? null,
      profileId: receipt.runtime.profileId ?? derived.profileId ?? null,
      execution: receipt.runtime.execution ?? derived.execution ?? null,
      contextReleases: receipt.runtime.contextReleases ?? derived.contextReleases ?? null,
      timeline: mergedTimeline,
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
    const activeRun = this.activeRuns.get(runId);
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
    this.log.info('scheduler stopping', { activeRuns: this.activeRuns.size });
    if (this.scheduler.tickTimer) clearInterval(this.scheduler.tickTimer);
    if (this.scheduler.leaseTimer) clearInterval(this.scheduler.leaseTimer);
    this.scheduler.tickTimer = null;
    this.scheduler.leaseTimer = null;
    this.scheduler.running = false;

    if (this.activeRuns.size === 0) return;

    for (const activeRun of this.activeRuns.values()) {
      await activeRun.handle.cancel();
    }

    const waiters = Array.from(this.activeRuns.values()).map((activeRun) =>
      Promise.race([
        activeRun.handle.wait(),
        new Promise<EngineRunCompletion>((resolve) => {
          setTimeout(() => resolve({ engineSessionRef: null, usage: { provider: this.config.engine.kind, model: 'unknown', tokensIn: 0, tokensOut: 0, estimatedCostUsd: 0 }, failureClassification: 'cancelled' }), this.scheduler.shutdownGraceMs);
        }),
      ]).then(async () => {
        if (activeRun.finalizing) return;
        await this.abandonRun(activeRun.runId, 'Scheduler shutdown interrupted an in-flight run');
      }),
    );
    await Promise.all(waiters);
  }

  // --- Memory public API ---

  async searchMemory(query: MemorySearchQuery): Promise<MemorySearchResponse> {
    return this.memorySearch.search({
      query: query.query,
      ...(query.scope !== undefined && { scope: query.scope }),
      ...(query.workspaceId !== undefined && { workspaceId: query.workspaceId }),
      ...(query.projectId !== undefined && { projectId: query.projectId }),
      ...(query.includeGlobal !== undefined && { includeGlobal: query.includeGlobal }),
      ...(query.memoryTypes !== undefined && { memoryTypes: query.memoryTypes }),
      ...(query.layers !== undefined && { layers: query.layers }),
      ...(query.namespaceIds !== undefined && { namespaceIds: query.namespaceIds }),
      ...(query.tags !== undefined && { tags: query.tags }),
      ...(query.minConfidence !== undefined && { minConfidence: query.minConfidence }),
      ...(query.limit !== undefined && { limit: query.limit }),
      ...(query.includeContent !== undefined && { includeContent: query.includeContent }),
      ...(query.includeSuperseded !== undefined && { includeSuperseded: query.includeSuperseded }),
      ...(query.occurredAfter !== undefined && { occurredAfter: query.occurredAfter }),
      ...(query.occurredBefore !== undefined && { occurredBefore: query.occurredBefore }),
      ...(query.domains !== undefined && { domains: query.domains }),
      ...(query.consumerProfile !== undefined && { consumerProfile: query.consumerProfile }),
    });
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
    return this.memorySearch.explainRecall(input, locationFilter);
  }

  getMemoryContent(memoryId: string, locationFilter?: { workspaceId: string | null; projectId: string | null; includeGlobal?: boolean }): MemoryRecord | null {
    const record = this.memorySearch.getMemoryContent(memoryId, locationFilter);
    return record ? MemoryRecordSchema.parse(record) : null;
  }

  getMemoryAudit(): MemoryAuditResponse {
    return this.memoryLifecycle.getMemoryAudit();
  }

  checkMemoryIntegrity(options?: { fix?: boolean }): IntegrityReport {
    return this.memoryLifecycle.runIntegrityCheck(options);
  }

  insertMemory(input: MemoryInsertInput): MemoryRecord {
    const result = this.memoryLifecycle.insertMemory(input);
    const memory = this.getMemory(result.memoryId);
    if (!memory) {
      throw new Error(`Inserted memory ${result.memoryId} could not be loaded`);
    }
    return memory;
  }

  listMemories(options?: {
    type?: string;
    scope?: string;
    workspaceId?: string | null;
    projectId?: string | null;
    includeGlobal?: boolean;
    limit?: number;
  }): MemoryRecord[] {
    const conditions: string[] = ['archived_at IS NULL'];
    const params: unknown[] = [];
    const locationFilter = resolveMemoryLocationFilter({
      scope: options?.scope,
      workspaceId: options?.workspaceId,
      projectId: options?.projectId,
      includeGlobal: options?.includeGlobal,
    });
    const scopeAliasOnly = options?.scope !== undefined && options?.workspaceId === undefined && options?.projectId === undefined;
    if (options?.type) { conditions.push('memory_type = ?'); params.push(options.type); }
    if (scopeAliasOnly && options?.scope) {
      conditions.push('scope = ?');
      params.push(options.scope);
    } else if (locationFilter) {
      const location = buildLocationCondition('', {
        workspaceId: locationFilter.workspaceId,
        projectId: locationFilter.projectId,
        includeGlobal: locationFilter.includeGlobal,
      });
      if (location.sql) {
        conditions.push(location.sql);
        params.push(...location.params);
      }
    }
    const limit = options?.limit ?? 50;
    params.push(limit);
    const sql = `SELECT id, description, classification, source_type, content, confidence, scope, workspace_id, project_id, memory_type, dedup_key, last_reinforced_at, archived_at, created_at, source_run_id, source_timestamp FROM memories WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ?`;
    return z.array(MemoryListRowSchema)
      .parse(this.databases.memory.prepare(sql).all(...params))
      .map((row) =>
        MemoryRecordSchema.parse({
          id: row.id,
          description: row.description,
          classification: row.classification,
          sourceType: row.source_type,
          content: row.content,
          confidence: row.confidence,
          scope: row.scope,
          workspaceId: row.workspace_id,
          projectId: row.project_id,
          sourceRunId: row.source_run_id,
          sourceTimestamp: row.source_timestamp,
          memoryType: row.memory_type ?? 'episodic',
          dedupKey: row.dedup_key,
          lastReinforcedAt: row.last_reinforced_at,
          archivedAt: row.archived_at,
          createdAt: row.created_at,
        }),
      );
  }

  getMemory(memoryId: string, locationFilter?: { workspaceId: string | null; projectId: string | null; includeGlobal?: boolean }): MemoryRecord | null {
    return this.getMemoryContent(memoryId, locationFilter);
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
    return this.memorySearch.budgetFit(query);
  }

  describeMemory(memoryId: string, locationFilter?: { workspaceId: string | null; projectId: string | null; includeGlobal?: boolean }) {
    return this.memorySearch.describeMemory(memoryId, locationFilter);
  }

  expandMemory(memoryId: string, maxTokens?: number, locationFilter?: { workspaceId: string | null; projectId: string | null; includeGlobal?: boolean }) {
    const cap = maxTokens ?? this.config.memory.expandTokenCap;
    return this.memorySearch.expandMemory(memoryId, cap, locationFilter);
  }

  triggerMemoryMaintenance(): { decayed: number; archived: number; merged: number; deduped: number } {
    const decay = this.memoryLifecycle.runConfidenceDecay();
    const consolidation = this.memoryLifecycle.runConsolidation();
    return { decayed: decay.decayed, archived: decay.archived, merged: consolidation.merged, deduped: consolidation.deduped };
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
    const redactedContent = redactText(input.content, this.config.security.redactionPatterns).text;
    const redactedDesc = redactText(input.description, this.config.security.redactionPatterns).text;
    const scope = input.scope
      ?? (input.workspaceId !== undefined || input.projectId !== undefined
        ? formatMemoryScope({
            workspaceId: input.workspaceId ?? null,
            projectId: input.projectId ?? null,
          })
        : 'workspace');
    return this.memoryLifecycle.insertMemory({
      description: redactedDesc,
      content: redactedContent,
      sourceType: input.sourceType ?? 'curated_memory',
      ...(input.memoryType !== undefined && { memoryType: input.memoryType }),
      scope,
      ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      confidence: input.confidence ?? 0.8,
      classification: input.classification ?? 'embeddable',
      ...(input.domain !== undefined ? { domain: input.domain } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.durable !== undefined ? { durable: input.durable } : {}),
      ...(input.dedupKey !== undefined ? { dedupKey: input.dedupKey } : {}),
      ...(input.sourceRunId !== undefined ? { sourceRunId: input.sourceRunId } : {}),
      ...(input.sourceTimestamp !== undefined ? { sourceTimestamp: input.sourceTimestamp } : {}),
    });
  }

  proposeMemoryPromotion(memoryId: string, targetPath: string) {
    return this.memoryLifecycle.proposePromotion(memoryId, targetPath);
  }

  executeMemoryPromotion(request: { memoryId: string; targetPath: string; diff: string; approved: boolean; promoted: boolean }) {
    return this.memoryLifecycle.executePromotion(request);
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

  private createRuntimeTools(task: TaskRecord, runId: string, envelope: ExecutionEnvelope): RuntimeToolDescriptor[] {
    const capabilityTools = this.capabilityRegistry
      .getRuntimeTools({ workspaceId: task.workspaceId, runId })
      .filter((entry) =>
        envelope.allowedCapabilityIds.includes(entry.capabilityId)
        && envelope.allowedRuntimeTools.includes(entry.tool.name),
      )
      .map((entry) => ({
        ...entry.tool,
        execute: async (params: unknown) => {
          const result = await entry.tool.execute(params);
          return {
            ...result,
            content: result.content.map((c) => ({ ...c, type: c.type as 'text' })),
          };
        },
      }));

    return [
      ...this.createCoreRuntimeTools(task, runId).filter((tool) => envelope.allowedRuntimeTools.includes(tool.name)),
      ...capabilityTools,
    ];
  }

  private createCoreRuntimeTools(_task: TaskRecord, runId: string): RuntimeToolDescriptor[] {
    return buildCoreRuntimeTools({
      getExecutionEnvelope: (id) => this.getExecutionEnvelope(id),
      searchMemory: (query) => this.searchMemory(query),
      describeMemory: (id, scope) => this.describeMemory(id, scope),
      expandMemory: (id, maxTokens, scope) => this.expandMemory(id, maxTokens, scope),
      explainMemoryRecall: (input, scope) => this.explainMemoryRecall(input, scope),
    }, runId);
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
      void this.applyRecoveryDecision(run.jobId, run.id, 'Daemon restarted before the run reached a terminal state');
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
        await this.startJobExecution(job.id);
      }
    } catch (error) {
      if (!this.closed) throw error;
    }
  }

  private async processLeaseSweep(): Promise<void> {
    if (this.closed) return;
    try {
      this.scheduler.lastLeaseSweepAt = nowIso();

      for (const activeRun of Array.from(this.activeRuns.values())) {
        if (activeRun.handle.isAlive && !activeRun.handle.isAlive()) {
          await this.abandonRun(activeRun.runId, 'Worker liveness check failed during lease sweep');
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

  // --- Internal: run execution ---

  private async startJobExecution(jobId: string): Promise<RunRecord | null> {
    const job = this.getJob(jobId);
    if (!job || job.status !== 'queued') return null;
    const task = this.getTask(job.taskId);
    if (!task) return null;
    const workspaceLockId = this.acquireWorkspaceLock(job.workspaceId, `popeyed:${process.pid}`);
    if (!workspaceLockId) return null;

    this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('leased', nowIso(), job.id);
    this.refreshLease(job.id, `popeyed:${process.pid}`);

    const sessionRoot = selectSessionRoot({ kind: selectSessionKind(task.source), scope: job.workspaceId });
    this.sessionService.ensureSessionRoot(sessionRoot);

    const run: RunRecord = {
      id: randomUUID(),
      jobId: job.id,
      taskId: task.id,
      workspaceId: job.workspaceId,
      profileId: task.profileId,
      sessionRootId: sessionRoot.id,
      engineSessionRef: null,
      state: 'starting',
      startedAt: nowIso(),
      finishedAt: null,
      error: null,
    };

    this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ?, last_run_id = ? WHERE id = ?').run('running', nowIso(), run.id, job.id);
    this.databases.app.prepare('INSERT INTO runs (id, job_id, task_id, workspace_id, profile_id, session_root_id, engine_session_ref, state, started_at, finished_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      run.id,
      run.jobId,
      run.taskId,
      run.workspaceId,
      run.profileId,
      run.sessionRootId,
      run.engineSessionRef,
      run.state,
      run.startedAt,
      run.finishedAt,
      run.error,
    );

    const instructionBundle = this.queryService.resolveInstructionsForRun(task);
    const redactedPrompt = redactText(task.prompt, this.config.security.redactionPatterns);
    for (const event of redactedPrompt.events) this.recordSecurityAudit(event);
    const fullPrompt = instructionBundle.compiledText
      ? `${instructionBundle.compiledText}\n\n---\n\n${redactedPrompt.text}`
      : redactedPrompt.text;

    this.messageIngestion.linkAcceptedIngressToRun(task.id, job.id, run.id);
    this.emit('run_started', run);

    const runLog = this.log.child({
      workspaceId: task.workspaceId,
      ...(task.projectId != null && { projectId: task.projectId }),
      taskId: task.id,
      jobId: job.id,
      runId: run.id,
      sessionRootId: sessionRoot.id,
    });

    try {
      const profile = this.getAgentProfile(task.profileId);
      if (!profile) {
        throw new RuntimeValidationError(`Execution profile not found: ${task.profileId}`);
      }
      const workspace = this.getWorkspace(task.workspaceId);
      if (!workspace) {
        throw new RuntimeValidationError(`Workspace not found: ${task.workspaceId}`);
      }
      const project = task.projectId ? this.getProject(task.projectId) : null;
      if (task.projectId && !project) {
        throw new RuntimeValidationError(`Project not found: ${task.projectId}`);
      }
      if (project && project.workspaceId !== task.workspaceId) {
        throw new RuntimeValidationError(`Project ${task.projectId} does not belong to workspace ${task.workspaceId}`);
      }
      const profileContextError = validateProfileTaskContext(profile, task);
      if (profileContextError) {
        throw new RuntimeValidationError(profileContextError);
      }

      const capabilityToolEntries = this.capabilityRegistry.getRuntimeTools({
        workspaceId: task.workspaceId,
        runId: run.id,
      });
      const invalidCapabilityToolEntry = capabilityToolEntries.find((entry) => entry == null || typeof entry !== 'object' || !('tool' in entry) || !entry.tool);
      if (invalidCapabilityToolEntry) {
        runLog.error('invalid capability tool entry', {
          entry: invalidCapabilityToolEntry as unknown as Record<string, unknown>,
        });
      }
      const coreToolNames = this.createCoreRuntimeTools(task, run.id).map((tool) => tool.name);
      const capabilityToolNames = capabilityToolEntries.map((entry) => entry.tool.name);
      const allRuntimeToolNames = Array.from(new Set([...coreToolNames, ...capabilityToolNames])).sort();
      const allCapabilityIds = this.capabilityRegistry.listCapabilities().map((capability) => capability.id).sort();
      const allowedCapabilityIds = profile.allowedCapabilityIds.length > 0 ? profile.allowedCapabilityIds : allCapabilityIds;
      const allowedRuntimeTools = profile.allowedRuntimeTools.length > 0 ? profile.allowedRuntimeTools : allRuntimeToolNames;
      const warnings: string[] = [];
      const envelope = buildExecutionEnvelope({
        runId: run.id,
        task,
        profile,
        engineKind: this.config.engine.kind,
        allowedRuntimeTools,
        allowedCapabilityIds,
        workspaceRootPath: workspace.rootPath,
        projectPath: project?.path ?? null,
        sessionPolicy: 'dedicated',
        warnings,
        scratchRoot: `${this.databases.paths.stateDir}/scratch/${run.id}`,
      });
      mkdirSync(envelope.scratchRoot, { recursive: true });
      this.persistExecutionEnvelope(envelope);

      const engineRequest: EngineRunRequest = {
        prompt: fullPrompt,
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        instructionSnapshotId: instructionBundle.id,
        ...(envelope.cwd ? { cwd: envelope.cwd } : {}),
        sessionPolicy: { type: 'dedicated', rootId: sessionRoot.id },
        trigger: {
          source: task.source,
          timestamp: run.startedAt,
        },
        runtimeTools: this.createRuntimeTools(task, run.id, envelope),
      };
      const handle = await this.engine.startRun(engineRequest, {
        onEvent: (event) => this.persistEngineEvent(run.id, event),
      });
      const activeRun: ActiveRunContext = {
        runId: run.id,
        jobId: job.id,
        task,
        workspaceLockId,
        handle,
        finalizing: false,
      };
      this.activeRuns.set(run.id, activeRun);
      this.refreshLease(job.id, handle.pid ? `worker:${handle.pid}` : `popeyed:${process.pid}`);
      this.databases.app.prepare('UPDATE runs SET state = ? WHERE id = ?').run('running', run.id);
      runLog.info('run started');
      void this.awaitRunCompletion(activeRun);
      return this.getRun(run.id);
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const safeMessage = this.redactError(rawMessage) ?? rawMessage;
      runLog.error('run startup failed', {
        error: safeMessage,
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      });
      this.releaseWorkspaceLock(job.workspaceId);
      this.databases.app.prepare('DELETE FROM job_leases WHERE job_id = ?').run(job.id);
      this.databases.app.prepare('UPDATE runs SET state = ?, finished_at = ?, error = ? WHERE id = ?').run('failed_final', nowIso(), safeMessage, run.id);
      this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('failed_final', nowIso(), job.id);
      const receipt = this.writeRuntimeReceipt({
        runId: run.id,
        jobId: job.id,
        taskId: task.id,
        workspaceId: task.workspaceId,
        status: 'failed',
        summary: 'Run failed during engine startup',
        details: safeMessage,
        usage: { provider: this.config.engine.kind, model: 'unknown', tokensIn: task.prompt.length, tokensOut: 0, estimatedCostUsd: 0 },
      });
      this.emit('run_completed', receipt);
      this.recordSecurityAudit({ code: 'run_failed', severity: 'error', message: safeMessage, component: 'runtime-core', timestamp: nowIso(), details: { runId: run.id } });
      return this.getRun(run.id);
    }
  }

  private persistEngineEvent(runId: string, event: NormalizedEngineEvent): void {
    const record: RunEventRecord = RunEventRecordSchema.parse({
      id: randomUUID(),
      runId,
      type: event.type,
      payload: JSON.stringify(event.payload ?? {}),
      createdAt: nowIso(),
    });
    this.databases.app.prepare('INSERT INTO run_events (id, run_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)').run(record.id, record.runId, record.type, record.payload, record.createdAt);
    this.log.debug('engine event persisted', { runId, eventType: event.type });
    if (event.type === 'session' && event.payload?.sessionRef) {
      this.databases.app.prepare('UPDATE runs SET engine_session_ref = ? WHERE id = ?').run(event.payload.sessionRef, runId);
    }
    if (event.type === 'compaction' && typeof event.payload?.content === 'string') {
      const activeRun = this.activeRuns.get(runId);
      const workspaceId = activeRun?.task.workspaceId ?? 'default';
      void this.memoryLifecycle.processCompactionFlush(runId, event.payload.content, workspaceId);
    }
    this.emit('run_event', record);
  }

  private async awaitRunCompletion(activeRun: ActiveRunContext): Promise<void> {
    try {
      const completion = await activeRun.handle.wait();
      await this.finalizeRun(activeRun, completion);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.finalizeRun(activeRun, {
        engineSessionRef: null,
        usage: { provider: this.config.engine.kind, model: 'unknown', tokensIn: activeRun.task.prompt.length, tokensOut: 0, estimatedCostUsd: 0 },
        failureClassification: classifyFailureFromMessage(message),
      });
    }
  }

  private async finalizeRun(activeRun: ActiveRunContext, completion: EngineRunCompletion): Promise<void> {
    if (activeRun.finalizing) return;
    activeRun.finalizing = true;
    const run = this.getRun(activeRun.runId);
    if (!run) return;

    const runLog = this.log.child({
      workspaceId: run.workspaceId,
      taskId: run.taskId,
      jobId: run.jobId,
      runId: run.id,
      sessionRootId: run.sessionRootId,
    });

    const failure = completion.failureClassification;
    if (failure === null) {
      this.databases.app.prepare('UPDATE runs SET state = ?, engine_session_ref = ?, finished_at = ?, error = ? WHERE id = ?').run('succeeded', completion.engineSessionRef, nowIso(), null, run.id);
      this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('succeeded', nowIso(), run.jobId);
      const receipt = this.writeRuntimeReceipt({
        runId: run.id,
        jobId: run.jobId,
        taskId: run.taskId,
        workspaceId: run.workspaceId,
        status: 'succeeded',
        summary: 'Run completed successfully',
        details: JSON.stringify(this.listRunEvents(run.id)),
        usage: completion.usage,
      });
      runLog.info('run succeeded', {
        provider: completion.usage.provider,
        model: completion.usage.model,
        tokensIn: completion.usage.tokensIn,
        tokensOut: completion.usage.tokensOut,
        estimatedCostUsd: completion.usage.estimatedCostUsd,
      });
      this.emit('run_completed', receipt);
      this.cleanupActiveRun(activeRun);
      return;
    }

    if (failure === 'cancelled') {
      this.databases.app.prepare('UPDATE runs SET state = ?, finished_at = ?, error = ? WHERE id = ?').run('cancelled', nowIso(), this.redactError('cancelled'), run.id);
      this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('cancelled', nowIso(), run.jobId);
      const receipt = this.writeRuntimeReceipt({
        runId: run.id,
        jobId: run.jobId,
        taskId: run.taskId,
        workspaceId: run.workspaceId,
        status: 'cancelled',
        summary: 'Run cancelled',
        details: 'Cancelled by operator or daemon shutdown',
        usage: completion.usage,
      });
      runLog.info('run cancelled');
      this.emit('run_completed', receipt);
      this.cleanupActiveRun(activeRun);
      return;
    }

    if (failure === 'transient_failure') {
      this.databases.app.prepare('UPDATE runs SET state = ?, finished_at = ?, error = ? WHERE id = ?').run('failed_retryable', nowIso(), this.redactError(failure), run.id);
      runLog.warn('run failed (retryable)', { failure });
      await this.scheduleRetry(activeRun.task, run.jobId, completion, failure);
      this.cleanupActiveRun(activeRun);
      return;
    }

    this.databases.app.prepare('UPDATE runs SET state = ?, finished_at = ?, error = ?, engine_session_ref = ? WHERE id = ?').run('failed_final', nowIso(), this.redactError(failure), completion.engineSessionRef, run.id);
    this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('failed_final', nowIso(), run.jobId);
    const receipt = this.writeRuntimeReceipt({
      runId: run.id,
      jobId: run.jobId,
      taskId: run.taskId,
      workspaceId: run.workspaceId,
      status: 'failed',
      summary: 'Run failed',
      details: failure,
      usage: completion.usage,
    });
    runLog.error('run failed (final)', { failure });
    this.emit('run_completed', receipt);
    this.recordSecurityAudit({ code: 'run_failed', severity: 'error', message: failure, component: 'runtime-core', timestamp: nowIso(), details: { runId: run.id } });
    this.createIntervention('failed_final', run.id, `Run ${run.id} failed with ${failure}`);
    this.cleanupActiveRun(activeRun);
  }

  private async scheduleRetry(task: TaskRecord, jobId: string, completion: EngineRunCompletion, reason: string): Promise<void> {
    const job = this.listJobs().find((candidate) => candidate.id === jobId);
    if (!job) return;
    const nextRetryCount = job.retryCount + 1;
    if (task.source === 'heartbeat') {
      this.databases.app.prepare('UPDATE jobs SET status = ?, retry_count = ?, available_at = ?, updated_at = ? WHERE id = ?').run('queued', nextRetryCount, nowIso(), nowIso(), jobId);
    } else if (nextRetryCount < task.retryPolicy.maxAttempts) {
      const delaySeconds = calculateRetryDelaySeconds(nextRetryCount, task.retryPolicy);
      const availableAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
      this.databases.app.prepare('UPDATE jobs SET status = ?, retry_count = ?, available_at = ?, updated_at = ? WHERE id = ?').run('waiting_retry', nextRetryCount, availableAt, nowIso(), jobId);
    } else {
      this.databases.app.prepare('UPDATE jobs SET status = ?, retry_count = ?, updated_at = ? WHERE id = ?').run('failed_final', nextRetryCount, nowIso(), jobId);
      this.createIntervention('retry_budget_exhausted', job.lastRunId, `Retry budget exhausted for job ${jobId}`);
    }

    const receipt = this.writeRuntimeReceipt({
      runId: job.lastRunId ?? 'unknown',
      jobId,
      taskId: task.id,
      workspaceId: task.workspaceId,
      status: 'failed',
      summary: 'Run failed and was scheduled for retry',
      details: reason,
      usage: completion.usage,
    });
    this.emit('run_completed', receipt);
  }

  private cleanupActiveRun(activeRun: ActiveRunContext): void {
    this.activeRuns.delete(activeRun.runId);
    this.databases.app.prepare('DELETE FROM job_leases WHERE job_id = ?').run(activeRun.jobId);
    this.releaseWorkspaceLock(activeRun.task.workspaceId);
  }

  private async abandonRun(runId: string, reason: string): Promise<void> {
    const run = this.getRun(runId);
    if (!run || isTerminalRunState(run.state)) return;
    this.log.warn('run abandoned', { runId, reason });
    this.receiptManager.writeAbandonedReceiptIfMissing(run.id, run.jobId, run.taskId, run.workspaceId, 'Run abandoned', reason);
    this.databases.app.prepare('UPDATE runs SET state = ?, finished_at = ?, error = ? WHERE id = ?').run('abandoned', nowIso(), this.redactError(reason), run.id);
    const receipt = this.getReceiptByRunId(run.id);
    if (receipt) {
      this.emit('run_completed', receipt);
    }
    await this.applyRecoveryDecision(run.jobId, run.id, reason);
    const activeRun = this.activeRuns.get(runId);
    if (activeRun) this.cleanupActiveRun(activeRun);
  }

  private async applyRecoveryDecision(jobId: string, runId: string, reason: string): Promise<void> {
    const job = this.listJobs().find((candidate) => candidate.id === jobId);
    if (!job) return;
    const task = this.getTask(job.taskId);
    if (!task) return;
    this.databases.app.prepare('DELETE FROM job_leases WHERE job_id = ?').run(jobId);
    this.releaseWorkspaceLock(job.workspaceId);
    const lowered = reason.toLowerCase();

    if (task.source === 'heartbeat') {
      this.databases.app.prepare('UPDATE jobs SET status = ?, available_at = ?, updated_at = ? WHERE id = ?').run('queued', nowIso(), nowIso(), jobId);
      return;
    }
    if (lowered.includes('auth') || lowered.includes('credential')) {
      this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('blocked_operator', nowIso(), jobId);
      this.createIntervention('needs_credentials', runId, `Credentials required after abandoned run ${runId}`);
      return;
    }
    if (lowered.includes('policy')) {
      this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('blocked_operator', nowIso(), jobId);
      this.createIntervention('needs_policy_decision', runId, `Policy decision required after abandoned run ${runId}`);
      return;
    }

    const nextRetryCount = job.retryCount + 1;
    if (nextRetryCount < task.retryPolicy.maxAttempts) {
      const delaySeconds = calculateRetryDelaySeconds(nextRetryCount, task.retryPolicy);
      const availableAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
      this.databases.app.prepare('UPDATE jobs SET status = ?, retry_count = ?, available_at = ?, updated_at = ? WHERE id = ?').run('waiting_retry', nextRetryCount, availableAt, nowIso(), jobId);
      return;
    }

    this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('failed_final', nowIso(), jobId);
    this.createIntervention('retry_budget_exhausted', runId, `Retry budget exhausted for abandoned run ${runId}`);
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
        this.memoryLifecycle.runConfidenceDecay();
        this.memoryLifecycle.runConsolidation();
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

  // --- GitHub facade ---

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

  // --- GitHub mutation methods ---

  async syncGithubAccount(accountId: string): Promise<GithubSyncResult> {
    const githubCap = this.capabilityRegistry.getCapability('github');
    if (!githubCap) throw new Error('GitHub capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/github.db`;
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

    const dbPath = `${this.databases.paths.capabilityStoresDir}/github.db`;
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

    const dbPath = `${this.databases.paths.capabilityStoresDir}/github.db`;
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

    const dbPath = `${this.databases.paths.capabilityStoresDir}/github.db`;
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

  // --- Email mutation methods ---

  registerEmailAccount(input: EmailAccountRegistrationInput): EmailAccountRecord {
    this.requireConnectionForOperation({
      connectionId: input.connectionId,
      purpose: 'email_account_register',
      expectedDomain: 'email',
      allowedProviderKinds: ['gmail', 'proton'],
      requireSecret: false,
    });

    // Use the write-capable email service from the capability
    const emailCap = this.capabilityRegistry.getCapability('email');
    if (!emailCap) throw new Error('Email capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/email.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new EmailService(writeDb as unknown as CapabilityContext['appDb']);
      return svc.registerAccount(input);
    } finally {
      writeDb.close();
    }
  }

  async syncEmailAccount(accountId: string): Promise<EmailSyncResult> {
    const emailCap = this.capabilityRegistry.getCapability('email');
    if (!emailCap) throw new Error('Email capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/email.db`;
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

    const dbPath = `${this.databases.paths.capabilityStoresDir}/email.db`;
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
    const emailCap = this.capabilityRegistry.getCapability('email');
    if (!emailCap) throw new Error('Email capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/email.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new EmailService(writeDb as unknown as CapabilityContext['appDb']);
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
      this.emailFacade.invalidate();

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
    } finally {
      writeDb.close();
    }
  }

  async updateEmailDraft(id: string, input: EmailDraftUpdateInput): Promise<EmailDraftRecord> {
    const emailCap = this.capabilityRegistry.getCapability('email');
    if (!emailCap) throw new Error('Email capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/email.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new EmailService(writeDb as unknown as CapabilityContext['appDb']);
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
      this.emailFacade.invalidate();
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
    } finally {
      writeDb.close();
    }
  }

  // --- Calendar facade ---

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

    const dbPath = `${this.databases.paths.capabilityStoresDir}/calendar.db`;
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

    const dbPath = `${this.databases.paths.capabilityStoresDir}/calendar.db`;
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

    const dbPath = `${this.databases.paths.capabilityStoresDir}/calendar.db`;
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

    const dbPath = `${this.databases.paths.capabilityStoresDir}/calendar.db`;
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

    const dbPath = `${this.databases.paths.capabilityStoresDir}/calendar.db`;
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

  // --- Todos facade ---

  listTodoAccounts(): TodoAccountRecord[] {
    return this.todosFacade.getService()?.listAccounts() ?? [];
  }

  listTodos(accountId: string, options?: { status?: string | undefined; priority?: number | undefined; projectName?: string | undefined; limit?: number | undefined }): TodoItemRecord[] {
    const svc = this.todosFacade.getService();
    if (!svc) return [];
    this.requireTodoAccountForOperation(svc, accountId, 'todo_list');
    return svc.listItems(accountId, options);
  }

  getTodo(id: string): TodoItemRecord | null {
    const svc = this.todosFacade.getService();
    if (!svc) return null;
    const todo = svc.getItem(id);
    if (!todo) return null;
    try {
      this.requireTodoAccountForOperation(svc, todo.accountId, 'todo_read');
      return todo;
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return null;
      }
      throw error;
    }
  }

  searchTodos(query: TodoSearchQuery): { query: string; results: TodoSearchResult[] } {
    const svc = this.todosFacade.getService();
    if (query.accountId && svc) {
      this.requireTodoAccountForOperation(svc, query.accountId, 'todo_search');
    }
    return this.todosFacade.getSearch()?.search(query) ?? { query: query.query, results: [] };
  }

  getTodoDigest(accountId: string): TodoDigestRecord | null {
    const svc = this.todosFacade.getService();
    if (!svc) return null;
    this.requireTodoAccountForOperation(svc, accountId, 'todo_digest_read');
    return svc.getLatestDigest(accountId);
  }

  connectTodoist(input: TodoistConnectInput): TodoistConnectResult {
    const existingConnection = this
      .listConnections('todos')
      .find((connection) => connection.providerKind === 'todoist') ?? null;

    let connection = existingConnection;
    if (!connection) {
      connection = this.createConnection({
        domain: 'todos',
        providerKind: 'todoist',
        label: input.label,
        mode: input.mode,
        secretRefId: null,
        syncIntervalSeconds: input.syncIntervalSeconds,
        allowedScopes: [],
        allowedResources: [],
        resourceRules: [],
      });
    } else {
      connection = this.updateConnection(connection.id, {
        label: input.label,
        mode: input.mode,
        syncIntervalSeconds: input.syncIntervalSeconds,
      }) ?? connection;
    }

    const secretRef = connection.secretRefId
      ? (this.secretStore.rotateSecret(connection.secretRefId, input.apiToken) ?? this.secretStore.setSecret({
        provider: 'keychain',
        key: 'todoist-api-token',
        value: input.apiToken,
        connectionId: connection.id,
        description: 'Todoist API token',
      }))
      : this.secretStore.setSecret({
        provider: 'keychain',
        key: 'todoist-api-token',
        value: input.apiToken,
        connectionId: connection.id,
        description: 'Todoist API token',
      });

    connection = this.updateConnection(connection.id, { secretRefId: secretRef.id }) ?? connection;

    const todosCap = this.capabilityRegistry.getCapability('todos');
    if (!todosCap) throw new Error('Todos capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/todos.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new TodoService(writeDb as unknown as CapabilityContext['appDb']);
      const account = svc.getAccountByConnection(connection.id)
        ?? svc.registerAccount({
          connectionId: connection.id,
          providerKind: 'todoist',
          displayName: input.displayName,
        });
      this.updateConnectionRollups({
        connectionId: connection.id,
        health: {
          status: 'healthy',
          authState: 'configured',
          checkedAt: nowIso(),
          lastError: null,
          diagnostics: [],
        },
        sync: {
          status: 'idle',
          cursorKind: 'since',
          cursorPresent: false,
          lagSummary: 'Awaiting first sync',
        },
      });
      this.todosFacade.invalidate();
      return { connectionId: connection.id, account };
    } finally {
      writeDb.close();
    }
  }

  registerTodoAccount(input: TodoAccountRegistrationInput): TodoAccountRecord {
    // Local accounts don't need a connection
    if (input.connectionId) {
      this.requireConnectionForOperation({
        connectionId: input.connectionId,
        purpose: 'todo_account_register',
        expectedDomain: 'todos',
        allowedProviderKinds: ['todoist', 'local'],
        requireSecret: false,
      });
    }

    const todosCap = this.capabilityRegistry.getCapability('todos');
    if (!todosCap) throw new Error('Todos capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/todos.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new TodoService(writeDb as unknown as CapabilityContext['appDb']);
      return svc.registerAccount(input);
    } finally {
      writeDb.close();
    }
  }

  createTodo(input: TodoCreateInput): TodoItemRecord {
    const todosCap = this.capabilityRegistry.getCapability('todos');
    if (!todosCap) throw new Error('Todos capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/todos.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new TodoService(writeDb as unknown as CapabilityContext['appDb']);
      this.requireTodoAccountForOperation(svc, input.accountId, 'todo_create');
      const data: { title: string; description?: string; priority?: number; dueDate?: string; dueTime?: string; labels?: string[]; projectName?: string } = { title: input.title };
      if (input.description !== undefined) data.description = input.description;
      if (input.priority !== undefined) data.priority = input.priority;
      if (input.dueDate !== undefined) data.dueDate = input.dueDate;
      if (input.dueTime !== undefined) data.dueTime = input.dueTime;
      if (input.labels !== undefined) data.labels = input.labels;
      if (input.projectName !== undefined) data.projectName = input.projectName;
      const result = svc.createItem(input.accountId, data);

      this.todosFacade.invalidate();

      return result;
    } finally {
      writeDb.close();
    }
  }

  completeTodo(id: string): TodoItemRecord | null {
    const todosCap = this.capabilityRegistry.getCapability('todos');
    if (!todosCap) throw new Error('Todos capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/todos.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new TodoService(writeDb as unknown as CapabilityContext['appDb']);
      const existing = svc.getItem(id);
      if (!existing) {
        return null;
      }
      this.requireTodoAccountForOperation(svc, existing.accountId, 'todo_complete');
      svc.completeItem(id);
      const result = svc.getItem(id);

      this.todosFacade.invalidate();

      return result;
    } finally {
      writeDb.close();
    }
  }

  reprioritizeTodo(todoId: string, priority: number): TodoItemRecord | null {
    const todosCap = this.capabilityRegistry.getCapability('todos');
    if (!todosCap) throw new Error('Todos capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/todos.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new TodoService(writeDb as unknown as CapabilityContext['appDb']);
      const existing = svc.getItem(todoId);
      if (!existing) return null;
      this.requireTodoAccountForOperation(svc, existing.accountId, 'todo_reprioritize');
      const result = svc.reprioritizeItem(todoId, priority);
      this.todosFacade.invalidate();
      return result;
    } finally { writeDb.close(); }
  }

  rescheduleTodo(todoId: string, dueDate: string, dueTime?: string | null): TodoItemRecord | null {
    const todosCap = this.capabilityRegistry.getCapability('todos');
    if (!todosCap) throw new Error('Todos capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/todos.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new TodoService(writeDb as unknown as CapabilityContext['appDb']);
      const existing = svc.getItem(todoId);
      if (!existing) return null;
      this.requireTodoAccountForOperation(svc, existing.accountId, 'todo_reschedule');
      const result = svc.rescheduleItem(todoId, dueDate, dueTime);
      this.todosFacade.invalidate();
      return result;
    } finally { writeDb.close(); }
  }

  moveTodo(todoId: string, projectName: string): TodoItemRecord | null {
    const todosCap = this.capabilityRegistry.getCapability('todos');
    if (!todosCap) throw new Error('Todos capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/todos.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new TodoService(writeDb as unknown as CapabilityContext['appDb']);
      const existing = svc.getItem(todoId);
      if (!existing) return null;
      this.requireTodoAccountForOperation(svc, existing.accountId, 'todo_move');
      const result = svc.moveItem(todoId, projectName);
      this.todosFacade.invalidate();
      return result;
    } finally { writeDb.close(); }
  }

  listTodoProjects(accountId: string): TodoProjectRecord[] {
    const svc = this.todosFacade.getService();
    if (!svc) return [];
    this.requireTodoAccountForOperation(svc, accountId, 'todo_projects_list');
    return svc.listProjects(accountId);
  }

  async reconcileTodos(accountId: string): Promise<TodoReconcileResult> {
    const todosCap = this.capabilityRegistry.getCapability('todos');
    if (!todosCap) throw new Error('Todos capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/todos.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new TodoService(writeDb as unknown as CapabilityContext['appDb']);
      const { account, connection } = this.requireTodoAccountForOperation(svc, accountId, 'todo_reconcile', { requireSecret: true });

      let adapter;
      if (account.providerKind === 'local') {
        adapter = new LocalTodoAdapter();
      } else if (account.providerKind === 'todoist') {
        if (!connection?.secretRefId) throw new RuntimeValidationError('Todoist account has no usable connection secret');
        const apiToken = this.secretStore.getSecretValue(connection.secretRefId!);
        if (!apiToken) throw new RuntimeValidationError('Failed to retrieve Todoist API token from SecretStore');
        adapter = new TodoistAdapter({ apiToken });
      } else {
        throw new Error(`Unsupported todo provider: ${account.providerKind}`);
      }

      const ctx = this.buildCapabilityContext();
      const syncService = new TodoSyncService(svc, ctx);
      const syncResult = await syncService.syncAccount(account, adapter);

      this.todosFacade.invalidate();

      return {
        accountId,
        added: syncResult.todosSynced,
        updated: syncResult.todosUpdated,
        removed: 0,
        errors: syncResult.errors,
      };
    } finally { writeDb.close(); }
  }

  async syncTodoAccount(accountId: string): Promise<TodoSyncResult> {
    const todosCap = this.capabilityRegistry.getCapability('todos');
    if (!todosCap) throw new Error('Todos capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/todos.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new TodoService(writeDb as unknown as CapabilityContext['appDb']);
      const { account, connection } = this.requireTodoAccountForOperation(svc, accountId, 'todo_sync', {
        requireSecret: true,
      });

      const ctx = this.buildCapabilityContext();
      const syncService = new TodoSyncService(svc, ctx);

      // Resolve adapter based on provider kind
      let adapter;
      if (account.providerKind === 'local') {
        adapter = new LocalTodoAdapter();
      } else if (account.providerKind === 'todoist') {
        if (!connection?.secretRefId) {
          throw new RuntimeValidationError('Todoist account has no usable connection secret');
        }
        const apiToken = this.secretStore.getSecretValue(connection.secretRefId!);
        if (!apiToken) {
          throw new RuntimeValidationError('Failed to retrieve Todoist API token from SecretStore');
        }
        adapter = new TodoistAdapter({ apiToken });
      } else {
        throw new Error(`Unsupported todo provider: ${account.providerKind}`);
      }

      const result = await syncService.syncAccount(account, adapter);

      this.todosFacade.invalidate();

      return result;
    } finally {
      writeDb.close();
    }
  }

  triggerTodoDigest(accountId?: string): TodoDigestRecord | null {
    const todosCap = this.capabilityRegistry.getCapability('todos');
    if (!todosCap) return null;

    const dbPath = `${this.databases.paths.capabilityStoresDir}/todos.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new TodoService(writeDb as unknown as CapabilityContext['appDb']);
      const candidateAccounts = accountId ? [svc.getAccount(accountId)].filter(Boolean) : svc.listAccounts();
      if (candidateAccounts.length === 0) return null;
      const accounts = candidateAccounts.map((account) => {
        if (!account) {
          throw new RuntimeValidationError(`Todo account ${accountId} not found`);
        }
        return this.requireTodoAccountForOperation(svc, account.id, 'todo_digest_generate').account;
      });

      const ctx = this.buildCapabilityContext();
      const digestService = new TodoDigestService(svc, ctx);

      let lastDigest: TodoDigestRecord | null = null;
      for (const account of accounts) {
        if (!account) continue;
        lastDigest = digestService.generateDigest(account);
      }

      this.todosFacade.invalidate();

      return lastDigest;
    } finally {
      writeDb.close();
    }
  }

  // --- People facade ---

  listPeople(): PersonListItem[] {
    return this.peopleFacade.getService()?.listPeople() ?? [];
  }

  getPerson(id: string): PersonRecord | null {
    return this.peopleFacade.getService()?.getPerson(id) ?? null;
  }

  searchPeople(query: PersonSearchQuery): { query: string; results: PersonSearchResult[] } {
    const svc = this.peopleFacade.getService();
    if (!svc) {
      return { query: query.query, results: [] };
    }
    return svc.searchPeople(query.query, query.limit);
  }

  updatePerson(id: string, input: PersonUpdateInput): PersonRecord | null {
    const peopleCap = this.capabilityRegistry.getCapability('people');
    if (!peopleCap) throw new Error('People capability not initialized');
    const dbPath = `${this.databases.paths.capabilityStoresDir}/people.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new PeopleService(writeDb as unknown as CapabilityContext['appDb']);
      const updated = svc.updatePerson(id, input);
      this.peopleFacade.invalidate();
      return updated;
    } finally {
      writeDb.close();
    }
  }

  mergePeople(input: PersonMergeInput): PersonRecord {
    const peopleCap = this.capabilityRegistry.getCapability('people');
    if (!peopleCap) throw new Error('People capability not initialized');
    const dbPath = `${this.databases.paths.capabilityStoresDir}/people.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new PeopleService(writeDb as unknown as CapabilityContext['appDb']);
      const merged = svc.mergePeople(input);
      this.peopleFacade.invalidate();
      this.recordSecurityAudit({
        code: 'people_merged',
        severity: 'info',
        message: 'People graph merge completed',
        component: 'runtime-core',
        timestamp: nowIso(),
        details: {
          sourcePersonId: input.sourcePersonId,
          targetPersonId: input.targetPersonId,
          requestedBy: input.requestedBy,
        },
      });
      return merged;
    } finally {
      writeDb.close();
    }
  }

  splitPerson(personId: string, input: PersonSplitInput): PersonRecord {
    const peopleCap = this.capabilityRegistry.getCapability('people');
    if (!peopleCap) throw new Error('People capability not initialized');
    const dbPath = `${this.databases.paths.capabilityStoresDir}/people.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new PeopleService(writeDb as unknown as CapabilityContext['appDb']);
      const split = svc.splitPerson(personId, input);
      this.peopleFacade.invalidate();
      this.recordSecurityAudit({
        code: 'people_split',
        severity: 'info',
        message: 'People graph split completed',
        component: 'runtime-core',
        timestamp: nowIso(),
        details: {
          sourcePersonId: personId,
          targetPersonId: split.id,
          requestedBy: input.requestedBy,
        },
      });
      return split;
    } finally {
      writeDb.close();
    }
  }

  attachPersonIdentity(input: PersonIdentityAttachInput): PersonRecord {
    const peopleCap = this.capabilityRegistry.getCapability('people');
    if (!peopleCap) throw new Error('People capability not initialized');
    const dbPath = `${this.databases.paths.capabilityStoresDir}/people.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new PeopleService(writeDb as unknown as CapabilityContext['appDb']);
      const updated = svc.attachIdentity(input);
      this.peopleFacade.invalidate();
      return updated;
    } finally {
      writeDb.close();
    }
  }

  detachPersonIdentity(identityId: string, input: PersonIdentityDetachInput): PersonRecord {
    const peopleCap = this.capabilityRegistry.getCapability('people');
    if (!peopleCap) throw new Error('People capability not initialized');
    const dbPath = `${this.databases.paths.capabilityStoresDir}/people.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new PeopleService(writeDb as unknown as CapabilityContext['appDb']);
      const detached = svc.detachIdentity(identityId, input.requestedBy);
      this.peopleFacade.invalidate();
      return detached;
    } finally {
      writeDb.close();
    }
  }

  listPersonMergeEvents(personId?: string): PersonMergeEventRecord[] {
    return this.peopleFacade.getService()?.listMergeEvents(personId) ?? [];
  }

  getPersonMergeSuggestions(): PersonMergeSuggestion[] {
    return this.peopleFacade.getService()?.getMergeSuggestions() ?? [];
  }

  getPersonActivityRollups(personId: string): PersonActivityRollup[] {
    return this.peopleFacade.getService()?.getActivityRollups(personId) ?? [];
  }

  private refreshPeopleProjectionForEmailAccount(service: EmailService, accountId: string): void {
    const account = service.getAccount(accountId);
    if (!account) return;
    const seeds: PersonProjectionSeed[] = [{
      provider: 'email',
      externalId: account.emailAddress,
      displayName: account.displayName,
      email: account.emailAddress,
      activitySummary: 'email',
    }];
    for (const sender of service.getTopSenders(accountId, 50)) {
      const email = normalizeEmail(sender.fromAddress);
      if (!email) continue;
      seeds.push({
        provider: 'email',
        externalId: email,
        displayName: sender.fromAddress,
        email,
        activitySummary: 'email',
      });
    }
    this.projectPeopleSeeds(seeds);
  }

  private refreshPeopleProjectionForCalendarAccount(service: CalendarService, accountId: string): void {
    const account = service.getAccount(accountId);
    if (!account) return;
    const seeds: PersonProjectionSeed[] = [{
      provider: 'calendar',
      externalId: account.calendarEmail,
      displayName: account.displayName,
      email: account.calendarEmail,
      activitySummary: 'calendar',
    }];
    for (const event of service.listEvents(accountId, { limit: 200 })) {
      const organizer = normalizeEmail(event.organizer);
      if (organizer) {
        seeds.push({
          provider: 'calendar',
          externalId: organizer,
          displayName: organizer,
          email: organizer,
          activitySummary: 'calendar',
        });
      }
      for (const attendee of event.attendees) {
        const email = normalizeEmail(attendee);
        if (!email) continue;
        seeds.push({
          provider: 'calendar',
          externalId: email,
          displayName: attendee,
          email,
          activitySummary: 'calendar',
        });
      }
    }
    this.projectPeopleSeeds(seeds);
  }

  private refreshPeopleProjectionForGithubAccount(service: GithubService, accountId: string): void {
    const account = service.getAccount(accountId);
    if (!account) return;
    const seeds: PersonProjectionSeed[] = [{
      provider: 'github',
      externalId: account.githubUsername,
      displayName: account.displayName,
      handle: account.githubUsername,
      activitySummary: 'github',
    }];
    for (const repo of service.listRepos(accountId, { limit: 200 })) {
      seeds.push({
        provider: 'github',
        externalId: repo.owner,
        displayName: repo.owner,
        handle: repo.owner,
        activitySummary: 'github',
      });
    }
    for (const pr of service.listPullRequests(accountId, { limit: 200 })) {
      seeds.push({
        provider: 'github',
        externalId: pr.author,
        displayName: pr.author,
        handle: pr.author,
        activitySummary: 'github',
      });
      for (const reviewer of pr.requestedReviewers) {
        seeds.push({
          provider: 'github',
          externalId: reviewer,
          displayName: reviewer,
          handle: reviewer,
          activitySummary: 'github',
        });
      }
    }
    for (const issue of service.listIssues(accountId, { limit: 200 })) {
      seeds.push({
        provider: 'github',
        externalId: issue.author,
        displayName: issue.author,
        handle: issue.author,
        activitySummary: 'github',
      });
      for (const assignee of issue.assignees) {
        seeds.push({
          provider: 'github',
          externalId: assignee,
          displayName: assignee,
          handle: assignee,
          activitySummary: 'github',
        });
      }
    }
    this.projectPeopleSeeds(seeds);
  }

  private projectPeopleSeeds(seeds: PersonProjectionSeed[]): void {
    const deduped = new Map<string, PersonProjectionSeed>();
    for (const seed of seeds) {
      const key = `${seed.provider}:${seed.externalId}`;
      if (!deduped.has(key)) {
        deduped.set(key, seed);
      }
    }
    if (deduped.size === 0) return;
    const peopleCap = this.capabilityRegistry.getCapability('people');
    if (!peopleCap) return;
    const dbPath = `${this.databases.paths.capabilityStoresDir}/people.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new PeopleService(writeDb as unknown as CapabilityContext['appDb']);
      for (const seed of deduped.values()) {
        svc.projectSeed(seed);
      }
      this.peopleFacade.invalidate();
    } finally {
      writeDb.close();
    }
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
