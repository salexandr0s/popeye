import type Database from 'better-sqlite3';
import type { MemorySearchResult, RecallExplanation, RecallPlan } from '@popeye/contracts';

import { getEvidenceLinks } from './fact-store.js';

export interface BuildRecallExplanationInput {
  db: Database.Database;
  plan: RecallPlan;
  searchMode: 'hybrid' | 'fts_only' | 'vec_only';
  result: MemorySearchResult;
  scope?: string | undefined;
  workspaceId?: string | null | undefined;
  projectId?: string | null | undefined;
  includeGlobal?: boolean | undefined;
  tags?: string[] | undefined;
  namespaceIds?: string[] | undefined;
  includeSuperseded?: boolean | undefined;
}

export function buildRecallExplanation(input: BuildRecallExplanationInput): RecallExplanation {
  const layer = input.result.layer;
  const evidence = layer === 'fact' || layer === 'synthesis'
    ? getEvidenceLinks(input.db, layer, input.result.id)
    : [];

  return {
    query: input.plan.query,
    strategy: input.plan.strategy,
    searchMode: input.searchMode,
    memoryId: input.result.id,
    layer,
    score: input.result.score,
    scoreBreakdown: input.result.scoreBreakdown,
    filters: {
      scope: input.scope ?? null,
      workspaceId: input.workspaceId ?? null,
      projectId: input.projectId ?? null,
      includeGlobal: input.includeGlobal ?? false,
      namespaceIds: input.namespaceIds ?? input.plan.namespaceIds,
      tags: input.tags ?? input.plan.tags,
      includeSuperseded: input.includeSuperseded ?? input.plan.includeSuperseded,
      temporalConstraint: input.plan.temporalConstraint,
    },
    result: input.result,
    evidence,
  };
}
