import type {
  FileSearchQuery,
  FileSearchResponse,
  FileSearchResult,
} from '@popeye/contracts';

import type { FilesCapabilityDb, FileDocumentRow } from './types.js';

export class FileSearchService {
  constructor(private readonly db: FilesCapabilityDb) {}

  search(query: FileSearchQuery): FileSearchResponse {
    const results: FileSearchResult[] = [];

    // Search file_documents by relative_path match (simple LIKE search)
    let sql = 'SELECT d.*, r.label as root_label, r.workspace_id FROM file_documents d JOIN file_roots r ON d.file_root_id = r.id WHERE r.enabled = 1';
    const params: unknown[] = [];

    if (query.rootId) {
      sql += ' AND d.file_root_id = ?';
      params.push(query.rootId);
    }

    if (query.workspaceId) {
      sql += ' AND r.workspace_id = ?';
      params.push(query.workspaceId);
    }

    // Search by query in relative_path (escape LIKE wildcards)
    const escaped = query.query.replace(/[%_]/g, (ch) => `\\${ch}`);
    sql += " AND d.relative_path LIKE ? ESCAPE '\\'";
    params.push(`%${escaped}%`);

    sql += ' ORDER BY d.relative_path LIMIT ?';
    params.push(query.limit);

    const rows = (this.db.prepare as (sql: string) => { all: (...args: unknown[]) => Array<FileDocumentRow & { root_label: string; workspace_id: string }> })(sql).all(...params);

    for (const row of rows) {
      results.push({
        documentId: row.id,
        fileRootId: row.file_root_id,
        relativePath: row.relative_path,
        memoryId: row.memory_id,
        score: 1.0,
        snippet: row.relative_path,
      });
    }

    return {
      query: query.query,
      results,
      totalCandidates: results.length,
    };
  }
}
