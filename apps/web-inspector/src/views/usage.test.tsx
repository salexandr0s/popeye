// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Usage } from './usage';

const hooks = vi.hoisted(() => ({
  useUsageSummary: vi.fn(),
  useSecurityAudit: vi.fn(),
}));

vi.mock('../api/hooks', () => hooks);

function makeUsageResult(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      runs: 12,
      tokensIn: 3456,
      tokensOut: 7890,
      estimatedCostUsd: 1.2345,
    },
    error: null,
    loading: false,
    updatedAt: '2026-03-14T10:00:00.000Z',
    refetch: vi.fn(),
    ...overrides,
  };
}

function makeAuditResult(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      findings: [
        {
          code: 'auth_exchange_nonce_expired',
          severity: 'warn',
          message: 'Auth exchange nonce expired',
          component: 'control-api',
          timestamp: '2026-03-14T10:15:00.000Z',
          details: {
            ip: '127.0.0.1',
            method: 'POST',
          },
        },
      ],
    },
    error: null,
    loading: false,
    updatedAt: '2026-03-14T10:16:00.000Z',
    refetch: vi.fn(),
    ...overrides,
  };
}

describe('Usage', () => {
  beforeEach(() => {
    hooks.useUsageSummary.mockReturnValue(makeUsageResult());
    hooks.useSecurityAudit.mockReturnValue(makeAuditResult());
    vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('2026-03-14 10:15:00');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders security audit telemetry with observed time and context details', () => {
    render(<Usage />);

    expect(screen.getByText('Usage & Audit')).toBeTruthy();
    expect(screen.getByText('auth_exchange_nonce_expired')).toBeTruthy();
    expect(screen.getByText('Auth exchange nonce expired')).toBeTruthy();
    expect(screen.getByText('2026-03-14 10:15:00')).toBeTruthy();
    expect(screen.getByText('control-api · ip: 127.0.0.1 · method: POST')).toBeTruthy();
  });

  it('renders the empty state when there are no audit findings', () => {
    hooks.useSecurityAudit.mockReturnValue(makeAuditResult({
      data: { findings: [] },
    }));

    render(<Usage />);

    expect(screen.getByText('No findings')).toBeTruthy();
    expect(screen.getByText('No security audit findings to display.')).toBeTruthy();
  });
});
