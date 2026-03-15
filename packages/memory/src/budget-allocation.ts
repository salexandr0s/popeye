import type { ScoredCandidate } from './scoring.js';

export interface BudgetConfig {
  enabled: boolean;
  minPerType: number;
  maxPerType: number;
}

/**
 * Diversify search results across memory types using a budget-based allocation.
 *
 * Phase 1: Reserve `minPerType` slots for each type that has candidates.
 * Phase 2: Fill remaining slots by score descending, respecting `maxPerType`.
 * Final sort by score descending.
 */
export function applyBudgetAllocation(
  results: ScoredCandidate[],
  limit: number,
  config: BudgetConfig,
): ScoredCandidate[] {
  if (!config.enabled || results.length <= limit) return results.slice(0, limit);

  // Group by memoryType
  const groups = new Map<string, ScoredCandidate[]>();
  for (const r of results) {
    const group = groups.get(r.memoryType) ?? [];
    group.push(r);
    groups.set(r.memoryType, group);
  }

  const selected: ScoredCandidate[] = [];
  const used = new Set<string>();

  // Phase 1: Reserve minPerType slots for each type
  for (const [, group] of groups) {
    const toReserve = Math.min(config.minPerType, group.length);
    for (let i = 0; i < toReserve; i++) {
      if (selected.length >= limit) break;
      selected.push(group[i]!);
      used.add(group[i]!.memoryId);
    }
  }

  // Phase 2: Fill remaining slots by score, respecting maxPerType
  const typeCount = new Map<string, number>();
  for (const s of selected) {
    typeCount.set(s.memoryType, (typeCount.get(s.memoryType) ?? 0) + 1);
  }

  const remaining = results
    .filter((r) => !used.has(r.memoryId))
    .sort((a, b) => b.score - a.score);

  for (const r of remaining) {
    if (selected.length >= limit) break;
    const count = typeCount.get(r.memoryType) ?? 0;
    if (count >= config.maxPerType) continue;
    selected.push(r);
    typeCount.set(r.memoryType, count + 1);
  }

  // Sort final results by score descending
  selected.sort((a, b) => b.score - a.score);
  return selected;
}
