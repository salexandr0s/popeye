import { describe, it, expect, vi } from 'vitest';

import type { RunRecord } from '@popeye/contracts';
import type { RuntimeToolResult } from '@popeye/engine-pi';
import { buildDelegationTool, type DelegateRunResult, type DelegationToolDeps } from './delegation-tool.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockRun(overrides?: Partial<RunRecord>): RunRecord {
  return {
    id: 'parent-run-1',
    jobId: 'job-1',
    taskId: 'task-1',
    workspaceId: 'ws-1',
    profileId: 'default',
    sessionRootId: 'session-1',
    engineSessionRef: null,
    state: 'running',
    startedAt: '2026-03-24T00:00:00Z',
    finishedAt: null,
    error: null,
    iterationsUsed: null,
    parentRunId: null,
    delegationDepth: 0,
    ...overrides,
  };
}

function createMockDeps(overrides?: Partial<DelegationToolDeps>): DelegationToolDeps {
  return {
    getRun: () => createMockRun(),
    countToolCallEvents: () => 10,
    getEngineConfig: () => ({ maxIterationsPerRun: 200, maxDelegationDepth: 3 }),
    startDelegateRun: async () => ({
      runId: 'delegate-run-1',
      status: 'succeeded' as const,
      output: 'Delegate completed successfully',
      iterationsUsed: 15,
      usage: { provider: 'fake', model: 'test', tokensIn: 100, tokensOut: 50, estimatedCostUsd: 0.01 },
    }),
    ...overrides,
  };
}

/** Extract the text from the first content item. */
function extractText(result: RuntimeToolResult): string {
  return result.content[0]?.text ?? '';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildDelegationTool', () => {
  it('returns a tool descriptor with expected name and schema', () => {
    const tool = buildDelegationTool(createMockDeps(), 'parent-run-1');
    expect(tool.name).toBe('popeye_delegate');
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      required: ['prompt', 'maxIterations'],
    });
    expect(tool.execute).toBeTypeOf('function');
  });

  // 1. Success path
  it('succeeds with valid prompt and maxIterations', async () => {
    const deps = createMockDeps();
    const tool = buildDelegationTool(deps, 'parent-run-1');
    const result = await tool.execute!({ prompt: 'Do the thing', maxIterations: 20 });
    const text = extractText(result);

    expect(text).toContain('Delegate run completed');
    expect(text).toContain('delegate-run-1');
    expect(text).toContain('succeeded');
    expect(text).toContain('Iterations used: 15');
    expect(text).toContain('Delegate completed successfully');

    // Verify details are populated
    const details = result.details as { runId: string; status: string; iterationsUsed: number };
    expect(details.runId).toBe('delegate-run-1');
    expect(details.status).toBe('succeeded');
    expect(details.iterationsUsed).toBe(15);
  });

  // 2. Budget validation -- exceeds remaining
  it('rejects when requested iterations exceed remaining budget', async () => {
    const deps = createMockDeps({
      countToolCallEvents: () => 195, // only 5 remaining out of 200
    });
    const tool = buildDelegationTool(deps, 'parent-run-1');
    const result = await tool.execute!({ prompt: 'Do the thing', maxIterations: 10 });
    const text = extractText(result);

    expect(text).toContain('Insufficient iteration budget');
    expect(text).toContain('195');
    expect(text).toContain('10');
  });

  // 3. Budget validation -- exactly remaining minus 1 should succeed
  it('succeeds when requested iterations equal remaining minus 1', async () => {
    const deps = createMockDeps({
      countToolCallEvents: () => 190, // 10 remaining, reserve 1 => 9 available
    });
    const tool = buildDelegationTool(deps, 'parent-run-1');
    const result = await tool.execute!({ prompt: 'Do the thing', maxIterations: 9 });
    const text = extractText(result);

    expect(text).toContain('Delegate run completed');
    expect(text).not.toContain('Insufficient');
  });

  // 4. Budget validation -- no room left
  it('rejects when no iteration budget remains', async () => {
    const deps = createMockDeps({
      countToolCallEvents: () => 200, // 0 remaining
    });
    const tool = buildDelegationTool(deps, 'parent-run-1');
    const result = await tool.execute!({ prompt: 'Do the thing', maxIterations: 1 });
    const text = extractText(result);

    expect(text).toContain('Insufficient iteration budget');
  });

  // 5. Depth validation -- at limit
  it('rejects when delegation depth is at limit', async () => {
    const deps = createMockDeps({
      getRun: () => createMockRun({ delegationDepth: 2 }),
      getEngineConfig: () => ({ maxIterationsPerRun: 200, maxDelegationDepth: 3 }),
    });
    const tool = buildDelegationTool(deps, 'parent-run-1');
    const result = await tool.execute!({ prompt: 'Do the thing', maxIterations: 5 });
    const text = extractText(result);

    // nextDepth = 2 + 1 = 3, which is >= maxDelegationDepth (3)
    expect(text).toContain('Delegation depth limit reached');
    expect(text).toContain('Current depth: 2');
    expect(text).toContain('max allowed: 3');
  });

  // 6. Depth validation -- within limit
  it('succeeds when delegation depth is within limit', async () => {
    const deps = createMockDeps({
      getRun: () => createMockRun({ delegationDepth: 1 }),
      getEngineConfig: () => ({ maxIterationsPerRun: 200, maxDelegationDepth: 3 }),
    });
    const tool = buildDelegationTool(deps, 'parent-run-1');
    const result = await tool.execute!({ prompt: 'Do the thing', maxIterations: 5 });
    const text = extractText(result);

    // nextDepth = 1 + 1 = 2, which is < maxDelegationDepth (3)
    expect(text).toContain('Delegate run completed');
    expect(text).not.toContain('depth limit');
  });

  // 7. Parent run not found
  it('returns error when parent run is not found', async () => {
    const deps = createMockDeps({
      getRun: () => null,
    });
    const tool = buildDelegationTool(deps, 'parent-run-1');
    const result = await tool.execute!({ prompt: 'Do the thing', maxIterations: 5 });
    const text = extractText(result);

    expect(text).toContain('Parent run parent-run-1 not found');
  });

  // 8. Delegate run failure
  it('returns result (not throw) when delegate run reports failure', async () => {
    const deps = createMockDeps({
      startDelegateRun: async () => ({
        runId: 'delegate-run-fail',
        status: 'failed' as const,
        output: 'Something went wrong inside the delegate',
        iterationsUsed: 3,
        usage: { provider: 'fake', model: 'test', tokensIn: 50, tokensOut: 20, estimatedCostUsd: 0.005 },
      }),
    });
    const tool = buildDelegationTool(deps, 'parent-run-1');
    const result = await tool.execute!({ prompt: 'Do the thing', maxIterations: 10 });
    const text = extractText(result);

    expect(text).toContain('Delegate run completed');
    expect(text).toContain('failed');
    expect(text).toContain('delegate-run-fail');
  });

  // 9. Delegate run throws
  it('returns error text when startDelegateRun throws', async () => {
    const deps = createMockDeps({
      startDelegateRun: async () => { throw new Error('Connection lost'); },
    });
    const tool = buildDelegationTool(deps, 'parent-run-1');
    const result = await tool.execute!({ prompt: 'Do the thing', maxIterations: 10 });
    const text = extractText(result);

    expect(text).toContain('Delegation failed');
    expect(text).toContain('Connection lost');
  });

  // 10. Invalid input -- empty prompt
  it('returns validation error for empty prompt', async () => {
    const deps = createMockDeps();
    const tool = buildDelegationTool(deps, 'parent-run-1');
    const result = await tool.execute!({ prompt: '', maxIterations: 10 });
    const text = extractText(result);

    expect(text).toContain('Delegation input validation failed');
  });

  // Additional edge case: missing params entirely
  it('returns validation error for missing params', async () => {
    const deps = createMockDeps();
    const tool = buildDelegationTool(deps, 'parent-run-1');
    const result = await tool.execute!({});
    const text = extractText(result);

    expect(text).toContain('Delegation input validation failed');
  });

  // Verify startDelegateRun is called with correct arguments
  it('passes correct request to startDelegateRun', async () => {
    const startDelegateRun = vi.fn<[unknown], Promise<DelegateRunResult>>().mockResolvedValue({
      runId: 'delegate-run-1',
      status: 'succeeded',
      output: 'Done',
      iterationsUsed: 5,
      usage: { provider: 'fake', model: 'test', tokensIn: 10, tokensOut: 5, estimatedCostUsd: 0.001 },
    });
    const deps = createMockDeps({ startDelegateRun });
    const tool = buildDelegationTool(deps, 'parent-run-1');
    await tool.execute!({ prompt: 'Fix the bug', maxIterations: 20, title: 'Bug fix delegate' });

    expect(startDelegateRun).toHaveBeenCalledOnce();
    const call = startDelegateRun.mock.calls[0]![0] as Record<string, unknown>;
    expect(call).toMatchObject({
      parentRunId: 'parent-run-1',
      parentJobId: 'job-1',
      parentTaskId: 'task-1',
      workspaceId: 'ws-1',
      profileId: 'default',
      prompt: 'Fix the bug',
      title: 'Bug fix delegate',
      maxIterations: 20,
      delegationDepth: 1,
    });
  });

  // Verify default title when none provided
  it('uses default title when not provided', async () => {
    const startDelegateRun = vi.fn<[unknown], Promise<DelegateRunResult>>().mockResolvedValue({
      runId: 'delegate-run-1',
      status: 'succeeded',
      output: 'Done',
      iterationsUsed: 5,
      usage: { provider: 'fake', model: 'test', tokensIn: 10, tokensOut: 5, estimatedCostUsd: 0.001 },
    });
    const deps = createMockDeps({ startDelegateRun });
    const tool = buildDelegationTool(deps, 'parent-run-1');
    await tool.execute!({ prompt: 'Do something', maxIterations: 10 });

    const call = startDelegateRun.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.title).toBe('Delegate of parent-run-1');
  });
});
