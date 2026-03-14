import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import type {
  AppConfig,
  MemoryAuditResponse,
  MemoryRecord,
  MemoryType,
} from '@popeye/contracts';
import { MemoryAuditResponseSchema } from '@popeye/contracts';
import {
  classifyMemoryType,
  computeConfidenceDecay,
  computeReinforcedConfidence,
  computeTextOverlap,
  renderDailySummaryMarkdown,
  shouldArchive,
  type MemorySearchService,
} from '@popeye/memory';
import { redactText } from '@popeye/observability';

import type { RuntimeDatabases } from './database.js';

import { nowIso } from '@popeye/contracts';
import { z } from 'zod';

const MemoryConfidenceRowSchema = z.object({
  confidence: z.number(),
  content: z.string(),
});

const DecayCandidateRowSchema = z.object({
  id: z.string(),
  confidence: z.number(),
  last_reinforced_at: z.string().nullable(),
  created_at: z.string(),
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
  memoryType?: MemoryType;
  sourceRef?: string;
  sourceRefType?: string;
}

export interface MemoryMaintenanceResult {
  decayed: number;
  archived: number;
  merged: number;
  deduped: number;
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

  constructor(databases: RuntimeDatabases, config: AppConfig, searchService: MemorySearchService) {
    this.databases = databases;
    this.config = config;
    this.searchService = searchService;
  }

  insertMemory(input: MemoryInsertInput): { memoryId: string; embedded: boolean } {
    const memoryType = input.memoryType ?? classifyMemoryType(input.sourceType, input.content);
    return this.searchService.storeMemory({
      description: input.description,
      classification: input.classification,
      sourceType: input.sourceType,
      content: input.content,
      confidence: input.confidence,
      scope: input.scope,
      memoryType,
      sourceRef: input.sourceRef,
      sourceRefType: input.sourceRefType,
    });
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
      .prepare('SELECT id, confidence, last_reinforced_at, created_at FROM memories WHERE archived_at IS NULL')
      .all());

    const updateStmt = this.databases.memory.prepare('UPDATE memories SET confidence = ? WHERE id = ?');
    const archiveStmt = this.databases.memory.prepare('UPDATE memories SET confidence = ?, archived_at = ? WHERE id = ?');
    const eventStmt = this.databases.memory.prepare('INSERT INTO memory_events (id, memory_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)');

    const tx = this.databases.memory.transaction(() => {
      for (const row of rows) {
        const referenceDate = row.last_reinforced_at ?? row.created_at;
        const daysSince = (now.getTime() - new Date(referenceDate).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince <= 0) continue;

        const newConfidence = computeConfidenceDecay(row.confidence, daysSince, halfLife);
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

  runConsolidation(): { merged: number; deduped: number } {
    if (!this.config.memory.consolidationEnabled) return { merged: 0, deduped: 0 };

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
          const keeper = dupes[0];
          for (let i = 1; i < dupes.length; i++) {
            this.databases.memory.prepare('UPDATE memories SET archived_at = ? WHERE id = ?').run(nowStr, dupes[i].id);
            this.databases.memory
              .prepare('INSERT INTO memory_consolidations (id, memory_id, merged_into_id, reason, created_at) VALUES (?, ?, ?, ?, ?)')
              .run(randomUUID(), dupes[i].id, keeper.id, 'exact_dedup', nowStr);
            this.databases.memory
              .prepare('INSERT INTO memory_events (id, memory_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)')
              .run(randomUUID(), dupes[i].id, 'consolidated', JSON.stringify({ mergedInto: keeper.id }), nowStr);
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
            const overlap = computeTextOverlap(active[i].content, active[j].content);
            if (overlap > 0.8) {
              const [keeper, loser] = active[i].confidence >= active[j].confidence ? [active[i], active[j]] : [active[j], active[i]];
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

    return { merged, deduped };
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
    });

    return { markdownPath, memoryId: result.memoryId };
  }

  async processCompactionFlush(runId: string, compactedContent: string, workspaceId: string): Promise<MemoryRecord[]> {
    const redacted = redactText(compactedContent, this.config.security.redactionPatterns);
    const chunks = splitContentChunks(redacted.text);
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

      // Store provenance columns
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
        sourceRunId: runId,
        sourceTimestamp: now,
        memoryType,
        dedupKey: null,
        lastReinforcedAt: null,
        archivedAt: null,
        createdAt: now,
      });
    }

    return results;
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
