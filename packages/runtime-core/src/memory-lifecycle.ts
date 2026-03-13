import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type {
  AppConfig,
  MemoryAuditResponse,
  MemoryRecord,
  MemoryType,
} from '@popeye/contracts';
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

function nowIso(): string {
  return new Date().toISOString();
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
    const row = this.databases.memory
      .prepare('SELECT confidence, content FROM memories WHERE id = ?')
      .get(memoryId) as { confidence: number; content: string } | undefined;
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

    const rows = this.databases.memory
      .prepare('SELECT id, confidence, last_reinforced_at, created_at FROM memories WHERE archived_at IS NULL')
      .all() as Array<{ id: string; confidence: number; last_reinforced_at: string | null; created_at: string }>;

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

    const rows = this.databases.memory
      .prepare('SELECT id, description, content, memory_type, confidence, scope, dedup_key FROM memories WHERE archived_at IS NULL ORDER BY scope, memory_type, created_at')
      .all() as Array<{ id: string; description: string; content: string; memory_type: string; confidence: number; scope: string; dedup_key: string | null }>;

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
        const active = group.filter((r) => !this.databases.memory.prepare('SELECT archived_at FROM memories WHERE id = ?').get(r.id) || !(this.databases.memory.prepare('SELECT archived_at FROM memories WHERE id = ?').get(r.id) as { archived_at: string | null })?.archived_at);
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

    const rows = this.databases.app
      .prepare('SELECT * FROM receipts WHERE workspace_id = ? AND created_at >= ? AND created_at <= ? ORDER BY created_at')
      .all(workspaceId, dayStart, dayEnd) as Array<Record<string, string>>;

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

  processCompactionFlush(runId: string, compactedContent: string, workspaceId: string): MemoryRecord[] {
    const redacted = redactText(compactedContent, this.config.security.redactionPatterns);
    const chunks = splitContentChunks(redacted.text);
    const results: MemoryRecord[] = [];
    const now = nowIso();

    for (const chunk of chunks) {
      const memoryType = classifyMemoryType('compaction_flush', chunk);
      const result = this.insertMemory({
        description: `Compaction flush from run ${runId}`,
        classification: 'internal',
        sourceType: 'compaction_flush',
        content: chunk,
        confidence: this.config.memory.compactionFlushConfidence,
        scope: workspaceId,
        memoryType,
        sourceRef: runId,
        sourceRefType: 'run',
      });

      this.databases.memory
        .prepare('INSERT INTO memory_events (id, memory_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(randomUUID(), result.memoryId, 'compaction_flushed', JSON.stringify({ runId }), now);

      results.push({
        id: result.memoryId,
        description: `Compaction flush from run ${runId}`,
        classification: 'internal',
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
    const total = (this.databases.memory.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number }).c;
    const active = (this.databases.memory.prepare('SELECT COUNT(*) as c FROM memories WHERE archived_at IS NULL').get() as { c: number }).c;
    const archived = total - active;

    const avgConf = (this.databases.memory.prepare('SELECT COALESCE(AVG(confidence), 0) as a FROM memories WHERE archived_at IS NULL').get() as { a: number }).a;

    const staleCount = (
      this.databases.memory
        .prepare('SELECT COUNT(*) as c FROM memories WHERE archived_at IS NULL AND confidence < 0.3')
        .get() as { c: number }
    ).c;

    const consolidations = (this.databases.memory.prepare('SELECT COUNT(*) as c FROM memory_consolidations').get() as { c: number }).c;

    const byType: Record<string, number> = {};
    const typeRows = this.databases.memory
      .prepare('SELECT memory_type, COUNT(*) as c FROM memories WHERE archived_at IS NULL GROUP BY memory_type')
      .all() as Array<{ memory_type: string; c: number }>;
    for (const row of typeRows) byType[row.memory_type] = row.c;

    const byScope: Record<string, number> = {};
    const scopeRows = this.databases.memory
      .prepare('SELECT scope, COUNT(*) as c FROM memories WHERE archived_at IS NULL GROUP BY scope')
      .all() as Array<{ scope: string; c: number }>;
    for (const row of scopeRows) byScope[row.scope] = row.c;

    const byClassification: Record<string, number> = {};
    const classRows = this.databases.memory
      .prepare('SELECT classification, COUNT(*) as c FROM memories WHERE archived_at IS NULL GROUP BY classification')
      .all() as Array<{ classification: string; c: number }>;
    for (const row of classRows) byClassification[row.classification] = row.c;

    const lastDecay = this.databases.memory
      .prepare("SELECT MAX(created_at) as t FROM memory_events WHERE type = 'decayed'")
      .get() as { t: string | null };
    const lastConsolidation = this.databases.memory
      .prepare("SELECT MAX(created_at) as t FROM memory_events WHERE type = 'consolidated'")
      .get() as { t: string | null };
    const lastDaily = this.databases.memory
      .prepare("SELECT MAX(created_at) as t FROM memories WHERE source_type = 'daily_summary'")
      .get() as { t: string | null };

    return {
      totalMemories: total,
      activeMemories: active,
      archivedMemories: archived,
      byType,
      byScope,
      byClassification,
      averageConfidence: avgConf,
      staleCount,
      consolidationsPerformed: consolidations,
      lastDecayRunAt: lastDecay?.t ?? null,
      lastConsolidationRunAt: lastConsolidation?.t ?? null,
      lastDailySummaryAt: lastDaily?.t ?? null,
    };
  }

  proposePromotion(memoryId: string, targetPath: string): MemoryPromotionResponse {
    const row = this.databases.memory.prepare('SELECT * FROM memories WHERE id = ?').get(memoryId) as Record<string, string> | undefined;
    if (!row) {
      return { memoryId, targetPath, diff: '', approved: false, promoted: false };
    }

    const diff = `+ ${row.description}\n+ ${row.content}`;
    return { memoryId, targetPath, diff, approved: false, promoted: false };
  }

  executePromotion(request: MemoryPromotionResponse): MemoryPromotionResponse {
    if (!request.approved) {
      return { ...request, promoted: false };
    }

    const row = this.databases.memory.prepare('SELECT content FROM memories WHERE id = ?').get(request.memoryId) as { content: string } | undefined;
    if (!row) return { ...request, promoted: false };

    mkdirSync(dirname(request.targetPath), { recursive: true, mode: 0o700 });
    writeFileSync(request.targetPath, row.content, { mode: 0o600 });

    this.databases.memory
      .prepare('INSERT INTO memory_events (id, memory_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), request.memoryId, 'promoted', JSON.stringify({ targetPath: request.targetPath }), nowIso());

    return { ...request, promoted: true };
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
