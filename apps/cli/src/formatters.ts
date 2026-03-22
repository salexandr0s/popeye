import type {
  AgentProfileRecord,
  ApprovalRecord,
  AutomationGrantRecord,
  EngineCapabilitiesResponse,
  ExecutionEnvelopeResponse,
  RunRecord,
  SecurityPolicyResponse,
  StandingApprovalRecord,
  VaultRecord,
} from '@popeye/contracts';
import type { PopeyeApiClient } from '@popeye/api-client';

/**
 * Shared context passed to every command handler.
 * Contains the parsed CLI state that every handler needs.
 */
export interface CommandContext {
  /** The daemon API client (already connected). */
  client: PopeyeApiClient;
  /** The subcommand string (e.g. 'list', 'show'). */
  subcommand: string;
  /** First positional arg after subcommand. */
  arg1: string | undefined;
  /** Second positional arg after subcommand (rare). */
  arg2: string | undefined;
  /** Whether --json was passed. */
  jsonFlag: boolean;
  /** All positional args (no flags). */
  positionalArgs: string[];
}

/** Parse a CSV line respecting quoted fields (handles commas inside quotes). */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

export function requireArg(value: string | undefined, label: string, command?: string, subcommand?: string, commands?: Record<string, Record<string, { desc: string; usage: string }>>): asserts value is string {
  if (!value) {
    console.error(`Missing required argument: <${label}>`);
    const subs = command && commands ? commands[command] : undefined;
    const sub = subs && subcommand ? subs[subcommand] : undefined;
    if (sub) console.error(`Usage: ${sub.usage}`);
    process.exit(1);
  }
}

export function getFlagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

export function readFlagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

export function requireFlag(flag: string, command?: string, subcommand?: string, commands?: Record<string, Record<string, { desc: string; usage: string }>>): string {
  const value = readFlagValue(flag);
  if (!value) {
    console.error(`Missing required flag: ${flag}`);
    const subs = command && commands ? commands[command] : undefined;
    const sub = subs && subcommand ? subs[subcommand] : undefined;
    if (sub) console.error(`Usage: ${sub.usage}`);
    process.exit(1);
  }
  return value;
}

export function readCsvFlag(flag: string): string[] | undefined {
  const value = readFlagValue(flag);
  if (!value) return undefined;
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

export function formatRun(run: RunRecord, envelope?: ExecutionEnvelopeResponse | null): string {
  const lines = [
    `Run ${run.id}`,
    `  State:      ${run.state}`,
    `  Job:        ${run.jobId}`,
    `  Task:       ${run.taskId}`,
    `  Workspace:  ${run.workspaceId}`,
    `  Profile:    ${run.profileId}`,
    `  Session:    ${run.sessionRootId}`,
    `  Started:    ${run.startedAt}`,
  ];
  if (run.finishedAt) lines.push(`  Finished:   ${run.finishedAt}`);
  if (run.error) lines.push(`  Error:      ${run.error}`);
  if (envelope) {
    lines.push('  Envelope:   persisted');
    lines.push(`  Recall:     ${envelope.memoryScope} memory / ${envelope.recallScope} recall`);
    lines.push(`  Filesystem: ${envelope.filesystemPolicyClass}`);
    lines.push(`  Release:    ${envelope.contextReleasePolicy}`);
    lines.push(`  Roots:      ${envelope.readRoots.length} read / ${envelope.writeRoots.length} write / ${envelope.protectedPaths.length} protected`);
    if (envelope.provenance.warnings.length > 0) {
      lines.push(`  Warnings:   ${envelope.provenance.warnings.join(' | ')}`);
    }
  }
  return lines.join('\n');
}

export function formatEnvelope(envelope: ExecutionEnvelopeResponse): string {
  const lines = [
    `Execution Envelope ${envelope.runId}`,
    `  Task:                 ${envelope.taskId}`,
    `  Profile:              ${envelope.profileId}`,
    `  Workspace:            ${envelope.workspaceId}`,
    `  Project:              ${envelope.projectId ?? '(none)'}`,
    `  Mode:                 ${envelope.mode}`,
    `  Model policy:         ${envelope.modelPolicy}`,
    `  Memory scope:         ${envelope.memoryScope}`,
    `  Recall scope:         ${envelope.recallScope}`,
    `  Filesystem policy:    ${envelope.filesystemPolicyClass}`,
    `  Context release:      ${envelope.contextReleasePolicy}`,
    `  CWD:                  ${envelope.cwd ?? '(none)'}`,
    `  Scratch root:         ${envelope.scratchRoot}`,
    `  Runtime tools:        ${envelope.allowedRuntimeTools.length > 0 ? envelope.allowedRuntimeTools.join(', ') : '(none)'}`,
    `  Capabilities:         ${envelope.allowedCapabilityIds.length > 0 ? envelope.allowedCapabilityIds.join(', ') : '(none)'}`,
    `  Read roots:           ${envelope.readRoots.length > 0 ? envelope.readRoots.join(', ') : '(none)'}`,
    `  Write roots:          ${envelope.writeRoots.length > 0 ? envelope.writeRoots.join(', ') : '(none)'}`,
    `  Protected paths:      ${envelope.protectedPaths.length > 0 ? envelope.protectedPaths.join(', ') : '(none)'}`,
    `  Derived at:           ${envelope.provenance.derivedAt}`,
    `  Engine kind:          ${envelope.provenance.engineKind}`,
    `  Session policy:       ${envelope.provenance.sessionPolicy}`,
  ];
  if (envelope.provenance.warnings.length > 0) {
    lines.push(`  Warnings:             ${envelope.provenance.warnings.join(' | ')}`);
  }
  return lines.join('\n');
}

export function formatEngineCapabilities(capabilities: EngineCapabilitiesResponse): string {
  const lines = [
    `Engine:              ${capabilities.engineKind}`,
    `  Host tools:        ${capabilities.hostToolMode}`,
    `  Sessions:          ${capabilities.persistentSessionSupport ? 'persistent' : 'ephemeral'}`,
    `  Resume by ref:     ${capabilities.resumeBySessionRefSupport ? 'yes' : 'no'}`,
    `  Compaction events: ${capabilities.compactionEventSupport ? 'yes' : 'no'}`,
    `  Cancellation:      ${capabilities.cancellationMode}`,
  ];
  if (capabilities.acceptedRequestMetadata.length > 0) {
    lines.push(`  Metadata:          ${capabilities.acceptedRequestMetadata.join(', ')}`);
  }
  if (capabilities.warnings.length > 0) {
    lines.push(`  Warnings:          ${capabilities.warnings.join(' | ')}`);
  }
  return lines.join('\n');
}

export function formatProfile(profile: AgentProfileRecord): string {
  const lines = [
    `Profile ${profile.id}`,
    `  Name:                 ${profile.name}`,
    `  Mode:                 ${profile.mode}`,
    `  Model policy:         ${profile.modelPolicy}`,
    `  Memory scope:         ${profile.memoryScope}`,
    `  Recall scope:         ${profile.recallScope}`,
    `  Filesystem policy:    ${profile.filesystemPolicyClass}`,
    `  Context release:      ${profile.contextReleasePolicy}`,
    `  Runtime tools:        ${profile.allowedRuntimeTools.length > 0 ? profile.allowedRuntimeTools.join(', ') : 'all/default'}`,
    `  Capabilities:         ${profile.allowedCapabilityIds.length > 0 ? profile.allowedCapabilityIds.join(', ') : 'all/default'}`,
    `  Created:              ${profile.createdAt}`,
  ];
  if (profile.description) lines.splice(2, 0, `  Description:          ${profile.description}`);
  if (profile.updatedAt) lines.push(`  Updated:              ${profile.updatedAt}`);
  return lines.join('\n');
}

export function formatApproval(approval: ApprovalRecord): string {
  const lines = [
    `Approval ${approval.id}`,
    `  Scope:                ${approval.scope}`,
    `  Domain:               ${approval.domain}`,
    `  Status:               ${approval.status}`,
    `  Risk class:           ${approval.riskClass}`,
    `  Action kind:          ${approval.actionKind}`,
    `  Resource scope:       ${approval.resourceScope}`,
    `  Resource:             ${approval.resourceType}/${approval.resourceId}`,
    `  Requested by:         ${approval.requestedBy}`,
    `  Run:                  ${approval.runId ?? '(none)'}`,
    `  Standing eligible:    ${approval.standingApprovalEligible ? 'yes' : 'no'}`,
    `  Automation eligible:  ${approval.automationGrantEligible ? 'yes' : 'no'}`,
    `  Created:              ${approval.createdAt}`,
  ];
  if (approval.expiresAt) lines.push(`  Expires:              ${approval.expiresAt}`);
  if (approval.resolvedBy) lines.push(`  Resolved by:          ${approval.resolvedBy}`);
  if (approval.resolvedByGrantId) lines.push(`  Resolution grant:     ${approval.resolvedByGrantId}`);
  if (approval.decisionReason) lines.push(`  Decision reason:      ${approval.decisionReason}`);
  return lines.join('\n');
}

export function formatStandingApproval(record: StandingApprovalRecord): string {
  const lines = [
    `Standing Approval ${record.id}`,
    `  Scope:                ${record.scope}`,
    `  Domain:               ${record.domain}`,
    `  Action kind:          ${record.actionKind}`,
    `  Resource scope:       ${record.resourceScope}`,
    `  Resource:             ${record.resourceType}/${record.resourceId ?? '*'}`,
    `  Requested by:         ${record.requestedBy ?? '*'}`,
    `  Workspace:            ${record.workspaceId ?? '*'}`,
    `  Project:              ${record.projectId ?? '*'}`,
    `  Status:               ${record.status}`,
    `  Created by:           ${record.createdBy}`,
    `  Created:              ${record.createdAt}`,
  ];
  if (record.note) lines.push(`  Note:                 ${record.note}`);
  if (record.expiresAt) lines.push(`  Expires:              ${record.expiresAt}`);
  if (record.revokedBy) lines.push(`  Revoked by:           ${record.revokedBy}`);
  if (record.revokedAt) lines.push(`  Revoked at:           ${record.revokedAt}`);
  return lines.join('\n');
}

export function formatAutomationGrant(record: AutomationGrantRecord): string {
  const lines = [
    `Automation Grant ${record.id}`,
    `  Scope:                ${record.scope}`,
    `  Domain:               ${record.domain}`,
    `  Action kind:          ${record.actionKind}`,
    `  Resource scope:       ${record.resourceScope}`,
    `  Resource:             ${record.resourceType}/${record.resourceId ?? '*'}`,
    `  Requested by:         ${record.requestedBy ?? '*'}`,
    `  Workspace:            ${record.workspaceId ?? '*'}`,
    `  Project:              ${record.projectId ?? '*'}`,
    `  Task sources:         ${record.taskSources.join(', ')}`,
    `  Status:               ${record.status}`,
    `  Created by:           ${record.createdBy}`,
    `  Created:              ${record.createdAt}`,
  ];
  if (record.note) lines.push(`  Note:                 ${record.note}`);
  if (record.expiresAt) lines.push(`  Expires:              ${record.expiresAt}`);
  if (record.revokedBy) lines.push(`  Revoked by:           ${record.revokedBy}`);
  if (record.revokedAt) lines.push(`  Revoked at:           ${record.revokedAt}`);
  return lines.join('\n');
}

export function formatVault(vault: VaultRecord): string {
  const lines = [
    `Vault ${vault.id}`,
    `  Domain:               ${vault.domain}`,
    `  Kind:                 ${vault.kind}`,
    `  Status:               ${vault.status}`,
    `  Encrypted:            ${vault.encrypted ? 'yes' : 'no'}`,
    `  Path:                 ${vault.dbPath}`,
    `  Created:              ${vault.createdAt}`,
  ];
  if (vault.lastAccessedAt) lines.push(`  Last accessed:        ${vault.lastAccessedAt}`);
  return lines.join('\n');
}

export function formatSecurityPolicy(policy: SecurityPolicyResponse): string {
  const lines = [
    'Security policy',
    `  Default risk class:   ${policy.defaultRiskClass}`,
    '',
    'Domain policies:',
  ];
  for (const domainPolicy of policy.domainPolicies) {
    lines.push(
      `  ${domainPolicy.domain}: sensitivity=${domainPolicy.sensitivity}, embeddings=${domainPolicy.embeddingPolicy}, context=${domainPolicy.contextReleasePolicy}`,
    );
  }
  lines.push('', 'Action defaults:');
  if (policy.actionDefaults.length === 0) {
    lines.push('  (no built-in defaults exposed)');
  } else {
    for (const actionDefault of policy.actionDefaults) {
      lines.push(
        `  ${actionDefault.scope} / ${actionDefault.domain ?? 'all'} / ${actionDefault.actionKind} -> ${actionDefault.riskClass} (standing=${actionDefault.standingApprovalEligible ? 'yes' : 'no'}, automation=${actionDefault.automationGrantEligible ? 'yes' : 'no'})`,
      );
    }
  }
  lines.push('', 'Approval rules:');
  if (policy.approvalRules.length === 0) {
    lines.push('  (no explicit rules configured)');
  } else {
    for (const rule of policy.approvalRules) {
      lines.push(`  ${rule.scope} / ${rule.domain} -> ${rule.riskClass}`);
    }
  }
  return lines.join('\n');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
