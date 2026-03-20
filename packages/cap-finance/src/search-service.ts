import type { FinanceSearchQuery, FinanceSearchResult } from '@popeye/contracts';

import type { FinanceCapabilityDb } from './types.js';
import { prepareAll } from './types.js';

interface FinanceFtsRow {
  id: string;
  import_id: string;
  date: string;
  description: string;
  amount: number;
  redacted_summary: string;
  rank: number;
}

export class FinanceSearchService {
  constructor(private readonly db: FinanceCapabilityDb) {}

  search(query: FinanceSearchQuery): { query: string; results: FinanceSearchResult[] } {
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

  private executeSearch(query: FinanceSearchQuery): { query: string; results: FinanceSearchResult[] } {
    const clauses: string[] = ['finance_transactions_fts MATCH ?'];
    const params: unknown[] = [query.query];

    if (query.dateFrom) {
      clauses.push('t.date >= ?');
      params.push(query.dateFrom);
    }

    if (query.dateTo) {
      clauses.push('t.date <= ?');
      params.push(query.dateTo);
    }

    if (query.category) {
      clauses.push('t.category = ?');
      params.push(query.category);
    }

    const limit = query.limit ?? 20;

    const sql = `
      SELECT t.id, t.import_id, t.date, t.description, t.amount,
             t.redacted_summary, rank
      FROM finance_transactions_fts
      JOIN finance_transactions t ON t.rowid = finance_transactions_fts.rowid
      WHERE ${clauses.join(' AND ')}
      ORDER BY rank
      LIMIT ?`;

    params.push(limit);
    const rows = prepareAll<FinanceFtsRow>(this.db, sql)(...params);

    const results: FinanceSearchResult[] = rows.map((row) => ({
      transactionId: row.id,
      date: row.date,
      description: row.description,
      amount: row.amount,
      redactedSummary: row.redacted_summary,
      score: -row.rank,
    }));

    return { query: query.query, results };
  }
}
