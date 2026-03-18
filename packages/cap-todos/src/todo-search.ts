import type { TodoSearchQuery, TodoSearchResult } from '@popeye/contracts';

import type { TodoCapabilityDb } from './types.js';
import { prepareAll } from './types.js';

interface TodoFtsRow {
  id: string;
  account_id: string;
  title: string;
  priority: number;
  status: string;
  due_date: string | null;
  project_name: string | null;
  rank: number;
}

export class TodoSearchService {
  constructor(private readonly db: TodoCapabilityDb) {}

  search(query: TodoSearchQuery): { query: string; results: TodoSearchResult[] } {
    try {
      return this.executeSearch(query);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('fts5')) {
        try {
          const escaped = { ...query, query: `"${query.query.replace(/"/g, '""')}"` };
          return this.executeSearch(escaped);
        } catch {
          return { query: query.query, results: [] };
        }
      }
      return { query: query.query, results: [] };
    }
  }

  private executeSearch(query: TodoSearchQuery): { query: string; results: TodoSearchResult[] } {
    const clauses: string[] = ['todo_items_fts MATCH ?'];
    const params: unknown[] = [query.query];

    if (query.accountId) {
      clauses.push('t.account_id = ?');
      params.push(query.accountId);
    }

    if (query.status && query.status !== 'all') {
      clauses.push('t.status = ?');
      params.push(query.status);
    }

    const limit = query.limit ?? 20;

    const sql = `
      SELECT t.id, t.account_id, t.title, t.priority, t.status,
             t.due_date, t.project_name, rank
      FROM todo_items_fts
      JOIN todo_items t ON t.rowid = todo_items_fts.rowid
      WHERE ${clauses.join(' AND ')}
      ORDER BY rank
      LIMIT ?`;

    params.push(limit);
    const rows = prepareAll<TodoFtsRow>(this.db, sql)(...params);

    const results: TodoSearchResult[] = rows.map((row) => ({
      todoId: row.id,
      title: row.title,
      priority: row.priority,
      status: row.status,
      dueDate: row.due_date,
      projectName: row.project_name,
      score: -row.rank,
    }));

    return { query: query.query, results };
  }
}
