import { randomUUID } from 'node:crypto';

import type {
  JobLeaseRecord,
  JobRecord,
  TaskCreateInput,
  TaskRecord,
} from '@popeye/contracts';
import {
  TaskCreateInputSchema,
  nowIso,
} from '@popeye/contracts';

import type { SchedulerDeps, TaskManagerCallbacks } from './types.js';
import { IdRowSchema, mapJobLeaseRow, mapJobRow, mapTaskRow } from './row-mappers.js';

export class TaskManager {
  constructor(
    private readonly databases: SchedulerDeps,
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
    const rawTask = this.databases.app.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!rawTask) return null;
    const task = mapTaskRow(rawTask);
    const coalesceKey = task.coalesceKey;
    if (coalesceKey) {
      const rawActive = this.databases.app
        .prepare(`SELECT j.id FROM jobs j JOIN tasks t ON t.id = j.task_id WHERE t.coalesce_key = ? AND j.status IN ('queued','leased','running','waiting_retry')`)
        .get(coalesceKey);
      const active = rawActive ? IdRowSchema.parse(rawActive) : null;
      if (active) return null;
    }
    const job: JobRecord = {
      id: randomUUID(),
      taskId,
      workspaceId: task.workspaceId,
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
    const job = this.getJob(jobId);
    if (!job) return null;
    if (!['paused', 'blocked_operator', 'failed_final', 'cancelled'].includes(job.status)) return null;
    this.databases.app.prepare('UPDATE jobs SET status = ?, available_at = ?, updated_at = ? WHERE id = ?').run('queued', nowIso(), nowIso(), jobId);
    return this.getJob(jobId);
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
    const rows = this.databases.app.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all();
    return rows.map((row) => mapTaskRow(row));
  }

  getTask(taskId: string): TaskRecord | null {
    const row = this.databases.app.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    return row ? mapTaskRow(row) : null;
  }

  listJobs(): JobRecord[] {
    const rows = this.databases.app.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all();
    return rows.map((row) => mapJobRow(row));
  }

  getJob(jobId: string): JobRecord | null {
    const row = this.databases.app.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    return row ? mapJobRow(row) : null;
  }

  getJobLease(jobId: string): JobLeaseRecord | null {
    const row = this.databases.app.prepare('SELECT * FROM job_leases WHERE job_id = ?').get(jobId);
    return row ? mapJobLeaseRow(row) : null;
  }

  pauseJob(jobId: string): JobRecord | null {
    const job = this.getJob(jobId);
    if (!job) return null;
    if (!['queued', 'waiting_retry', 'blocked_operator'].includes(job.status)) return null;
    return this.updateJobStatus(jobId, 'paused');
  }

  resumeJob(jobId: string): JobRecord | null {
    const job = this.getJob(jobId);
    if (!job || job.status !== 'paused') return null;
    return this.updateJobStatus(jobId, 'queued');
  }

  private updateJobStatus(jobId: string, status: JobRecord['status']): JobRecord | null {
    this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ?, available_at = ? WHERE id = ?').run(status, nowIso(), nowIso(), jobId);
    return this.getJob(jobId);
  }
}
