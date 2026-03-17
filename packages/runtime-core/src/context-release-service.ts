import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';
import {
  type ContextReleaseDecision,
  type ContextReleasePreview,
  type DomainKind,
  DOMAIN_POLICY_DEFAULTS,
  nowIso,
} from '@popeye/contracts';

export class ContextReleaseService {
  constructor(
    private readonly db: Database.Database,
    private readonly log: { info: Function; warn: Function; error: Function },
    private readonly auditCallback: (event: {
      eventType: string;
      details: Record<string, unknown>;
      severity: string;
    }) => void,
  ) {}

  recordRelease(input: {
    domain: DomainKind;
    vaultId?: string;
    sourceRef: string;
    releaseLevel: string;
    approvalId?: string;
    runId?: string;
    tokenEstimate?: number;
    redacted?: boolean;
  }): ContextReleaseDecision {
    const id = randomUUID();
    const now = nowIso();

    this.db
      .prepare(
        `INSERT INTO context_releases (id, domain, vault_id, source_ref, release_level, approval_id, run_id, token_estimate, redacted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.domain,
        input.vaultId ?? null,
        input.sourceRef,
        input.releaseLevel,
        input.approvalId ?? null,
        input.runId ?? null,
        input.tokenEstimate ?? 0,
        input.redacted ? 1 : 0,
        now,
      );

    this.auditCallback({
      eventType: 'context_released',
      details: {
        releaseId: id,
        domain: input.domain,
        releaseLevel: input.releaseLevel,
        runId: input.runId ?? null,
      },
      severity: 'info',
    });
    this.log.info(
      { releaseId: id, domain: input.domain, releaseLevel: input.releaseLevel },
      'context released',
    );

    return {
      id,
      domain: input.domain,
      vaultId: input.vaultId ?? null,
      sourceRef: input.sourceRef,
      releaseLevel: input.releaseLevel as ContextReleaseDecision['releaseLevel'],
      approvalId: input.approvalId ?? null,
      runId: input.runId ?? null,
      tokenEstimate: input.tokenEstimate ?? 0,
      redacted: input.redacted ?? false,
      createdAt: now,
    };
  }

  listReleasesForRun(runId: string): ContextReleaseDecision[] {
    const rows = this.db
      .prepare('SELECT * FROM context_releases WHERE run_id = ? ORDER BY created_at')
      .all(runId) as Record<string, unknown>[];
    return rows.map(mapRow);
  }

  summarizeRunReleases(runId: string): {
    totalReleases: number;
    totalTokenEstimate: number;
    byDomain: Record<string, { count: number; tokens: number }>;
  } {
    const releases = this.listReleasesForRun(runId);
    const byDomain: Record<string, { count: number; tokens: number }> = {};
    let totalTokenEstimate = 0;

    for (const r of releases) {
      totalTokenEstimate += r.tokenEstimate;
      const entry = byDomain[r.domain] ?? { count: 0, tokens: 0 };
      entry.count++;
      entry.tokens += r.tokenEstimate;
      byDomain[r.domain] = entry;
    }

    return { totalReleases: releases.length, totalTokenEstimate, byDomain };
  }

  previewRelease(input: {
    domain: DomainKind;
    sourceRef: string;
  }): ContextReleasePreview {
    const policy = DOMAIN_POLICY_DEFAULTS[input.domain];
    const requiresApproval = policy.sensitivity === 'restricted';

    return {
      domain: input.domain,
      sourceRef: input.sourceRef,
      releaseLevel: policy.contextReleasePolicy,
      previewText: `[${input.domain}] ${input.sourceRef}`,
      tokenEstimate: 0,
      requiresApproval,
      redactionApplied: false,
    };
  }
}

function mapRow(row: Record<string, unknown>): ContextReleaseDecision {
  return {
    id: row.id as string,
    domain: row.domain as DomainKind,
    vaultId: (row.vault_id as string) ?? null,
    sourceRef: row.source_ref as string,
    releaseLevel: row.release_level as ContextReleaseDecision['releaseLevel'],
    approvalId: (row.approval_id as string) ?? null,
    runId: (row.run_id as string) ?? null,
    tokenEstimate: row.token_estimate as number,
    redacted: !!(row.redacted as number),
    createdAt: row.created_at as string,
  };
}
