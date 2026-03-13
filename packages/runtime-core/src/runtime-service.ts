import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

import type {
  AppConfig,
  CompiledInstructionBundle,
  DaemonStateRecord,
  DaemonStatusResponse,
  IngestMessageInput,
  InterventionRecord,
  JobLeaseRecord,
  JobRecord,
  MessageIngressRecord,
  MessageIngressResponse,
  MessageRecord,
  MessageIngressDecisionCode,
  NormalizedEngineEvent,
  ReceiptRecord,
  RunEventRecord,
  RunRecord,
  SchedulerStatusResponse,
  SecurityAuditEvent,
  TaskCreateInput,
  TaskRecord,
  UsageSummary,
} from '@popeye/contracts';
import {
  CompiledInstructionBundleSchema,
  IngestMessageInputSchema,
  JobLeaseRecordSchema,
  MessageIngressRecordSchema,
  MessageIngressResponseSchema,
  MessageRecordSchema,
  ReceiptRecordSchema,
  RunEventRecordSchema,
  RunRecordSchema,
  TaskCreateInputSchema,
  TaskRecordSchema,
} from '@popeye/contracts';
import {
  createEngineAdapter,
  type EngineAdapter,
  type EngineFailureClassification,
  type EngineRunCompletion,
  type EngineRunHandle,
} from '@popeye/engine-pi';
import { compileInstructionBundle } from '@popeye/instructions';
import { decideEmbeddingEligibility } from '@popeye/memory';
import { redactText } from '@popeye/observability';
import { renderReceipt } from '@popeye/receipts';
import { calculateRetryDelaySeconds } from '@popeye/scheduler';
import { selectSessionRoot } from '@popeye/sessions';

import { readAuthStore, issueCsrfToken as issueCsrfTokenFromStore } from './auth.js';
import { openRuntimeDatabases, readReceiptArtifact, writeReceiptArtifact, type RuntimeDatabases } from './database.js';
import { scanPrompt } from './prompt.js';

function nowIso(): string {
  return new Date().toISOString();
}

function readJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function isTerminalJobStatus(status: JobRecord['status']): boolean {
  return ['succeeded', 'failed_final', 'cancelled'].includes(status);
}

function isTerminalRunState(state: RunRecord['state']): boolean {
  return ['succeeded', 'failed_retryable', 'failed_final', 'cancelled', 'abandoned'].includes(state);
}

function classifyFailureFromMessage(message: string): EngineFailureClassification {
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

function buildMessageIngressKey(input: Pick<IngestMessageInput, 'source' | 'chatId' | 'telegramMessageId'>): string | null {
  if (input.source !== 'telegram' || !input.chatId || typeof input.telegramMessageId !== 'number') {
    return null;
  }

  return `${input.source}:${input.chatId}:${input.telegramMessageId}`;
}

function readStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

function readNumberField(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === 'number' ? value : undefined;
}

function readTelegramChatTypeField(input: Record<string, unknown>, key: string): IngestMessageInput['chatType'] | undefined {
  const value = input[key];
  if (value === 'private' || value === 'group' || value === 'supergroup' || value === 'channel') {
    return value;
  }
  return undefined;
}

export interface RuntimeEvent {
  event: string;
  data: string;
}

export class MessageIngressError extends Error {
  readonly statusCode: number;
  readonly decisionCode: MessageIngressDecisionCode;
  readonly response: MessageIngressResponse;

  constructor(response: MessageIngressResponse) {
    super(response.decisionReason);
    this.name = 'MessageIngressError';
    this.statusCode = response.httpStatus;
    this.decisionCode = response.decisionCode;
    this.response = response;
  }
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

  constructor(config: AppConfig) {
    this.config = config;
    this.startedAt = nowIso();
    this.databases = openRuntimeDatabases(config);
    this.engine = createEngineAdapter(config);
    this.seedReferenceData();
    this.reconcileStartupState();
    this.seedDaemonState();
    this.startScheduler();
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.stopScheduler();
    this.databases.app.prepare('UPDATE daemon_state SET last_shutdown_at = ? WHERE id = 1').run(nowIso());
    this.databases.app.close();
    this.databases.memory.close();
  }

  async shutdown(): Promise<void> {
    await this.close();
  }

  startScheduler(): void {
    if (this.scheduler.running) return;
    this.scheduler.running = true;
    this.ensureConfiguredHeartbeatSchedules();
    this.scheduler.tickTimer = setInterval(() => void this.processSchedulerTick(), this.scheduler.tickIntervalMs);
    this.scheduler.leaseTimer = setInterval(() => void this.processLeaseSweep(), this.scheduler.leaseRefreshIntervalMs);
    void this.processSchedulerTick();
    void this.processLeaseSweep();
  }

  async waitForTaskTerminalReceipt(taskId: string, timeoutMs = 10_000): Promise<ReceiptRecord | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const receipt = this.listReceipts().find((entry) => entry.taskId === taskId);
      if (receipt) return receipt;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
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

  private emit(event: string, payload: unknown): void {
    this.events.emit('event', { event, data: JSON.stringify(payload) } satisfies RuntimeEvent);
  }

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

  private reconcileStartupState(): void {
    const reconciledAt = nowIso();
    const staleRuns = this.databases.app
      .prepare("SELECT * FROM runs WHERE state IN ('starting', 'running') AND finished_at IS NULL")
      .all() as Array<Record<string, string | null>>;

    for (const row of staleRuns) {
      const runId = String(row.id);
      this.writeAbandonedReceiptIfMissing(
        runId,
        String(row.job_id),
        String(row.task_id),
        String(row.workspace_id),
        'Run abandoned during daemon startup reconciliation',
        'Daemon restarted before the run reached a terminal state',
      );
      this.databases.app.prepare('UPDATE runs SET state = ?, finished_at = ?, error = ? WHERE id = ?').run('abandoned', reconciledAt, 'Daemon restarted before the run reached a terminal state', runId);
      void this.applyRecoveryDecision(String(row.job_id), runId, 'Daemon restarted before the run reached a terminal state');
    }

    const staleLeasedJobs = this.databases.app
      .prepare("SELECT j.id FROM jobs j LEFT JOIN job_leases l ON l.job_id = j.id WHERE j.status = 'leased' AND (l.job_id IS NULL OR l.lease_expires_at <= ?)")
      .all(reconciledAt) as Array<{ id: string }>;
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

  private getMessageIngressByKey(idempotencyKey: string): MessageIngressRecord | null {
    const row = this.databases.app.prepare('SELECT * FROM message_ingress WHERE idempotency_key = ?').get(idempotencyKey) as Record<string, string | number | null> | undefined;
    if (!row) return null;
    return MessageIngressRecordSchema.parse({
      id: String(row.id),
      source: row.source,
      senderId: row.sender_id,
      chatId: row.chat_id ? String(row.chat_id) : null,
      chatType: row.chat_type ?? null,
      telegramMessageId: typeof row.telegram_message_id === 'number' ? row.telegram_message_id : row.telegram_message_id === null ? null : Number(row.telegram_message_id),
      idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null,
      workspaceId: row.workspace_id,
      body: row.body,
      accepted: Boolean(row.accepted),
      decisionCode: row.decision_code,
      decisionReason: row.decision_reason,
      httpStatus: Number(row.http_status),
      messageId: row.message_id ? String(row.message_id) : null,
      taskId: row.task_id ? String(row.task_id) : null,
      jobId: row.job_id ? String(row.job_id) : null,
      runId: row.run_id ? String(row.run_id) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private insertMessageIngress(record: MessageIngressRecord): void {
    this.databases.app
      .prepare(`
        INSERT INTO message_ingress (
          id, source, sender_id, chat_id, chat_type, telegram_message_id, idempotency_key, workspace_id, body, accepted,
          decision_code, decision_reason, http_status, message_id, task_id, job_id, run_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.id,
        record.source,
        record.senderId,
        record.chatId,
        record.chatType,
        record.telegramMessageId,
        record.idempotencyKey,
        record.workspaceId,
        record.body,
        record.accepted ? 1 : 0,
        record.decisionCode,
        record.decisionReason,
        record.httpStatus,
        record.messageId,
        record.taskId,
        record.jobId,
        record.runId,
        record.createdAt,
        record.updatedAt,
      );
  }

  private updateMessageIngressLinks(recordId: string, updates: Pick<MessageIngressRecord, 'messageId' | 'taskId' | 'jobId' | 'runId'>): void {
    this.databases.app
      .prepare('UPDATE message_ingress SET message_id = ?, task_id = ?, job_id = ?, run_id = ?, updated_at = ? WHERE id = ?')
      .run(updates.messageId, updates.taskId, updates.jobId, updates.runId, nowIso(), recordId);
  }

  private buildIngressResponse(record: MessageIngressRecord, duplicate: boolean): MessageIngressResponse {
    return MessageIngressResponseSchema.parse({
      accepted: record.accepted,
      duplicate,
      httpStatus: record.httpStatus,
      decisionCode: duplicate && record.accepted ? 'duplicate_replayed' : record.decisionCode,
      decisionReason: duplicate ? `duplicate delivery replayed: ${record.decisionReason}` : record.decisionReason,
      message: record.messageId ? this.getMessage(record.messageId) : null,
      taskId: record.taskId,
      jobId: record.jobId,
      runId: record.runId,
    });
  }

  private persistDeniedIngress(
    input: IngestMessageInput,
    body: string,
    decisionCode: Extract<MessageIngressDecisionCode, 'telegram_disabled' | 'telegram_private_chat_required' | 'telegram_not_allowlisted' | 'telegram_rate_limited' | 'telegram_prompt_injection' | 'telegram_invalid_message'>,
    decisionReason: string,
    httpStatus: number,
  ): MessageIngressRecord {
    const timestamp = nowIso();
    const record = MessageIngressRecordSchema.parse({
      id: randomUUID(),
      source: input.source,
      senderId: input.senderId,
      chatId: input.chatId ?? null,
      chatType: input.chatType ?? null,
      telegramMessageId: input.telegramMessageId ?? null,
      idempotencyKey: buildMessageIngressKey(input),
      workspaceId: input.workspaceId,
      body,
      accepted: false,
      decisionCode,
      decisionReason,
      httpStatus,
      messageId: null,
      taskId: null,
      jobId: null,
      runId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    this.insertMessageIngress(record);
    this.recordSecurityAudit({
      code: decisionCode,
      severity: decisionCode === 'telegram_rate_limited' ? 'warn' : 'error',
      message: decisionReason,
      component: 'runtime-core',
      timestamp,
      details: {
        source: input.source,
        senderId: input.senderId,
        chatId: input.chatId ?? '',
        telegramMessageId: String(input.telegramMessageId ?? ''),
      },
    });
    return record;
  }

  private countRecentTelegramIngressAttempts(senderId: string, chatId: string): number {
    const windowStart = new Date(Date.now() - this.config.telegram.rateLimitWindowSeconds * 1000).toISOString();
    const row = this.databases.app
      .prepare(`
        SELECT COUNT(*) AS count
        FROM message_ingress
        WHERE source = 'telegram'
          AND created_at >= ?
          AND (sender_id = ? OR chat_id = ?)
      `)
      .get(windowStart, senderId, chatId) as { count: number };
    return row.count;
  }

  getStatus(): DaemonStatusResponse {
    const runningJobs = this.databases.app.prepare(`SELECT COUNT(*) AS count FROM jobs WHERE status = 'running'`).get() as { count: number };
    const queuedJobs = this.databases.app.prepare(`SELECT COUNT(*) AS count FROM jobs WHERE status = 'queued'`).get() as { count: number };
    const openInterventions = this.databases.app.prepare(`SELECT COUNT(*) AS count FROM interventions WHERE status = 'open'`).get() as { count: number };
    const activeLeases = this.databases.app.prepare('SELECT COUNT(*) AS count FROM job_leases').get() as { count: number };
    const daemonState = this.databases.app.prepare('SELECT last_shutdown_at FROM daemon_state WHERE id = 1').get() as { last_shutdown_at: string | null } | undefined;
    return {
      ok: true,
      runningJobs: runningJobs.count,
      queuedJobs: queuedJobs.count,
      openInterventions: openInterventions.count,
      activeLeases: activeLeases.count,
      engineKind: this.config.engine.kind,
      schedulerRunning: this.scheduler.running,
      startedAt: this.startedAt,
      lastShutdownAt: daemonState?.last_shutdown_at ?? null,
    };
  }

  getDaemonState(): DaemonStateRecord {
    const daemonState = this.databases.app.prepare('SELECT last_shutdown_at FROM daemon_state WHERE id = 1').get() as { last_shutdown_at: string | null } | undefined;
    return {
      schedulerRunning: this.scheduler.running,
      activeWorkers: this.activeRuns.size,
      lastSchedulerTickAt: this.scheduler.lastSchedulerTickAt,
      lastLeaseSweepAt: this.scheduler.lastLeaseSweepAt,
      lastShutdownAt: daemonState?.last_shutdown_at ?? null,
    };
  }

  getSchedulerStatus(): SchedulerStatusResponse {
    const activeLeases = this.databases.app.prepare('SELECT COUNT(*) AS count FROM job_leases').get() as { count: number };
    const nextHeartbeatDueAt = this.computeNextHeartbeatDueAt();
    return {
      running: this.scheduler.running,
      activeLeases: activeLeases.count,
      activeRuns: this.activeRuns.size,
      nextHeartbeatDueAt,
    };
  }

  listWorkspaces(): Array<{ id: string; name: string; createdAt: string }> {
    const rows = this.databases.app.prepare('SELECT * FROM workspaces ORDER BY created_at ASC').all() as Array<Record<string, string>>;
    return rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at }));
  }

  listProjects(): Array<{ id: string; workspaceId: string; name: string; createdAt: string }> {
    const rows = this.databases.app.prepare('SELECT * FROM projects ORDER BY created_at ASC').all() as Array<Record<string, string>>;
    return rows.map((row) => ({ id: row.id, workspaceId: row.workspace_id, name: row.name, createdAt: row.created_at }));
  }

  listAgentProfiles(): Array<{ id: string; name: string; createdAt: string }> {
    const rows = this.databases.app.prepare('SELECT * FROM agent_profiles ORDER BY created_at ASC').all() as Array<Record<string, string>>;
    return rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at }));
  }

  listTasks(): TaskRecord[] {
    const rows = this.databases.app.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all() as Array<Record<string, string>>;
    return rows.map((row) =>
      TaskRecordSchema.parse({
        id: row.id,
        workspaceId: row.workspace_id,
        projectId: row.project_id ?? null,
        title: row.title,
        prompt: row.prompt,
        source: row.source,
        status: row.status,
        retryPolicy: readJson(row.retry_policy_json),
        sideEffectProfile: row.side_effect_profile,
        createdAt: row.created_at,
      }),
    );
  }

  createTask(input: TaskCreateInput): { task: TaskRecord; job: JobRecord | null; run: RunRecord | null } {
    const parsed = TaskCreateInputSchema.parse(input);
    const task: TaskRecord = {
      id: randomUUID(),
      workspaceId: parsed.workspaceId,
      projectId: parsed.projectId,
      title: parsed.title,
      prompt: parsed.prompt,
      source: parsed.source,
      status: 'active',
      retryPolicy: { maxAttempts: 3, baseDelaySeconds: 5, multiplier: 2, maxDelaySeconds: 900 },
      sideEffectProfile: 'read_only',
      createdAt: nowIso(),
    };
    this.databases.app
      .prepare('INSERT INTO tasks (id, workspace_id, project_id, title, prompt, source, status, retry_policy_json, side_effect_profile, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(task.id, task.workspaceId, task.projectId, task.title, task.prompt, task.source, task.status, JSON.stringify(task.retryPolicy), task.sideEffectProfile, task.createdAt);
    this.emit('task_created', task);
    if (!parsed.autoEnqueue) return { task, job: null, run: null };
    const job = this.enqueueTask(task.id);
    return { task, job, run: null };
  }

  enqueueTask(taskId: string, options?: { availableAt?: string; retryCount?: number }): JobRecord | null {
    const task = this.databases.app.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Record<string, string> | undefined;
    if (!task) return null;
    const job: JobRecord = {
      id: randomUUID(),
      taskId,
      workspaceId: task.workspace_id,
      status: 'queued',
      retryCount: options?.retryCount ?? 0,
      availableAt: options?.availableAt ?? nowIso(),
      lastRunId: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.databases.app
      .prepare('INSERT INTO jobs (id, task_id, workspace_id, status, retry_count, available_at, last_run_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(job.id, job.taskId, job.workspaceId, job.status, job.retryCount, job.availableAt, job.lastRunId, job.createdAt, job.updatedAt);
    this.emit('job_queued', job);
    return job;
  }

  enqueueJob(jobId: string): JobRecord | null {
    this.databases.app.prepare('UPDATE jobs SET status = ?, available_at = ?, updated_at = ? WHERE id = ?').run('queued', nowIso(), nowIso(), jobId);
    return this.listJobs().find((job) => job.id === jobId) ?? null;
  }

  requeueJob(jobId: string): JobRecord | null {
    const job = this.enqueueJob(jobId);
    void this.processSchedulerTick();
    return job;
  }

  executeJob(jobId: string): JobRecord | null {
    return this.requeueJob(jobId);
  }

  listJobs(): JobRecord[] {
    const rows = this.databases.app.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all() as Array<Record<string, string | number | null>>;
    return rows.map((row) => ({
      id: String(row.id),
      taskId: String(row.task_id),
      workspaceId: String(row.workspace_id),
      status: row.status as JobRecord['status'],
      retryCount: Number(row.retry_count),
      availableAt: String(row.available_at),
      lastRunId: row.last_run_id ? String(row.last_run_id) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  }

  getJobLease(jobId: string): JobLeaseRecord | null {
    const row = this.databases.app.prepare('SELECT * FROM job_leases WHERE job_id = ?').get(jobId) as Record<string, string> | undefined;
    if (!row) return null;
    return JobLeaseRecordSchema.parse({
      jobId: row.job_id,
      leaseOwner: row.lease_owner,
      leaseExpiresAt: row.lease_expires_at,
      updatedAt: row.updated_at,
    });
  }

  pauseJob(jobId: string): JobRecord | null {
    return this.updateJobStatus(jobId, 'paused');
  }

  resumeJob(jobId: string): JobRecord | null {
    return this.updateJobStatus(jobId, 'queued');
  }

  private updateJobStatus(jobId: string, status: JobRecord['status']): JobRecord | null {
    this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ?, available_at = ? WHERE id = ?').run(status, nowIso(), nowIso(), jobId);
    return this.listJobs().find((job) => job.id === jobId) ?? null;
  }

  private async processSchedulerTick(): Promise<void> {
    if (this.closed) return;
    try {
      this.scheduler.lastSchedulerTickAt = nowIso();
      this.ensureHeartbeatJobs();
      this.databases.app.prepare("UPDATE jobs SET status = 'queued', updated_at = ? WHERE status = 'waiting_retry' AND available_at <= ?").run(nowIso(), nowIso());
      const dueJobs = this.databases.app
        .prepare("SELECT * FROM jobs WHERE status = 'queued' AND available_at <= ? ORDER BY available_at ASC, created_at ASC")
        .all(nowIso()) as Array<Record<string, string | number | null>>;

      for (const row of dueJobs) {
        const workspaceId = String(row.workspace_id);
        if (this.workspaceHasActiveExecution(workspaceId)) continue;
        await this.startJobExecution(String(row.id));
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

      const expiredLeases = this.databases.app
        .prepare('SELECT job_id FROM job_leases WHERE lease_expires_at <= ?')
        .all(nowIso()) as Array<{ job_id: string }>;
      for (const lease of expiredLeases) {
        const job = this.listJobs().find((candidate) => candidate.id === lease.job_id);
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

  private workspaceHasActiveExecution(workspaceId: string): boolean {
    const lock = this.databases.app.prepare('SELECT id FROM locks WHERE scope = ?').get(`workspace:${workspaceId}`) as { id: string } | undefined;
    if (lock) return true;
    const active = this.databases.app
      .prepare("SELECT COUNT(*) AS count FROM jobs WHERE workspace_id = ? AND status IN ('leased', 'running')")
      .get(workspaceId) as { count: number };
    return active.count > 0;
  }

  private acquireWorkspaceLock(workspaceId: string, owner: string): string | null {
    const lockId = `workspace:${workspaceId}`;
    const existing = this.databases.app.prepare('SELECT id FROM locks WHERE id = ?').get(lockId) as { id: string } | undefined;
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

  private getTask(taskId: string): TaskRecord | null {
    return this.listTasks().find((task) => task.id === taskId) ?? null;
  }

  private async startJobExecution(jobId: string): Promise<RunRecord | null> {
    const job = this.listJobs().find((candidate) => candidate.id === jobId);
    if (!job || job.status !== 'queued') return null;
    const task = this.getTask(job.taskId);
    if (!task) return null;
    const workspaceLockId = this.acquireWorkspaceLock(job.workspaceId, `popeyed:${process.pid}`);
    if (!workspaceLockId) return null;

    this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('leased', nowIso(), job.id);
    this.refreshLease(job.id, `popeyed:${process.pid}`);

    const sessionRoot = selectSessionRoot({ kind: selectSessionKind(task.source), scope: job.workspaceId });
    this.databases.app.prepare('INSERT OR IGNORE INTO session_roots (id, kind, scope, created_at) VALUES (?, ?, ?, ?)').run(sessionRoot.id, sessionRoot.kind, sessionRoot.scope, sessionRoot.createdAt);

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

    const redactedPrompt = redactText(task.prompt, this.config.security.redactionPatterns);
    for (const event of redactedPrompt.events) this.recordSecurityAudit(event);

    this.emit('run_started', run);

    try {
      const handle = await this.engine.startRun(redactedPrompt.text, {
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
      const message = error instanceof Error ? error.message : String(error);
      this.releaseWorkspaceLock(job.workspaceId);
      this.databases.app.prepare('DELETE FROM job_leases WHERE job_id = ?').run(job.id);
      this.databases.app.prepare('UPDATE runs SET state = ?, finished_at = ?, error = ? WHERE id = ?').run('failed_final', nowIso(), message, run.id);
      this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('failed_final', nowIso(), job.id);
      const receipt = this.writeReceipt({
        runId: run.id,
        jobId: job.id,
        taskId: task.id,
        workspaceId: task.workspaceId,
        status: 'failed',
        summary: 'Run failed during engine startup',
        details: message,
        usage: { provider: this.config.engine.kind, model: 'unknown', tokensIn: task.prompt.length, tokensOut: 0, estimatedCostUsd: 0 },
      });
      this.captureMemoryFromReceipt(receipt);
      this.recordSecurityAudit({ code: 'run_failed', severity: 'error', message, component: 'runtime-core', timestamp: nowIso(), details: { runId: run.id } });
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
      const receipt = this.writeReceipt({
        runId: run.id,
        jobId: run.jobId,
        taskId: run.taskId,
        workspaceId: run.workspaceId,
        status: 'succeeded',
        summary: 'Run completed successfully',
        details: JSON.stringify(this.listRunEvents(run.id)),
        usage: completion.usage,
      });
      this.captureMemoryFromReceipt(receipt);
      this.emit('run_completed', receipt);
      this.cleanupActiveRun(activeRun);
      return;
    }

    if (failure === 'cancelled') {
      this.databases.app.prepare('UPDATE runs SET state = ?, finished_at = ?, error = ? WHERE id = ?').run('cancelled', nowIso(), 'cancelled', run.id);
      this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('cancelled', nowIso(), run.jobId);
      const receipt = this.writeReceipt({
        runId: run.id,
        jobId: run.jobId,
        taskId: run.taskId,
        workspaceId: run.workspaceId,
        status: 'cancelled',
        summary: 'Run cancelled',
        details: 'Cancelled by operator or daemon shutdown',
        usage: completion.usage,
      });
      this.captureMemoryFromReceipt(receipt);
      this.cleanupActiveRun(activeRun);
      return;
    }

    if (failure === 'transient_failure') {
      this.databases.app.prepare('UPDATE runs SET state = ?, finished_at = ?, error = ? WHERE id = ?').run('failed_retryable', nowIso(), failure, run.id);
      await this.scheduleRetry(activeRun.task, run.jobId, completion, failure);
      this.cleanupActiveRun(activeRun);
      return;
    }

    this.databases.app.prepare('UPDATE runs SET state = ?, finished_at = ?, error = ?, engine_session_ref = ? WHERE id = ?').run('failed_final', nowIso(), failure, completion.engineSessionRef, run.id);
    this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('failed_final', nowIso(), run.jobId);
    const receipt = this.writeReceipt({
      runId: run.id,
      jobId: run.jobId,
      taskId: run.taskId,
      workspaceId: run.workspaceId,
      status: 'failed',
      summary: 'Run failed',
      details: failure,
      usage: completion.usage,
    });
    this.captureMemoryFromReceipt(receipt);
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

    const receipt = this.writeReceipt({
      runId: job.lastRunId ?? 'unknown',
      jobId,
      taskId: task.id,
      workspaceId: task.workspaceId,
      status: 'failed',
      summary: 'Run failed and was scheduled for retry',
      details: reason,
      usage: completion.usage,
    });
    this.captureMemoryFromReceipt(receipt);
  }

  private cleanupActiveRun(activeRun: ActiveRunContext): void {
    this.activeRuns.delete(activeRun.runId);
    this.databases.app.prepare('DELETE FROM job_leases WHERE job_id = ?').run(activeRun.jobId);
    this.releaseWorkspaceLock(activeRun.task.workspaceId);
  }

  private writeAbandonedReceiptIfMissing(runId: string, jobId: string, taskId: string, workspaceId: string, summary: string, details: string): void {
    const existingReceipt = this.databases.app.prepare('SELECT id FROM receipts WHERE run_id = ? AND status = ?').get(runId, 'abandoned') as { id: string } | undefined;
    if (existingReceipt) return;
    const receipt = this.writeReceipt({
      runId,
      jobId,
      taskId,
      workspaceId,
      status: 'abandoned',
      summary,
      details,
      usage: { provider: this.config.engine.kind, model: 'unknown', tokensIn: 0, tokensOut: 0, estimatedCostUsd: 0 },
    });
    this.captureMemoryFromReceipt(receipt);
  }

  private async abandonRun(runId: string, reason: string): Promise<void> {
    const run = this.getRun(runId);
    if (!run || isTerminalRunState(run.state)) return;
    this.writeAbandonedReceiptIfMissing(run.id, run.jobId, run.taskId, run.workspaceId, 'Run abandoned', reason);
    this.databases.app.prepare('UPDATE runs SET state = ?, finished_at = ?, error = ? WHERE id = ?').run('abandoned', nowIso(), reason, run.id);
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

  private createIntervention(code: InterventionRecord['code'], runId: string | null, reason: string): void {
    const intervention: InterventionRecord = {
      id: randomUUID(),
      code,
      runId,
      status: 'open',
      reason,
      createdAt: nowIso(),
      resolvedAt: null,
    };
    this.databases.app.prepare('INSERT INTO interventions (id, code, run_id, status, reason, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      intervention.id,
      intervention.code,
      intervention.runId,
      intervention.status,
      intervention.reason,
      intervention.createdAt,
      intervention.resolvedAt,
    );
    this.emit('intervention_created', intervention);
  }

  private ensureHeartbeatJobs(): void {
    const schedules = this.databases.app.prepare('SELECT * FROM schedules ORDER BY created_at ASC').all() as Array<Record<string, string | number>>;
    for (const schedule of schedules) {
      const task = this.getTask(String(schedule.task_id));
      if (!task || task.source !== 'heartbeat') continue;
      const existing = this.databases.app
        .prepare("SELECT COUNT(*) AS count FROM jobs WHERE task_id = ? AND status IN ('queued', 'leased', 'running', 'waiting_retry')")
        .get(task.id) as { count: number };
      if (existing.count > 0) continue;
      const latestJob = this.databases.app.prepare('SELECT created_at FROM jobs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(task.id) as { created_at: string } | undefined;
      const lastTime = latestJob?.created_at ?? String(schedule.created_at);
      const dueAt = new Date(new Date(lastTime).getTime() + Number(schedule.interval_seconds) * 1000);
      if (Date.now() >= dueAt.getTime()) {
        this.enqueueTask(task.id, { availableAt: nowIso() });
      }
    }
  }

  private computeNextHeartbeatDueAt(): string | null {
    const schedules = this.databases.app.prepare('SELECT * FROM schedules ORDER BY created_at ASC').all() as Array<Record<string, string | number>>;
    if (schedules.length === 0) return null;
    let nextDueAt: string | null = null;
    for (const schedule of schedules) {
      const latestJob = this.databases.app.prepare('SELECT created_at FROM jobs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(String(schedule.task_id)) as { created_at: string } | undefined;
      const lastTime = latestJob?.created_at ?? String(schedule.created_at);
      const dueAt = new Date(new Date(lastTime).getTime() + Number(schedule.interval_seconds) * 1000).toISOString();
      if (!nextDueAt || dueAt < nextDueAt) nextDueAt = dueAt;
    }
    return nextDueAt;
  }

  getRun(runId: string): RunRecord | null {
    const row = this.databases.app.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as Record<string, string | null> | undefined;
    if (!row) return null;
    return RunRecordSchema.parse({
      id: row.id,
      jobId: row.job_id,
      taskId: row.task_id,
      workspaceId: row.workspace_id,
      sessionRootId: row.session_root_id,
      engineSessionRef: row.engine_session_ref,
      state: row.state,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      error: row.error,
    });
  }

  listRuns(): RunRecord[] {
    const rows = this.databases.app.prepare('SELECT * FROM runs ORDER BY started_at DESC').all() as Array<Record<string, string | null>>;
    return rows.map((row) =>
      RunRecordSchema.parse({
        id: row.id,
        jobId: row.job_id,
        taskId: row.task_id,
        workspaceId: row.workspace_id,
        sessionRootId: row.session_root_id,
        engineSessionRef: row.engine_session_ref,
        state: row.state,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        error: row.error,
      }),
    );
  }

  listRunEvents(runId: string): RunEventRecord[] {
    const rows = this.databases.app.prepare('SELECT * FROM run_events WHERE run_id = ? ORDER BY created_at ASC').all(runId) as Array<Record<string, string>>;
    return rows.map((row) => RunEventRecordSchema.parse({ id: row.id, runId: row.run_id, type: row.type, payload: row.payload, createdAt: row.created_at }));
  }

  retryRun(runId: string): JobRecord | null {
    const run = this.getRun(runId);
    if (!run) return null;
    return this.enqueueTask(run.taskId);
  }

  async cancelRun(runId: string): Promise<RunRecord | null> {
    const run = this.getRun(runId);
    if (!run) return null;
    const activeRun = this.activeRuns.get(runId);
    if (activeRun) {
      await activeRun.handle.cancel();
      return this.getRun(runId);
    }
    this.databases.app.prepare('UPDATE runs SET state = ?, finished_at = ? WHERE id = ?').run('cancelled', nowIso(), runId);
    this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('cancelled', nowIso(), run.jobId);
    this.databases.app.prepare('DELETE FROM job_leases WHERE job_id = ?').run(run.jobId);
    const receipt = this.writeReceipt({
      runId,
      jobId: run.jobId,
      taskId: run.taskId,
      workspaceId: run.workspaceId,
      status: 'cancelled',
      summary: 'Run cancelled',
      details: '',
      usage: { provider: this.config.engine.kind, model: 'n/a', tokensIn: 0, tokensOut: 0, estimatedCostUsd: 0 },
    });
    this.captureMemoryFromReceipt(receipt);
    return this.getRun(runId);
  }

  async waitForJobTerminalState(jobId: string, timeoutMs = 10_000): Promise<{ job: JobRecord; run: RunRecord | null; receipt: ReceiptRecord | null } | null> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const job = this.listJobs().find((candidate) => candidate.id === jobId);
      if (job && isTerminalJobStatus(job.status)) {
        const run = job.lastRunId ? this.getRun(job.lastRunId) : null;
        const receipt = run ? this.listReceipts().find((candidate) => candidate.runId === run.id) ?? null : null;
        return { job, run, receipt };
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  }

  listReceipts(): ReceiptRecord[] {
    const rows = this.databases.app.prepare('SELECT * FROM receipts ORDER BY created_at DESC').all() as Array<Record<string, string>>;
    return rows.map((row) =>
      ReceiptRecordSchema.parse({
        id: row.id,
        runId: row.run_id,
        jobId: row.job_id,
        taskId: row.task_id,
        workspaceId: row.workspace_id,
        status: row.status,
        summary: row.summary,
        details: row.details,
        usage: readJson(row.usage_json),
        createdAt: row.created_at,
      }),
    );
  }

  getReceipt(receiptId: string): ReceiptRecord | null {
    const row = this.databases.app.prepare('SELECT * FROM receipts WHERE id = ?').get(receiptId) as Record<string, string> | undefined;
    if (!row) return null;
    return ReceiptRecordSchema.parse({
      id: row.id,
      runId: row.run_id,
      jobId: row.job_id,
      taskId: row.task_id,
      workspaceId: row.workspace_id,
      status: row.status,
      summary: row.summary,
      details: readReceiptArtifact(this.databases.paths, receiptId) ?? row.details,
      usage: readJson(row.usage_json),
      createdAt: row.created_at,
    });
  }

  private writeReceipt(input: Omit<ReceiptRecord, 'id' | 'createdAt'>): ReceiptRecord {
    const receipt = ReceiptRecordSchema.parse({ ...input, id: randomUUID(), createdAt: nowIso() });
    this.databases.app.prepare('INSERT INTO receipts (id, run_id, job_id, task_id, workspace_id, status, summary, details, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      receipt.id,
      receipt.runId,
      receipt.jobId,
      receipt.taskId,
      receipt.workspaceId,
      receipt.status,
      receipt.summary,
      receipt.details,
      JSON.stringify(receipt.usage),
      receipt.createdAt,
    );
    writeReceiptArtifact(this.databases.paths, receipt.id, JSON.stringify({ receipt, rendered: renderReceipt(receipt) }, null, 2));
    return receipt;
  }

  private captureMemoryFromReceipt(receipt: ReceiptRecord): void {
    const classification = receipt.status === 'succeeded' ? 'internal' : 'sensitive';
    const embeddable = decideEmbeddingEligibility({
      id: receipt.id,
      description: receipt.summary,
      classification,
      sourceType: 'receipt',
      content: receipt.details,
      confidence: 1,
      scope: receipt.workspaceId,
      createdAt: receipt.createdAt,
    });
    const memoryId = randomUUID();
    this.databases.memory.prepare('INSERT INTO memories (id, description, classification, source_type, content, confidence, scope, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      memoryId,
      receipt.summary,
      classification,
      'receipt',
      receipt.details,
      1,
      receipt.workspaceId,
      receipt.createdAt,
    );
    this.databases.memory.prepare('INSERT INTO memory_sources (id, memory_id, source_type, source_ref, created_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), memoryId, 'receipt', receipt.id, receipt.createdAt);
    this.databases.memory.prepare('INSERT INTO memories_fts (description, content) VALUES (?, ?)').run(receipt.summary, receipt.details);
    if (embeddable === 'allow') {
      this.databases.memory.prepare('INSERT INTO memory_embeddings (id, memory_id, embedding_json, created_at) VALUES (?, ?, ?, ?)').run(randomUUID(), memoryId, JSON.stringify([]), receipt.createdAt);
    }
  }

  getInstructionPreview(scope: string): CompiledInstructionBundle {
    const bundle = compileInstructionBundle([
      { precedence: 2, type: 'popeye_base', contentHash: 'base', content: 'Popeye base instructions' },
      { precedence: 5, type: 'workspace', contentHash: scope, content: `Scope preview for ${scope}` },
    ]);
    this.databases.app.prepare('INSERT INTO instruction_snapshots (id, scope, bundle_json, created_at) VALUES (?, ?, ?, ?)').run(bundle.id, scope, JSON.stringify(bundle), bundle.createdAt);
    return CompiledInstructionBundleSchema.parse(bundle);
  }

  listInterventions(): InterventionRecord[] {
    const rows = this.databases.app.prepare('SELECT * FROM interventions ORDER BY created_at DESC').all() as Array<Record<string, string | null>>;
    return rows.map((row) => ({
      id: String(row.id),
      code: row.code as InterventionRecord['code'],
      runId: row.run_id ? String(row.run_id) : null,
      status: row.status as InterventionRecord['status'],
      reason: String(row.reason),
      createdAt: String(row.created_at),
      resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
    }));
  }

  resolveIntervention(interventionId: string): InterventionRecord | null {
    this.databases.app.prepare('UPDATE interventions SET status = ?, resolved_at = ? WHERE id = ?').run('resolved', nowIso(), interventionId);
    return this.listInterventions().find((intervention) => intervention.id === interventionId) ?? null;
  }

  ingestMessage(input: unknown): MessageIngressResponse {
    const parsedResult = IngestMessageInputSchema.safeParse(input);
    if (!parsedResult.success) {
      const raw = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
      const source = readStringField(raw, 'source');
      const telegramCandidate = source === 'telegram';
      if (telegramCandidate) {
        const timestamp = nowIso();
        const record = MessageIngressRecordSchema.parse({
          id: randomUUID(),
          source: 'telegram',
          senderId: readStringField(raw, 'senderId') ?? 'unknown',
          chatId: readStringField(raw, 'chatId') ?? null,
          chatType: readTelegramChatTypeField(raw, 'chatType') ?? null,
          telegramMessageId: readNumberField(raw, 'telegramMessageId') ?? null,
          idempotencyKey: null,
          workspaceId: readStringField(raw, 'workspaceId') ?? 'default',
          body: readStringField(raw, 'text') ?? '',
          accepted: false,
          decisionCode: 'telegram_invalid_message',
          decisionReason: 'Telegram ingress payload failed validation',
          httpStatus: 400,
          messageId: null,
          taskId: null,
          jobId: null,
          runId: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        this.insertMessageIngress(record);
        this.recordSecurityAudit({
          code: 'telegram_invalid_message',
          severity: 'error',
          message: 'Telegram ingress payload failed validation',
          component: 'runtime-core',
          timestamp,
          details: { issues: String(parsedResult.error.issues.length) },
        });
        throw new MessageIngressError(this.buildIngressResponse(record, false));
      }
      throw parsedResult.error;
    }

    const parsed = parsedResult.data;
    const idempotencyKey = buildMessageIngressKey(parsed);

    if (idempotencyKey) {
      const existing = this.getMessageIngressByKey(idempotencyKey);
      if (existing) {
        const response = this.buildIngressResponse(existing, true);
        if (!existing.accepted) {
          throw new MessageIngressError(response);
        }
        return response;
      }
    }

    if (parsed.source === 'telegram') {
      const redacted = redactText(parsed.text, this.config.security.redactionPatterns);
      for (const event of redacted.events) this.recordSecurityAudit(event);

      if (!this.config.telegram.enabled) {
        const denied = this.persistDeniedIngress(parsed, redacted.text, 'telegram_disabled', 'Telegram ingress is disabled', 403);
        throw new MessageIngressError(this.buildIngressResponse(denied, false));
      }

      if (parsed.chatType !== 'private') {
        const denied = this.persistDeniedIngress(parsed, redacted.text, 'telegram_private_chat_required', 'Telegram ingress requires a private chat', 403);
        throw new MessageIngressError(this.buildIngressResponse(denied, false));
      }

      if (!this.config.telegram.allowedUserId || parsed.senderId !== this.config.telegram.allowedUserId) {
        const denied = this.persistDeniedIngress(parsed, redacted.text, 'telegram_not_allowlisted', 'Telegram sender is not allowlisted', 403);
        throw new MessageIngressError(this.buildIngressResponse(denied, false));
      }

      if (this.countRecentTelegramIngressAttempts(parsed.senderId, parsed.chatId) >= this.config.telegram.maxMessagesPerMinute) {
        const denied = this.persistDeniedIngress(parsed, redacted.text, 'telegram_rate_limited', 'Telegram rate limit exceeded', 429);
        throw new MessageIngressError(this.buildIngressResponse(denied, false));
      }

      const promptScan = scanPrompt(redacted.text);
      const redactedPrompt = redactText(promptScan.sanitizedText, this.config.security.redactionPatterns);
      for (const event of redactedPrompt.events) this.recordSecurityAudit(event);

      if (promptScan.verdict === 'quarantine') {
        const denied = this.persistDeniedIngress(parsed, redactedPrompt.text, 'telegram_prompt_injection', 'Telegram message was quarantined by prompt-injection detection', 400);
        this.createIntervention('prompt_injection_quarantined', null, `Prompt scan blocked telegram message ${denied.id}`);
        throw new MessageIngressError(this.buildIngressResponse(denied, false));
      }

      const timestamp = nowIso();
      const message: MessageRecord = MessageRecordSchema.parse({
        id: randomUUID(),
        source: parsed.source,
        senderId: parsed.senderId,
        body: redactedPrompt.text,
        accepted: true,
        relatedRunId: null,
        createdAt: timestamp,
      });
      this.databases.app.prepare('INSERT INTO messages (id, source, sender_id, body, accepted, related_run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        message.id,
        message.source,
        message.senderId,
        message.body,
        1,
        message.relatedRunId,
        message.createdAt,
      );

      const ingressRecord = MessageIngressRecordSchema.parse({
        id: randomUUID(),
        source: parsed.source,
        senderId: parsed.senderId,
        chatId: parsed.chatId,
        chatType: parsed.chatType,
        telegramMessageId: parsed.telegramMessageId,
        idempotencyKey,
        workspaceId: parsed.workspaceId,
        body: message.body,
        accepted: true,
        decisionCode: 'accepted',
        decisionReason: promptScan.verdict === 'sanitize' ? 'Telegram message accepted after sanitization' : 'Telegram message accepted',
        httpStatus: 200,
        messageId: message.id,
        taskId: null,
        jobId: null,
        runId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      this.insertMessageIngress(ingressRecord);

      const created = this.createTask({
        workspaceId: parsed.workspaceId,
        projectId: null,
        title: `message:${message.id}`,
        prompt: message.body,
        source: 'telegram',
        autoEnqueue: true,
      });
      this.updateMessageIngressLinks(ingressRecord.id, {
        messageId: message.id,
        taskId: created.task.id,
        jobId: created.job?.id ?? null,
        runId: created.run?.id ?? null,
      });

      return MessageIngressResponseSchema.parse({
        accepted: true,
        duplicate: false,
        httpStatus: 200,
        decisionCode: 'accepted',
        decisionReason: ingressRecord.decisionReason,
        message,
        taskId: created.task.id,
        jobId: created.job?.id ?? null,
        runId: created.run?.id ?? null,
      });
    }

    const promptScan = scanPrompt(parsed.text);
    const redacted = redactText(promptScan.sanitizedText, this.config.security.redactionPatterns);
    for (const event of redacted.events) this.recordSecurityAudit(event);
    if (promptScan.verdict === 'quarantine') {
      this.createIntervention('prompt_injection_quarantined', null, 'Prompt scan blocked a non-telegram message');
      throw new MessageIngressError(
        MessageIngressResponseSchema.parse({
          accepted: false,
          duplicate: false,
          httpStatus: 400,
          decisionCode: 'telegram_invalid_message',
          decisionReason: 'Message was quarantined by prompt-injection detection',
          message: null,
          taskId: null,
          jobId: null,
          runId: null,
        }),
      );
    }

    const message: MessageRecord = MessageRecordSchema.parse({
      id: randomUUID(),
      source: parsed.source,
      senderId: parsed.senderId,
      body: redacted.text,
      accepted: true,
      relatedRunId: null,
      createdAt: nowIso(),
    });
    this.databases.app.prepare('INSERT INTO messages (id, source, sender_id, body, accepted, related_run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      message.id,
      message.source,
      message.senderId,
      message.body,
      1,
      message.relatedRunId,
      message.createdAt,
    );
    const created = this.createTask({ workspaceId: parsed.workspaceId, projectId: null, title: `message:${message.id}`, prompt: message.body, source: parsed.source === 'manual' ? 'manual' : 'api', autoEnqueue: true });
    return MessageIngressResponseSchema.parse({
      accepted: true,
      duplicate: false,
      httpStatus: 200,
      decisionCode: 'accepted',
      decisionReason: 'Message accepted',
      message,
      taskId: created.task.id,
      jobId: created.job?.id ?? null,
      runId: created.run?.id ?? null,
    });
  }

  getMessage(messageId: string): MessageRecord | null {
    const row = this.databases.app.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as Record<string, string | number | null> | undefined;
    if (!row) return null;
    return MessageRecordSchema.parse({
      id: row.id,
      source: row.source,
      senderId: row.sender_id,
      body: row.body,
      accepted: Boolean(row.accepted),
      relatedRunId: row.related_run_id,
      createdAt: row.created_at,
    });
  }

  getUsageSummary(): UsageSummary {
    const receipts = this.listReceipts();
    return {
      runs: receipts.length,
      tokensIn: receipts.reduce((sum, receipt) => sum + receipt.usage.tokensIn, 0),
      tokensOut: receipts.reduce((sum, receipt) => sum + receipt.usage.tokensOut, 0),
      estimatedCostUsd: receipts.reduce((sum, receipt) => sum + receipt.usage.estimatedCostUsd, 0),
    };
  }

  getSecurityAuditFindings(): Array<{ code: string; severity: string; message: string }> {
    return this.databases.app.prepare('SELECT code, severity, message FROM security_audit ORDER BY timestamp DESC').all() as Array<{ code: string; severity: string; message: string }>;
  }

  issueCsrfToken(): string {
    return issueCsrfTokenFromStore(readAuthStore(this.config.authFile));
  }
}

export function createRuntimeService(config: AppConfig): PopeyeRuntimeService {
  return new PopeyeRuntimeService(config);
}
