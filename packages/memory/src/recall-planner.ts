import type { MemoryLayer, RecallPlan } from '@popeye/contracts';

import { classifyQueryStrategy } from './strategy.js';
import { parseTemporalConstraint } from './temporal.js';

export interface BuildRecallPlanInput {
  query: string;
  layers?: MemoryLayer[] | undefined;
  namespaceIds?: string[] | undefined;
  tags?: string[] | undefined;
  includeEvidence?: boolean | undefined;
  includeSuperseded?: boolean | undefined;
  now?: Date | undefined;
}

export function buildRecallPlan(input: BuildRecallPlanInput): RecallPlan {
  return {
    query: input.query,
    strategy: classifyQueryStrategy(input.query),
    layers: input.layers ?? [],
    namespaceIds: input.namespaceIds ?? [],
    tags: input.tags ?? [],
    temporalConstraint: parseTemporalConstraint(input.query, input.now),
    includeEvidence: input.includeEvidence ?? false,
    includeSuperseded: input.includeSuperseded ?? false,
  };
}
