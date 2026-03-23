import type {
  CapabilityContext,
  ConnectionCreateInput,
  ConnectionHealthSummary,
  ConnectionRecord,
  ConnectionSyncSummary,
  ConnectionUpdateInput,
  DomainKind,
  SecretRefRecord,
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
  TodoistConnectInput,
  TodoistConnectResult,
} from '@popeye/contracts';
import { nowIso } from '@popeye/contracts';
import { TodoService, TodoSyncService, TodoDigestService, LocalTodoAdapter, TodoistAdapter } from '@popeye/cap-todos';
import type { TodoSearchService as TodoSearchServiceType } from '@popeye/cap-todos';
import BetterSqlite3 from 'better-sqlite3';

import type { CapabilityFacade } from './capability-facade.js';
import type { CapabilityRegistry } from './capability-registry.js';
import { RuntimeValidationError } from './errors.js';
import type { PopeyeLogger } from '@popeye/observability';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TodoFacadeDeps {
  todosFacade: CapabilityFacade<TodoService, TodoSearchServiceType>;
  capabilityRegistry: CapabilityRegistry;
  capabilityStoresDir: string;
  log: PopeyeLogger;

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

  // Connection CRUD callbacks (needed by connectTodoist)
  listConnections: (domain?: string) => ConnectionRecord[];
  createConnection: (input: ConnectionCreateInput) => ConnectionRecord;
  updateConnection: (id: string, input: ConnectionUpdateInput) => ConnectionRecord | null;

  // Secret store callbacks (needed by connectTodoist and adapter resolution)
  setSecret: (input: { provider: string; key: string; value: string; connectionId: string; description: string }) => SecretRefRecord;
  rotateSecret: (id: string, newValue: string) => SecretRefRecord | null;
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
  private readonly buildCapabilityContext: () => CapabilityContext;
  private readonly requireConnectionForOperation: TodoFacadeDeps['requireConnectionForOperation'];
  private readonly requireTodoAccountForOperation: TodoFacadeDeps['requireTodoAccountForOperation'];
  private readonly updateConnectionRollups: TodoFacadeDeps['updateConnectionRollups'];
  private readonly listConnections: TodoFacadeDeps['listConnections'];
  private readonly createConnection: TodoFacadeDeps['createConnection'];
  private readonly updateConnection: TodoFacadeDeps['updateConnection'];
  private readonly setSecret: TodoFacadeDeps['setSecret'];
  private readonly rotateSecret: TodoFacadeDeps['rotateSecret'];
  private readonly getSecretValue: TodoFacadeDeps['getSecretValue'];

  constructor(deps: TodoFacadeDeps) {
    this.todosFacade = deps.todosFacade;
    this.capabilityRegistry = deps.capabilityRegistry;
    this.capabilityStoresDir = deps.capabilityStoresDir;
    this.log = deps.log;
    this.buildCapabilityContext = deps.buildCapabilityContext;
    this.requireConnectionForOperation = deps.requireConnectionForOperation;
    this.requireTodoAccountForOperation = deps.requireTodoAccountForOperation;
    this.updateConnectionRollups = deps.updateConnectionRollups;
    this.listConnections = deps.listConnections;
    this.createConnection = deps.createConnection;
    this.updateConnection = deps.updateConnection;
    this.setSecret = deps.setSecret;
    this.rotateSecret = deps.rotateSecret;
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

  private resolveTodoAdapter(account: TodoAccountRecord, connection: ConnectionRecord | null): LocalTodoAdapter | TodoistAdapter {
    if (account.providerKind === 'local') {
      return new LocalTodoAdapter();
    }
    if (account.providerKind === 'todoist') {
      if (!connection?.secretRefId) {
        throw new RuntimeValidationError('Todoist account has no usable connection secret');
      }
      const apiToken = this.getSecretValue(connection.secretRefId);
      if (!apiToken) {
        throw new RuntimeValidationError('Failed to retrieve Todoist API token from SecretStore');
      }
      return new TodoistAdapter({ apiToken });
    }
    throw new Error(`Unsupported todo provider: ${account.providerKind}`);
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

  connectTodoist(input: TodoistConnectInput): TodoistConnectResult {
    const existingConnection = this
      .listConnections('todos')
      .find((connection) => connection.providerKind === 'todoist') ?? null;

    let connection = existingConnection;
    if (!connection) {
      connection = this.createConnection({
        domain: 'todos',
        providerKind: 'todoist',
        label: input.label,
        mode: input.mode,
        secretRefId: null,
        syncIntervalSeconds: input.syncIntervalSeconds,
        allowedScopes: [],
        allowedResources: [],
        resourceRules: [],
      });
    } else {
      connection = this.updateConnection(connection.id, {
        label: input.label,
        mode: input.mode,
        syncIntervalSeconds: input.syncIntervalSeconds,
      }) ?? connection;
    }

    const secretRef = connection.secretRefId
      ? (this.rotateSecret(connection.secretRefId, input.apiToken) ?? this.setSecret({
        key: 'todoist-api-token',
        value: input.apiToken,
        connectionId: connection.id,
        description: 'Todoist API token',
      }))
      : this.setSecret({
        key: 'todoist-api-token',
        value: input.apiToken,
        connectionId: connection.id,
        description: 'Todoist API token',
      });

    connection = this.updateConnection(connection.id, { secretRefId: secretRef.id }) ?? connection;

    const todosCap = this.capabilityRegistry.getCapability('todos');
    if (!todosCap) throw new Error('Todos capability not initialized');

    const dbPath = `${this.capabilityStoresDir}/todos.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new TodoService(writeDb as unknown as CapabilityContext['appDb']);
      const account = svc.getAccountByConnection(connection.id)
        ?? svc.registerAccount({
          connectionId: connection.id,
          providerKind: 'todoist',
          displayName: input.displayName,
        });
      this.updateConnectionRollups({
        connectionId: connection.id,
        health: {
          status: 'healthy',
          authState: 'configured',
          checkedAt: nowIso(),
          lastError: null,
          diagnostics: [],
        },
        sync: {
          status: 'idle',
          cursorKind: 'since',
          cursorPresent: false,
          lagSummary: 'Awaiting first sync',
        },
      });
      this.todosFacade.invalidate();
      return { connectionId: connection.id, account };
    } finally {
      writeDb.close();
    }
  }

  registerTodoAccount(input: TodoAccountRegistrationInput): TodoAccountRecord {
    // Local accounts don't need a connection
    if (input.connectionId) {
      this.requireConnectionForOperation({
        connectionId: input.connectionId,
        purpose: 'todo_account_register',
        expectedDomain: 'todos',
        allowedProviderKinds: ['todoist', 'local'],
        requireSecret: false,
      });
    }

    return this.withWriteDb((svc) => svc.registerAccount(input));
  }

  createTodo(input: TodoCreateInput): TodoItemRecord {
    return this.withWriteDb((svc) => {
      this.requireTodoAccountForOperation(svc, input.accountId, 'todo_create');
      const data: { title: string; description?: string; priority?: number; dueDate?: string; dueTime?: string; labels?: string[]; projectName?: string } = { title: input.title };
      if (input.description !== undefined) data.description = input.description;
      if (input.priority !== undefined) data.priority = input.priority;
      if (input.dueDate !== undefined) data.dueDate = input.dueDate;
      if (input.dueTime !== undefined) data.dueTime = input.dueTime;
      if (input.labels !== undefined) data.labels = input.labels;
      if (input.projectName !== undefined) data.projectName = input.projectName;
      return svc.createItem(input.accountId, data);
    });
  }

  completeTodo(id: string): TodoItemRecord | null {
    return this.withWriteDb((svc) => {
      const existing = svc.getItem(id);
      if (!existing) {
        return null;
      }
      this.requireTodoAccountForOperation(svc, existing.accountId, 'todo_complete');
      svc.completeItem(id);
      return svc.getItem(id);
    });
  }

  reprioritizeTodo(todoId: string, priority: number): TodoItemRecord | null {
    return this.withWriteDb((svc) => {
      const existing = svc.getItem(todoId);
      if (!existing) return null;
      this.requireTodoAccountForOperation(svc, existing.accountId, 'todo_reprioritize');
      return svc.reprioritizeItem(todoId, priority);
    });
  }

  rescheduleTodo(todoId: string, dueDate: string, dueTime?: string | null): TodoItemRecord | null {
    return this.withWriteDb((svc) => {
      const existing = svc.getItem(todoId);
      if (!existing) return null;
      this.requireTodoAccountForOperation(svc, existing.accountId, 'todo_reschedule');
      return svc.rescheduleItem(todoId, dueDate, dueTime);
    });
  }

  moveTodo(todoId: string, projectName: string): TodoItemRecord | null {
    return this.withWriteDb((svc) => {
      const existing = svc.getItem(todoId);
      if (!existing) return null;
      this.requireTodoAccountForOperation(svc, existing.accountId, 'todo_move');
      return svc.moveItem(todoId, projectName);
    });
  }

  async reconcileTodos(accountId: string): Promise<TodoReconcileResult> {
    return this.withWriteDbAsync(async (svc) => {
      const { account, connection } = this.requireTodoAccountForOperation(svc, accountId, 'todo_reconcile', { requireSecret: true });
      const adapter = this.resolveTodoAdapter(account, connection);

      const ctx = this.buildCapabilityContext();
      const syncService = new TodoSyncService(svc, ctx);
      const syncResult = await syncService.syncAccount(account, adapter);

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
      const { account, connection } = this.requireTodoAccountForOperation(svc, accountId, 'todo_sync', {
        requireSecret: true,
      });
      const adapter = this.resolveTodoAdapter(account, connection);

      const ctx = this.buildCapabilityContext();
      const syncService = new TodoSyncService(svc, ctx);
      return syncService.syncAccount(account, adapter);
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
