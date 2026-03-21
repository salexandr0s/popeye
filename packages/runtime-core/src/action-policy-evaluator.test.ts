import { describe, expect, it } from 'vitest';
import { ActionPolicyEvaluator } from './action-policy-evaluator.js';

function makeEvaluator() {
  return new ActionPolicyEvaluator({
    rules: [],
    defaultRiskClass: 'ask',
    pendingExpiryMinutes: 60,
  });
}

describe('ActionPolicyEvaluator', () => {
  it('uses the built-in default matrix for external writes', () => {
    const evaluator = makeEvaluator();

    const result = evaluator.evaluateAction({
      scope: 'external_write',
      domain: 'todos',
      actionKind: 'write',
      resourceScope: 'resource',
      resourceType: 'todo',
      resourceId: 'todo-1',
      requestedBy: 'test',
    });

    expect(result).toMatchObject({
      riskClass: 'ask',
      standingApprovalEligible: true,
      automationGrantEligible: false,
      source: 'default',
    });
  });

  it('lets explicit approval rules override the default matrix risk class', () => {
    const evaluator = new ActionPolicyEvaluator({
      rules: [
        {
          scope: 'external_write',
          domain: 'email',
          riskClass: 'auto',
          actionKinds: ['write'],
          resourceScopes: ['resource'],
        },
      ],
      defaultRiskClass: 'ask',
      pendingExpiryMinutes: 60,
    });

    const result = evaluator.evaluateAction({
      scope: 'external_write',
      domain: 'email',
      actionKind: 'write',
      resourceScope: 'resource',
      resourceType: 'draft',
      resourceId: 'draft-1',
      requestedBy: 'test',
    });

    expect(result).toMatchObject({
      riskClass: 'auto',
      standingApprovalEligible: false,
      automationGrantEligible: false,
      source: 'rule',
    });
  });

  it('denies restricted-domain mutations by default', () => {
    const evaluator = makeEvaluator();

    const result = evaluator.evaluateAction({
      scope: 'external_write',
      domain: 'finance',
      actionKind: 'delete',
      resourceScope: 'resource',
      resourceType: 'transaction',
      resourceId: 'txn-1',
      requestedBy: 'test',
    });

    expect(result).toMatchObject({
      riskClass: 'deny',
      standingApprovalEligible: false,
      automationGrantEligible: false,
      source: 'default',
    });
  });

  it('falls back to the configured default risk class when no rule or default matches', () => {
    const evaluator = new ActionPolicyEvaluator({
      rules: [],
      defaultRiskClass: 'auto',
      pendingExpiryMinutes: 60,
    });

    const result = evaluator.evaluateAction({
      scope: 'secret_access',
      domain: 'general',
      actionKind: 'read',
      resourceScope: 'resource',
      resourceType: 'secret',
      resourceId: 'secret-1',
      requestedBy: 'test',
    });

    expect(result).toMatchObject({
      riskClass: 'auto',
      source: 'fallback',
    });
  });

  it('treats context release as a special path with profile-aware decisions', () => {
    const evaluator = makeEvaluator();

    expect(evaluator.evaluateContextRelease({
      domain: 'general',
      requestedLevel: 'summary',
      profileLimit: 'none',
    })).toMatchObject({
      riskClass: 'deny',
      source: 'default',
    });

    expect(evaluator.evaluateContextRelease({
      domain: 'general',
      requestedLevel: 'full',
      profileLimit: 'summary_only',
    })).toMatchObject({
      riskClass: 'ask',
      standingApprovalEligible: false,
      automationGrantEligible: false,
    });

    expect(evaluator.evaluateContextRelease({
      domain: 'medical',
      requestedLevel: 'excerpt',
      profileLimit: 'full',
    })).toMatchObject({
      riskClass: 'ask',
      standingApprovalEligible: false,
      automationGrantEligible: false,
    });
  });

  // B6: Domain-specific policy denials for finance and medical
  describe('domain-specific policy denials', () => {
    it('denies finance send by default', () => {
      const evaluator = makeEvaluator();
      const result = evaluator.evaluateAction({
        scope: 'external_write',
        domain: 'finance',
        actionKind: 'send',
        resourceScope: 'resource',
        resourceType: 'payment',
        resourceId: 'pay-1',
        requestedBy: 'test',
      });

      expect(result).toMatchObject({
        riskClass: 'deny',
        standingApprovalEligible: false,
        automationGrantEligible: false,
        source: 'default',
      });
      expect(result.reason).toContain('Finance mutations are denied');
    });

    it('denies finance write by default', () => {
      const evaluator = makeEvaluator();
      const result = evaluator.evaluateAction({
        scope: 'external_write',
        domain: 'finance',
        actionKind: 'write',
        resourceScope: 'resource',
        resourceType: 'transaction',
        resourceId: 'txn-1',
        requestedBy: 'test',
      });

      expect(result).toMatchObject({
        riskClass: 'deny',
        standingApprovalEligible: false,
        automationGrantEligible: false,
        source: 'default',
      });
    });

    it('denies medical write by default', () => {
      const evaluator = makeEvaluator();
      const result = evaluator.evaluateAction({
        scope: 'external_write',
        domain: 'medical',
        actionKind: 'write',
        resourceScope: 'resource',
        resourceType: 'patient_record',
        resourceId: 'record-1',
        requestedBy: 'test',
      });

      expect(result).toMatchObject({
        riskClass: 'deny',
        standingApprovalEligible: false,
        automationGrantEligible: false,
        source: 'default',
      });
      expect(result.reason).toContain('Medical mutations are denied');
    });

    it('denies medical send by default', () => {
      const evaluator = makeEvaluator();
      const result = evaluator.evaluateAction({
        scope: 'external_write',
        domain: 'medical',
        actionKind: 'send',
        resourceScope: 'resource',
        resourceType: 'referral',
        resourceId: 'ref-1',
        requestedBy: 'test',
      });

      expect(result).toMatchObject({
        riskClass: 'deny',
        standingApprovalEligible: false,
        automationGrantEligible: false,
        source: 'default',
      });
    });

    it('denies medical delete by default', () => {
      const evaluator = makeEvaluator();
      const result = evaluator.evaluateAction({
        scope: 'external_write',
        domain: 'medical',
        actionKind: 'delete',
        resourceScope: 'resource',
        resourceType: 'patient_record',
        resourceId: 'record-2',
        requestedBy: 'test',
      });

      expect(result).toMatchObject({
        riskClass: 'deny',
        standingApprovalEligible: false,
        automationGrantEligible: false,
        source: 'default',
      });
    });

    it('allows finance read as non-restricted by falling through to default risk class', () => {
      const evaluator = makeEvaluator();
      const result = evaluator.evaluateAction({
        scope: 'external_write',
        domain: 'finance',
        actionKind: 'read',
        resourceScope: 'resource',
        resourceType: 'account',
        resourceId: 'acct-1',
        requestedBy: 'test',
      });

      // No explicit deny default for finance read -> falls through
      expect(result.riskClass).not.toBe('deny');
      expect(result.source).toBe('fallback');
    });
  });
});
