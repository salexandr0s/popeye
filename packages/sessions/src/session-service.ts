import { randomUUID } from 'node:crypto';
import type { InterventionRecord, SessionRootRecord } from '@popeye/contracts';
import { nowIso } from '@popeye/contracts';
import type { SessionDeps } from './types.js';
import { mapInterventionRow, mapSessionRootRow } from './row-mappers.js';

export class SessionService {
  constructor(private readonly deps: SessionDeps) {}

  listSessionRoots(): Array<{ id: string; kind: string; scope: string; createdAt: string }> {
    return this.deps.app
      .prepare('SELECT * FROM session_roots ORDER BY created_at ASC')
      .all()
      .map((row) => mapSessionRootRow(row));
  }

  ensureSessionRoot(root: SessionRootRecord): void {
    this.deps.app.prepare('INSERT OR IGNORE INTO session_roots (id, kind, scope, created_at) VALUES (?, ?, ?, ?)').run(root.id, root.kind, root.scope, root.createdAt);
  }

  listInterventions(): InterventionRecord[] {
    return this.deps.app
      .prepare('SELECT * FROM interventions ORDER BY created_at DESC')
      .all()
      .map((row) => mapInterventionRow(row));
  }

  createIntervention(code: InterventionRecord['code'], runId: string | null, reason: string): InterventionRecord {
    const intervention: InterventionRecord = {
      id: randomUUID(),
      code,
      runId,
      status: 'open',
      reason,
      createdAt: nowIso(),
      resolvedAt: null,
    };
    this.deps.app.prepare('INSERT INTO interventions (id, code, run_id, status, reason, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      intervention.id,
      intervention.code,
      intervention.runId,
      intervention.status,
      intervention.reason,
      intervention.createdAt,
      intervention.resolvedAt,
    );
    return intervention;
  }

  getIntervention(interventionId: string): InterventionRecord | null {
    const row = this.deps.app.prepare('SELECT * FROM interventions WHERE id = ?').get(interventionId);
    return row ? mapInterventionRow(row) : null;
  }

  resolveIntervention(interventionId: string): InterventionRecord | null {
    this.deps.app.prepare('UPDATE interventions SET status = ?, resolved_at = ? WHERE id = ?').run('resolved', nowIso(), interventionId);
    return this.getIntervention(interventionId);
  }
}
