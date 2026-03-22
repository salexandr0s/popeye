import type {
  ApprovalRecord,
  AutomationGrantRecord,
  DomainKind,
  StandingApprovalRecord,
} from '@popeye/contracts';

import type { CommandContext } from '../formatters.js';
import {
  formatApproval,
  formatAutomationGrant,
  formatStandingApproval,
  readCsvFlag,
  readFlagValue,
  requireArg,
  requireFlag,
} from '../formatters.js';

export async function handleApprovals(ctx: CommandContext): Promise<void> {
  const { client, subcommand, arg1, jsonFlag, positionalArgs } = ctx;

  if (subcommand === 'list') {
    const approvalFilters: { status?: string; domain?: string; scope?: string; actionKind?: string; runId?: string; resolvedBy?: string } = {};
    const aStatus = readFlagValue('--status'); if (aStatus) approvalFilters.status = aStatus;
    const aDomain = readFlagValue('--domain'); if (aDomain) approvalFilters.domain = aDomain;
    const aScope = readFlagValue('--scope'); if (aScope) approvalFilters.scope = aScope;
    const aKind = readFlagValue('--action-kind'); if (aKind) approvalFilters.actionKind = aKind;
    const aRunId = readFlagValue('--run-id'); if (aRunId) approvalFilters.runId = aRunId;
    const aResolvedBy = readFlagValue('--resolved-by'); if (aResolvedBy) approvalFilters.resolvedBy = aResolvedBy;
    const approvals = await client.listApprovals(approvalFilters);
    if (jsonFlag) {
      console.info(JSON.stringify(approvals, null, 2));
    } else if (approvals.length === 0) {
      console.info('No approvals');
    } else {
      console.info(approvals.map(formatApproval).join('\n\n'));
    }
    return;
  }

  if (subcommand === 'show') {
    requireArg(arg1, 'approvalId');
    const approval = await client.getApproval(arg1);
    console.info(jsonFlag ? JSON.stringify(approval, null, 2) : formatApproval(approval));
    return;
  }

  if (subcommand === 'approve' || subcommand === 'deny') {
    requireArg(arg1, 'approvalId');
    const decisionReason = positionalArgs.slice(5).join(' ').trim() || undefined;
    const approval = await client.resolveApproval(arg1, {
      decision: subcommand === 'approve' ? 'approved' : 'denied',
      ...(decisionReason ? { decisionReason } : {}),
    });
    console.info(jsonFlag ? JSON.stringify(approval, null, 2) : formatApproval(approval));
    return;
  }
}

export async function handleStandingApprovals(ctx: CommandContext): Promise<void> {
  const { client, subcommand, arg1, jsonFlag } = ctx;

  if (subcommand === 'list') {
    const saFilters: { status?: string; domain?: string; actionKind?: string } = {};
    const saStatus = readFlagValue('--status'); if (saStatus) saFilters.status = saStatus;
    const saDomain = readFlagValue('--domain'); if (saDomain) saFilters.domain = saDomain;
    const saKind = readFlagValue('--action-kind'); if (saKind) saFilters.actionKind = saKind;
    const records = await client.listStandingApprovals(saFilters);
    if (jsonFlag) {
      console.info(JSON.stringify(records, null, 2));
    } else if (records.length === 0) {
      console.info('No standing approvals');
    } else {
      console.info(records.map(formatStandingApproval).join('\n\n'));
    }
    return;
  }

  if (subcommand === 'create') {
    const record = await client.createStandingApproval({
      scope: requireFlag('--scope') as ApprovalRecord['scope'],
      domain: requireFlag('--domain') as DomainKind,
      actionKind: requireFlag('--action-kind') as StandingApprovalRecord['actionKind'],
      resourceType: requireFlag('--resource-type'),
      resourceScope: (readFlagValue('--resource-scope') ?? 'resource') as StandingApprovalRecord['resourceScope'],
      resourceId: readFlagValue('--resource-id') ?? null,
      requestedBy: readFlagValue('--requested-by') ?? null,
      workspaceId: readFlagValue('--workspace-id') ?? null,
      projectId: readFlagValue('--project-id') ?? null,
      note: readFlagValue('--note') ?? '',
      expiresAt: readFlagValue('--expires-at') ?? null,
      createdBy: readFlagValue('--created-by') ?? 'cli:pop',
    });
    console.info(jsonFlag ? JSON.stringify(record, null, 2) : formatStandingApproval(record));
    return;
  }

  if (subcommand === 'revoke') {
    requireArg(arg1, 'standingApprovalId');
    const record = await client.revokeStandingApproval(arg1, {
      revokedBy: readFlagValue('--by') ?? 'cli:pop',
    });
    console.info(jsonFlag ? JSON.stringify(record, null, 2) : formatStandingApproval(record));
    return;
  }
}

export async function handleAutomationGrants(ctx: CommandContext): Promise<void> {
  const { client, subcommand, arg1, jsonFlag } = ctx;

  if (subcommand === 'list') {
    const agFilters: { status?: string; domain?: string; actionKind?: string } = {};
    const agStatus = readFlagValue('--status'); if (agStatus) agFilters.status = agStatus;
    const agDomain = readFlagValue('--domain'); if (agDomain) agFilters.domain = agDomain;
    const agKind = readFlagValue('--action-kind'); if (agKind) agFilters.actionKind = agKind;
    const records = await client.listAutomationGrants(agFilters);
    if (jsonFlag) {
      console.info(JSON.stringify(records, null, 2));
    } else if (records.length === 0) {
      console.info('No automation grants');
    } else {
      console.info(records.map(formatAutomationGrant).join('\n\n'));
    }
    return;
  }

  if (subcommand === 'create') {
    const record = await client.createAutomationGrant({
      scope: requireFlag('--scope') as ApprovalRecord['scope'],
      domain: requireFlag('--domain') as DomainKind,
      actionKind: requireFlag('--action-kind') as AutomationGrantRecord['actionKind'],
      resourceType: requireFlag('--resource-type'),
      resourceScope: (readFlagValue('--resource-scope') ?? 'resource') as AutomationGrantRecord['resourceScope'],
      resourceId: readFlagValue('--resource-id') ?? null,
      requestedBy: readFlagValue('--requested-by') ?? null,
      workspaceId: readFlagValue('--workspace-id') ?? null,
      projectId: readFlagValue('--project-id') ?? null,
      taskSources: (readCsvFlag('--task-sources') ?? []) as AutomationGrantRecord['taskSources'],
      note: readFlagValue('--note') ?? '',
      expiresAt: readFlagValue('--expires-at') ?? null,
      createdBy: readFlagValue('--created-by') ?? 'cli:pop',
    });
    console.info(jsonFlag ? JSON.stringify(record, null, 2) : formatAutomationGrant(record));
    return;
  }

  if (subcommand === 'revoke') {
    requireArg(arg1, 'automationGrantId');
    const record = await client.revokeAutomationGrant(arg1, {
      revokedBy: readFlagValue('--by') ?? 'cli:pop',
    });
    console.info(jsonFlag ? JSON.stringify(record, null, 2) : formatAutomationGrant(record));
    return;
  }
}
