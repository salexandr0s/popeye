import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import type {
  AppConfig,
  IntegrityReport,
  MemoryAuditResponse,
  MemoryRecord,
  MemoryType,
} from '@popeye/contracts';
import { MemoryAuditResponseSchema } from '@popeye/contracts';
import {
  assessMemoryQuality,
  classifyMemoryType,
  createSynthesis,
  captureArtifact,
  extractFacts,
  type StoreMemoryResult,
  computeDedupKey,
  renderDailySummaryMarkdown,
  type MemorySearchService,
  runIntegrityChecks,
  CompactionEngine,
  type SummarizationClient,
  upsertFacts,
  resolveOrCreateSourceStream,
  hasContentChanged,
  updateSourceStreamStatus,
  buildStableKey,
  insertChunks,
  selectChunker,
  buildProfileStatic,
  buildProfileDynamic,
  shouldRefreshProfile,
  runTtlExpiry,
  runStalenessMarking,
} from '@popeye/memory';
import { buildSummarizePrompt, buildRetryPrompt } from './summarize-prompts.js';
import { redactText, sha256 } from '@popeye/observability';

import type { RuntimeDatabases } from './database.js';

import { nowIso } from '@popeye/contracts';
import { z } from 'zod';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'coverage', 'build',
  '.next', '.turbo', '.cache', 'out', '.svn',
]);

function walkMarkdownFiles(rootPath: string, skipDirs: Set<string>): string[] {
  const results: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // Permission denied or other FS error — skip this directory
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name) || entry.name.startsWith('.')) continue;
        walk(resolve(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(resolve(dir, entry.name));
      }
    }
  };
  walk(rootPath);
  return results;
}


const ReceiptSummaryRowSchema = z.object({
  status: z.string(),
  summary: z.string(),
});

const CountCRowSchema = z.object({
  c: z.coerce.number().int().nonnegative(),
});

const AvgRowSchema = z.object({
  a: z.coerce.number().nonnegative(),
});

const TypeCountRowSchema = z.object({
  memory_type: z.string().nullable(),
  c: z.coerce.number().int().nonnegative(),
});

const ScopeCountRowSchema = z.object({
  scope: z.string(),
  c: z.coerce.number().int().nonnegative(),
});

const ClassificationCountRowSchema = z.object({
  classification: z.string(),
  c: z.coerce.number().int().nonnegative(),
});

const TimestampRowSchema = z.object({
  t: z.string().nullable(),
});



function findNearestExistingPath(path: string): string | null {
  let current = path;
  while (true) {
    if (existsSync(current)) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function isPathWithin(rootPath: string, candidatePath: string): boolean {
  const rel = relative(rootPath, candidatePath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function validatePromotionTargetPath(memoryRoot: string, targetPath: string): string {
  const canonicalMemoryRoot = realpathSync(memoryRoot);
  const resolvedTargetPath = resolve(targetPath);
  const nearestExistingPath = findNearestExistingPath(resolvedTargetPath);
  if (!nearestExistingPath) {
    throw new Error(`Target path must be within memory directory: ${canonicalMemoryRoot}`);
  }

  const canonicalAncestor = realpathSync(nearestExistingPath);
  const canonicalTargetPath = resolve(
    canonicalAncestor,
    relative(nearestExistingPath, resolvedTargetPath),
  );

  if (!isPathWithin(canonicalMemoryRoot, canonicalTargetPath)) {
    throw new Error(`Target path must be within memory directory: ${canonicalMemoryRoot}`);
  }
  if (!isPathWithin(canonicalMemoryRoot, canonicalAncestor)) {
    throw new Error(`Target path must be within memory directory: ${canonicalMemoryRoot}`);
  }

  const parentDir = dirname(resolvedTargetPath);
  if (existsSync(parentDir) && lstatSync(parentDir).isSymbolicLink()) {
    throw new Error(`Target path must be within memory directory: ${canonicalMemoryRoot}`);
  }

  return resolvedTargetPath;
}

function parseCountCRow(row: unknown): number {
  return CountCRowSchema.parse(row).c;
}

function parseTimestampRow(row: unknown): string | null {
  const parsed = TimestampRowSchema.safeParse(row);
  return parsed.success ? parsed.data.t : null;
}

export interface MemoryInsertInput {
  description: string;
  classification: 'secret' | 'sensitive' | 'internal' | 'embeddable';
  sourceType: MemoryRecord['sourceType'];
  content: string;
  confidence: number;
  scope: string;
  workspaceId?: string | null;
  projectId?: string | null;
  memoryType?: MemoryType | undefined;
  sourceRef?: string | undefined;
  sourceRefType?: string | undefined;
  domain?: MemoryRecord['domain'] | undefined;
  contextReleasePolicy?: MemoryRecord['contextReleasePolicy'] | undefined;
  dedupKey?: string | undefined;
  sourceRunId?: string | undefined;
  sourceTimestamp?: string | undefined;
  occurredAt?: string | undefined;
  tags?: string[] | undefined;
  sourceMetadata?: Record<string, unknown> | undefined;
  durable?: boolean | undefined;
}

export interface MemoryMaintenanceResult {
  ttlExpired: number;
  staleMarked: number;
}

export interface MemoryPromotionResponse {
  memoryId: string;
  targetPath: string;
  diff: string;
  approved: boolean;
  promoted: boolean;
}

export class MemoryLifecycleService {
  private readonly databases: RuntimeDatabases;
  private readonly config: AppConfig;
  private readonly searchService: MemorySearchService;
  private readonly summarizationClient: SummarizationClient | null;

  constructor(databases: RuntimeDatabases, config: AppConfig, searchService: MemorySearchService, summarizationClient?: SummarizationClient) {
    this.databases = databases;
    this.config = config;
    this.searchService = searchService;
    this.summarizationClient = summarizationClient ?? null;
  }

  /** Writes to structured tables. Returns the artifact ID, or null if the write was skipped. */
  private captureStructuredMemory(input: MemoryInsertInput, memoryType: MemoryType): string | null {
    const structuredSources = new Set<MemoryRecord['sourceType']>(['receipt', 'compaction_flush', 'workspace_doc', 'daily_summary', 'playbook', 'coding_session', 'code_review', 'debug_session', 'curated_memory']);
    if (!structuredSources.has(input.sourceType)) return null;

    const { text: redactedContent } = redactText(input.content, this.config.security.redactionPatterns);

    // Resolve or create source stream
    const stableKey = input.sourceType === 'playbook'
      ? buildStableKey(input.sourceType, {
          ref: input.sourceRef ?? input.sourceRunId ?? undefined,
        })
      : buildStableKey(input.sourceType, {
          workspace: input.workspaceId ?? undefined,
          ref: input.sourceRef ?? input.sourceRunId ?? undefined,
        });
    const sourceStream = resolveOrCreateSourceStream(this.databases.memory, {
      stableKey,
      providerKind: 'runtime',
      sourceType: input.sourceType,
      scope: input.scope,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      classification: input.classification,
      domain: input.domain,
      title: input.description,
    });

    // Content-hash no-op detection
    if (!hasContentChanged(this.databases.memory, sourceStream.id, redactedContent)) {
      return null;
    }

    updateSourceStreamStatus(this.databases.memory, sourceStream.id, 'processing');

    const artifact = captureArtifact(this.databases.memory, {
      sourceType: input.sourceType,
      classification: input.classification,
      scope: input.scope,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      content: redactedContent,
      sourceRunId: input.sourceRunId ?? null,
      sourceRef: input.sourceRef ?? null,
      sourceRefType: input.sourceRefType ?? null,
      occurredAt: input.occurredAt ?? input.sourceTimestamp ?? null,
      metadata: {
        description: input.description,
        ...(input.sourceMetadata ?? {}),
      },
      tags: input.tags,
      domain: input.domain,
      sourceStreamId: sourceStream.id,
    });

    // Chunk the artifact
    const chunker = selectChunker(input.sourceType);
    const chunkResults = chunker.chunk(redactedContent);
    if (chunkResults.length > 0) {
      insertChunks(this.databases.memory, {
        artifactId: artifact.id,
        sourceStreamId: sourceStream.id,
        classification: input.classification,
        contextReleasePolicy: input.contextReleasePolicy,
        chunks: chunkResults,
      });
    }

    const extracted = extractFacts({
      description: input.description,
      content: redactedContent,
      classification: input.classification,
      sourceType: input.sourceType,
      scope: input.scope,
      memoryType,
      sourceRunId: input.sourceRunId ?? null,
      sourceTimestamp: input.sourceTimestamp ?? null,
      occurredAt: input.occurredAt ?? input.sourceTimestamp ?? null,
    });

    if (extracted.length === 0) {
      updateSourceStreamStatus(this.databases.memory, sourceStream.id, 'done', sha256(redactedContent));
      return null;
    }

    const upserted = upsertFacts(this.databases.memory, {
      artifact,
      sourceType: input.sourceType,
      scope: input.scope,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      classification: input.classification,
      memoryType,
      sourceRunId: input.sourceRunId ?? null,
      sourceTimestamp: input.sourceTimestamp ?? null,
      facts: extracted,
      tags: input.tags,
      domain: input.domain,
    });

    if (input.sourceType === 'daily_summary' && upserted.records.length > 0) {
      createSynthesis(this.databases.memory, {
        namespaceId: artifact.namespaceId,
        scope: input.scope,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        classification: input.classification,
        synthesisKind: 'daily',
        title: input.description,
        text: redactedContent,
        confidence: input.confidence,
        refreshPolicy: 'automatic_daily',
        sourceFacts: upserted.records.map((record) => ({ id: record.id })),
        tags: ['daily-summary', ...(input.tags ?? [])],
        domain: input.domain,
      });
    }

    if (input.sourceType === 'compaction_flush' && input.description.toLowerCase().includes('summary') && upserted.records.length > 0) {
      createSynthesis(this.databases.memory, {
        namespaceId: artifact.namespaceId,
        scope: input.scope,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        classification: input.classification,
        synthesisKind: 'project_state',
        title: input.description,
        text: redactedContent,
        confidence: input.confidence,
        refreshPolicy: 'automatic_compaction',
        sourceFacts: upserted.records.map((record) => ({ id: record.id })),
        tags: ['compaction-summary', ...(input.tags ?? [])],
        domain: input.domain,
      });
    }

    // Refresh profiles when durable facts change
    if ((upserted.inserted > 0 || upserted.updated > 0) && upserted.records.some((r) => r.durable)) {
      if (shouldRefreshProfile(this.databases.memory, input.scope, 'profile_static')) {
        buildProfileStatic(this.databases.memory, {
          scope: input.scope,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          namespaceId: artifact.namespaceId,
          classification: input.classification,
          domain: input.domain,
        });
      }
    }
    if (upserted.inserted > 0 || upserted.updated > 0) {
      if (shouldRefreshProfile(this.databases.memory, input.scope, 'profile_dynamic')) {
        buildProfileDynamic(this.databases.memory, {
          scope: input.scope,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          namespaceId: artifact.namespaceId,
          classification: input.classification,
          domain: input.domain,
        });
      }
    }

    updateSourceStreamStatus(this.databases.memory, sourceStream.id, 'done', sha256(redactedContent));
    return artifact.id;
  }

  insertMemory(input: MemoryInsertInput): StoreMemoryResult {
    const memoryType = input.memoryType ?? classifyMemoryType(input.sourceType, input.content);

    // Quality gate
    const quality = assessMemoryQuality(input.description, input.content);
    if (!quality.pass) {
      return { memoryId: '', embedded: false, rejected: true, rejectionReason: quality.reason };
    }

    const artifactId = this.captureStructuredMemory(input, memoryType);

    // Return the artifact ID as memoryId for backward compat.
    // If captureStructuredMemory returned null (no-op for unsupported sourceType
    // or unchanged content), fall back to a deterministic dedup key.
    const memoryId = artifactId ?? computeDedupKey(input.description, input.content, input.scope);
    return { memoryId, embedded: false, rejected: false };
  }


  runStructuredGovernance(): { ttlExpired: number; staleMarked: number } {
    const ttl = runTtlExpiry(this.databases.memory);
    const stale = runStalenessMarking(this.databases.memory);
    return { ttlExpired: ttl.expired, staleMarked: stale.marked };
  }


  generateDailySummary(date: string, workspaceId: string): { markdownPath: string; memoryId: string } | null {
    const dayStart = `${date}T00:00:00.000Z`;
    const dayEnd = `${date}T23:59:59.999Z`;

    const rows = z.array(ReceiptSummaryRowSchema).parse(this.databases.app
      .prepare('SELECT status, summary FROM receipts WHERE workspace_id = ? AND created_at >= ? AND created_at <= ? ORDER BY created_at')
      .all(workspaceId, dayStart, dayEnd));

    if (rows.length === 0) return null;

    const runsCompleted = rows.filter((r) => r.status === 'succeeded').length;
    const runsFailed = rows.filter((r) => r.status === 'failed').length;
    const discoveries = rows.filter((r) => r.status === 'succeeded').map((r) => r.summary).slice(0, 10);
    const errors = rows.filter((r) => r.status === 'failed').map((r) => r.summary).slice(0, 10);
    const followUps: string[] = [];

    const markdown = renderDailySummaryMarkdown({
      date,
      workspaceId,
      runsCompleted,
      runsFailed,
      discoveries,
      errors,
      followUps,
    });

    const redacted = redactText(markdown, this.config.security.redactionPatterns);
    const markdownPath = `${this.databases.paths.memoryDailyDir}/${date}.md`;

    mkdirSync(dirname(markdownPath), { recursive: true, mode: 0o700 });
    writeFileSync(markdownPath, redacted.text, { mode: 0o600 });

    const result = this.insertMemory({
      description: `Daily summary for ${date} in workspace ${workspaceId}`,
      classification: 'internal',
      sourceType: 'daily_summary',
      content: redacted.text,
      confidence: 1,
      scope: workspaceId,
      memoryType: 'episodic',
      sourceRef: markdownPath,
      sourceRefType: 'file',
      sourceTimestamp: `${date}T23:59:59.999Z`,
      occurredAt: `${date}T12:00:00.000Z`,
      tags: ['daily-summary', `date:${date}`],
      sourceMetadata: { date, workspaceId, markdownPath },
    });

    if (result.rejected) return null;
    return { markdownPath, memoryId: result.memoryId };
  }

  async processCompactionFlush(runId: string, compactedContent: string, workspaceId: string): Promise<MemoryRecord[]> {
    const redacted = redactText(compactedContent, this.config.security.redactionPatterns);

    // If summarization client is available, use multi-pass compaction
    if (this.summarizationClient?.enabled) {
      return this.processCompactionFlushWithEngine(runId, redacted.text, workspaceId);
    }

    // Fallback: original flat behavior
    return this.processCompactionFlushFlat(runId, redacted.text, workspaceId);
  }

  private async processCompactionFlushWithEngine(runId: string, content: string, workspaceId: string): Promise<MemoryRecord[]> {
    const now = nowIso();
    const engine = new CompactionEngine(
      this.databases.memory,
      (input) => this.summarizationClient!.complete(input),
      { buildSummarizePrompt, buildRetryPrompt },
      {
        fanout: this.config.memory.compactionFanout,
        freshTailCount: this.config.memory.compactionFreshTailCount,
        maxLeafTokens: this.config.memory.compactionMaxLeafTokens,
        maxCondensedTokens: this.config.memory.compactionMaxCondensedTokens,
        maxRetries: this.config.memory.compactionMaxRetries,
      },
    );

    const result = await engine.compactRun(runId, content, workspaceId, now, now);

    // Insert top-level summary into memories as summary_rollup
    if (result.rootSummaryId) {
      const rootRow = this.databases.memory
        .prepare('SELECT content FROM memory_summaries WHERE id = ?')
        .get(result.rootSummaryId) as { content: string } | undefined;

      if (rootRow) {
        const memoryType = classifyMemoryType('compaction_flush', rootRow.content);
        const artifactId = this.captureStructuredMemory({
          description: `Compaction summary from run ${runId}`,
          classification: 'embeddable',
          sourceType: 'compaction_flush',
          content: rootRow.content,
          confidence: this.config.memory.compactionFlushConfidence,
          scope: workspaceId,
          memoryType,
          sourceRef: runId,
          sourceRefType: 'run',
          sourceRunId: runId,
          sourceTimestamp: now,
          occurredAt: now,
          tags: ['compaction-summary'],
          sourceMetadata: { runId, summaryIds: result.summaryIds.length, condensedLevels: result.condensedLevels },
          // dedupKey is not consumed by captureStructuredMemory for dedup enforcement
          // (source stream content hashing handles that). Passed for the returned MemoryRecord shape.
          dedupKey: `compaction:${runId}:${sha256(rootRow.content)}`,
        }, memoryType);

        if (artifactId) {
          return [{
            id: artifactId,
            description: `Compaction summary from run ${runId}`,
            classification: 'embeddable',
            sourceType: 'compaction_flush',
            content: rootRow.content,
            confidence: this.config.memory.compactionFlushConfidence,
            scope: workspaceId,
            workspaceId,
            projectId: null,
            sourceRunId: runId,
            sourceTimestamp: now,
            memoryType,
            dedupKey: `compaction:${runId}:${sha256(rootRow.content)}`,
            lastReinforcedAt: null,
            archivedAt: null,
            createdAt: now,
            durable: false,
            domain: 'general',
            contextReleasePolicy: 'full',
          }];
        }
      }
    }

    return [];
  }

  private async processCompactionFlushFlat(runId: string, content: string, workspaceId: string): Promise<MemoryRecord[]> {
    const chunks = splitContentChunks(content);
    const results: MemoryRecord[] = [];
    const now = nowIso();

    for (const chunk of chunks) {
      const memoryType = classifyMemoryType('compaction_flush', chunk);
      const artifactId = this.captureStructuredMemory({
        description: `Compaction flush from run ${runId}`,
        classification: 'embeddable',
        sourceType: 'compaction_flush',
        content: chunk,
        confidence: this.config.memory.compactionFlushConfidence,
        scope: workspaceId,
        memoryType,
        sourceRef: runId,
        sourceRefType: 'run',
        sourceRunId: runId,
        sourceTimestamp: now,
        occurredAt: now,
        tags: ['compaction-flush'],
        sourceMetadata: { runId },
        // dedupKey is not consumed by captureStructuredMemory for dedup enforcement
        // (source stream content hashing handles that). Passed for the returned MemoryRecord shape.
        dedupKey: `compaction:${runId}:${sha256(chunk)}`,
      }, memoryType);

      if (!artifactId) continue;

      results.push({
        id: artifactId,
        description: `Compaction flush from run ${runId}`,
        classification: 'embeddable',
        sourceType: 'compaction_flush',
        content: chunk,
        confidence: this.config.memory.compactionFlushConfidence,
        scope: workspaceId,
        workspaceId,
        projectId: null,
        sourceRunId: runId,
        sourceTimestamp: now,
        memoryType,
        dedupKey: `compaction:${runId}:${sha256(chunk)}`,
        lastReinforcedAt: null,
        archivedAt: null,
        createdAt: now,
        durable: false,
        domain: 'general',
        contextReleasePolicy: 'full',
      });
    }

    return results;
  }

  indexWorkspaceDocs(workspaceId: string, rootPath: string): { indexed: number; skipped: number } {
    let indexed = 0;
    let skipped = 0;

    if (!existsSync(rootPath)) return { indexed, skipped };

    const files = walkMarkdownFiles(rootPath, SKIP_DIRS);
    for (const filePath of files) {
      const content = readFileSync(filePath, 'utf-8');
      const redacted = redactText(content, this.config.security.redactionPatterns);

      // Use memory_source_streams for content-hash dedup
      const stableKey = buildStableKey('workspace_doc', {
        workspace: workspaceId,
        ref: sha256(resolve(filePath)),
      });
      const sourceStream = resolveOrCreateSourceStream(this.databases.memory, {
        stableKey,
        providerKind: 'runtime',
        sourceType: 'workspace_doc',
        scope: workspaceId,
        workspaceId,
        projectId: null,
        classification: 'embeddable',
        domain: 'general',
        title: `Workspace doc: ${relative(rootPath, filePath)}`,
      });

      if (!hasContentChanged(this.databases.memory, sourceStream.id, redacted.text)) {
        skipped++;
        continue;
      }

      const relPath = relative(rootPath, filePath);
      const result = this.insertMemory({
        description: `Workspace doc: ${relPath}`,
        classification: 'embeddable',
        sourceType: 'workspace_doc',
        content: redacted.text,
        confidence: 0.9,
        scope: workspaceId,
        memoryType: 'semantic',
        sourceRef: filePath,
        sourceRefType: 'file',
        sourceTimestamp: nowIso(),
        tags: ['workspace-doc', `path:${relPath.toLowerCase()}`],
        sourceMetadata: { relativePath: relPath, contentHash: sha256(content) },
      });

      // Skip if quality gate rejected
      if (result.rejected) {
        skipped++;
        continue;
      }

      // Mark source stream as processed so re-run dedup works
      updateSourceStreamStatus(this.databases.memory, sourceStream.id, 'done', sha256(redacted.text));
      indexed++;
    }

    return { indexed, skipped };
  }

  getMemoryAudit(): MemoryAuditResponse {
    const total = parseCountCRow(this.databases.memory.prepare('SELECT COUNT(*) as c FROM memory_facts').get());
    const active = parseCountCRow(this.databases.memory.prepare('SELECT COUNT(*) as c FROM memory_facts WHERE archived_at IS NULL').get());
    const archived = total - active;

    const avgConf = AvgRowSchema.parse(this.databases.memory.prepare('SELECT COALESCE(AVG(confidence), 0) as a FROM memory_facts WHERE archived_at IS NULL').get()).a;

    const staleCount = parseCountCRow(
      this.databases.memory
        .prepare('SELECT COUNT(*) as c FROM memory_facts WHERE archived_at IS NULL AND confidence < 0.3')
        .get(),
    );

    const consolidations = 0;

    const byType: Record<string, number> = {};
    const typeRows = z.array(TypeCountRowSchema).parse(this.databases.memory
      .prepare('SELECT memory_type, COUNT(*) as c FROM memory_facts WHERE archived_at IS NULL GROUP BY memory_type')
      .all());
    for (const row of typeRows) byType[String(row.memory_type)] = row.c;

    const byScope: Record<string, number> = {};
    const scopeRows = z.array(ScopeCountRowSchema).parse(this.databases.memory
      .prepare('SELECT scope, COUNT(*) as c FROM memory_facts WHERE archived_at IS NULL GROUP BY scope')
      .all());
    for (const row of scopeRows) byScope[row.scope] = row.c;

    const byClassification: Record<string, number> = {};
    const classRows = z.array(ClassificationCountRowSchema).parse(this.databases.memory
      .prepare('SELECT classification, COUNT(*) as c FROM memory_facts WHERE archived_at IS NULL GROUP BY classification')
      .all());
    for (const row of classRows) byClassification[row.classification] = row.c;

    const lastDecay: string | null = null;
    const lastConsolidation: string | null = null;
    const lastDaily = parseTimestampRow(
      this.databases.memory.prepare("SELECT MAX(created_at) as t FROM memory_facts WHERE source_type = 'daily_summary'").get(),
    );

    return MemoryAuditResponseSchema.parse({
      totalMemories: total,
      activeMemories: active,
      archivedMemories: archived,
      byType,
      byScope,
      byClassification,
      averageConfidence: avgConf,
      staleCount,
      consolidationsPerformed: consolidations,
      lastDecayRunAt: lastDecay,
      lastConsolidationRunAt: lastConsolidation,
      lastDailySummaryAt: lastDaily,
    });
  }

  runIntegrityCheck(options?: { fix?: boolean }): IntegrityReport {
    return runIntegrityChecks(this.databases.memory, options);
  }

  proposePromotion(memoryId: string, targetPath: string): MemoryPromotionResponse {
    const rawRow = this.databases.memory.prepare('SELECT text FROM memory_facts WHERE id = ?').get(memoryId) as { text: string } | undefined;
    if (!rawRow) {
      return { memoryId, targetPath, diff: '', approved: false, promoted: false };
    }

    const diff = `+ ${rawRow.text}`;
    return { memoryId, targetPath, diff, approved: false, promoted: false };
  }

  executePromotion(request: MemoryPromotionResponse): MemoryPromotionResponse {
    if (!request.approved) {
      return { ...request, promoted: false };
    }

    const memoryDir = resolve(this.databases.paths.memoryDailyDir, '..');
    const resolvedTargetPath = validatePromotionTargetPath(memoryDir, request.targetPath);

    const rawRow = this.databases.memory.prepare('SELECT text FROM memory_facts WHERE id = ?').get(request.memoryId) as { text: string } | undefined;
    if (!rawRow) return { ...request, promoted: false };

    mkdirSync(dirname(resolvedTargetPath), { recursive: true, mode: 0o700 });
    writeFileSync(resolvedTargetPath, rawRow.text, { mode: 0o600 });

    return { ...request, targetPath: resolvedTargetPath, promoted: true };
  }
}

function splitContentChunks(content: string): string[] {
  const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().length > 0);
  if (paragraphs.length <= 1) return [content];

  const chunks: string[] = [];
  let current = '';
  for (const para of paragraphs) {
    if (current.length + para.length > 2000 && current.length > 0) {
      chunks.push(current.trim());
      current = '';
    }
    current += `${para}\n\n`;
  }
  if (current.trim().length > 0) chunks.push(current.trim());
  return chunks;
}
