import type Database from 'better-sqlite3';
import { z } from 'zod';

import type {
  AuthRole,
  AutomationDetail,
  AutomationRecord,
  AutomationRecentRun,
  AutomationUpdateInput,
  JobRecord,
  MutationReceiptKind,
  MutationReceiptRecord,
  MutationReceiptStatus,
  SecurityAuditEvent,
} from '@popeye/contracts';
import {
  AutomationDetailSchema,
  AutomationRecordSchema,
  AutomationRecentRunSchema,
  nowIso,
} from '@popeye/contracts';

import { RuntimeConflictError, RuntimeValidationError } from './errors.js';

const AutomationTaskRowSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  title: z.string(),
  source: z.enum(['heartbeat', 'schedule']),
  status: z.enum(['active', 'paused']),
});

const ScheduleRowSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  interval_seconds: z.coerce.number().int().positive(),
  created_at: z.string(),
});

const JobRowSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  workspace_id: z.string(),
  status: z.string(),
  retry_count: z.coerce.number().int().nonnegative(),
  available_at: z.string(),
  last_run_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const RunRowSchema = z.object({
  id: z.string(),
  job_id: z.string(),
  task_id: z.string(),
  workspace_id: z.string(),
  state: z.string(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  error: z.string().nullable(),
});

const CountRowSchema = z.object({
  count: z.coerce.number().int().nonnegative(),
});

const TimestampRowSchema = z.object({
  timestamp: z.string().nullable(),
});

const IdRowSchema = z.object({
  id: z.string().nullable(),
});

interface AutomationServiceOptions {
  db: Database.Database;
  schedulerRunning: () => boolean;
  enqueueTask: (taskId: string, options?: { availableAt?: string; retryCount?: number }) => JobRecord | null;
  processSchedulerTick: () => Promise<void>;
  getHeartbeatConfig: (workspaceId: string) => { enabled: boolean; intervalSeconds: number } | null;
  persistHeartbeatConfig: (
    workspaceId: string,
    input: { enabled?: boolean; intervalSeconds?: number },
  ) => Promise<{ enabled: boolean; intervalSeconds: number } | null>;
  writeMutationReceipt: (input: {
    kind: MutationReceiptKind;
    component: string;
    status: MutationReceiptStatus;
    summary: string;
    details: string;
    actorRole: AuthRole;
    workspaceId?: string | null;
    metadata?: Record<string, string>;
  }) => MutationReceiptRecord;
  recordSecurityAudit: (event: SecurityAuditEvent) => void;
}

export class AutomationService {
  private readonly db: Database.Database;
  private readonly schedulerRunning: AutomationServiceOptions['schedulerRunning'];
  private readonly enqueueTask: AutomationServiceOptions['enqueueTask'];
  private readonly processSchedulerTick: AutomationServiceOptions['processSchedulerTick'];
  private readonly getHeartbeatConfig: AutomationServiceOptions['getHeartbeatConfig'];
  private readonly persistHeartbeatConfig: AutomationServiceOptions['persistHeartbeatConfig'];
  private readonly writeMutationReceipt: AutomationServiceOptions['writeMutationReceipt'];
  private readonly recordSecurityAudit: AutomationServiceOptions['recordSecurityAudit'];

  constructor(options: AutomationServiceOptions) {
    this.db = options.db;
    this.schedulerRunning = options.schedulerRunning;
    this.enqueueTask = options.enqueueTask;
    this.processSchedulerTick = options.processSchedulerTick;
    this.getHeartbeatConfig = options.getHeartbeatConfig;
    this.persistHeartbeatConfig = options.persistHeartbeatConfig;
    this.writeMutationReceipt = options.writeMutationReceipt;
    this.recordSecurityAudit = options.recordSecurityAudit;
  }

  listAutomations(filter?: { workspaceId?: string | null }): AutomationRecord[] {
    const rows = filter?.workspaceId
      ? this.db.prepare(
          `SELECT id, workspace_id, title, source, status
           FROM tasks
           WHERE source IN ('heartbeat', 'schedule') AND workspace_id = ?
           ORDER BY workspace_id ASC, created_at ASC`,
        ).all(filter.workspaceId)
      : this.db.prepare(
          `SELECT id, workspace_id, title, source, status
           FROM tasks
           WHERE source IN ('heartbeat', 'schedule')
           ORDER BY workspace_id ASC, created_at ASC`,
        ).all();

    return z.array(AutomationTaskRowSchema)
      .parse(rows)
      .map((row) => this.buildAutomationRecord(row));
  }

  getAutomation(id: string): AutomationDetail | null {
    const task = this.getAutomationTask(id);
    if (!task) return null;
    const record = this.buildAutomationRecord(task);
    return AutomationDetailSchema.parse({
      ...record,
      recentRuns: this.listRecentRuns(id),
    });
  }

  async runNow(id: string, actorRole: AuthRole = 'operator'): Promise<AutomationDetail | null> {
    const task = this.requireAutomationTask(id);
    if (task.status !== 'active') {
      throw new RuntimeValidationError(`Automation ${id} is paused and cannot run until resumed.`);
    }
    const activeJobs = this.countJobs(id, ['queued', 'leased', 'running', 'waiting_retry']);
    if (activeJobs > 0) {
      throw new RuntimeConflictError(`Automation ${id} already has an in-flight job.`);
    }

    const job = this.enqueueTask(id, { availableAt: nowIso() });
    if (!job) {
      throw new RuntimeValidationError(`Automation ${id} could not be enqueued.`);
    }
    await this.processSchedulerTick();
    this.writeMutationReceipt({
      kind: 'automation_run_now',
      component: 'automation',
      status: 'scheduled',
      summary: `Scheduled automation run for ${task.title}`,
      details: `Run-now queued task ${task.id} in workspace ${task.workspace_id}.`,
      actorRole,
      workspaceId: task.workspace_id,
      metadata: {
        automationId: task.id,
        source: task.source,
        jobId: job.id,
      },
    });
    this.recordSecurityAudit({
      code: 'automation_run_now_scheduled',
      severity: 'info',
      message: `Automation ${task.id} scheduled to run now`,
      component: 'automation-service',
      timestamp: nowIso(),
      details: {
        automationId: task.id,
        workspaceId: task.workspace_id,
        source: task.source,
        jobId: job.id,
      },
    });
    return this.getAutomation(id);
  }

  async pause(id: string, actorRole: AuthRole = 'operator'): Promise<AutomationDetail | null> {
    const task = this.requireAutomationTask(id);
    if (task.status === 'paused') {
      return this.getAutomation(id);
    }

    this.db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('paused', id);
    this.db.prepare(
      `UPDATE jobs
       SET status = 'paused', updated_at = ?, available_at = ?
       WHERE task_id = ? AND status IN ('queued', 'waiting_retry', 'blocked_operator')`,
    ).run(nowIso(), nowIso(), id);

    this.writeMutationReceipt({
      kind: 'automation_pause',
      component: 'automation',
      status: 'succeeded',
      summary: `Paused automation ${task.title}`,
      details: `Paused task ${task.id} in workspace ${task.workspace_id}.`,
      actorRole,
      workspaceId: task.workspace_id,
      metadata: { automationId: task.id, source: task.source },
    });
    this.recordSecurityAudit({
      code: 'automation_paused',
      severity: 'info',
      message: `Paused automation ${task.id}`,
      component: 'automation-service',
      timestamp: nowIso(),
      details: { automationId: task.id, workspaceId: task.workspace_id, source: task.source },
    });

    return this.getAutomation(id);
  }

  async resume(id: string, actorRole: AuthRole = 'operator'): Promise<AutomationDetail | null> {
    const task = this.requireAutomationTask(id);
    if (task.status === 'active') {
      return this.getAutomation(id);
    }

    this.db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('active', id);
    this.db.prepare(
      `UPDATE jobs
       SET status = 'queued', updated_at = ?, available_at = ?
       WHERE task_id = ? AND status = 'paused'`,
    ).run(nowIso(), nowIso(), id);
    await this.processSchedulerTick();

    this.writeMutationReceipt({
      kind: 'automation_resume',
      component: 'automation',
      status: 'succeeded',
      summary: `Resumed automation ${task.title}`,
      details: `Resumed task ${task.id} in workspace ${task.workspace_id}.`,
      actorRole,
      workspaceId: task.workspace_id,
      metadata: { automationId: task.id, source: task.source },
    });
    this.recordSecurityAudit({
      code: 'automation_resumed',
      severity: 'info',
      message: `Resumed automation ${task.id}`,
      component: 'automation-service',
      timestamp: nowIso(),
      details: { automationId: task.id, workspaceId: task.workspace_id, source: task.source },
    });

    return this.getAutomation(id);
  }

  async update(id: string, input: AutomationUpdateInput, actorRole: AuthRole = 'operator'): Promise<AutomationDetail | null> {
    const task = this.requireAutomationTask(id);
    const schedule = this.getSchedule(task.id);
    const changedFields: string[] = [];
    let resolvedIntervalSeconds: number | null = schedule?.interval_seconds ?? null;

    if (task.source === 'heartbeat') {
      const heartbeat = this.getHeartbeatConfig(task.workspace_id);
      if (!heartbeat) {
        throw new RuntimeValidationError(`Heartbeat config was not found for workspace ${task.workspace_id}.`);
      }

      const nextHeartbeat = {
        enabled: input.enabled ?? heartbeat.enabled,
        intervalSeconds: input.intervalSeconds ?? heartbeat.intervalSeconds,
      };

      if (input.intervalSeconds !== undefined && nextHeartbeat.intervalSeconds !== heartbeat.intervalSeconds) {
        changedFields.push('intervalSeconds');
      }
      if (input.enabled !== undefined && nextHeartbeat.enabled !== heartbeat.enabled) {
        changedFields.push('enabled');
      }

      if (changedFields.length > 0) {
        await this.persistHeartbeatConfig(task.workspace_id, nextHeartbeat);
        resolvedIntervalSeconds = nextHeartbeat.intervalSeconds;
      } else {
        resolvedIntervalSeconds = heartbeat.intervalSeconds;
      }

      if (changedFields.includes('enabled')) {
        this.db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(nextHeartbeat.enabled ? 'active' : 'paused', id);
        if (nextHeartbeat.enabled) {
          this.db.prepare(
            `UPDATE jobs
             SET status = 'queued', updated_at = ?, available_at = ?
             WHERE task_id = ? AND status = 'paused'`,
          ).run(nowIso(), nowIso(), id);
        } else {
          this.db.prepare(
            `UPDATE jobs
             SET status = 'paused', updated_at = ?, available_at = ?
             WHERE task_id = ? AND status IN ('queued', 'waiting_retry', 'blocked_operator')`,
          ).run(nowIso(), nowIso(), id);
        }
      }

      if (nextHeartbeat.enabled) {
        this.upsertSchedule(this.heartbeatScheduleId(task.id), task.id, nextHeartbeat.intervalSeconds);
      } else {
        this.db.prepare('DELETE FROM schedules WHERE task_id = ?').run(task.id);
      }

      if (nextHeartbeat.enabled && changedFields.length > 0) {
        await this.processSchedulerTick();
      }
    } else {
      if (input.intervalSeconds !== undefined) {
        if (schedule === null) {
          throw new RuntimeValidationError('Cadence editing is only supported for interval-backed scheduled automations.');
        }
        if (schedule.interval_seconds !== input.intervalSeconds) {
          this.db.prepare('UPDATE schedules SET interval_seconds = ? WHERE id = ?').run(input.intervalSeconds, schedule.id);
          changedFields.push('intervalSeconds');
          resolvedIntervalSeconds = input.intervalSeconds;
        }
      }

      if (input.enabled !== undefined) {
        const nextStatus = input.enabled ? 'active' : 'paused';
        if (task.status !== nextStatus) {
          this.db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(nextStatus, id);
          if (input.enabled) {
            this.db.prepare(
              `UPDATE jobs
               SET status = 'queued', updated_at = ?, available_at = ?
               WHERE task_id = ? AND status = 'paused'`,
            ).run(nowIso(), nowIso(), id);
            await this.processSchedulerTick();
          } else {
            this.db.prepare(
              `UPDATE jobs
               SET status = 'paused', updated_at = ?, available_at = ?
               WHERE task_id = ? AND status IN ('queued', 'waiting_retry', 'blocked_operator')`,
            ).run(nowIso(), nowIso(), id);
          }
          changedFields.push('enabled');
        }
      }
    }

    if (changedFields.length > 0) {
      const refreshed = this.requireAutomationTask(id);
      const detail = this.getAutomation(id);
      this.writeMutationReceipt({
        kind: 'automation_update',
        component: 'automation',
        status: 'succeeded',
        summary: `Updated automation ${task.title}`,
        details: this.describeUpdate(task, refreshed, changedFields, resolvedIntervalSeconds),
        actorRole,
        workspaceId: task.workspace_id,
        metadata: {
          automationId: task.id,
          source: task.source,
          changedFields: changedFields.join(','),
          enabled: String(refreshed.status === 'active'),
          ...(resolvedIntervalSeconds ? { intervalSeconds: String(resolvedIntervalSeconds) } : {}),
        },
      });
      this.recordSecurityAudit({
        code: 'automation_updated',
        severity: 'info',
        message: `Updated automation ${task.id}`,
        component: 'automation-service',
        timestamp: nowIso(),
        details: {
          automationId: task.id,
          workspaceId: task.workspace_id,
          source: task.source,
          changedFields: changedFields.join(','),
          enabled: String(refreshed.status === 'active'),
          ...(resolvedIntervalSeconds ? { intervalSeconds: String(resolvedIntervalSeconds) } : {}),
        },
      });
      return detail;
    }

    return this.getAutomation(id);
  }

  private requireAutomationTask(id: string): z.infer<typeof AutomationTaskRowSchema> {
    const task = this.getAutomationTask(id);
    if (!task) {
      throw new RuntimeValidationError(`Automation ${id} was not found.`);
    }
    return task;
  }

  private getAutomationTask(id: string): z.infer<typeof AutomationTaskRowSchema> | null {
    const row = this.db.prepare(
      `SELECT id, workspace_id, title, source, status
       FROM tasks
       WHERE id = ? AND source IN ('heartbeat', 'schedule')`,
    ).get(id);
    const parsed = AutomationTaskRowSchema.safeParse(row);
    return parsed.success ? parsed.data : null;
  }

  private buildAutomationRecord(task: z.infer<typeof AutomationTaskRowSchema>): AutomationRecord {
    const schedule = this.getSchedule(task.id);
    const heartbeatConfig = task.source === 'heartbeat' ? this.getHeartbeatConfig(task.workspace_id) : null;
    const intervalSeconds = schedule?.interval_seconds ?? heartbeatConfig?.intervalSeconds ?? null;
    const latestJob = this.getLatestJob(task.id);
    const latestRun = this.getLatestRun(task.id);
    const lastSuccessAt = this.getLatestRunTimestamp(task.id, ['succeeded']);
    const lastFailureAt = this.getLatestRunTimestamp(task.id, ['failed_retryable', 'failed_final', 'abandoned']);
    const openInterventionCount = this.countOpenInterventions(task.id);
    const pendingApprovalCount = this.countPendingApprovals(task.id);
    const lastRunAt = latestRun?.finished_at ?? latestRun?.started_at ?? null;
    const attentionReason = this.buildAttentionReason(
      task,
      latestJob?.status ?? null,
      latestRun?.state ?? null,
      openInterventionCount,
      pendingApprovalCount,
    );

    return AutomationRecordSchema.parse({
      id: task.id,
      workspaceId: task.workspace_id,
      taskId: task.id,
      source: task.source,
      title: task.title,
      taskStatus: task.status,
      jobId: latestJob?.id ?? null,
      jobStatus: latestJob?.status ?? null,
      status: this.buildStatus(task, latestJob?.status ?? null, latestRun?.state ?? null, openInterventionCount, pendingApprovalCount),
      enabled: task.status === 'active',
      scheduleSummary: this.formatScheduleSummary(task.source, intervalSeconds),
      intervalSeconds,
      lastRunAt,
      lastSuccessAt,
      lastFailureAt,
      nextExpectedAt: this.computeNextExpectedAt(task, schedule, latestJob),
      blockedReason: attentionReason,
      attentionReason,
      openInterventionCount,
      pendingApprovalCount,
      controls: {
        runNow: task.status === 'active',
        pause: task.status === 'active',
        resume: task.status === 'paused',
        enabledEdit: true,
        cadenceEdit: task.source === 'heartbeat' ? heartbeatConfig !== null : schedule !== null,
      },
    });
  }

  private listRecentRuns(taskId: string): AutomationRecentRun[] {
    const runs = z.array(RunRowSchema).parse(
      this.db.prepare(
        `SELECT id, job_id, task_id, workspace_id, state, started_at, finished_at, error
         FROM runs
         WHERE task_id = ?
         ORDER BY started_at DESC
         LIMIT 5`,
      ).all(taskId),
    );

    return runs.map((run) =>
      AutomationRecentRunSchema.parse({
        id: run.id,
        jobId: run.job_id,
        state: run.state,
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        error: run.error,
        receiptId: this.getReceiptId(run.id),
        pendingApprovalCount: this.countPendingApprovalsForRun(run.id),
        openInterventionCount: this.countOpenInterventionsForRun(run.id),
      }),
    );
  }

  private getSchedule(taskId: string): z.infer<typeof ScheduleRowSchema> | null {
    const row = this.db.prepare('SELECT id, task_id, interval_seconds, created_at FROM schedules WHERE task_id = ? LIMIT 1').get(taskId);
    const parsed = ScheduleRowSchema.safeParse(row);
    return parsed.success ? parsed.data : null;
  }

  private getLatestJob(taskId: string): z.infer<typeof JobRowSchema> | null {
    const row = this.db.prepare(
      `SELECT id, task_id, workspace_id, status, retry_count, available_at, last_run_id, created_at, updated_at
       FROM jobs
       WHERE task_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    ).get(taskId);
    const parsed = JobRowSchema.safeParse(row);
    return parsed.success ? parsed.data : null;
  }

  private getLatestRun(taskId: string): z.infer<typeof RunRowSchema> | null {
    const row = this.db.prepare(
      `SELECT id, job_id, task_id, workspace_id, state, started_at, finished_at, error
       FROM runs
       WHERE task_id = ?
       ORDER BY started_at DESC
       LIMIT 1`,
    ).get(taskId);
    const parsed = RunRowSchema.safeParse(row);
    return parsed.success ? parsed.data : null;
  }

  private getLatestRunTimestamp(taskId: string, states: string[]): string | null {
    const placeholders = states.map(() => '?').join(', ');
    const row = this.db.prepare(
      `SELECT COALESCE(finished_at, started_at) AS timestamp
       FROM runs
       WHERE task_id = ? AND state IN (${placeholders})
       ORDER BY COALESCE(finished_at, started_at) DESC
       LIMIT 1`,
    ).get(taskId, ...states);
    const parsed = TimestampRowSchema.safeParse(row);
    return parsed.success ? parsed.data.timestamp : null;
  }

  private getReceiptId(runId: string): string | null {
    const row = this.db.prepare('SELECT id FROM receipts WHERE run_id = ? LIMIT 1').get(runId);
    const parsed = IdRowSchema.safeParse(row);
    return parsed.success ? parsed.data.id : null;
  }

  private countOpenInterventions(taskId: string): number {
    return CountRowSchema.parse(
      this.db.prepare(
        `SELECT COUNT(*) AS count
         FROM interventions i
         JOIN runs r ON r.id = i.run_id
         WHERE r.task_id = ? AND i.status = 'open'`,
      ).get(taskId),
    ).count;
  }

  private countPendingApprovals(taskId: string): number {
    return CountRowSchema.parse(
      this.db.prepare(
        `SELECT COUNT(*) AS count
         FROM approvals a
         JOIN runs r ON r.id = a.run_id
         WHERE r.task_id = ? AND a.status = 'pending'`,
      ).get(taskId),
    ).count;
  }

  private countOpenInterventionsForRun(runId: string): number {
    return CountRowSchema.parse(
      this.db.prepare(
        `SELECT COUNT(*) AS count
         FROM interventions
         WHERE run_id = ? AND status = 'open'`,
      ).get(runId),
    ).count;
  }

  private countPendingApprovalsForRun(runId: string): number {
    return CountRowSchema.parse(
      this.db.prepare(
        `SELECT COUNT(*) AS count
         FROM approvals
         WHERE run_id = ? AND status = 'pending'`,
      ).get(runId),
    ).count;
  }

  private countJobs(taskId: string, statuses: string[]): number {
    const placeholders = statuses.map(() => '?').join(', ');
    return CountRowSchema.parse(
      this.db.prepare(
        `SELECT COUNT(*) AS count
         FROM jobs
         WHERE task_id = ? AND status IN (${placeholders})`,
      ).get(taskId, ...statuses),
    ).count;
  }

  private buildStatus(
    task: z.infer<typeof AutomationTaskRowSchema>,
    jobStatus: string | null,
    runState: string | null,
    openInterventionCount: number,
    pendingApprovalCount: number,
  ): AutomationRecord['status'] {
    if (task.status === 'paused') return 'paused';
    if (openInterventionCount > 0 || pendingApprovalCount > 0) return 'attention';
    if (jobStatus === 'blocked_operator' || jobStatus === 'waiting_retry') return 'attention';
    if (runState === 'failed_final' || runState === 'abandoned') return 'attention';
    if (jobStatus === 'running' || jobStatus === 'leased' || jobStatus === 'queued') return 'running';
    if (runState === null) return 'idle';
    return 'healthy';
  }

  private buildAttentionReason(
    task: z.infer<typeof AutomationTaskRowSchema>,
    jobStatus: string | null,
    runState: string | null,
    openInterventionCount: number,
    pendingApprovalCount: number,
  ): string | null {
    if (task.status === 'paused') {
      return 'This automation is paused.';
    }
    if (!this.schedulerRunning()) {
      return 'Scheduler is not running, so recurring work will not start.';
    }
    if (openInterventionCount > 0) {
      return openInterventionCount === 1
        ? 'An open intervention is blocking this automation.'
        : `${openInterventionCount} open interventions are blocking this automation.`;
    }
    if (pendingApprovalCount > 0) {
      return pendingApprovalCount === 1
        ? 'A pending approval is blocking completion.'
        : `${pendingApprovalCount} pending approvals are blocking completion.`;
    }
    if (jobStatus === 'blocked_operator') {
      return 'The current job is blocked and waiting for operator action.';
    }
    if (jobStatus === 'waiting_retry') {
      return 'The current job is waiting for its retry window.';
    }
    if (runState === 'failed_final' || runState === 'abandoned') {
      return 'The last run failed and needs attention.';
    }
    return null;
  }

  private computeNextExpectedAt(
    task: z.infer<typeof AutomationTaskRowSchema>,
    schedule: z.infer<typeof ScheduleRowSchema> | null,
    latestJob: z.infer<typeof JobRowSchema> | null,
  ): string | null {
    if (task.status !== 'active' || schedule === null) {
      return null;
    }
    const baseTimestamp = latestJob?.created_at ?? schedule.created_at;
    const parsedBase = new Date(baseTimestamp);
    if (Number.isNaN(parsedBase.getTime())) {
      return null;
    }
    return new Date(parsedBase.getTime() + (schedule.interval_seconds * 1000)).toISOString();
  }

  private formatScheduleSummary(source: 'heartbeat' | 'schedule', intervalSeconds: number | null): string {
    if (intervalSeconds === null) {
      return source === 'heartbeat' ? 'Heartbeat automation' : 'Scheduled automation';
    }
    const formatted = describeInterval(intervalSeconds);
    return source === 'heartbeat' ? `Heartbeat every ${formatted}` : `Every ${formatted}`;
  }

  private describeUpdate(
    previousTask: z.infer<typeof AutomationTaskRowSchema>,
    nextTask: z.infer<typeof AutomationTaskRowSchema>,
    changedFields: string[],
    intervalSeconds: number | null,
  ): string {
    const updates: string[] = [];
    if (changedFields.includes('enabled')) {
      updates.push(`enabled ${previousTask.status === 'active' ? 'true' : 'false'} → ${nextTask.status === 'active' ? 'true' : 'false'}`);
    }
    if (changedFields.includes('intervalSeconds') && intervalSeconds !== null) {
      updates.push(`cadence → ${describeInterval(intervalSeconds)}`);
    }
    return `Updated task ${previousTask.id} in workspace ${previousTask.workspace_id}: ${updates.join('; ')}.`;
  }

  private heartbeatScheduleId(taskId: string): string {
    return taskId.replace(/^task:/, 'schedule:');
  }

  private upsertSchedule(id: string, taskId: string, intervalSeconds: number): void {
    const existing = this.getSchedule(taskId);
    if (existing) {
      this.db.prepare('UPDATE schedules SET interval_seconds = ? WHERE id = ?').run(intervalSeconds, existing.id);
      return;
    }

    this.db.prepare(
      'INSERT INTO schedules (id, task_id, interval_seconds, created_at) VALUES (?, ?, ?, ?)',
    ).run(id, taskId, intervalSeconds, nowIso());
  }
}

function describeInterval(seconds: number): string {
  if (seconds % 86_400 === 0) {
    const days = seconds / 86_400;
    return days === 1 ? 'day' : `${days} days`;
  }
  if (seconds % 3_600 === 0) {
    const hours = seconds / 3_600;
    return hours === 1 ? 'hour' : `${hours} hours`;
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return minutes === 1 ? 'minute' : `${minutes} minutes`;
  }
  return seconds === 1 ? 'second' : `${seconds} seconds`;
}
