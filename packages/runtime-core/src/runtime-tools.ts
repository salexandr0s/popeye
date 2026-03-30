import type {
  ExecutionEnvelope,
  MemorySearchQuery,
  MemorySearchResponse,
  RecallExplanation,
  RecallQuery,
  RecallSearchResponse,
  RecallSourceKind,
} from '@popeye/contracts';
import type { RuntimeToolDescriptor } from '@popeye/engine-pi';
import { z } from 'zod';
import { resolveAgentMemoryScopeFilter } from './execution-envelopes.js';
import { RuntimeMemorySearchToolInputSchema } from './row-mappers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Scope filter produced by resolveAgentMemoryScopeFilter */
interface MemoryLocationFilter {
  workspaceId: string | null;
  projectId: string | null;
  includeGlobal?: boolean;
}

/** Describe-memory return type (mirrors MemorySearchService.describeMemory) */
export interface MemoryDescription {
  id: string;
  description: string;
  type: string;
  confidence: number;
  scope: string;
  workspaceId: string | null;
  projectId: string | null;
  sourceType: string;
  createdAt: string;
  lastReinforcedAt: string | null;
  durable: boolean;
  contentLength: number;
  sourceCount: number;
  layer?: 'artifact' | 'fact' | 'synthesis' | 'curated' | undefined;
  namespaceId?: string | undefined;
  evidenceCount?: number | undefined;
  revisionStatus?: 'active' | 'superseded' | undefined;
}

/** Expand-memory return type (mirrors MemorySearchService.expandMemory) */
export interface MemoryExpansion {
  id: string;
  content: string;
  tokenEstimate: number;
  truncated: boolean;
}

/** Dependencies injected from RuntimeService into the tool builder. */
export interface RuntimeToolsDeps {
  getExecutionEnvelope(runId: string): ExecutionEnvelope | null;
  searchRecall(query: RecallQuery): Promise<RecallSearchResponse>;
  searchMemory(query: MemorySearchQuery): Promise<MemorySearchResponse>;
  describeMemory(memoryId: string, locationFilter?: MemoryLocationFilter): MemoryDescription | null;
  expandMemory(memoryId: string, maxTokens: number | undefined, locationFilter?: MemoryLocationFilter): MemoryExpansion | null;
  explainMemoryRecall(
    input: {
      query: string;
      memoryId: string;
      workspaceId?: string | null;
      projectId?: string | null;
      includeGlobal?: boolean;
    },
    locationFilter?: MemoryLocationFilter,
  ): Promise<RecallExplanation | null>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Builds the four core memory runtime tools that are injected into every
 * engine run.  Extracted from `RuntimeService.createCoreRuntimeTools` so the
 * tool definitions can be tested and composed independently.
 */
export function buildCoreRuntimeTools(
  deps: RuntimeToolsDeps,
  runId: string,
): RuntimeToolDescriptor[] {
  const requireEnvelope = (): ExecutionEnvelope | null => deps.getExecutionEnvelope(runId);

  return [
    {
      name: 'popeye_recall_search',
      label: 'Popeye Recall Search',
      description: 'Search Popeye runtime history across receipts, run events, messages, interventions, and durable memory references.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Maximum results to return (1-10)' },
          kinds: {
            type: 'array',
            description: 'Optional subset of source kinds to search',
            items: { type: 'string', enum: ['receipt', 'run_event', 'message', 'message_ingress', 'intervention', 'memory'] },
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
      execute: async (params) => {
        const parsed = z.object({
          query: z.string().min(1),
          limit: z.number().int().positive().max(10).optional(),
          kinds: z.array(z.enum(['receipt', 'run_event', 'message', 'message_ingress', 'intervention', 'memory'])).optional(),
        }).parse(params ?? {});
        const envelope = requireEnvelope();
        if (!envelope) {
          return { content: [{ type: 'text', text: 'Execution envelope not found for this run.' }] };
        }
        const scopeResolution = resolveAgentMemoryScopeFilter(envelope);
        const response = await deps.searchRecall({
          query: parsed.query,
          workspaceId: scopeResolution.workspaceId,
          projectId: scopeResolution.projectId,
          includeGlobal: scopeResolution.includeGlobal,
          limit: parsed.limit ?? 5,
          ...(parsed.kinds !== undefined ? { kinds: parsed.kinds as RecallSourceKind[] } : {}),
        });
        const lines = response.results.length === 0
          ? ['No matching Popeye recall results found.']
          : response.results.map((result, index) => {
              const scope = result.projectId ? `${result.workspaceId}/${result.projectId}` : (result.workspaceId ?? 'global');
              const subtype = result.subtype ? `/${result.subtype}` : '';
              return `${index + 1}. [${result.sourceKind}:${result.sourceId}] ${result.title} [${scope}${subtype}] score:${result.score.toFixed(2)} — ${result.snippet}`;
            });
        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          details: response,
        };
      },
    },
    {
      name: 'popeye_memory_search',
      label: 'Popeye Memory Search',
      description: 'Search Popeye memory for prior facts, receipts, and procedures. Returns IDs you can pass to popeye_memory_describe or popeye_memory_expand for details.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          scope: { type: 'string', description: 'Optional memory scope override' },
          limit: { type: 'number', description: 'Maximum results to return (1-10)' },
          includeContent: { type: 'boolean', description: 'Include full memory content snippets' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      execute: async (params) => {
        const parsed = RuntimeMemorySearchToolInputSchema.parse(params ?? {});
        const envelope = requireEnvelope();
        if (!envelope) {
          return { content: [{ type: 'text', text: 'Execution envelope not found for this run.' }] };
        }
        const scopeResolution = resolveAgentMemoryScopeFilter(envelope);
        const response = await deps.searchMemory({
          query: parsed.query,
          ...(parsed.scope !== undefined && envelope.recallScope === 'global' ? { scope: parsed.scope } : {}),
          workspaceId: scopeResolution.workspaceId,
          projectId: scopeResolution.projectId,
          includeGlobal: scopeResolution.includeGlobal,
          limit: parsed.limit ?? 5,
          includeContent: parsed.includeContent ?? false,
        });
        const lines = response.results.length === 0
          ? ['No matching Popeye memories found.']
          : response.results.map((result, index) => {
              const snippet = result.content ? ` — ${result.content.slice(0, 100)}` : '';
              const layer = result.layer ? `/${result.layer}` : '';
              return `${index + 1}. [id:${result.id}] ${result.description} [${result.scope}/${result.sourceType}${layer}] score:${result.score.toFixed(2)}${snippet}`;
            });
        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          details: {
            query: response.query,
            totalCandidates: response.totalCandidates,
            latencyMs: response.latencyMs,
            searchMode: response.searchMode,
            results: response.results,
          },
        };
      },
    },
    {
      name: 'popeye_memory_describe',
      label: 'Popeye Memory Describe',
      description: 'Get metadata about a specific memory (type, confidence, entities, sources, events) without loading full content. Use after search to decide if expand is needed.',
      inputSchema: {
        type: 'object',
        properties: {
          memoryId: { type: 'string', description: 'Memory ID from search results' },
        },
        required: ['memoryId'],
        additionalProperties: false,
      },
      execute: async (params) => {
        const parsed = z.object({ memoryId: z.string().min(1) }).parse(params ?? {});
        const envelope = requireEnvelope();
        if (!envelope) {
          return { content: [{ type: 'text', text: 'Execution envelope not found for this run.' }] };
        }
        const scopeResolution = resolveAgentMemoryScopeFilter(envelope);
        const desc = deps.describeMemory(parsed.memoryId, scopeResolution);
        if (!desc) {
          if (deps.describeMemory(parsed.memoryId)) {
            return { content: [{ type: 'text', text: `Memory ${parsed.memoryId} is outside the allowed recall scope.` }] };
          }
          return { content: [{ type: 'text', text: `Memory ${parsed.memoryId} not found.` }] };
        }
        const lines = [
          `ID: ${desc.id}`,
          `Description: ${desc.description}`,
          `Type: ${desc.type} | Source: ${desc.sourceType}${desc.layer ? ` | Layer: ${desc.layer}` : ''} | Scope: ${desc.scope}`,
          `Confidence: ${desc.confidence.toFixed(2)} | Durable: ${desc.durable}`,
          `Content length: ${desc.contentLength} chars (~${Math.ceil(desc.contentLength / 4)} tokens)`,
          `Sources: ${desc.sourceCount}`,
          `Created: ${desc.createdAt}${desc.lastReinforcedAt ? ` | Last reinforced: ${desc.lastReinforcedAt}` : ''}`,
        ];
        return { content: [{ type: 'text', text: lines.join('\n') }], details: desc };
      },
    },
    {
      name: 'popeye_memory_explain',
      label: 'Popeye Memory Explain',
      description: 'Explain why a specific memory matched a query, including score breakdown and evidence links when available.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Original search query' },
          memoryId: { type: 'string', description: 'Memory ID returned from popeye_memory_search' },
        },
        required: ['query', 'memoryId'],
        additionalProperties: false,
      },
      execute: async (params) => {
        const parsed = z.object({ query: z.string().min(1), memoryId: z.string().min(1) }).parse(params ?? {});
        const envelope = requireEnvelope();
        if (!envelope) {
          return { content: [{ type: 'text', text: 'Execution envelope not found for this run.' }] };
        }
        const scopeResolution = resolveAgentMemoryScopeFilter(envelope);
        const desc = deps.describeMemory(parsed.memoryId, scopeResolution);
        if (!desc) {
          if (deps.describeMemory(parsed.memoryId)) {
            return { content: [{ type: 'text', text: `Memory ${parsed.memoryId} is outside the allowed recall scope.` }] };
          }
          return { content: [{ type: 'text', text: `Memory ${parsed.memoryId} not found.` }] };
        }
        const explanation = await deps.explainMemoryRecall({
          query: parsed.query,
          memoryId: parsed.memoryId,
          workspaceId: scopeResolution.workspaceId,
          projectId: scopeResolution.projectId,
          includeGlobal: scopeResolution.includeGlobal,
        }, scopeResolution);

        if (!explanation) {
          return { content: [{ type: 'text', text: `Memory ${parsed.memoryId} was not recalled for that query.` }] };
        }

        const evidenceLine = explanation.evidence.length > 0
          ? `Evidence: ${explanation.evidence.map((link) => `${link.targetKind}:${link.targetId}`).join(', ')}`
          : 'Evidence: none';
        const lines = [
          `ID: ${explanation.memoryId}`,
          `Strategy: ${explanation.strategy} | Search mode: ${explanation.searchMode}${explanation.layer ? ` | Layer: ${explanation.layer}` : ''}`,
          `Score: ${explanation.score.toFixed(3)}`,
          `Breakdown: relevance=${explanation.scoreBreakdown.relevance.toFixed(3)}, recency=${explanation.scoreBreakdown.recency.toFixed(3)}, confidence=${explanation.scoreBreakdown.confidence.toFixed(3)}, scope=${explanation.scoreBreakdown.scopeMatch.toFixed(3)}`,
          explanation.scoreBreakdown.temporalFit !== undefined ? `Temporal fit: ${explanation.scoreBreakdown.temporalFit.toFixed(3)}` : null,
          evidenceLine,
        ].filter((line): line is string => line !== null);

        return { content: [{ type: 'text', text: lines.join('\n') }], details: explanation };
      },
    },
    {
      name: 'popeye_memory_expand',
      label: 'Popeye Memory Expand',
      description: 'Load full content of a specific memory. Use after describe to get the actual content when needed.',
      inputSchema: {
        type: 'object',
        properties: {
          memoryId: { type: 'string', description: 'Memory ID to expand' },
          maxTokens: { type: 'number', description: 'Maximum tokens to return (default 8000)' },
        },
        required: ['memoryId'],
        additionalProperties: false,
      },
      execute: async (params) => {
        const parsed = z.object({ memoryId: z.string().min(1), maxTokens: z.number().int().positive().optional() }).parse(params ?? {});
        const envelope = requireEnvelope();
        if (!envelope) {
          return { content: [{ type: 'text', text: 'Execution envelope not found for this run.' }] };
        }
        const scopeResolution = resolveAgentMemoryScopeFilter(envelope);
        const desc = deps.describeMemory(parsed.memoryId, scopeResolution);
        if (!desc) {
          if (deps.describeMemory(parsed.memoryId)) {
            return { content: [{ type: 'text', text: `Memory ${parsed.memoryId} is outside the allowed recall scope.` }] };
          }
          return { content: [{ type: 'text', text: `Memory ${parsed.memoryId} not found.` }] };
        }
        const expanded = deps.expandMemory(parsed.memoryId, parsed.maxTokens, scopeResolution);
        if (!expanded) {
          return { content: [{ type: 'text', text: `Memory ${parsed.memoryId} not found.` }] };
        }
        const header = expanded.truncated ? `[Truncated to ~${expanded.tokenEstimate} tokens]\n\n` : '';
        return { content: [{ type: 'text', text: `${header}${expanded.content}` }], details: expanded };
      },
    },
  ];
}
