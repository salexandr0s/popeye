import type { EmailSearchQuery, EmailSearchResult } from '@popeye/contracts';

import type { EmailCapabilityDb } from './types.js';
import { prepareAll } from './types.js';

interface FtsRow {
  id: string;
  account_id: string;
  gmail_thread_id: string;
  subject: string;
  snippet: string;
  last_message_at: string;
  from_address: string;
  rank: number;
}

export class EmailSearchService {
  constructor(private readonly db: EmailCapabilityDb) {}

  search(query: EmailSearchQuery): { query: string; results: EmailSearchResult[] } {
    // FTS5 queries can fail on malformed syntax — handle gracefully
    try {
      return this.executeSearch(query);
    } catch (err) {
      // If FTS5 syntax error, try quoting the query as a phrase
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

  private executeSearch(query: EmailSearchQuery): { query: string; results: EmailSearchResult[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];

    // FTS5 match on subject + snippet
    clauses.push('email_threads_fts MATCH ?');
    params.push(query.query);

    if (query.accountId) {
      clauses.push('t.account_id = ?');
      params.push(query.accountId);
    }

    if (query.dateRange?.from) {
      clauses.push('t.last_message_at >= ?');
      params.push(query.dateRange.from);
    }

    if (query.dateRange?.to) {
      clauses.push('t.last_message_at <= ?');
      params.push(query.dateRange.to);
    }

    // If label filter is present, apply it in SQL via a subquery
    if (query.labelFilter?.length) {
      // We check each label against the JSON label_ids column
      const labelChecks = query.labelFilter.map(() => `instr(t.label_ids, ?) > 0`);
      clauses.push(`(${labelChecks.join(' OR ')})`);
      for (const label of query.labelFilter) {
        params.push(`"${label}"`);
      }
    }

    const limit = query.limit ?? 20;

    // Join FTS with threads table, get from address from most recent message
    const sql = `
      SELECT t.id, t.account_id, t.gmail_thread_id, t.subject, t.snippet, t.last_message_at,
             COALESCE(m.from_address, '') as from_address,
             rank
      FROM email_threads_fts
      JOIN email_threads t ON t.rowid = email_threads_fts.rowid
      LEFT JOIN (
        SELECT thread_id, from_address,
               ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY received_at DESC) as rn
        FROM email_messages
      ) m ON m.thread_id = t.id AND m.rn = 1
      WHERE ${clauses.join(' AND ')}
      ORDER BY rank
      LIMIT ?`;

    params.push(limit);

    const rows = prepareAll<FtsRow>(this.db, sql)(...params);

    const results: EmailSearchResult[] = rows.map((row) => ({
      threadId: row.id,
      subject: row.subject,
      snippet: row.snippet,
      from: row.from_address,
      lastMessageAt: row.last_message_at,
      score: -row.rank, // FTS5 rank is negative; negate for ascending score
    }));

    return { query: query.query, results };
  }
}
