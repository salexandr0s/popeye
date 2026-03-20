import type {
  ActionApprovalRequestInput,
  ActionPolicyDefault,
  ActionPolicyEvaluation,
  ApprovalPolicyConfig,
  ApprovalPolicyRule,
  ContextReleasePolicy,
  DomainKind,
  ProfileContextReleasePolicy,
} from '@popeye/contracts';
import { ActionPolicyEvaluationSchema, ApprovalPolicyConfigSchema } from '@popeye/contracts';
import { isRequestedContextReleaseAllowed } from './execution-envelopes.js';

const DEFAULT_ACTION_DEFAULTS: ActionPolicyDefault[] = [
  {
    scope: 'external_write',
    domain: null,
    actionKind: 'sync',
    riskClass: 'auto',
    standingApprovalEligible: false,
    automationGrantEligible: false,
    reason: 'Routine sync work auto-runs under the runtime default policy.',
  },
  {
    scope: 'external_write',
    domain: null,
    actionKind: 'import',
    riskClass: 'auto',
    standingApprovalEligible: false,
    automationGrantEligible: false,
    reason: 'Import jobs auto-run under the runtime default policy.',
  },
  {
    scope: 'external_write',
    domain: null,
    actionKind: 'digest',
    riskClass: 'auto',
    standingApprovalEligible: false,
    automationGrantEligible: false,
    reason: 'Digest generation auto-runs under the runtime default policy.',
  },
  {
    scope: 'external_write',
    domain: null,
    actionKind: 'classify',
    riskClass: 'auto',
    standingApprovalEligible: false,
    automationGrantEligible: false,
    reason: 'Classification jobs auto-run under the runtime default policy.',
  },
  {
    scope: 'external_write',
    domain: null,
    actionKind: 'triage',
    riskClass: 'auto',
    standingApprovalEligible: false,
    automationGrantEligible: false,
    reason: 'Triage jobs auto-run under the runtime default policy.',
  },
  {
    scope: 'external_write',
    domain: null,
    actionKind: 'write',
    riskClass: 'ask',
    standingApprovalEligible: true,
    automationGrantEligible: false,
    reason: 'External writes require explicit approval or a standing approval.',
  },
  {
    scope: 'external_write',
    domain: null,
    actionKind: 'send',
    riskClass: 'ask',
    standingApprovalEligible: true,
    automationGrantEligible: false,
    reason: 'External sends require explicit approval or a standing approval.',
  },
  {
    scope: 'external_write',
    domain: null,
    actionKind: 'delete',
    riskClass: 'ask',
    standingApprovalEligible: false,
    automationGrantEligible: false,
    reason: 'Delete actions require explicit approval.',
  },
  {
    scope: 'external_write',
    domain: 'finance',
    actionKind: 'write',
    riskClass: 'deny',
    standingApprovalEligible: false,
    automationGrantEligible: false,
    reason: 'Finance mutations are denied by default.',
  },
  {
    scope: 'external_write',
    domain: 'finance',
    actionKind: 'send',
    riskClass: 'deny',
    standingApprovalEligible: false,
    automationGrantEligible: false,
    reason: 'Finance mutations are denied by default.',
  },
  {
    scope: 'external_write',
    domain: 'finance',
    actionKind: 'delete',
    riskClass: 'deny',
    standingApprovalEligible: false,
    automationGrantEligible: false,
    reason: 'Finance mutations are denied by default.',
  },
  {
    scope: 'external_write',
    domain: 'medical',
    actionKind: 'write',
    riskClass: 'deny',
    standingApprovalEligible: false,
    automationGrantEligible: false,
    reason: 'Medical mutations are denied by default.',
  },
  {
    scope: 'external_write',
    domain: 'medical',
    actionKind: 'send',
    riskClass: 'deny',
    standingApprovalEligible: false,
    automationGrantEligible: false,
    reason: 'Medical mutations are denied by default.',
  },
  {
    scope: 'external_write',
    domain: 'medical',
    actionKind: 'delete',
    riskClass: 'deny',
    standingApprovalEligible: false,
    automationGrantEligible: false,
    reason: 'Medical mutations are denied by default.',
  },
  {
    scope: 'data_source_connect',
    domain: null,
    actionKind: 'connect',
    riskClass: 'ask',
    standingApprovalEligible: false,
    automationGrantEligible: false,
    reason: 'New data source connections require explicit approval.',
  },
  {
    scope: 'vault_open',
    domain: null,
    actionKind: 'open_vault',
    riskClass: 'ask',
    standingApprovalEligible: true,
    automationGrantEligible: false,
    reason: 'Vault access requires explicit approval or a standing approval.',
  },
  {
    scope: 'context_release',
    domain: null,
    actionKind: 'release_context',
    riskClass: 'ask',
    standingApprovalEligible: false,
    automationGrantEligible: false,
    reason: 'Context release requires explicit approval.',
  },
  {
    scope: 'context_release',
    domain: 'finance',
    actionKind: 'release_context',
    riskClass: 'ask',
    standingApprovalEligible: false,
    automationGrantEligible: false,
    reason: 'Restricted finance context requires explicit operator approval.',
  },
  {
    scope: 'context_release',
    domain: 'medical',
    actionKind: 'release_context',
    riskClass: 'ask',
    standingApprovalEligible: false,
    automationGrantEligible: false,
    reason: 'Restricted medical context requires explicit operator approval.',
  },
];

interface ContextReleaseEvaluationInput {
  domain: DomainKind;
  requestedLevel: ContextReleasePolicy;
  profileLimit: ProfileContextReleasePolicy;
  resourceScope?: ActionApprovalRequestInput['resourceScope'];
}

export class ActionPolicyEvaluator {
  private readonly config: ApprovalPolicyConfig;

  constructor(config?: ApprovalPolicyConfig) {
    this.config = ApprovalPolicyConfigSchema.parse(config ?? {});
  }

  listActionDefaults(): ActionPolicyDefault[] {
    return DEFAULT_ACTION_DEFAULTS;
  }

  listRules(): ApprovalPolicyRule[] {
    return this.config.rules;
  }

  getDefaultRiskClass(): ApprovalPolicyConfig['defaultRiskClass'] {
    return this.config.defaultRiskClass;
  }

  evaluateAction(input: ActionApprovalRequestInput): ActionPolicyEvaluation {
    const matchedRule = this.findMatchingRule(input);
    const matchedDefault = this.findMatchingDefault(input.scope, input.actionKind, input.domain);
    const riskClass = matchedRule?.riskClass ?? matchedDefault?.riskClass ?? this.config.defaultRiskClass;
    const source = matchedRule ? 'rule' : matchedDefault ? 'default' : 'fallback';

    return ActionPolicyEvaluationSchema.parse({
      scope: input.scope,
      domain: input.domain,
      actionKind: input.actionKind,
      resourceScope: input.resourceScope,
      riskClass,
      standingApprovalEligible: riskClass === 'ask' ? matchedDefault?.standingApprovalEligible ?? false : false,
      automationGrantEligible: riskClass === 'ask' ? matchedDefault?.automationGrantEligible ?? false : false,
      source,
      reason: this.buildReason({
        matchedRule,
        matchedDefault,
        source,
      }),
    });
  }

  evaluateContextRelease(input: ContextReleaseEvaluationInput): ActionPolicyEvaluation {
    if (input.profileLimit === 'none') {
      return ActionPolicyEvaluationSchema.parse({
        scope: 'context_release',
        domain: input.domain,
        actionKind: 'release_context',
        resourceScope: input.resourceScope ?? 'resource',
        riskClass: 'deny',
        standingApprovalEligible: false,
        automationGrantEligible: false,
        source: 'default',
        reason: 'The execution profile disables context release for this run.',
      });
    }

    const base = this.evaluateAction({
      scope: 'context_release',
      domain: input.domain,
      actionKind: 'release_context',
      resourceScope: input.resourceScope ?? 'resource',
      resourceType: 'context_release',
      resourceId: 'context_release',
      requestedBy: 'context_release_gate',
    });

    if (!isRequestedContextReleaseAllowed(input.profileLimit, input.requestedLevel)) {
      return {
        ...base,
        riskClass: 'ask',
        standingApprovalEligible: false,
        automationGrantEligible: false,
        reason: `Requested context release level ${input.requestedLevel} exceeds the execution profile limit ${input.profileLimit}.`,
      };
    }

    return base;
  }

  private findMatchingRule(input: Pick<ActionApprovalRequestInput, 'scope' | 'domain' | 'actionKind' | 'resourceScope'>): ApprovalPolicyRule | null {
    return this.config.rules.find((rule: ApprovalPolicyRule) => {
      if (rule.scope !== input.scope) return false;
      if (rule.domain !== input.domain) return false;
      if (rule.actionKinds.length > 0 && !rule.actionKinds.includes(input.actionKind)) return false;
      if (rule.resourceScopes.length > 0 && !rule.resourceScopes.includes(input.resourceScope ?? 'resource')) return false;
      return true;
    }) ?? null;
  }

  private findMatchingDefault(
    scope: ActionApprovalRequestInput['scope'],
    actionKind: ActionApprovalRequestInput['actionKind'],
    domain: ActionApprovalRequestInput['domain'],
  ): ActionPolicyDefault | null {
    return DEFAULT_ACTION_DEFAULTS.find((entry) =>
      entry.scope === scope
      && entry.actionKind === actionKind
      && entry.domain === domain,
    )
      ?? DEFAULT_ACTION_DEFAULTS.find((entry) =>
        entry.scope === scope
        && entry.actionKind === actionKind
        && entry.domain === null,
      )
      ?? null;
  }

  private buildReason(input: {
    matchedRule: ApprovalPolicyRule | null;
    matchedDefault: ActionPolicyDefault | null;
    source: ActionPolicyEvaluation['source'];
  }): string {
    if (input.source === 'rule' && input.matchedRule) {
      return `Configured approval rule matched for ${input.matchedRule.scope}/${input.matchedRule.domain}.`;
    }
    if (input.source === 'default' && input.matchedDefault) {
      return input.matchedDefault.reason;
    }
    return `No explicit rule or built-in default matched; using default risk class ${this.config.defaultRiskClass}.`;
  }
}
