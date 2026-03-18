import type { CalendarSearchQuery, CalendarSearchResult } from '@popeye/contracts';

import type { CalendarCapabilityDb } from './types.js';
import { prepareAll } from './types.js';

interface EventFtsRow {
  id: string;
  account_id: string;
  title: string;
  start_time: string;
  end_time: string;
  location: string;
  organizer: string;
  rank: number;
}

export class CalendarSearchService {
  constructor(private readonly db: CalendarCapabilityDb) {}

  search(query: CalendarSearchQuery): { query: string; results: CalendarSearchResult[] } {
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

  private executeSearch(query: CalendarSearchQuery): { query: string; results: CalendarSearchResult[] } {
    const clauses: string[] = ['calendar_events_fts MATCH ?'];
    const params: unknown[] = [query.query];

    if (query.accountId) {
      clauses.push('e.account_id = ?');
      params.push(query.accountId);
    }

    if (query.dateFrom) {
      clauses.push('e.start_time >= ?');
      params.push(query.dateFrom);
    }

    if (query.dateTo) {
      clauses.push('e.start_time <= ?');
      params.push(query.dateTo);
    }

    const limit = query.limit ?? 20;

    const sql = `
      SELECT e.id, e.account_id, e.title, e.start_time, e.end_time,
             e.location, e.organizer, rank
      FROM calendar_events_fts
      JOIN calendar_events e ON e.rowid = calendar_events_fts.rowid
      WHERE ${clauses.join(' AND ')}
      ORDER BY rank
      LIMIT ?`;

    params.push(limit);
    const rows = prepareAll<EventFtsRow>(this.db, sql)(...params);

    const results: CalendarSearchResult[] = rows.map((row) => ({
      eventId: row.id,
      title: row.title,
      startTime: row.start_time,
      endTime: row.end_time,
      location: row.location,
      organizer: row.organizer,
      score: -row.rank,
    }));

    return { query: query.query, results };
  }
}
