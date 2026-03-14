// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { InterventionRecord, JobRecord, RunEventRecord, RunRecord } from '../api/hooks';
import {
  applyStreamEventToRunActivity,
  buildRelatedCommandSnippets,
  COMMAND_CENTER_STORAGE_KEY,
  getRunActivity,
  getRunAttention,
  isActiveJob,
  isActiveRun,
  loadCommandCenterLayout,
  normalizeSelection,
  saveCommandCenterLayout,
} from './command-center-model';

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'run-1',
    jobId: 'job-1',
    taskId: 'task-1',
    workspaceId: 'alpha',
    sessionRootId: 'session-1',
    engineSessionRef: null,
    state: 'running',
    startedAt: '2026-03-14T10:00:00.000Z',
    finishedAt: null,
    error: null,
    ...overrides,
  };
}

function makeJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 'job-1',
    taskId: 'task-1',
    workspaceId: 'alpha',
    status: 'queued',
    retryCount: 0,
    availableAt: '2026-03-14T10:00:00.000Z',
    lastRunId: null,
    createdAt: '2026-03-14T10:00:00.000Z',
    updatedAt: '2026-03-14T10:05:00.000Z',
    ...overrides,
  };
}

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: 'evt-1',
    runId: 'run-1',
    type: 'tool_call',
    payload: '{}',
    createdAt: '2026-03-14T10:12:00.000Z',
    ...overrides,
  };
}

function makeIntervention(overrides: Partial<InterventionRecord> = {}): InterventionRecord {
  return {
    id: 'int-1',
    code: 'needs_operator_input',
    runId: 'run-1',
    status: 'open',
    reason: 'Need confirmation',
    createdAt: '2026-03-14T10:12:00.000Z',
    resolvedAt: null,
    ...overrides,
  };
}

describe('command-center model', () => {
  it('classifies active runs and jobs', () => {
    expect(isActiveRun(makeRun({ state: 'running' }))).toBe(true);
    expect(isActiveRun(makeRun({ state: 'succeeded', finishedAt: '2026-03-14T10:10:00.000Z' }))).toBe(false);
    expect(isActiveJob(makeJob({ status: 'blocked_operator' }))).toBe(true);
    expect(isActiveJob(makeJob({ status: 'succeeded' }))).toBe(false);
  });

  it('flags idle and stuck-risk runs by last observed activity', () => {
    const run = makeRun();
    const activity = getRunActivity(run, {}, [makeEvent()]);

    expect(getRunAttention(run, { activity, now: Date.parse('2026-03-14T10:17:00.000Z') }).level).toBe('none');
    expect(getRunAttention(run, { activity, now: Date.parse('2026-03-14T10:23:00.000Z') }).level).toBe('idle');
    expect(getRunAttention(run, { activity, now: Date.parse('2026-03-14T10:43:00.000Z') }).level).toBe('stuck-risk');
  });

  it('persists and restores layout state', () => {
    const storage = globalThis.window.localStorage;
    storage.clear();

    saveCommandCenterLayout({
      focusMode: true,
      denseMode: false,
      workspaceId: 'alpha',
      panels: {
        summary: true,
        runs: true,
        jobs: false,
        attention: false,
        detail: true,
      },
      selectedItem: {
        kind: 'none',
        id: null,
      },
      detailPane: {
        width: 'wide',
      },
    }, storage);

    expect(storage.getItem(COMMAND_CENTER_STORAGE_KEY)).toContain('alpha');
    expect(loadCommandCenterLayout(storage)).toEqual({
      focusMode: true,
      denseMode: false,
      workspaceId: 'alpha',
      panels: {
        summary: true,
        runs: true,
        jobs: false,
        attention: false,
        detail: true,
      },
      selectedItem: {
        kind: 'none',
        id: null,
      },
      detailPane: {
        width: 'wide',
      },
    });
  });

  it('updates run activity from SSE envelopes', () => {
    const updated = applyStreamEventToRunActivity({}, {
      event: 'run_event',
      data: JSON.stringify(makeEvent({ createdAt: '2026-03-14T10:18:00.000Z' })),
    });

    expect(updated['run-1']).toEqual({
      lastActivityAt: '2026-03-14T10:18:00.000Z',
      source: 'run_event',
    });
  });

  it('builds copyable related command snippets', () => {
    const snippets = buildRelatedCommandSnippets({
      runId: 'run-1',
      jobId: 'job-1',
      receiptId: 'receipt-1',
      taskTitle: 'Alpha task',
    });

    expect(snippets).toEqual(
      expect.arrayContaining([
        { label: 'Run', command: "pop run show 'run-1'" },
        { label: 'Receipt', command: "pop receipt show 'receipt-1'" },
        { label: 'Memory', command: "pop memory search 'Alpha task'" },
      ]),
    );
  });

  it('clears stale persisted selection when filtered data no longer contains it', () => {
    expect(normalizeSelection(
      { kind: 'intervention', id: 'int-1' },
      [makeRun()],
      [makeJob()],
      [makeIntervention()],
    )).toEqual({ kind: 'intervention', id: 'int-1' });

    expect(normalizeSelection(
      { kind: 'intervention', id: 'int-1' },
      [makeRun()],
      [makeJob()],
      [],
    )).toEqual({ kind: 'none', id: null });
  });
});
