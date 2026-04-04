import type {
  CapabilityContext,
  ConnectionHealthSummary,
  ConnectionRecord,
  ConnectionSyncSummary,
  DomainKind,
  TodoAccountRecord,
  TodoAccountRegistrationInput,
  TodoCreateInput,
  TodoDigestRecord,
  TodoItemRecord,
  TodoProjectRecord,
  TodoReconcileResult,
  TodoSearchQuery,
  TodoSearchResult,
  TodoSyncResult,
} from '@popeye/contracts';
import { nowIso } from '@popeye/contracts';
import { TodoService, TodoSyncService, TodoDigestService, LocalTodoAdapter, GoogleTasksAdapter } from '@popeye/cap-todos';
import type { TodoSearchService as TodoSearchServiceType } from '@popeye/cap-todos';
import BetterSqlite3 from 'better-sqlite3';

import type { CapabilityFacade } from './capability-facade.js';
import type { CapabilityRegistry } from './capability-registry.js';
import { RuntimeValidationError } from './errors.js';
import type { PopeyeLogger } from '@popeye/observability';
import { connectionCursorKindForProvider, parseStoredOAuthSecret } from './row-mappers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TodoFacadeDeps {
  todosFacade: CapabilityFacade<TodoService, TodoSearchServiceType>;
  capabilityRegistry: CapabilityRegistry;
  capabilityStoresDir: string;
  log: PopeyeLogger;
  resolveGoogleOAuthClientCredentials: () => {
    clientId?: string | undefined;
    clientSecret?: string | undefined;
  };

  // Callbacks for shared RuntimeService helpers
  buildCapabilityContext: () => CapabilityContext;
  requireConnectionForOperation: (input: {
    connectionId: string;
    purpose: string;
    expectedDomain: DomainKind;
    allowedProviderKinds?: Array<ConnectionRecord['providerKind']>;
    requireSecret?: boolean | undefined;
    runId?: string | undefined;
    jobId?: string | undefined;
    taskId?: string | undefined;
  }) => ConnectionRecord;
  requireTodoAccountForOperation: (
    service: TodoService,
    accountId: string,
    purpose: string,
    options?: { requireSecret?: boolean | undefined },
  ) => { account: TodoAccountRecord; connection: ConnectionRecord | null };
  updateConnectionRollups: (input: {
    connectionId: string;
    health?: Partial<ConnectionHealthSummary> | undefined;
    sync?: Partial<ConnectionSyncSummary> | undefined;
  }) => ConnectionRecord | null;
  classifyConnectionFailure: (message: string) => Pick<ConnectionHealthSummary, 'status' | 'authState'>;
  requireReadWriteConnection: (connection: ConnectionRecord, purpose: string) => void;
  getSecretValue: (id: string) => string | null;
}

// ---------------------------------------------------------------------------
// TodoFacade
// ---------------------------------------------------------------------------

export class TodoFacade {
  private readonly todosFacade: CapabilityFacade<TodoService, TodoSearchServiceType>;
  private readonly capabilityRegistry: CapabilityRegistry;
  private readonly capabilityStoresDir: string;
  private readonly log: PopeyeLogger;
  private readonly resolveGoogleOAuthClientCredentials: TodoFacadeDeps['resolveGoogleOAuthClientCredentials'];
  private readonly buildCapabilityContext: () => CapabilityContext;
  private readonly requireConnectionForOperation: TodoFacadeDeps['requireConnectionForOperation'];
  private readonly requireTodoAccountForOperation: TodoFacadeDeps['requireTodoAccountForOperation'];
  private readonly updateConnectionRollups: TodoFacadeDeps['updateConnectionRollups'];
  private readonly classifyConnectionFailure: TodoFacadeDeps['classifyConnectionFailure'];
  private readonly requireReadWriteConnection: TodoFacadeDeps['requireReadWriteConnection'];
  private readonly getSecretValue: TodoFacadeDeps['getSecretValue'];

  constructor(deps: TodoFacadeDeps) {
    this.todosFacade = deps.todosFacade;
    this.capabilityRegistry = deps.capabilityRegistry;
    this.capabilityStoresDir = deps.capabilityStoresDir;
    this.log = deps.log;
    this.resolveGoogleOAuthClientCredentials = deps.resolveGoogleOAuthClientCredentials;
    this.buildCapabilityContext = deps.buildCapabilityContext;
    this.requireConnectionForOperation = deps.requireConnectionForOperation;
    this.requireTodoAccountForOperation = deps.requireTodoAccountForOperation;
    this.updateConnectionRollups = deps.updateConnectionRollups;
    this.classifyConnectionFailure = deps.classifyConnectionFailure;
    this.requireReadWriteConnection = deps.requireReadWriteConnection;
    this.getSecretValue = deps.getSecretValue;
  }

  // --- Helper: open writable todos DB ---

  private withWriteDb<T>(fn: (svc: TodoService) => T): T {
    const todosCap = this.capabilityRegistry.getCapability('todos');
    if (!todosCap) throw new Error('Todos capability not initialized');
    const dbPath = `${this.capabilityStoresDir}/todos.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new TodoService(writeDb as unknown as CapabilityContext['appDb']);
      const result = fn(svc);
      this.todosFacade.invalidate();
      return result;
    } finally {
      writeDb.close();
    }
  }

  private async withWriteDbAsync<T>(fn: (svc: TodoService) => Promise<T>): Promise<T> {
    const todosCap = this.capabilityRegistry.getCapability('todos');
    if (!todosCap) throw new Error('Todos capability not initialized');
    const dbPath = `${this.capabilityStoresDir}/todos.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new TodoService(writeDb as unknown as CapabilityContext['appDb']);
      const result = await fn(svc);
      this.todosFacade.invalidate();
      return result;
    } finally {
      writeDb.close();
    }
  }

  // --- Helper: resolve todo adapter ---

  private resolveTodoAdapter(account: TodoAccountRecord, connection: ConnectionRecord | null): LocalTodoAdapter | GoogleTasksAdapter {
    if (account.providerKind === 'local') {
      return new LocalTodoAdapter();
    }
    if (account.providerKind === 'google_tasks') {
      if (!connection?.secretRefId) {
        throw new RuntimeValidationError('Google Tasks account has no usable connection secret');
      }
      const secretValue = this.getSecretValue(connection.secretRefId);
      const oauthSecret = parseStoredOAuthSecret(secretValue);
      if (!oauthSecret) {
        throw new RuntimeValidationError('Failed to retrieve Google Tasks OAuth credentials from SecretStore');
      }
      const credentials = this.resolveGoogleOAuthClientCredentials();
      return new GoogleTasksAdapter({
        accessToken: oauthSecret.accessToken,
        refreshToken: oauthSecret.refreshToken,
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
      });
    }
    throw new Error(`Unsupported todo provider: ${account.providerKind}`);
  }

  private persistProviderItem(
    service: TodoService,
    accountId: string,
    item: {
      id: string;
      title: string;
      description: string;
      priority: number;
      status: 'pending' | 'completed';
      dueDate: string | null;
      dueTime: string | null;
      labels: string[];
      projectId: string | null;
      projectName: string | null;
      parentId: string | null;
      createdAt: string | null;
      updatedAt: string | null;
    },
  ): TodoItemRecord {
    if (item.projectId && item.projectName) {
      service.upsertProject(accountId, {
        externalId: item.projectId,
        name: item.projectName,
        color: null,
      });
    }

    const stored = service.upsertItem(accountId, {
      externalId: item.id,
      title: item.title,
      description: item.description,
      priority: item.priority,
      status: item.status,
      dueDate: item.dueDate,
      dueTime: item.dueTime,
      labels: item.labels,
      projectId: item.projectId,
      projectName: item.projectName,
      parentId: item.parentId,
      completedAt: item.status === 'completed' ? (item.updatedAt ?? nowIso()) : null,
      createdAtExternal: item.createdAt,
      updatedAtExternal: item.updatedAt,
    });
    service.updateTodoCount(accountId);
    return stored;
  }

  private validateGoogleTasksCreateInput(input: {
    priority?: number | undefined;
    dueTime?: string | undefined;
    labels?: string[] | undefined;
  }): void {
    if (input.priority !== undefined && input.priority !== 4) {
      throw new RuntimeValidationError('Google Tasks does not support priorities');
    }
    if (input.dueTime !== undefined) {
      throw new RuntimeValidationError('Google Tasks does not support due times');
    }
    if (input.labels && input.labels.length > 0) {
      throw new RuntimeValidationError('Google Tasks does not support labels');
    }
  }

  private async syncAccountWithRollups(
    service: TodoService,
    accountId: string,
    purpose: string,
  ): Promise<TodoSyncResult> {
    const { account, connection } = this.requireTodoAccountForOperation(service, accountId, purpose, {
      requireSecret: true,
    });
    const adapter = this.resolveTodoAdapter(account, connection);
    const ctx = this.buildCapabilityContext();
    const syncService = new TodoSyncService(service, ctx);

    if (!connection) {
      return syncService.syncAccount(account, adapter);
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

    try {
      const result = await syncService.syncAccount(account, adapter);
      const refreshedAccount = service.getAccount(account.id) ?? account;
      const successCount = result.todosSynced + result.todosUpdated;
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
            : 'Awaiting first todo checkpoint',
        },
      });

      return result;
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      const failure = this.classifyConnectionFailure(message);
      this.updateConnectionRollups({
        connectionId: connection.id,
        health: {
          status: failure.status,
          authState: failure.authState,
          checkedAt: nowIso(),
          lastError: message,
        },
        sync: {
          lastAttemptAt: nowIso(),
          status: 'failed',
          cursorKind: connectionCursorKindForProvider(connection.providerKind),
          lagSummary: 'Sync failed before a checkpoint could be updated',
        },
      });
      throw error;
    }
  }

  // --- Read-only facade methods ---

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

  listTodoProjects(accountId: string): TodoProjectRecord[] {
    const svc = this.todosFacade.getService();
    if (!svc) return [];
    this.requireTodoAccountForOperation(svc, accountId, 'todo_projects_list');
    return svc.listProjects(accountId);
  }

  // --- Mutation methods ---

  registerTodoAccount(input: TodoAccountRegistrationInput): TodoAccountRecord {
    // Local accounts don't need a connection
    if (input.connectionId) {
      this.requireConnectionForOperation({
        connectionId: input.connectionId,
        purpose: 'todo_account_register',
        expectedDomain: 'todos',
        allowedProviderKinds: ['google_tasks', 'local'],
        requireSecret: false,
      });
    }

    return this.withWriteDb((svc) => svc.registerAccount(input));
  }

  async createTodo(input: TodoCreateInput): Promise<TodoItemRecord> {
    return this.withWriteDbAsync(async (svc) => {
      const { account, connection } = this.requireTodoAccountForOperation(svc, input.accountId, 'todo_create', {
        requireSecret: input.accountId.length > 0,
      });
      const data: {
        title: string;
        description?: string;
        priority?: number;
        dueDate?: string;
        dueTime?: string;
        labels?: string[];
        projectName?: string;
      } = { title: input.title };
      if (input.description !== undefined) data.description = input.description;
      if (input.priority !== undefined) data.priority = input.priority;
      if (input.dueDate !== undefined) data.dueDate = input.dueDate;
      if (input.dueTime !== undefined) data.dueTime = input.dueTime;
      if (input.labels !== undefined) data.labels = input.labels;
      if (input.projectName !== undefined) data.projectName = input.projectName;

      if (account.providerKind === 'local') {
        return svc.createItem(input.accountId, data);
      }

      this.validateGoogleTasksCreateInput({
        priority: input.priority,
        dueTime: input.dueTime,
        labels: input.labels,
      });
      if (!connection) {
        throw new RuntimeValidationError(`Todo account ${account.id} requires a Google Tasks connection`);
      }
      this.requireReadWriteConnection(connection, 'todo_create');
      const adapter = this.resolveTodoAdapter(account, connection);
      const created = await adapter.createItem(data);
      return this.persistProviderItem(svc, account.id, created);
    });
  }

  async completeTodo(id: string): Promise<TodoItemRecord | null> {
    return this.withWriteDbAsync(async (svc) => {
      const existing = svc.getItem(id);
      if (!existing) {
        return null;
      }
      const { account, connection } = this.requireTodoAccountForOperation(svc, existing.accountId, 'todo_complete');
      if (account.providerKind === 'local') {
        svc.completeItem(id);
        return svc.getItem(id);
      }
      if (!connection) {
        throw new RuntimeValidationError(`Todo account ${account.id} requires a Google Tasks connection`);
      }
      this.requireReadWriteConnection(connection, 'todo_complete');
      const adapter = this.resolveTodoAdapter(account, connection);
      const completed = await adapter.completeItem({
        externalId: existing.externalId ?? existing.id,
        projectId: existing.projectId,
      });
      return this.persistProviderItem(svc, account.id, completed);
    });
  }

  reprioritizeTodo(todoId: string, priority: number): TodoItemRecord | null {
    return this.withWriteDb((svc) => {
      const existing = svc.getItem(todoId);
      if (!existing) return null;
      const { account } = this.requireTodoAccountForOperation(svc, existing.accountId, 'todo_reprioritize');
      if (account.providerKind === 'google_tasks') {
        throw new RuntimeValidationError('Google Tasks does not support reprioritize');
      }
      return svc.reprioritizeItem(todoId, priority);
    });
  }

  async rescheduleTodo(todoId: string, dueDate: string, dueTime?: string | null): Promise<TodoItemRecord | null> {
    return this.withWriteDbAsync(async (svc) => {
      const existing = svc.getItem(todoId);
      if (!existing) return null;
      const { account, connection } = this.requireTodoAccountForOperation(svc, existing.accountId, 'todo_reschedule');
      if (account.providerKind === 'local') {
        return svc.rescheduleItem(todoId, dueDate, dueTime);
      }
      if (dueTime !== undefined && dueTime !== null) {
        throw new RuntimeValidationError('Google Tasks does not support due times');
      }
      if (!connection) {
        throw new RuntimeValidationError(`Todo account ${account.id} requires a Google Tasks connection`);
      }
      this.requireReadWriteConnection(connection, 'todo_reschedule');
      const adapter = this.resolveTodoAdapter(account, connection);
      const updated = await adapter.updateItem({
        externalId: existing.externalId ?? existing.id,
        projectId: existing.projectId,
        dueDate,
      });
      return this.persistProviderItem(svc, account.id, updated);
    });
  }

  async moveTodo(todoId: string, projectName: string): Promise<TodoItemRecord | null> {
    return this.withWriteDbAsync(async (svc) => {
      const existing = svc.getItem(todoId);
      if (!existing) return null;
      const { account, connection } = this.requireTodoAccountForOperation(svc, existing.accountId, 'todo_move');
      if (account.providerKind === 'local') {
        return svc.moveItem(todoId, projectName);
      }
      if (!connection) {
        throw new RuntimeValidationError(`Todo account ${account.id} requires a Google Tasks connection`);
      }
      this.requireReadWriteConnection(connection, 'todo_move');
      const adapter = this.resolveTodoAdapter(account, connection);
      const updated = await adapter.updateItem({
        externalId: existing.externalId ?? existing.id,
        projectId: existing.projectId,
        projectName,
      });
      return this.persistProviderItem(svc, account.id, updated);
    });
  }

  async reconcileTodos(accountId: string): Promise<TodoReconcileResult> {
    return this.withWriteDbAsync(async (svc) => {
      const syncResult = await this.syncAccountWithRollups(svc, accountId, 'todo_reconcile');

      return {
        accountId,
        added: syncResult.todosSynced,
        updated: syncResult.todosUpdated,
        removed: 0,
        errors: syncResult.errors,
      };
    });
  }

  async syncTodoAccount(accountId: string): Promise<TodoSyncResult> {
    return this.withWriteDbAsync(async (svc) => {
      return this.syncAccountWithRollups(svc, accountId, 'todo_sync');
    });
  }

  triggerTodoDigest(accountId?: string): TodoDigestRecord | null {
    const todosCap = this.capabilityRegistry.getCapability('todos');
    if (!todosCap) return null;

    const dbPath = `${this.capabilityStoresDir}/todos.db`;
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
}
