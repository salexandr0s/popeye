import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';

import type Database from 'better-sqlite3';
import type {
  AuthRole,
  FileRootRecord,
  FileRootRegistrationInput,
  KnowledgeAssetStatus,
  KnowledgeAuditReport,
  KnowledgeBetaRunCreateInput,
  KnowledgeBetaRunDetail,
  KnowledgeBetaRunRecord,
  KnowledgeCompileJobRecord,
  KnowledgeConverterAvailability,
  KnowledgeConverterId,
  KnowledgeConverterProvenance,
  KnowledgeConversionAdapter,
  KnowledgeDocumentDetail,
  KnowledgeDocumentKind,
  KnowledgeDocumentQuery,
  KnowledgeDocumentRecord,
  KnowledgeDocumentRevisionApplyInput,
  KnowledgeRevisionApplyResult,
  KnowledgeRevisionRejectResult,
  KnowledgeDocumentRevisionProposalInput,
  KnowledgeDocumentRevisionRecord,
  KnowledgeImportInput,
  KnowledgeImportOutcome,
  KnowledgeImportResult,
  KnowledgeLinkCreateInput,
  KnowledgeLinkKind,
  KnowledgeLinkRecord,
  KnowledgeNeighborhood,
  KnowledgeSourceRecord,
  KnowledgeSourceSnapshotRecord,
  KnowledgeLintReport,
  KnowledgeLogOperation,
  MutationReceiptKind,
  MutationReceiptRecord,
  MutationReceiptStatus,
  SecurityAuditEvent,
} from '@popeye/contracts';
import {
  KnowledgeAssetStatusSchema,
  KnowledgeAuditReportSchema,
  KnowledgeBetaRunDetailSchema,
  KnowledgeBetaRunRecordSchema,
  KnowledgeCompileJobRecordSchema,
  KnowledgeConverterAvailabilitySchema,
  KnowledgeDocumentDetailSchema,
  KnowledgeDocumentRecordSchema,
  KnowledgeDocumentRevisionRecordSchema,
  KnowledgeImportResultSchema,
  KnowledgeLinkRecordSchema,
  KnowledgeNeighborhoodSchema,
  KnowledgeRevisionApplyResultSchema,
  KnowledgeRevisionRejectResultSchema,
  KnowledgeSourceRecordSchema,
  KnowledgeLintReportSchema,
  KnowledgeSourceSnapshotRecordSchema,
  nowIso,
} from '@popeye/contracts';
import { buildPlaybookDiff } from '@popeye/playbooks';
import type { WorkspaceRegistry } from '@popeye/workspace';
import { redactText, sha256 } from '@popeye/observability';

import { RuntimeConflictError, RuntimeNotFoundError, RuntimeValidationError } from './errors.js';
import type { WikiCompilationClient, WikiCompileOutput } from './wiki-compilation-client.js';
import { buildEntityPagePrompt, buildIndexPrompt, buildSourceCompilePrompt, buildSourceUpdatePrompt } from './wiki-compile-prompts.js';

const execFileAsync = promisify(execFile);
const MAX_SUMMARY_CHARS = 1600;
const MAX_FILE_QUERY_TITLE_CHARS = 200;
const MAX_FILE_QUERY_ANSWER_CHARS = 100_000;

type KnowledgeCommandResolution = {
  command: string;
  provenance: KnowledgeConverterProvenance;
};

export interface KnowledgeServiceOptions {
  db: Database.Database;
  workspaceRegistry: WorkspaceRegistry;
  listFileRoots: (workspaceId?: string) => FileRootRecord[];
  registerFileRoot: (input: FileRootRegistrationInput) => FileRootRecord;
  reindexFileRoot: (rootId: string) => void;
  redactionPatterns: string[];
  writeMutationReceipt: (input: {
    kind: MutationReceiptKind;
    component: string;
    status: MutationReceiptStatus;
    summary: string;
    details: string;
    actorRole: AuthRole;
    workspaceId?: string | null;
    metadata?: Record<string, string>;
  }) => MutationReceiptRecord;
  recordSecurityAudit: (event: SecurityAuditEvent) => void;
  log?: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
  fetchImpl?: typeof fetch;
  runCommand?: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
  wikiCompilationClient?: WikiCompilationClient;
}

interface ConvertedSource {
  adapter: KnowledgeConversionAdapter;
  fallbackUsed: boolean;
  normalizedMarkdown: string;
  warnings: string[];
  originalFileName: string | null;
  originalMediaType: string | null;
  originalContentToPersist: string | Buffer;
  originalPersistenceName: string;
  extraOriginalArtifacts?: Array<{
    fileName: string;
    mediaType: string | null;
    content: string | Buffer;
  }>;
}

interface KnowledgeSourceRow {
  id: string;
  workspace_id: string;
  knowledge_root_id: string;
  source_type: string;
  title: string;
  original_uri: string | null;
  original_path: string | null;
  original_file_name: string | null;
  original_media_type: string | null;
  adapter: string;
  fallback_used: number;
  status: string;
  content_hash: string;
  asset_status: string;
  canonical_source_key: string | null;
  latest_outcome: string;
  original_dir_path: string;
  normalized_markdown_path: string;
  conversion_warnings_json: string;
  created_at: string;
  updated_at: string;
}

interface KnowledgeDocumentRow {
  id: string;
  workspace_id: string;
  knowledge_root_id: string;
  source_id: string | null;
  kind: string;
  title: string;
  slug: string;
  relative_path: string;
  revision_hash: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface KnowledgeRevisionRow {
  id: string;
  document_id: string;
  workspace_id: string;
  status: string;
  source_kind: string;
  source_id: string | null;
  proposed_title: string | null;
  proposed_markdown: string;
  diff_preview: string;
  base_revision_hash: string | null;
  created_at: string;
  applied_at: string | null;
}

interface KnowledgeLinkRow {
  id: string;
  workspace_id: string;
  source_document_id: string;
  target_document_id: string | null;
  target_slug: string | null;
  target_label: string;
  link_kind: string;
  link_status: string;
  confidence: number;
  created_at: string;
  updated_at: string;
}

interface KnowledgeCompileJobRow {
  id: string;
  workspace_id: string;
  source_id: string | null;
  target_document_id: string | null;
  status: string;
  summary: string;
  warnings_json: string;
  created_at: string;
  updated_at: string;
}

interface KnowledgeSnapshotRow {
  id: string;
  source_id: string;
  workspace_id: string;
  content_hash: string;
  adapter: string;
  fallback_used: number;
  status: string;
  asset_status: string;
  conversion_warnings_json: string;
  outcome: string;
  created_at: string;
}

interface KnowledgeBetaRunRow {
  id: string;
  workspace_id: string;
  manifest_path: string | null;
  report_markdown: string;
  imports_json: string;
  reingests_json: string;
  converters_json: string;
  audit_json: string;
  gate_json: string;
  import_count: number;
  reingest_count: number;
  hard_failure_count: number;
  import_success_rate: number;
  gate_status: string;
  created_at: string;
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
}

function writeUtf8(path: string, content: string): void {
  ensureDir(dirname(path));
  writeFileSync(path, content, { encoding: 'utf8', mode: 0o600 });
}

function writeBinary(path: string, content: Buffer): void {
  ensureDir(dirname(path));
  writeFileSync(path, content, { mode: 0o600 });
}

function normalizeMarkdown(markdown: string): string {
  const normalized = markdown.replace(/\r\n?/g, '\n');
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
}

function buildRevisionHash(markdown: string): string {
  return createHash('sha256').update(markdown, 'utf8').digest('hex');
}

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'knowledge-doc';
}

function dedupeSlug(base: string, exists: (candidate: string) => boolean): string {
  if (!exists(base)) return base;
  let i = 2;
  while (exists(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

function looksLikeExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

function stripHtmlToMarkdown(html: string): string {
  return normalizeMarkdown(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<\/(p|div|section|article|h\d|li|ul|ol|br)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  );
}

function summarizeMarkdown(markdown: string): string {
  const paragraphs = markdown
    .split(/\n\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith('```'));
  const joined = paragraphs.slice(0, 4).join('\n\n');
  if (joined.length <= MAX_SUMMARY_CHARS) return joined;
  return `${joined.slice(0, MAX_SUMMARY_CHARS).trimEnd()}…`;
}

function resolveWikiRelativePath(slug: string): string {
  return `wiki/${slug}.md`;
}

function resolveOutputRelativePath(slug: string, dateStamp: string): string {
  return `outputs/${dateStamp}/${slug}.md`;
}

function extractKnowledgeLinks(markdown: string): Array<{ targetLabel: string; targetSlug: string | null; href: string | null; linkKind: KnowledgeLinkKind; external: boolean }> {
  const results: Array<{ targetLabel: string; targetSlug: string | null; href: string | null; linkKind: KnowledgeLinkKind; external: boolean }> = [];

  const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;
  for (const match of markdown.matchAll(wikiLinkRegex)) {
    const label = match[1]?.trim();
    if (!label) continue;
    results.push({
      targetLabel: label,
      targetSlug: slugify(label),
      href: null,
      linkKind: 'wikilink',
      external: false,
    });
  }

  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  for (const match of markdown.matchAll(markdownLinkRegex)) {
    const label = match[1]?.trim() || match[2]?.trim() || 'link';
    const href = match[2]?.trim() ?? null;
    if (!href) continue;
    const external = looksLikeExternalHref(href);
    const targetSlug = external
      ? null
      : slugify(
        basename(href).replace(/\.md$/i, '')
          .replace(/^source$/i, label),
      );
    results.push({
      targetLabel: label,
      targetSlug,
      href,
      linkKind: external ? 'citation' : 'markdown',
      external,
    });
  }

  return results;
}

function isImageExtension(extension: string): boolean {
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.tiff', '.tif'].includes(extension);
}

function sanitizeFileName(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'asset';
}

function extensionForContentType(contentType: string | null): string {
  if (!contentType) return '';
  const normalized = contentType.split(';', 1)[0]?.trim().toLowerCase();
  switch (normalized) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    case 'image/gif':
      return '.gif';
    case 'image/webp':
      return '.webp';
    case 'image/svg+xml':
      return '.svg';
    case 'image/bmp':
      return '.bmp';
    case 'image/tiff':
      return '.tiff';
    case 'text/html':
      return '.html';
    case 'text/plain':
      return '.txt';
    case 'application/json':
      return '.json';
    default:
      return '';
  }
}

function canonicalizeUrlSource(sourceUri: string): string {
  try {
    const url = new URL(sourceUri);
    url.hash = '';
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
      url.port = '';
    }
    const retainedParams = new URLSearchParams();
    for (const [key, value] of url.searchParams.entries()) {
      const lower = key.toLowerCase();
      if (lower.startsWith('utm_') || lower === 'fbclid' || lower === 'gclid') {
        continue;
      }
      retainedParams.append(key, value);
    }
    url.search = retainedParams.toString() ? `?${retainedParams.toString()}` : '';
    return url.toString();
  } catch {
    return sourceUri.trim();
  }
}

function buildKnowledgeFtsQuery(query: string): string | null {
  const tokens = query
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.map((token) => token.trim())
    .filter(Boolean) ?? [];
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"*`).join(' AND ');
}

function extractMarkdownImageRefs(markdown: string): string[] {
  const refs = new Set<string>();
  const markdownImageRegex = /!\[[^\]]*]\(([^)]+)\)/g;
  for (const match of markdown.matchAll(markdownImageRegex)) {
    const rawRef = match[1]?.trim();
    if (!rawRef) continue;
    const ref = rawRef.replace(/^<|>$/g, '').split(/\s+"/, 1)[0]?.trim();
    if (ref) refs.add(ref);
  }

  const htmlImageRegex = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  for (const match of markdown.matchAll(htmlImageRegex)) {
    const ref = match[1]?.trim();
    if (ref) refs.add(ref);
  }

  return Array.from(refs);
}

export class KnowledgeService {
  private readonly db: Database.Database;
  private readonly workspaceRegistry: WorkspaceRegistry;
  private readonly listFileRoots: KnowledgeServiceOptions['listFileRoots'];
  private readonly registerFileRoot: KnowledgeServiceOptions['registerFileRoot'];
  private readonly reindexFileRoot: KnowledgeServiceOptions['reindexFileRoot'];
  private readonly redactionPatterns: string[];
  private readonly writeMutationReceipt: KnowledgeServiceOptions['writeMutationReceipt'];
  private readonly recordSecurityAudit: KnowledgeServiceOptions['recordSecurityAudit'];
  private readonly log: KnowledgeServiceOptions['log'];
  private readonly fetchImpl: typeof fetch;
  private readonly runCommand: NonNullable<KnowledgeServiceOptions['runCommand']>;
  private readonly wikiCompilationClient: WikiCompilationClient | null;

  constructor(options: KnowledgeServiceOptions) {
    this.db = options.db;
    this.workspaceRegistry = options.workspaceRegistry;
    this.listFileRoots = options.listFileRoots;
    this.registerFileRoot = options.registerFileRoot;
    this.reindexFileRoot = options.reindexFileRoot;
    this.redactionPatterns = options.redactionPatterns;
    this.writeMutationReceipt = options.writeMutationReceipt;
    this.recordSecurityAudit = options.recordSecurityAudit;
    this.log = options.log;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.runCommand = options.runCommand ?? (async (command, args) => execFileAsync(command, args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }));
    this.wikiCompilationClient = options.wikiCompilationClient ?? null;
    this.rebuildSearchIndex();
  }

  private resolveBundledCommand(envKeys: string[], fallbackName: string): KnowledgeCommandResolution {
    for (const envKey of envKeys) {
      const configured = process.env[envKey]?.trim();
      if (configured && existsSync(configured)) {
        return {
          command: configured,
          provenance: 'bundled',
        };
      }
    }

    const shimsDir = process.env.POPEYE_KNOWLEDGE_SHIMS?.trim();
    if (shimsDir) {
      const candidate = join(shimsDir, fallbackName);
      if (existsSync(candidate)) {
        return {
          command: candidate,
          provenance: 'bundled',
        };
      }
    }

    return {
      command: fallbackName,
      provenance: 'system',
    };
  }

  private resolveKnowledgePython(): KnowledgeCommandResolution {
    return this.resolveBundledCommand(['POPEYE_KNOWLEDGE_PYTHON'], 'python3');
  }

  private resolveMarkitdown(): KnowledgeCommandResolution {
    return this.resolveBundledCommand(['POPEYE_KNOWLEDGE_MARKITDOWN'], 'markitdown');
  }

  private buildPythonInstallHint(provenance: KnowledgeConverterProvenance, packageName: string): string | null {
    if (provenance === 'bundled') {
      return 'Reinstall the packaged Popeye app or .pkg; the bundled Knowledge converter runtime is missing or incomplete.';
    }
    if (provenance === 'system' || provenance === 'missing') {
      return `Install with: python3 -m pip install ${packageName}`;
    }
    return null;
  }

  listSources(workspaceId: string): KnowledgeSourceRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM knowledge_sources WHERE workspace_id = ? ORDER BY updated_at DESC',
    ).all(workspaceId) as KnowledgeSourceRow[];
    return rows.map((row) => this.mapSourceRow(row));
  }

  getSource(sourceId: string): KnowledgeSourceRecord | null {
    const row = this.db.prepare('SELECT * FROM knowledge_sources WHERE id = ?').get(sourceId) as KnowledgeSourceRow | undefined;
    return row ? this.mapSourceRow(row) : null;
  }

  listSourceSnapshots(sourceId: string): KnowledgeSourceSnapshotRecord[] {
    const source = this.getSource(sourceId);
    if (!source) throw new RuntimeNotFoundError(`Knowledge source ${sourceId} not found`);
    const rows = this.db.prepare(
      'SELECT * FROM knowledge_source_snapshots WHERE source_id = ? ORDER BY created_at DESC',
    ).all(sourceId) as KnowledgeSnapshotRow[];
    return rows.map((row) => this.mapSnapshotRow(row));
  }

  listDocuments(query: KnowledgeDocumentQuery): KnowledgeDocumentRecord[] {
    const trimmedQuery = query.q?.trim();
    if (trimmedQuery) {
      const ftsQuery = buildKnowledgeFtsQuery(trimmedQuery);
      if (ftsQuery) {
        try {
          const rows = this.db.prepare(`
            SELECT kd.*
            FROM knowledge_documents_fts
            JOIN knowledge_documents kd ON kd.id = knowledge_documents_fts.document_id
            WHERE knowledge_documents_fts.workspace_id = ?
              ${query.kind ? 'AND knowledge_documents_fts.kind = ?' : ''}
              AND knowledge_documents_fts MATCH ?
            ORDER BY bm25(knowledge_documents_fts, 1.0, 1.0, 0.2), kd.updated_at DESC
          `).all(
            ...(query.kind
              ? [query.workspaceId, query.kind, ftsQuery]
              : [query.workspaceId, ftsQuery]),
          ) as KnowledgeDocumentRow[];
          return rows.map((row) => this.mapDocumentRow(row));
        } catch (error) {
          this.log?.warn('knowledge fts search fell back to LIKE query', {
            workspaceId: query.workspaceId,
            query: trimmedQuery,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const clauses = ['workspace_id = ?'];
    const params: unknown[] = [query.workspaceId];
    if (query.kind) {
      clauses.push('kind = ?');
      params.push(query.kind);
    }
    if (trimmedQuery) {
      clauses.push('(title LIKE ? OR slug LIKE ?)');
      params.push(`%${trimmedQuery}%`, `%${trimmedQuery}%`);
    }
    const rows = this.db.prepare(
      `SELECT * FROM knowledge_documents WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC`,
    ).all(...params) as KnowledgeDocumentRow[];
    return rows.map((row) => this.mapDocumentRow(row));
  }

  getDocument(documentId: string): KnowledgeDocumentDetail | null {
    const row = this.db.prepare('SELECT * FROM knowledge_documents WHERE id = ?').get(documentId) as KnowledgeDocumentRow | undefined;
    if (!row) return null;
    const record = this.mapDocumentRow(row);
    const absolutePath = this.resolveDocumentAbsolutePath(record);
    const exists = existsSync(absolutePath);
    const markdownText = exists ? readFileSync(absolutePath, 'utf8') : '';
    const sourceIds = row.source_id ? [row.source_id] : [];
    return KnowledgeDocumentDetailSchema.parse({
      ...record,
      markdownText,
      exists,
      sourceIds,
    });
  }

  listDocumentRevisions(documentId: string): KnowledgeDocumentRevisionRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM knowledge_document_revisions WHERE document_id = ? ORDER BY created_at DESC',
    ).all(documentId) as KnowledgeRevisionRow[];
    return rows.map((row) => this.mapRevisionRow(row));
  }

  getNeighborhood(documentId: string): KnowledgeNeighborhood | null {
    const document = this.getDocumentRecord(documentId);
    if (!document) return null;
    const incomingRows = this.db.prepare(
      'SELECT * FROM knowledge_links WHERE target_document_id = ? ORDER BY updated_at DESC',
    ).all(documentId) as KnowledgeLinkRow[];
    const outgoingRows = this.db.prepare(
      'SELECT * FROM knowledge_links WHERE source_document_id = ? ORDER BY updated_at DESC',
    ).all(documentId) as KnowledgeLinkRow[];
    const relatedIds = new Set<string>();
    for (const row of [...incomingRows, ...outgoingRows]) {
      if (row.source_document_id !== documentId) relatedIds.add(row.source_document_id);
      if (row.target_document_id && row.target_document_id !== documentId) relatedIds.add(row.target_document_id);
    }
    const relatedDocuments = Array.from(relatedIds)
      .map((id) => this.getDocumentRecord(id))
      .filter((record): record is KnowledgeDocumentRecord => record !== null);
    return KnowledgeNeighborhoodSchema.parse({
      document,
      incoming: incomingRows.map((row) => this.mapLinkRow(row)),
      outgoing: outgoingRows.map((row) => this.mapLinkRow(row)),
      relatedDocuments,
    });
  }

  listCompileJobs(workspaceId: string): KnowledgeCompileJobRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM knowledge_compile_jobs WHERE workspace_id = ? ORDER BY created_at DESC',
    ).all(workspaceId) as KnowledgeCompileJobRow[];
    return rows.map((row) => this.mapCompileJobRow(row));
  }

  listBetaRuns(workspaceId: string, limit = 10): KnowledgeBetaRunRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM knowledge_beta_runs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?',
    ).all(workspaceId, limit) as KnowledgeBetaRunRow[];
    return rows.map((row) => this.mapBetaRunRow(row));
  }

  getBetaRun(runId: string): KnowledgeBetaRunDetail | null {
    const row = this.db.prepare('SELECT * FROM knowledge_beta_runs WHERE id = ?').get(runId) as KnowledgeBetaRunRow | undefined;
    return row ? this.mapBetaRunDetailRow(row) : null;
  }

  getAudit(workspaceId: string): KnowledgeAuditReport {
    const totalSources = this.scalarCount('SELECT COUNT(*) AS c FROM knowledge_sources WHERE workspace_id = ?', workspaceId);
    const totalDocuments = this.scalarCount('SELECT COUNT(*) AS c FROM knowledge_documents WHERE workspace_id = ?', workspaceId);
    const totalDraftRevisions = this.scalarCount("SELECT COUNT(*) AS c FROM knowledge_document_revisions WHERE workspace_id = ? AND status = 'draft'", workspaceId);
    const unresolvedLinks = this.scalarCount("SELECT COUNT(*) AS c FROM knowledge_links WHERE workspace_id = ? AND link_status = 'unresolved'", workspaceId);
    const brokenLinks = this.scalarCount("SELECT COUNT(*) AS c FROM knowledge_links WHERE workspace_id = ? AND link_status = 'broken'", workspaceId);
    const failedConversions = this.scalarCount("SELECT COUNT(*) AS c FROM knowledge_sources WHERE workspace_id = ? AND status = 'conversion_failed'", workspaceId);
    const degradedSources = this.scalarCount("SELECT COUNT(*) AS c FROM knowledge_sources WHERE workspace_id = ? AND status = 'degraded'", workspaceId);
    const warningSources = this.scalarCount("SELECT COUNT(*) AS c FROM knowledge_sources WHERE workspace_id = ? AND status = 'compiled_with_warnings'", workspaceId);
    const assetLocalizationFailures = this.scalarCount(
      "SELECT COUNT(*) AS c FROM knowledge_sources WHERE workspace_id = ? AND asset_status IN ('partial_failure', 'failed')",
      workspaceId,
    );
    const lastCompileRow = this.db.prepare(
      "SELECT MAX(updated_at) AS value FROM knowledge_compile_jobs WHERE workspace_id = ? AND status = 'succeeded'",
    ).get(workspaceId) as { value: string | null } | undefined;
    return KnowledgeAuditReportSchema.parse({
      totalSources,
      totalDocuments,
      totalDraftRevisions,
      unresolvedLinks,
      brokenLinks,
      failedConversions,
      degradedSources,
      warningSources,
      assetLocalizationFailures,
      lastCompileAt: lastCompileRow?.value ?? null,
    });
  }

  recordBetaRun(input: KnowledgeBetaRunCreateInput): KnowledgeBetaRunDetail {
    const workspace = this.workspaceRegistry.getWorkspace(input.workspaceId);
    if (!workspace) {
      throw new RuntimeValidationError(`Workspace ${input.workspaceId} not found`);
    }

    const id = randomUUID();
    const createdAt = nowIso();
    const hardFailureCount = input.imports.filter((row) => Boolean(row.error)).length;
    const importSuccessRate = input.imports.length === 0
      ? 0
      : (input.imports.length - hardFailureCount) / input.imports.length;

    this.db.prepare(
      `INSERT INTO knowledge_beta_runs (
        id, workspace_id, manifest_path, report_markdown, imports_json, reingests_json, converters_json,
        audit_json, gate_json, import_count, reingest_count, hard_failure_count, import_success_rate,
        gate_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.workspaceId,
      input.manifestPath ?? null,
      input.reportMarkdown,
      JSON.stringify(input.imports),
      JSON.stringify(input.reingests),
      JSON.stringify(input.converters),
      JSON.stringify(input.audit),
      JSON.stringify(input.gate),
      input.imports.length,
      input.reingests.length,
      hardFailureCount,
      importSuccessRate,
      input.gate.status,
      createdAt,
    );

    return this.getBetaRun(id)!;
  }

  async listConverters(): Promise<KnowledgeConverterAvailability[]> {
    const converters: Array<{
      id: KnowledgeConverterId;
      fallbackRank: number;
      usedFor: KnowledgeImportInput['sourceType'][];
      check: () => Promise<{
        status: 'ready' | 'missing' | 'degraded';
        provenance: KnowledgeConverterProvenance;
        details: string;
        version: string | null;
        installHint: string | null;
      }>;
    }> = [
      {
        id: 'jina_reader',
        fallbackRank: 1,
        usedFor: ['website', 'x_post'],
        check: async () => {
          try {
            const response = await this.fetchImpl('https://r.jina.ai/http://example.com', {
              signal: AbortSignal.timeout(2500),
            });
            if (!response.ok) {
              return {
                status: 'degraded',
                details: `Remote Jina Reader probe returned ${response.status}. Imports can still fall back locally.`,
                version: null,
                provenance: 'remote' as const,
                installHint: 'Ensure the runtime can reach https://r.jina.ai over outbound HTTPS.',
              };
            }
            return {
              status: 'ready',
              details: 'Remote Jina Reader probe succeeded.',
              version: null,
              provenance: 'remote' as const,
              installHint: 'Ensure the runtime can reach https://r.jina.ai over outbound HTTPS.',
            };
          } catch (error) {
            return {
              status: 'degraded',
              details: `Remote Jina Reader probe failed: ${error instanceof Error ? error.message : String(error)}`,
              version: null,
              provenance: 'remote' as const,
              installHint: 'Ensure the runtime can reach https://r.jina.ai over outbound HTTPS.',
            };
          }
        },
      },
      {
        id: 'trafilatura',
        fallbackRank: 2,
        usedFor: ['website', 'x_post'],
        check: async () => {
          const detected = await this.detectPythonModule('trafilatura');
          return {
            ...detected,
            installHint: detected.status === 'ready' ? null : this.buildPythonInstallHint(detected.provenance, 'trafilatura'),
          };
        },
      },
      {
        id: 'markitdown',
        fallbackRank: 1,
        usedFor: ['local_file', 'pdf', 'image'],
        check: async () => {
          const markitdown = this.resolveMarkitdown();
          try {
            const result = await this.runCommand(markitdown.command, ['--version']);
            const version = result.stdout.trim() || result.stderr.trim() || null;
            return {
              status: 'ready',
              details: `MarkItDown is available via ${markitdown.provenance === 'bundled' ? 'the bundled Popeye Knowledge runtime' : 'the system environment'}.`,
              version,
              provenance: markitdown.provenance,
              installHint: null,
            };
          } catch (error) {
            return {
              status: 'missing',
              details: `MarkItDown is unavailable via ${markitdown.provenance === 'bundled' ? 'the bundled Popeye Knowledge runtime' : 'the system environment'}: ${error instanceof Error ? error.message : String(error)}`,
              version: null,
              provenance: markitdown.provenance === 'bundled' ? 'bundled' : 'missing',
              installHint: this.buildPythonInstallHint(markitdown.provenance, 'markitdown[docx,pdf,pptx,xls,xlsx]'),
            };
          }
        },
      },
      {
        id: 'docling',
        fallbackRank: 2,
        usedFor: ['local_file', 'pdf', 'image'],
        check: async () => {
          const detected = await this.detectPythonModule('docling');
          return {
            ...detected,
            installHint: detected.status === 'ready' ? null : this.buildPythonInstallHint(detected.provenance, 'docling'),
          };
        },
      },
    ];

    const results = await Promise.all(converters.map(async (converter) => {
      const status = await converter.check();
      return KnowledgeConverterAvailabilitySchema.parse({
        id: converter.id,
        fallbackRank: converter.fallbackRank,
        usedFor: converter.usedFor,
        status: status.status,
        provenance: status.provenance,
        details: status.details,
        version: status.version,
        lastCheckedAt: nowIso(),
        installHint: status.installHint,
      });
    }));
    return results.sort((left, right) => left.fallbackRank - right.fallbackRank || left.id.localeCompare(right.id));
  }

  async importSource(input: KnowledgeImportInput, actorRole: AuthRole = 'operator'): Promise<KnowledgeImportResult> {
    const canonicalSourceKey = this.buildCanonicalSourceKey(input);
    const existing = canonicalSourceKey
      ? this.db.prepare('SELECT * FROM knowledge_sources WHERE workspace_id = ? AND canonical_source_key = ?')
        .get(input.workspaceId, canonicalSourceKey) as KnowledgeSourceRow | undefined
      : undefined;
    return this.ingestSource(input, actorRole, existing ?? null, canonicalSourceKey);
  }

  async reingestSource(sourceId: string, actorRole: AuthRole = 'operator'): Promise<KnowledgeImportResult> {
    const source = this.db.prepare('SELECT * FROM knowledge_sources WHERE id = ?').get(sourceId) as KnowledgeSourceRow | undefined;
    if (!source) throw new RuntimeNotFoundError(`Knowledge source ${sourceId} not found`);

    let sourceText: string | undefined;
    if (source.source_type === 'manual_text') {
      const originalCapturePath = source.original_file_name
        ? join(source.original_dir_path, source.original_file_name)
        : source.normalized_markdown_path;
      if (!existsSync(originalCapturePath)) {
        throw new RuntimeValidationError(`Knowledge source ${sourceId} cannot be reingested because its original capture is missing`);
      }
      sourceText = readFileSync(originalCapturePath, 'utf8');
    }

    return this.ingestSource({
      workspaceId: source.workspace_id,
      sourceType: source.source_type as KnowledgeImportInput['sourceType'],
      title: source.title,
      sourceUri: source.original_uri ?? undefined,
      sourcePath: source.original_path ?? undefined,
      sourceText,
    }, actorRole, source, source.canonical_source_key ?? this.buildCanonicalSourceKey({
      workspaceId: source.workspace_id,
      sourceType: source.source_type as KnowledgeImportInput['sourceType'],
      title: source.title,
      sourceUri: source.original_uri ?? undefined,
      sourcePath: source.original_path ?? undefined,
      sourceText,
    }));
  }

  private async ingestSource(
    input: KnowledgeImportInput,
    actorRole: AuthRole,
    existingSourceRow: KnowledgeSourceRow | null,
    canonicalSourceKey: string,
  ): Promise<KnowledgeImportResult> {
    const workspace = this.workspaceRegistry.getWorkspace(input.workspaceId);
    if (!workspace?.rootPath) {
      throw new RuntimeValidationError(`Workspace ${input.workspaceId} does not have a root path configured`);
    }

    const knowledgeRoot = this.ensureKnowledgeRoot(input.workspaceId);
    const sourceId = existingSourceRow?.id ?? randomUUID();
    const sourceDir = join(knowledgeRoot.rootPath, 'raw', sourceId);
    const latestOriginalDir = join(sourceDir, 'original');
    const latestNormalizedPath = join(sourceDir, 'normalized', 'source.md');
    const latestAssetsDir = join(sourceDir, 'assets');

    const converted = await this.convertSource(input);
    const localized = await this.localizeAssets(input, converted.normalizedMarkdown);
    const mergedWarnings = [...converted.warnings, ...localized.warnings];
    const normalizedMarkdown = normalizeMarkdown(localized.markdown);
    const redacted = redactText(normalizedMarkdown, this.redactionPatterns);
    for (const event of redacted.events) this.recordSecurityAudit(event);

    const now = nowIso();
    const contentHash = sha256(redacted.text);
    const status = this.classifySourceStatus(converted.fallbackUsed, mergedWarnings, localized.assetStatus);

    const unchanged = existingSourceRow
      ? this.isSourceAttemptUnchanged(existingSourceRow, {
          contentHash,
          adapter: converted.adapter,
          fallbackUsed: converted.fallbackUsed,
          status,
          assetStatus: localized.assetStatus,
          warnings: mergedWarnings,
        })
      : false;
    const outcome: KnowledgeImportOutcome = existingSourceRow
      ? unchanged ? 'unchanged' : 'updated'
      : 'created';
    const snapshotOutcome: 'created' | 'updated' = existingSourceRow ? 'updated' : 'created';

    let normalizedDocument = this.getNormalizedDocumentForSource(sourceId);
    let draftRevision: KnowledgeDocumentRevisionRecord | null = null;

    if (!existingSourceRow) {
      this.persistLatestSourceArtifacts({
        originalDir: latestOriginalDir,
        normalizedPath: latestNormalizedPath,
        assetsDir: latestAssetsDir,
        converted,
        normalizedMarkdown: redacted.text,
        assetFiles: localized.files,
      });

      this.db.prepare(
        `INSERT INTO knowledge_sources (
          id, workspace_id, knowledge_root_id, source_type, title, original_uri, original_path, original_file_name,
          original_media_type, adapter, fallback_used, status, content_hash, asset_status, canonical_source_key,
          latest_outcome, original_dir_path, normalized_markdown_path, conversion_warnings_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        sourceId,
        input.workspaceId,
        knowledgeRoot.id,
        input.sourceType,
        input.title,
        input.sourceUri ?? null,
        input.sourcePath ?? null,
        converted.originalFileName,
        converted.originalMediaType,
        converted.adapter,
        converted.fallbackUsed ? 1 : 0,
        status,
        contentHash,
        localized.assetStatus,
        canonicalSourceKey,
        outcome,
        latestOriginalDir,
        latestNormalizedPath,
        JSON.stringify(mergedWarnings),
        now,
        now,
      );
      this.insertSourceSnapshot({
        sourceId,
        workspaceId: input.workspaceId,
        converted,
        contentHash,
        status,
        assetStatus: localized.assetStatus,
        outcome: snapshotOutcome,
        warnings: mergedWarnings,
        sourceDir,
        normalizedMarkdown: redacted.text,
        assetFiles: localized.files,
      });
    } else {
      this.db.prepare(
        `UPDATE knowledge_sources
         SET title = ?, original_uri = ?, original_path = ?, original_file_name = ?, original_media_type = ?, adapter = ?,
             fallback_used = ?, status = ?, content_hash = ?, asset_status = ?, canonical_source_key = ?, latest_outcome = ?,
             original_dir_path = ?, normalized_markdown_path = ?, conversion_warnings_json = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        input.title,
        input.sourceUri ?? existingSourceRow.original_uri,
        input.sourcePath ?? existingSourceRow.original_path,
        converted.originalFileName ?? existingSourceRow.original_file_name,
        converted.originalMediaType ?? existingSourceRow.original_media_type,
        converted.adapter,
        converted.fallbackUsed ? 1 : 0,
        status,
        contentHash,
        localized.assetStatus,
        canonicalSourceKey,
        outcome,
        latestOriginalDir,
        latestNormalizedPath,
        JSON.stringify(mergedWarnings),
        now,
        existingSourceRow.id,
      );

      if (!unchanged) {
        this.persistLatestSourceArtifacts({
          originalDir: latestOriginalDir,
          normalizedPath: latestNormalizedPath,
          assetsDir: latestAssetsDir,
          converted,
          normalizedMarkdown: redacted.text,
          assetFiles: localized.files,
        });
        this.insertSourceSnapshot({
          sourceId,
          workspaceId: input.workspaceId,
          converted,
          contentHash,
          status,
          assetStatus: localized.assetStatus,
          outcome: 'updated',
          warnings: mergedWarnings,
          sourceDir,
          normalizedMarkdown: redacted.text,
          assetFiles: localized.files,
        });
      }
    }

    normalizedDocument = this.upsertDocument({
      workspaceId: input.workspaceId,
      knowledgeRootId: knowledgeRoot.id,
      sourceId,
      kind: 'source_normalized',
      title: input.title,
      slug: normalizedDocument?.slug ?? `${slugify(input.title)}-${sourceId.slice(0, 8)}`,
      relativePath: relative(knowledgeRoot.rootPath, latestNormalizedPath).replace(/\\/g, '/'),
      revisionHash: buildRevisionHash(redacted.text),
      status: 'active',
    });
    this.syncDocumentSearchEntry(normalizedDocument, redacted.text);

    if (!unchanged) {
      this.refreshLinksForDocument(normalizedDocument.id, redacted.text, input.workspaceId);
    }

    const source = this.getSource(sourceId)!;
    let compileJob: KnowledgeCompileJobRecord;
    if (unchanged) {
      compileJob = this.createCompileJob({
        workspaceId: input.workspaceId,
        sourceId,
        targetDocumentId: normalizedDocument.id,
        summary: `Source unchanged for ${input.title}`,
        warnings: mergedWarnings,
      });
    } else {
      const result = await this.createCompileDraftForSource(source, normalizedDocument, redacted.text);
      draftRevision = result.draftRevision;
      compileJob = result.compileJob;
    }

    if (!unchanged) {
      try {
        this.reindexFileRoot(knowledgeRoot.id);
      } catch (error) {
        this.log?.warn('knowledge reindex failed after import', { sourceId, error: error instanceof Error ? error.message : String(error) });
      }
    }

    const verb = existingSourceRow ? 'Reingested' : 'Imported';
    this.writeMutationReceipt({
      kind: 'knowledge_import',
      component: 'knowledge',
      status: 'succeeded',
      summary: `${verb} knowledge source ${input.title}`,
      details: unchanged
        ? `${verb} ${input.sourceType}; content was unchanged, so Popeye kept the existing compiled wiki state.`
        : `${verb} ${input.sourceType} into ${knowledgeRoot.rootPath} and created a draft wiki revision.`,
      actorRole,
      workspaceId: input.workspaceId,
      metadata: {
        sourceId,
        knowledgeRootId: knowledgeRoot.id,
        adapter: source.adapter,
        outcome,
      },
    });

    // Append to wiki log and regenerate index
    const logOp: KnowledgeLogOperation = existingSourceRow ? 'reingest' : 'ingest';
    this.appendToLog(input.workspaceId, logOp, `${verb} "${input.title}" (${input.sourceType})`, [normalizedDocument.id]);
    try {
      await this.regenerateIndex(input.workspaceId);
    } catch (error) {
      this.log?.warn('index regeneration failed after import', { error: error instanceof Error ? error.message : String(error) });
    }

    return KnowledgeImportResultSchema.parse({
      source,
      normalizedDocument,
      compileJob,
      draftRevision,
      outcome,
    });
  }

  private buildCanonicalSourceKey(input: KnowledgeImportInput): string {
    switch (input.sourceType) {
      case 'website':
      case 'x_post':
        return `${input.sourceType}:${canonicalizeUrlSource(input.sourceUri ?? '')}`;
      case 'repo': {
        const resolvedPath = input.sourcePath ? resolve(input.sourcePath) : '';
        const rootPath = resolvedPath && existsSync(resolvedPath) ? realpathSync(resolvedPath) : resolvedPath;
        return `repo:${rootPath}`;
      }
      case 'local_file':
      case 'pdf':
      case 'image':
      case 'dataset': {
        const path = input.sourcePath ? resolve(input.sourcePath) : '';
        const realPath = path && existsSync(path) ? realpathSync(path) : path;
        return `${input.sourceType}:${realPath}`;
      }
      case 'manual_text': {
        return `manual_text:${slugify(input.title)}`;
      }
    }
  }

  private classifySourceStatus(
    fallbackUsed: boolean,
    warnings: string[],
    assetStatus: KnowledgeAssetStatus,
  ): KnowledgeSourceRow['status'] {
    if (assetStatus === 'failed' && warnings.length > 0) return 'degraded';
    if (fallbackUsed && warnings.length > 0) return 'degraded';
    if (warnings.length > 0 || assetStatus === 'partial_failure') return 'compiled_with_warnings';
    return 'compiled';
  }

  private isSourceAttemptUnchanged(
    existingSource: KnowledgeSourceRow,
    next: {
      contentHash: string;
      adapter: KnowledgeConversionAdapter;
      fallbackUsed: boolean;
      status: string;
      assetStatus: KnowledgeAssetStatus;
      warnings: string[];
    },
  ): boolean {
    return existingSource.content_hash === next.contentHash
      && existingSource.adapter === next.adapter
      && Boolean(existingSource.fallback_used) === next.fallbackUsed
      && existingSource.status === next.status
      && existingSource.asset_status === next.assetStatus
      && (existingSource.conversion_warnings_json || '[]') === JSON.stringify(next.warnings);
  }

  private persistLatestSourceArtifacts(input: {
    originalDir: string;
    normalizedPath: string;
    assetsDir: string;
    converted: ConvertedSource;
    normalizedMarkdown: string;
    assetFiles: Array<{ fileName: string; content: Buffer }>;
  }): void {
    rmSync(input.originalDir, { recursive: true, force: true });
    rmSync(dirname(input.normalizedPath), { recursive: true, force: true });
    rmSync(input.assetsDir, { recursive: true, force: true });
    mkdirSync(input.originalDir, { recursive: true, mode: 0o700 });
    mkdirSync(dirname(input.normalizedPath), { recursive: true, mode: 0o700 });
    mkdirSync(input.assetsDir, { recursive: true, mode: 0o700 });
    if (Buffer.isBuffer(input.converted.originalContentToPersist)) {
      writeBinary(join(input.originalDir, input.converted.originalPersistenceName), input.converted.originalContentToPersist);
    } else {
      writeUtf8(join(input.originalDir, input.converted.originalPersistenceName), String(input.converted.originalContentToPersist));
    }
    for (const artifact of input.converted.extraOriginalArtifacts ?? []) {
      if (Buffer.isBuffer(artifact.content)) {
        writeBinary(join(input.originalDir, artifact.fileName), artifact.content);
      } else {
        writeUtf8(join(input.originalDir, artifact.fileName), String(artifact.content));
      }
    }
    writeUtf8(input.normalizedPath, input.normalizedMarkdown);
    for (const file of input.assetFiles) {
      writeBinary(join(input.assetsDir, file.fileName), file.content);
    }
  }

  private insertSourceSnapshot(input: {
    sourceId: string;
    workspaceId: string;
    converted: ConvertedSource;
    contentHash: string;
    status: string;
    assetStatus: KnowledgeAssetStatus;
    outcome: 'created' | 'updated';
    warnings: string[];
    sourceDir: string;
    normalizedMarkdown: string;
    assetFiles: Array<{ fileName: string; content: Buffer }>;
  }): void {
    const snapshotId = randomUUID();
    const snapshotDir = join(input.sourceDir, 'snapshots', snapshotId);
    const snapshotOriginalDir = join(snapshotDir, 'original');
    const snapshotNormalizedPath = join(snapshotDir, 'normalized', 'source.md');
    const snapshotAssetsDir = join(snapshotDir, 'assets');
    if (Buffer.isBuffer(input.converted.originalContentToPersist)) {
      writeBinary(join(snapshotOriginalDir, input.converted.originalPersistenceName), input.converted.originalContentToPersist);
    } else {
      writeUtf8(join(snapshotOriginalDir, input.converted.originalPersistenceName), String(input.converted.originalContentToPersist));
    }
    for (const artifact of input.converted.extraOriginalArtifacts ?? []) {
      if (Buffer.isBuffer(artifact.content)) {
        writeBinary(join(snapshotOriginalDir, artifact.fileName), artifact.content);
      } else {
        writeUtf8(join(snapshotOriginalDir, artifact.fileName), String(artifact.content));
      }
    }
    writeUtf8(snapshotNormalizedPath, input.normalizedMarkdown);
    for (const file of input.assetFiles) {
      writeBinary(join(snapshotAssetsDir, file.fileName), file.content);
    }
    this.db.prepare(
      `INSERT INTO knowledge_source_snapshots (
        id, source_id, workspace_id, content_hash, adapter, fallback_used, status, asset_status, original_dir_path,
        normalized_markdown_path, assets_dir_path, conversion_warnings_json, outcome, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      snapshotId,
      input.sourceId,
      input.workspaceId,
      input.contentHash,
      input.converted.adapter,
      input.converted.fallbackUsed ? 1 : 0,
      input.status,
      input.assetStatus,
      snapshotOriginalDir,
      snapshotNormalizedPath,
      snapshotAssetsDir,
      JSON.stringify(input.warnings),
      input.outcome,
      nowIso(),
    );
  }

  private async localizeAssets(
    input: KnowledgeImportInput,
    markdown: string,
  ): Promise<{
    markdown: string;
    assetStatus: KnowledgeAssetStatus;
    warnings: string[];
    files: Array<{ fileName: string; content: Buffer }>;
  }> {
    const refs = extractMarkdownImageRefs(markdown);
    if (refs.length === 0) {
      return { markdown, assetStatus: 'none', warnings: [], files: [] };
    }

    const warnings: string[] = [];
    const replacements = new Map<string, string>();
    const files = new Map<string, Buffer>();
    const baseDir = input.sourcePath
      ? (input.sourceType === 'repo' ? realpathSync(resolve(input.sourcePath)) : dirname(realpathSync(resolve(input.sourcePath))))
      : null;
    const baseUrl = input.sourceUri ? canonicalizeUrlSource(input.sourceUri) : null;
    let localizedCount = 0;
    let failedCount = 0;

    for (const ref of refs) {
      const resolved = await this.resolveAsset(ref, baseDir, baseUrl);
      if (!resolved) {
        warnings.push(`Could not localize asset: ${ref}`);
        failedCount += 1;
        continue;
      }

      const baseName = sanitizeFileName(
        basename(resolved.fileNameHint || `asset${extensionForContentType(resolved.mediaType)}`),
      );
      const extension = extname(baseName) || extensionForContentType(resolved.mediaType) || '.bin';
      const stem = extname(baseName) ? baseName.slice(0, -extname(baseName).length) : baseName;
      const fileName = `${sha256(ref).slice(0, 8)}-${sanitizeFileName(stem)}${extension}`;
      files.set(fileName, resolved.content);
      replacements.set(ref, `../assets/${fileName}`);
      localizedCount += 1;
    }

    const localizedMarkdown = markdown
      .replace(/!\[([^\]]*)]\(([^)]+)\)/g, (match, alt, rawRef) => {
        const cleanRef = String(rawRef).trim().replace(/^<|>$/g, '').split(/\s+"/, 1)[0]?.trim();
        const replacement = cleanRef ? replacements.get(cleanRef) : null;
        return replacement ? `![${alt}](${replacement})` : match;
      })
      .replace(/<img\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>/gi, (match, before, rawRef, after) => {
        const replacement = replacements.get(String(rawRef).trim());
        return replacement ? `<img${before}src="${replacement}"${after}>` : match;
      });

    const assetStatus: KnowledgeAssetStatus = localizedCount === 0
      ? 'failed'
      : failedCount === 0 ? 'localized' : 'partial_failure';

    return {
      markdown: localizedMarkdown,
      assetStatus: KnowledgeAssetStatusSchema.parse(assetStatus),
      warnings,
      files: Array.from(files.entries()).map(([fileName, content]) => ({ fileName, content })),
    };
  }

  private async resolveAsset(
    ref: string,
    baseDir: string | null,
    baseUrl: string | null,
  ): Promise<{ content: Buffer; fileNameHint: string; mediaType: string | null } | null> {
    const trimmed = ref.trim();
    if (trimmed.startsWith('data:')) {
      const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(trimmed);
      if (!match) return null;
      const mediaType = match[1] ?? null;
      const isBase64 = Boolean(match[2]);
      const body = match[3] ?? '';
      return {
        content: isBase64 ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8'),
        fileNameHint: `inline${extensionForContentType(mediaType) || '.bin'}`,
        mediaType,
      };
    }

    const tryRemote = async (target: string): Promise<{ content: Buffer; fileNameHint: string; mediaType: string | null } | null> => {
      try {
        const response = await this.fetchImpl(target, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) return null;
        const arrayBuffer = await response.arrayBuffer();
        return {
          content: Buffer.from(arrayBuffer),
          fileNameHint: basename(new URL(target).pathname || 'asset'),
          mediaType: response.headers.get('content-type'),
        };
      } catch {
        return null;
      }
    };

    if (/^https?:\/\//i.test(trimmed)) {
      return tryRemote(trimmed);
    }

    if (baseUrl) {
      try {
        const target = new URL(trimmed, baseUrl).toString();
        const remote = await tryRemote(target);
        if (remote) return remote;
      } catch {
        // fall through to local resolution
      }
    }

    if (baseDir) {
      const cleanPath = trimmed.split(/[?#]/, 1)[0] ?? trimmed;
      const absolutePath = resolve(baseDir, cleanPath);
      if (existsSync(absolutePath) && statSync(absolutePath).isFile()) {
        return {
          content: readFileSync(absolutePath),
          fileNameHint: basename(absolutePath),
          mediaType: null,
        };
      }
    }

    return null;
  }

  private getNormalizedDocumentForSource(sourceId: string): KnowledgeDocumentRecord | null {
    const row = this.db.prepare(
      "SELECT * FROM knowledge_documents WHERE source_id = ? AND kind = 'source_normalized' ORDER BY updated_at DESC LIMIT 1",
    ).get(sourceId) as KnowledgeDocumentRow | undefined;
    return row ? this.mapDocumentRow(row) : null;
  }

  private createCompileJob(input: {
    workspaceId: string;
    sourceId: string | null;
    targetDocumentId: string | null;
    summary: string;
    warnings: string[];
  }): KnowledgeCompileJobRecord {
    const id = randomUUID();
    const now = nowIso();
    this.db.prepare(
      `INSERT INTO knowledge_compile_jobs (
        id, workspace_id, source_id, target_document_id, status, summary, warnings_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'succeeded', ?, ?, ?, ?)`,
    ).run(
      id,
      input.workspaceId,
      input.sourceId,
      input.targetDocumentId,
      input.summary,
      JSON.stringify(input.warnings),
      now,
      now,
    );
    return this.mapCompileJobRow(
      this.db.prepare('SELECT * FROM knowledge_compile_jobs WHERE id = ?').get(id) as KnowledgeCompileJobRow,
    );
  }

  private async detectPythonModule(moduleName: string): Promise<{
    status: 'ready' | 'missing' | 'degraded';
    details: string;
    version: string | null;
    provenance: KnowledgeConverterProvenance;
  }> {
    const python = this.resolveKnowledgePython();
    try {
      const script = [
        'import importlib.metadata',
        'import importlib.util',
        'import sys',
        `name = ${JSON.stringify(moduleName)}`,
        'spec = importlib.util.find_spec(name)',
        'print((importlib.metadata.version(name) if spec else ""))',
        'sys.exit(0 if spec else 2)',
      ].join('; ');
      const result = await this.runCommand(python.command, ['-c', script]);
      return {
        status: 'ready',
        details: `${moduleName} is available via ${python.provenance === 'bundled' ? 'the bundled Popeye Knowledge runtime' : 'the system Python environment'}.`,
        version: result.stdout.trim() || null,
        provenance: python.provenance,
      };
    } catch (error) {
      return {
        status: 'missing',
        details: `${moduleName} is unavailable via ${python.provenance === 'bundled' ? 'the bundled Popeye Knowledge runtime' : 'the system Python environment'}: ${error instanceof Error ? error.message : String(error)}`,
        version: null,
        provenance: python.provenance === 'bundled' ? 'bundled' : 'missing',
      };
    }
  }

  async proposeRevision(
    documentId: string,
    input: KnowledgeDocumentRevisionProposalInput,
  ): Promise<KnowledgeDocumentRevisionRecord> {
    const document = this.getDocument(documentId);
    if (!document) {
      throw new RuntimeNotFoundError(`Knowledge document ${documentId} not found`);
    }
    if (document.kind === 'source_normalized') {
      throw new RuntimeValidationError('Normalized source documents are immutable');
    }

    const redacted = redactText(normalizeMarkdown(input.markdownText), this.redactionPatterns);
    for (const event of redacted.events) this.recordSecurityAudit(event);

    const baseRevisionHash = input.baseRevisionHash ?? document.revisionHash;
    if (input.baseRevisionHash !== undefined && input.baseRevisionHash !== document.revisionHash) {
      throw new RuntimeConflictError('Knowledge document changed since it was loaded');
    }

    const revisionId = randomUUID();
    const now = nowIso();
    this.db.prepare(
      `INSERT INTO knowledge_document_revisions (
        id, document_id, workspace_id, status, source_kind, source_id, proposed_title, proposed_markdown,
        diff_preview, base_revision_hash, created_at, applied_at
      ) VALUES (?, ?, ?, 'draft', 'manual', NULL, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      revisionId,
      documentId,
      document.workspaceId,
      input.title ?? null,
      redacted.text,
      buildPlaybookDiff(document.exists ? document.markdownText : null, redacted.text),
      baseRevisionHash ?? null,
      now,
    );
    return this.listDocumentRevisions(documentId)[0]!;
  }

  async applyRevision(
    revisionId: string,
    input: KnowledgeDocumentRevisionApplyInput,
    actorRole: AuthRole = 'operator',
  ): Promise<KnowledgeRevisionApplyResult> {
    const row = this.db.prepare('SELECT * FROM knowledge_document_revisions WHERE id = ?').get(revisionId) as KnowledgeRevisionRow | undefined;
    if (!row) throw new RuntimeNotFoundError(`Knowledge revision ${revisionId} not found`);
    if (row.status !== 'draft') throw new RuntimeConflictError(`Knowledge revision ${revisionId} is no longer draft`);
    if (!input.approved) throw new RuntimeValidationError('Knowledge revision apply must be approved');

    const document = this.getDocument(row.document_id);
    if (!document) throw new RuntimeNotFoundError(`Knowledge document ${row.document_id} not found`);
    if (document.kind === 'source_normalized') {
      throw new RuntimeValidationError('Normalized source documents are immutable');
    }
    if (row.base_revision_hash && row.base_revision_hash !== document.revisionHash) {
      throw new RuntimeConflictError('Knowledge document changed since the revision was created');
    }

    const absolutePath = this.resolveDocumentAbsolutePath(document);
    writeUtf8(absolutePath, row.proposed_markdown);
    const revisionHash = buildRevisionHash(row.proposed_markdown);
    const now = nowIso();
    this.db.prepare(
      'UPDATE knowledge_documents SET title = ?, revision_hash = ?, status = ?, updated_at = ? WHERE id = ?',
    ).run(row.proposed_title ?? document.title, revisionHash, 'active', now, document.id);
    this.db.prepare(
      "UPDATE knowledge_document_revisions SET status = 'applied', applied_at = ? WHERE id = ?",
    ).run(now, revisionId);
    this.syncDocumentSearchEntry(this.getDocumentRecord(document.id)!, row.proposed_markdown);

    this.refreshLinksForDocument(document.id, row.proposed_markdown, document.workspaceId);
    try {
      this.reindexFileRoot(document.knowledgeRootId);
    } catch (error) {
      this.log?.warn('knowledge reindex failed after apply', { documentId: document.id, error: error instanceof Error ? error.message : String(error) });
    }

    const receipt = this.writeMutationReceipt({
      kind: 'knowledge_revision_apply',
      component: 'knowledge',
      status: 'succeeded',
      summary: `Applied knowledge revision for ${row.proposed_title ?? document.title}`,
      details: `Applied knowledge revision ${revisionId} to ${document.relativePath}.`,
      actorRole,
      workspaceId: document.workspaceId,
      metadata: {
        documentId: document.id,
        revisionId,
      },
    });

    this.appendToLog(document.workspaceId, 'revision_applied', `Applied revision for "${row.proposed_title ?? document.title}"`, [document.id]);

    return KnowledgeRevisionApplyResultSchema.parse({
      revision: this.listDocumentRevisions(document.id).find((revision) => revision.id === revisionId)!,
      document: this.getDocument(document.id)!,
      receipt,
    });
  }

  async rejectRevision(
    revisionId: string,
    actorRole: AuthRole = 'operator',
  ): Promise<KnowledgeRevisionRejectResult> {
    const row = this.db.prepare('SELECT * FROM knowledge_document_revisions WHERE id = ?').get(revisionId) as KnowledgeRevisionRow | undefined;
    if (!row) throw new RuntimeNotFoundError(`Knowledge revision ${revisionId} not found`);
    if (row.status !== 'draft') throw new RuntimeConflictError(`Knowledge revision ${revisionId} is no longer draft`);

    const document = this.getDocument(row.document_id);
    if (!document) throw new RuntimeNotFoundError(`Knowledge document ${row.document_id} not found`);

    this.db.prepare(
      "UPDATE knowledge_document_revisions SET status = 'rejected', applied_at = NULL WHERE id = ?",
    ).run(revisionId);

    const receipt = this.writeMutationReceipt({
      kind: 'knowledge_revision_reject',
      component: 'knowledge',
      status: 'succeeded',
      summary: `Rejected knowledge revision for ${row.proposed_title ?? document.title}`,
      details: `Rejected knowledge revision ${revisionId} for ${document.relativePath}.`,
      actorRole,
      workspaceId: document.workspaceId,
      metadata: {
        documentId: document.id,
        revisionId,
      },
    });

    return KnowledgeRevisionRejectResultSchema.parse({
      revision: this.listDocumentRevisions(document.id).find((revision) => revision.id === revisionId)!,
      document: this.getDocument(document.id)!,
      receipt,
    });
  }

  createLink(input: KnowledgeLinkCreateInput): KnowledgeLinkRecord {
    const sourceDocument = this.getDocumentRecord(input.sourceDocumentId);
    if (!sourceDocument) throw new RuntimeNotFoundError(`Knowledge document ${input.sourceDocumentId} not found`);
    const targetDocument = input.targetDocumentId ? this.getDocumentRecord(input.targetDocumentId) : null;
    if (input.targetDocumentId && !targetDocument) {
      throw new RuntimeNotFoundError(`Knowledge document ${input.targetDocumentId} not found`);
    }
    const now = nowIso();
    const id = randomUUID();
    const targetSlug = targetDocument?.slug ?? input.targetSlug ?? slugify(input.targetLabel);
    this.db.prepare(
      `INSERT INTO knowledge_links (
        id, workspace_id, source_document_id, target_document_id, target_slug, target_label, link_kind,
        link_status, confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      sourceDocument.workspaceId,
      sourceDocument.id,
      targetDocument?.id ?? null,
      targetSlug,
      input.targetLabel,
      input.linkKind,
      targetDocument ? 'active' : 'unresolved',
      1,
      now,
      now,
    );
    return this.mapLinkRow(this.db.prepare('SELECT * FROM knowledge_links WHERE id = ?').get(id) as KnowledgeLinkRow);
  }

  private ensureKnowledgeRoot(workspaceId: string): FileRootRecord {
    const existing = this.listFileRoots(workspaceId).find((root) => root.enabled && root.kind === 'knowledge_base');
    if (existing) {
      ensureDir(existing.rootPath);
      return existing;
    }
    const workspace = this.workspaceRegistry.getWorkspace(workspaceId);
    if (!workspace?.rootPath) {
      throw new RuntimeValidationError(`Workspace ${workspaceId} does not have a root path configured`);
    }
    const rootPath = join(workspace.rootPath, 'knowledge');
    ensureDir(rootPath);
    return this.registerFileRoot({
      workspaceId,
      label: 'Knowledge Base',
      rootPath,
      kind: 'knowledge_base',
      permission: 'index_and_derive',
      filePatterns: ['**/*.md', '**/*.txt'],
      excludePatterns: [],
      maxFileSizeBytes: 10 * 1024 * 1024,
    });
  }

  private resolveKnowledgeRoot(workspaceId: string, knowledgeRootId: string): FileRootRecord {
    const roots = this.listFileRoots(workspaceId);
    const matchingRoot = roots.find((candidate) => candidate.id === knowledgeRootId);
    if (matchingRoot) {
      return matchingRoot;
    }

    const activeKnowledgeRoot = roots.find((candidate) => candidate.enabled && candidate.kind === 'knowledge_base');
    if (activeKnowledgeRoot) {
      return activeKnowledgeRoot;
    }

    throw new RuntimeNotFoundError(`Knowledge root ${knowledgeRootId} not found`);
  }

  private async convertSource(input: KnowledgeImportInput): Promise<ConvertedSource> {
    switch (input.sourceType) {
      case 'manual_text':
        if (!input.sourceText) throw new RuntimeValidationError('sourceText is required for manual_text imports');
        return {
          adapter: 'native',
          fallbackUsed: false,
          normalizedMarkdown: input.sourceText,
          warnings: [],
          originalFileName: 'source.txt',
          originalMediaType: 'text/plain',
          originalContentToPersist: input.sourceText,
          originalPersistenceName: 'source.txt',
        };
      case 'website':
      case 'x_post':
        if (!input.sourceUri) throw new RuntimeValidationError(`sourceUri is required for ${input.sourceType} imports`);
        return this.convertRemoteUrl(input.sourceUri);
      case 'local_file':
      case 'pdf':
      case 'image':
      case 'repo':
      case 'dataset':
        if (!input.sourcePath) throw new RuntimeValidationError(`sourcePath is required for ${input.sourceType} imports`);
        return this.convertLocalPath(input);
      default:
        throw new RuntimeValidationError(`Unsupported knowledge source type: ${(input as { sourceType: string }).sourceType}`);
    }
  }

  private async convertRemoteUrl(sourceUri: string): Promise<ConvertedSource> {
    const warnings: string[] = [];
    let extraOriginalArtifacts: ConvertedSource['extraOriginalArtifacts'] = [];
    try {
      const rawResponse = await this.fetchImpl(sourceUri, { signal: AbortSignal.timeout(5000) });
      if (rawResponse.ok) {
        const contentType = rawResponse.headers.get('content-type');
        const arrayBuffer = await rawResponse.arrayBuffer();
        extraOriginalArtifacts = [{
          fileName: `raw${extensionForContentType(contentType) || '.html'}`,
          mediaType: contentType,
          content: Buffer.from(arrayBuffer),
        }];
      } else {
        warnings.push(`Original fetch returned ${rawResponse.status}`);
      }
    } catch (error) {
      warnings.push(`Original fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const readerResponse = await this.fetchImpl(`https://r.jina.ai/${sourceUri}`);
      if (readerResponse.ok) {
        return {
          adapter: 'jina_reader',
          fallbackUsed: false,
          normalizedMarkdown: await readerResponse.text(),
          warnings,
          originalFileName: 'source.url',
          originalMediaType: 'text/uri-list',
          originalContentToPersist: `${sourceUri}\n`,
          originalPersistenceName: 'source.url',
          extraOriginalArtifacts,
        };
      }
      warnings.push(`Jina Reader returned ${readerResponse.status}`);
    } catch (error) {
      warnings.push(`Jina Reader failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const python = this.resolveKnowledgePython();
      const script = [
        'import sys',
        'import trafilatura',
        'downloaded = trafilatura.fetch_url(sys.argv[1])',
        "text = trafilatura.extract(downloaded, output_format='markdown') if downloaded else ''",
        'print(text or "")',
      ].join('; ');
      const result = await this.runCommand(python.command, ['-c', script, sourceUri]);
      if (result.stdout.trim()) {
        return {
          adapter: 'trafilatura',
          fallbackUsed: true,
          normalizedMarkdown: result.stdout,
          warnings,
          originalFileName: 'source.url',
          originalMediaType: 'text/uri-list',
          originalContentToPersist: `${sourceUri}\n`,
          originalPersistenceName: 'source.url',
          extraOriginalArtifacts,
        };
      }
      warnings.push('trafilatura returned empty output');
    } catch (error) {
      warnings.push(`trafilatura failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const response = await this.fetchImpl(sourceUri);
      const html = await response.text();
      return {
        adapter: 'native',
        fallbackUsed: true,
        normalizedMarkdown: stripHtmlToMarkdown(html),
        warnings,
        originalFileName: 'source.url',
          originalMediaType: 'text/uri-list',
          originalContentToPersist: `${sourceUri}\n`,
          originalPersistenceName: 'source.url',
          extraOriginalArtifacts: [
            ...extraOriginalArtifacts,
            {
              fileName: `fallback${extensionForContentType(response.headers.get('content-type')) || '.html'}`,
              mediaType: response.headers.get('content-type'),
              content: html,
            },
          ],
        };
      } catch (error) {
        warnings.push(`Fallback fetch failed: ${error instanceof Error ? error.message : String(error)}`);
        return {
        adapter: 'native',
        fallbackUsed: true,
        normalizedMarkdown: `# Imported URL\n\nSource: ${sourceUri}\n\n> Automatic extraction failed. Reimport after checking connectivity.`,
        warnings,
        originalFileName: 'source.url',
          originalMediaType: 'text/uri-list',
          originalContentToPersist: `${sourceUri}\n`,
          originalPersistenceName: 'source.url',
          extraOriginalArtifacts,
        };
      }
  }

  private async convertLocalPath(input: KnowledgeImportInput): Promise<ConvertedSource> {
    const absolutePath = resolve(input.sourcePath!);
    if (!existsSync(absolutePath)) {
      throw new RuntimeValidationError(`Source path does not exist: ${absolutePath}`);
    }

    const stat = statSync(absolutePath);
    const extension = extname(absolutePath).toLowerCase();
    if (input.sourceType === 'repo') {
      if (!stat.isDirectory()) throw new RuntimeValidationError('Repo import requires a directory path');
      return this.convertRepoDirectory(absolutePath);
    }
    if (input.sourceType === 'dataset') {
      if (!stat.isFile()) throw new RuntimeValidationError('Dataset import requires a file path');
      return this.convertDatasetFile(absolutePath);
    }
    if (input.sourceType === 'image' || isImageExtension(extension)) {
      return {
        adapter: 'native',
        fallbackUsed: false,
        normalizedMarkdown: [
          `# Image import: ${basename(absolutePath)}`,
          '',
          `![${basename(absolutePath)}](${basename(absolutePath)})`,
          '',
          '> Popeye localized the source image into the knowledge asset store.',
        ].join('\n'),
        warnings: [],
        originalFileName: basename(absolutePath),
        originalMediaType: null,
        originalContentToPersist: readFileSync(absolutePath),
        originalPersistenceName: basename(absolutePath),
      };
    }
    if (!stat.isFile()) {
      throw new RuntimeValidationError(`Source path is not a file: ${absolutePath}`);
    }
    if (input.sourceType === 'pdf' || extension === '.pdf') {
      return this.convertWithExternalDocumentTools(absolutePath);
    }
    if (['.docx', '.pptx', '.xlsx'].includes(extension)) {
      return this.convertWithExternalDocumentTools(absolutePath);
    }
    if (extension === '.md' || extension === '.markdown' || extension === '.txt') {
      return {
        adapter: 'native',
        fallbackUsed: false,
        normalizedMarkdown: readFileSync(absolutePath, 'utf8'),
        warnings: [],
        originalFileName: basename(absolutePath),
        originalMediaType: extension === '.md' ? 'text/markdown' : 'text/plain',
        originalContentToPersist: readFileSync(absolutePath),
        originalPersistenceName: basename(absolutePath),
      };
    }
    if (extension === '.html' || extension === '.htm') {
      const html = readFileSync(absolutePath, 'utf8');
      return {
        adapter: 'native',
        fallbackUsed: false,
        normalizedMarkdown: stripHtmlToMarkdown(html),
        warnings: [],
        originalFileName: basename(absolutePath),
        originalMediaType: 'text/html',
        originalContentToPersist: readFileSync(absolutePath),
        originalPersistenceName: basename(absolutePath),
      };
    }
    return this.convertWithExternalDocumentTools(absolutePath);
  }

  private async convertWithExternalDocumentTools(absolutePath: string): Promise<ConvertedSource> {
    const warnings: string[] = [];
    const markitdown = this.resolveMarkitdown();
    try {
      const result = await this.runCommand(markitdown.command, [absolutePath]);
      if (result.stdout.trim()) {
        return {
          adapter: 'markitdown',
          fallbackUsed: false,
          normalizedMarkdown: result.stdout,
          warnings,
          originalFileName: basename(absolutePath),
          originalMediaType: null,
          originalContentToPersist: readFileSync(absolutePath),
          originalPersistenceName: basename(absolutePath),
        };
      }
      warnings.push('markitdown returned empty output');
    } catch (error) {
      warnings.push(`markitdown failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const python = this.resolveKnowledgePython();
      const script = [
        'import sys',
        'from pathlib import Path',
        'from docling.document_converter import DocumentConverter',
        'converter = DocumentConverter()',
        'result = converter.convert(Path(sys.argv[1]))',
        'print(result.document.export_to_markdown())',
      ].join('; ');
      const result = await this.runCommand(python.command, ['-c', script, absolutePath]);
      if (result.stdout.trim()) {
        return {
          adapter: 'docling',
          fallbackUsed: true,
          normalizedMarkdown: result.stdout,
          warnings,
          originalFileName: basename(absolutePath),
          originalMediaType: null,
          originalContentToPersist: readFileSync(absolutePath),
          originalPersistenceName: basename(absolutePath),
        };
      }
      warnings.push('docling returned empty output');
    } catch (error) {
      warnings.push(`docling failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      adapter: 'native',
      fallbackUsed: true,
      normalizedMarkdown: `# Imported document\n\nOriginal file: ${basename(absolutePath)}\n\n> No document-to-markdown adapter was available. Install MarkItDown or Docling and reimport.`,
      warnings,
      originalFileName: basename(absolutePath),
      originalMediaType: null,
      originalContentToPersist: readFileSync(absolutePath),
      originalPersistenceName: basename(absolutePath),
    };
  }

  private convertRepoDirectory(absolutePath: string): ConvertedSource {
    const entries = readdirSync(absolutePath, { withFileTypes: true })
      .filter((entry) => entry.name.startsWith('.') === false)
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
      .slice(0, 50);
    const readmePath = ['README.md', 'README.txt', 'readme.md', 'readme.txt']
      .map((name) => join(absolutePath, name))
      .find((path) => existsSync(path));
    const readme = readmePath ? readFileSync(readmePath, 'utf8') : '';
    const markdown = [
      `# Repo import: ${basename(absolutePath)}`,
      '',
      '## Top-level entries',
      ...entries.map((entry) => `- ${entry.isDirectory() ? '[dir]' : '[file]'} ${entry.name}`),
      '',
      readme ? '## README excerpt' : '## README excerpt\n\n_No README found._',
      readme ? summarizeMarkdown(readme) : '',
    ].filter(Boolean).join('\n');
    return {
      adapter: 'native',
      fallbackUsed: false,
      normalizedMarkdown: markdown,
      warnings: ['Repo imports create a markdown manifest, not a full repository dump.'],
      originalFileName: basename(absolutePath),
      originalMediaType: 'inode/directory',
      originalContentToPersist: `${absolutePath}\n`,
      originalPersistenceName: 'source.path',
    };
  }

  private convertDatasetFile(absolutePath: string): ConvertedSource {
    const extension = extname(absolutePath).toLowerCase();
    const rawBuffer = readFileSync(absolutePath);
    const raw = rawBuffer.toString('utf8');
    const binaryLike = raw.includes('\uFFFD');
    const sampleLines = binaryLike
      ? [`Binary dataset preview unavailable for ${basename(absolutePath)}.`]
      : raw.split(/\r?\n/).slice(0, 6);
    const markdown = [
      `# Dataset import: ${basename(absolutePath)}`,
      '',
      `- Extension: ${extension || 'unknown'}`,
      `- Size bytes: ${statSync(absolutePath).size}`,
      '',
      '## Sample',
      '```',
      ...sampleLines,
      '```',
    ].join('\n');
    return {
      adapter: 'native',
      fallbackUsed: false,
      normalizedMarkdown: markdown,
      warnings: [
        'Dataset imports create a markdown profile and preserve the original file unchanged.',
        ...(binaryLike ? ['Binary dataset content was summarized without UTF-8 text preview.'] : []),
      ],
      originalFileName: basename(absolutePath),
      originalMediaType: binaryLike ? 'application/octet-stream' : 'text/plain',
      originalContentToPersist: rawBuffer,
      originalPersistenceName: basename(absolutePath),
    };
  }

  private async createCompileDraftForSource(
    source: KnowledgeSourceRecord,
    normalizedDocument: KnowledgeDocumentRecord,
    normalizedMarkdown: string,
  ): Promise<{ compileJob: KnowledgeCompileJobRecord; draftRevision: KnowledgeDocumentRevisionRecord; compileOutput: WikiCompileOutput | null }> {
    const existingWiki = this.findWikiDocumentBySlug(source.workspaceId, slugify(source.title));
    const defaultSlug = slugify(source.title);
    const wikiDocument = existingWiki
      ? existingWiki
      : this.upsertDocument({
          workspaceId: source.workspaceId,
          knowledgeRootId: source.knowledgeRootId,
          sourceId: source.id,
          kind: 'wiki_article',
          title: source.title,
          slug: dedupeSlug(defaultSlug, (candidate) => this.findWikiDocumentBySlug(source.workspaceId, candidate) !== null),
          relativePath: resolveWikiRelativePath(
            dedupeSlug(defaultSlug, (candidate) => this.findWikiDocumentBySlug(source.workspaceId, candidate) !== null),
          ),
          revisionHash: null,
          status: 'draft_only',
        });
    const currentMarkdown = existingWiki ? this.getDocument(wikiDocument.id)?.markdownText ?? '' : '';
    const { proposedMarkdown, compileOutput } = await this.compileWikiMarkdown(source, normalizedMarkdown, currentMarkdown);
    const revisionId = randomUUID();
    const now = nowIso();
    this.db.prepare(
      `INSERT INTO knowledge_document_revisions (
        id, document_id, workspace_id, status, source_kind, source_id, proposed_title, proposed_markdown,
        diff_preview, base_revision_hash, created_at, applied_at
      ) VALUES (?, ?, ?, 'draft', 'auto_compile', ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      revisionId,
      wikiDocument.id,
      source.workspaceId,
      source.id,
      source.title,
      proposedMarkdown,
      buildPlaybookDiff(currentMarkdown || null, proposedMarkdown),
      existingWiki?.revisionHash ?? null,
      now,
    );

    this.replaceCompiledFromLink(wikiDocument.id, normalizedDocument.id, source.workspaceId);

    const compileJobId = randomUUID();
    this.db.prepare(
      `INSERT INTO knowledge_compile_jobs (
        id, workspace_id, source_id, target_document_id, status, summary, warnings_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'succeeded', ?, '[]', ?, ?)`,
    ).run(
      compileJobId,
      source.workspaceId,
      source.id,
      wikiDocument.id,
      `Auto-compiled draft for ${source.title}`,
      now,
      now,
    );

    return {
      compileJob: this.mapCompileJobRow(this.db.prepare('SELECT * FROM knowledge_compile_jobs WHERE id = ?').get(compileJobId) as KnowledgeCompileJobRow),
      draftRevision: this.mapRevisionRow(this.db.prepare('SELECT * FROM knowledge_document_revisions WHERE id = ?').get(revisionId) as KnowledgeRevisionRow),
      compileOutput,
    };
  }

  private async generateEntityPages(
    workspaceId: string,
    knowledgeRootId: string,
    parentDocumentId: string,
    sourceId: string,
    suggestedEntities: string[],
    sourceContext: string,
  ): Promise<void> {
    if (!this.wikiCompilationClient?.enabled) return;

    const contextSnippet = summarizeMarkdown(sourceContext);

    for (const entityName of suggestedEntities.slice(0, 10)) {
      const entitySlug = slugify(entityName);
      if (!entitySlug || entitySlug === 'knowledge-doc') continue;

      const existing = this.findWikiDocumentBySlug(workspaceId, entitySlug);
      if (existing) {
        // Entity page already exists — create a related link if not present
        this.createLinkIfMissing(parentDocumentId, existing.id, entityName, 'related', workspaceId);
        continue;
      }

      try {
        const prompt = buildEntityPagePrompt(entityName, [contextSnippet], null);
        const output = await this.wikiCompilationClient.compile(prompt);
        if (!output.markdown.trim()) continue;

        const finalSlug = dedupeSlug(entitySlug, (candidate) => this.findWikiDocumentBySlug(workspaceId, candidate) !== null);
        const entityDoc = this.upsertDocument({
          workspaceId,
          knowledgeRootId,
          sourceId,
          kind: 'wiki_article',
          title: entityName,
          slug: finalSlug,
          relativePath: resolveWikiRelativePath(finalSlug),
          revisionHash: null,
          status: 'draft_only',
        });

        // Create draft revision with LLM output
        const entityMarkdown = normalizeMarkdown(output.markdown);
        const entityRevisionId = randomUUID();
        const now = nowIso();
        this.db.prepare(
          `INSERT INTO knowledge_document_revisions (
            id, document_id, workspace_id, status, source_kind, source_id, proposed_title, proposed_markdown,
            diff_preview, base_revision_hash, created_at, applied_at
          ) VALUES (?, ?, ?, 'draft', 'entity_auto', ?, ?, ?, ?, NULL, ?, NULL)`,
        ).run(entityRevisionId, entityDoc.id, workspaceId, sourceId, entityName, entityMarkdown, buildPlaybookDiff(null, entityMarkdown), now);

        // Link entity page to parent article
        this.createLinkIfMissing(parentDocumentId, entityDoc.id, entityName, 'related', workspaceId);

        // Resolve any previously unresolved links that match this entity slug
        this.resolveUnresolvedLinks(workspaceId, finalSlug, entityDoc.id);

        this.log?.info('generated entity page', { entityName, slug: finalSlug, parentDocumentId });
      } catch (error) {
        this.log?.warn('entity page generation failed', {
          entityName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private createLinkIfMissing(
    sourceDocumentId: string,
    targetDocumentId: string,
    targetLabel: string,
    linkKind: KnowledgeLinkKind,
    workspaceId: string,
  ): void {
    const existing = this.db.prepare(
      'SELECT id FROM knowledge_links WHERE workspace_id = ? AND source_document_id = ? AND target_document_id = ? AND link_kind = ?',
    ).get(workspaceId, sourceDocumentId, targetDocumentId, linkKind) as { id: string } | undefined;
    if (existing) return;

    const now = nowIso();
    this.db.prepare(
      `INSERT INTO knowledge_links (
        id, workspace_id, source_document_id, target_document_id, target_slug, target_label, link_kind, link_status,
        confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'active', 1.0, ?, ?)`,
    ).run(randomUUID(), workspaceId, sourceDocumentId, targetDocumentId, targetLabel, linkKind, now, now);
  }

  private resolveUnresolvedLinks(workspaceId: string, slug: string, documentId: string): void {
    this.db.prepare(
      `UPDATE knowledge_links
       SET target_document_id = ?, link_status = 'active', updated_at = ?
       WHERE workspace_id = ? AND target_slug = ? AND link_status = 'unresolved'`,
    ).run(documentId, nowIso(), workspaceId, slug);
  }

  async regenerateIndex(workspaceId: string, actorRole: AuthRole = 'operator'): Promise<KnowledgeDocumentRecord> {
    const rows = this.db.prepare(
      "SELECT * FROM knowledge_documents WHERE workspace_id = ? AND kind = 'wiki_article' AND slug != '_index' AND slug != '_log' ORDER BY title ASC",
    ).all(workspaceId) as KnowledgeDocumentRow[];

    const documents = rows.map((row) => {
      const doc = this.mapDocumentRow(row);
      const markdown = this.readDocumentSearchMarkdown(doc);
      const summary = summarizeMarkdown(markdown).split('\n')[0] ?? '';
      return { slug: doc.slug, title: doc.title, summary };
    });

    let indexMarkdown: string;
    if (this.wikiCompilationClient?.enabled && documents.length > 0) {
      try {
        const prompt = buildIndexPrompt(documents);
        const output = await this.wikiCompilationClient.compile(prompt);
        indexMarkdown = output.markdown.trim() ? normalizeMarkdown(output.markdown) : this.buildIndexTemplate(documents);
      } catch {
        indexMarkdown = this.buildIndexTemplate(documents);
      }
    } else {
      indexMarkdown = this.buildIndexTemplate(documents);
    }

    const knowledgeRoot = this.ensureKnowledgeRoot(workspaceId);

    const indexDoc = this.upsertDocument({
      workspaceId,
      knowledgeRootId: knowledgeRoot.id,
      sourceId: null,
      kind: 'wiki_article',
      title: 'Wiki Index',
      slug: '_index',
      relativePath: resolveWikiRelativePath('_index'),
      revisionHash: buildRevisionHash(indexMarkdown),
      status: 'active',
    });

    const absolutePath = this.resolveDocumentAbsolutePath(indexDoc);
    writeUtf8(absolutePath, indexMarkdown);
    this.syncDocumentSearchEntry(indexDoc, indexMarkdown);
    this.writeMutationReceipt({
      kind: 'knowledge_index_regenerate',
      component: 'knowledge',
      status: 'succeeded',
      summary: `Regenerated knowledge index for ${workspaceId}`,
      details: `Regenerated ${indexDoc.relativePath} with ${documents.length} indexed wiki pages.`,
      actorRole,
      workspaceId,
      metadata: {
        documentId: indexDoc.id,
        pageCount: String(documents.length),
      },
    });

    return indexDoc;
  }

  private buildIndexTemplate(documents: Array<{ slug: string; title: string; summary: string }>): string {
    const lines = [
      '# Wiki Index',
      '',
      `${documents.length} pages in this knowledge base.`,
      '',
    ];
    for (const doc of documents) {
      lines.push(`- [[${doc.slug}]] — ${doc.summary || doc.title}`);
    }
    lines.push('');
    return normalizeMarkdown(lines.join('\n'));
  }

  appendToLog(workspaceId: string, operation: KnowledgeLogOperation, summary: string, relatedDocumentIds: string[] = []): void {
    const knowledgeRoot = this.ensureKnowledgeRoot(workspaceId);

    const logDoc = this.upsertDocument({
      workspaceId,
      knowledgeRootId: knowledgeRoot.id,
      sourceId: null,
      kind: 'wiki_article',
      title: 'Wiki Log',
      slug: '_log',
      relativePath: resolveWikiRelativePath('_log'),
      revisionHash: null,
      status: 'active',
    });

    const absolutePath = this.resolveDocumentAbsolutePath(logDoc);
    const now = new Date().toISOString();
    const entry = `[${operation.toUpperCase()} ${now}] ${summary}${relatedDocumentIds.length ? ` (docs: ${relatedDocumentIds.join(', ')})` : ''}\n`;
    ensureDir(dirname(absolutePath));
    try {
      writeFileSync(absolutePath, '# Wiki Log\n\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') {
        throw error;
      }
    }
    appendFileSync(absolutePath, entry, { encoding: 'utf8' });

    // Update revision hash and search index
    const updated = readFileSync(absolutePath, 'utf8');
    const hash = buildRevisionHash(updated);
    this.db.prepare('UPDATE knowledge_documents SET revision_hash = ?, updated_at = ? WHERE id = ?').run(hash, nowIso(), logDoc.id);
    this.syncDocumentSearchEntry(logDoc, updated);
  }

  async runLint(workspaceId: string, actorRole: AuthRole = 'operator'): Promise<KnowledgeLintReport> {
    const now = nowIso();

    // Structural checks
    const orphanRows = this.db.prepare(
      `SELECT d.id FROM knowledge_documents d
       WHERE d.workspace_id = ? AND d.kind = 'wiki_article'
         AND d.slug NOT IN ('_index', '_log')
         AND NOT EXISTS (
           SELECT 1 FROM knowledge_links l
           WHERE l.target_document_id = d.id AND l.workspace_id = ?
         )`,
    ).all(workspaceId, workspaceId) as Array<{ id: string }>;

    const unresolvedCount = this.scalarCount(
      "SELECT COUNT(*) AS c FROM knowledge_links WHERE workspace_id = ? AND link_status = 'unresolved'",
      workspaceId,
    );

    const staleDays = 30;
    const staleThreshold = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000).toISOString();
    const staleCount = this.scalarCount(
      `SELECT COUNT(*) AS c FROM knowledge_documents
       WHERE workspace_id = ? AND kind = 'wiki_article' AND slug NOT IN ('_index', '_log')
         AND updated_at < ?`,
      workspaceId,
      staleThreshold,
    );

    const findings: KnowledgeLintReport['findings'] = [];

    for (const row of orphanRows) {
      findings.push({
        kind: 'orphan_page',
        severity: 'warning',
        message: `Wiki page ${row.id} has no incoming links`,
        documentIds: [row.id],
        confidence: 1,
      });
    }

    if (unresolvedCount > 0) {
      findings.push({
        kind: 'unresolved_link',
        severity: 'warning',
        message: `${unresolvedCount} unresolved wiki links`,
        documentIds: [],
        confidence: 1,
      });
    }

    if (staleCount > 0) {
      findings.push({
        kind: 'stale_page',
        severity: 'info',
        message: `${staleCount} wiki pages not updated in ${staleDays}+ days`,
        documentIds: [],
        confidence: 1,
      });
    }

    const report: KnowledgeLintReport = KnowledgeLintReportSchema.parse({
      findings,
      orphanPages: orphanRows.length,
      unresolvedLinks: unresolvedCount,
      stalePages: staleCount,
      contradictions: 0,
      dataGaps: 0,
      lintedAt: now,
    });

    this.writeMutationReceipt({
      kind: 'knowledge_lint',
      component: 'knowledge',
      status: 'succeeded',
      summary: `Linted knowledge workspace ${workspaceId}`,
      details: `Linted knowledge pages and found ${findings.length} findings.`,
      actorRole,
      workspaceId,
      metadata: {
        findingCount: String(findings.length),
        orphanPages: String(orphanRows.length),
        unresolvedLinks: String(unresolvedCount),
        stalePages: String(staleCount),
      },
    });
    this.appendToLog(workspaceId, 'lint', `Lint completed: ${findings.length} findings`);

    return report;
  }

  fileQueryAsWiki(
    workspaceId: string,
    title: string,
    answerText: string,
    sourceDocumentIds: string[] = [],
    actorRole: AuthRole = 'operator',
  ): KnowledgeDocumentRecord {
    const normalizedTitle = title.trim();
    const normalizedAnswer = answerText.trim();
    if (!normalizedTitle) {
      throw new RuntimeValidationError('Knowledge file-query title is required');
    }
    if (!normalizedAnswer) {
      throw new RuntimeValidationError('Knowledge file-query answer text is required');
    }
    if (normalizedTitle.length > MAX_FILE_QUERY_TITLE_CHARS) {
      throw new RuntimeValidationError(`Knowledge file-query title exceeds ${MAX_FILE_QUERY_TITLE_CHARS} characters`);
    }
    if (normalizedAnswer.length > MAX_FILE_QUERY_ANSWER_CHARS) {
      throw new RuntimeValidationError(`Knowledge file-query answer text exceeds ${MAX_FILE_QUERY_ANSWER_CHARS} characters`);
    }

    const knowledgeRoot = this.ensureKnowledgeRoot(workspaceId);
    const slug = dedupeSlug(slugify(normalizedTitle), (candidate) => this.findDocumentBySlug(workspaceId, candidate) !== null);
    const dateStamp = nowIso().slice(0, 10);

    const markdown = normalizeMarkdown([
      `# ${normalizedTitle}`,
      '',
      normalizedAnswer,
      '',
      sourceDocumentIds.length ? `## Sources\n${sourceDocumentIds.map((id) => `- ${id}`).join('\n')}` : '',
    ].filter(Boolean).join('\n'));

    const doc = this.upsertDocument({
      workspaceId,
      knowledgeRootId: knowledgeRoot.id,
      sourceId: null,
      kind: 'output_note',
      title: normalizedTitle,
      slug,
      relativePath: resolveOutputRelativePath(slug, dateStamp),
      revisionHash: buildRevisionHash(markdown),
      status: 'active',
    });

    const absolutePath = this.resolveDocumentAbsolutePath(doc);
    writeUtf8(absolutePath, markdown);
    this.syncDocumentSearchEntry(doc, markdown);
    this.refreshLinksForDocument(doc.id, markdown, workspaceId);

    // Create citation links to source documents
    for (const sourceDocId of sourceDocumentIds) {
      this.createLinkIfMissing(doc.id, sourceDocId, 'source', 'citation', workspaceId);
    }

    this.writeMutationReceipt({
      kind: 'knowledge_query_filed',
      component: 'knowledge',
      status: 'succeeded',
      summary: `Filed knowledge query "${normalizedTitle}"`,
      details: `Filed a knowledge output note at ${doc.relativePath}.`,
      actorRole,
      workspaceId,
      metadata: {
        documentId: doc.id,
        sourceCount: String(sourceDocumentIds.length),
      },
    });
    this.appendToLog(workspaceId, 'query_filed', `Filed query answer as "${normalizedTitle}"`, [doc.id]);

    return doc;
  }

  syncAllWikiDocuments(workspaceId: string, actorRole: AuthRole = 'operator'): number {
    const rows = this.db.prepare(
      "SELECT * FROM knowledge_documents WHERE workspace_id = ? AND kind IN ('wiki_article', 'output_note') AND status = 'active'",
    ).all(workspaceId) as KnowledgeDocumentRow[];

    let synced = 0;
    for (const row of rows) {
      const doc = this.mapDocumentRow(row);
      try {
        const absolutePath = this.resolveDocumentAbsolutePath(doc);
        const markdown = this.readDocumentSearchMarkdown(doc);
        if (markdown.trim()) {
          writeUtf8(absolutePath, markdown);
          synced += 1;
        }
      } catch (error) {
        this.log?.warn('wiki sync failed for document', {
          documentId: doc.id,
          slug: doc.slug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.writeMutationReceipt({
      kind: 'knowledge_sync',
      component: 'knowledge',
      status: 'succeeded',
      summary: `Synced knowledge documents for ${workspaceId}`,
      details: `Synced ${synced} active wiki/output knowledge documents to disk.`,
      actorRole,
      workspaceId,
      metadata: {
        synced: String(synced),
      },
    });
    return synced;
  }

  private async compileWikiMarkdown(source: KnowledgeSourceRecord, normalizedMarkdown: string, currentMarkdown: string): Promise<{ proposedMarkdown: string; compileOutput: WikiCompileOutput | null }> {
    if (this.wikiCompilationClient?.enabled) {
      try {
        const prompt = currentMarkdown.trim()
          ? buildSourceUpdatePrompt(source, normalizedMarkdown, currentMarkdown)
          : buildSourceCompilePrompt(source, normalizedMarkdown, currentMarkdown);
        const output = await this.wikiCompilationClient.compile(prompt);
        if (output.markdown.trim()) {
          return { proposedMarkdown: normalizeMarkdown(output.markdown), compileOutput: output };
        }
        this.log?.warn('wiki compilation returned empty markdown, falling back to template', { sourceId: source.id });
      } catch (error) {
        this.log?.warn('wiki compilation failed, falling back to template', {
          sourceId: source.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { proposedMarkdown: this.compileWikiMarkdownTemplate(source, normalizedMarkdown, currentMarkdown), compileOutput: null };
  }

  private compileWikiMarkdownTemplate(source: KnowledgeSourceRecord, normalizedMarkdown: string, currentMarkdown: string): string {
    const sourceLink = `[Normalized source](../raw/${source.id}/normalized/source.md)`;
    const summary = summarizeMarkdown(normalizedMarkdown);
    if (currentMarkdown.trim()) {
      return normalizeMarkdown([
        currentMarkdown.trim(),
        '',
        `## Source update — ${new Date().toISOString().slice(0, 10)}`,
        `- Imported from ${source.sourceType}: ${sourceLink}`,
        '',
        summary,
      ].join('\n'));
    }

    return normalizeMarkdown([
      `# ${source.title}`,
      '',
      `- Source type: ${source.sourceType}`,
      `- Canonical source: ${sourceLink}`,
      source.originalUri ? `- Original URL: ${source.originalUri}` : null,
      source.originalPath ? `- Original path: ${source.originalPath}` : null,
      '',
      '## Summary',
      summary || '_No summary available._',
      '',
      '## Sources',
      `- ${sourceLink}`,
    ].filter(Boolean).join('\n'));
  }

  private replaceCompiledFromLink(sourceDocumentId: string, targetDocumentId: string, workspaceId: string): void {
    this.db.prepare(
      "DELETE FROM knowledge_links WHERE workspace_id = ? AND source_document_id = ? AND link_kind = 'compiled_from'",
    ).run(workspaceId, sourceDocumentId);
    const now = nowIso();
    this.db.prepare(
      `INSERT INTO knowledge_links (
        id, workspace_id, source_document_id, target_document_id, target_slug, target_label, link_kind, link_status,
        confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, 'Normalized source', 'compiled_from', 'active', 1.0, ?, ?)`,
    ).run(randomUUID(), workspaceId, sourceDocumentId, targetDocumentId, now, now);
  }

  private rebuildSearchIndex(): void {
    const rows = this.db.prepare(
      'SELECT * FROM knowledge_documents ORDER BY updated_at DESC',
    ).all() as KnowledgeDocumentRow[];
    this.db.prepare('DELETE FROM knowledge_documents_fts').run();
    for (const row of rows) {
      this.syncDocumentSearchEntry(this.mapDocumentRow(row));
    }
  }

  private readDocumentSearchMarkdown(document: KnowledgeDocumentRecord): string {
    try {
      const absolutePath = this.resolveDocumentAbsolutePath(document);
      if (existsSync(absolutePath)) {
        return normalizeMarkdown(readFileSync(absolutePath, 'utf8'));
      }
    } catch {
      // Fall through to empty markdown for draft-only or temporarily missing files.
    }
    return '';
  }

  private syncDocumentSearchEntry(document: KnowledgeDocumentRecord, markdown?: string): void {
    const indexedMarkdown = normalizeMarkdown(markdown ?? this.readDocumentSearchMarkdown(document));
    this.db.prepare('DELETE FROM knowledge_documents_fts WHERE document_id = ?').run(document.id);
    this.db.prepare(
      `INSERT INTO knowledge_documents_fts (
        document_id, workspace_id, kind, title, slug, markdown
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      document.id,
      document.workspaceId,
      document.kind,
      document.title,
      document.slug,
      indexedMarkdown,
    );
  }

  private refreshLinksForDocument(documentId: string, markdown: string, workspaceId: string): void {
    this.db.prepare(
      "DELETE FROM knowledge_links WHERE workspace_id = ? AND source_document_id = ? AND link_kind IN ('markdown', 'wikilink', 'citation')",
    ).run(workspaceId, documentId);

    const now = nowIso();
    const parsedLinks = extractKnowledgeLinks(markdown);
    for (const link of parsedLinks) {
      const targetDocument = link.targetSlug ? this.findDocumentBySlug(workspaceId, link.targetSlug) : null;
      this.db.prepare(
        `INSERT INTO knowledge_links (
          id, workspace_id, source_document_id, target_document_id, target_slug, target_label, link_kind, link_status,
          confidence, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        workspaceId,
        documentId,
        targetDocument?.id ?? null,
        link.targetSlug,
        link.external && link.href ? link.href : link.targetLabel,
        link.linkKind,
        targetDocument || link.external ? 'active' : 'unresolved',
        link.external ? 0.8 : 1,
        now,
        now,
      );
    }
  }

  private upsertDocument(input: {
    workspaceId: string;
    knowledgeRootId: string;
    sourceId: string | null;
    kind: KnowledgeDocumentKind;
    title: string;
    slug: string;
    relativePath: string;
    revisionHash: string | null;
    status: 'active' | 'draft_only' | 'archived';
  }): KnowledgeDocumentRecord {
    const existing = this.db.prepare(
      'SELECT * FROM knowledge_documents WHERE workspace_id = ? AND kind = ? AND slug = ?',
    ).get(input.workspaceId, input.kind, input.slug) as KnowledgeDocumentRow | undefined;
    const now = nowIso();
    if (existing) {
      this.db.prepare(
        `UPDATE knowledge_documents
         SET title = ?, relative_path = ?, revision_hash = ?, source_id = COALESCE(source_id, ?), knowledge_root_id = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      ).run(input.title, input.relativePath, input.revisionHash, input.sourceId, input.knowledgeRootId, input.status, now, existing.id);
      const record = this.getDocumentRecord(existing.id)!;
      this.syncDocumentSearchEntry(record);
      return record;
    }
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO knowledge_documents (
        id, workspace_id, knowledge_root_id, source_id, kind, title, slug, relative_path, revision_hash, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.workspaceId,
      input.knowledgeRootId,
      input.sourceId,
      input.kind,
      input.title,
      input.slug,
      input.relativePath,
      input.revisionHash,
      input.status,
      now,
      now,
    );
    const record = this.getDocumentRecord(id)!;
    this.syncDocumentSearchEntry(record);
    return record;
  }

  private getDocumentRecord(documentId: string): KnowledgeDocumentRecord | null {
    const row = this.db.prepare('SELECT * FROM knowledge_documents WHERE id = ?').get(documentId) as KnowledgeDocumentRow | undefined;
    return row ? this.mapDocumentRow(row) : null;
  }

  private resolveDocumentAbsolutePath(document: KnowledgeDocumentRecord): string {
    const root = this.resolveKnowledgeRoot(document.workspaceId, document.knowledgeRootId);
    return resolve(root.rootPath, document.relativePath);
  }

  private findWikiDocumentBySlug(workspaceId: string, slug: string): KnowledgeDocumentRecord | null {
    const row = this.db.prepare(
      "SELECT * FROM knowledge_documents WHERE workspace_id = ? AND kind = 'wiki_article' AND slug = ?",
    ).get(workspaceId, slug) as KnowledgeDocumentRow | undefined;
    return row ? this.mapDocumentRow(row) : null;
  }

  private findDocumentBySlug(workspaceId: string, slug: string): KnowledgeDocumentRecord | null {
    const row = this.db.prepare(
      'SELECT * FROM knowledge_documents WHERE workspace_id = ? AND slug = ? ORDER BY kind = ? DESC, updated_at DESC LIMIT 1',
    ).get(workspaceId, slug, 'wiki_article') as KnowledgeDocumentRow | undefined;
    return row ? this.mapDocumentRow(row) : null;
  }

  private scalarCount(sql: string, ...params: unknown[]): number {
    const row = this.db.prepare(sql).get(...params) as { c: number } | undefined;
    return row?.c ?? 0;
  }

  private mapSourceRow(row: KnowledgeSourceRow): KnowledgeSourceRecord {
    return KnowledgeSourceRecordSchema.parse({
      id: row.id,
      workspaceId: row.workspace_id,
      knowledgeRootId: row.knowledge_root_id,
      sourceType: row.source_type,
      title: row.title,
      originalUri: row.original_uri,
      originalPath: row.original_path,
      originalFileName: row.original_file_name,
      originalMediaType: row.original_media_type,
      adapter: row.adapter,
      fallbackUsed: Boolean(row.fallback_used),
      status: row.status,
      contentHash: row.content_hash,
      assetStatus: row.asset_status,
      latestOutcome: row.latest_outcome,
      conversionWarnings: JSON.parse(row.conversion_warnings_json || '[]'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private mapDocumentRow(row: KnowledgeDocumentRow): KnowledgeDocumentRecord {
    return KnowledgeDocumentRecordSchema.parse({
      id: row.id,
      workspaceId: row.workspace_id,
      knowledgeRootId: row.knowledge_root_id,
      sourceId: row.source_id,
      kind: row.kind,
      title: row.title,
      slug: row.slug,
      relativePath: row.relative_path,
      revisionHash: row.revision_hash,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private mapRevisionRow(row: KnowledgeRevisionRow): KnowledgeDocumentRevisionRecord {
    return KnowledgeDocumentRevisionRecordSchema.parse({
      id: row.id,
      documentId: row.document_id,
      workspaceId: row.workspace_id,
      status: row.status,
      sourceKind: row.source_kind,
      sourceId: row.source_id,
      proposedTitle: row.proposed_title,
      proposedMarkdown: row.proposed_markdown,
      diffPreview: row.diff_preview,
      baseRevisionHash: row.base_revision_hash,
      createdAt: row.created_at,
      appliedAt: row.applied_at,
    });
  }

  private mapLinkRow(row: KnowledgeLinkRow): KnowledgeLinkRecord {
    return KnowledgeLinkRecordSchema.parse({
      id: row.id,
      workspaceId: row.workspace_id,
      sourceDocumentId: row.source_document_id,
      targetDocumentId: row.target_document_id,
      targetSlug: row.target_slug,
      targetLabel: row.target_label,
      linkKind: row.link_kind,
      linkStatus: row.link_status,
      confidence: row.confidence,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private mapCompileJobRow(row: KnowledgeCompileJobRow): KnowledgeCompileJobRecord {
    return KnowledgeCompileJobRecordSchema.parse({
      id: row.id,
      workspaceId: row.workspace_id,
      sourceId: row.source_id,
      targetDocumentId: row.target_document_id,
      status: row.status,
      summary: row.summary,
      warnings: JSON.parse(row.warnings_json || '[]'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private mapSnapshotRow(row: KnowledgeSnapshotRow): KnowledgeSourceSnapshotRecord {
    return KnowledgeSourceSnapshotRecordSchema.parse({
      id: row.id,
      sourceId: row.source_id,
      workspaceId: row.workspace_id,
      contentHash: row.content_hash,
      adapter: row.adapter,
      fallbackUsed: Boolean(row.fallback_used),
      status: row.status,
      assetStatus: row.asset_status,
      outcome: row.outcome,
      conversionWarnings: JSON.parse(row.conversion_warnings_json || '[]'),
      createdAt: row.created_at,
    });
  }

  private mapBetaRunRow(row: KnowledgeBetaRunRow): KnowledgeBetaRunRecord {
    return KnowledgeBetaRunRecordSchema.parse({
      id: row.id,
      workspaceId: row.workspace_id,
      manifestPath: row.manifest_path,
      importCount: row.import_count,
      reingestCount: row.reingest_count,
      hardFailureCount: row.hard_failure_count,
      importSuccessRate: row.import_success_rate,
      gateStatus: row.gate_status,
      createdAt: row.created_at,
    });
  }

  private mapBetaRunDetailRow(row: KnowledgeBetaRunRow): KnowledgeBetaRunDetail {
    return KnowledgeBetaRunDetailSchema.parse({
      ...this.mapBetaRunRow(row),
      reportMarkdown: row.report_markdown,
      imports: JSON.parse(row.imports_json || '[]'),
      reingests: JSON.parse(row.reingests_json || '[]'),
      converters: JSON.parse(row.converters_json || '[]'),
      audit: JSON.parse(row.audit_json || '{}'),
      gate: JSON.parse(row.gate_json || '{}'),
    });
  }
}
