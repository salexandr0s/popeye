import type { GithubSearchQuery, GithubSearchResult } from '@popeye/contracts';

import type { GithubCapabilityDb } from './types.js';
import { prepareAll } from './types.js';

interface PrFtsRow {
  id: string;
  account_id: string;
  repo_id: string;
  github_pr_number: number;
  title: string;
  author: string;
  state: string;
  updated_at_gh: string;
  full_name: string;
  rank: number;
}

interface IssueFtsRow {
  id: string;
  account_id: string;
  repo_id: string;
  github_issue_number: number;
  title: string;
  author: string;
  state: string;
  updated_at_gh: string;
  full_name: string;
  rank: number;
}

export class GithubSearchService {
  constructor(private readonly db: GithubCapabilityDb) {}

  search(query: GithubSearchQuery): { query: string; results: GithubSearchResult[] } {
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

  private executeSearch(query: GithubSearchQuery): { query: string; results: GithubSearchResult[] } {
    const results: GithubSearchResult[] = [];
    const limit = query.limit ?? 20;
    const entityType = query.entityType ?? 'all';

    if (entityType === 'all' || entityType === 'pr') {
      const prResults = this.searchPrs(query.query, query.accountId, limit);
      results.push(...prResults);
    }

    if (entityType === 'all' || entityType === 'issue') {
      const issueResults = this.searchIssues(query.query, query.accountId, limit);
      results.push(...issueResults);
    }

    // Sort by score descending and limit
    results.sort((a, b) => b.score - a.score);
    return { query: query.query, results: results.slice(0, limit) };
  }

  private searchPrs(ftsQuery: string, accountId: string | undefined, limit: number): GithubSearchResult[] {
    const clauses: string[] = ['github_pull_requests_fts MATCH ?'];
    const params: unknown[] = [ftsQuery];

    if (accountId) {
      clauses.push('p.account_id = ?');
      params.push(accountId);
    }

    const sql = `
      SELECT p.id, p.account_id, p.repo_id, p.github_pr_number, p.title, p.author,
             p.state, p.updated_at_gh, r.full_name, rank
      FROM github_pull_requests_fts
      JOIN github_pull_requests p ON p.rowid = github_pull_requests_fts.rowid
      JOIN github_repos r ON r.id = p.repo_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY rank
      LIMIT ?`;

    params.push(limit);
    const rows = prepareAll<PrFtsRow>(this.db, sql)(...params);

    return rows.map((row) => ({
      entityType: 'pr' as const,
      entityId: row.id,
      repoFullName: row.full_name,
      number: row.github_pr_number,
      title: row.title,
      author: row.author,
      state: row.state,
      updatedAt: row.updated_at_gh,
      score: -row.rank,
    }));
  }

  private searchIssues(ftsQuery: string, accountId: string | undefined, limit: number): GithubSearchResult[] {
    const clauses: string[] = ['github_issues_fts MATCH ?'];
    const params: unknown[] = [ftsQuery];

    if (accountId) {
      clauses.push('i.account_id = ?');
      params.push(accountId);
    }

    const sql = `
      SELECT i.id, i.account_id, i.repo_id, i.github_issue_number, i.title, i.author,
             i.state, i.updated_at_gh, r.full_name, rank
      FROM github_issues_fts
      JOIN github_issues i ON i.rowid = github_issues_fts.rowid
      JOIN github_repos r ON r.id = i.repo_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY rank
      LIMIT ?`;

    params.push(limit);
    const rows = prepareAll<IssueFtsRow>(this.db, sql)(...params);

    return rows.map((row) => ({
      entityType: 'issue' as const,
      entityId: row.id,
      repoFullName: row.full_name,
      number: row.github_issue_number,
      title: row.title,
      author: row.author,
      state: row.state,
      updatedAt: row.updated_at_gh,
      score: -row.rank,
    }));
  }
}
