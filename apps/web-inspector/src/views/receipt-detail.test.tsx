// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ReceiptDetail } from './receipt-detail';

const hooks = vi.hoisted(() => ({
  useReceipt: vi.fn(),
}));

vi.mock('../api/hooks', () => hooks);

function makeReceipt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'receipt-1',
    runId: 'run-1',
    taskId: 'task-1',
    workspaceId: 'default',
    status: 'succeeded',
    summary: 'Run completed successfully',
    details: 'Detailed receipt body',
    usage: {
      provider: 'fake',
      model: 'fake-engine',
      tokensIn: 123,
      tokensOut: 456,
      estimatedCostUsd: 0.0123,
    },
    createdAt: '2026-03-19T09:00:00.000Z',
    runtime: {
      projectId: 'proj-1',
      profileId: 'default',
      execution: {
        mode: 'interactive',
        memoryScope: 'workspace',
        recallScope: 'project',
        filesystemPolicyClass: 'workspace',
        contextReleasePolicy: 'summary_only',
        sessionPolicy: 'dedicated',
        warnings: ['Project-only recall applied'],
      },
      contextReleases: {
        totalReleases: 2,
        totalTokenEstimate: 180,
        byDomain: {
          files: { count: 1, tokens: 120 },
          memory: { count: 1, tokens: 60 },
        },
      },
      timeline: [
        {
          id: 'timeline-1',
          at: '2026-03-19T09:00:01.000Z',
          kind: 'run',
          severity: 'info',
          code: 'engine_started',
          title: 'Engine run started',
          detail: 'Prompt: hello',
          source: 'run_event',
          metadata: {
            promptLength: '5',
          },
        },
        {
          id: 'timeline-2',
          at: '2026-03-19T09:00:02.000Z',
          kind: 'policy',
          severity: 'warn',
          code: 'connection_policy_denied',
          title: 'Connection Policy Denied',
          detail: 'Connection conn-1 is disabled',
          source: 'security_audit',
          metadata: {
            connectionId: 'conn-1',
          },
        },
      ],
    },
    ...overrides,
  };
}

function makeResult(overrides: Record<string, unknown> = {}) {
  return {
    data: makeReceipt(),
    error: null,
    loading: false,
    updatedAt: '2026-03-19T09:05:00.000Z',
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderReceiptDetail() {
  return render(
    <MemoryRouter initialEntries={['/receipts/receipt-1']}>
      <Routes>
        <Route path="/receipts/:id" element={<ReceiptDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ReceiptDetail', () => {
  beforeEach(() => {
    hooks.useReceipt.mockReturnValue(makeResult());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders a loading state while the receipt is loading', () => {
    hooks.useReceipt.mockReturnValue(makeResult({ data: null, loading: true }));

    renderReceiptDetail();

    expect(screen.getByText('Loading...')).toBeTruthy();
  });

  it('renders a page-level error when receipt loading fails', () => {
    hooks.useReceipt.mockReturnValue(makeResult({ data: null, error: 'Receipt fetch failed' }));

    renderReceiptDetail();

    expect(screen.getByText('Receipt fetch failed')).toBeTruthy();
  });

  it('renders runtime execution context and context release summaries', () => {
    renderReceiptDetail();

    expect(screen.getByText('Runtime Context')).toBeTruthy();
    expect(screen.getByText('interactive')).toBeTruthy();
    expect(screen.getByText('workspace / project')).toBeTruthy();
    expect(screen.getByText('summary_only')).toBeTruthy();
    expect(screen.getByText((content) => content.includes('Project-only recall applied'))).toBeTruthy();
    expect(screen.getByText('Context Releases')).toBeTruthy();
    expect(screen.getByText('proj-1')).toBeTruthy();
    expect(screen.getAllByText('default').length).toBeGreaterThan(0);
    expect(screen.getByText('1 release(s) / 120 tokens')).toBeTruthy();
    expect(screen.getByText('1 release(s) / 60 tokens')).toBeTruthy();
    expect(screen.getByText('files')).toBeTruthy();
    expect(screen.getByText('memory')).toBeTruthy();
    expect(screen.getByText('Policy Timeline')).toBeTruthy();
    expect(screen.getByText('Engine run started')).toBeTruthy();
    expect(screen.getByText('Connection Policy Denied')).toBeTruthy();
    expect(screen.getAllByText('warn').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Event metadata').length).toBe(2);
  });
});
