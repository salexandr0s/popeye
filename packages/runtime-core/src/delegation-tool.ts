import type { DelegationRequest, RunRecord, UsageMetrics } from '@popeye/contracts';
import type { RuntimeToolDescriptor } from '@popeye/engine-pi';
import { DelegationRequestSchema } from '@popeye/contracts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Request passed to the runtime to start a delegate run. */
export interface DelegateRunRequest {
  parentRunId: string;
  parentJobId: string;
  parentTaskId: string;
  workspaceId: string;
  profileId: string;
  prompt: string;
  title: string;
  maxIterations: number;
  delegationDepth: number;
}

/** Result returned when a delegate run completes. */
export interface DelegateRunResult {
  runId: string;
  status: 'succeeded' | 'failed' | 'cancelled';
  output: string;
  iterationsUsed: number;
  usage: UsageMetrics;
}

/** Dependencies injected from RuntimeService into the delegation tool builder. */
export interface DelegationToolDeps {
  /** Get the current run record. */
  getRun(runId: string): RunRecord | null;
  /** Count tool_call events for a run (to compute iterations used). */
  countToolCallEvents(runId: string): number;
  /** Get engine config for maxIterationsPerRun and maxDelegationDepth. */
  getEngineConfig(): { maxIterationsPerRun: number; maxDelegationDepth: number };
  /** Start a delegate run — returns the completion result. */
  startDelegateRun(request: DelegateRunRequest): Promise<DelegateRunResult>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Builds the `popeye_delegate` runtime tool that allows an agent to delegate
 * a sub-task to a new agent run with a scoped iteration budget.  The delegate
 * runs synchronously — this tool blocks until the delegate completes.
 */
export function buildDelegationTool(
  deps: DelegationToolDeps,
  runId: string,
): RuntimeToolDescriptor {
  return {
    name: 'popeye_delegate',
    label: 'Popeye Delegate',
    description:
      'Delegate a sub-task to a new agent run with a scoped iteration budget. ' +
      'The delegate runs synchronously — this tool blocks until the delegate completes.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The task prompt for the delegate run' },
        maxIterations: { type: 'number', description: 'Maximum iterations the delegate may use' },
        title: { type: 'string', description: 'Optional human-readable title for the delegate run' },
      },
      required: ['prompt', 'maxIterations'],
      additionalProperties: false,
    },
    execute: async (params) => {
      let request: DelegationRequest;
      try {
        request = DelegationRequestSchema.parse(params ?? {});
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Delegation input validation failed: ${msg}` }] };
      }

      const parentRun = deps.getRun(runId);
      if (!parentRun) {
        return { content: [{ type: 'text', text: `Parent run ${runId} not found.` }] };
      }

      const engineConfig = deps.getEngineConfig();

      // Check delegation depth
      const nextDepth = parentRun.delegationDepth + 1;
      if (nextDepth >= engineConfig.maxDelegationDepth) {
        return {
          content: [{
            type: 'text',
            text: `Delegation depth limit reached. Current depth: ${parentRun.delegationDepth}, ` +
              `max allowed: ${engineConfig.maxDelegationDepth}. Cannot create further delegates.`,
          }],
        };
      }

      // Check iteration budget
      const usedIterations = deps.countToolCallEvents(runId);
      const remaining = engineConfig.maxIterationsPerRun - usedIterations;
      // Reserve 1 iteration for the parent to process the delegate result
      if (request.maxIterations > remaining - 1) {
        return {
          content: [{
            type: 'text',
            text: `Insufficient iteration budget. Parent has used ${usedIterations} of ` +
              `${engineConfig.maxIterationsPerRun} iterations (${remaining} remaining, ` +
              `1 reserved for parent). Requested ${request.maxIterations} for delegate.`,
          }],
        };
      }

      let result: DelegateRunResult;
      try {
        result = await deps.startDelegateRun({
          parentRunId: runId,
          parentJobId: parentRun.jobId,
          parentTaskId: parentRun.taskId,
          workspaceId: parentRun.workspaceId,
          profileId: parentRun.profileId,
          prompt: request.prompt,
          title: request.title ?? `Delegate of ${runId}`,
          maxIterations: request.maxIterations,
          delegationDepth: nextDepth,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Delegation failed: ${msg}` }] };
      }

      const lines = [
        `Delegate run completed.`,
        `Run ID: ${result.runId}`,
        `Status: ${result.status}`,
        `Iterations used: ${result.iterationsUsed}`,
        `Cost: $${result.usage.estimatedCostUsd.toFixed(4)} (${result.usage.tokensIn} in / ${result.usage.tokensOut} out)`,
        ``,
        `--- Delegate output ---`,
        result.output,
      ];

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        details: {
          runId: result.runId,
          status: result.status,
          iterationsUsed: result.iterationsUsed,
          usage: result.usage,
        },
      };
    },
  };
}
