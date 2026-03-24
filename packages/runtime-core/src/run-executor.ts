import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import type {
  AgentProfileRecord,
  AppConfig,
  CompiledInstructionBundle,
  ExecutionEnvelope,
  InterventionRecord,
  MemorySearchQuery,
  MemorySearchResponse,
  MemoryType,
  NormalizedEngineEvent,
  ProjectRecord,
  ReceiptRecord,
  RecallExplanation,
  RunEventRecord,
  RunRecord,
  SecurityAuditEvent,
  SessionRootRecord,
  TaskRecord,
  WorkspaceRecord,
  JobRecord,
  CapabilityDescriptor,
} from '@popeye/contracts';
import { nowIso, RunEventRecordSchema } from '@popeye/contracts';
import type {
  EngineAdapter,
  EngineRunCompletion,
  EngineRunHandle,
  RuntimeToolDescriptor,
} from '@popeye/engine-pi';
import { redactText, type PopeyeLogger } from '@popeye/observability';
import { calculateRetryDelaySeconds } from '@popeye/scheduler';
import { selectSessionRoot } from '@popeye/sessions';

import type { ResolvedCapabilityTool } from './capability-registry.js';
import {
  buildExecutionEnvelope,
  validateProfileTaskContext,
} from './execution-envelopes.js';
import type { MemoryDescription, MemoryExpansion } from './runtime-tools.js';
import { RuntimeValidationError } from './errors.js';
import { buildCoreRuntimeTools } from './runtime-tools.js';
import { buildDelegationTool } from './delegation-tool.js';
import {
  classifyFailureFromMessage,
  isTerminalRunState,
  selectSessionKind,
} from './row-mappers.js';

// ---------------------------------------------------------------------------
// ActiveRunContext
// ---------------------------------------------------------------------------

export interface ActiveRunContext {
  runId: string;
  jobId: string;
  task: TaskRecord;
  workspaceLockId: string;
  handle: EngineRunHandle;
  finalizing: boolean;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/** Structural subset of better-sqlite3 Database used by RunExecutor. */
export interface RunExecutorDb {
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number };
  };
}

export interface RunExecutorDeps {
  db: RunExecutorDb;
  config: AppConfig;
  log: PopeyeLogger;
  getEngine: () => EngineAdapter;
  stateDir: string;

  // --- Query accessors ---
  getJob: (jobId: string) => JobRecord | null;
  getTask: (taskId: string) => TaskRecord | null;
  getRun: (runId: string) => RunRecord | null;
  getWorkspace: (id: string) => WorkspaceRecord | null;
  getProject: (id: string) => ProjectRecord | null;
  getAgentProfile: (profileId: string) => AgentProfileRecord | null;
  getReceiptByRunId: (runId: string) => ReceiptRecord | null;
  getExecutionEnvelope: (runId: string) => ExecutionEnvelope | null;
  listJobs: () => JobRecord[];
  listRunEvents: (runId: string) => RunEventRecord[];

  // --- Persistence callbacks ---
  writeRuntimeReceipt: (input: Omit<ReceiptRecord, 'id' | 'createdAt'>) => ReceiptRecord;
  persistExecutionEnvelope: (envelope: ExecutionEnvelope) => void;

  // --- Workspace lock callbacks ---
  acquireWorkspaceLock: (workspaceId: string, owner: string) => string | null;
  releaseWorkspaceLock: (workspaceId: string) => void;
  refreshLease: (jobId: string, owner: string) => void;

  // --- Shared runtime helpers ---
  redactError: (error: string | null) => string | null;
  recordSecurityAudit: (event: SecurityAuditEvent) => void;
  createIntervention: (code: InterventionRecord['code'], runId: string | null, reason: string) => void;
  emit: (event: string, payload: unknown) => void;

  // --- Service delegates (narrow structural types) ---
  receiptManager: {
    writeAbandonedReceiptIfMissing: (runId: string, jobId: string, taskId: string, workspaceId: string, summary: string, details: string) => void;
  };
  sessionService: {
    ensureSessionRoot: (root: SessionRootRecord) => void;
  };
  messageIngestion: {
    linkAcceptedIngressToRun: (taskId: string, jobId: string, runId: string) => void;
  };
  resolveInstructionsForRun: (task: { workspaceId: string; projectId: string | null; prompt: string }) => CompiledInstructionBundle;
  capabilityRegistry: {
    getRuntimeTools: (taskContext: { workspaceId: string; runId?: string }) => ResolvedCapabilityTool[];
    listCapabilities: () => CapabilityDescriptor[];
  };
  memoryLifecycle: {
    processCompactionFlush: (runId: string, content: string, workspaceId: string) => Promise<unknown>;
  };
  pluginTools: RuntimeToolDescriptor[];

  // --- Memory operation callbacks ---
  searchMemory: (query: MemorySearchQuery) => Promise<MemorySearchResponse>;
  describeMemory: (id: string, scope?: { workspaceId: string | null; projectId: string | null; includeGlobal?: boolean }) => MemoryDescription | null;
  expandMemory: (id: string, maxTokens?: number, scope?: { workspaceId: string | null; projectId: string | null; includeGlobal?: boolean }) => MemoryExpansion | null;
  explainMemoryRecall: (input: {
    query: string;
    memoryId: string;
    scope?: string;
    workspaceId?: string | null;
    projectId?: string | null;
    includeGlobal?: boolean;
    memoryTypes?: MemoryType[];
    layers?: Array<'artifact' | 'fact' | 'synthesis' | 'curated'>;
    namespaceIds?: string[];
    tags?: string[];
    includeSuperseded?: boolean;
  }, locationFilter?: { workspaceId: string | null; projectId: string | null; includeGlobal?: boolean }) => Promise<RecallExplanation | null>;
}

// ---------------------------------------------------------------------------
// RunExecutor
// ---------------------------------------------------------------------------

export class RunExecutor {
  private readonly deps: RunExecutorDeps;
  private readonly log: PopeyeLogger;
  private readonly activeRuns = new Map<string, ActiveRunContext>();

  constructor(deps: RunExecutorDeps) {
    this.deps = deps;
    this.log = deps.log;
  }

  // --- Public accessors ---

  getActiveRun(runId: string): ActiveRunContext | undefined {
    return this.activeRuns.get(runId);
  }

  getActiveRuns(): ReadonlyMap<string, ActiveRunContext> {
    return this.activeRuns;
  }

  get activeRunCount(): number {
    return this.activeRuns.size;
  }

  // --- Public methods ---

  async startJobExecution(jobId: string): Promise<RunRecord | null> {
    const job = this.deps.getJob(jobId);
    if (!job || job.status !== 'queued') return null;
    const task = this.deps.getTask(job.taskId);
    if (!task) return null;
    const workspaceLockId = this.deps.acquireWorkspaceLock(job.workspaceId, `popeyed:${process.pid}`);
    if (!workspaceLockId) return null;

    this.deps.db.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('leased', nowIso(), job.id);
    this.deps.refreshLease(job.id, `popeyed:${process.pid}`);

    const sessionRoot = selectSessionRoot({ kind: selectSessionKind(task.source), scope: job.workspaceId });
    this.deps.sessionService.ensureSessionRoot(sessionRoot);

    const run: RunRecord = {
      id: randomUUID(),
      jobId: job.id,
      taskId: task.id,
      workspaceId: job.workspaceId,
      profileId: task.profileId,
      sessionRootId: sessionRoot.id,
      engineSessionRef: null,
      state: 'starting',
      startedAt: nowIso(),
      finishedAt: null,
      error: null,
      iterationsUsed: null,
      parentRunId: null,
      delegationDepth: 0,
    };

    this.deps.db.prepare('UPDATE jobs SET status = ?, updated_at = ?, last_run_id = ? WHERE id = ?').run('running', nowIso(), run.id, job.id);
    this.deps.db.prepare('INSERT INTO runs (id, job_id, task_id, workspace_id, profile_id, session_root_id, engine_session_ref, state, started_at, finished_at, error, iterations_used, parent_run_id, delegation_depth) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      run.id,
      run.jobId,
      run.taskId,
      run.workspaceId,
      run.profileId,
      run.sessionRootId,
      run.engineSessionRef,
      run.state,
      run.startedAt,
      run.finishedAt,
      run.error,
      run.iterationsUsed,
      run.parentRunId,
      run.delegationDepth,
    );

    const instructionBundle = this.deps.resolveInstructionsForRun(task);
    const redactedPrompt = redactText(task.prompt, this.deps.config.security.redactionPatterns);
    for (const event of redactedPrompt.events) this.deps.recordSecurityAudit(event);
    const fullPrompt = instructionBundle.compiledText
      ? `${instructionBundle.compiledText}\n\n---\n\n${redactedPrompt.text}`
      : redactedPrompt.text;

    this.deps.messageIngestion.linkAcceptedIngressToRun(task.id, job.id, run.id);
    this.deps.emit('run_started', run);

    const runLog = this.log.child({
      workspaceId: task.workspaceId,
      ...(task.projectId != null && { projectId: task.projectId }),
      taskId: task.id,
      jobId: job.id,
      runId: run.id,
      sessionRootId: sessionRoot.id,
    });

    try {
      const profile = this.deps.getAgentProfile(task.profileId);
      if (!profile) {
        throw new RuntimeValidationError(`Execution profile not found: ${task.profileId}`);
      }
      const workspace = this.deps.getWorkspace(task.workspaceId);
      if (!workspace) {
        throw new RuntimeValidationError(`Workspace not found: ${task.workspaceId}`);
      }
      const project = task.projectId ? this.deps.getProject(task.projectId) : null;
      if (task.projectId && !project) {
        throw new RuntimeValidationError(`Project not found: ${task.projectId}`);
      }
      if (project && project.workspaceId !== task.workspaceId) {
        throw new RuntimeValidationError(`Project ${task.projectId} does not belong to workspace ${task.workspaceId}`);
      }
      const profileContextError = validateProfileTaskContext(profile, task);
      if (profileContextError) {
        throw new RuntimeValidationError(profileContextError);
      }

      const capabilityToolEntries = this.deps.capabilityRegistry.getRuntimeTools({
        workspaceId: task.workspaceId,
        runId: run.id,
      });
      const invalidCapabilityToolEntry = capabilityToolEntries.find((entry) => entry == null || typeof entry !== 'object' || !('tool' in entry) || !entry.tool);
      if (invalidCapabilityToolEntry) {
        runLog.error('invalid capability tool entry', {
          entry: invalidCapabilityToolEntry as unknown as Record<string, unknown>,
        });
      }
      const coreToolNames = this.createCoreRuntimeTools(task, run.id).map((tool) => tool.name);
      const capabilityToolNames = capabilityToolEntries.map((entry) => entry.tool.name);
      const allRuntimeToolNames = Array.from(new Set([...coreToolNames, ...capabilityToolNames])).sort();
      const allCapabilityIds = this.deps.capabilityRegistry.listCapabilities().map((capability) => capability.id).sort();
      const allowedCapabilityIds = profile.allowedCapabilityIds.length > 0 ? profile.allowedCapabilityIds : allCapabilityIds;
      const allowedRuntimeTools = profile.allowedRuntimeTools.length > 0 ? profile.allowedRuntimeTools : allRuntimeToolNames;
      const warnings: string[] = [];
      const envelope = buildExecutionEnvelope({
        runId: run.id,
        task,
        profile,
        engineKind: this.deps.config.engine.kind,
        allowedRuntimeTools,
        allowedCapabilityIds,
        workspaceRootPath: workspace.rootPath,
        projectPath: project?.path ?? null,
        sessionPolicy: 'dedicated',
        warnings,
        scratchRoot: `${this.deps.stateDir}/scratch/${run.id}`,
      });
      mkdirSync(envelope.scratchRoot, { recursive: true });
      this.deps.persistExecutionEnvelope(envelope);

      const engineRequest = {
        prompt: fullPrompt,
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        instructionSnapshotId: instructionBundle.id,
        ...(envelope.cwd ? { cwd: envelope.cwd } : {}),
        sessionPolicy: { type: 'dedicated' as const, rootId: sessionRoot.id },
        cacheRetention: this.deps.config.engine.defaultCacheRetention,
        trigger: {
          source: task.source,
          timestamp: run.startedAt,
        },
        runtimeTools: this.createRuntimeTools(task, run.id, envelope),
      };
      const handle = await this.deps.getEngine().startRun(engineRequest, {
        onEvent: (event) => this.persistEngineEvent(run.id, event),
      });
      const activeRun: ActiveRunContext = {
        runId: run.id,
        jobId: job.id,
        task,
        workspaceLockId,
        handle,
        finalizing: false,
      };
      this.activeRuns.set(run.id, activeRun);
      this.deps.refreshLease(job.id, handle.pid ? `worker:${handle.pid}` : `popeyed:${process.pid}`);
      this.deps.db.prepare('UPDATE runs SET state = ? WHERE id = ?').run('running', run.id);
      runLog.info('run started');
      void this.awaitRunCompletion(activeRun);
      return this.deps.getRun(run.id);
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const safeMessage = this.deps.redactError(rawMessage) ?? rawMessage;
      runLog.error('run startup failed', {
        error: safeMessage,
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      });
      this.deps.releaseWorkspaceLock(job.workspaceId);
      this.deps.db.prepare('DELETE FROM job_leases WHERE job_id = ?').run(job.id);
      this.deps.db.prepare('UPDATE runs SET state = ?, finished_at = ?, error = ? WHERE id = ?').run('failed_final', nowIso(), safeMessage, run.id);
      this.deps.db.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('failed_final', nowIso(), job.id);
      const receipt = this.deps.writeRuntimeReceipt({
        runId: run.id,
        jobId: job.id,
        taskId: task.id,
        workspaceId: task.workspaceId,
        status: 'failed',
        summary: 'Run failed during engine startup',
        details: safeMessage,
        usage: { provider: this.deps.config.engine.kind, model: 'unknown', tokensIn: task.prompt.length, tokensOut: 0, estimatedCostUsd: 0 },
      });
      this.deps.emit('run_completed', receipt);
      this.deps.recordSecurityAudit({ code: 'run_failed', severity: 'error', message: safeMessage, component: 'runtime-core', timestamp: nowIso(), details: { runId: run.id } });
      return this.deps.getRun(run.id);
    }
  }

  async abandonRun(runId: string, reason: string): Promise<void> {
    const run = this.deps.getRun(runId);
    if (!run || isTerminalRunState(run.state)) return;
    this.log.warn('run abandoned', { runId, reason });
    this.deps.receiptManager.writeAbandonedReceiptIfMissing(run.id, run.jobId, run.taskId, run.workspaceId, 'Run abandoned', reason);
    this.deps.db.prepare('UPDATE runs SET state = ?, finished_at = ?, error = ? WHERE id = ?').run('abandoned', nowIso(), this.deps.redactError(reason), run.id);
    const receipt = this.deps.getReceiptByRunId(run.id);
    if (receipt) {
      this.deps.emit('run_completed', receipt);
    }
    await this.applyRecoveryDecision(run.jobId, run.id, reason);
    const activeRun = this.activeRuns.get(runId);
    if (activeRun) this.cleanupActiveRun(activeRun);
  }

  async applyRecoveryDecision(jobId: string, runId: string, reason: string): Promise<void> {
    const job = this.deps.listJobs().find((candidate) => candidate.id === jobId);
    if (!job) return;
    const task = this.deps.getTask(job.taskId);
    if (!task) return;
    this.deps.db.prepare('DELETE FROM job_leases WHERE job_id = ?').run(jobId);
    this.deps.releaseWorkspaceLock(job.workspaceId);
    const lowered = reason.toLowerCase();

    if (task.source === 'heartbeat') {
      this.deps.db.prepare('UPDATE jobs SET status = ?, available_at = ?, updated_at = ? WHERE id = ?').run('queued', nowIso(), nowIso(), jobId);
      return;
    }
    if (lowered.includes('auth') || lowered.includes('credential')) {
      this.deps.db.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('blocked_operator', nowIso(), jobId);
      this.deps.createIntervention('needs_credentials', runId, `Credentials required after abandoned run ${runId}`);
      return;
    }
    if (lowered.includes('policy')) {
      this.deps.db.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('blocked_operator', nowIso(), jobId);
      this.deps.createIntervention('needs_policy_decision', runId, `Policy decision required after abandoned run ${runId}`);
      return;
    }

    const nextRetryCount = job.retryCount + 1;
    if (nextRetryCount < task.retryPolicy.maxAttempts) {
      const delaySeconds = calculateRetryDelaySeconds(nextRetryCount, task.retryPolicy);
      const availableAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
      this.deps.db.prepare('UPDATE jobs SET status = ?, retry_count = ?, available_at = ?, updated_at = ? WHERE id = ?').run('waiting_retry', nextRetryCount, availableAt, nowIso(), jobId);
      return;
    }

    this.deps.db.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('failed_final', nowIso(), jobId);
    this.deps.createIntervention('retry_budget_exhausted', runId, `Retry budget exhausted for abandoned run ${runId}`);
  }

  // --- Private methods ---

  private createRuntimeTools(task: TaskRecord, runId: string, envelope: ExecutionEnvelope): RuntimeToolDescriptor[] {
    const capabilityTools = this.deps.capabilityRegistry
      .getRuntimeTools({ workspaceId: task.workspaceId, runId })
      .filter((entry) =>
        envelope.allowedCapabilityIds.includes(entry.capabilityId)
        && envelope.allowedRuntimeTools.includes(entry.tool.name),
      )
      .map((entry) => ({
        ...entry.tool,
        execute: async (params: unknown) => {
          const result = await entry.tool.execute(params);
          return {
            ...result,
            content: result.content.map((c) => ({ ...c, type: c.type as 'text' })),
          };
        },
      }));

    return [
      ...this.createCoreRuntimeTools(task, runId).filter((tool) => envelope.allowedRuntimeTools.includes(tool.name)),
      ...capabilityTools,
      ...this.deps.pluginTools,
    ];
  }

  private createCoreRuntimeTools(_task: TaskRecord, runId: string): RuntimeToolDescriptor[] {
    const memoryTools = buildCoreRuntimeTools({
      getExecutionEnvelope: (id) => this.deps.getExecutionEnvelope(id),
      searchMemory: (query) => this.deps.searchMemory(query),
      describeMemory: (id, scope) => this.deps.describeMemory(id, scope),
      expandMemory: (id, maxTokens, scope) => this.deps.expandMemory(id, maxTokens, scope),
      explainMemoryRecall: (input, scope) => this.deps.explainMemoryRecall(input, scope),
    }, runId);

    const delegationTool = buildDelegationTool({
      getRun: (id) => this.deps.getRun(id),
      countToolCallEvents: (id) => {
        const row = this.deps.db.prepare("SELECT COUNT(*) as cnt FROM run_events WHERE run_id = ? AND type = 'tool_call'").get(id) as { cnt: number } | undefined;
        return row?.cnt ?? 0;
      },
      getEngineConfig: () => ({
        maxIterationsPerRun: this.deps.config.engine.maxIterationsPerRun,
        maxDelegationDepth: this.deps.config.engine.maxDelegationDepth,
      }),
      startDelegateRun: async () => {
        throw new Error('Delegation execution not yet implemented — startDelegateRun requires engine spawning logic in RunExecutor');
      },
    }, runId);

    return [...memoryTools, delegationTool];
  }

  private persistEngineEvent(runId: string, event: NormalizedEngineEvent): void {
    const record: RunEventRecord = RunEventRecordSchema.parse({
      id: randomUUID(),
      runId,
      type: event.type,
      payload: JSON.stringify(event.payload ?? {}),
      createdAt: nowIso(),
    });
    this.deps.db.prepare('INSERT INTO run_events (id, run_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)').run(record.id, record.runId, record.type, record.payload, record.createdAt);
    this.deps.db.prepare('INSERT INTO run_events_fts(event_id, run_id, type, payload) VALUES (?, ?, ?, ?)').run(record.id, record.runId, record.type, record.payload);
    this.log.debug('engine event persisted', { runId, eventType: event.type });
    if (event.type === 'session' && event.payload?.sessionRef) {
      this.deps.db.prepare('UPDATE runs SET engine_session_ref = ? WHERE id = ?').run(event.payload.sessionRef, runId);
    }
    if (event.type === 'compaction' && typeof event.payload?.content === 'string') {
      const activeRun = this.activeRuns.get(runId);
      const workspaceId = activeRun?.task.workspaceId ?? 'default';
      void this.deps.memoryLifecycle.processCompactionFlush(runId, event.payload.content, workspaceId);
    }
    this.deps.emit('run_event', record);
  }

  private async awaitRunCompletion(activeRun: ActiveRunContext): Promise<void> {
    try {
      const completion = await activeRun.handle.wait();
      await this.finalizeRun(activeRun, completion);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.finalizeRun(activeRun, {
        engineSessionRef: null,
        usage: { provider: this.deps.config.engine.kind, model: 'unknown', tokensIn: activeRun.task.prompt.length, tokensOut: 0, estimatedCostUsd: 0 },
        failureClassification: classifyFailureFromMessage(message),
      });
    }
  }

  private async finalizeRun(activeRun: ActiveRunContext, completion: EngineRunCompletion): Promise<void> {
    if (activeRun.finalizing) return;
    activeRun.finalizing = true;
    const run = this.deps.getRun(activeRun.runId);
    if (!run) return;

    const runLog = this.log.child({
      workspaceId: run.workspaceId,
      taskId: run.taskId,
      jobId: run.jobId,
      runId: run.id,
      sessionRootId: run.sessionRootId,
    });

    if (completion.iterationsUsed !== undefined) {
      this.deps.db.prepare('UPDATE runs SET iterations_used = ? WHERE id = ?').run(completion.iterationsUsed, run.id);
    }

    const failure = completion.failureClassification;
    if (failure === null) {
      this.deps.db.prepare('UPDATE runs SET state = ?, engine_session_ref = ?, finished_at = ?, error = ? WHERE id = ?').run('succeeded', completion.engineSessionRef, nowIso(), null, run.id);
      this.deps.db.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('succeeded', nowIso(), run.jobId);
      const receipt = this.deps.writeRuntimeReceipt({
        runId: run.id,
        jobId: run.jobId,
        taskId: run.taskId,
        workspaceId: run.workspaceId,
        status: 'succeeded',
        summary: 'Run completed successfully',
        details: JSON.stringify(this.deps.listRunEvents(run.id)),
        usage: completion.usage,
      });
      runLog.info('run succeeded', {
        provider: completion.usage.provider,
        model: completion.usage.model,
        tokensIn: completion.usage.tokensIn,
        tokensOut: completion.usage.tokensOut,
        estimatedCostUsd: completion.usage.estimatedCostUsd,
      });
      this.deps.emit('run_completed', receipt);
      this.cleanupActiveRun(activeRun);
      return;
    }

    if (failure === 'cancelled') {
      this.deps.db.prepare('UPDATE runs SET state = ?, finished_at = ?, error = ? WHERE id = ?').run('cancelled', nowIso(), this.deps.redactError('cancelled'), run.id);
      this.deps.db.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('cancelled', nowIso(), run.jobId);
      const receipt = this.deps.writeRuntimeReceipt({
        runId: run.id,
        jobId: run.jobId,
        taskId: run.taskId,
        workspaceId: run.workspaceId,
        status: 'cancelled',
        summary: 'Run cancelled',
        details: 'Cancelled by operator or daemon shutdown',
        usage: completion.usage,
      });
      runLog.info('run cancelled');
      this.deps.emit('run_completed', receipt);
      this.cleanupActiveRun(activeRun);
      return;
    }

    if (failure === 'transient_failure') {
      this.deps.db.prepare('UPDATE runs SET state = ?, finished_at = ?, error = ? WHERE id = ?').run('failed_retryable', nowIso(), this.deps.redactError(failure), run.id);
      runLog.warn('run failed (retryable)', { failure });
      await this.scheduleRetry(activeRun.task, run.jobId, completion, failure);
      this.cleanupActiveRun(activeRun);
      return;
    }

    this.deps.db.prepare('UPDATE runs SET state = ?, finished_at = ?, error = ?, engine_session_ref = ? WHERE id = ?').run('failed_final', nowIso(), this.deps.redactError(failure), completion.engineSessionRef, run.id);
    this.deps.db.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('failed_final', nowIso(), run.jobId);
    const receipt = this.deps.writeRuntimeReceipt({
      runId: run.id,
      jobId: run.jobId,
      taskId: run.taskId,
      workspaceId: run.workspaceId,
      status: 'failed',
      summary: 'Run failed',
      details: failure,
      usage: completion.usage,
    });
    runLog.error('run failed (final)', { failure });
    this.deps.emit('run_completed', receipt);
    this.deps.recordSecurityAudit({ code: 'run_failed', severity: 'error', message: failure, component: 'runtime-core', timestamp: nowIso(), details: { runId: run.id } });
    const maxIter = this.deps.config.engine.maxIterationsPerRun ?? 200;
    const isBudgetExhaustion = failure === 'policy_failure'
      && completion.iterationsUsed != null
      && completion.iterationsUsed >= maxIter;
    if (isBudgetExhaustion) {
      this.deps.createIntervention('iteration_budget_exhausted', run.id,
        `Run ${run.id} terminated: iteration budget exhausted (${completion.iterationsUsed} tool calls)`);
    } else {
      this.deps.createIntervention('failed_final', run.id, `Run ${run.id} failed with ${failure}`);
    }
    this.cleanupActiveRun(activeRun);
  }

  private async scheduleRetry(task: TaskRecord, jobId: string, completion: EngineRunCompletion, reason: string): Promise<void> {
    const job = this.deps.listJobs().find((candidate) => candidate.id === jobId);
    if (!job) return;
    const nextRetryCount = job.retryCount + 1;
    if (task.source === 'heartbeat') {
      this.deps.db.prepare('UPDATE jobs SET status = ?, retry_count = ?, available_at = ?, updated_at = ? WHERE id = ?').run('queued', nextRetryCount, nowIso(), nowIso(), jobId);
    } else if (nextRetryCount < task.retryPolicy.maxAttempts) {
      const delaySeconds = calculateRetryDelaySeconds(nextRetryCount, task.retryPolicy);
      const availableAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
      this.deps.db.prepare('UPDATE jobs SET status = ?, retry_count = ?, available_at = ?, updated_at = ? WHERE id = ?').run('waiting_retry', nextRetryCount, availableAt, nowIso(), jobId);
    } else {
      this.deps.db.prepare('UPDATE jobs SET status = ?, retry_count = ?, updated_at = ? WHERE id = ?').run('failed_final', nextRetryCount, nowIso(), jobId);
      this.deps.createIntervention('retry_budget_exhausted', job.lastRunId, `Retry budget exhausted for job ${jobId}`);
    }

    const receipt = this.deps.writeRuntimeReceipt({
      runId: job.lastRunId ?? 'unknown',
      jobId,
      taskId: task.id,
      workspaceId: task.workspaceId,
      status: 'failed',
      summary: 'Run failed and was scheduled for retry',
      details: reason,
      usage: completion.usage,
    });
    this.deps.emit('run_completed', receipt);
  }

  private cleanupActiveRun(activeRun: ActiveRunContext): void {
    this.activeRuns.delete(activeRun.runId);
    this.deps.db.prepare('DELETE FROM job_leases WHERE job_id = ?').run(activeRun.jobId);
    this.deps.releaseWorkspaceLock(activeRun.task.workspaceId);
  }
}
