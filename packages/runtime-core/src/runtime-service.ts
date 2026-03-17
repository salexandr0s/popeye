import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

import type {
  AgentProfileRecord,
  AppConfig,
  ApprovalRecord,
  ApprovalResolveInput,
  CompiledInstructionBundle,
  ConnectionCreateInput,
  ConnectionRecord,
  ConnectionUpdateInput,
  ContextReleaseDecision,
  ContextReleasePreview,
  DaemonStateRecord,
  DaemonStatusResponse,
  DomainKind,
  IntegrityReport,
  InterventionRecord,
  JobLeaseRecord,
  JobRecord,
  MemoryAuditResponse,
  MemoryRecord,
  MemorySearchQuery,
  MemorySearchResponse,
  MessageIngressResponse,
  MessageRecord,
  NormalizedEngineEvent,
  ProjectRecord,
  ProjectRegistrationInput,
  ReceiptRecord,
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
} from '@popeye/contracts';
import {
  buildCanonicalRunReply,
  MemoryRecordSchema,
  RunEventRecordSchema,
  RunRecordSchema,
  RunReplySchema,
  TelegramDeliveryRecordSchema,
  TelegramDeliveryResolutionRecordSchema,
  TelegramDeliveryStateSchema,
  TelegramRelayCheckpointSchema,
  TelegramSendAttemptRecordSchema,
} from '@popeye/contracts';
import {
  createEngineAdapter,
  type EngineAdapter,
  type EngineFailureClassification,
  type EngineRunCompletion,
  type EngineRunHandle,
  type EngineRunRequest,
  type RuntimeToolDescriptor,
} from '@popeye/engine-pi';
import { MemorySearchService, createDisabledEmbeddingClient, createOpenAIEmbeddingClient, createOpenAISummarizationClient, createDisabledSummarizationClient, loadSqliteVec } from '@popeye/memory';
import { createLogger, redactText, type PopeyeLogger } from '@popeye/observability';
import { calculateRetryDelaySeconds, TaskManager } from '@popeye/scheduler';
import { selectSessionRoot, SessionService } from '@popeye/sessions';

import { ReceiptManager } from '@popeye/receipts';

import { WorkspaceRegistry } from '@popeye/workspace';

import { openRuntimeDatabases, type RuntimeDatabases } from './database.js';
import { MemoryLifecycleService, type MemoryInsertInput } from './memory-lifecycle.js';
import { MessageIngestionService, MessageIngressError } from './message-ingestion.js';
import { QueryService } from './query-service.js';
import { SecretStore } from './secret-store.js';
import { ApprovalService } from './approval-service.js';
import { type VaultHandle, VaultManager } from './vault-manager.js';
import { ContextReleaseService } from './context-release-service.js';
import {
  clearBrowserSessions,
  createBrowserSession as createRuntimeBrowserSession,
  type BrowserSessionValidationResult,
  validateBrowserSession as validateRuntimeBrowserSession,
} from './browser-sessions.js';

import { nowIso, DOMAIN_POLICY_DEFAULTS } from '@popeye/contracts';
import { z } from 'zod';
import safe from 'safe-regex2';
import { readAuthStore, rotateAuthStore } from './auth.js';

function isTerminalJobStatus(status: JobRecord['status']): boolean {
  return ['succeeded', 'failed_final', 'cancelled'].includes(status);
}

function isTerminalRunState(state: RunRecord['state']): boolean {
  return ['succeeded', 'failed_retryable', 'failed_final', 'cancelled', 'abandoned'].includes(state);
}

export function classifyFailureFromMessage(message: string): EngineFailureClassification {
  const lowered = message.toLowerCase();
  if (lowered.includes('protocol')) return 'protocol_error';
  if (lowered.includes('cancel')) return 'cancelled';
  if (lowered.includes('timeout') || lowered.includes('temporary') || lowered.includes('transient')) return 'transient_failure';
  if (lowered.includes('startup') || lowered.includes('spawn') || lowered.includes('not configured')) return 'startup_failure';
  return 'permanent_failure';
}

function selectSessionKind(source: TaskRecord['source']): Parameters<typeof selectSessionRoot>[0]['kind'] {
  if (source === 'telegram') return 'telegram_user';
  if (source === 'heartbeat') return 'system_heartbeat';
  if (source === 'schedule') return 'scheduled_task';
  return 'interactive_main';
}

export { MessageIngressError };

export class RuntimeNotFoundError extends Error {
  readonly errorCode = 'not_found';

  constructor(message: string) {
    super(message);
    this.name = 'RuntimeNotFoundError';
  }
}

export class RuntimeConflictError extends Error {
  readonly errorCode = 'conflict';

  constructor(message: string) {
    super(message);
    this.name = 'RuntimeConflictError';
  }
}

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

const ProjectPathRowSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  path: z.string(),
});

const WorkspacePathRowSchema = z.object({
  id: z.string(),
  root_path: z.string(),
});

const RunRowSchema = z.object({
  id: z.string(),
  job_id: z.string(),
  task_id: z.string(),
  workspace_id: z.string(),
  session_root_id: z.string(),
  engine_session_ref: z.string().nullable(),
  state: z.string(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  error: z.string().nullable(),
});

const RunEventRowSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  type: z.string(),
  payload: z.string(),
  created_at: z.string(),
});

const MemoryListRowSchema = z.object({
  id: z.string(),
  description: z.string(),
  classification: z.enum(['secret', 'sensitive', 'internal', 'embeddable']),
  source_type: z.enum(['receipt', 'telegram', 'daily_summary', 'curated_memory', 'workspace_doc', 'compaction_flush', 'capability_sync', 'context_release']),
  content: z.string(),
  confidence: z.number(),
  scope: z.string(),
  memory_type: z.enum(['episodic', 'semantic', 'procedural']).nullable(),
  dedup_key: z.string().nullable(),
  last_reinforced_at: z.string().nullable(),
  archived_at: z.string().nullable(),
  created_at: z.string(),
  source_run_id: z.string().nullable(),
  source_timestamp: z.string().nullable(),
});

const IdRowSchema = z.object({
  id: z.string(),
});

const JobIdRowSchema = z.object({
  job_id: z.string(),
});

const CountRowSchema = z.object({
  count: z.coerce.number().int().nonnegative(),
});

const CreatedAtRowSchema = z.object({
  created_at: z.string(),
});

const ScheduleRowSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  interval_seconds: z.coerce.number().nonnegative(),
  created_at: z.string(),
});

const TelegramRelayCheckpointRowSchema = z.object({
  relay_key: z.literal('telegram_long_poll'),
  workspace_id: z.string(),
  last_acknowledged_update_id: z.coerce.number().int().nonnegative(),
  updated_at: z.string(),
});

const TelegramReplyDeliveryRowSchema = z.object({
  chat_id: z.string(),
  telegram_message_id: z.coerce.number().int(),
  status: z.enum(['pending', 'sending', 'sent', 'uncertain', 'abandoned']),
  sent_telegram_message_id: z.coerce.number().int().nullable().optional(),
  sent_at: z.string().nullable().optional(),
  run_id: z.string().nullable().optional(),
});

const TelegramReplyDeliveryFullRowSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  chat_id: z.string(),
  telegram_message_id: z.coerce.number().int(),
  message_ingress_id: z.string(),
  task_id: z.string().nullable(),
  job_id: z.string().nullable(),
  run_id: z.string().nullable(),
  status: z.enum(['pending', 'sending', 'sent', 'uncertain', 'abandoned']),
  sent_at: z.string().nullable(),
  sent_telegram_message_id: z.coerce.number().int().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

const TelegramDeliveryResolutionRowSchema = z.object({
  id: z.string(),
  delivery_id: z.string(),
  workspace_id: z.string(),
  action: z.enum(['confirm_sent', 'resend', 'abandon']),
  intervention_id: z.string().nullable(),
  operator_note: z.string().nullable(),
  sent_telegram_message_id: z.coerce.number().int().nullable().optional(),
  previous_status: z.string(),
  new_status: z.string(),
  created_at: z.string(),
});

const TelegramSendAttemptRowSchema = z.object({
  id: z.string(),
  delivery_id: z.string(),
  workspace_id: z.string(),
  attempt_number: z.coerce.number().int(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  run_id: z.string().nullable(),
  content_hash: z.string(),
  outcome: z.enum(['sent', 'retryable_failure', 'permanent_failure', 'ambiguous']),
  sent_telegram_message_id: z.coerce.number().int().nullable().optional(),
  error_summary: z.string().nullable(),
  source: z.string(),
  created_at: z.string(),
});

const RuntimeMemorySearchToolInputSchema = z.object({
  query: z.string().min(1),
  scope: z.string().optional(),
  limit: z.number().int().positive().max(10).optional(),
  includeContent: z.boolean().optional(),
});

function mapRunRow(row: unknown): RunRecord {
  const parsed = RunRowSchema.parse(row);
  return RunRecordSchema.parse({
    id: parsed.id,
    jobId: parsed.job_id,
    taskId: parsed.task_id,
    workspaceId: parsed.workspace_id,
    sessionRootId: parsed.session_root_id,
    engineSessionRef: parsed.engine_session_ref,
    state: parsed.state,
    startedAt: parsed.started_at,
    finishedAt: parsed.finished_at,
    error: parsed.error,
  });
}

function mapRunEventRow(row: unknown): RunEventRecord {
  const parsed = RunEventRowSchema.parse(row);
  return RunEventRecordSchema.parse({
    id: parsed.id,
    runId: parsed.run_id,
    type: parsed.type,
    payload: parsed.payload,
    createdAt: parsed.created_at,
  });
}

function mapTelegramDeliveryRow(row: unknown): TelegramDeliveryState {
  const parsed = TelegramReplyDeliveryRowSchema.parse(row);
  return TelegramDeliveryStateSchema.parse({
    chatId: parsed.chat_id,
    telegramMessageId: parsed.telegram_message_id,
    status: parsed.status,
  });
}

function parseCountRow(row: unknown): number {
  return CountRowSchema.parse(row).count;
}

function parseCreatedAt(row: unknown): string | null {
  const parsed = CreatedAtRowSchema.safeParse(row);
  return parsed.success ? parsed.data.created_at : null;
}

function buildReceiptFallbackReplyText(receipt: ReceiptRecord): string {
  const parts = [
    receipt.summary,
    `Status: ${receipt.status}`,
    `Model: ${receipt.usage.provider}/${receipt.usage.model}`,
    `Tokens: ${receipt.usage.tokensIn}/${receipt.usage.tokensOut}`,
    `Cost: $${receipt.usage.estimatedCostUsd.toFixed(4)}`,
  ];
  if (receipt.status !== 'succeeded' && receipt.details.trim().length > 0) {
    parts.push(`Details: ${receipt.details}`);
  }
  return parts.join('\n');
}

function mapConnectionRow(row: Record<string, unknown>): ConnectionRecord {
  return {
    id: row['id'] as string,
    domain: row['domain'] as ConnectionRecord['domain'],
    providerKind: row['provider_kind'] as ConnectionRecord['providerKind'],
    label: row['label'] as string,
    mode: (row['mode'] as ConnectionRecord['mode']) ?? 'read_only',
    secretRefId: (row['secret_ref_id'] as string) ?? null,
    enabled: !!(row['enabled'] as number),
    syncIntervalSeconds: (row['sync_interval_seconds'] as number) ?? 900,
    allowedScopes: JSON.parse((row['allowed_scopes'] as string) ?? '[]') as string[],
    allowedResources: JSON.parse((row['allowed_resources'] as string) ?? '[]') as string[],
    lastSyncAt: (row['last_sync_at'] as string) ?? null,
    lastSyncStatus: (row['last_sync_status'] as ConnectionRecord['lastSyncStatus']) ?? null,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
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
  private readonly approvalService: ApprovalService;
  private readonly vaultManager: VaultManager;
  private readonly contextReleaseService: ContextReleaseService;
  private approvalExpiryTimer: ReturnType<typeof setInterval> | null = null;

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
    });
    const summarizationClient = config.embeddings.provider === 'openai'
      ? createOpenAISummarizationClient({})
      : createDisabledSummarizationClient();
    this.memoryLifecycle = new MemoryLifecycleService(this.databases, config, this.memorySearch, summarizationClient);

    // Try loading sqlite-vec (non-blocking)
    this.vecInitPromise = loadSqliteVec(this.databases.memory, config.embeddings.dimensions).then((loaded) => {
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
    this.approvalService = new ApprovalService(
      this.databases.app,
      this.log,
      auditCallback,
      (event, data) => this.emit(event, data),
      { pendingExpiryMinutes: config.approvalPolicy?.pendingExpiryMinutes ?? 60 },
    );
    this.vaultManager = new VaultManager(this.databases.app, this.log, this.databases.paths, auditCallback);
    this.contextReleaseService = new ContextReleaseService(this.databases.app, this.log, auditCallback);

    this.receiptManager = new ReceiptManager(this.databases, config, {
      captureMemory: (input) => this.memoryLifecycle.insertMemory(input),
    });
    this.taskManager = new TaskManager(this.databases, {
      emit: (event, payload) => this.emit(event, payload),
      processSchedulerTick: () => this.processSchedulerTick(),
    });
    this.messageIngestion = new MessageIngestionService(this.databases, config, {
      recordSecurityAudit: (event) => this.recordSecurityAudit(event),
      createTask: (input) => this.createTask(input),
      createIntervention: (code, runId, reason) => this.createIntervention(code, runId, reason),
    });
    const self = this;
    this.queryService = new QueryService(this.databases, config, {
      get schedulerRunning() { return self.scheduler.running; },
      get activeRunsCount() { return self.activeRuns.size; },
      get startedAt() { return self.startedAt; },
      get lastSchedulerTickAt() { return self.scheduler.lastSchedulerTickAt; },
      get lastLeaseSweepAt() { return self.scheduler.lastLeaseSweepAt; },
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
    return this.taskManager.createTask(input);
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

  listReceipts(): ReceiptRecord[] {
    return this.receiptManager.listReceipts();
  }

  getReceipt(receiptId: string): ReceiptRecord | null {
    return this.receiptManager.getReceipt(receiptId);
  }

  getReceiptByRunId(runId: string): ReceiptRecord | null {
    return this.receiptManager.getReceiptByRunId(runId);
  }

  getUsageSummary(): UsageSummary {
    return this.receiptManager.getUsageSummary();
  }

  // --- Delegated: QueryService ---

  getStatus(): DaemonStatusResponse {
    return this.queryService.getStatus();
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

  issueCsrfToken(): string {
    return this.queryService.issueCsrfToken();
  }

  createBrowserSession() {
    return createRuntimeBrowserSession(this.databases.app);
  }

  validateBrowserSession(sessionId: string): BrowserSessionValidationResult {
    return validateRuntimeBrowserSession(this.databases.app, sessionId);
  }

  // --- Delegated: MessageIngestion ---

  ingestMessage(input: unknown): MessageIngressResponse {
    return this.messageIngestion.ingestMessage(input);
  }

  getMessage(messageId: string): MessageRecord | null {
    return this.messageIngestion.getMessage(messageId);
  }

  getTelegramRelayCheckpoint(workspaceId: string, relayKey: 'telegram_long_poll' = 'telegram_long_poll'): TelegramRelayCheckpoint | null {
    const row = this.databases.app
      .prepare('SELECT relay_key, workspace_id, last_acknowledged_update_id, updated_at FROM telegram_relay_checkpoints WHERE relay_key = ? AND workspace_id = ?')
      .get(relayKey, workspaceId);
    if (!row) return null;
    const parsed = TelegramRelayCheckpointRowSchema.parse(row);
    return TelegramRelayCheckpointSchema.parse({
      relayKey: parsed.relay_key,
      workspaceId: parsed.workspace_id,
      lastAcknowledgedUpdateId: parsed.last_acknowledged_update_id,
      updatedAt: parsed.updated_at,
    });
  }

  commitTelegramRelayCheckpoint(input: TelegramRelayCheckpointCommitRequest): TelegramRelayCheckpoint {
    if (!this.getWorkspace(input.workspaceId)) {
      throw new RuntimeNotFoundError(`Workspace ${input.workspaceId} not found`);
    }
    const relayKey = input.relayKey ?? 'telegram_long_poll';
    const updatedAt = nowIso();
    this.databases.app.prepare(`
      INSERT INTO telegram_relay_checkpoints (relay_key, workspace_id, last_acknowledged_update_id, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(relay_key, workspace_id) DO UPDATE SET
        last_acknowledged_update_id = MAX(telegram_relay_checkpoints.last_acknowledged_update_id, excluded.last_acknowledged_update_id),
        updated_at = excluded.updated_at
    `).run(relayKey, input.workspaceId, input.lastAcknowledgedUpdateId, updatedAt);
    const checkpoint = this.getTelegramRelayCheckpoint(input.workspaceId, relayKey);
    if (!checkpoint) {
      throw new Error(`Failed to persist Telegram relay checkpoint for workspace ${input.workspaceId}`);
    }
    return checkpoint;
  }

  markTelegramReplySending(
    chatId: string,
    telegramMessageId: number,
    input: { workspaceId: string; runId?: string | null },
  ): TelegramDeliveryState | null {
    const updatedAt = nowIso();
    this.databases.app.prepare(`
      UPDATE telegram_reply_deliveries
      SET status = CASE
            WHEN status = 'pending' THEN 'sending'
            ELSE status
          END,
          run_id = COALESCE(?, run_id),
          updated_at = ?
      WHERE workspace_id = ?
        AND chat_id = ?
        AND telegram_message_id = ?
    `).run(
      input.runId ?? null,
      updatedAt,
      input.workspaceId,
      chatId,
      telegramMessageId,
    );
    const row = this.databases.app
      .prepare('SELECT chat_id, telegram_message_id, status, sent_telegram_message_id, sent_at, run_id FROM telegram_reply_deliveries WHERE workspace_id = ? AND chat_id = ? AND telegram_message_id = ?')
      .get(input.workspaceId, chatId, telegramMessageId);
    return row ? mapTelegramDeliveryRow(row) : null;
  }

  markTelegramReplyPending(
    chatId: string,
    telegramMessageId: number,
    input: { workspaceId: string; runId?: string | null },
  ): TelegramDeliveryState | null {
    const updatedAt = nowIso();
    this.databases.app.prepare(`
      UPDATE telegram_reply_deliveries
      SET status = 'pending',
          run_id = COALESCE(?, run_id),
          updated_at = ?
      WHERE workspace_id = ?
        AND chat_id = ?
        AND telegram_message_id = ?
    `).run(
      input.runId ?? null,
      updatedAt,
      input.workspaceId,
      chatId,
      telegramMessageId,
    );
    const row = this.databases.app
      .prepare('SELECT chat_id, telegram_message_id, status, sent_telegram_message_id, sent_at, run_id FROM telegram_reply_deliveries WHERE workspace_id = ? AND chat_id = ? AND telegram_message_id = ?')
      .get(input.workspaceId, chatId, telegramMessageId);
    return row ? mapTelegramDeliveryRow(row) : null;
  }

  markTelegramReplyUncertain(
    chatId: string,
    telegramMessageId: number,
    input: { workspaceId: string; runId?: string | null; reason?: string | null },
  ): TelegramDeliveryState | null {
    const updatedAt = nowIso();
    const row = this.databases.app
      .prepare('SELECT chat_id, telegram_message_id, status, sent_telegram_message_id, sent_at, run_id FROM telegram_reply_deliveries WHERE workspace_id = ? AND chat_id = ? AND telegram_message_id = ?')
      .get(input.workspaceId, chatId, telegramMessageId);
    if (!row) return null;

    const previous = TelegramReplyDeliveryRowSchema.parse(row);
    this.databases.app.prepare(`
      UPDATE telegram_reply_deliveries
      SET status = 'uncertain',
          run_id = COALESCE(?, run_id),
          updated_at = ?
      WHERE workspace_id = ?
        AND chat_id = ?
        AND telegram_message_id = ?
    `).run(
      input.runId ?? null,
      updatedAt,
      input.workspaceId,
      chatId,
      telegramMessageId,
    );
    if (previous.status !== 'uncertain') {
      this.createIntervention(
        'needs_operator_input',
        input.runId ?? previous.run_id ?? null,
        input.reason ?? `Telegram delivery for chat ${chatId} message ${telegramMessageId} became uncertain and needs operator confirmation.`,
      );
    }

    const updatedRow = this.databases.app
      .prepare('SELECT chat_id, telegram_message_id, status, sent_telegram_message_id, sent_at, run_id FROM telegram_reply_deliveries WHERE workspace_id = ? AND chat_id = ? AND telegram_message_id = ?')
      .get(input.workspaceId, chatId, telegramMessageId);
    return updatedRow ? mapTelegramDeliveryRow(updatedRow) : null;
  }

  markTelegramReplySent(
    chatId: string,
    telegramMessageId: number,
    input: { workspaceId: string; runId?: string | null; sentTelegramMessageId?: number | null },
  ): TelegramDeliveryState | null {
    const updatedAt = nowIso();
    this.databases.app.prepare(`
      UPDATE telegram_reply_deliveries
      SET status = 'sent',
          sent_telegram_message_id = COALESCE(?, sent_telegram_message_id),
          sent_at = COALESCE(sent_at, ?),
          run_id = COALESCE(?, run_id),
          updated_at = ?
      WHERE workspace_id = ?
        AND chat_id = ?
        AND telegram_message_id = ?
    `).run(
      input.sentTelegramMessageId ?? null,
      updatedAt,
      input.runId ?? null,
      updatedAt,
      input.workspaceId,
      chatId,
      telegramMessageId,
    );
    const row = this.databases.app
      .prepare('SELECT chat_id, telegram_message_id, status, sent_telegram_message_id, sent_at, run_id FROM telegram_reply_deliveries WHERE workspace_id = ? AND chat_id = ? AND telegram_message_id = ?')
      .get(input.workspaceId, chatId, telegramMessageId);
    return row ? mapTelegramDeliveryRow(row) : null;
  }

  // --- Telegram delivery resolution (Step 1) ---

  private mapFullDeliveryRow(row: unknown): TelegramDeliveryRecord {
    const parsed = TelegramReplyDeliveryFullRowSchema.parse(row);
    return TelegramDeliveryRecordSchema.parse({
      id: parsed.id,
      workspaceId: parsed.workspace_id,
      chatId: parsed.chat_id,
      telegramMessageId: parsed.telegram_message_id,
      messageIngressId: parsed.message_ingress_id,
      taskId: parsed.task_id,
      jobId: parsed.job_id,
      runId: parsed.run_id,
      status: parsed.status,
      sentAt: parsed.sent_at,
      sentTelegramMessageId: parsed.sent_telegram_message_id ?? null,
      createdAt: parsed.created_at,
      updatedAt: parsed.updated_at,
    });
  }

  private mapResolutionRow(row: unknown): TelegramDeliveryResolutionRecord {
    const parsed = TelegramDeliveryResolutionRowSchema.parse(row);
    return TelegramDeliveryResolutionRecordSchema.parse({
      id: parsed.id,
      deliveryId: parsed.delivery_id,
      workspaceId: parsed.workspace_id,
      action: parsed.action,
      interventionId: parsed.intervention_id,
      operatorNote: parsed.operator_note,
      sentTelegramMessageId: parsed.sent_telegram_message_id ?? null,
      previousStatus: parsed.previous_status,
      newStatus: parsed.new_status,
      createdAt: parsed.created_at,
    });
  }

  private mapSendAttemptRow(row: unknown): TelegramSendAttemptRecord {
    const parsed = TelegramSendAttemptRowSchema.parse(row);
    return TelegramSendAttemptRecordSchema.parse({
      id: parsed.id,
      deliveryId: parsed.delivery_id,
      workspaceId: parsed.workspace_id,
      attemptNumber: parsed.attempt_number,
      startedAt: parsed.started_at,
      finishedAt: parsed.finished_at,
      runId: parsed.run_id,
      contentHash: parsed.content_hash,
      outcome: parsed.outcome,
      sentTelegramMessageId: parsed.sent_telegram_message_id ?? null,
      errorSummary: parsed.error_summary,
      source: parsed.source,
      createdAt: parsed.created_at,
    });
  }

  listUncertainDeliveries(workspaceId?: string): TelegramDeliveryRecord[] {
    const sql = workspaceId
      ? "SELECT * FROM telegram_reply_deliveries WHERE status = 'uncertain' AND workspace_id = ?"
      : "SELECT * FROM telegram_reply_deliveries WHERE status = 'uncertain'";
    const rows = workspaceId
      ? this.databases.app.prepare(sql).all(workspaceId)
      : this.databases.app.prepare(sql).all();
    return rows.map((row) => this.mapFullDeliveryRow(row));
  }

  getDeliveryById(id: string): TelegramDeliveryRecord | null {
    const row = this.databases.app.prepare('SELECT * FROM telegram_reply_deliveries WHERE id = ?').get(id);
    return row ? this.mapFullDeliveryRow(row) : null;
  }

  resolveTelegramDelivery(deliveryId: string, input: TelegramDeliveryResolutionRequest): TelegramDeliveryResolutionRecord {
    const delivery = this.getDeliveryById(deliveryId);
    if (!delivery) {
      throw new RuntimeNotFoundError(`Delivery ${deliveryId} not found`);
    }
    if (delivery.status !== 'uncertain') {
      throw new RuntimeConflictError(`Delivery ${deliveryId} status is '${delivery.status}', expected 'uncertain'`);
    }

    const actionToStatus: Record<string, string> = {
      confirm_sent: 'sent',
      resend: 'pending',
      abandon: 'abandoned',
    };
    const newStatus = actionToStatus[input.action]!;
    const now = nowIso();

    // Find linked open intervention
    const interventionRow = this.databases.app
      .prepare("SELECT id FROM interventions WHERE run_id = ? AND code = 'needs_operator_input' AND status = 'open' ORDER BY created_at DESC LIMIT 1")
      .get(delivery.runId);
    const interventionId = interventionRow ? z.object({ id: z.string() }).parse(interventionRow).id : null;

    // Update delivery status
    const updateSql = newStatus === 'sent'
      ? `UPDATE telegram_reply_deliveries SET status = ?, sent_telegram_message_id = COALESCE(?, sent_telegram_message_id), sent_at = COALESCE(sent_at, ?), updated_at = ? WHERE id = ?`
      : 'UPDATE telegram_reply_deliveries SET status = ?, updated_at = ? WHERE id = ?';
    if (newStatus === 'sent') {
      this.databases.app.prepare(updateSql).run(newStatus, input.sentTelegramMessageId ?? null, now, now, deliveryId);
    } else {
      this.databases.app.prepare(updateSql).run(newStatus, now, deliveryId);
    }

    // Insert resolution record
    const resolutionId = randomUUID();
    this.databases.app.prepare(`
      INSERT INTO telegram_delivery_resolutions (id, delivery_id, workspace_id, action, intervention_id, operator_note, sent_telegram_message_id, previous_status, new_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      resolutionId,
      deliveryId,
      input.workspaceId,
      input.action,
      interventionId,
      input.operatorNote ?? null,
      input.sentTelegramMessageId ?? null,
      delivery.status,
      newStatus,
      now,
    );

    // Resolve linked intervention
    if (interventionId) {
      this.resolveIntervention(interventionId, input.operatorNote);
    }

    this.emit('telegram_delivery_resolved', { deliveryId, action: input.action, newStatus });

    const resolutionRow = this.databases.app
      .prepare('SELECT * FROM telegram_delivery_resolutions WHERE id = ?')
      .get(resolutionId);
    return this.mapResolutionRow(resolutionRow);
  }

  listDeliveryResolutions(deliveryId: string): TelegramDeliveryResolutionRecord[] {
    const rows = this.databases.app
      .prepare('SELECT * FROM telegram_delivery_resolutions WHERE delivery_id = ? ORDER BY created_at ASC')
      .all(deliveryId);
    return rows.map((row) => this.mapResolutionRow(row));
  }

  getResendableDeliveries(workspaceId: string): TelegramDeliveryRecord[] {
    const rows = this.databases.app
      .prepare("SELECT * FROM telegram_reply_deliveries WHERE status = 'pending' AND updated_at > created_at AND workspace_id = ?")
      .all(workspaceId);
    return rows.map((row) => this.mapFullDeliveryRow(row));
  }

  // --- Telegram send-attempt audit (Step 2) ---

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
    let deliveryId = input.deliveryId;
    if (!deliveryId && input.chatId !== undefined && input.telegramMessageId !== undefined) {
      const row = this.databases.app
        .prepare('SELECT id FROM telegram_reply_deliveries WHERE workspace_id = ? AND chat_id = ? AND telegram_message_id = ?')
        .get(input.workspaceId, input.chatId, input.telegramMessageId);
      if (row) {
        deliveryId = z.object({ id: z.string() }).parse(row).id;
      }
    }
    if (!deliveryId) {
      throw new RuntimeNotFoundError('Cannot resolve delivery for send-attempt recording');
    }
    const id = randomUUID();
    const now = nowIso();
    const countRow = this.databases.app
      .prepare('SELECT COALESCE(MAX(attempt_number), 0) as max_attempt FROM telegram_send_attempts WHERE delivery_id = ?')
      .get(deliveryId);
    const attemptNumber = z.object({ max_attempt: z.coerce.number().int() }).parse(countRow).max_attempt + 1;
    const errorSummary = input.errorSummary ? input.errorSummary.slice(0, 500) : null;

    this.databases.app.prepare(`
      INSERT INTO telegram_send_attempts (id, delivery_id, workspace_id, attempt_number, started_at, finished_at, run_id, content_hash, outcome, sent_telegram_message_id, error_summary, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      deliveryId,
      input.workspaceId,
      attemptNumber,
      input.startedAt,
      input.finishedAt ?? null,
      input.runId ?? null,
      input.contentHash,
      input.outcome,
      input.sentTelegramMessageId ?? null,
      errorSummary,
      input.source ?? 'relay',
      now,
    );

    const row = this.databases.app.prepare('SELECT * FROM telegram_send_attempts WHERE id = ?').get(id);
    return this.mapSendAttemptRow(row);
  }

  listTelegramSendAttempts(deliveryId: string): TelegramSendAttemptRecord[] {
    const rows = this.databases.app
      .prepare('SELECT * FROM telegram_send_attempts WHERE delivery_id = ? ORDER BY created_at ASC')
      .all(deliveryId);
    return rows.map((row) => this.mapSendAttemptRow(row));
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
    const receipt = this.receiptManager.getReceiptByRunId(runId);
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
    const receipt = this.receiptManager.writeReceipt({
      runId,
      jobId: run.jobId,
      taskId: run.taskId,
      workspaceId: run.workspaceId,
      status: 'cancelled',
      summary: 'Run cancelled',
      details: '',
      usage: { provider: this.config.engine.kind, model: 'n/a', tokensIn: 0, tokensOut: 0, estimatedCostUsd: 0 },
    });
    this.receiptManager.captureMemoryFromReceipt(receipt);
    this.emit('run_completed', receipt);
    return this.getRun(runId);
  }

  async waitForJobTerminalState(jobId: string, timeoutMs = 10_000): Promise<{ job: JobRecord; run: RunRecord | null; receipt: ReceiptRecord | null } | null> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const job = this.getJob(jobId);
      if (job && isTerminalJobStatus(job.status)) {
        const run = job.lastRunId ? this.getRun(job.lastRunId) : null;
        const receipt = run ? this.receiptManager.getReceiptByRunId(run.id) : null;
        return { job, run, receipt };
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  }

  async waitForTaskTerminalReceipt(taskId: string, timeoutMs = 10_000): Promise<ReceiptRecord | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const receipt = this.receiptManager.getReceiptByTaskId(taskId);
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
      ...(query.memoryTypes !== undefined && { memoryTypes: query.memoryTypes }),
      ...(query.minConfidence !== undefined && { minConfidence: query.minConfidence }),
      ...(query.limit !== undefined && { limit: query.limit }),
      ...(query.includeContent !== undefined && { includeContent: query.includeContent }),
    });
  }

  getMemoryContent(memoryId: string): MemoryRecord | null {
    const record = this.memorySearch.getMemoryContent(memoryId);
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

  listMemories(options?: { type?: string; scope?: string; limit?: number }): MemoryRecord[] {
    const conditions: string[] = ['archived_at IS NULL'];
    const params: unknown[] = [];
    if (options?.type) { conditions.push('memory_type = ?'); params.push(options.type); }
    if (options?.scope) { conditions.push('scope = ?'); params.push(options.scope); }
    const limit = options?.limit ?? 50;
    params.push(limit);
    const sql = `SELECT id, description, classification, source_type, content, confidence, scope, memory_type, dedup_key, last_reinforced_at, archived_at, created_at, source_run_id, source_timestamp FROM memories WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ?`;
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

  getMemory(memoryId: string): MemoryRecord | null {
    return this.getMemoryContent(memoryId);
  }

  async budgetFitMemory(query: {
    query: string;
    scope?: string;
    memoryTypes?: Array<'episodic' | 'semantic' | 'procedural'>;
    minConfidence?: number;
    maxTokens: number;
    limit?: number;
  }) {
    return this.memorySearch.budgetFit(query);
  }

  describeMemory(memoryId: string) {
    return this.memorySearch.describeMemory(memoryId);
  }

  expandMemory(memoryId: string, maxTokens?: number) {
    const cap = maxTokens ?? this.config.memory.expandTokenCap;
    return this.memorySearch.expandMemory(memoryId, cap);
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
    confidence?: number;
    classification?: 'secret' | 'sensitive' | 'internal' | 'embeddable';
  }): { memoryId: string; embedded: boolean } {
    const redactedContent = redactText(input.content, this.config.security.redactionPatterns).text;
    const redactedDesc = redactText(input.description, this.config.security.redactionPatterns).text;
    return this.memoryLifecycle.insertMemory({
      description: redactedDesc,
      content: redactedContent,
      sourceType: input.sourceType ?? 'curated_memory',
      ...(input.memoryType !== undefined && { memoryType: input.memoryType }),
      scope: input.scope ?? 'workspace',
      confidence: input.confidence ?? 0.8,
      classification: input.classification ?? 'embeddable',
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

  resolveApproval(id: string, input: ApprovalResolveInput): ApprovalRecord {
    return this.approvalService.resolveApproval(id, input);
  }

  getApproval(id: string): ApprovalRecord | null {
    return this.approvalService.getApproval(id);
  }

  listApprovals(filter?: { scope?: string; status?: string; domain?: string }): ApprovalRecord[] {
    return this.approvalService.listApprovals(filter);
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
    const approvalRules = this.config.approvalPolicy?.rules ?? [];
    return { domainPolicies, approvalRules };
  }

  listConnections(domain?: string): ConnectionRecord[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (domain) { conditions.push('domain = ?'); params.push(domain); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.databases.app.prepare(`SELECT * FROM connections ${where} ORDER BY created_at DESC`).all(...params) as Record<string, unknown>[];
    return rows.map(mapConnectionRow);
  }

  createConnection(input: ConnectionCreateInput): ConnectionRecord {
    const id = randomUUID();
    const now = nowIso();
    this.databases.app
      .prepare(
        `INSERT INTO connections (id, domain, provider_kind, label, mode, secret_ref_id, enabled, sync_interval_seconds, allowed_scopes, allowed_resources, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.domain, input.providerKind, input.label, input.mode, input.secretRefId ?? null, input.syncIntervalSeconds, JSON.stringify(input.allowedScopes), JSON.stringify(input.allowedResources), now, now);
    return this.getConnection(id)!;
  }

  updateConnection(id: string, input: ConnectionUpdateInput): ConnectionRecord | null {
    const existing = this.getConnection(id);
    if (!existing) return null;
    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.label !== undefined) { sets.push('label = ?'); params.push(input.label); }
    if (input.mode !== undefined) { sets.push('mode = ?'); params.push(input.mode); }
    if (input.secretRefId !== undefined) { sets.push('secret_ref_id = ?'); params.push(input.secretRefId); }
    if (input.enabled !== undefined) { sets.push('enabled = ?'); params.push(input.enabled ? 1 : 0); }
    if (input.syncIntervalSeconds !== undefined) { sets.push('sync_interval_seconds = ?'); params.push(input.syncIntervalSeconds); }
    if (input.allowedScopes !== undefined) { sets.push('allowed_scopes = ?'); params.push(JSON.stringify(input.allowedScopes)); }
    if (input.allowedResources !== undefined) { sets.push('allowed_resources = ?'); params.push(JSON.stringify(input.allowedResources)); }
    if (sets.length === 0) return existing;
    sets.push('updated_at = ?');
    params.push(nowIso());
    params.push(id);
    this.databases.app.prepare(`UPDATE connections SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.getConnection(id);
  }

  deleteConnection(id: string): boolean {
    const result = this.databases.app.prepare('DELETE FROM connections WHERE id = ?').run(id);
    return result.changes > 0;
  }

  private getConnection(id: string): ConnectionRecord | null {
    const row = this.databases.app.prepare('SELECT * FROM connections WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? mapConnectionRow(row) : null;
  }

  // --- Internal: event emission ---

  private emit(event: string, payload: unknown): void {
    this.events.emit('event', { event, data: JSON.stringify(payload) } satisfies RuntimeEvent);
  }

  private createRuntimeTools(task: TaskRecord): RuntimeToolDescriptor[] {
    return [
      {
        name: 'popeye_memory_search',
        label: 'Popeye Memory Search',
        description: 'Search Popeye memory for prior facts, receipts, and procedures. Returns IDs you can pass to popeye_memory_describe or popeye_memory_expand for details.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            scope: { type: 'string', description: 'Optional memory scope override' },
            limit: { type: 'number', description: 'Maximum results to return (1-10)' },
            includeContent: { type: 'boolean', description: 'Include full memory content snippets' },
          },
          required: ['query'],
          additionalProperties: false,
        },
        execute: async (params) => {
          const parsed = RuntimeMemorySearchToolInputSchema.parse(params ?? {});
          const response = await this.searchMemory({
            query: parsed.query,
            scope: parsed.scope ?? task.workspaceId,
            limit: parsed.limit ?? 5,
            includeContent: parsed.includeContent ?? false,
          });
          const lines = response.results.length === 0
            ? ['No matching Popeye memories found.']
            : response.results.map((result, index) => {
                const snippet = result.content ? ` — ${result.content.slice(0, 100)}` : '';
                return `${index + 1}. [id:${result.id}] ${result.description} [${result.scope}/${result.sourceType}] score:${result.score.toFixed(2)}${snippet}`;
              });
          return {
            content: [{ type: 'text', text: lines.join('\n') }],
            details: {
              query: response.query,
              totalCandidates: response.totalCandidates,
              latencyMs: response.latencyMs,
              searchMode: response.searchMode,
              results: response.results,
            },
          };
        },
      },
      {
        name: 'popeye_memory_describe',
        label: 'Popeye Memory Describe',
        description: 'Get metadata about a specific memory (type, confidence, entities, sources, events) without loading full content. Use after search to decide if expand is needed.',
        inputSchema: {
          type: 'object',
          properties: {
            memoryId: { type: 'string', description: 'Memory ID from search results' },
          },
          required: ['memoryId'],
          additionalProperties: false,
        },
        execute: async (params) => {
          const parsed = z.object({ memoryId: z.string().min(1) }).parse(params ?? {});
          const desc = this.describeMemory(parsed.memoryId);
          if (!desc) {
            return { content: [{ type: 'text', text: `Memory ${parsed.memoryId} not found.` }] };
          }
          const lines = [
            `ID: ${desc.id}`,
            `Description: ${desc.description}`,
            `Type: ${desc.type} | Source: ${desc.sourceType} | Scope: ${desc.scope}`,
            `Confidence: ${desc.confidence.toFixed(2)} | Durable: ${desc.durable}`,
            `Content length: ${desc.contentLength} chars (~${Math.ceil(desc.contentLength / 4)} tokens)`,
            `Entities: ${desc.entityCount} | Sources: ${desc.sourceCount} | Events: ${desc.eventCount}`,
            `Created: ${desc.createdAt}${desc.lastReinforcedAt ? ` | Last reinforced: ${desc.lastReinforcedAt}` : ''}`,
          ];
          return { content: [{ type: 'text', text: lines.join('\n') }], details: desc };
        },
      },
      {
        name: 'popeye_memory_expand',
        label: 'Popeye Memory Expand',
        description: 'Load full content of a specific memory. Use after describe to get the actual content when needed.',
        inputSchema: {
          type: 'object',
          properties: {
            memoryId: { type: 'string', description: 'Memory ID to expand' },
            maxTokens: { type: 'number', description: 'Maximum tokens to return (default 8000)' },
          },
          required: ['memoryId'],
          additionalProperties: false,
        },
        execute: async (params) => {
          const parsed = z.object({ memoryId: z.string().min(1), maxTokens: z.number().int().positive().optional() }).parse(params ?? {});
          const expanded = this.expandMemory(parsed.memoryId, parsed.maxTokens);
          if (!expanded) {
            return { content: [{ type: 'text', text: `Memory ${parsed.memoryId} not found.` }] };
          }
          const header = expanded.truncated ? `[Truncated to ~${expanded.tokenEstimate} tokens]\n\n` : '';
          return { content: [{ type: 'text', text: `${header}${expanded.content}` }], details: expanded };
        },
      },
    ];
  }

  private resolveTaskCwd(task: TaskRecord): string | undefined {
    if (task.projectId) {
      const project = this.workspaceRegistry.getProject(task.projectId);
      if (project?.workspaceId === task.workspaceId && project.path) {
        return project.path;
      }
    }
    const workspace = this.workspaceRegistry.getWorkspace(task.workspaceId);
    return workspace?.rootPath ?? undefined;
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
    this.databases.app.prepare('INSERT OR IGNORE INTO agent_profiles (id, name, created_at) VALUES (?, ?, ?)').run('default', 'Default agent profile', this.startedAt);
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
        .prepare('INSERT OR IGNORE INTO tasks (id, workspace_id, project_id, title, prompt, source, status, retry_policy_json, side_effect_profile, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(
          heartbeatTaskId,
          workspace.id,
          null,
          heartbeatTitle,
          heartbeatPrompt,
          'heartbeat',
          heartbeatStatus,
          retryPolicy,
          'read_only',
          this.startedAt,
        );
      this.databases.app
        .prepare('UPDATE tasks SET title = ?, prompt = ?, status = ?, retry_policy_json = ?, side_effect_profile = ? WHERE id = ?')
        .run(heartbeatTitle, heartbeatPrompt, heartbeatStatus, retryPolicy, 'read_only', heartbeatTaskId);

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
      sessionRootId: sessionRoot.id,
      engineSessionRef: null,
      state: 'starting',
      startedAt: nowIso(),
      finishedAt: null,
      error: null,
    };

    this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ?, last_run_id = ? WHERE id = ?').run('running', nowIso(), run.id, job.id);
    this.databases.app.prepare('INSERT INTO runs (id, job_id, task_id, workspace_id, session_root_id, engine_session_ref, state, started_at, finished_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      run.id,
      run.jobId,
      run.taskId,
      run.workspaceId,
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
      const taskCwd = this.resolveTaskCwd(task);
      const engineRequest: EngineRunRequest = {
        prompt: fullPrompt,
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        instructionSnapshotId: instructionBundle.id,
        ...(taskCwd !== undefined && { cwd: taskCwd }),
        sessionPolicy: { type: 'dedicated', rootId: sessionRoot.id },
        trigger: {
          source: task.source,
          timestamp: run.startedAt,
        },
        runtimeTools: this.createRuntimeTools(task),
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
      runLog.error('run startup failed', { error: safeMessage });
      this.releaseWorkspaceLock(job.workspaceId);
      this.databases.app.prepare('DELETE FROM job_leases WHERE job_id = ?').run(job.id);
      this.databases.app.prepare('UPDATE runs SET state = ?, finished_at = ?, error = ? WHERE id = ?').run('failed_final', nowIso(), safeMessage, run.id);
      this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('failed_final', nowIso(), job.id);
      const receipt = this.receiptManager.writeReceipt({
        runId: run.id,
        jobId: job.id,
        taskId: task.id,
        workspaceId: task.workspaceId,
        status: 'failed',
        summary: 'Run failed during engine startup',
        details: safeMessage,
        usage: { provider: this.config.engine.kind, model: 'unknown', tokensIn: task.prompt.length, tokensOut: 0, estimatedCostUsd: 0 },
      });
      this.receiptManager.captureMemoryFromReceipt(receipt);
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
      const receipt = this.receiptManager.writeReceipt({
        runId: run.id,
        jobId: run.jobId,
        taskId: run.taskId,
        workspaceId: run.workspaceId,
        status: 'succeeded',
        summary: 'Run completed successfully',
        details: JSON.stringify(this.listRunEvents(run.id)),
        usage: completion.usage,
      });
      this.receiptManager.captureMemoryFromReceipt(receipt);
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
      const receipt = this.receiptManager.writeReceipt({
        runId: run.id,
        jobId: run.jobId,
        taskId: run.taskId,
        workspaceId: run.workspaceId,
        status: 'cancelled',
        summary: 'Run cancelled',
        details: 'Cancelled by operator or daemon shutdown',
        usage: completion.usage,
      });
      this.receiptManager.captureMemoryFromReceipt(receipt);
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
    const receipt = this.receiptManager.writeReceipt({
      runId: run.id,
      jobId: run.jobId,
      taskId: run.taskId,
      workspaceId: run.workspaceId,
      status: 'failed',
      summary: 'Run failed',
      details: failure,
      usage: completion.usage,
    });
    this.receiptManager.captureMemoryFromReceipt(receipt);
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

    const receipt = this.receiptManager.writeReceipt({
      runId: job.lastRunId ?? 'unknown',
      jobId,
      taskId: task.id,
      workspaceId: task.workspaceId,
      status: 'failed',
      summary: 'Run failed and was scheduled for retry',
      details: reason,
      usage: completion.usage,
    });
    this.receiptManager.captureMemoryFromReceipt(receipt);
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
    const receipt = this.receiptManager.getReceiptByRunId(run.id);
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
    this.log.debug('doc indexing started', { workspaces: this.config.workspaces.length });

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
}

export function createRuntimeService(config: AppConfig, engineOverride?: EngineAdapter, loggerOverride?: PopeyeLogger): PopeyeRuntimeService {
  return new PopeyeRuntimeService(config, engineOverride, loggerOverride);
}
