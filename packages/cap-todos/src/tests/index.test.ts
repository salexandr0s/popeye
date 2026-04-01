import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import type { CapabilityContext } from '@popeye/contracts';
import { createTodosCapability } from '../index.js';
import { TodoService } from '../todo-service.js';

function makeCtx(tempDir: string, overrides: Partial<CapabilityContext> = {}): CapabilityContext {
  return {
    appDb: {} as CapabilityContext['appDb'],
    memoryDb: {} as CapabilityContext['appDb'],
    paths: {
      capabilityStoresDir: tempDir,
      runtimeDataDir: tempDir,
      logsDir: tempDir,
      cacheDir: tempDir,
    } as CapabilityContext['paths'],
    config: { security: { redactionPatterns: [] } },
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    auditCallback: () => {},
    memoryInsert: () => ({ memoryId: 'mem-1', embedded: false }),
    approvalRequest: () => ({ id: 'test', status: 'pending' }),
    actionApprovalRequest: () => ({ id: 'test', status: 'pending' }),
    contextReleaseRecord: () => ({ id: 'test' }),
    events: { emit: () => {} },
    ...overrides,
  };
}

describe('createTodosCapability', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'popeye-captodos-cap-'));
  });

  afterEach(() => {
    // Cleanup handled by OS tmp
  });

  it('full lifecycle: init → tools → timers → shutdown', async () => {
    const cap = createTodosCapability();

    expect(cap.descriptor.id).toBe('todos');
    expect(cap.descriptor.domain).toBe('todos');
    expect(cap.descriptor.version).toBe('1.0.0');

    const ctx = makeCtx(tempDir);
    await cap.initialize(ctx);

    const health = cap.healthCheck();
    expect(health.healthy).toBe(true);

    const tools = cap.getRuntimeTools!({ workspaceId: 'default' });
    expect(tools.length).toBe(5);
    expect(tools.map((t) => t.name)).toContain('popeye_todo_list');
    expect(tools.map((t) => t.name)).toContain('popeye_todo_search');
    expect(tools.map((t) => t.name)).toContain('popeye_todo_add');
    expect(tools.map((t) => t.name)).toContain('popeye_todo_complete');
    expect(tools.map((t) => t.name)).toContain('popeye_todo_digest');

    const timers = cap.getTimers!();
    expect(timers.length).toBe(2);
    expect(timers.map((t) => t.id)).toContain('todos-sync');
    expect(timers.map((t) => t.id)).toContain('todos-digest');

    const migrations = cap.getMigrations!();
    expect(migrations.length).toBe(0);

    await cap.shutdown();
    const postShutdownHealth = cap.healthCheck();
    expect(postShutdownHealth.healthy).toBe(false);
  });

  it('creates todos.db in capabilityStoresDir', async () => {
    const cap = createTodosCapability();
    const ctx = makeCtx(tempDir);
    await cap.initialize(ctx);

    const db = new Database(join(tempDir, 'todos.db'), { readonly: true });
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('todo_accounts');
    expect(tableNames).toContain('todo_projects');
    expect(tableNames).toContain('todo_items');
    expect(tableNames).toContain('todo_digests');
    expect(tableNames).toContain('todo_items_fts');
    expect(tableNames).toContain('schema_migrations');

    db.close();
    await cap.shutdown();
  });

  it('tools return appropriate messages when no accounts', async () => {
    const cap = createTodosCapability();
    const ctx = makeCtx(tempDir);
    await cap.initialize(ctx);

    const tools = cap.getRuntimeTools!({ workspaceId: 'default' });

    const listTool = tools.find((t) => t.name === 'popeye_todo_list')!;
    const listResult = await listTool.execute({});
    expect(listResult.content[0]!.text).toContain('No todo accounts');

    const searchTool = tools.find((t) => t.name === 'popeye_todo_search')!;
    const searchResult = await searchTool.execute({ query: 'test' });
    expect(searchResult.content[0]!.text).toContain('No matching todos');

    const addTool = tools.find((t) => t.name === 'popeye_todo_add')!;
    const addResult = await addTool.execute({ title: 'test' });
    expect(addResult.content[0]!.text).toContain('No todo accounts');

    const completeTool = tools.find((t) => t.name === 'popeye_todo_complete')!;
    const completeResult = await completeTool.execute({ todoId: 'nonexistent' });
    expect(completeResult.content[0]!.text).toContain('Todo item not found');

    const digestTool = tools.find((t) => t.name === 'popeye_todo_digest')!;
    const digestResult = await digestTool.execute({});
    expect(digestResult.content[0]!.text).toContain('No todo accounts');

    await cap.shutdown();
  });

  it('survives double shutdown', async () => {
    const cap = createTodosCapability();
    const ctx = makeCtx(tempDir);
    await cap.initialize(ctx);

    await cap.shutdown();
    await cap.shutdown();
    expect(cap.healthCheck().healthy).toBe(false);
  });

  it('uses actionApprovalRequest for external todo writes', async () => {
    const cap = createTodosCapability();
    const actionApprovalRequest = vi.fn(() => ({ id: 'approval-1', status: 'approved' as const }));
    const createTodoViaRuntime = vi.fn(async () => ({
      id: 'todo-1',
      accountId: 'acct-1',
      externalId: 'gtask-1',
      title: 'Ship evaluator-backed approvals',
      description: '',
      priority: 4,
      status: 'pending' as const,
      dueDate: null,
      dueTime: null,
      labels: [],
      projectId: null,
      projectName: null,
      parentId: null,
      completedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const ctx = makeCtx(tempDir, { actionApprovalRequest, createTodoViaRuntime });
    await cap.initialize(ctx);

    const db = new Database(join(tempDir, 'todos.db'));
    const todoService = new TodoService(db as unknown as CapabilityContext['appDb']);
    todoService.registerAccount({ providerKind: 'google_tasks', displayName: 'Google Tasks', connectionId: 'conn-1' });
    db.close();

    const tools = cap.getRuntimeTools!({ workspaceId: 'default', runId: 'run-1' });
    const addTool = tools.find((tool) => tool.name === 'popeye_todo_add')!;
    const result = await addTool.execute({ title: 'Ship evaluator-backed approvals' });

    expect(result.content[0]!.text).toContain('Created todo');
    expect(actionApprovalRequest).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'external_write',
      domain: 'todos',
      actionKind: 'write',
      requestedBy: 'popeye_todo_add',
      runId: 'run-1',
    }));
    expect(createTodoViaRuntime).toHaveBeenCalledWith(expect.objectContaining({
      accountId: expect.any(String),
      title: 'Ship evaluator-backed approvals',
    }));

    await cap.shutdown();
  });

  it('uses runtime-backed callbacks for external add and complete operations', async () => {
    const cap = createTodosCapability();
    const actionApprovalRequest = vi.fn(() => ({ id: 'approval-1', status: 'approved' as const }));
    const createTodoViaRuntime = vi.fn(async () => ({
      id: 'todo-runtime-1',
      accountId: 'acct-runtime',
      externalId: 'gtask-runtime-1',
      title: 'Route external create through runtime',
      description: '',
      priority: 4,
      status: 'pending' as const,
      dueDate: null,
      dueTime: null,
      labels: [],
      projectId: null,
      projectName: null,
      parentId: null,
      completedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const completeTodoViaRuntime = vi.fn(async (todoId: string) => ({
      id: todoId,
      accountId: 'acct-runtime',
      externalId: 'gtask-runtime-existing',
      title: 'Existing external todo',
      description: '',
      priority: 4,
      status: 'completed' as const,
      dueDate: null,
      dueTime: null,
      labels: [],
      projectId: null,
      projectName: null,
      parentId: null,
      completedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const ctx = makeCtx(tempDir, {
      actionApprovalRequest,
      createTodoViaRuntime,
      completeTodoViaRuntime,
    });
    await cap.initialize(ctx);

    const db = new Database(join(tempDir, 'todos.db'));
    const todoService = new TodoService(db as unknown as CapabilityContext['appDb']);
    const account = todoService.registerAccount({ providerKind: 'google_tasks', displayName: 'Google Tasks', connectionId: 'conn-1' });
    const existing = todoService.createItem(account.id, { title: 'Existing external todo' });
    db.close();

    const tools = cap.getRuntimeTools!({ workspaceId: 'default', runId: 'run-1' });
    const addTool = tools.find((tool) => tool.name === 'popeye_todo_add')!;
    const addResult = await addTool.execute({ title: 'Route external create through runtime' });
    expect(addResult.content[0]!.text).toContain('Created todo');
    expect(createTodoViaRuntime).toHaveBeenCalledWith(expect.objectContaining({
      accountId: account.id,
      title: 'Route external create through runtime',
    }));

    const completeTool = tools.find((tool) => tool.name === 'popeye_todo_complete')!;
    const completeResult = await completeTool.execute({ todoId: existing.id });
    expect(completeResult.content[0]!.text).toContain('Completed');
    expect(completeTodoViaRuntime).toHaveBeenCalledWith(existing.id);

    await cap.shutdown();
  });

  it('fails clearly when external todo mutation callbacks are unavailable', async () => {
    const cap = createTodosCapability();
    const actionApprovalRequest = vi.fn(() => ({ id: 'approval-1', status: 'approved' as const }));
    const ctx = makeCtx(tempDir, { actionApprovalRequest });
    await cap.initialize(ctx);

    const db = new Database(join(tempDir, 'todos.db'));
    const todoService = new TodoService(db as unknown as CapabilityContext['appDb']);
    const account = todoService.registerAccount({ providerKind: 'google_tasks', displayName: 'Google Tasks', connectionId: 'conn-1' });
    const existing = todoService.createItem(account.id, { title: 'Existing external todo' });
    db.close();

    const tools = cap.getRuntimeTools!({ workspaceId: 'default', runId: 'run-1' });
    const addTool = tools.find((tool) => tool.name === 'popeye_todo_add')!;
    const addResult = await addTool.execute({ title: 'Needs runtime facade' });
    expect(addResult.content[0]!.text).toContain('runtime-backed todo mutation support');

    const completeTool = tools.find((tool) => tool.name === 'popeye_todo_complete')!;
    const completeResult = await completeTool.execute({ todoId: existing.id });
    expect(completeResult.content[0]!.text).toContain('runtime-backed todo mutation support');

    await cap.shutdown();
  });
});
