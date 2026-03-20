import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';
import {
  ApprovalRequestInputSchema,
  type ApprovalRecord,
  type ApprovalResolveInput,
  type ApprovalRequestInput,
  type StandingApprovalRecord,
  type StandingApprovalCreateInput,
  type AutomationGrantRecord,
  type AutomationGrantCreateInput,
  type PolicyGrantRevokeInput,
  type TaskSource,
  nowIso,
} from '@popeye/contracts';

interface ApprovalAuditEvent {
  eventType: string;
  details: Record<string, unknown>;
  severity: 'info' | 'warning' | 'error';
}

interface ApprovalLog {
  info: (msg: string, details?: Record<string, unknown>) => void;
  warn: (msg: string, details?: Record<string, unknown>) => void;
  error: (msg: string, details?: Record<string, unknown>) => void;
}

interface RunApprovalContext {
  workspaceId: string;
  projectId: string | null;
  taskSource: TaskSource;
}

interface GrantMatch {
  kind: 'standing_approval' | 'automation_grant';
  id: string;
  reason: string;
}

interface PolicyGrantFilter {
  status?: string;
  domain?: string;
  actionKind?: string;
}

export class ApprovalService {
  constructor(
    private readonly db: Database.Database,
    private readonly log: ApprovalLog,
    private readonly auditCallback: (event: ApprovalAuditEvent) => void,
    private readonly emitCallback: (event: string, data: unknown) => void,
    private readonly config: { pendingExpiryMinutes: number },
  ) {}

  requestApproval(input: ApprovalRequestInput): ApprovalRecord {
    const parsed = ApprovalRequestInputSchema.parse(input);
    this.expireStalePolicyGrants();

    if (parsed.idempotencyKey) {
      const existing = this.db
        .prepare('SELECT * FROM approvals WHERE idempotency_key = ?')
        .get(parsed.idempotencyKey) as Record<string, unknown> | undefined;
      if (existing) return this.mapRow(existing);
    }

    const id = randomUUID();
    const now = nowIso();
    const expiresAt = parsed.expiresAt ?? new Date(Date.now() + this.config.pendingExpiryMinutes * 60_000).toISOString();
    const grantMatch = parsed.riskClass === 'ask' ? this.findGrantMatch(parsed) : null;
    const shouldCreateIntervention = parsed.riskClass === 'ask' && !grantMatch;

    let interventionId: string | null = null;
    if (shouldCreateIntervention) {
      interventionId = randomUUID();
      this.db
        .prepare(
          `INSERT INTO interventions (id, run_id, code, status, reason, created_at)
           VALUES (?, ?, ?, 'pending', ?, ?)`,
        )
        .run(
          interventionId,
          parsed.runId ?? null,
          'needs_policy_decision',
          `Approval needed: ${parsed.scope} for ${parsed.resourceType}/${parsed.resourceId}`,
          now,
        );
    }

    this.db
      .prepare(
        `INSERT INTO approvals (
          id, scope, domain, risk_class, action_kind, resource_scope, resource_type, resource_id,
          requested_by, run_id, standing_approval_eligible, automation_grant_eligible, intervention_id,
          payload_preview, idempotency_key, status, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(
        id,
        parsed.scope,
        parsed.domain,
        parsed.riskClass,
        parsed.actionKind,
        parsed.resourceScope,
        parsed.resourceType,
        parsed.resourceId,
        parsed.requestedBy,
        parsed.runId ?? null,
        parsed.standingApprovalEligible ? 1 : 0,
        parsed.automationGrantEligible ? 1 : 0,
        interventionId,
        parsed.payloadPreview ?? '',
        parsed.idempotencyKey ?? null,
        expiresAt,
        now,
      );

    if (parsed.riskClass === 'auto') {
      return this.resolveApprovalInternal(id, { decision: 'approved', decisionReason: 'Auto-approved by policy' }, { resolvedBy: 'policy' });
    }
    if (parsed.riskClass === 'deny') {
      return this.resolveApprovalInternal(id, { decision: 'denied', decisionReason: 'Denied by policy' }, { resolvedBy: 'policy' });
    }
    if (grantMatch) {
      return this.resolveApprovalInternal(
        id,
        { decision: 'approved', decisionReason: grantMatch.reason },
        { resolvedBy: grantMatch.kind, resolvedByGrantId: grantMatch.id },
      );
    }

    this.auditCallback({
      eventType: 'approval_requested',
      details: {
        approvalId: id,
        scope: parsed.scope,
        domain: parsed.domain,
        actionKind: parsed.actionKind,
        runId: parsed.runId ?? '',
      },
      severity: 'info',
    });
    this.emitCallback('approval_requested', { id, scope: parsed.scope, actionKind: parsed.actionKind });
    this.log.info('approval requested', { approvalId: id, scope: parsed.scope, actionKind: parsed.actionKind });

    return this.getApproval(id)!;
  }

  resolveApproval(id: string, input: ApprovalResolveInput): ApprovalRecord {
    return this.resolveApprovalInternal(id, input, { resolvedBy: 'operator' });
  }

  getApproval(id: string): ApprovalRecord | null {
    const row = this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  getApprovalByIntervention(interventionId: string): ApprovalRecord | null {
    const row = this.db
      .prepare('SELECT * FROM approvals WHERE intervention_id = ?')
      .get(interventionId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  listApprovals(filter?: { scope?: string; status?: string; domain?: string; actionKind?: string; runId?: string; resolvedBy?: string }): ApprovalRecord[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.scope) {
      conditions.push('scope = ?');
      params.push(filter.scope);
    }
    if (filter?.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter?.domain) {
      conditions.push('domain = ?');
      params.push(filter.domain);
    }
    if (filter?.actionKind) {
      conditions.push('action_kind = ?');
      params.push(filter.actionKind);
    }
    if (filter?.runId) {
      conditions.push('run_id = ?');
      params.push(filter.runId);
    }
    if (filter?.resolvedBy) {
      conditions.push('resolved_by = ?');
      params.push(filter.resolvedBy);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM approvals ${where} ORDER BY created_at DESC`).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  hasActiveApproval(scope: string, resourceType: string, resourceId: string): boolean {
    const row = this.db
      .prepare(
        "SELECT 1 FROM approvals WHERE scope = ? AND resource_type = ? AND resource_id = ? AND status IN ('pending', 'approved')",
      )
      .get(scope, resourceType, resourceId);
    return !!row;
  }

  createStandingApproval(input: StandingApprovalCreateInput): StandingApprovalRecord {
    this.expireStalePolicyGrants();
    const id = randomUUID();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO standing_approvals (
          id, scope, domain, action_kind, resource_scope, resource_type, resource_id, requested_by,
          workspace_id, project_id, note, created_by, status, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
      .run(
        id,
        input.scope,
        input.domain,
        input.actionKind,
        input.resourceScope,
        input.resourceType,
        input.resourceId ?? null,
        input.requestedBy ?? null,
        input.workspaceId ?? null,
        input.projectId ?? null,
        input.note ?? '',
        input.createdBy,
        input.expiresAt ?? null,
        now,
      );
    const record = this.getStandingApproval(id)!;
    this.auditCallback({
      eventType: 'standing_approval_created',
      details: { standingApprovalId: id, scope: input.scope, domain: input.domain, actionKind: input.actionKind },
      severity: 'info',
    });
    this.emitCallback('standing_approval_created', { id, scope: input.scope, actionKind: input.actionKind });
    this.log.info('standing approval created', { standingApprovalId: id, actionKind: input.actionKind });
    return record;
  }

  listStandingApprovals(filter?: PolicyGrantFilter): StandingApprovalRecord[] {
    this.expireStalePolicyGrants();
    const rows = this.listPolicyGrantRows('standing_approvals', filter);
    return rows.map((row) => this.mapStandingApprovalRow(row));
  }

  revokeStandingApproval(id: string, input: PolicyGrantRevokeInput): StandingApprovalRecord {
    this.expireStalePolicyGrants();
    const existing = this.getStandingApproval(id);
    if (!existing) throw new Error(`Standing approval ${id} not found`);
    if (existing.status === 'active') {
      this.db
        .prepare("UPDATE standing_approvals SET status = 'revoked', revoked_at = ?, revoked_by = ? WHERE id = ?")
        .run(nowIso(), input.revokedBy, id);
      this.auditCallback({
        eventType: 'standing_approval_revoked',
        details: { standingApprovalId: id, revokedBy: input.revokedBy },
        severity: 'info',
      });
      this.emitCallback('standing_approval_revoked', { id });
      this.log.info('standing approval revoked', { standingApprovalId: id, revokedBy: input.revokedBy });
    }
    return this.getStandingApproval(id)!;
  }

  createAutomationGrant(input: AutomationGrantCreateInput): AutomationGrantRecord {
    this.expireStalePolicyGrants();
    const id = randomUUID();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO automation_grants (
          id, scope, domain, action_kind, resource_scope, resource_type, resource_id, requested_by,
          workspace_id, project_id, task_sources_json, note, created_by, status, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
      .run(
        id,
        input.scope,
        input.domain,
        input.actionKind,
        input.resourceScope,
        input.resourceType,
        input.resourceId ?? null,
        input.requestedBy ?? null,
        input.workspaceId ?? null,
        input.projectId ?? null,
        JSON.stringify(input.taskSources ?? ['heartbeat', 'schedule']),
        input.note ?? '',
        input.createdBy,
        input.expiresAt ?? null,
        now,
      );
    const record = this.getAutomationGrant(id)!;
    this.auditCallback({
      eventType: 'automation_grant_created',
      details: { automationGrantId: id, scope: input.scope, domain: input.domain, actionKind: input.actionKind },
      severity: 'info',
    });
    this.emitCallback('automation_grant_created', { id, scope: input.scope, actionKind: input.actionKind });
    this.log.info('automation grant created', { automationGrantId: id, actionKind: input.actionKind });
    return record;
  }

  listAutomationGrants(filter?: PolicyGrantFilter): AutomationGrantRecord[] {
    this.expireStalePolicyGrants();
    const rows = this.listPolicyGrantRows('automation_grants', filter);
    return rows.map((row) => this.mapAutomationGrantRow(row));
  }

  revokeAutomationGrant(id: string, input: PolicyGrantRevokeInput): AutomationGrantRecord {
    this.expireStalePolicyGrants();
    const existing = this.getAutomationGrant(id);
    if (!existing) throw new Error(`Automation grant ${id} not found`);
    if (existing.status === 'active') {
      this.db
        .prepare("UPDATE automation_grants SET status = 'revoked', revoked_at = ?, revoked_by = ? WHERE id = ?")
        .run(nowIso(), input.revokedBy, id);
      this.auditCallback({
        eventType: 'automation_grant_revoked',
        details: { automationGrantId: id, revokedBy: input.revokedBy },
        severity: 'info',
      });
      this.emitCallback('automation_grant_revoked', { id });
      this.log.info('automation grant revoked', { automationGrantId: id, revokedBy: input.revokedBy });
    }
    return this.getAutomationGrant(id)!;
  }

  expireStaleApprovals(): number {
    const now = nowIso();
    const result = this.db
      .prepare("UPDATE approvals SET status = 'expired', resolved_by = 'expiry', resolved_at = ? WHERE status = 'pending' AND expires_at < ?")
      .run(now, now);
    this.expireStalePolicyGrants(now);
    if (result.changes > 0) {
      this.auditCallback({
        eventType: 'approvals_expired',
        details: { count: result.changes },
        severity: 'info',
      });
      this.log.info('stale approvals expired', { count: result.changes });
    }
    return result.changes;
  }

  private resolveApprovalInternal(
    id: string,
    input: ApprovalResolveInput,
    options: { resolvedBy: ApprovalRecord['resolvedBy']; resolvedByGrantId?: string | null },
  ): ApprovalRecord {
    const approval = this.getApproval(id);
    if (!approval) throw new Error(`Approval ${id} not found`);
    if (approval.status !== 'pending') throw new Error(`Approval ${id} already resolved: ${approval.status}`);

    const now = nowIso();
    this.db
      .prepare(
        'UPDATE approvals SET status = ?, resolved_by = ?, resolved_by_grant_id = ?, decision_reason = ?, resolved_at = ? WHERE id = ?',
      )
      .run(input.decision, options.resolvedBy, options.resolvedByGrantId ?? null, input.decisionReason ?? null, now, id);

    if (approval.interventionId) {
      this.db
        .prepare("UPDATE interventions SET status = 'resolved', resolved_at = ?, resolution_note = ?, updated_at = ? WHERE id = ?")
        .run(now, `Approval ${input.decision}: ${input.decisionReason ?? ''}`, now, approval.interventionId);
    }

    this.auditCallback({
      eventType: 'approval_resolved',
      details: {
        approvalId: id,
        decision: input.decision,
        resolvedBy: options.resolvedBy ?? '',
        resolvedByGrantId: options.resolvedByGrantId ?? '',
      },
      severity: 'info',
    });
    this.emitCallback('approval_resolved', { id, decision: input.decision, resolvedBy: options.resolvedBy });
    this.log.info('approval resolved', { approvalId: id, decision: input.decision, resolvedBy: options.resolvedBy });

    return this.getApproval(id)!;
  }

  private getStandingApproval(id: string): StandingApprovalRecord | null {
    const row = this.db.prepare('SELECT * FROM standing_approvals WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapStandingApprovalRow(row) : null;
  }

  private getAutomationGrant(id: string): AutomationGrantRecord | null {
    const row = this.db.prepare('SELECT * FROM automation_grants WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapAutomationGrantRow(row) : null;
  }

  private listPolicyGrantRows(table: 'standing_approvals' | 'automation_grants', filter?: PolicyGrantFilter): Record<string, unknown>[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter?.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter?.domain) {
      conditions.push('domain = ?');
      params.push(filter.domain);
    }
    if (filter?.actionKind) {
      conditions.push('action_kind = ?');
      params.push(filter.actionKind);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return this.db.prepare(`SELECT * FROM ${table} ${where} ORDER BY created_at DESC`).all(...params) as Record<string, unknown>[];
  }

  private findGrantMatch(input: ApprovalRequestInput): GrantMatch | null {
    if (input.standingApprovalEligible) {
      const standing = this.findMatchingStandingApproval(input);
      if (standing) {
        return {
          kind: 'standing_approval',
          id: standing.id,
          reason: `Approved by standing approval ${standing.id}`,
        };
      }
    }
    if (input.automationGrantEligible) {
      const automation = this.findMatchingAutomationGrant(input);
      if (automation) {
        return {
          kind: 'automation_grant',
          id: automation.id,
          reason: `Approved by automation grant ${automation.id}`,
        };
      }
    }
    return null;
  }

  private findMatchingStandingApproval(input: ApprovalRequestInput): StandingApprovalRecord | null {
    const rows = this.db
      .prepare(
        `SELECT * FROM standing_approvals
         WHERE status = 'active' AND scope = ? AND domain = ? AND action_kind = ? AND resource_type = ?
         ORDER BY created_at DESC`,
      )
      .all(input.scope, input.domain, input.actionKind, input.resourceType) as Record<string, unknown>[];
    const runContext = this.getRunApprovalContext(input.runId ?? null);
    for (const row of rows) {
      const record = this.mapStandingApprovalRow(row);
      if (this.matchesGrantRecord(record, input, runContext)) {
        return record;
      }
    }
    return null;
  }

  private findMatchingAutomationGrant(input: ApprovalRequestInput): AutomationGrantRecord | null {
    const runContext = this.getRunApprovalContext(input.runId ?? null);
    if (!runContext) return null;
    const rows = this.db
      .prepare(
        `SELECT * FROM automation_grants
         WHERE status = 'active' AND scope = ? AND domain = ? AND action_kind = ? AND resource_type = ?
         ORDER BY created_at DESC`,
      )
      .all(input.scope, input.domain, input.actionKind, input.resourceType) as Record<string, unknown>[];
    for (const row of rows) {
      const record = this.mapAutomationGrantRow(row);
      if (!record.taskSources.includes(runContext.taskSource)) continue;
      if (this.matchesGrantRecord(record, input, runContext)) {
        return record;
      }
    }
    return null;
  }

  private matchesGrantRecord(
    record: {
      resourceScope: StandingApprovalRecord['resourceScope'];
      resourceId: string | null;
      requestedBy: string | null;
      workspaceId: string | null;
      projectId: string | null;
      expiresAt: string | null;
    },
    input: ApprovalRequestInput,
    runContext: RunApprovalContext | null,
  ): boolean {
    if (record.resourceScope !== 'global' && record.resourceScope !== input.resourceScope) return false;
    if (record.resourceId && record.resourceId !== input.resourceId) return false;
    if (record.requestedBy && record.requestedBy !== input.requestedBy) return false;
    if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) return false;
    if (record.workspaceId) {
      if (!runContext || record.workspaceId !== runContext.workspaceId) return false;
    }
    if (record.projectId) {
      if (!runContext || record.projectId !== runContext.projectId) return false;
    }
    return true;
  }

  private getRunApprovalContext(runId: string | null): RunApprovalContext | null {
    if (!runId) return null;
    const row = this.db
      .prepare(
        `SELECT r.workspace_id AS workspace_id, t.project_id AS project_id, t.source AS task_source
         FROM runs r
         JOIN tasks t ON t.id = r.task_id
         WHERE r.id = ?`,
      )
      .get(runId) as { workspace_id: string; project_id: string | null; task_source: TaskSource } | undefined;
    if (!row) return null;
    return {
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      taskSource: row.task_source,
    };
  }

  private expireStalePolicyGrants(now = nowIso()): void {
    const standing = this.db
      .prepare("UPDATE standing_approvals SET status = 'expired' WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < ?")
      .run(now);
    const automation = this.db
      .prepare("UPDATE automation_grants SET status = 'expired' WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < ?")
      .run(now);
    const count = standing.changes + automation.changes;
    if (count > 0) {
      this.auditCallback({
        eventType: 'policy_grants_expired',
        details: { count },
        severity: 'info',
      });
      this.log.info('policy grants expired', { count });
    }
  }

  private mapRow(row: Record<string, unknown>): ApprovalRecord {
    return {
      id: row['id'] as string,
      scope: row['scope'] as ApprovalRecord['scope'],
      domain: row['domain'] as ApprovalRecord['domain'],
      riskClass: row['risk_class'] as ApprovalRecord['riskClass'],
      actionKind: (row['action_kind'] as ApprovalRecord['actionKind']) ?? 'read',
      resourceScope: (row['resource_scope'] as ApprovalRecord['resourceScope']) ?? 'resource',
      resourceType: row['resource_type'] as string,
      resourceId: row['resource_id'] as string,
      requestedBy: row['requested_by'] as string,
      runId: (row['run_id'] as string) ?? null,
      standingApprovalEligible: Boolean(row['standing_approval_eligible'] as number | undefined),
      automationGrantEligible: Boolean(row['automation_grant_eligible'] as number | undefined),
      interventionId: (row['intervention_id'] as string) ?? null,
      payloadPreview: (row['payload_preview'] as string) ?? '',
      idempotencyKey: (row['idempotency_key'] as string) ?? null,
      status: row['status'] as ApprovalRecord['status'],
      resolvedBy: (row['resolved_by'] as ApprovalRecord['resolvedBy']) ?? null,
      resolvedByGrantId: (row['resolved_by_grant_id'] as string) ?? null,
      decisionReason: (row['decision_reason'] as string) ?? null,
      expiresAt: (row['expires_at'] as string) ?? null,
      createdAt: row['created_at'] as string,
      resolvedAt: (row['resolved_at'] as string) ?? null,
    };
  }

  private mapStandingApprovalRow(row: Record<string, unknown>): StandingApprovalRecord {
    return {
      id: row['id'] as string,
      scope: row['scope'] as StandingApprovalRecord['scope'],
      domain: row['domain'] as StandingApprovalRecord['domain'],
      actionKind: row['action_kind'] as StandingApprovalRecord['actionKind'],
      resourceScope: (row['resource_scope'] as StandingApprovalRecord['resourceScope']) ?? 'resource',
      resourceType: row['resource_type'] as string,
      resourceId: (row['resource_id'] as string) ?? null,
      requestedBy: (row['requested_by'] as string) ?? null,
      workspaceId: (row['workspace_id'] as string) ?? null,
      projectId: (row['project_id'] as string) ?? null,
      note: (row['note'] as string) ?? '',
      createdBy: row['created_by'] as string,
      status: row['status'] as StandingApprovalRecord['status'],
      expiresAt: (row['expires_at'] as string) ?? null,
      createdAt: row['created_at'] as string,
      revokedAt: (row['revoked_at'] as string) ?? null,
      revokedBy: (row['revoked_by'] as string) ?? null,
    };
  }

  private mapAutomationGrantRow(row: Record<string, unknown>): AutomationGrantRecord {
    return {
      id: row['id'] as string,
      scope: row['scope'] as AutomationGrantRecord['scope'],
      domain: row['domain'] as AutomationGrantRecord['domain'],
      actionKind: row['action_kind'] as AutomationGrantRecord['actionKind'],
      resourceScope: (row['resource_scope'] as AutomationGrantRecord['resourceScope']) ?? 'resource',
      resourceType: row['resource_type'] as string,
      resourceId: (row['resource_id'] as string) ?? null,
      requestedBy: (row['requested_by'] as string) ?? null,
      workspaceId: (row['workspace_id'] as string) ?? null,
      projectId: (row['project_id'] as string) ?? null,
      taskSources: JSON.parse((row['task_sources_json'] as string) ?? '[]') as AutomationGrantRecord['taskSources'],
      note: (row['note'] as string) ?? '',
      createdBy: row['created_by'] as string,
      status: row['status'] as AutomationGrantRecord['status'],
      expiresAt: (row['expires_at'] as string) ?? null,
      createdAt: row['created_at'] as string,
      revokedAt: (row['revoked_at'] as string) ?? null,
      revokedBy: (row['revoked_by'] as string) ?? null,
    };
  }
}
