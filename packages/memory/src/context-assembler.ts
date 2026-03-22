import type Database from 'better-sqlite3';
import type { ContextAssemblyResult, ContextLayer, MemoryLayer, QueryStrategy } from '@popeye/contracts';

import type { MemorySearchService } from './search-service.js';
import { classifyQueryStrategy } from './strategy.js';
import { estimateTokens } from './summary-dag.js';
import { getProfileContext } from './profile-context.js';

export interface RecallContextInput {
  db: Database.Database;
  searchService: MemorySearchService;
  query: string;
  scope?: string | undefined;
  workspaceId?: string | null | undefined;
  projectId?: string | null | undefined;
  maxTokens?: number | undefined;
  consumerProfile?: string | undefined;
  includeProvenance?: boolean | undefined;
}

const DEFAULT_MAX_TOKENS = 4000;
const PROFILE_BUDGET_RATIO = 0.2;

/** Layer fill order by strategy. */
const LAYER_PRIORITY: Record<QueryStrategy, MemoryLayer[]> = {
  factual: ['fact', 'synthesis', 'artifact', 'curated'],
  temporal: ['fact', 'artifact', 'synthesis', 'curated'],
  procedural: ['synthesis', 'fact', 'artifact', 'curated'],
  exploratory: ['fact', 'synthesis', 'artifact', 'curated'],
  project_state: ['fact', 'synthesis', 'artifact', 'curated'],
  profile: ['synthesis', 'fact', 'artifact', 'curated'],
  audit: ['fact', 'artifact', 'synthesis', 'curated'],
};

/**
 * Assemble memory context for agent consumption with token-aware budgeting.
 *
 * 1. Reserves a portion of the budget for profile sections
 * 2. Searches across all layers
 * 3. Fills layers in strategy-dependent priority order
 * 4. Stops when budget is exhausted
 */
export async function recallContext(input: RecallContextInput): Promise<ContextAssemblyResult> {
  const maxTokens = input.maxTokens ?? DEFAULT_MAX_TOKENS;
  const strategy = classifyQueryStrategy(input.query);

  // 1. Reserve budget for profiles
  const profileBudget = Math.floor(maxTokens * PROFILE_BUDGET_RATIO);
  const profile = getProfileContext({
    db: input.db,
    scope: input.scope ?? 'workspace',
    workspaceId: input.workspaceId,
    maxTokens: profileBudget,
  });
  const profileTokensUsed = profile.totalTokens;
  let remainingBudget = maxTokens - profileTokensUsed;

  // 2. Search across all layers
  const searchQuery: Parameters<MemorySearchService['search']>[0] = {
    query: input.query,
    limit: 40,
    includeContent: true,
  };
  if (input.scope !== undefined) searchQuery.scope = input.scope;
  if (input.workspaceId !== undefined) searchQuery.workspaceId = input.workspaceId;
  if (input.projectId !== undefined) searchQuery.projectId = input.projectId;
  if (input.consumerProfile !== undefined) searchQuery.consumerProfile = input.consumerProfile;
  const searchResponse = await input.searchService.search(searchQuery);

  // 3. Group results by layer
  const byLayer = new Map<MemoryLayer, Array<{
    id: string;
    text: string;
    score: number;
    tokenCount: number;
    sourceType?: string;
    occurredAt?: string | null;
  }>>();

  for (const result of searchResponse.results) {
    const layer: MemoryLayer = result.layer ?? 'curated';
    const text = result.content ?? result.description;
    const tokenCount = estimateTokens(text);
    const items = byLayer.get(layer) ?? [];
    const item: { id: string; text: string; score: number; tokenCount: number; sourceType?: string; occurredAt?: string | null } = {
      id: result.id,
      text,
      score: result.score,
      tokenCount,
    };
    if (result.type !== undefined) item.sourceType = result.type;
    if (result.occurredAt !== undefined) item.occurredAt = result.occurredAt;
    items.push(item);
    byLayer.set(layer, items);
  }

  // 4. Fill layers in strategy-dependent priority order
  const priority = LAYER_PRIORITY[strategy] ?? LAYER_PRIORITY.exploratory;
  const assembledLayers: ContextLayer[] = [];
  let totalContentTokens = 0;

  for (const layerName of priority) {
    const items = byLayer.get(layerName);
    if (!items || items.length === 0) continue;

    const layerItems: ContextLayer['items'] = [];
    let layerTokens = 0;

    for (const item of items) {
      if (remainingBudget <= 0) break;
      if (item.tokenCount > remainingBudget) {
        // Try to fit a truncated version if it's worth it (>50 tokens left)
        if (remainingBudget > 50) {
          const truncatedText = item.text.slice(0, remainingBudget * 4);
          const truncatedTokens = estimateTokens(truncatedText);
          layerItems.push({ ...item, text: truncatedText, tokenCount: truncatedTokens });
          layerTokens += truncatedTokens;
          remainingBudget -= truncatedTokens;
          totalContentTokens += truncatedTokens;
        }
        // Greedy fill: stop this layer after truncation to avoid fragmented context
        break;
      }
      layerItems.push(item);
      layerTokens += item.tokenCount;
      remainingBudget -= item.tokenCount;
      totalContentTokens += item.tokenCount;
    }

    if (layerItems.length > 0) {
      assembledLayers.push({
        layer: layerName,
        items: layerItems,
        totalTokens: layerTokens,
      });
    }
  }

  return {
    profileStatic: profile.staticProfile,
    profileDynamic: profile.dynamicProfile,
    layers: assembledLayers,
    totalTokens: profileTokensUsed + totalContentTokens,
    budgetUsed: profileTokensUsed + totalContentTokens,
    budgetMax: maxTokens,
    query: input.query,
    strategy,
    traceId: searchResponse.traceId,
  };
}
