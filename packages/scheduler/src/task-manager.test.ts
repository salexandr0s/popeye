import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import type { SchedulerDeps, TaskManagerCallbacks } from './types.js';
import { TaskManager } from './task-manager.js';

function createDeps(): SchedulerDeps & { app: Database.Database } {
  const app = new Database(':memory:');
  app.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT,
      profile_id TEXT NOT NULL DEFAULT 'default',
      identity_id TEXT NOT NULL DEFAULT 'default',
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      retry_policy_json TEXT NOT NULL,
      side_effect_profile TEXT NOT NULL,
      coalesce_key TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      status TEXT NOT NULL,
      retry_count INTEGER NOT NULL,
      available_at TEXT NOT NULL,
      last_run_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE job_leases (
      job_id TEXT PRIMARY KEY,
      lease_owner TEXT NOT NULL,
      lease_expires_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return { app };
}

const callbacks: TaskManagerCallbacks = {
  emit: () => {},
  processSchedulerTick: async () => {},
};

const openDbs: Array<Database.Database> = [];

function createManager() {
  const deps = createDeps();
  openDbs.push(deps.app);
  return { deps, manager: new TaskManager(deps, callbacks) };
}

afterEach(() => {
  for (const db of openDbs.splice(0)) db.close();
});

describe('TaskManager', () => {
  it('reads validated task rows through shared row mappers', () => {
    const { manager } = createManager();

    const { task } = manager.createTask({
      workspaceId: 'ws-1',
      projectId: null,
      title: 'Validated task',
      prompt: 'Do the thing',
      source: 'manual',
      autoEnqueue: false,
      coalesceKey: 'same-work',
    });

    expect(manager.getTask(task.id)).toEqual(task);
    expect(manager.listTasks()).toEqual([task]);
  });

  it('preserves coalescing behavior when enqueueing validated task rows', () => {
    const { manager } = createManager();

    const { task } = manager.createTask({
      workspaceId: 'ws-1',
      projectId: null,
      title: 'Coalesced task',
      prompt: 'Only one active job',
      source: 'manual',
      autoEnqueue: false,
      coalesceKey: 'same-work',
    });

    const first = manager.enqueueTask(task.id);
    const second = manager.enqueueTask(task.id);

    expect(first).toBeTruthy();
    expect(second).toBeNull();
  });

  it('rejects invalid persisted task retry policy rows', () => {
    const { manager, deps } = createManager();

    deps.app
      .prepare(
        'INSERT INTO tasks (id, workspace_id, project_id, profile_id, title, prompt, source, status, retry_policy_json, side_effect_profile, coalesce_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run('task-bad', 'ws-1', null, 'default', 'Broken task', 'Prompt', 'manual', 'active', JSON.stringify({ maxAttempts: 'bad' }), 'read_only', null, '2026-03-14T00:00:00.000Z');

    expect(() => manager.getTask('task-bad')).toThrow();
  });

  it('rejects invalid persisted job and lease rows', () => {
    const { manager, deps } = createManager();

    deps.app
      .prepare(
        'INSERT INTO jobs (id, task_id, workspace_id, status, retry_count, available_at, last_run_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run('job-bad', 'task-1', 'ws-1', 'exploded', 0, '2026-03-14T00:00:00.000Z', null, '2026-03-14T00:00:00.000Z', '2026-03-14T00:00:00.000Z');

    deps.app
      .prepare('INSERT INTO job_leases (job_id, lease_owner, lease_expires_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('job-lease-bad', Buffer.from([1, 2, 3]), '2026-03-14T00:00:00.000Z', '2026-03-14T00:00:00.000Z');

    expect(() => manager.getJob('job-bad')).toThrow();
    expect(() => manager.getJobLease('job-lease-bad')).toThrow();
  });
});
