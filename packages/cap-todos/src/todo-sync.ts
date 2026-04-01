import type { CapabilityContext, TodoAccountRecord, TodoSyncResult } from '@popeye/contracts';
import { extractRedactionPatterns, redactText } from '@popeye/observability';

import type { TodoProviderAdapter } from './providers/adapter-interface.js';
import type { TodoService } from './todo-service.js';

export class TodoSyncService {
  private readonly redactionPatterns: string[];

  constructor(
    private readonly todoService: TodoService,
    private readonly ctx: CapabilityContext,
  ) {
    this.redactionPatterns = extractRedactionPatterns(ctx.config);
  }

  async syncAccount(account: TodoAccountRecord, adapter: TodoProviderAdapter): Promise<TodoSyncResult> {
    const result: TodoSyncResult = {
      accountId: account.id,
      todosSynced: 0,
      todosUpdated: 0,
      errors: [],
    };

    // Local accounts skip sync entirely
    if (account.providerKind === 'local') {
      return result;
    }

    try {
      // 1. Sync projects
      try {
        const projects = await adapter.getProjects();
        for (const project of projects) {
          try {
            this.todoService.upsertProject(account.id, {
              externalId: project.id,
              name: project.name,
              color: project.color,
            });
          } catch (err) {
            result.errors.push(`Project ${project.name}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } catch (err) {
        result.errors.push(`Projects: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Build projectId → projectName map from synced projects
      const projectNameMap = new Map<string, string>();
      for (const project of this.todoService.listProjects(account.id)) {
        if (project.externalId) {
          projectNameMap.set(project.externalId, project.name);
        }
      }

      // 2. Sync items
      try {
        const since = account.syncCursorSince;
        const items = await adapter.listItems(since ? { since } : undefined);
        for (const item of items) {
          try {
            const existing = this.todoService.getItemByExternalId(account.id, item.id);
            // Resolve project name from projectId if the adapter didn't set it
            const resolvedProjectName = item.projectName
              ?? (item.projectId ? (projectNameMap.get(item.projectId) ?? null) : null);
            this.todoService.upsertItem(account.id, {
              externalId: item.id,
              title: this.redact(item.title),
              description: this.redact(item.description),
              priority: item.priority,
              status: item.status,
              dueDate: item.dueDate,
              dueTime: item.dueTime,
              labels: item.labels,
              projectId: item.projectId,
              projectName: resolvedProjectName,
              parentId: item.parentId,
              completedAt: item.status === 'completed' ? (item.updatedAt ?? new Date().toISOString()) : null,
              createdAtExternal: item.createdAt,
              updatedAtExternal: item.updatedAt,
            });
            if (existing) {
              result.todosUpdated++;
            } else {
              result.todosSynced++;
            }
          } catch (err) {
            result.errors.push(`Item ${item.title}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } catch (err) {
        result.errors.push(`Items: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Update sync cursor and todo count
      this.todoService.updateSyncCursor(account.id, new Date().toISOString());
      this.todoService.updateTodoCount(account.id);

      this.ctx.auditCallback({
        eventType: 'todo_sync_completed',
        details: {
          accountId: account.id,
          todosSynced: result.todosSynced,
          todosUpdated: result.todosUpdated,
        },
        severity: 'info',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(message);
      this.ctx.log.error('Todo sync failed', { accountId: account.id, error: message });
      this.ctx.auditCallback({
        eventType: 'todo_sync_failed',
        details: { accountId: account.id, error: message },
        severity: 'error',
      });
    }

    return result;
  }

  private redact(text: string): string {
    return redactText(text, this.redactionPatterns).text;
  }
}
