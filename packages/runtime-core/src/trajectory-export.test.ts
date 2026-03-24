import { describe, expect, it } from 'vitest';

import type { RunEventRecord } from '@popeye/contracts';

import {
  filterEventsByTypes,
  formatTrajectoryJsonl,
  formatTrajectoryShareGPT,
} from './trajectory-export.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<RunEventRecord> & { type: string }): RunEventRecord {
  return {
    id: 'e1',
    runId: 'run-1',
    payload: '{}',
    createdAt: '2026-03-24T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// filterEventsByTypes
// ---------------------------------------------------------------------------

describe('filterEventsByTypes', () => {
  it('filters events to only matching types', () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: 'e1', type: 'message' }),
      makeEvent({ id: 'e2', type: 'tool_call' }),
      makeEvent({ id: 'e3', type: 'message' }),
      makeEvent({ id: 'e4', type: 'usage' }),
    ];

    const result = filterEventsByTypes(events, ['message']);
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.type === 'message')).toBe(true);
  });

  it('returns empty array for empty type list', () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: 'e1', type: 'message' }),
    ];

    const result = filterEventsByTypes(events, []);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// formatTrajectoryJsonl
// ---------------------------------------------------------------------------

describe('formatTrajectoryJsonl', () => {
  it('formats events as newline-delimited JSON', () => {
    const events: RunEventRecord[] = [
      makeEvent({
        id: 'e1',
        type: 'message',
        payload: JSON.stringify({ role: 'user', content: 'hello' }),
        createdAt: '2026-03-24T10:00:00Z',
      }),
      makeEvent({
        id: 'e2',
        type: 'tool_call',
        payload: JSON.stringify({ toolName: 'bash', input: 'ls' }),
        createdAt: '2026-03-24T10:01:00Z',
      }),
    ];

    const result = formatTrajectoryJsonl(events);
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);

    const parsed0 = JSON.parse(lines[0]!) as { type: string; payload: Record<string, unknown>; createdAt: string };
    expect(parsed0.type).toBe('message');
    expect(parsed0.payload).toEqual({ role: 'user', content: 'hello' });
    expect(parsed0.createdAt).toBe('2026-03-24T10:00:00Z');

    const parsed1 = JSON.parse(lines[1]!) as { type: string; payload: Record<string, unknown>; createdAt: string };
    expect(parsed1.type).toBe('tool_call');
    expect(parsed1.payload).toEqual({ toolName: 'bash', input: 'ls' });
  });

  it('applies type filter correctly', () => {
    const events: RunEventRecord[] = [
      makeEvent({ id: 'e1', type: 'message', payload: JSON.stringify({ role: 'user', content: 'hi' }) }),
      makeEvent({ id: 'e2', type: 'tool_call', payload: JSON.stringify({ toolName: 'bash' }) }),
      makeEvent({ id: 'e3', type: 'usage', payload: JSON.stringify({ model: 'test' }) }),
    ];

    const result = formatTrajectoryJsonl(events, ['message', 'usage']);
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);

    const types = lines.map((l) => (JSON.parse(l) as { type: string }).type);
    expect(types).toEqual(['message', 'usage']);
  });

  it('returns empty string for empty events', () => {
    const result = formatTrajectoryJsonl([]);
    expect(result).toBe('');
  });
});

// ---------------------------------------------------------------------------
// formatTrajectoryShareGPT
// ---------------------------------------------------------------------------

describe('formatTrajectoryShareGPT', () => {
  it('maps message events with role=user to from=human', () => {
    const events: RunEventRecord[] = [
      makeEvent({
        id: 'e1',
        type: 'message',
        payload: JSON.stringify({ role: 'user', content: 'hello agent' }),
      }),
    ];

    const result = formatTrajectoryShareGPT(events, 'run-1', 'completed');
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]!.from).toBe('human');
    expect(result.conversations[0]!.value).toBe('hello agent');
  });

  it('maps message events with role=assistant to from=gpt', () => {
    const events: RunEventRecord[] = [
      makeEvent({
        id: 'e1',
        type: 'message',
        payload: JSON.stringify({ role: 'assistant', content: 'I can help' }),
      }),
    ];

    const result = formatTrajectoryShareGPT(events, 'run-1', 'completed');
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]!.from).toBe('gpt');
    expect(result.conversations[0]!.value).toBe('I can help');
  });

  it('maps tool_call events to from=gpt', () => {
    const events: RunEventRecord[] = [
      makeEvent({
        id: 'e1',
        type: 'tool_call',
        payload: JSON.stringify({ toolName: 'bash', input: { command: 'ls' } }),
      }),
    ];

    const result = formatTrajectoryShareGPT(events, 'run-1', 'completed');
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]!.from).toBe('gpt');
    expect(result.conversations[0]!.value).toContain('[Tool call: bash]');
  });

  it('maps tool_result events to from=tool', () => {
    const events: RunEventRecord[] = [
      makeEvent({
        id: 'e1',
        type: 'tool_result',
        payload: JSON.stringify({ toolName: 'bash', content: 'file1.ts\nfile2.ts' }),
      }),
    ];

    const result = formatTrajectoryShareGPT(events, 'run-1', 'completed');
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]!.from).toBe('tool');
    expect(result.conversations[0]!.value).toContain('[Tool result: bash]');
    expect(result.conversations[0]!.value).toContain('file1.ts\nfile2.ts');
  });

  it('maps started events to from=system', () => {
    const events: RunEventRecord[] = [
      makeEvent({
        id: 'e1',
        type: 'started',
        payload: JSON.stringify({ input: 'Deploy the app' }),
      }),
    ];

    const result = formatTrajectoryShareGPT(events, 'run-1', 'completed');
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]!.from).toBe('system');
    expect(result.conversations[0]!.value).toContain('[Run started]');
    expect(result.conversations[0]!.value).toContain('Deploy the app');
  });

  it('maps completed events to from=system', () => {
    const events: RunEventRecord[] = [
      makeEvent({
        id: 'e1',
        type: 'completed',
        payload: JSON.stringify({ output: 'Task finished successfully' }),
      }),
    ];

    const result = formatTrajectoryShareGPT(events, 'run-1', 'completed');
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]!.from).toBe('system');
    expect(result.conversations[0]!.value).toContain('[Run completed]');
    expect(result.conversations[0]!.value).toContain('Task finished successfully');
  });

  it('maps usage events to from=system', () => {
    const events: RunEventRecord[] = [
      makeEvent({
        id: 'e1',
        type: 'usage',
        payload: JSON.stringify({ model: 'claude-3-opus', tokensIn: 1000, tokensOut: 500 }),
      }),
    ];

    const result = formatTrajectoryShareGPT(events, 'run-1', 'completed');
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]!.from).toBe('system');
    expect(result.conversations[0]!.value).toContain('[Usage]');
    expect(result.conversations[0]!.value).toContain('claude-3-opus');
    expect(result.conversations[0]!.value).toContain('1000 in / 500 out');
  });

  it('skips session events', () => {
    const events: RunEventRecord[] = [
      makeEvent({
        id: 'e1',
        type: 'session',
        payload: JSON.stringify({ action: 'created' }),
      }),
    ];

    const result = formatTrajectoryShareGPT(events, 'run-1', 'completed');
    expect(result.conversations).toHaveLength(0);
  });

  it('includes metadata with runId and status', () => {
    const result = formatTrajectoryShareGPT([], 'run-42', 'failed');
    expect(result.id).toBe('run-42');
    expect(result.metadata.runId).toBe('run-42');
    expect(result.metadata.status).toBe('failed');
  });

  it('includes usage metadata when provided', () => {
    const result = formatTrajectoryShareGPT([], 'run-1', 'completed', {
      model: 'claude-3-opus',
      tokensIn: 2000,
      tokensOut: 800,
      estimatedCostUsd: 0.15,
    });

    expect(result.metadata.model).toBe('claude-3-opus');
    expect(result.metadata.tokensIn).toBe(2000);
    expect(result.metadata.tokensOut).toBe(800);
    expect(result.metadata.estimatedCostUsd).toBe(0.15);
  });

  it('omits optional usage metadata fields when not provided', () => {
    const result = formatTrajectoryShareGPT([], 'run-1', 'completed');
    expect(result.metadata).not.toHaveProperty('model');
    expect(result.metadata).not.toHaveProperty('tokensIn');
    expect(result.metadata).not.toHaveProperty('tokensOut');
    expect(result.metadata).not.toHaveProperty('estimatedCostUsd');
  });

  it('handles malformed JSON payloads gracefully', () => {
    const events: RunEventRecord[] = [
      makeEvent({
        id: 'e1',
        type: 'message',
        payload: '{not valid json',
      }),
    ];

    // Should not throw
    const result = formatTrajectoryShareGPT(events, 'run-1', 'completed');
    expect(result.conversations).toHaveLength(1);
    // Malformed payload parses to {} — no role found, so falls through to system
    expect(result.conversations[0]!.from).toBe('system');
  });

  it('handles array payloads gracefully', () => {
    const events: RunEventRecord[] = [
      makeEvent({
        id: 'e1',
        type: 'message',
        payload: '[1, 2, 3]',
      }),
    ];

    const result = formatTrajectoryShareGPT(events, 'run-1', 'completed');
    expect(result.conversations).toHaveLength(1);
    // Array returns {} from safeParsePayload, no role, falls to system
    expect(result.conversations[0]!.from).toBe('system');
  });

  it('applies filterTypes when provided', () => {
    const events: RunEventRecord[] = [
      makeEvent({
        id: 'e1',
        type: 'message',
        payload: JSON.stringify({ role: 'user', content: 'hello' }),
      }),
      makeEvent({
        id: 'e2',
        type: 'tool_call',
        payload: JSON.stringify({ toolName: 'bash' }),
      }),
      makeEvent({
        id: 'e3',
        type: 'usage',
        payload: JSON.stringify({ model: 'test' }),
      }),
    ];

    const result = formatTrajectoryShareGPT(events, 'run-1', 'completed', undefined, ['message']);
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]!.from).toBe('human');
  });
});
