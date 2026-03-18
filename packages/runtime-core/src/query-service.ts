import type {
  AgentProfileRecord,
  AppConfig,
  CompiledInstructionBundle,
  DaemonStateRecord,
  DaemonStatusResponse,
  EngineCapabilities,
  SecurityAuditFinding,
  SchedulerStatusResponse,
} from '@popeye/contracts';
import {
  AgentProfileRecordSchema,
  DaemonStateRecordSchema,
  DaemonStatusResponseSchema,
  SchedulerStatusResponseSchema,
  SecurityAuditFindingSchema,
} from '@popeye/contracts';
import { z } from 'zod';
import type { WorkspaceRegistry } from '@popeye/workspace';

import { readAuthStore, issueCsrfToken } from './auth.js';
import type { RuntimeDatabases } from './database.js';
import { createInstructionPreview, resolveInstructionBundleForTask } from './instruction-query.js';

export interface QueryServiceState {
  schedulerRunning: boolean;
  activeRunsCount: number;
  startedAt: string;
  lastSchedulerTickAt: string | null;
  lastLeaseSweepAt: string | null;
  getEngineCapabilities(): EngineCapabilities;
  computeNextHeartbeatDueAt(): string | null;
}

const CountRowSchema = z.object({
  count: z.number().int().nonnegative(),
});

const DaemonStateRowSchema = z.object({
  last_shutdown_at: z.string().nullable(),
});

const AgentProfileRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  mode: z.string().default('interactive'),
  model_policy: z.string().default('inherit'),
  allowed_runtime_tools_json: z.string().default('[]'),
  allowed_capability_ids_json: z.string().default('[]'),
  memory_scope: z.string().default('workspace'),
  recall_scope: z.string().default('workspace'),
  filesystem_policy_class: z.string().default('workspace'),
  context_release_policy: z.string().default('summary_only'),
  created_at: z.string(),
  updated_at: z.string().nullable().default(null),
});

function parseCountRow(row: unknown): number {
  return CountRowSchema.parse(row).count;
}

function parseLastShutdownAt(row: unknown): string | null {
  const parsed = DaemonStateRowSchema.safeParse(row);
  return parsed.success ? parsed.data.last_shutdown_at : null;
}

function parseAgentProfileRow(row: unknown): AgentProfileRecord {
  const parsed = AgentProfileRowSchema.parse(row);
  return AgentProfileRecordSchema.parse({
    id: parsed.id,
    name: parsed.name,
    description: parsed.description,
    mode: parsed.mode,
    modelPolicy: parsed.model_policy,
    allowedRuntimeTools: JSON.parse(parsed.allowed_runtime_tools_json),
    allowedCapabilityIds: JSON.parse(parsed.allowed_capability_ids_json),
    memoryScope: parsed.memory_scope,
    recallScope: parsed.recall_scope,
    filesystemPolicyClass: parsed.filesystem_policy_class,
    contextReleasePolicy: parsed.context_release_policy,
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at,
  });
}

export class QueryService {
  constructor(
    private readonly databases: RuntimeDatabases,
    private readonly config: AppConfig,
    private readonly state: QueryServiceState,
    private readonly workspaceRegistry: WorkspaceRegistry,
  ) {}

  getStatus(): DaemonStatusResponse {
    const runningJobs = parseCountRow(this.databases.app.prepare(`SELECT COUNT(*) AS count FROM jobs WHERE status = 'running'`).get());
    const queuedJobs = parseCountRow(this.databases.app.prepare(`SELECT COUNT(*) AS count FROM jobs WHERE status = 'queued'`).get());
    const openInterventions = parseCountRow(this.databases.app.prepare(`SELECT COUNT(*) AS count FROM interventions WHERE status = 'open'`).get());
    const activeLeases = parseCountRow(this.databases.app.prepare('SELECT COUNT(*) AS count FROM job_leases').get());
    const lastShutdownAt = parseLastShutdownAt(this.databases.app.prepare('SELECT last_shutdown_at FROM daemon_state WHERE id = 1').get());
    return DaemonStatusResponseSchema.parse({
      ok: true,
      runningJobs,
      queuedJobs,
      openInterventions,
      activeLeases,
      engineKind: this.config.engine.kind,
      schedulerRunning: this.state.schedulerRunning,
      startedAt: this.state.startedAt,
      lastShutdownAt,
    });
  }

  getDaemonState(): DaemonStateRecord {
    const lastShutdownAt = parseLastShutdownAt(this.databases.app.prepare('SELECT last_shutdown_at FROM daemon_state WHERE id = 1').get());
    return DaemonStateRecordSchema.parse({
      schedulerRunning: this.state.schedulerRunning,
      activeWorkers: this.state.activeRunsCount,
      lastSchedulerTickAt: this.state.lastSchedulerTickAt,
      lastLeaseSweepAt: this.state.lastLeaseSweepAt,
      lastShutdownAt,
    });
  }

  getSchedulerStatus(): SchedulerStatusResponse {
    const activeLeases = parseCountRow(this.databases.app.prepare('SELECT COUNT(*) AS count FROM job_leases').get());
    const nextHeartbeatDueAt = this.state.computeNextHeartbeatDueAt();
    return SchedulerStatusResponseSchema.parse({
      running: this.state.schedulerRunning,
      activeLeases,
      activeRuns: this.state.activeRunsCount,
      nextHeartbeatDueAt,
    });
  }

  getEngineCapabilities(): EngineCapabilities {
    return this.state.getEngineCapabilities();
  }

  listAgentProfiles(): AgentProfileRecord[] {
    const rows = this.databases.app.prepare('SELECT * FROM agent_profiles ORDER BY created_at ASC').all();
    return rows.map((row) => parseAgentProfileRow(row));
  }

  getAgentProfile(profileId: string): AgentProfileRecord | null {
    const row = this.databases.app.prepare('SELECT * FROM agent_profiles WHERE id = ?').get(profileId);
    if (!row) return null;
    return parseAgentProfileRow(row);
  }

  getInstructionPreview(scope: string, projectId?: string): CompiledInstructionBundle {
    return createInstructionPreview(this.databases, this.workspaceRegistry, scope, projectId);
  }

  resolveInstructionsForRun(task: { workspaceId: string; projectId: string | null; prompt: string }): CompiledInstructionBundle {
    return resolveInstructionBundleForTask(this.databases, this.workspaceRegistry, task);
  }

  getSecurityAuditFindings(): SecurityAuditFinding[] {
    return z.array(SecurityAuditFindingSchema).parse(
      this.databases.app
        .prepare(`
          SELECT
            code,
            severity,
            message,
            component,
            timestamp,
            details_json as details
          FROM security_audit
          ORDER BY timestamp DESC
        `)
        .all()
        .map((row) => {
          const typedRow = row as {
            code: string;
            severity: string;
            message: string;
            component: string;
            timestamp: string;
            details: string;
          };
          return {
            code: typedRow.code,
            severity: typedRow.severity,
            message: typedRow.message,
            component: typedRow.component,
            timestamp: typedRow.timestamp,
            details: JSON.parse(typedRow.details || '{}') as Record<string, string>,
          };
        }),
    );
  }

  issueCsrfToken(): string {
    return issueCsrfToken(readAuthStore(this.config.authFile));
  }
}
