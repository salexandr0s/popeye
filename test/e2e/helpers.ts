import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import Database from 'better-sqlite3';

import { expect, type Page } from '@playwright/test';

type ExampleConfig = {
  runtimeDataDir: string;
  authFile: string;
};

type AuthStoreFile = {
  current?: { token?: string };
  roles?: {
    operator?: {
      current?: { token?: string };
    };
  };
};

function readExampleConfig(): ExampleConfig {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'config/example.json'), 'utf8')) as ExampleConfig;
}

function getAppDbPath(): string {
  return resolve(readExampleConfig().runtimeDataDir, 'state', 'app.db');
}

function getGlobalPlaybooksDir(): string {
  return resolve(readExampleConfig().runtimeDataDir, 'playbooks');
}

function openAppDb(): Database.Database {
  const db = new Database(getAppDbPath());
  db.pragma('foreign_keys = ON');
  return db;
}

function renderPlaybookMarkdown(input: {
  id: string;
  title: string;
  status: 'draft' | 'active' | 'retired';
  allowedProfileIds?: string[];
  body: string;
}): string {
  const allowedProfileIds = [...new Set(input.allowedProfileIds ?? [])].sort();
  const lines = [
    '---',
    `id: ${input.id}`,
    `title: ${input.title}`,
    `status: ${input.status}`,
    allowedProfileIds.length === 0
      ? 'allowedProfileIds: []'
      : ['allowedProfileIds:', ...allowedProfileIds.map((value) => `  - ${value}`)].join('\n'),
    '---',
    input.body.trim(),
  ];
  return `${lines.join('\n')}\n`;
}

function readOperatorTokenFromStore(): string {
  const { authFile } = readExampleConfig();
  const store = JSON.parse(readFileSync(authFile, 'utf8')) as AuthStoreFile;
  const token = store.roles?.operator?.current?.token ?? store.current?.token;
  if (!token) {
    throw new Error(`Operator token missing from auth store at ${authFile}`);
  }
  return token;
}

export async function waitForOperatorToken(): Promise<string> {
  const { authFile } = readExampleConfig();
  await expect
    .poll(() => existsSync(authFile), {
      timeout: 5_000,
      message: `Expected auth store at ${authFile}`,
    })
    .toBe(true);

  return readOperatorTokenFromStore();
}

export async function unlockInspector(page: Page): Promise<string> {
  const token = await waitForOperatorToken();

  const response = await page.goto('/', { waitUntil: 'load' });
  if (!response || !response.ok()) {
    const status = response?.status() ?? 'no response';
    throw new Error(`page.goto('/') failed with status ${status}`);
  }

  await expect(page.getByRole('heading', { name: 'Unlock Popeye Inspector' })).toBeVisible({
    timeout: 10_000,
  });

  await page.getByLabel('Operator bearer token').fill(token);
  await page.getByRole('button', { name: 'Unlock' }).click();

  await expect(page.getByRole('heading', { name: 'Unlock Popeye Inspector' })).toBeHidden({
    timeout: 5_000,
  });
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({
    timeout: 5_000,
  });

  return token;
}

export function createE2eId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function waitForAppDb(): Promise<string> {
  const appDbPath = getAppDbPath();
  await expect
    .poll(() => existsSync(appDbPath), {
      timeout: 5_000,
      message: `Expected app DB at ${appDbPath}`,
    })
    .toBe(true);
  return appDbPath;
}

export function seedGlobalPlaybook(input: {
  id: string;
  title: string;
  status?: 'draft' | 'active' | 'retired';
  allowedProfileIds?: string[];
  body: string;
  fileName?: string;
}): {
  id: string;
  title: string;
  recordId: string;
  filePath: string;
  body: string;
} {
  const dir = getGlobalPlaybooksDir();
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, input.fileName ?? `${input.id}.md`);
  writeFileSync(
    filePath,
    renderPlaybookMarkdown({
      id: input.id,
      title: input.title,
      status: input.status ?? 'active',
      allowedProfileIds: input.allowedProfileIds,
      body: input.body,
    }),
    'utf8',
  );
  return {
    id: input.id,
    title: input.title,
    recordId: `global:${input.id}`,
    filePath,
    body: input.body,
  };
}

export function readSeededPlaybook(filePath: string): string {
  return readFileSync(filePath, 'utf8');
}

export function seedPlaybookUsageSignals(input: {
  recordId: string;
  playbookId: string;
  title: string;
  scope?: 'global' | 'workspace' | 'project';
  useCount?: number;
  failedRuns?: number;
  interventions?: number;
}): {
  runIds: string[];
  interventionIds: string[];
} {
  const db = openAppDb();
  try {
    const playbookRow = db
      .prepare('SELECT current_revision_hash FROM playbooks WHERE record_id = ?')
      .get(input.recordId) as { current_revision_hash: string } | undefined;
    if (!playbookRow) {
      throw new Error(`Playbook ${input.recordId} must be synced before seeding usage signals`);
    }

    const runIds: string[] = [];
    const interventionIds: string[] = [];
    const useCount = input.useCount ?? 3;
    const failedRuns = input.failedRuns ?? 2;
    const interventions = input.interventions ?? 1;
    const scope = input.scope ?? 'global';
    const seedId = createE2eId(input.playbookId);
    const insert = db.transaction(() => {
      for (let index = 0; index < useCount; index += 1) {
        const at = new Date(Date.now() - index * 60_000).toISOString();
        const taskId = `task-${seedId}-${index}`;
        const jobId = `job-${seedId}-${index}`;
        const runId = `run-${seedId}-${index}`;
        const sessionRootId = `session-${seedId}-${index}`;
        const state = index < failedRuns ? 'failed_final' : 'succeeded';
        runIds.push(runId);

        db.prepare(`
          INSERT INTO tasks (
            id,
            workspace_id,
            project_id,
            title,
            prompt,
            source,
            status,
            retry_policy_json,
            side_effect_profile,
            created_at,
            coalesce_key
          ) VALUES (?, 'default', NULL, ?, ?, 'manual', ?, '{}', 'default', ?, NULL)
        `).run(taskId, `${input.title} seed ${index + 1}`, 'seeded playbook usage signal', state, at);

        db.prepare(`
          INSERT INTO jobs (
            id,
            task_id,
            workspace_id,
            status,
            retry_count,
            available_at,
            last_run_id,
            created_at,
            updated_at
          ) VALUES (?, ?, 'default', ?, 0, ?, ?, ?, ?)
        `).run(jobId, taskId, state, at, runId, at, at);

        db.prepare(`
          INSERT INTO runs (
            id,
            job_id,
            task_id,
            workspace_id,
            session_root_id,
            engine_session_ref,
            state,
            started_at,
            finished_at,
            error
          ) VALUES (?, ?, ?, 'default', ?, 'fake:e2e', ?, ?, ?, ?)
        `).run(
          runId,
          jobId,
          taskId,
          sessionRootId,
          state,
          at,
          at,
          state === 'failed_final' ? 'seeded failure' : null,
        );

        db.prepare(`
          INSERT INTO playbook_usage (
            run_id,
            playbook_record_id,
            playbook_id,
            revision_hash,
            title,
            scope,
            source_order,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(runId, input.recordId, input.playbookId, playbookRow.current_revision_hash, input.title, scope, index, at);

        if (index < interventions) {
          const interventionId = `intervention-${seedId}-${index}`;
          interventionIds.push(interventionId);
          db.prepare(`
            INSERT INTO interventions (
              id,
              code,
              run_id,
              status,
              reason,
              created_at,
              resolved_at,
              updated_at,
              resolution_note
            ) VALUES (?, 'operator_review', ?, 'open', 'seeded intervention', ?, NULL, ?, NULL)
          `).run(interventionId, runId, at, at);
        }
      }
    });

    insert();
    return { runIds, interventionIds };
  } finally {
    db.close();
  }
}
