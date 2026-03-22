import { randomUUID } from 'node:crypto';
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
  computeConfidenceDecay,
  computeReinforcedConfidence,
  computeTextOverlap,
  renderDailySummaryMarkdown,
  shouldArchive,
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
  backfillLegacyMemories,
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

const MemoryConfidenceRowSchema = z.object({
  confidence: z.number(),
  content: z.string(),
});

const DecayCandidateRowSchema = z.object({
  id: z.string(),
  confidence: z.number(),
  last_reinforced_at: z.string().nullable(),
  created_at: z.string(),
  durable: z.number(),
});

const ConsolidationRowSchema = z.object({
  id: z.string(),
  description: z.string(),
  content: z.string(),
  memory_type: z.string().nullable(),
  confidence: z.number(),
  scope: z.string(),
  dedup_key: z.string().nullable(),
});

const IdRowSchema = z.object({
  id: z.string(),
});

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

const PromotionRowSchema = z.object({
  description: z.string(),
  content: z.string(),
});

const MemoryContentRowSchema = z.object({
  content: z.string(),
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
  decayed: number;
  archived: number;
  merged: number;
  deduped: number;
  qualityArchived: number;
  ttlExpired?: number | undefined;
  staleMarked?: number | undefined;
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

  private captureStructuredMemory(input: MemoryInsertInput, memoryType: MemoryType): void {
    const structuredSources = new Set<MemoryRecord['sourceType']>(['receipt', 'compaction_flush', 'workspace_doc', 'daily_summary', 'coding_session', 'code_review', 'debug_session']);
    if (!structuredSources.has(input.sourceType)) return;

    const { text: redactedContent } = redactText(input.content, this.config.security.redactionPatterns);

    // Resolve or create source stream
    const stableKey = buildStableKey(input.sourceType, {
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
      return;
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
      return;
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
  }

  insertMemory(input: MemoryInsertInput): StoreMemoryResult {
    const memoryType = input.memoryType ?? classifyMemoryType(input.sourceType, input.content);
    const result = this.searchService.storeMemory({
      description: input.description,
      classification: input.classification,
      sourceType: input.sourceType,
      content: input.content,
      confidence: input.confidence,
      scope: input.scope,
      ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      memoryType,
      ...(input.sourceRef !== undefined ? { sourceRef: input.sourceRef } : {}),
      ...(input.sourceRefType !== undefined ? { sourceRefType: input.sourceRefType } : {}),
    });

    // Apply caller-provided domain, contextReleasePolicy, and dedupKey
    // These fields are not part of the storeMemory interface, so we set them directly.
    if (!result.rejected) {
      const updates: string[] = [];
      const params: unknown[] = [];
      if (input.domain) { updates.push('domain = ?'); params.push(input.domain); }
      if (input.contextReleasePolicy) { updates.push('context_release_policy = ?'); params.push(input.contextReleasePolicy); }
      if (input.dedupKey) { updates.push('dedup_key = ?'); params.push(input.dedupKey); }
      if (input.sourceRunId) { updates.push('source_run_id = ?'); params.push(input.sourceRunId); }
      if (input.sourceTimestamp) { updates.push('source_timestamp = ?'); params.push(input.sourceTimestamp); }
      if (input.durable) { updates.push('durable = ?'); params.push(1); }
      if (updates.length > 0) {
        params.push(result.memoryId);
        this.databases.memory
          .prepare(`UPDATE memories SET ${updates.join(', ')} WHERE id = ?`)
          .run(...params);
      }
    }

    if (!result.rejected) {
      this.captureStructuredMemory(input, memoryType);
    }

    return result;
  }

  reinforceMemory(memoryId: string, additionalContent?: string): void {
    const rawRow = this.databases.memory
      .prepare('SELECT confidence, content FROM memories WHERE id = ?')
      .get(memoryId);
    if (!rawRow) return;
    const row = MemoryConfidenceRowSchema.parse(rawRow);
    if (!row) return;

    const newConfidence = computeReinforcedConfidence(row.confidence);
    const now = nowIso();
    const updates: Record<string, unknown> = {
      confidence: newConfidence,
      last_reinforced_at: now,
      archived_at: null,
    };

    if (additionalContent) {
      updates.content = `${row.content}\n\n---\n\n${additionalContent}`;
    }

    this.databases.memory
      .prepare(
        `UPDATE memories SET confidence = ?, last_reinforced_at = ?, archived_at = NULL${additionalContent ? ', content = ?' : ''} WHERE id = ?`,
      )
      .run(...(additionalContent ? [newConfidence, now, updates.content, memoryId] : [newConfidence, now, memoryId]));

    this.databases.memory
      .prepare('INSERT INTO memory_events (id, memory_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), memoryId, 'reinforced', JSON.stringify({ previousConfidence: row.confidence, newConfidence }), now);
  }

  runConfidenceDecay(): { decayed: number; archived: number } {
    const halfLife = this.config.memory.confidenceHalfLifeDays;
    const archiveThreshold = this.config.memory.archiveThreshold;
    const now = new Date();
    const nowStr = nowIso();
    let decayed = 0;
    let archived = 0;

    const rows = z.array(DecayCandidateRowSchema).parse(this.databases.memory
      .prepare('SELECT id, confidence, last_reinforced_at, created_at, durable FROM memories WHERE archived_at IS NULL')
      .all());

    const updateStmt = this.databases.memory.prepare('UPDATE memories SET confidence = ? WHERE id = ?');
    const archiveStmt = this.databases.memory.prepare('UPDATE memories SET confidence = ?, archived_at = ? WHERE id = ?');
    const eventStmt = this.databases.memory.prepare('INSERT INTO memory_events (id, memory_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)');

    const tx = this.databases.memory.transaction(() => {
      for (const row of rows) {
        const referenceDate = row.last_reinforced_at ?? row.created_at;
        const daysSince = (now.getTime() - new Date(referenceDate).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince <= 0) continue;

        const effectiveHalfLife = row.durable ? halfLife * 10 : halfLife;
        const newConfidence = computeConfidenceDecay(row.confidence, daysSince, effectiveHalfLife);
        if (Math.abs(newConfidence - row.confidence) < 0.001) continue;

        if (shouldArchive(newConfidence, archiveThreshold)) {
          archiveStmt.run(newConfidence, nowStr, row.id);
          eventStmt.run(randomUUID(), row.id, 'archived', JSON.stringify({ confidence: newConfidence, reason: 'decay' }), nowStr);
          archived++;
        } else {
          updateStmt.run(newConfidence, row.id);
          eventStmt.run(randomUUID(), row.id, 'decayed', JSON.stringify({ from: row.confidence, to: newConfidence }), nowStr);
        }
        decayed++;
      }
    });
    tx();

    return { decayed, archived };
  }

  runStructuredGovernance(): { ttlExpired: number; staleMarked: number } {
    const ttl = runTtlExpiry(this.databases.memory);
    const stale = runStalenessMarking(this.databases.memory);
    return { ttlExpired: ttl.expired, staleMarked: stale.marked };
  }

  runLegacyBackfill(opts: { scope: string; namespaceId: string; classification: 'secret' | 'sensitive' | 'internal' | 'embeddable' }): { processed: number; skipped: number; errors: number } {
    return backfillLegacyMemories(this.databases.memory, {
      scope: opts.scope,
      namespaceId: opts.namespaceId,
      classification: opts.classification,
      batchSize: 100,
    });
  }

  runConsolidation(): { merged: number; deduped: number; qualityArchived: number } {
    if (!this.config.memory.consolidationEnabled) return { merged: 0, deduped: 0, qualityArchived: 0 };

    const nowStr = nowIso();
    let merged = 0;
    let deduped = 0;

    const rows = z.array(ConsolidationRowSchema).parse(this.databases.memory
      .prepare('SELECT id, description, content, memory_type, confidence, scope, dedup_key FROM memories WHERE archived_at IS NULL ORDER BY scope, memory_type, created_at')
      .all());

    // Group by scope + memory_type
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = `${row.scope}:${row.memory_type}`;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }

    const tx = this.databases.memory.transaction(() => {
      for (const group of groups.values()) {
        if (group.length < 2) continue;

        // Exact dedup by dedup_key
        const byDedup = new Map<string, typeof rows>();
        for (const row of group) {
          if (!row.dedup_key) continue;
          const existing = byDedup.get(row.dedup_key) ?? [];
          existing.push(row);
          byDedup.set(row.dedup_key, existing);
        }

        for (const dupes of byDedup.values()) {
          if (dupes.length < 2) continue;
          // Keep highest confidence
          dupes.sort((a, b) => b.confidence - a.confidence);
          const keeper = dupes[0]!;
          for (let i = 1; i < dupes.length; i++) {
            const loser = dupes[i]!;
            this.databases.memory.prepare('UPDATE memories SET archived_at = ? WHERE id = ?').run(nowStr, loser.id);
            this.databases.memory
              .prepare('INSERT INTO memory_consolidations (id, memory_id, merged_into_id, reason, created_at) VALUES (?, ?, ?, ?, ?)')
              .run(randomUUID(), loser.id, keeper.id, 'exact_dedup', nowStr);
            this.databases.memory
              .prepare('INSERT INTO memory_events (id, memory_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)')
              .run(randomUUID(), loser.id, 'consolidated', JSON.stringify({ mergedInto: keeper.id }), nowStr);
            deduped++;
          }
        }

        // Text overlap merge (O(n^2) but groups should be small)
        // Bulk-fetch archived status to avoid per-row queries
        const archivedIds = new Set(
          z.array(IdRowSchema).parse(this.databases.memory
            .prepare('SELECT id FROM memories WHERE archived_at IS NOT NULL')
            .all())
            .map((row) => row.id),
        );
        const active = group.filter((r) => !archivedIds.has(r.id));
        for (let i = 0; i < active.length; i++) {
          for (let j = i + 1; j < active.length; j++) {
            const a = active[i]!;
            const b = active[j]!;
            const overlap = computeTextOverlap(a.content, b.content);
            if (overlap > 0.8) {
              const [keeper, loser] = a.confidence >= b.confidence ? [a, b] : [b, a];
              this.databases.memory.prepare('UPDATE memories SET archived_at = ? WHERE id = ?').run(nowStr, loser.id);
              this.databases.memory
                .prepare('INSERT INTO memory_consolidations (id, memory_id, merged_into_id, reason, created_at) VALUES (?, ?, ?, ?, ?)')
                .run(randomUUID(), loser.id, keeper.id, `text_overlap_${overlap.toFixed(2)}`, nowStr);
              this.databases.memory
                .prepare('INSERT INTO memory_events (id, memory_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)')
                .run(randomUUID(), loser.id, 'consolidated', JSON.stringify({ mergedInto: keeper.id, overlap }), nowStr);
              merged++;
            }
          }
        }
      }
    });
    tx();

    // Quality sweep: archive memories that fail quality gates
    let qualityArchived = 0;
    if (this.config.memory.qualitySweepEnabled) {
      const activeRows = z.array(z.object({ id: z.string(), description: z.string(), content: z.string() })).parse(
        this.databases.memory
          .prepare('SELECT id, description, content FROM memories WHERE archived_at IS NULL')
          .all(),
      );

      const sweepTx = this.databases.memory.transaction(() => {
        for (const row of activeRows) {
          const assessment = assessMemoryQuality(row.description, row.content);
          if (!assessment.pass) {
            this.databases.memory.prepare('UPDATE memories SET archived_at = ? WHERE id = ?').run(nowStr, row.id);
            this.databases.memory
              .prepare('INSERT INTO memory_events (id, memory_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)')
              .run(randomUUID(), row.id, 'quality_archived', JSON.stringify({ reason: assessment.reason, score: assessment.score }), nowStr);
            qualityArchived++;
          }
        }
      });
      sweepTx();
    }

    return { merged, deduped, qualityArchived };
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
        const memResult = await this.searchService.storeMemoryWithEmbedding({
          description: `Compaction summary from run ${runId}`,
          classification: 'embeddable',
          sourceType: 'compaction_flush',
          content: rootRow.content,
          confidence: this.config.memory.compactionFlushConfidence,
          scope: workspaceId,
          memoryType: classifyMemoryType('compaction_flush', rootRow.content),
          sourceRef: runId,
          sourceRefType: 'run',
        });

        if (!memResult.rejected) {
          this.captureStructuredMemory({
            description: `Compaction summary from run ${runId}`,
            classification: 'embeddable',
            sourceType: 'compaction_flush',
            content: rootRow.content,
            confidence: this.config.memory.compactionFlushConfidence,
            scope: workspaceId,
            memoryType: classifyMemoryType('compaction_flush', rootRow.content),
            sourceRef: runId,
            sourceRefType: 'run',
            sourceRunId: runId,
            sourceTimestamp: now,
            occurredAt: now,
            tags: ['compaction-summary'],
            sourceMetadata: { runId, summaryIds: result.summaryIds.length, condensedLevels: result.condensedLevels },
          }, classifyMemoryType('compaction_flush', rootRow.content));

          this.databases.memory
            .prepare('UPDATE memories SET source_run_id = ?, source_timestamp = ? WHERE id = ?')
            .run(runId, now, memResult.memoryId);

          this.databases.memory
            .prepare('INSERT INTO memory_events (id, memory_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(randomUUID(), memResult.memoryId, 'compaction_flushed', JSON.stringify({ runId, embedded: memResult.embedded, summaryIds: result.summaryIds.length, condensedLevels: result.condensedLevels }), now);

          return [{
            id: memResult.memoryId,
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
            memoryType: classifyMemoryType('compaction_flush', rootRow.content),
            dedupKey: null,
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
      const result = await this.searchService.storeMemoryWithEmbedding({
        description: `Compaction flush from run ${runId}`,
        classification: 'embeddable',
        sourceType: 'compaction_flush',
        content: chunk,
        confidence: this.config.memory.compactionFlushConfidence,
        scope: workspaceId,
        memoryType,
        sourceRef: runId,
        sourceRefType: 'run',
      });

      if (result.rejected) continue;

      this.captureStructuredMemory({
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
      }, memoryType);

      this.databases.memory
        .prepare('UPDATE memories SET source_run_id = ?, source_timestamp = ? WHERE id = ?')
        .run(runId, now, result.memoryId);

      this.databases.memory
        .prepare('INSERT INTO memory_events (id, memory_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(randomUUID(), result.memoryId, 'compaction_flushed', JSON.stringify({ runId, embedded: result.embedded }), now);

      results.push({
        id: result.memoryId,
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
        dedupKey: null,
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
      const contentHash = sha256(content);
      const dedupKey = `workspace_doc:${sha256(resolve(filePath))}`;

      // Check if we already have this exact content indexed
      const rawExisting = this.databases.memory
        .prepare('SELECT id, content FROM memories WHERE dedup_key = ? AND archived_at IS NULL')
        .get(dedupKey);
      const existing = rawExisting
        ? z.object({ id: z.string(), content: z.string() }).parse(rawExisting)
        : undefined;

      if (existing) {
        const existingHash = sha256(existing.content);
        if (existingHash === contentHash) {
          skipped++;
          continue;
        }
        // Content changed — archive old, re-index below
        this.databases.memory
          .prepare('UPDATE memories SET archived_at = ? WHERE id = ?')
          .run(nowIso(), existing.id);
      }

      const relPath = relative(rootPath, filePath);
      const redacted = redactText(content, this.config.security.redactionPatterns);
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
        sourceMetadata: { relativePath: relPath, contentHash },
      });

      // Skip if quality gate rejected
      if (result.rejected) {
        skipped++;
        continue;
      }

      // Override dedup_key to use file-path-based key for stable identity
      this.databases.memory
        .prepare('UPDATE memories SET dedup_key = ? WHERE id = ?')
        .run(dedupKey, result.memoryId);

      indexed++;
    }

    return { indexed, skipped };
  }

  getMemoryAudit(): MemoryAuditResponse {
    const total = parseCountCRow(this.databases.memory.prepare('SELECT COUNT(*) as c FROM memories').get());
    const active = parseCountCRow(this.databases.memory.prepare('SELECT COUNT(*) as c FROM memories WHERE archived_at IS NULL').get());
    const archived = total - active;

    const avgConf = AvgRowSchema.parse(this.databases.memory.prepare('SELECT COALESCE(AVG(confidence), 0) as a FROM memories WHERE archived_at IS NULL').get()).a;

    const staleCount = parseCountCRow(
      this.databases.memory
        .prepare('SELECT COUNT(*) as c FROM memories WHERE archived_at IS NULL AND confidence < 0.3')
        .get(),
    );

    const consolidations = parseCountCRow(this.databases.memory.prepare('SELECT COUNT(*) as c FROM memory_consolidations').get());

    const byType: Record<string, number> = {};
    const typeRows = z.array(TypeCountRowSchema).parse(this.databases.memory
      .prepare('SELECT memory_type, COUNT(*) as c FROM memories WHERE archived_at IS NULL GROUP BY memory_type')
      .all());
    for (const row of typeRows) byType[String(row.memory_type)] = row.c;

    const byScope: Record<string, number> = {};
    const scopeRows = z.array(ScopeCountRowSchema).parse(this.databases.memory
      .prepare('SELECT scope, COUNT(*) as c FROM memories WHERE archived_at IS NULL GROUP BY scope')
      .all());
    for (const row of scopeRows) byScope[row.scope] = row.c;

    const byClassification: Record<string, number> = {};
    const classRows = z.array(ClassificationCountRowSchema).parse(this.databases.memory
      .prepare('SELECT classification, COUNT(*) as c FROM memories WHERE archived_at IS NULL GROUP BY classification')
      .all());
    for (const row of classRows) byClassification[row.classification] = row.c;

    const lastDecay = parseTimestampRow(this.databases.memory.prepare("SELECT MAX(created_at) as t FROM memory_events WHERE type = 'decayed'").get());
    const lastConsolidation = parseTimestampRow(
      this.databases.memory.prepare("SELECT MAX(created_at) as t FROM memory_events WHERE type = 'consolidated'").get(),
    );
    const lastDaily = parseTimestampRow(
      this.databases.memory.prepare("SELECT MAX(created_at) as t FROM memories WHERE source_type = 'daily_summary'").get(),
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
    const rawRow = this.databases.memory.prepare('SELECT description, content FROM memories WHERE id = ?').get(memoryId);
    if (!rawRow) {
      return { memoryId, targetPath, diff: '', approved: false, promoted: false };
    }
    const row = PromotionRowSchema.parse(rawRow);

    const diff = `+ ${row.description}\n+ ${row.content}`;
    return { memoryId, targetPath, diff, approved: false, promoted: false };
  }

  executePromotion(request: MemoryPromotionResponse): MemoryPromotionResponse {
    if (!request.approved) {
      return { ...request, promoted: false };
    }

    const memoryDir = resolve(this.databases.paths.memoryDailyDir, '..');
    const resolvedTargetPath = validatePromotionTargetPath(memoryDir, request.targetPath);

    const rawRow = this.databases.memory.prepare('SELECT content FROM memories WHERE id = ?').get(request.memoryId);
    const row = rawRow ? MemoryContentRowSchema.parse(rawRow) : null;
    if (!row) return { ...request, promoted: false };

    mkdirSync(dirname(resolvedTargetPath), { recursive: true, mode: 0o700 });
    writeFileSync(resolvedTargetPath, row.content, { mode: 0o600 });

    this.databases.memory
      .prepare('INSERT INTO memory_events (id, memory_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), request.memoryId, 'promoted', JSON.stringify({ targetPath: resolvedTargetPath }), nowIso());

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
