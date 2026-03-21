import type {
  IntegrityReport,
  MemoryAuditResponse,
  MemoryRecord,
  MemorySearchQuery,
  MemorySearchResponse,
  MemoryType,
  RecallExplanation,
  SecurityAuditEvent,
} from '@popeye/contracts';
import { MemoryRecordSchema } from '@popeye/contracts';
import type { MemorySearchService } from '@popeye/memory';
import {
  buildLocationCondition,
  formatMemoryScope,
  resolveMemoryLocationFilter,
} from '@popeye/memory';
import { redactText } from '@popeye/observability';
import { z } from 'zod';

import type { MemoryLifecycleService, MemoryInsertInput } from './memory-lifecycle.js';
import type { MemoryDescription, MemoryExpansion } from './runtime-tools.js';
import { MemoryListRowSchema } from './row-mappers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MemoryFacadeDb {
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number };
  };
}

export interface MemoryFacadeDeps {
  memoryDb: MemoryFacadeDb;
  memorySearch: MemorySearchService;
  memoryLifecycle: MemoryLifecycleService;
  redactionPatterns: string[];
  expandTokenCap: number;
  recordSecurityAudit: (event: SecurityAuditEvent) => void;
}

// ---------------------------------------------------------------------------
// MemoryFacade
// ---------------------------------------------------------------------------

export class MemoryFacade {
  private readonly memoryDb: MemoryFacadeDb;
  private readonly memorySearch: MemorySearchService;
  private readonly memoryLifecycle: MemoryLifecycleService;
  private readonly redactionPatterns: string[];
  private readonly expandTokenCap: number;
  private readonly recordSecurityAudit: (event: SecurityAuditEvent) => void;

  constructor(deps: MemoryFacadeDeps) {
    this.memoryDb = deps.memoryDb;
    this.memorySearch = deps.memorySearch;
    this.memoryLifecycle = deps.memoryLifecycle;
    this.redactionPatterns = deps.redactionPatterns;
    this.expandTokenCap = deps.expandTokenCap;
    this.recordSecurityAudit = deps.recordSecurityAudit;
  }

  async searchMemory(query: MemorySearchQuery): Promise<MemorySearchResponse> {
    return this.memorySearch.search({
      query: query.query,
      ...(query.scope !== undefined && { scope: query.scope }),
      ...(query.workspaceId !== undefined && { workspaceId: query.workspaceId }),
      ...(query.projectId !== undefined && { projectId: query.projectId }),
      ...(query.includeGlobal !== undefined && { includeGlobal: query.includeGlobal }),
      ...(query.memoryTypes !== undefined && { memoryTypes: query.memoryTypes }),
      ...(query.layers !== undefined && { layers: query.layers }),
      ...(query.namespaceIds !== undefined && { namespaceIds: query.namespaceIds }),
      ...(query.tags !== undefined && { tags: query.tags }),
      ...(query.minConfidence !== undefined && { minConfidence: query.minConfidence }),
      ...(query.limit !== undefined && { limit: query.limit }),
      ...(query.includeContent !== undefined && { includeContent: query.includeContent }),
      ...(query.includeSuperseded !== undefined && { includeSuperseded: query.includeSuperseded }),
      ...(query.occurredAfter !== undefined && { occurredAfter: query.occurredAfter }),
      ...(query.occurredBefore !== undefined && { occurredBefore: query.occurredBefore }),
      ...(query.domains !== undefined && { domains: query.domains }),
      ...(query.consumerProfile !== undefined && { consumerProfile: query.consumerProfile }),
    });
  }

  async explainMemoryRecall(input: {
    query: string;
    memoryId: string;
    scope?: string;
    workspaceId?: string | null;
    projectId?: string | null;
    includeGlobal?: boolean;
    memoryTypes?: MemoryType[];
    layers?: Array<'artifact' | 'fact' | 'synthesis' | 'curated'>;
    namespaceIds?: string[];
    tags?: string[];
    includeSuperseded?: boolean;
  }, locationFilter?: { workspaceId: string | null; projectId: string | null; includeGlobal?: boolean }): Promise<RecallExplanation | null> {
    return this.memorySearch.explainRecall(input, locationFilter);
  }

  getMemoryContent(memoryId: string, locationFilter?: { workspaceId: string | null; projectId: string | null; includeGlobal?: boolean }): MemoryRecord | null {
    const record = this.memorySearch.getMemoryContent(memoryId, locationFilter);
    return record ? MemoryRecordSchema.parse(record) : null;
  }

  getMemoryAudit(): MemoryAuditResponse {
    return this.memoryLifecycle.getMemoryAudit();
  }

  checkMemoryIntegrity(options?: { fix?: boolean }): IntegrityReport {
    return this.memoryLifecycle.runIntegrityCheck(options);
  }

  insertMemory(input: MemoryInsertInput): MemoryRecord {
    const result = this.memoryLifecycle.insertMemory(input);
    const memory = this.getMemory(result.memoryId);
    if (!memory) {
      throw new Error(`Inserted memory ${result.memoryId} could not be loaded`);
    }
    return memory;
  }

  listMemories(options?: {
    type?: string;
    scope?: string;
    workspaceId?: string | null;
    projectId?: string | null;
    includeGlobal?: boolean;
    limit?: number;
  }): MemoryRecord[] {
    const conditions: string[] = ['archived_at IS NULL'];
    const params: unknown[] = [];
    const locationFilter = resolveMemoryLocationFilter({
      scope: options?.scope,
      workspaceId: options?.workspaceId,
      projectId: options?.projectId,
      includeGlobal: options?.includeGlobal,
    });
    const scopeAliasOnly = options?.scope !== undefined && options?.workspaceId === undefined && options?.projectId === undefined;
    if (options?.type) { conditions.push('memory_type = ?'); params.push(options.type); }
    if (scopeAliasOnly && options?.scope) {
      conditions.push('scope = ?');
      params.push(options.scope);
    } else if (locationFilter) {
      const location = buildLocationCondition('', {
        workspaceId: locationFilter.workspaceId,
        projectId: locationFilter.projectId,
        includeGlobal: locationFilter.includeGlobal,
      });
      if (location.sql) {
        conditions.push(location.sql);
        params.push(...location.params);
      }
    }
    const limit = options?.limit ?? 50;
    params.push(limit);
    const sql = `SELECT id, description, classification, source_type, content, confidence, scope, workspace_id, project_id, memory_type, dedup_key, last_reinforced_at, archived_at, created_at, source_run_id, source_timestamp FROM memories WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ?`;
    return z.array(MemoryListRowSchema)
      .parse(this.memoryDb.prepare(sql).all(...params))
      .map((row) =>
        MemoryRecordSchema.parse({
          id: row.id,
          description: row.description,
          classification: row.classification,
          sourceType: row.source_type,
          content: row.content,
          confidence: row.confidence,
          scope: row.scope,
          workspaceId: row.workspace_id,
          projectId: row.project_id,
          sourceRunId: row.source_run_id,
          sourceTimestamp: row.source_timestamp,
          memoryType: row.memory_type ?? 'episodic',
          dedupKey: row.dedup_key,
          lastReinforcedAt: row.last_reinforced_at,
          archivedAt: row.archived_at,
          createdAt: row.created_at,
        }),
      );
  }

  getMemory(memoryId: string, locationFilter?: { workspaceId: string | null; projectId: string | null; includeGlobal?: boolean }): MemoryRecord | null {
    return this.getMemoryContent(memoryId, locationFilter);
  }

  async budgetFitMemory(query: {
    query: string;
    scope?: string;
    workspaceId?: string | null;
    projectId?: string | null;
    includeGlobal?: boolean;
    memoryTypes?: Array<'episodic' | 'semantic' | 'procedural'>;
    minConfidence?: number;
    maxTokens: number;
    limit?: number;
    domains?: string[];
    consumerProfile?: string;
  }) {
    return this.memorySearch.budgetFit(query);
  }

  describeMemory(memoryId: string, locationFilter?: { workspaceId: string | null; projectId: string | null; includeGlobal?: boolean }): MemoryDescription | null {
    return this.memorySearch.describeMemory(memoryId, locationFilter);
  }

  expandMemory(memoryId: string, maxTokens?: number, locationFilter?: { workspaceId: string | null; projectId: string | null; includeGlobal?: boolean }): MemoryExpansion | null {
    const cap = maxTokens ?? this.expandTokenCap;
    return this.memorySearch.expandMemory(memoryId, cap, locationFilter);
  }

  triggerMemoryMaintenance(): { decayed: number; archived: number; merged: number; deduped: number } {
    const decay = this.memoryLifecycle.runConfidenceDecay();
    const consolidation = this.memoryLifecycle.runConsolidation();
    return { decayed: decay.decayed, archived: decay.archived, merged: consolidation.merged, deduped: consolidation.deduped };
  }

  importMemory(input: {
    description: string;
    content: string;
    sourceType?: MemoryInsertInput['sourceType'];
    memoryType?: 'episodic' | 'semantic' | 'procedural';
    scope?: string;
    workspaceId?: string | null;
    projectId?: string | null;
    confidence?: number;
    classification?: 'secret' | 'sensitive' | 'internal' | 'embeddable';
    domain?: MemoryInsertInput['domain'];
    tags?: string[];
    durable?: boolean;
    dedupKey?: string;
    sourceRunId?: string;
    sourceTimestamp?: string;
  }): { memoryId: string; embedded: boolean } {
    const redactedContent = redactText(input.content, this.redactionPatterns).text;
    const redactedDesc = redactText(input.description, this.redactionPatterns).text;
    const scope = input.scope
      ?? (input.workspaceId !== undefined || input.projectId !== undefined
        ? formatMemoryScope({
            workspaceId: input.workspaceId ?? null,
            projectId: input.projectId ?? null,
          })
        : 'workspace');
    return this.memoryLifecycle.insertMemory({
      description: redactedDesc,
      content: redactedContent,
      sourceType: input.sourceType ?? 'curated_memory',
      ...(input.memoryType !== undefined && { memoryType: input.memoryType }),
      scope,
      ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      confidence: input.confidence ?? 0.8,
      classification: input.classification ?? 'embeddable',
      ...(input.domain !== undefined ? { domain: input.domain } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.durable !== undefined ? { durable: input.durable } : {}),
      ...(input.dedupKey !== undefined ? { dedupKey: input.dedupKey } : {}),
      ...(input.sourceRunId !== undefined ? { sourceRunId: input.sourceRunId } : {}),
      ...(input.sourceTimestamp !== undefined ? { sourceTimestamp: input.sourceTimestamp } : {}),
    });
  }

  proposeMemoryPromotion(memoryId: string, targetPath: string) {
    return this.memoryLifecycle.proposePromotion(memoryId, targetPath);
  }

  executeMemoryPromotion(request: { memoryId: string; targetPath: string; diff: string; approved: boolean; promoted: boolean }) {
    return this.memoryLifecycle.executePromotion(request);
  }
}
