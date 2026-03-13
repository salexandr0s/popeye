import { randomUUID } from 'node:crypto';

import type {
  JobLeaseRecord,
  JobRecord,
  TaskCreateInput,
  TaskRecord,
} from '@popeye/contracts';
import {
  JobLeaseRecordSchema,
  TaskCreateInputSchema,
  TaskRecordSchema,
} from '@popeye/contracts';

import type { RuntimeDatabases } from './database.js';
import { nowIso } from './clock.js';

function readJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

export interface TaskManagerCallbacks {
  emit(event: string, payload: unknown): void;
  processSchedulerTick(): Promise<void>;
}

export class TaskManager {
  constructor(
    private readonly databases: RuntimeDatabases,
    private readonly callbacks: TaskManagerCallbacks,
  ) {}

  createTask(input: TaskCreateInput): { task: TaskRecord; job: JobRecord | null; run: null } {
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
      coalesceKey: parsed.coalesceKey ?? null,
      createdAt: nowIso(),
    };
    this.databases.app
      .prepare('INSERT INTO tasks (id, workspace_id, project_id, title, prompt, source, status, retry_policy_json, side_effect_profile, coalesce_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(task.id, task.workspaceId, task.projectId, task.title, task.prompt, task.source, task.status, JSON.stringify(task.retryPolicy), task.sideEffectProfile, task.coalesceKey, task.createdAt);
    this.callbacks.emit('task_created', task);
    if (!parsed.autoEnqueue) return { task, job: null, run: null };
    const job = this.enqueueTask(task.id);
    return { task, job, run: null };
  }

  enqueueTask(taskId: string, options?: { availableAt?: string; retryCount?: number }): JobRecord | null {
    const task = this.databases.app.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Record<string, string> | undefined;
    if (!task) return null;
    const coalesceKey = (task.coalesce_key as string | null) ?? null;
    if (coalesceKey) {
      const active = this.databases.app
        .prepare(`SELECT j.id FROM jobs j JOIN tasks t ON t.id = j.task_id WHERE t.coalesce_key = ? AND j.status IN ('queued','leased','running','waiting_retry')`)
        .get(coalesceKey);
      if (active) return null;
    }
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
    this.callbacks.emit('job_queued', job);
    return job;
  }

  enqueueJob(jobId: string): JobRecord | null {
    const job = this.listJobs().find((j) => j.id === jobId);
    if (!job) return null;
    if (!['paused', 'blocked_operator', 'failed_final', 'cancelled'].includes(job.status)) return null;
    this.databases.app.prepare('UPDATE jobs SET status = ?, available_at = ?, updated_at = ? WHERE id = ?').run('queued', nowIso(), nowIso(), jobId);
    return this.listJobs().find((j) => j.id === jobId) ?? null;
  }

  requeueJob(jobId: string): JobRecord | null {
    const job = this.enqueueJob(jobId);
    void this.callbacks.processSchedulerTick();
    return job;
  }

  executeJob(jobId: string): JobRecord | null {
    return this.requeueJob(jobId);
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
        coalesceKey: row.coalesce_key ?? null,
        createdAt: row.created_at,
      }),
    );
  }

  getTask(taskId: string): TaskRecord | null {
    return this.listTasks().find((task) => task.id === taskId) ?? null;
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
    const job = this.listJobs().find((j) => j.id === jobId);
    if (!job) return null;
    if (!['queued', 'waiting_retry', 'blocked_operator'].includes(job.status)) return null;
    return this.updateJobStatus(jobId, 'paused');
  }

  resumeJob(jobId: string): JobRecord | null {
    const job = this.listJobs().find((j) => j.id === jobId);
    if (!job || job.status !== 'paused') return null;
    return this.updateJobStatus(jobId, 'queued');
  }

  private updateJobStatus(jobId: string, status: JobRecord['status']): JobRecord | null {
    this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ?, available_at = ? WHERE id = ?').run(status, nowIso(), nowIso(), jobId);
    return this.listJobs().find((job) => job.id === jobId) ?? null;
  }
}
