import { describe, expect, it } from 'vitest';

import type { RunEventRecord } from './execution.js';
import { buildCanonicalRunReplyText, extractCanonicalRunReply, extractCanonicalRunReplyText } from './run-reply.js';

function makeRunEvent(overrides: Partial<RunEventRecord>): RunEventRecord {
  return {
    id: 'event-1',
    runId: 'run-1',
    type: 'message',
    payload: '{}',
    createdAt: '2026-03-14T10:00:00.000Z',
    ...overrides,
  };
}

describe('run reply helpers', () => {
  it('prefers completed output over assistant message text', () => {
    const reply = extractCanonicalRunReply([
      makeRunEvent({
        id: 'event-1',
        type: 'message',
        payload: JSON.stringify({ role: 'assistant', text: 'Earlier assistant text' }),
      }),
      makeRunEvent({
        id: 'event-2',
        type: 'completed',
        payload: JSON.stringify({ output: 'Canonical completed output' }),
      }),
    ]);

    expect(reply).toEqual({
      source: 'completed_output',
      text: 'Canonical completed output',
    });
  });

  it('falls back to the latest assistant message when no completed output is present', () => {
    const reply = extractCanonicalRunReply([
      makeRunEvent({
        id: 'event-1',
        type: 'message',
        payload: JSON.stringify({ role: 'assistant', text: 'first' }),
      }),
      makeRunEvent({
        id: 'event-2',
        type: 'message',
        payload: JSON.stringify({ role: 'assistant', text: 'latest' }),
      }),
    ]);

    expect(reply).toEqual({
      source: 'assistant_message',
      text: 'latest',
    });
  });

  it('ignores malformed payloads and blank outputs', () => {
    const reply = extractCanonicalRunReply([
      makeRunEvent({
        id: 'event-1',
        type: 'completed',
        payload: '{"output":',
      }),
      makeRunEvent({
        id: 'event-2',
        type: 'completed',
        payload: JSON.stringify({ output: '   ' }),
      }),
      makeRunEvent({
        id: 'event-3',
        type: 'message',
        payload: JSON.stringify({ role: 'assistant', text: 'usable fallback' }),
      }),
    ]);

    expect(reply).toEqual({
      source: 'assistant_message',
      text: 'usable fallback',
    });
  });

  it('extracts text directly for callers that only need the canonical reply body', () => {
    expect(extractCanonicalRunReplyText([
      makeRunEvent({
        id: 'event-1',
        type: 'completed',
        payload: JSON.stringify({ output: 'Canonical completed output' }),
      }),
    ])).toBe('Canonical completed output');
  });

  it('uses the provided receipt fallback when the run events do not contain reply text', () => {
    const reply = buildCanonicalRunReplyText(
      [
        makeRunEvent({
          id: 'event-1',
          type: 'message',
          payload: JSON.stringify({ role: 'assistant', text: '   ' }),
        }),
      ],
      {
        id: 'receipt-1',
        runId: 'run-1',
        jobId: 'job-1',
        taskId: 'task-1',
        workspaceId: 'default',
        status: 'failed',
        summary: 'Run failed',
        details: 'bad credentials',
        usage: { provider: 'pi', model: 'stub', tokensIn: 1, tokensOut: 0, estimatedCostUsd: 0.01 },
        createdAt: '2026-03-14T10:00:00.000Z',
      },
      (receipt) => `${receipt.summary}: ${receipt.details}`,
    );

    expect(reply).toBe('Run failed: bad credentials');
  });
});
