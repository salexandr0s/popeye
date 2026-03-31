import type BetterSqlite3 from 'better-sqlite3';

import type {
  AppliedPlaybook,
  ApprovalRecord,
  ExecutionEnvelope,
  ReceiptRecord,
  ReceiptTimelineEvent,
  RunEventRecord,
  RunRecord,
  SecurityAuditEvent,
  TaskRecord,
} from '@popeye/contracts';
import { nowIso } from '@popeye/contracts';

import type { ApprovalService } from './approval-service.js';
import type { ContextReleaseService } from './context-release-service.js';
import {
  buildTimelineMetadata,
  mapRunEventDetail,
  mapRunEventTitle,
  mapSecurityAuditKind,
  parseRunEventPayload,
  titleCase,
} from './row-mappers.js';

function sortAppliedPlaybooks(playbooks: NonNullable<ReceiptRecord['runtime']>['playbooks']): NonNullable<ReceiptRecord['runtime']>['playbooks'] {
  const rank = (scope: NonNullable<ReceiptRecord['runtime']>['playbooks'][number]['scope']): number => {
    switch (scope) {
      case 'global':
        return 0;
      case 'workspace':
        return 1;
      case 'project':
        return 2;
    }
  };
  return [...playbooks].sort((left, right) => {
    const byScope = rank(left.scope) - rank(right.scope);
    if (byScope !== 0) return byScope;
    const byId = left.id.localeCompare(right.id);
    if (byId !== 0) return byId;
    return left.revisionHash.localeCompare(right.revisionHash);
  });
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface ReceiptBuilderDeps {
  db: BetterSqlite3.Database;
  listRunEvents: (runId: string) => RunEventRecord[];
  getRun: (runId: string) => RunRecord | null;
  getTask: (taskId: string) => TaskRecord | null;
  getExecutionEnvelope: (runId: string) => ExecutionEnvelope | null;
  summarizeRunReleases: (runId: string) => {
    totalReleases: number;
    totalTokenEstimate: number;
    byDomain: Record<string, { count: number; tokens: number }>;
  };
  listPlaybookUsage: (runId: string) => AppliedPlaybook[];
  contextReleaseService: ContextReleaseService;
  approvalService: ApprovalService;
}

// ---------------------------------------------------------------------------
// ReceiptBuilder
// ---------------------------------------------------------------------------

export class ReceiptBuilder {
  private readonly db: BetterSqlite3.Database;
  private readonly listRunEvents: (runId: string) => RunEventRecord[];
  private readonly getRun: (runId: string) => RunRecord | null;
  private readonly getTask: (taskId: string) => TaskRecord | null;
  private readonly getExecutionEnvelope: (runId: string) => ExecutionEnvelope | null;
  private readonly summarizeRunReleases: (runId: string) => {
    totalReleases: number;
    totalTokenEstimate: number;
    byDomain: Record<string, { count: number; tokens: number }>;
  };
  private readonly listPlaybookUsage: (runId: string) => AppliedPlaybook[];
  private readonly contextReleaseService: ContextReleaseService;
  private readonly approvalService: ApprovalService;

  constructor(deps: ReceiptBuilderDeps) {
    this.db = deps.db;
    this.listRunEvents = deps.listRunEvents;
    this.getRun = deps.getRun;
    this.getTask = deps.getTask;
    this.getExecutionEnvelope = deps.getExecutionEnvelope;
    this.summarizeRunReleases = deps.summarizeRunReleases;
    this.listPlaybookUsage = deps.listPlaybookUsage;
    this.contextReleaseService = deps.contextReleaseService;
    this.approvalService = deps.approvalService;
  }

  listSecurityAuditEventsForRun(runId: string): SecurityAuditEvent[] {
    const rows = this.db
      .prepare('SELECT code, severity, message, component, timestamp, details_json FROM security_audit ORDER BY timestamp ASC')
      .all() as Array<{
        code: string;
        severity: SecurityAuditEvent['severity'];
        message: string;
        component: string;
        timestamp: string;
        details_json: string;
      }>;

    return rows
      .map((row) => {
        const details = JSON.parse(row.details_json || '{}') as Record<string, string>;
        return {
          code: row.code,
          severity: row.severity,
          message: row.message,
          component: row.component,
          timestamp: row.timestamp,
          details,
        } satisfies SecurityAuditEvent;
      })
      .filter((event) => event.details.runId === runId);
  }

  buildReceiptTimeline(runId: string, status?: ReceiptRecord['status']): ReceiptTimelineEvent[] {
    const timeline: ReceiptTimelineEvent[] = [];

    for (const event of this.listRunEvents(runId)) {
      timeline.push({
        id: `run_event:${event.id}`,
        at: event.createdAt,
        kind: 'run',
        severity: event.type === 'failed' ? 'error' : 'info',
        code: `engine_${event.type}`,
        title: mapRunEventTitle(event.type),
        detail: mapRunEventDetail(event),
        source: 'run_event',
        metadata: buildTimelineMetadata(parseRunEventPayload(event.payload)),
      });
    }

    for (const event of this.listSecurityAuditEventsForRun(runId)) {
      if (event.code === 'context_released') continue;
      timeline.push({
        id: `security_audit:${event.timestamp}:${event.code}`,
        at: event.timestamp,
        kind: mapSecurityAuditKind(event.code),
        severity: event.severity,
        code: event.code,
        title: titleCase(event.code),
        detail: event.message,
        source: 'security_audit',
        metadata: buildTimelineMetadata(event.details),
      });
    }

    const releases = this.contextReleaseService.listReleasesForRun(runId);
    const approvalsById = new Map<string, ApprovalRecord>();
    for (const approval of this.approvalService.listApprovals({ runId })) {
      approvalsById.set(approval.id, approval);
    }
    for (const release of releases) {
      if (!release.approvalId) continue;
      const approval = this.approvalService.getApproval(release.approvalId);
      if (approval) approvalsById.set(approval.id, approval);
    }

    for (const approval of approvalsById.values()) {
      timeline.push({
        id: `approval:${approval.id}:requested`,
        at: approval.createdAt,
        kind: 'approval',
        severity: approval.riskClass === 'deny' ? 'error' : 'info',
        code: 'approval_requested',
        title: 'Approval requested',
        detail: `${approval.scope} · ${approval.actionKind} · ${approval.resourceType}/${approval.resourceId}`,
        source: 'approval',
        metadata: buildTimelineMetadata({
          approvalId: approval.id,
          domain: approval.domain,
          riskClass: approval.riskClass,
          actionKind: approval.actionKind,
          resourceScope: approval.resourceScope,
          runId: approval.runId ?? '',
          standingApprovalEligible: approval.standingApprovalEligible,
          automationGrantEligible: approval.automationGrantEligible,
          status: approval.status,
        }),
      });
      if (approval.resolvedAt) {
        timeline.push({
          id: `approval:${approval.id}:resolved`,
          at: approval.resolvedAt,
          kind: 'approval',
          severity: approval.status === 'approved' ? 'info' : approval.status === 'expired' ? 'warn' : 'error',
          code: `approval_${approval.status}`,
          title: `Approval ${approval.status}`,
        detail: approval.decisionReason ?? `${approval.scope} decision recorded.`,
        source: 'approval',
        metadata: buildTimelineMetadata({
          approvalId: approval.id,
          resolvedBy: approval.resolvedBy ?? '',
          resolvedByGrantId: approval.resolvedByGrantId ?? '',
          domain: approval.domain,
          actionKind: approval.actionKind,
        }),
      });
    }
    }

    for (const release of releases) {
      timeline.push({
        id: `context_release:${release.id}`,
        at: release.createdAt,
        kind: 'context_release',
        severity: 'info',
        code: 'context_released',
        title: `Context released to ${release.domain}`,
        detail: `${release.releaseLevel}${release.redacted ? ' · redacted' : ''}`,
        source: 'context_release',
        metadata: buildTimelineMetadata({
          releaseId: release.id,
          sourceRef: release.sourceRef,
          tokenEstimate: release.tokenEstimate,
          ...(release.approvalId ? { approvalId: release.approvalId } : {}),
        }),
      });
    }

    if (status) {
      const run = this.getRun(runId);
      timeline.push({
        id: `receipt:${runId}:${status}`,
        at: run?.finishedAt ?? nowIso(),
        kind: status === 'succeeded' ? 'run' : 'warning',
        severity: status === 'succeeded' ? 'info' : status === 'cancelled' || status === 'abandoned' ? 'warn' : 'error',
        code: `receipt_${status}`,
        title: `Receipt ${status}`,
        detail: `Run finished with status ${status}.`,
        source: 'receipt',
        metadata: {},
      });
    }

    return timeline.sort((left, right) => {
      const byTime = Date.parse(left.at) - Date.parse(right.at);
      return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
    });
  }

  buildReceiptRuntimeSummary(
    runId: string,
    taskId: string,
    status?: ReceiptRecord['status'],
  ): NonNullable<ReceiptRecord['runtime']> | undefined {
    const run = this.getRun(runId);
    const task = this.getTask(taskId);
    const envelope = this.getExecutionEnvelope(runId);
    const contextReleases = this.summarizeRunReleases(runId);
    const playbooks = this.listPlaybookUsage(runId);
    const timeline = this.buildReceiptTimeline(runId, status);

    const runtimeSummary: NonNullable<ReceiptRecord['runtime']> = {
      projectId: task?.projectId ?? null,
      profileId: run?.profileId ?? null,
      execution: envelope
        ? {
            mode: envelope.mode,
            memoryScope: envelope.memoryScope,
            recallScope: envelope.recallScope,
            filesystemPolicyClass: envelope.filesystemPolicyClass,
            contextReleasePolicy: envelope.contextReleasePolicy,
            sessionPolicy: envelope.provenance.sessionPolicy,
            warnings: envelope.provenance.warnings,
          }
        : null,
      contextReleases: contextReleases.totalReleases > 0
        ? contextReleases
        : null,
      playbooks: sortAppliedPlaybooks(playbooks),
      timeline,
      delegationSummary: null,
    };

    if (!runtimeSummary.projectId && !runtimeSummary.profileId && !runtimeSummary.execution && !runtimeSummary.contextReleases && runtimeSummary.playbooks.length === 0 && runtimeSummary.timeline.length === 0) {
      return undefined;
    }
    return runtimeSummary;
  }

  mergeReceiptRuntimeSummary(receipt: ReceiptRecord): ReceiptRecord['runtime'] | undefined {
    const derived = this.buildReceiptRuntimeSummary(receipt.runId, receipt.taskId, receipt.status);
    if (!receipt.runtime) {
      return derived;
    }
    if (!derived) {
      return receipt.runtime;
    }
    const timelineById = new Map<string, ReceiptTimelineEvent>();
    for (const event of receipt.runtime.timeline) {
      timelineById.set(event.id, event);
    }
    for (const event of derived.timeline) {
      timelineById.set(event.id, event);
    }
    const mergedTimeline = Array.from(timelineById.values()).sort((left, right) => {
      const byTime = Date.parse(left.at) - Date.parse(right.at);
      return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
    });
    const playbooksByKey = new Map<string, NonNullable<ReceiptRecord['runtime']>['playbooks'][number]>();
    for (const playbook of receipt.runtime.playbooks) {
      playbooksByKey.set(`${playbook.scope}:${playbook.id}:${playbook.revisionHash}`, playbook);
    }
    for (const playbook of derived.playbooks) {
      playbooksByKey.set(`${playbook.scope}:${playbook.id}:${playbook.revisionHash}`, playbook);
    }
    return {
      projectId: receipt.runtime.projectId ?? derived.projectId ?? null,
      profileId: receipt.runtime.profileId ?? derived.profileId ?? null,
      execution: receipt.runtime.execution ?? derived.execution ?? null,
      contextReleases: receipt.runtime.contextReleases ?? derived.contextReleases ?? null,
      playbooks: sortAppliedPlaybooks(Array.from(playbooksByKey.values())),
      timeline: mergedTimeline,
      delegationSummary: receipt.runtime.delegationSummary ?? derived.delegationSummary ?? null,
    };
  }

  enrichReceipt(receipt: ReceiptRecord | null): ReceiptRecord | null {
    if (!receipt) return null;
    const runtime = this.mergeReceiptRuntimeSummary(receipt);
    return {
      ...receipt,
      ...(runtime !== undefined ? { runtime } : {}),
    };
  }
}
