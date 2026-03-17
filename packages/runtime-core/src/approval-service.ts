import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';
import { type ApprovalRecord, type ApprovalResolveInput, nowIso } from '@popeye/contracts';

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

export class ApprovalService {
  constructor(
    private readonly db: Database.Database,
    private readonly log: ApprovalLog,
    private readonly auditCallback: (event: ApprovalAuditEvent) => void,
    private readonly emitCallback: (event: string, data: unknown) => void,
    private readonly config: { pendingExpiryMinutes: number },
  ) {}

  requestApproval(input: {
    scope: string;
    domain: string;
    riskClass: string;
    resourceType: string;
    resourceId: string;
    requestedBy: string;
    payloadPreview?: string;
    idempotencyKey?: string;
    expiresAt?: string;
  }): ApprovalRecord {
    // Check idempotency key first
    if (input.idempotencyKey) {
      const existing = this.db
        .prepare('SELECT * FROM approvals WHERE idempotency_key = ?')
        .get(input.idempotencyKey) as Record<string, unknown> | undefined;
      if (existing) return this.mapRow(existing);
    }

    const id = randomUUID();
    const now = nowIso();
    const expiresAt = input.expiresAt ?? new Date(Date.now() + this.config.pendingExpiryMinutes * 60_000).toISOString();

    // Create linked intervention if riskClass is 'ask'
    let interventionId: string | null = null;
    if (input.riskClass === 'ask') {
      interventionId = randomUUID();
      this.db
        .prepare(
          `INSERT INTO interventions (id, run_id, code, status, reason, created_at)
           VALUES (?, NULL, ?, 'pending', ?, ?)`,
        )
        .run(
          interventionId,
          'needs_policy_decision',
          `Approval needed: ${input.scope} for ${input.resourceType}/${input.resourceId}`,
          now,
        );
    }

    this.db
      .prepare(
        `INSERT INTO approvals (id, scope, domain, risk_class, resource_type, resource_id, requested_by, intervention_id, payload_preview, idempotency_key, status, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(
        id,
        input.scope,
        input.domain,
        input.riskClass,
        input.resourceType,
        input.resourceId,
        input.requestedBy,
        interventionId,
        input.payloadPreview ?? '',
        input.idempotencyKey ?? null,
        expiresAt,
        now,
      );

    // Auto-approve if riskClass is 'auto'
    if (input.riskClass === 'auto') {
      return this.resolveApproval(id, { decision: 'approved', decisionReason: 'Auto-approved by policy' });
    }

    this.auditCallback({
      eventType: 'approval_requested',
      details: { approvalId: id, scope: input.scope, domain: input.domain },
      severity: 'info',
    });
    this.emitCallback('approval_requested', { id, scope: input.scope });
    this.log.info('approval requested', { approvalId: id, scope: input.scope });

    return this.getApproval(id)!;
  }

  resolveApproval(id: string, input: ApprovalResolveInput): ApprovalRecord {
    const approval = this.getApproval(id);
    if (!approval) throw new Error(`Approval ${id} not found`);
    if (approval.status !== 'pending') throw new Error(`Approval ${id} already resolved: ${approval.status}`);

    const now = nowIso();
    const resolvedBy = input.decision === 'approved' && approval.riskClass === 'auto' ? 'policy' : 'operator';

    this.db
      .prepare('UPDATE approvals SET status = ?, resolved_by = ?, decision_reason = ?, resolved_at = ? WHERE id = ?')
      .run(input.decision, resolvedBy, input.decisionReason ?? null, now, id);

    // Resolve linked intervention
    if (approval.interventionId) {
      this.db
        .prepare("UPDATE interventions SET status = 'resolved', resolved_at = ?, resolution_note = ?, updated_at = ? WHERE id = ?")
        .run(now, `Approval ${input.decision}: ${input.decisionReason ?? ''}`, now, approval.interventionId);
    }

    this.auditCallback({
      eventType: 'approval_resolved',
      details: { approvalId: id, decision: input.decision },
      severity: 'info',
    });
    this.emitCallback('approval_resolved', { id, decision: input.decision });
    this.log.info('approval resolved', { approvalId: id, decision: input.decision });

    return this.getApproval(id)!;
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

  listApprovals(filter?: { scope?: string; status?: string; domain?: string }): ApprovalRecord[] {
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

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM approvals ${where}`).all(...params) as Record<string, unknown>[];
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

  expireStaleApprovals(): number {
    const now = nowIso();
    const result = this.db
      .prepare("UPDATE approvals SET status = 'expired', resolved_by = 'expiry', resolved_at = ? WHERE status = 'pending' AND expires_at < ?")
      .run(now, now);
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

  private mapRow(row: Record<string, unknown>): ApprovalRecord {
    return {
      id: row['id'] as string,
      scope: row['scope'] as ApprovalRecord['scope'],
      domain: row['domain'] as ApprovalRecord['domain'],
      riskClass: row['risk_class'] as ApprovalRecord['riskClass'],
      resourceType: row['resource_type'] as string,
      resourceId: row['resource_id'] as string,
      requestedBy: row['requested_by'] as string,
      interventionId: (row['intervention_id'] as string) ?? null,
      payloadPreview: (row['payload_preview'] as string) ?? '',
      idempotencyKey: (row['idempotency_key'] as string) ?? null,
      status: row['status'] as ApprovalRecord['status'],
      resolvedBy: (row['resolved_by'] as ApprovalRecord['resolvedBy']) ?? null,
      decisionReason: (row['decision_reason'] as string) ?? null,
      expiresAt: (row['expires_at'] as string) ?? null,
      createdAt: row['created_at'] as string,
      resolvedAt: (row['resolved_at'] as string) ?? null,
    };
  }
}
