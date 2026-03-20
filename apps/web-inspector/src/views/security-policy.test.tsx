// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { SecurityPolicy } from './security-policy';

const hooks = vi.hoisted(() => ({
  useSecurityPolicy: vi.fn(),
}));

vi.mock('../api/hooks', () => hooks);

function makePolicyResult(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      domainPolicies: [
        { domain: 'email', sensitivity: 'personal', embeddingPolicy: 'derived_only', contextReleasePolicy: 'summary' },
        { domain: 'finance', sensitivity: 'restricted', embeddingPolicy: 'none', contextReleasePolicy: 'none' },
      ],
      defaultRiskClass: 'ask',
      actionDefaults: [
        {
          scope: 'external_write',
          domain: null,
          actionKind: 'write',
          riskClass: 'ask',
          standingApprovalEligible: true,
          automationGrantEligible: false,
          reason: 'External writes require explicit approval or a standing approval.',
        },
      ],
      approvalRules: [
        { scope: 'vault_open', domain: 'finance', riskClass: 'ask' },
      ],
    },
    error: null,
    loading: false,
    updatedAt: '2026-03-20T10:00:00.000Z',
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderPolicy() {
  return render(
    <MemoryRouter>
      <SecurityPolicy />
    </MemoryRouter>,
  );
}

describe('SecurityPolicy', () => {
  beforeEach(() => {
    hooks.useSecurityPolicy.mockReturnValue(makePolicyResult());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders loading, error, and empty states', () => {
    hooks.useSecurityPolicy.mockReturnValueOnce(makePolicyResult({ data: null, loading: true }));
    const { unmount } = renderPolicy();
    expect(screen.getByText('Loading...')).toBeTruthy();
    unmount();

    hooks.useSecurityPolicy.mockReturnValueOnce(makePolicyResult({ data: null, error: 'Policy failed' }));
    renderPolicy();
    expect(screen.getByText('Policy failed')).toBeTruthy();
  });

  it('renders domain policies and approval rules', () => {
    renderPolicy();

    expect(screen.getByRole('heading', { name: 'Domain policies' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Action defaults' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Approval rules' })).toBeTruthy();
    expect(screen.getByText('Default risk class')).toBeTruthy();
    expect(screen.getByText('email')).toBeTruthy();
    expect(screen.getByText('finance')).toBeTruthy();
    expect(screen.getByText('vault_open')).toBeTruthy();
    expect(screen.getByText('write')).toBeTruthy();
    expect(screen.getByText('External writes require explicit approval or a standing approval.')).toBeTruthy();
  });
});
