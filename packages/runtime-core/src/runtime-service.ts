import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

import type {
  AgentProfileRecord,
  AppConfig,
  CompiledInstructionBundle,
  DaemonStateRecord,
  DaemonStatusResponse,
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
  SecurityAuditEvent,
  TaskCreateInput,
  TaskRecord,
  TelegramDeliveryState,
  TelegramRelayCheckpoint,
  TelegramRelayCheckpointCommitRequest,
  UsageSummary,
  WorkspaceRecord,
  WorkspaceRegistrationInput,
} from '@popeye/contracts';
import {
  buildCanonicalRunReply,
  MemoryRecordSchema,
  RunEventRecordSchema,
  RunRecordSchema,
  RunReplySchema,
  TelegramDeliveryStateSchema,
  TelegramRelayCheckpointSchema,
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
import { MemorySearchService, createDisabledEmbeddingClient, createOpenAIEmbeddingClient, loadSqliteVec } from '@popeye/memory';
import { redactText } from '@popeye/observability';
import { calculateRetryDelaySeconds, TaskManager } from '@popeye/scheduler';
import { selectSessionRoot, SessionService } from '@popeye/sessions';

import { ReceiptManager } from '@popeye/receipts';

import { WorkspaceRegistry } from '@popeye/workspace';

import { openRuntimeDatabases, type RuntimeDatabases } from './database.js';
import { MemoryLifecycleService, type MemoryInsertInput } from './memory-lifecycle.js';
import { MessageIngestionService, MessageIngressError } from './message-ingestion.js';
import { QueryService } from './query-service.js';
import {
  clearBrowserSessions,
  createBrowserSession as createRuntimeBrowserSession,
  type BrowserSessionValidationResult,
  validateBrowserSession as validateRuntimeBrowserSession,
} from './browser-sessions.js';

import { nowIso } from '@popeye/contracts';
import { z } from 'zod';
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

const MemorySearchRowSchema = z.object({
  id: z.union([z.string(), z.number()]),
  description: z.union([z.string(), z.number()]),
  confidence: z.union([z.string(), z.number()]),
  scope: z.union([z.string(), z.number()]),
  source_type: z.union([z.string(), z.number()]),
  created_at: z.union([z.string(), z.number()]),
  snippet: z.union([z.string(), z.number()]).nullable().optional(),
});

const MemoryListRowSchema = z.object({
  id: z.string(),
  description: z.string(),
  classification: z.enum(['secret', 'sensitive', 'internal', 'embeddable']),
  source_type: z.enum(['receipt', 'telegram', 'daily_summary', 'curated_memory', 'workspace_doc', 'compaction_flush']),
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
  status: z.enum(['pending', 'sending', 'sent', 'uncertain']),
  sent_telegram_message_id: z.coerce.number().int().nullable().optional(),
  sent_at: z.string().nullable().optional(),
  run_id: z.string().nullable().optional(),
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
  private tokenRotationTimer: ReturnType<typeof setInterval> | null = null;
  private vecAvailable = false;
  private readonly vecInitPromise: Promise<void>;

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

  constructor(config: AppConfig, engineOverride?: EngineAdapter) {
    const startupStart = performance.now();
    if (config.security.bindHost !== '127.0.0.1') {
      throw new Error(`Popeye requires config.security.bindHost to be 127.0.0.1, received ${config.security.bindHost}`);
    }
    this.config = config;
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
    });
    this.memoryLifecycle = new MemoryLifecycleService(this.databases, config, this.memorySearch);

    // Try loading sqlite-vec (non-blocking)
    this.vecInitPromise = loadSqliteVec(this.databases.memory, config.embeddings.dimensions).then((loaded) => {
      this.vecAvailable = loaded;
    });

    // Initialize delegate modules
    this.workspaceRegistry = new WorkspaceRegistry({ app: this.databases.app, paths: this.databases.paths });
    this.sessionService = new SessionService({ app: this.databases.app });
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
    this.startTokenRotationCheck();
    const schedulerReadyMs = Math.round(performance.now() - startupStart);
    this.startupProfile = { dbReadyMs, reconcileMs, schedulerReadyMs };
    this.events.emit('startup_profile', this.startupProfile);
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.memoryMaintenanceTimer) {
      clearInterval(this.memoryMaintenanceTimer);
      this.memoryMaintenanceTimer = null;
    }
    if (this.tokenRotationTimer) {
      clearInterval(this.tokenRotationTimer);
      this.tokenRotationTimer = null;
    }
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

  resolveIntervention(interventionId: string): InterventionRecord | null {
    return this.sessionService.resolveIntervention(interventionId);
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
  }

  async runSchedulerCycle(): Promise<void> {
    await this.processSchedulerTick();
    await this.processLeaseSweep();
  }

  async stopScheduler(): Promise<void> {
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

  searchMemories(
    query: string,
  ): Array<{
    id: string;
    description: string;
    confidence: number;
    scope: string;
    sourceType: string;
    createdAt: string;
    snippet: string;
  }> {
    const rows = z.array(MemorySearchRowSchema).parse(this.databases.memory
      .prepare(
        `SELECT m.id, m.description, m.confidence, m.scope, m.source_type, m.created_at,
                snippet(memories_fts, 2, '<b>', '</b>', '...', 32) AS snippet
         FROM memories_fts
         JOIN memories m ON m.id = memories_fts.memory_id
         WHERE memories_fts MATCH ?
         ORDER BY rank
         LIMIT 20`,
      )
      .all(query));
    return rows.map((row) => ({
      id: String(row.id),
      description: String(row.description),
      confidence: Number(row.confidence),
      scope: String(row.scope),
      sourceType: String(row.source_type),
      createdAt: String(row.created_at),
      snippet: String(row.snippet ?? ''),
    }));
  }

  async searchMemory(query: MemorySearchQuery): Promise<MemorySearchResponse> {
    return this.memorySearch.search(query);
  }

  getMemoryContent(memoryId: string): MemoryRecord | null {
    return this.memorySearch.getMemoryContent(memoryId);
  }

  getMemoryAudit(): MemoryAuditResponse {
    return this.memoryLifecycle.getMemoryAudit();
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
    return this.memorySearch.getMemoryContent(memoryId);
  }

  triggerMemoryMaintenance(): { decayed: number; archived: number; merged: number; deduped: number } {
    const decay = this.memoryLifecycle.runConfidenceDecay();
    const consolidation = this.memoryLifecycle.runConsolidation();
    return { decayed: decay.decayed, archived: decay.archived, merged: consolidation.merged, deduped: consolidation.deduped };
  }

  proposeMemoryPromotion(memoryId: string, targetPath: string) {
    return this.memoryLifecycle.proposePromotion(memoryId, targetPath);
  }

  executeMemoryPromotion(request: { memoryId: string; targetPath: string; diff: string; approved: boolean; promoted: boolean }) {
    return this.memoryLifecycle.executePromotion(request);
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
        description: 'Search Popeye memory for prior facts, receipts, and procedures before answering.',
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
                const snippet = result.snippet ? ` — ${result.snippet}` : '';
                return `${index + 1}. ${result.description} [${result.scope}/${result.sourceType}]${snippet}`;
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

    try {
      const engineRequest: EngineRunRequest = {
        prompt: fullPrompt,
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        instructionSnapshotId: instructionBundle.id,
        cwd: this.resolveTaskCwd(task),
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
      void this.awaitRunCompletion(activeRun);
      return this.getRun(run.id);
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const safeMessage = this.redactError(rawMessage) ?? rawMessage;
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
    if (event.type === 'session' && event.payload?.sessionRef) {
      this.databases.app.prepare('UPDATE runs SET engine_session_ref = ? WHERE id = ?').run(event.payload.sessionRef, runId);
    }
    if (event.type === 'compaction' && event.payload?.content) {
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
      this.emit('run_completed', receipt);
      this.cleanupActiveRun(activeRun);
      return;
    }

    if (failure === 'transient_failure') {
      this.databases.app.prepare('UPDATE runs SET state = ?, finished_at = ?, error = ? WHERE id = ?').run('failed_retryable', nowIso(), this.redactError(failure), run.id);
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

  private startMemoryMaintenance(): void {
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

export function createRuntimeService(config: AppConfig, engineOverride?: EngineAdapter): PopeyeRuntimeService {
  return new PopeyeRuntimeService(config, engineOverride);
}
