import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

import type {
  CapabilityContext,
  FileRootRecord,
  FileIndexResult,
} from '@popeye/contracts';
import { nowIso, DOMAIN_POLICY_DEFAULTS } from '@popeye/contracts';
import { redactText, sha256 } from '@popeye/observability';

import type { FilesCapabilityDb, FileDocumentRow } from './types.js';
import type { FileRootService } from './file-root-service.js';
import { isPathWithinRoot, isPathAllowed, validateFileSize } from './path-security.js';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'coverage', 'build',
  '.next', '.turbo', '.cache', 'out', '.svn',
]);

function walkFiles(rootPath: string, patterns: string[], excludePatterns: string[], maxSize: number): string[] {
  const results: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        walk(resolve(dir, entry.name));
      } else if (entry.isFile()) {
        const fullPath = resolve(dir, entry.name);
        const relPath = relative(rootPath, fullPath);
        if (!isPathAllowed(rootPath, relPath, patterns, excludePatterns)) continue;
        const sizeCheck = validateFileSize(fullPath, maxSize);
        if (!sizeCheck.valid) continue;
        results.push(fullPath);
      }
    }
  };
  walk(rootPath);
  return results;
}

export class FileIndexer {
  private readonly db: FilesCapabilityDb;
  private readonly ctx: CapabilityContext;
  private readonly redactionPatterns: string[];

  constructor(db: FilesCapabilityDb, ctx: CapabilityContext) {
    this.db = db;
    this.ctx = ctx;
    const config = ctx.config as Record<string, unknown>;
    const security = config['security'] as Record<string, unknown> | undefined;
    this.redactionPatterns = (security?.['redactionPatterns'] as string[]) ?? [];
  }

  indexRoot(root: FileRootRecord): FileIndexResult {
    const result: FileIndexResult = {
      rootId: root.id,
      indexed: 0,
      updated: 0,
      skipped: 0,
      stale: 0,
      errors: [],
    };

    if (!existsSync(root.rootPath)) {
      result.errors.push(`Root path does not exist: ${root.rootPath}`);
      return result;
    }

    const files = walkFiles(root.rootPath, root.filePatterns, root.excludePatterns, root.maxFileSizeBytes);

    const seenPaths = new Set<string>();

    for (const filePath of files) {
      if (!isPathWithinRoot(root.rootPath, filePath)) {
        result.errors.push(`Path escape detected: ${filePath}`);
        continue;
      }

      const relPath = relative(root.rootPath, filePath);
      seenPaths.add(relPath);

      try {
        const content = readFileSync(filePath, 'utf-8');
        const contentHash = sha256(content);

        // Check existing document
        const existing = (this.db.prepare as (sql: string) => { get: (...args: unknown[]) => FileDocumentRow | undefined })(
          'SELECT * FROM file_documents WHERE file_root_id = ? AND relative_path = ?',
        ).get(root.id, relPath);

        if (existing && existing.content_hash === contentHash) {
          result.skipped++;
          continue;
        }

        // Redact content before memory storage
        const redacted = redactText(content, this.redactionPatterns);

        // Determine classification based on permission:
        //   read → internal (not embeddable, just readable)
        //   index → embeddable (searchable via memory layer)
        //   index_and_derive → embeddable (allows entity extraction)
        const classification = root.permission === 'read' ? 'internal' as const : 'embeddable' as const;
        const filePolicy = DOMAIN_POLICY_DEFAULTS['files'];

        // File-doc memories start at confidence 0.7 (lower than curated at 0.8-1.0)
        // Subject to normal confidence decay. Reinforced when re-indexed with same content.
        const dedupKey = `file_doc:${sha256(resolve(filePath))}`;
        const memResult = this.ctx.memoryInsert({
          description: `File: ${relPath} (root: ${root.label})`,
          classification,
          sourceType: 'file_doc',
          content: redacted.text,
          confidence: 0.7,
          scope: root.workspaceId,
          memoryType: 'semantic',
          sourceRef: `file_root:${root.id}/${relPath}`,
          sourceRefType: 'file_root',
          domain: 'files',
          contextReleasePolicy: filePolicy.contextReleasePolicy,
          dedupKey,
        });

        const now = nowIso();
        const memoryId = memResult.rejected ? null : memResult.memoryId;

        if (existing) {
          // Update existing document
          (this.db.prepare as (sql: string) => { run: (...args: unknown[]) => void })(
            'UPDATE file_documents SET content_hash = ?, size_bytes = ?, memory_id = ?, updated_at = ? WHERE id = ?',
          ).run(contentHash, Buffer.byteLength(content, 'utf-8'), memoryId, now, existing.id);
          result.updated++;
        } else {
          // Insert new document
          const docId = randomUUID();
          (this.db.prepare as (sql: string) => { run: (...args: unknown[]) => void })(
            'INSERT INTO file_documents (id, file_root_id, relative_path, content_hash, size_bytes, memory_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          ).run(docId, root.id, relPath, contentHash, Buffer.byteLength(content, 'utf-8'), memoryId, now, now);
          result.indexed++;
        }
      } catch (err) {
        result.errors.push(`Error indexing ${relPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Mark stale documents
    const allDocs = (this.db.prepare as (sql: string) => { all: (...args: unknown[]) => FileDocumentRow[] })(
      'SELECT * FROM file_documents WHERE file_root_id = ?',
    ).all(root.id);

    for (const doc of allDocs) {
      if (!seenPaths.has(doc.relative_path)) {
        (this.db.prepare as (sql: string) => { run: (...args: unknown[]) => void })(
          'DELETE FROM file_documents WHERE id = ?',
        ).run(doc.id);
        result.stale++;
      }
    }

    // Update root's last indexed metadata
    const now = nowIso();
    (this.db.prepare as (sql: string) => { run: (...args: unknown[]) => void })(
      'UPDATE file_roots SET last_indexed_at = ?, last_indexed_count = ?, updated_at = ? WHERE id = ?',
    ).run(now, result.indexed + result.updated + result.skipped, now, root.id);

    return result;
  }

  reindexRoot(rootId: string, rootService: FileRootService): FileIndexResult | null {
    const fullRoot = rootService.getRoot(rootId);
    if (!fullRoot) return null;

    // Clear all documents for this root to force full reindex
    (this.db.prepare as (sql: string) => { run: (...args: unknown[]) => void })(
      'DELETE FROM file_documents WHERE file_root_id = ?',
    ).run(rootId);

    return this.indexRoot(fullRoot);
  }

  removeStaleDocuments(rootId: string): number {
    const root = (this.db.prepare as (sql: string) => { get: (...args: unknown[]) => Record<string, unknown> | undefined })(
      'SELECT root_path FROM file_roots WHERE id = ?',
    ).get(rootId);
    if (!root) return 0;

    const rootPath = root['root_path'] as string;
    const docs = (this.db.prepare as (sql: string) => { all: (...args: unknown[]) => FileDocumentRow[] })(
      'SELECT * FROM file_documents WHERE file_root_id = ?',
    ).all(rootId);

    let removed = 0;
    for (const doc of docs) {
      const fullPath = resolve(rootPath, doc.relative_path);
      if (!existsSync(fullPath)) {
        (this.db.prepare as (sql: string) => { run: (...args: unknown[]) => void })(
          'DELETE FROM file_documents WHERE id = ?',
        ).run(doc.id);
        removed++;
      }
    }
    return removed;
  }
}
