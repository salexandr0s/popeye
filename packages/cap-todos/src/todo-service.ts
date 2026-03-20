import { randomUUID } from 'node:crypto';

import type {
  TodoAccountRecord,
  TodoAccountRegistrationInput,
  TodoProjectRecord,
  TodoItemRecord,
  TodoDigestRecord,
} from '@popeye/contracts';
import { nowIso } from '@popeye/contracts';

import type {
  TodoCapabilityDb,
  TodoAccountRow,
  TodoProjectRow,
  TodoItemRow,
  TodoDigestRow,
} from './types.js';
import { prepareGet, prepareAll, prepareRun } from './types.js';

// --- Row mappers ---

function parseJsonArray(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

const VALID_STATUS = new Set(['pending', 'completed', 'cancelled']);

function mapAccountRow(row: TodoAccountRow): TodoAccountRecord {
  return {
    id: row.id,
    connectionId: row.connection_id,
    providerKind: row.provider_kind as TodoAccountRecord['providerKind'],
    displayName: row.display_name,
    syncCursorSince: row.sync_cursor_since,
    lastSyncAt: row.last_sync_at,
    todoCount: row.todo_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProjectRow(row: TodoProjectRow): TodoProjectRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    externalId: row.external_id,
    name: row.name,
    color: row.color,
    todoCount: row.todo_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapItemRow(row: TodoItemRow): TodoItemRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    externalId: row.external_id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: VALID_STATUS.has(row.status) ? row.status as TodoItemRecord['status'] : 'pending',
    dueDate: row.due_date,
    dueTime: row.due_time,
    labels: parseJsonArray(row.labels),
    projectName: row.project_name,
    parentId: row.parent_id,
    completedAt: row.completed_at,
    createdAtExternal: row.created_at_external,
    updatedAtExternal: row.updated_at_external,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDigestRow(row: TodoDigestRow): TodoDigestRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    workspaceId: row.workspace_id,
    date: row.date,
    pendingCount: row.pending_count,
    overdueCount: row.overdue_count,
    completedTodayCount: row.completed_today_count,
    summaryMarkdown: row.summary_markdown,
    generatedAt: row.generated_at,
  };
}

// --- Service ---

export class TodoService {
  constructor(private readonly db: TodoCapabilityDb) {}

  // --- Accounts ---

  registerAccount(input: TodoAccountRegistrationInput): TodoAccountRecord {
    const id = randomUUID();
    const now = nowIso();
    prepareRun(this.db,
      `INSERT INTO todo_accounts (id, connection_id, provider_kind, display_name, todo_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )(id, input.connectionId ?? null, input.providerKind, input.displayName, now, now);
    const result = this.getAccount(id);
    if (!result) throw new Error('Failed to register todo account');
    return result;
  }

  getAccount(id: string): TodoAccountRecord | null {
    const row = prepareGet<TodoAccountRow>(this.db, 'SELECT * FROM todo_accounts WHERE id = ?')(id);
    return row ? mapAccountRow(row) : null;
  }

  getAccountByConnection(connectionId: string): TodoAccountRecord | null {
    const row = prepareGet<TodoAccountRow>(this.db, 'SELECT * FROM todo_accounts WHERE connection_id = ?')(connectionId);
    return row ? mapAccountRow(row) : null;
  }

  listAccounts(): TodoAccountRecord[] {
    const rows = prepareAll<TodoAccountRow>(this.db, 'SELECT * FROM todo_accounts ORDER BY display_name')();
    return rows.map(mapAccountRow);
  }

  updateSyncCursor(accountId: string, since: string | null): void {
    const now = nowIso();
    prepareRun(this.db,
      'UPDATE todo_accounts SET sync_cursor_since = ?, last_sync_at = ?, updated_at = ? WHERE id = ?',
    )(since, now, now, accountId);
  }

  updateTodoCount(accountId: string): void {
    const now = nowIso();
    const result = prepareGet<{ cnt: number }>(this.db, 'SELECT COUNT(*) as cnt FROM todo_items WHERE account_id = ?')(accountId);
    const count = result?.cnt ?? 0;
    prepareRun(this.db, 'UPDATE todo_accounts SET todo_count = ?, updated_at = ? WHERE id = ?')(count, now, accountId);
  }

  // --- Projects ---

  getProject(id: string): TodoProjectRecord | null {
    const row = prepareGet<TodoProjectRow>(this.db, 'SELECT * FROM todo_projects WHERE id = ?')(id);
    return row ? mapProjectRow(row) : null;
  }

  listProjects(accountId: string): TodoProjectRecord[] {
    const rows = prepareAll<TodoProjectRow>(this.db,
      'SELECT * FROM todo_projects WHERE account_id = ? ORDER BY name',
    )(accountId);
    return rows.map(mapProjectRow);
  }

  upsertProject(accountId: string, data: {
    externalId: string | null;
    name: string;
    color: string | null;
  }): TodoProjectRecord {
    const now = nowIso();

    if (data.externalId) {
      const existing = prepareGet<TodoProjectRow>(this.db,
        'SELECT * FROM todo_projects WHERE account_id = ? AND external_id = ?',
      )(accountId, data.externalId);

      if (existing) {
        prepareRun(this.db,
          'UPDATE todo_projects SET name = ?, color = ?, updated_at = ? WHERE id = ?',
        )(data.name, data.color, now, existing.id);
        return this.getProject(existing.id)!;
      }
    }

    const id = randomUUID();
    prepareRun(this.db,
      `INSERT INTO todo_projects (id, account_id, external_id, name, color, todo_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    )(id, accountId, data.externalId, data.name, data.color, now, now);
    return this.getProject(id)!;
  }

  // --- Items ---

  getItem(id: string): TodoItemRecord | null {
    const row = prepareGet<TodoItemRow>(this.db, 'SELECT * FROM todo_items WHERE id = ?')(id);
    return row ? mapItemRow(row) : null;
  }

  getItemByExternalId(accountId: string, externalId: string): TodoItemRecord | null {
    const row = prepareGet<TodoItemRow>(this.db,
      'SELECT * FROM todo_items WHERE account_id = ? AND external_id = ?',
    )(accountId, externalId);
    return row ? mapItemRow(row) : null;
  }

  listItems(accountId: string, options: {
    status?: string | undefined;
    priority?: number | undefined;
    dueDate?: string | undefined;
    projectName?: string | undefined;
    limit?: number | undefined;
  } = {}): TodoItemRecord[] {
    const clauses = ['account_id = ?'];
    const params: unknown[] = [accountId];

    if (options.status) {
      clauses.push('status = ?');
      params.push(options.status);
    }
    if (options.priority !== undefined) {
      clauses.push('priority = ?');
      params.push(options.priority);
    }
    if (options.dueDate) {
      clauses.push('due_date = ?');
      params.push(options.dueDate);
    }
    if (options.projectName) {
      clauses.push('project_name = ?');
      params.push(options.projectName);
    }

    const limit = options.limit ?? 50;
    const rows = prepareAll<TodoItemRow>(this.db,
      `SELECT * FROM todo_items WHERE ${clauses.join(' AND ')} ORDER BY priority ASC, due_date ASC NULLS LAST LIMIT ?`,
    )(...params, limit);
    return rows.map(mapItemRow);
  }

  listOverdue(accountId: string): TodoItemRecord[] {
    const today = nowIso().slice(0, 10);
    const rows = prepareAll<TodoItemRow>(this.db,
      `SELECT * FROM todo_items WHERE account_id = ? AND status = 'pending' AND due_date < ?
       ORDER BY due_date ASC, priority ASC`,
    )(accountId, today);
    return rows.map(mapItemRow);
  }

  listDueToday(accountId: string): TodoItemRecord[] {
    const today = nowIso().slice(0, 10);
    const rows = prepareAll<TodoItemRow>(this.db,
      `SELECT * FROM todo_items WHERE account_id = ? AND status = 'pending' AND due_date = ?
       ORDER BY priority ASC`,
    )(accountId, today);
    return rows.map(mapItemRow);
  }

  upsertItem(accountId: string, data: {
    externalId: string | null;
    title: string;
    description: string;
    priority: number;
    status: string;
    dueDate: string | null;
    dueTime: string | null;
    labels: string[];
    projectName: string | null;
    parentId: string | null;
    completedAt: string | null;
    createdAtExternal: string | null;
    updatedAtExternal: string | null;
  }): TodoItemRecord {
    const now = nowIso();

    if (data.externalId) {
      const existing = this.getItemByExternalId(accountId, data.externalId);
      if (existing) {
        prepareRun(this.db,
          `UPDATE todo_items SET title = ?, description = ?, priority = ?, status = ?,
           due_date = ?, due_time = ?, labels = ?, project_name = ?, parent_id = ?,
           completed_at = ?, created_at_external = ?, updated_at_external = ?, updated_at = ? WHERE id = ?`,
        )(
          data.title, data.description, data.priority, data.status,
          data.dueDate, data.dueTime, JSON.stringify(data.labels), data.projectName,
          data.parentId, data.completedAt, data.createdAtExternal, data.updatedAtExternal,
          now, existing.id,
        );
        return this.getItem(existing.id)!;
      }
    }

    const id = randomUUID();
    prepareRun(this.db,
      `INSERT INTO todo_items (id, account_id, external_id, title, description, priority, status,
       due_date, due_time, labels, project_name, parent_id, completed_at,
       created_at_external, updated_at_external, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )(
      id, accountId, data.externalId, data.title, data.description, data.priority, data.status,
      data.dueDate, data.dueTime, JSON.stringify(data.labels), data.projectName,
      data.parentId, data.completedAt, data.createdAtExternal, data.updatedAtExternal,
      now, now,
    );
    return this.getItem(id)!;
  }

  createItem(accountId: string, data: {
    title: string;
    description?: string;
    priority?: number;
    dueDate?: string;
    dueTime?: string;
    labels?: string[];
    projectName?: string;
  }): TodoItemRecord {
    const id = randomUUID();
    const now = nowIso();
    prepareRun(this.db,
      `INSERT INTO todo_items (id, account_id, external_id, title, description, priority, status,
       due_date, due_time, labels, project_name, parent_id, completed_at,
       created_at_external, updated_at_external, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, 'pending', ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
    )(
      id, accountId, data.title, data.description ?? '', data.priority ?? 4,
      data.dueDate ?? null, data.dueTime ?? null,
      JSON.stringify(data.labels ?? []), data.projectName ?? null,
      now, now,
    );
    return this.getItem(id)!;
  }

  updateItem(id: string, data: {
    title?: string;
    description?: string;
    priority?: number;
    status?: string;
    dueDate?: string | null;
    dueTime?: string | null;
    labels?: string[];
    projectName?: string | null;
  }): TodoItemRecord | null {
    const existing = this.getItem(id);
    if (!existing) return null;

    const now = nowIso();
    const title = data.title ?? existing.title;
    const description = data.description ?? existing.description;
    const priority = data.priority ?? existing.priority;
    const status = data.status ?? existing.status;
    const dueDate = data.dueDate !== undefined ? data.dueDate : existing.dueDate;
    const dueTime = data.dueTime !== undefined ? data.dueTime : existing.dueTime;
    const labels = data.labels ?? existing.labels;
    const projectName = data.projectName !== undefined ? data.projectName : existing.projectName;

    prepareRun(this.db,
      `UPDATE todo_items SET title = ?, description = ?, priority = ?, status = ?,
       due_date = ?, due_time = ?, labels = ?, project_name = ?, updated_at = ? WHERE id = ?`,
    )(title, description, priority, status, dueDate, dueTime, JSON.stringify(labels), projectName, now, id);

    return this.getItem(id)!;
  }

  completeItem(id: string): TodoItemRecord | null {
    const existing = this.getItem(id);
    if (!existing) return null;

    const now = nowIso();
    prepareRun(this.db,
      'UPDATE todo_items SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?',
    )('completed', now, now, id);
    return this.getItem(id)!;
  }

  // --- Digests ---

  getDigest(id: string): TodoDigestRecord | null {
    const row = prepareGet<TodoDigestRow>(this.db, 'SELECT * FROM todo_digests WHERE id = ?')(id);
    return row ? mapDigestRow(row) : null;
  }

  getLatestDigest(accountId: string): TodoDigestRecord | null {
    const row = prepareGet<TodoDigestRow>(this.db,
      'SELECT * FROM todo_digests WHERE account_id = ? ORDER BY date DESC LIMIT 1',
    )(accountId);
    return row ? mapDigestRow(row) : null;
  }

  listDigests(accountId: string, options: { limit?: number | undefined } = {}): TodoDigestRecord[] {
    const limit = options.limit ?? 10;
    const rows = prepareAll<TodoDigestRow>(this.db,
      'SELECT * FROM todo_digests WHERE account_id = ? ORDER BY date DESC LIMIT ?',
    )(accountId, limit);
    return rows.map(mapDigestRow);
  }

  insertDigest(data: {
    accountId: string;
    workspaceId: string;
    date: string;
    pendingCount: number;
    overdueCount: number;
    completedTodayCount: number;
    summaryMarkdown: string;
  }): TodoDigestRecord {
    const now = nowIso();
    const existing = prepareGet<TodoDigestRow>(this.db,
      'SELECT * FROM todo_digests WHERE account_id = ? AND date = ?',
    )(data.accountId, data.date);

    if (existing) {
      prepareRun(this.db,
        `UPDATE todo_digests SET pending_count = ?, overdue_count = ?,
         completed_today_count = ?, summary_markdown = ?, generated_at = ? WHERE id = ?`,
      )(data.pendingCount, data.overdueCount, data.completedTodayCount,
        data.summaryMarkdown, now, existing.id);
      return this.getDigest(existing.id)!;
    }

    const id = randomUUID();
    prepareRun(this.db,
      `INSERT INTO todo_digests (id, account_id, workspace_id, date, pending_count,
       overdue_count, completed_today_count, summary_markdown, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )(id, data.accountId, data.workspaceId, data.date, data.pendingCount,
      data.overdueCount, data.completedTodayCount, data.summaryMarkdown, now);
    return this.getDigest(id)!;
  }

  // --- Stats ---

  getPendingCount(accountId: string): number {
    const result = prepareGet<{ cnt: number }>(this.db,
      "SELECT COUNT(*) as cnt FROM todo_items WHERE account_id = ? AND status = 'pending'",
    )(accountId);
    return result?.cnt ?? 0;
  }

  getOverdueCount(accountId: string): number {
    const today = nowIso().slice(0, 10);
    const result = prepareGet<{ cnt: number }>(this.db,
      "SELECT COUNT(*) as cnt FROM todo_items WHERE account_id = ? AND status = 'pending' AND due_date < ?",
    )(accountId, today);
    return result?.cnt ?? 0;
  }

  getCompletedTodayCount(accountId: string): number {
    const today = nowIso().slice(0, 10);
    const result = prepareGet<{ cnt: number }>(this.db,
      "SELECT COUNT(*) as cnt FROM todo_items WHERE account_id = ? AND status = 'completed' AND completed_at >= ?",
    )(accountId, today);
    return result?.cnt ?? 0;
  }

  getByPriority(accountId: string, priority: number): TodoItemRecord[] {
    const rows = prepareAll<TodoItemRow>(this.db,
      "SELECT * FROM todo_items WHERE account_id = ? AND priority = ? AND status = 'pending' ORDER BY due_date ASC NULLS LAST",
    )(accountId, priority);
    return rows.map(mapItemRow);
  }

  reprioritizeItem(id: string, priority: number): TodoItemRecord | null {
    return this.updateItem(id, { priority });
  }

  rescheduleItem(id: string, dueDate: string, dueTime?: string | null): TodoItemRecord | null {
    return this.updateItem(id, { dueDate, dueTime: dueTime ?? undefined });
  }

  moveItem(id: string, projectName: string): TodoItemRecord | null {
    return this.updateItem(id, { projectName });
  }

  listAllProjects(): TodoProjectRecord[] {
    const rows = prepareAll<TodoProjectRow>(this.db, 'SELECT * FROM todo_projects ORDER BY name')();
    return rows.map(mapProjectRow);
  }
}
