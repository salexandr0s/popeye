import { randomUUID } from 'node:crypto';

import type {
  FileRootRecord,
  FileRootRegistrationInput,
  FileRootUpdateInput,
  FileDocumentRecord,
} from '@popeye/contracts';
import { nowIso } from '@popeye/contracts';

import type { FilesCapabilityDb, FileRootRow, FileDocumentRow } from './types.js';
import { validateRootPath } from './path-security.js';

function mapRootRow(row: FileRootRow): FileRootRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    label: row.label,
    rootPath: row.root_path,
    kind: row.kind as FileRootRecord['kind'],
    permission: row.permission as FileRootRecord['permission'],
    filePatterns: JSON.parse(row.file_patterns) as string[],
    excludePatterns: JSON.parse(row.exclude_patterns) as string[],
    maxFileSizeBytes: row.max_file_size_bytes,
    enabled: row.enabled === 1,
    lastIndexedAt: row.last_indexed_at,
    lastIndexedCount: row.last_indexed_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDocRow(row: FileDocumentRow): FileDocumentRecord {
  return {
    id: row.id,
    fileRootId: row.file_root_id,
    relativePath: row.relative_path,
    contentHash: row.content_hash,
    sizeBytes: row.size_bytes,
    memoryId: row.memory_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class FileRootService {
  constructor(private readonly db: FilesCapabilityDb) {}

  registerRoot(input: FileRootRegistrationInput): FileRootRecord {
    const normalizedInput: FileRootRegistrationInput = {
      workspaceId: input.workspaceId ?? 'default',
      label: input.label,
      rootPath: input.rootPath,
      kind: input.kind ?? 'general',
      permission: input.permission ?? 'index',
      filePatterns: input.filePatterns ?? ['**/*.md', '**/*.txt'],
      excludePatterns: input.excludePatterns ?? [],
      maxFileSizeBytes: input.maxFileSizeBytes ?? 1_048_576,
    };

    const validation = validateRootPath(normalizedInput.rootPath);
    if (!validation.valid) {
      throw new Error(`Invalid root path: ${validation.reason}`);
    }

    const id = randomUUID();
    const now = nowIso();

    (this.db.prepare as (sql: string) => { run: (...args: unknown[]) => void })(
      `INSERT INTO file_roots (id, workspace_id, label, root_path, kind, permission, file_patterns, exclude_patterns, max_file_size_bytes, enabled, last_indexed_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
    ).run(
      id,
      normalizedInput.workspaceId,
      normalizedInput.label,
      normalizedInput.rootPath,
      normalizedInput.kind,
      normalizedInput.permission,
      JSON.stringify(normalizedInput.filePatterns),
      JSON.stringify(normalizedInput.excludePatterns),
      normalizedInput.maxFileSizeBytes,
      now,
      now,
    );

    return this.getRoot(id)!;
  }

  updateRoot(id: string, input: FileRootUpdateInput): FileRootRecord | null {
    const existing = this.getRoot(id);
    if (!existing) return null;

    const sets: string[] = [];
    const params: unknown[] = [];

    if (input.label !== undefined) { sets.push('label = ?'); params.push(input.label); }
    if (input.kind !== undefined) { sets.push('kind = ?'); params.push(input.kind); }
    if (input.permission !== undefined) { sets.push('permission = ?'); params.push(input.permission); }
    if (input.filePatterns !== undefined) { sets.push('file_patterns = ?'); params.push(JSON.stringify(input.filePatterns)); }
    if (input.excludePatterns !== undefined) { sets.push('exclude_patterns = ?'); params.push(JSON.stringify(input.excludePatterns)); }
    if (input.maxFileSizeBytes !== undefined) { sets.push('max_file_size_bytes = ?'); params.push(input.maxFileSizeBytes); }
    if (input.enabled !== undefined) { sets.push('enabled = ?'); params.push(input.enabled ? 1 : 0); }

    if (sets.length === 0) return existing;

    sets.push('updated_at = ?');
    params.push(nowIso());
    params.push(id);

    (this.db.prepare as (sql: string) => { run: (...args: unknown[]) => void })(
      `UPDATE file_roots SET ${sets.join(', ')} WHERE id = ?`,
    ).run(...params);

    return this.getRoot(id)!;
  }

  removeRoot(id: string): boolean {
    const result = (this.db.prepare as (sql: string) => { run: (...args: unknown[]) => { changes: number } })(
      'UPDATE file_roots SET enabled = 0, updated_at = ? WHERE id = ?',
    ).run(nowIso(), id);
    return result.changes > 0;
  }

  getRoot(id: string): FileRootRecord | null {
    const row = (this.db.prepare as (sql: string) => { get: (...args: unknown[]) => FileRootRow | undefined })(
      'SELECT * FROM file_roots WHERE id = ?',
    ).get(id);
    return row ? mapRootRow(row) : null;
  }

  listRoots(workspaceId?: string): FileRootRecord[] {
    if (workspaceId) {
      const rows = (this.db.prepare as (sql: string) => { all: (...args: unknown[]) => FileRootRow[] })(
        'SELECT * FROM file_roots WHERE workspace_id = ? ORDER BY label',
      ).all(workspaceId);
      return rows.map(mapRootRow);
    }
    const rows = (this.db.prepare as (sql: string) => { all: () => FileRootRow[] })(
      'SELECT * FROM file_roots ORDER BY label',
    ).all();
    return rows.map(mapRootRow);
  }

  getDocument(id: string): FileDocumentRecord | null {
    const row = (this.db.prepare as (sql: string) => { get: (...args: unknown[]) => FileDocumentRow | undefined })(
      'SELECT * FROM file_documents WHERE id = ?',
    ).get(id);
    return row ? mapDocRow(row) : null;
  }

  listDocuments(rootId: string): FileDocumentRecord[] {
    const rows = (this.db.prepare as (sql: string) => { all: (...args: unknown[]) => FileDocumentRow[] })(
      'SELECT * FROM file_documents WHERE file_root_id = ? ORDER BY relative_path',
    ).all(rootId);
    return rows.map(mapDocRow);
  }
}
