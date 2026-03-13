import type {
  AgentProfileRecord,
  AppConfig,
  CompiledInstructionBundle,
  DaemonStateRecord,
  DaemonStatusResponse,
  InterventionRecord,
  ProjectRecord,
  SchedulerStatusResponse,
  WorkspaceRecord,
} from '@popeye/contracts';
import {
  AgentProfileRecordSchema,
  CompiledInstructionBundleSchema,
  ProjectRecordSchema,
  WorkspaceRecordSchema,
} from '@popeye/contracts';
import { compileInstructionBundle, resolveInstructionSources, type ResolverDependencies } from '@popeye/instructions';

import { readAuthStore, issueCsrfToken as issueCsrfTokenFromStore } from './auth.js';
import type { RuntimeDatabases } from './database.js';
import { nowIso } from './clock.js';

export interface QueryServiceState {
  schedulerRunning: boolean;
  activeRunsCount: number;
  startedAt: string;
  lastSchedulerTickAt: string | null;
  lastLeaseSweepAt: string | null;
  computeNextHeartbeatDueAt(): string | null;
}

export class QueryService {
  constructor(
    private readonly databases: RuntimeDatabases,
    private readonly config: AppConfig,
    private readonly state: QueryServiceState,
  ) {}

  getStatus(): DaemonStatusResponse {
    const runningJobs = this.databases.app.prepare(`SELECT COUNT(*) AS count FROM jobs WHERE status = 'running'`).get() as { count: number };
    const queuedJobs = this.databases.app.prepare(`SELECT COUNT(*) AS count FROM jobs WHERE status = 'queued'`).get() as { count: number };
    const openInterventions = this.databases.app.prepare(`SELECT COUNT(*) AS count FROM interventions WHERE status = 'open'`).get() as { count: number };
    const activeLeases = this.databases.app.prepare('SELECT COUNT(*) AS count FROM job_leases').get() as { count: number };
    const daemonState = this.databases.app.prepare('SELECT last_shutdown_at FROM daemon_state WHERE id = 1').get() as { last_shutdown_at: string | null } | undefined;
    return {
      ok: true,
      runningJobs: runningJobs.count,
      queuedJobs: queuedJobs.count,
      openInterventions: openInterventions.count,
      activeLeases: activeLeases.count,
      engineKind: this.config.engine.kind,
      schedulerRunning: this.state.schedulerRunning,
      startedAt: this.state.startedAt,
      lastShutdownAt: daemonState?.last_shutdown_at ?? null,
    };
  }

  getDaemonState(): DaemonStateRecord {
    const daemonState = this.databases.app.prepare('SELECT last_shutdown_at FROM daemon_state WHERE id = 1').get() as { last_shutdown_at: string | null } | undefined;
    return {
      schedulerRunning: this.state.schedulerRunning,
      activeWorkers: this.state.activeRunsCount,
      lastSchedulerTickAt: this.state.lastSchedulerTickAt,
      lastLeaseSweepAt: this.state.lastLeaseSweepAt,
      lastShutdownAt: daemonState?.last_shutdown_at ?? null,
    };
  }

  getSchedulerStatus(): SchedulerStatusResponse {
    const activeLeases = this.databases.app.prepare('SELECT COUNT(*) AS count FROM job_leases').get() as { count: number };
    const nextHeartbeatDueAt = this.state.computeNextHeartbeatDueAt();
    return {
      running: this.state.schedulerRunning,
      activeLeases: activeLeases.count,
      activeRuns: this.state.activeRunsCount,
      nextHeartbeatDueAt,
    };
  }

  listWorkspaces(): WorkspaceRecord[] {
    const rows = this.databases.app.prepare('SELECT * FROM workspaces ORDER BY created_at ASC').all() as Array<Record<string, string | null>>;
    return rows.map((row) => WorkspaceRecordSchema.parse({ id: row.id, name: row.name, rootPath: row.root_path ?? null, createdAt: row.created_at }));
  }

  getWorkspace(id: string): WorkspaceRecord | null {
    const row = this.databases.app.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as Record<string, string | null> | undefined;
    if (!row) return null;
    return WorkspaceRecordSchema.parse({ id: row.id, name: row.name, rootPath: row.root_path ?? null, createdAt: row.created_at });
  }

  listProjects(): ProjectRecord[] {
    const rows = this.databases.app.prepare('SELECT * FROM projects ORDER BY created_at ASC').all() as Array<Record<string, string | null>>;
    return rows.map((row) => ProjectRecordSchema.parse({ id: row.id, workspaceId: row.workspace_id, name: row.name, path: row.path ?? null, createdAt: row.created_at }));
  }

  getProject(id: string): ProjectRecord | null {
    const row = this.databases.app.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, string | null> | undefined;
    if (!row) return null;
    return ProjectRecordSchema.parse({ id: row.id, workspaceId: row.workspace_id, name: row.name, path: row.path ?? null, createdAt: row.created_at });
  }

  listAgentProfiles(): AgentProfileRecord[] {
    const rows = this.databases.app.prepare('SELECT * FROM agent_profiles ORDER BY created_at ASC').all() as Array<Record<string, string>>;
    return rows.map((row) => AgentProfileRecordSchema.parse({ id: row.id, name: row.name, createdAt: row.created_at }));
  }

  listSessionRoots(): Array<{ id: string; kind: string; scope: string; createdAt: string }> {
    return (this.databases.app.prepare('SELECT * FROM session_roots ORDER BY created_at ASC')
      .all() as Array<Record<string, string>>)
      .map((row) => ({ id: row.id, kind: row.kind, scope: row.scope, createdAt: row.created_at }));
  }

  getInstructionPreview(scope: string): CompiledInstructionBundle {
    const context = { workspaceId: scope, identity: 'default' };
    const sources = resolveInstructionSources(context, this.buildResolverDependencies());
    const bundle = compileInstructionBundle(sources);
    this.databases.app.prepare('INSERT INTO instruction_snapshots (id, scope, bundle_json, created_at) VALUES (?, ?, ?, ?)').run(bundle.id, scope, JSON.stringify(bundle), bundle.createdAt);
    return CompiledInstructionBundleSchema.parse(bundle);
  }

  resolveInstructionsForRun(task: { workspaceId: string; projectId: string | null; prompt: string }): CompiledInstructionBundle {
    const context = { workspaceId: task.workspaceId, projectId: task.projectId ?? undefined, taskBrief: task.prompt };
    const sources = resolveInstructionSources(context, this.buildResolverDependencies());
    const bundle = compileInstructionBundle(sources);
    this.databases.app.prepare('INSERT INTO instruction_snapshots (id, scope, bundle_json, created_at) VALUES (?, ?, ?, ?)').run(bundle.id, task.workspaceId, JSON.stringify(bundle), bundle.createdAt);
    return CompiledInstructionBundleSchema.parse(bundle);
  }

  private buildResolverDependencies(): ResolverDependencies {
    return {
      getWorkspace: (id) => {
        const ws = this.getWorkspace(id);
        if (!ws) return null;
        return { id: ws.id, name: ws.name, rootPath: ws.rootPath };
      },
      getProject: (id) => {
        const proj = this.getProject(id);
        if (!proj) return null;
        return { id: proj.id, name: proj.name, path: proj.path, workspaceId: proj.workspaceId };
      },
      getPopeyeBaseInstructions: () => null,
      getGlobalOperatorInstructions: () => null,
    };
  }

  listInterventions(): InterventionRecord[] {
    const rows = this.databases.app.prepare('SELECT * FROM interventions ORDER BY created_at DESC').all() as Array<Record<string, string | null>>;
    return rows.map((row) => ({
      id: String(row.id),
      code: row.code as InterventionRecord['code'],
      runId: row.run_id ? String(row.run_id) : null,
      status: row.status as InterventionRecord['status'],
      reason: String(row.reason),
      createdAt: String(row.created_at),
      resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
    }));
  }

  resolveIntervention(interventionId: string): InterventionRecord | null {
    this.databases.app.prepare('UPDATE interventions SET status = ?, resolved_at = ? WHERE id = ?').run('resolved', nowIso(), interventionId);
    return this.listInterventions().find((intervention) => intervention.id === interventionId) ?? null;
  }

  getSecurityAuditFindings(): Array<{ code: string; severity: string; message: string }> {
    return this.databases.app.prepare('SELECT code, severity, message FROM security_audit ORDER BY timestamp DESC').all() as Array<{ code: string; severity: string; message: string }>;
  }

  issueCsrfToken(): string {
    return issueCsrfTokenFromStore(readAuthStore(this.config.authFile));
  }
}
