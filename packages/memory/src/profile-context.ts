import type Database from 'better-sqlite3';
import type { ProfileContextResult } from '@popeye/contracts';

import { estimateTokens } from './summary-dag.js';

export interface GetProfileContextInput {
  db: Database.Database;
  scope: string;
  workspaceId?: string | null | undefined;
  maxTokens?: number | undefined;
}

const DEFAULT_PROFILE_BUDGET = 800;

/**
 * Retrieve the most recent static and dynamic profile syntheses for a scope.
 * Respects a token budget — truncates dynamic profile first if combined exceeds limit.
 */
export function getProfileContext(input: GetProfileContextInput): ProfileContextResult {
  const maxTokens = input.maxTokens ?? DEFAULT_PROFILE_BUDGET;

  const wsFilter = input.workspaceId != null;
  const wsClause = wsFilter ? ' AND (workspace_id = ? OR workspace_id IS NULL)' : '';
  const staticParams: unknown[] = [input.scope];
  if (wsFilter) staticParams.push(input.workspaceId);

  const staticRow = input.db.prepare(
    `SELECT text FROM memory_syntheses
     WHERE synthesis_kind = 'profile_static' AND scope = ? AND archived_at IS NULL${wsClause}
     ORDER BY updated_at DESC LIMIT 1`,
  ).get(...staticParams) as { text: string } | undefined;

  const dynamicParams: unknown[] = [input.scope];
  if (wsFilter) dynamicParams.push(input.workspaceId);

  const dynamicRow = input.db.prepare(
    `SELECT text FROM memory_syntheses
     WHERE synthesis_kind = 'profile_dynamic' AND scope = ? AND archived_at IS NULL${wsClause}
     ORDER BY updated_at DESC LIMIT 1`,
  ).get(...dynamicParams) as { text: string } | undefined;

  let staticText = staticRow?.text ?? null;
  let dynamicText = dynamicRow?.text ?? null;

  const staticTokens = staticText ? estimateTokens(staticText) : 0;
  const dynamicTokens = dynamicText ? estimateTokens(dynamicText) : 0;

  // If combined exceeds budget, truncate dynamic first, then static
  if (staticTokens + dynamicTokens > maxTokens) {
    const staticBudget = Math.min(staticTokens, Math.floor(maxTokens * 0.6));
    const dynamicBudget = maxTokens - staticBudget;

    if (staticText && staticTokens > staticBudget) {
      staticText = staticText.slice(0, staticBudget * 4); // ~4 chars per token
    }
    if (dynamicText && dynamicTokens > dynamicBudget) {
      dynamicText = dynamicText.slice(0, dynamicBudget * 4);
    }
  }

  const totalTokens = (staticText ? estimateTokens(staticText) : 0) + (dynamicText ? estimateTokens(dynamicText) : 0);

  return {
    staticProfile: staticText,
    dynamicProfile: dynamicText,
    totalTokens,
  };
}
