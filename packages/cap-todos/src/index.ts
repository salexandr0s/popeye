import type { CapabilityContext, CapabilityModule } from '@popeye/contracts';
import type Database from 'better-sqlite3';
import { openCapabilityDb } from '@popeye/cap-common';

import { TodoService } from './todo-service.js';
import { TodoSyncService } from './todo-sync.js';
import { TodoDigestService } from './todo-digest.js';
import { TodoSearchService } from './todo-search.js';
import { createTodoTools } from './tools.js';
import { getTodoMigrations } from './migrations.js';

export { TodoService } from './todo-service.js';
export { TodoSyncService } from './todo-sync.js';
export { TodoDigestService } from './todo-digest.js';
export { TodoSearchService } from './todo-search.js';
export { getTodoMigrations } from './migrations.js';
export type { TodoProviderAdapter, NormalizedTodoProject, NormalizedTodoItem } from './providers/adapter-interface.js';
export { LocalTodoAdapter } from './providers/local-adapter.js';
export { GoogleTasksAdapter } from './providers/google-tasks-adapter.js';

const DEFAULT_SYNC_INTERVAL_MS = 15 * 60_000; // 15 minutes
const DIGEST_INTERVAL_MS = 24 * 3600_000; // 24 hours

export function createTodosCapability(): CapabilityModule {
  let todoService: TodoService | null = null;
  let syncService: TodoSyncService | null = null;
  let digestService: TodoDigestService | null = null;
  let searchService: TodoSearchService | null = null;
  let ctx: CapabilityContext | null = null;
  let todosDb: Database.Database | null = null;

  return {
    descriptor: {
      id: 'todos',
      name: 'Todos',
      version: '1.0.0',
      domain: 'todos',
      dependencies: [],
    },

    initialize(context: CapabilityContext): void {
      ctx = context;

      const storesDir = context.paths.capabilityStoresDir;
      todosDb = openCapabilityDb(storesDir, 'todos.db', getTodoMigrations());

      const dbHandle = todosDb as unknown as CapabilityContext['appDb'];
      todoService = new TodoService(dbHandle);
      syncService = new TodoSyncService(todoService, context);
      digestService = new TodoDigestService(todoService, context);
      searchService = new TodoSearchService(dbHandle);

      context.log.info('cap-todos initialized', { storesDir });
    },

    shutdown(): void {
      todoService = null;
      syncService = null;
      digestService = null;
      searchService = null;
      ctx = null;
      if (todosDb) {
        todosDb.close();
        todosDb = null;
      }
    },

    healthCheck() {
      return { healthy: todoService !== null && todosDb !== null };
    },

    getRuntimeTools(taskContext: { workspaceId: string; runId?: string }) {
      if (!todoService || !searchService || !digestService || !ctx) return [];
      return createTodoTools(todoService, searchService, digestService, ctx, taskContext);
    },

    getTimers() {
      return [
        {
          id: 'todos-sync',
          intervalMs: DEFAULT_SYNC_INTERVAL_MS,
          immediate: false,
          handler: async () => {
            if (!todoService || !syncService || !ctx) return;

            const accounts = todoService.listAccounts();
            for (const account of accounts) {
              if (account.providerKind === 'local') continue;

              // External provider sync is resolved through runtime-owned facades, not direct capability timers.
              ctx.log.debug('Todo sync timer — skipping external account (runtime facade owns provider resolution)', { accountId: account.id });
            }
          },
        },
        {
          id: 'todos-digest',
          intervalMs: DIGEST_INTERVAL_MS,
          immediate: false,
          handler: () => {
            if (!todoService || !digestService || !ctx) return;
            const accounts = todoService.listAccounts();
            for (const account of accounts) {
              try {
                digestService.generateDigest(account);
              } catch (err) {
                ctx.log.error(`Todo digest failed for ${account.id}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
          },
        },
      ];
    },

    getMigrations() {
      // todos.db is self-managed — no migrations on app.db or memory.db
      return [];
    },
  };
}
