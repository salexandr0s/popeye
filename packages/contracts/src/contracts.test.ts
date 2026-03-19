import { describe, expect, it } from 'vitest';

import {
  // Execution domain
  TaskRecordSchema,
  JobRecordSchema,
  RunRecordSchema,
  RetryPolicySchema,
  TaskSideEffectProfileSchema,
  JobStateSchema,
  RunStateSchema,
  InterventionCodeSchema,
  ProjectRecordSchema,
  AgentProfileRecordSchema,
  RunEventRecordSchema,
  InterventionRecordSchema,
  JobLeaseRecordSchema,

  // Memory domain
  MemoryTypeSchema,
  MemoryRecordSchema,
  MemoryEventRecordSchema,
  MemorySourceRecordSchema,
  MemoryConsolidationRecordSchema,
  MemorySearchResultSchema,
  MemorySearchResponseSchema,
  MemoryAuditResponseSchema,

  // Config domain
  AppConfigSchema,
  MemoryConfigSchema,
  WorkspaceRecordSchema,
  SecurityConfigSchema,
  DataClassificationSchema,
  EmbeddingConfigSchema,
  WorkspaceConfigSchema,
  RuntimePathsSchema,

  // Engine domain
  EngineCapabilitiesSchema,
  EngineCancellationModeSchema,
  EngineKindSchema,
  EngineHostToolModeSchema,
  EngineFailureClassificationSchema,
  NormalizedEngineEventSchema,
  UsageMetricsSchema,

  // Sessions domain
  SessionRootKindSchema,
  SessionRootRecordSchema,

  // Receipts domain
  ReceiptRecordSchema,

  // Security domain
  PromptScanVerdictSchema,
  PromptScanResultSchema,
  SecurityAuditFindingSchema,
  SecurityAuditEventSchema,
  AuthTokenRecordSchema,
  CriticalFileMutationRequestSchema,

  // API domain
  PathIdParamSchema,
  TaskCreateInputSchema,
  TaskCreateResponseSchema,
  DaemonStatusResponseSchema,
  HealthResponseSchema,
  CsrfTokenResponseSchema,
  UsageSummarySchema,
  ErrorResponseSchema,
  SseEventEnvelopeSchema,
} from '@popeye/contracts';

// ---------------------------------------------------------------------------
// 1. Schema parse tests
// ---------------------------------------------------------------------------
describe('Schema parse tests', () => {
  describe('TaskRecordSchema', () => {
    const validTask = {
      id: 'task-001',
      workspaceId: 'ws-1',
      projectId: null,
      profileId: 'default',
      title: 'Run tests',
      prompt: 'Execute the test suite',
      source: 'manual' as const,
      status: 'active' as const,
      retryPolicy: { maxAttempts: 3, baseDelaySeconds: 5, multiplier: 2, maxDelaySeconds: 900 },
      sideEffectProfile: 'read_only' as const,
      coalesceKey: null,
      createdAt: '2026-03-13T00:00:00Z',
    };

    it('parses valid data', () => {
      const result = TaskRecordSchema.parse(validTask);
      expect(result.id).toBe('task-001');
      expect(result.title).toBe('Run tests');
      expect(result.source).toBe('manual');
      expect(result.profileId).toBe('default');
    });

    it('rejects missing required field (id)', () => {
      const { id: _id, ...noId } = validTask;
      expect(() => TaskRecordSchema.parse(noId)).toThrow();
    });

    it('rejects missing required field (title)', () => {
      const { title: _title, ...noTitle } = validTask;
      expect(() => TaskRecordSchema.parse(noTitle)).toThrow();
    });

    it('rejects invalid source', () => {
      expect(() => TaskRecordSchema.parse({ ...validTask, source: 'unknown' })).toThrow();
    });

    it('applies defaults for status and coalesceKey', () => {
      const minimal = {
        id: 'task-002',
        workspaceId: 'ws-1',
        projectId: null,
        title: 'T',
        prompt: 'P',
        source: 'api',
        retryPolicy: { maxAttempts: 1, baseDelaySeconds: 1, multiplier: 1, maxDelaySeconds: 60 },
        sideEffectProfile: 'read_only',
        createdAt: '2026-03-13T00:00:00Z',
      };
      const result = TaskRecordSchema.parse(minimal);
      expect(result.status).toBe('active');
      expect(result.coalesceKey).toBeNull();
      expect(result.profileId).toBe('default');
    });
  });

  describe('RunRecordSchema', () => {
    const validRun = {
      id: 'run-001',
      jobId: 'job-001',
      taskId: 'task-001',
      workspaceId: 'ws-1',
      profileId: 'default',
      sessionRootId: 'sr-001',
      engineSessionRef: null,
      state: 'running' as const,
      startedAt: '2026-03-13T00:00:00Z',
      finishedAt: null,
      error: null,
    };

    it('parses valid data', () => {
      const result = RunRecordSchema.parse(validRun);
      expect(result.id).toBe('run-001');
      expect(result.state).toBe('running');
      expect(result.profileId).toBe('default');
    });

    it('rejects invalid state', () => {
      expect(() => RunRecordSchema.parse({ ...validRun, state: 'exploded' })).toThrow();
    });

    it('accepts all valid states', () => {
      const states = ['starting', 'running', 'succeeded', 'failed_retryable', 'failed_final', 'cancelled', 'abandoned'] as const;
      for (const state of states) {
        const result = RunRecordSchema.parse({ ...validRun, state });
        expect(result.state).toBe(state);
      }
    });
  });

  describe('ReceiptRecordSchema', () => {
    const validReceipt = {
      id: 'rcpt-001',
      runId: 'run-001',
      jobId: 'job-001',
      taskId: 'task-001',
      workspaceId: 'ws-1',
      status: 'succeeded' as const,
      summary: 'Completed successfully',
      details: 'All steps passed.',
      usage: {
        provider: 'openai',
        model: 'gpt-4',
        tokensIn: 1000,
        tokensOut: 500,
        estimatedCostUsd: 0.05,
      },
      createdAt: '2026-03-13T00:00:00Z',
    };

    it('parses valid data with usage metrics', () => {
      const result = ReceiptRecordSchema.parse(validReceipt);
      expect(result.id).toBe('rcpt-001');
      expect(result.usage.tokensIn).toBe(1000);
      expect(result.usage.estimatedCostUsd).toBe(0.05);
      expect(result.runtime).toBeUndefined();
    });

    it('parses optional runtime observability context', () => {
      const result = ReceiptRecordSchema.parse({
        ...validReceipt,
        runtime: {
          projectId: 'proj-1',
          profileId: 'default',
          execution: {
            mode: 'interactive',
            memoryScope: 'workspace',
            recallScope: 'project',
            filesystemPolicyClass: 'workspace',
            contextReleasePolicy: 'summary_only',
            sessionPolicy: 'dedicated',
            warnings: ['profile inherited runtime tool allowlist'],
          },
          contextReleases: {
            totalReleases: 2,
            totalTokenEstimate: 320,
            byDomain: {
              email: {
                count: 2,
                tokens: 320,
              },
            },
          },
          timeline: [
            {
              id: 'timeline-1',
              at: '2026-03-13T00:00:01Z',
              kind: 'policy',
              severity: 'warn',
              code: 'connection_policy_denied',
              title: 'Connection Policy Denied',
              detail: 'Connection conn-1 is disabled.',
              source: 'security_audit',
              metadata: {
                connectionId: 'conn-1',
              },
            },
          ],
        },
      });

      expect(result.runtime?.projectId).toBe('proj-1');
      expect(result.runtime?.execution?.sessionPolicy).toBe('dedicated');
      expect(result.runtime?.contextReleases?.byDomain.email?.tokens).toBe(320);
      expect(result.runtime?.timeline).toEqual([
        expect.objectContaining({
          code: 'connection_policy_denied',
          source: 'security_audit',
        }),
      ]);
    });

    it('rejects missing usage', () => {
      const { usage: _usage, ...noUsage } = validReceipt;
      expect(() => ReceiptRecordSchema.parse(noUsage)).toThrow();
    });

    it('rejects invalid status', () => {
      expect(() => ReceiptRecordSchema.parse({ ...validReceipt, status: 'pending' })).toThrow();
    });

    it('rejects negative token counts in usage', () => {
      expect(() =>
        ReceiptRecordSchema.parse({
          ...validReceipt,
          usage: { ...validReceipt.usage, tokensIn: -1 },
        }),
      ).toThrow();
    });
  });

  describe('MemoryRecordSchema', () => {
    const validMemory = {
      id: 'mem-001',
      description: 'User prefers dark mode',
      classification: 'embeddable' as const,
      sourceType: 'receipt' as const,
      content: 'The user has indicated they prefer dark mode for all interfaces.',
      confidence: 0.85,
      scope: 'workspace',
      sourceRunId: 'run-001',
      sourceTimestamp: '2026-03-13T00:00:00Z',
      createdAt: '2026-03-13T00:00:00Z',
    };

    it('parses valid data', () => {
      const result = MemoryRecordSchema.parse(validMemory);
      expect(result.id).toBe('mem-001');
      expect(result.confidence).toBe(0.85);
    });

    it('rejects confidence below 0', () => {
      expect(() => MemoryRecordSchema.parse({ ...validMemory, confidence: -0.1 })).toThrow();
    });

    it('rejects confidence above 1', () => {
      expect(() => MemoryRecordSchema.parse({ ...validMemory, confidence: 1.1 })).toThrow();
    });

    it('accepts confidence at boundary values', () => {
      expect(MemoryRecordSchema.parse({ ...validMemory, confidence: 0 }).confidence).toBe(0);
      expect(MemoryRecordSchema.parse({ ...validMemory, confidence: 1 }).confidence).toBe(1);
    });

    it('rejects invalid classification', () => {
      expect(() => MemoryRecordSchema.parse({ ...validMemory, classification: 'public' })).toThrow();
    });

    it('applies default scope', () => {
      const { scope: _scope, ...noScope } = validMemory;
      const result = MemoryRecordSchema.parse(noScope);
      expect(result.scope).toBe('workspace');
    });
  });

  describe('JobRecordSchema', () => {
    const validJob = {
      id: 'job-001',
      taskId: 'task-001',
      workspaceId: 'ws-1',
      status: 'queued' as const,
      retryCount: 0,
      availableAt: '2026-03-13T00:00:00Z',
      lastRunId: null,
      createdAt: '2026-03-13T00:00:00Z',
      updatedAt: '2026-03-13T00:00:00Z',
    };

    it('parses valid data', () => {
      const result = JobRecordSchema.parse(validJob);
      expect(result.id).toBe('job-001');
      expect(result.status).toBe('queued');
    });

    it('rejects invalid job state', () => {
      expect(() => JobRecordSchema.parse({ ...validJob, status: 'exploded' })).toThrow();
    });

    it('rejects negative retryCount', () => {
      expect(() => JobRecordSchema.parse({ ...validJob, retryCount: -1 })).toThrow();
    });
  });

  describe('WorkspaceRecordSchema', () => {
    it('parses valid data', () => {
      const result = WorkspaceRecordSchema.parse({
        id: 'ws-1',
        name: 'My Workspace',
        createdAt: '2026-03-13T00:00:00Z',
      });
      expect(result.id).toBe('ws-1');
      expect(result.name).toBe('My Workspace');
    });

    it('rejects missing name', () => {
      expect(() => WorkspaceRecordSchema.parse({ id: 'ws-1', createdAt: '2026-03-13T00:00:00Z' })).toThrow();
    });
  });

  describe('ProjectRecordSchema', () => {
    it('parses valid data', () => {
      const result = ProjectRecordSchema.parse({
        id: 'proj-1',
        workspaceId: 'ws-1',
        name: 'Popeye',
        createdAt: '2026-03-13T00:00:00Z',
      });
      expect(result.id).toBe('proj-1');
      expect(result.workspaceId).toBe('ws-1');
    });

    it('rejects missing workspaceId', () => {
      expect(() => ProjectRecordSchema.parse({ id: 'proj-1', name: 'P', createdAt: '2026-03-13T00:00:00Z' })).toThrow();
    });
  });

  describe('AgentProfileRecordSchema', () => {
    it('parses valid data', () => {
      const result = AgentProfileRecordSchema.parse({
        id: 'agent-1',
        name: 'Popeye Agent',
        description: 'Default interactive operator profile',
        mode: 'interactive',
        modelPolicy: 'inherit',
        allowedRuntimeTools: ['popeye_memory_search'],
        allowedCapabilityIds: ['files', 'email'],
        memoryScope: 'workspace',
        recallScope: 'workspace',
        filesystemPolicyClass: 'workspace',
        contextReleasePolicy: 'summary_only',
        createdAt: '2026-03-13T00:00:00Z',
        updatedAt: '2026-03-14T00:00:00Z',
      });
      expect(result.id).toBe('agent-1');
      expect(result.name).toBe('Popeye Agent');
      expect(result.mode).toBe('interactive');
      expect(result.allowedCapabilityIds).toEqual(['files', 'email']);
      expect(result.updatedAt).toBe('2026-03-14T00:00:00Z');
    });

    it('rejects missing name', () => {
      expect(() => AgentProfileRecordSchema.parse({ id: 'agent-1', createdAt: '2026-03-13T00:00:00Z' })).toThrow();
    });

    it('applies execution-profile defaults', () => {
      const result = AgentProfileRecordSchema.parse({
        id: 'agent-default',
        name: 'Default agent profile',
        createdAt: '2026-03-13T00:00:00Z',
      });
      expect(result.description).toBe('');
      expect(result.mode).toBe('interactive');
      expect(result.modelPolicy).toBe('inherit');
      expect(result.allowedRuntimeTools).toEqual([]);
      expect(result.allowedCapabilityIds).toEqual([]);
      expect(result.memoryScope).toBe('workspace');
      expect(result.recallScope).toBe('workspace');
      expect(result.filesystemPolicyClass).toBe('workspace');
      expect(result.contextReleasePolicy).toBe('summary_only');
      expect(result.updatedAt).toBeNull();
    });
  });

  describe('MemoryEventRecordSchema', () => {
    it('parses valid data', () => {
      const result = MemoryEventRecordSchema.parse({
        id: 'me-001',
        memoryId: 'mem-001',
        type: 'created',
        createdAt: '2026-03-13T00:00:00Z',
      });
      expect(result.id).toBe('me-001');
      expect(result.type).toBe('created');
    });

    it('rejects missing memoryId', () => {
      expect(() => MemoryEventRecordSchema.parse({ id: 'me-001', type: 'created', createdAt: '2026-03-13T00:00:00Z' })).toThrow();
    });
  });

  describe('MemorySourceRecordSchema', () => {
    it('parses valid data', () => {
      const result = MemorySourceRecordSchema.parse({
        id: 'ms-001',
        memoryId: 'mem-001',
        sourceType: 'receipt',
        sourceRef: 'run-001',
        createdAt: '2026-03-13T00:00:00Z',
      });
      expect(result.id).toBe('ms-001');
      expect(result.sourceRef).toBe('run-001');
    });

    it('rejects missing sourceRef', () => {
      expect(() =>
        MemorySourceRecordSchema.parse({ id: 'ms-001', memoryId: 'mem-001', sourceType: 'receipt', createdAt: '2026-03-13T00:00:00Z' }),
      ).toThrow();
    });
  });

  describe('MemoryConsolidationRecordSchema', () => {
    it('parses valid data', () => {
      const result = MemoryConsolidationRecordSchema.parse({
        id: 'mc-001',
        memoryId: 'mem-001',
        mergedIntoId: 'mem-002',
        createdAt: '2026-03-13T00:00:00Z',
      });
      expect(result.id).toBe('mc-001');
      expect(result.mergedIntoId).toBe('mem-002');
    });

    it('rejects missing mergedIntoId', () => {
      expect(() =>
        MemoryConsolidationRecordSchema.parse({ id: 'mc-001', memoryId: 'mem-001', createdAt: '2026-03-13T00:00:00Z' }),
      ).toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Enum coverage
// ---------------------------------------------------------------------------
describe('Enum coverage', () => {
  describe('JobStateSchema', () => {
    const validStates = ['queued', 'leased', 'running', 'waiting_retry', 'paused', 'blocked_operator', 'succeeded', 'failed_final', 'cancelled'];

    it('accepts all valid states', () => {
      for (const state of validStates) {
        expect(JobStateSchema.parse(state)).toBe(state);
      }
    });

    it('rejects invalid state', () => {
      expect(() => JobStateSchema.parse('pending')).toThrow();
      expect(() => JobStateSchema.parse('')).toThrow();
    });
  });

  describe('RunStateSchema', () => {
    const validStates = ['starting', 'running', 'succeeded', 'failed_retryable', 'failed_final', 'cancelled', 'abandoned'];

    it('accepts all valid states', () => {
      for (const state of validStates) {
        expect(RunStateSchema.parse(state)).toBe(state);
      }
    });

    it('rejects invalid state', () => {
      expect(() => RunStateSchema.parse('completed')).toThrow();
    });
  });

  describe('SessionRootKindSchema', () => {
    const validKinds = ['interactive_main', 'system_heartbeat', 'scheduled_task', 'recovery', 'telegram_user'];

    it('accepts all valid kinds', () => {
      for (const kind of validKinds) {
        expect(SessionRootKindSchema.parse(kind)).toBe(kind);
      }
    });

    it('rejects invalid kind', () => {
      expect(() => SessionRootKindSchema.parse('cron_job')).toThrow();
    });
  });

  describe('MemoryTypeSchema', () => {
    const validTypes = ['episodic', 'semantic', 'procedural'];

    it('accepts all valid types', () => {
      for (const type of validTypes) {
        expect(MemoryTypeSchema.parse(type)).toBe(type);
      }
    });

    it('rejects invalid type', () => {
      expect(() => MemoryTypeSchema.parse('declarative')).toThrow();
      expect(() => MemoryTypeSchema.parse('working')).toThrow();
    });
  });

  describe('EngineFailureClassificationSchema', () => {
    const validClassifications = [
      'none',
      'startup_failure',
      'transient_failure',
      'permanent_failure',
      'auth_failure',
      'policy_failure',
      'cancelled',
      'protocol_error',
    ];

    it('accepts all valid classifications', () => {
      for (const classification of validClassifications) {
        expect(EngineFailureClassificationSchema.parse(classification)).toBe(classification);
      }
    });

    it('rejects invalid classification', () => {
      expect(() => EngineFailureClassificationSchema.parse('timeout')).toThrow();
    });
  });

  describe('TaskSideEffectProfileSchema', () => {
    const validProfiles = ['read_only', 'external_side_effect'];

    it('accepts all valid profiles', () => {
      for (const profile of validProfiles) {
        expect(TaskSideEffectProfileSchema.parse(profile)).toBe(profile);
      }
    });

    it('rejects invalid profile', () => {
      expect(() => TaskSideEffectProfileSchema.parse('write_only')).toThrow();
    });
  });

  describe('DataClassificationSchema', () => {
    const validValues = ['secret', 'sensitive', 'internal', 'embeddable'];

    it('accepts all valid classifications', () => {
      for (const v of validValues) {
        expect(DataClassificationSchema.parse(v)).toBe(v);
      }
    });

    it('rejects invalid classification', () => {
      expect(() => DataClassificationSchema.parse('public')).toThrow();
    });
  });

  describe('EngineKindSchema', () => {
    it('accepts fake', () => {
      expect(EngineKindSchema.parse('fake')).toBe('fake');
    });

    it('accepts pi', () => {
      expect(EngineKindSchema.parse('pi')).toBe('pi');
    });

    it('rejects invalid kind', () => {
      expect(() => EngineKindSchema.parse('openai')).toThrow();
    });
  });

  describe('EngineHostToolModeSchema', () => {
    it('accepts supported host tool modes', () => {
      expect(EngineHostToolModeSchema.parse('none')).toBe('none');
      expect(EngineHostToolModeSchema.parse('native')).toBe('native');
      expect(EngineHostToolModeSchema.parse('bridge')).toBe('bridge');
      expect(EngineHostToolModeSchema.parse('native_with_fallback')).toBe('native_with_fallback');
    });
  });

  describe('EngineCancellationModeSchema', () => {
    it('accepts supported cancellation modes', () => {
      expect(EngineCancellationModeSchema.parse('none')).toBe('none');
      expect(EngineCancellationModeSchema.parse('cooperative')).toBe('cooperative');
      expect(EngineCancellationModeSchema.parse('rpc_abort')).toBe('rpc_abort');
      expect(EngineCancellationModeSchema.parse('rpc_abort_with_signal_fallback')).toBe('rpc_abort_with_signal_fallback');
    });
  });

  describe('EngineCapabilitiesSchema', () => {
    it('parses valid engine capability data', () => {
      const result = EngineCapabilitiesSchema.parse({
        engineKind: 'pi',
        persistentSessionSupport: true,
        resumeBySessionRefSupport: false,
        hostToolMode: 'native_with_fallback',
        compactionEventSupport: true,
        cancellationMode: 'rpc_abort_with_signal_fallback',
        acceptedRequestMetadata: ['prompt', 'cwd', 'workspaceId'],
        warnings: ['pi version mismatch'],
      });
      expect(result.engineKind).toBe('pi');
      expect(result.hostToolMode).toBe('native_with_fallback');
      expect(result.acceptedRequestMetadata).toContain('workspaceId');
    });

    it('applies defaults for warnings and metadata', () => {
      const result = EngineCapabilitiesSchema.parse({
        engineKind: 'fake',
        persistentSessionSupport: false,
        resumeBySessionRefSupport: false,
        hostToolMode: 'none',
        compactionEventSupport: false,
        cancellationMode: 'cooperative',
      });
      expect(result.acceptedRequestMetadata).toEqual([]);
      expect(result.warnings).toEqual([]);
    });
  });

  describe('PromptScanVerdictSchema', () => {
    const validVerdicts = ['allow', 'sanitize', 'quarantine'];

    it('accepts all valid verdicts', () => {
      for (const v of validVerdicts) {
        expect(PromptScanVerdictSchema.parse(v)).toBe(v);
      }
    });

    it('rejects invalid verdict', () => {
      expect(() => PromptScanVerdictSchema.parse('block')).toThrow();
    });
  });

  describe('InterventionCodeSchema', () => {
    const validCodes = [
      'needs_credentials',
      'needs_policy_decision',
      'needs_instruction_fix',
      'needs_workspace_fix',
      'needs_operator_input',
      'retry_budget_exhausted',
      'auth_failure',
      'prompt_injection_quarantined',
      'failed_final',
    ];

    it('accepts all valid codes', () => {
      for (const code of validCodes) {
        expect(InterventionCodeSchema.parse(code)).toBe(code);
      }
    });

    it('rejects invalid code', () => {
      expect(() => InterventionCodeSchema.parse('timeout')).toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Config validation
// ---------------------------------------------------------------------------
describe('Config validation', () => {
  const completeConfig = {
    runtimeDataDir: '/tmp/popeye-test',
    authFile: '/tmp/popeye-test/config/auth.json',
    security: {
      bindHost: '127.0.0.1' as const,
      bindPort: 3210,
      redactionPatterns: ['sk-[a-zA-Z0-9]+'],
    },
    telegram: {
      enabled: false,
      maxMessagesPerMinute: 10,
      rateLimitWindowSeconds: 60,
    },
    embeddings: {
      provider: 'disabled' as const,
      allowedClassifications: ['embeddable' as const],
    },
    engine: {
      kind: 'fake' as const,
      command: 'node',
      args: [],
    },
    workspaces: [
      {
        id: 'default',
        name: 'Default workspace',
        heartbeatEnabled: true,
        heartbeatIntervalSeconds: 3600,
      },
    ],
  };

  it('parses a complete config', () => {
    const result = AppConfigSchema.parse(completeConfig);
    expect(result.runtimeDataDir).toBe('/tmp/popeye-test');
    expect(result.security.bindHost).toBe('127.0.0.1');
    expect(result.workspaces).toHaveLength(1);
    expect(result.workspaces[0]?.id).toBe('default');
  });

  it('rejects missing runtimeDataDir', () => {
    const { runtimeDataDir: _dir, ...noDir } = completeConfig;
    expect(() => AppConfigSchema.parse(noDir)).toThrow();
  });

  it('rejects missing authFile', () => {
    const { authFile: _af, ...noAuth } = completeConfig;
    expect(() => AppConfigSchema.parse(noAuth)).toThrow();
  });

  it('rejects bindHost other than 127.0.0.1', () => {
    expect(() =>
      AppConfigSchema.parse({
        ...completeConfig,
        security: { ...completeConfig.security, bindHost: '0.0.0.0' },
      }),
    ).toThrow();
  });

  it('rejects bindPort out of range', () => {
    expect(() =>
      AppConfigSchema.parse({
        ...completeConfig,
        security: { ...completeConfig.security, bindPort: 0 },
      }),
    ).toThrow();

    expect(() =>
      AppConfigSchema.parse({
        ...completeConfig,
        security: { ...completeConfig.security, bindPort: 70000 },
      }),
    ).toThrow();
  });

  it('applies default workspaces when omitted', () => {
    const { workspaces: _ws, ...noWs } = completeConfig;
    const result = AppConfigSchema.parse(noWs);
    expect(result.workspaces).toHaveLength(1);
    expect(result.workspaces[0]?.id).toBe('default');
  });

  it('applies default engine when omitted', () => {
    const { engine: _eng, ...noEngine } = completeConfig;
    const result = AppConfigSchema.parse(noEngine);
    expect(result.engine.kind).toBe('fake');
  });

  it('default engine config includes timeoutMs of 300000', () => {
    const { engine: _eng, ...noEngine } = completeConfig;
    const result = AppConfigSchema.parse(noEngine);
    expect(result.engine.timeoutMs).toBe(300_000);
  });

  it('default engine config keeps runtime-tool bridge fallback enabled for compatibility', () => {
    const { engine: _eng, ...noEngine } = completeConfig;
    const result = AppConfigSchema.parse(noEngine);
    expect(result.engine.allowRuntimeToolBridgeFallback).toBe(true);
  });

  describe('SecurityConfigSchema', () => {
    it('enforces 127.0.0.1 only', () => {
      expect(SecurityConfigSchema.parse({ bindHost: '127.0.0.1' }).bindHost).toBe('127.0.0.1');
      expect(() => SecurityConfigSchema.parse({ bindHost: '192.168.1.1' })).toThrow();
    });

    it('applies default bindPort', () => {
      const result = SecurityConfigSchema.parse({ bindHost: '127.0.0.1' });
      expect(result.bindPort).toBe(3210);
    });
  });

  describe('TelegramConfigSchema — POP-003', () => {
    it('rejects enabled=true without allowedUserId', () => {
      expect(() =>
        AppConfigSchema.parse({
          ...completeConfig,
          telegram: { enabled: true },
        }),
      ).toThrow('allowedUserId is required when telegram is enabled');
    });

    it('accepts enabled=true with allowedUserId', () => {
      const result = AppConfigSchema.parse({
        ...completeConfig,
        telegram: { enabled: true, allowedUserId: '123' },
      });
      expect(result.telegram.enabled).toBe(true);
      expect(result.telegram.allowedUserId).toBe('123');
    });

    it('accepts enabled=false without allowedUserId', () => {
      const result = AppConfigSchema.parse({
        ...completeConfig,
        telegram: { enabled: false },
      });
      expect(result.telegram.enabled).toBe(false);
    });
  });

  describe('WorkspaceConfigSchema', () => {
    it('rejects empty id', () => {
      expect(() => WorkspaceConfigSchema.parse({ id: '', name: 'Ws', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 })).toThrow();
    });

    it('rejects empty name', () => {
      expect(() => WorkspaceConfigSchema.parse({ id: 'ws', name: '', heartbeatEnabled: true, heartbeatIntervalSeconds: 3600 })).toThrow();
    });

    it('applies defaults for heartbeat', () => {
      const result = WorkspaceConfigSchema.parse({ id: 'ws', name: 'Ws' });
      expect(result.heartbeatEnabled).toBe(true);
      expect(result.heartbeatIntervalSeconds).toBe(3600);
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Cross-schema consistency
// ---------------------------------------------------------------------------
describe('Cross-schema consistency', () => {
  it('TaskCreateInputSchema output can seed a valid TaskRecordSchema', () => {
    const createInput = TaskCreateInputSchema.parse({
      title: 'Cross-schema test',
      prompt: 'Verify schemas compose correctly',
    });

    // TaskCreateInput provides defaults; add the remaining fields that
    // the runtime would generate when persisting the record.
    const taskRecord = TaskRecordSchema.parse({
      id: 'task-cross-001',
      ...createInput,
      retryPolicy: { maxAttempts: 3, baseDelaySeconds: 5, multiplier: 2, maxDelaySeconds: 900 },
      sideEffectProfile: 'read_only',
      createdAt: '2026-03-13T00:00:00Z',
    });

    expect(taskRecord.id).toBe('task-cross-001');
    expect(taskRecord.title).toBe('Cross-schema test');
    expect(taskRecord.workspaceId).toBe('default');
    expect(taskRecord.profileId).toBe('default');
    expect(taskRecord.source).toBe('manual');
    expect(taskRecord.coalesceKey).toBeNull();
    expect(taskRecord.projectId).toBeNull();
  });

  it('UsageMetricsSchema used in ReceiptRecordSchema is the same as engine UsageMetricsSchema', () => {
    const usage = UsageMetricsSchema.parse({
      provider: 'openai',
      model: 'gpt-4',
      tokensIn: 100,
      tokensOut: 50,
      estimatedCostUsd: 0.01,
    });

    const receipt = ReceiptRecordSchema.parse({
      id: 'rcpt-cross-001',
      runId: 'run-001',
      jobId: 'job-001',
      taskId: 'task-001',
      workspaceId: 'ws-1',
      status: 'succeeded',
      summary: 'OK',
      details: '',
      usage,
      createdAt: '2026-03-13T00:00:00Z',
    });

    expect(receipt.usage.provider).toBe(usage.provider);
    expect(receipt.usage.tokensIn).toBe(usage.tokensIn);
    expect(receipt.usage.estimatedCostUsd).toBe(usage.estimatedCostUsd);
  });

  it('SessionRootRecordSchema kind aligns with SessionRootKindSchema', () => {
    const kinds = ['interactive_main', 'system_heartbeat', 'scheduled_task', 'recovery', 'telegram_user'] as const;
    for (const kind of kinds) {
      const record = SessionRootRecordSchema.parse({
        id: `sr-${kind}`,
        kind,
        scope: 'default',
        createdAt: '2026-03-13T00:00:00Z',
      });
      expect(record.kind).toBe(kind);
    }
  });

  it('RunRecordSchema state aligns with RunStateSchema', () => {
    const states = ['starting', 'running', 'succeeded', 'failed_retryable', 'failed_final', 'cancelled', 'abandoned'] as const;
    for (const state of states) {
      const record = RunRecordSchema.parse({
        id: `run-${state}`,
        jobId: 'job-001',
        taskId: 'task-001',
        workspaceId: 'ws-1',
        profileId: 'default',
        sessionRootId: 'sr-001',
        engineSessionRef: null,
        state,
        startedAt: '2026-03-13T00:00:00Z',
        finishedAt: null,
        error: null,
      });
      expect(record.state).toBe(state);
    }
  });

  it('JobRecordSchema status aligns with JobStateSchema', () => {
    const states = ['queued', 'leased', 'running', 'waiting_retry', 'paused', 'blocked_operator', 'succeeded', 'failed_final', 'cancelled'] as const;
    for (const status of states) {
      const record = JobRecordSchema.parse({
        id: `job-${status}`,
        taskId: 'task-001',
        workspaceId: 'ws-1',
        status,
        retryCount: 0,
        availableAt: '2026-03-13T00:00:00Z',
        lastRunId: null,
        createdAt: '2026-03-13T00:00:00Z',
        updatedAt: '2026-03-13T00:00:00Z',
      });
      expect(record.status).toBe(status);
    }
  });

  it('TaskCreateResponseSchema composes Task, Job, and Run records', () => {
    const response = TaskCreateResponseSchema.parse({
      task: {
        id: 'task-compose-001',
        workspaceId: 'ws-1',
        projectId: null,
        profileId: 'default',
        title: 'Compose test',
        prompt: 'Test composition',
        source: 'api',
        status: 'active',
        retryPolicy: { maxAttempts: 3, baseDelaySeconds: 5, multiplier: 2, maxDelaySeconds: 900 },
        sideEffectProfile: 'read_only',
        coalesceKey: null,
        createdAt: '2026-03-13T00:00:00Z',
      },
      job: {
        id: 'job-compose-001',
        taskId: 'task-compose-001',
        workspaceId: 'ws-1',
        status: 'queued',
        retryCount: 0,
        availableAt: '2026-03-13T00:00:00Z',
        lastRunId: null,
        createdAt: '2026-03-13T00:00:00Z',
        updatedAt: '2026-03-13T00:00:00Z',
      },
      run: null,
    });

    expect(response.task.id).toBe('task-compose-001');
    expect(response.task.profileId).toBe('default');
    expect(response.job?.id).toBe('job-compose-001');
    expect(response.run).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Additional schema smoke tests for completeness
// ---------------------------------------------------------------------------
describe('Additional schema smoke tests', () => {
  it('RetryPolicySchema applies defaults', () => {
    const result = RetryPolicySchema.parse({});
    expect(result.maxAttempts).toBe(3);
    expect(result.baseDelaySeconds).toBe(5);
    expect(result.multiplier).toBe(2);
    expect(result.maxDelaySeconds).toBe(900);
  });

  it('RetryPolicySchema rejects non-positive values', () => {
    expect(() => RetryPolicySchema.parse({ maxAttempts: 0 })).toThrow();
    expect(() => RetryPolicySchema.parse({ maxAttempts: -1 })).toThrow();
  });

  it('RunEventRecordSchema parses valid data', () => {
    const result = RunEventRecordSchema.parse({
      id: 'evt-001',
      runId: 'run-001',
      type: 'tool_call',
      payload: '{"tool":"read_file"}',
      createdAt: '2026-03-13T00:00:00Z',
    });
    expect(result.type).toBe('tool_call');
  });

  it('InterventionRecordSchema parses valid data', () => {
    const result = InterventionRecordSchema.parse({
      id: 'int-001',
      code: 'needs_credentials',
      runId: 'run-001',
      status: 'open',
      reason: 'API key missing',
      createdAt: '2026-03-13T00:00:00Z',
      resolvedAt: null,
    });
    expect(result.code).toBe('needs_credentials');
    expect(result.status).toBe('open');
  });

  it('JobLeaseRecordSchema parses valid data', () => {
    const result = JobLeaseRecordSchema.parse({
      jobId: 'job-001',
      leaseOwner: 'worker-1',
      leaseExpiresAt: '2026-03-13T01:00:00Z',
      updatedAt: '2026-03-13T00:00:00Z',
    });
    expect(result.leaseOwner).toBe('worker-1');
  });

  it('NormalizedEngineEventSchema parses valid data with defaults', () => {
    const result = NormalizedEngineEventSchema.parse({
      type: 'started',
    });
    expect(result.type).toBe('started');
    expect(result.payload).toEqual({});
  });

  it('NormalizedEngineEventSchema accepts payload with mixed types', () => {
    const result = NormalizedEngineEventSchema.parse({
      type: 'usage',
      payload: { tokens: 100, model: 'gpt-4', cached: true, error: null },
    });
    expect(result.payload['tokens']).toBe(100);
    expect(result.payload['model']).toBe('gpt-4');
  });

  it('MemorySearchResultSchema parses valid data', () => {
    const result = MemorySearchResultSchema.parse({
      id: 'msr-001',
      description: 'Test memory',
      content: 'Full content here',
      type: 'semantic',
      confidence: 0.9,
      effectiveConfidence: 0.85,
      scope: 'workspace',
      sourceType: 'receipt',
      createdAt: '2026-03-13T00:00:00Z',
      lastReinforcedAt: null,
      score: 0.95,
      scoreBreakdown: { relevance: 0.9, recency: 0.8, confidence: 0.85, scopeMatch: 1.0 },
    });
    expect(result.score).toBe(0.95);
    expect(result.content).toBe('Full content here');
    expect(result.scoreBreakdown.relevance).toBe(0.9);
  });

  it('MemorySearchResponseSchema parses valid data', () => {
    const result = MemorySearchResponseSchema.parse({
      results: [],
      query: 'test query',
      totalCandidates: 0,
      latencyMs: 12.5,
      searchMode: 'hybrid',
    });
    expect(result.searchMode).toBe('hybrid');
    expect(result.results).toHaveLength(0);
  });

  it('RuntimePathsSchema parses valid data', () => {
    const result = RuntimePathsSchema.parse({
      runtimeDataDir: '/tmp/popeye',
      configDir: '/tmp/popeye/config',
      stateDir: '/tmp/popeye/state',
      appDbPath: '/tmp/popeye/state/app.db',
      memoryDbPath: '/tmp/popeye/state/memory.db',
      logsDir: '/tmp/popeye/logs',
      runLogsDir: '/tmp/popeye/logs/runs',
      receiptsDir: '/tmp/popeye/receipts',
      receiptsByRunDir: '/tmp/popeye/receipts/by-run',
      receiptsByDayDir: '/tmp/popeye/receipts/by-day',
      backupsDir: '/tmp/popeye/backups',
      memoryDailyDir: '/tmp/popeye/memory/daily',
      capabilityStoresDir: '/tmp/popeye/capabilities',
      vaultsDir: '/tmp/popeye/vaults',
    });
    expect(result.appDbPath).toBe('/tmp/popeye/state/app.db');
  });

  it('PromptScanResultSchema parses valid data', () => {
    const result = PromptScanResultSchema.parse({
      verdict: 'allow',
      sanitizedText: 'Hello world',
    });
    expect(result.verdict).toBe('allow');
    expect(result.matchedRules).toEqual([]);
  });

  it('SecurityAuditFindingSchema parses valid data', () => {
    const result = SecurityAuditFindingSchema.parse({
      code: 'PERM_TOO_OPEN',
      severity: 'warn',
      message: 'Data directory permissions are too permissive',
    });
    expect(result.severity).toBe('warn');
  });

  it('SecurityAuditEventSchema parses valid data', () => {
    const result = SecurityAuditEventSchema.parse({
      code: 'AUTH_FAILURE',
      severity: 'error',
      message: 'Invalid auth token',
      component: 'control-api',
      timestamp: '2026-03-13T00:00:00Z',
    });
    expect(result.component).toBe('control-api');
    expect(result.details).toEqual({});
  });

  it('AuthTokenRecordSchema enforces minimum token length', () => {
    expect(() =>
      AuthTokenRecordSchema.parse({
        token: 'short',
        createdAt: '2026-03-13T00:00:00Z',
      }),
    ).toThrow();

    const result = AuthTokenRecordSchema.parse({
      token: 'a'.repeat(64),
      createdAt: '2026-03-13T00:00:00Z',
    });
    expect(result.token).toHaveLength(64);
  });

  it('CriticalFileMutationRequestSchema applies default approved=false', () => {
    const result = CriticalFileMutationRequestSchema.parse({ path: '/workspace/WORKSPACE.md' });
    expect(result.approved).toBe(false);
  });

  it('DaemonStatusResponseSchema parses valid data', () => {
    const result = DaemonStatusResponseSchema.parse({
      ok: true,
      runningJobs: 2,
      queuedJobs: 5,
      openInterventions: 0,
      activeLeases: 2,
      engineKind: 'fake',
      schedulerRunning: true,
      startedAt: '2026-03-13T00:00:00Z',
      lastShutdownAt: null,
    });
    expect(result.ok).toBe(true);
    expect(result.engineKind).toBe('fake');
  });

  it('HealthResponseSchema parses valid data', () => {
    const result = HealthResponseSchema.parse({ ok: true, startedAt: '2026-03-13T00:00:00Z' });
    expect(result.ok).toBe(true);
  });

  it('CsrfTokenResponseSchema parses valid data', () => {
    const result = CsrfTokenResponseSchema.parse({ token: 'csrf-token-123' });
    expect(result.token).toBe('csrf-token-123');
  });

  it('UsageSummarySchema rejects negative values', () => {
    expect(() => UsageSummarySchema.parse({ runs: -1, tokensIn: 0, tokensOut: 0, estimatedCostUsd: 0 })).toThrow();
  });

  it('ErrorResponseSchema parses valid data', () => {
    const result = ErrorResponseSchema.parse({ error: 'Something went wrong' });
    expect(result.error).toBe('Something went wrong');
  });

  it('SseEventEnvelopeSchema parses valid data', () => {
    const result = SseEventEnvelopeSchema.parse({ event: 'run:started', data: '{"runId":"run-001"}' });
    expect(result.event).toBe('run:started');
  });

  it('PathIdParamSchema rejects empty string', () => {
    expect(() => PathIdParamSchema.parse({ id: '' })).toThrow();
  });

  it('PathIdParamSchema rejects strings over 100 chars', () => {
    expect(() => PathIdParamSchema.parse({ id: 'x'.repeat(101) })).toThrow();
  });

  it('PathIdParamSchema accepts strings up to 100 chars', () => {
    const result = PathIdParamSchema.parse({ id: 'x'.repeat(100) });
    expect(result.id).toHaveLength(100);
  });

  it('EmbeddingConfigSchema applies defaults', () => {
    const result = EmbeddingConfigSchema.parse({});
    expect(result.provider).toBe('disabled');
    expect(result.allowedClassifications).toEqual(['embeddable']);
  });

  it('MemoryConfigSchema applies defaults', () => {
    const result = MemoryConfigSchema.parse({});
    expect(result.confidenceHalfLifeDays).toBe(30);
    expect(result.archiveThreshold).toBe(0.1);
    expect(result.consolidationEnabled).toBe(true);
    expect(result.compactionFlushConfidence).toBe(0.7);
    expect(result.dailySummaryHour).toBe(2);
  });

  it('MemoryConfigSchema rejects invalid values', () => {
    expect(() => MemoryConfigSchema.parse({ confidenceHalfLifeDays: -1 })).toThrow();
    expect(() => MemoryConfigSchema.parse({ archiveThreshold: 1.5 })).toThrow();
    expect(() => MemoryConfigSchema.parse({ dailySummaryHour: 25 })).toThrow();
  });

  it('AppConfigSchema includes memory config with defaults', () => {
    const result = AppConfigSchema.parse({
      runtimeDataDir: '/tmp/popeye-test',
      authFile: '/tmp/popeye-test/config/auth.json',
      security: { bindHost: '127.0.0.1' as const },
      telegram: { enabled: false },
      embeddings: {},
    });
    expect(result.memory.confidenceHalfLifeDays).toBe(30);
    expect(result.memory.consolidationEnabled).toBe(true);
  });

  it('MemoryAuditResponseSchema parses valid data', () => {
    const result = MemoryAuditResponseSchema.parse({
      totalMemories: 100,
      activeMemories: 80,
      archivedMemories: 20,
      byType: { episodic: 50, semantic: 30 },
      byScope: { workspace: 80 },
      byClassification: { internal: 60, embeddable: 20 },
      averageConfidence: 0.75,
      staleCount: 5,
      consolidationsPerformed: 10,
      lastDecayRunAt: '2026-03-13T00:00:00Z',
      lastConsolidationRunAt: null,
      lastDailySummaryAt: null,
    });
    expect(result.totalMemories).toBe(100);
    expect(result.activeMemories).toBe(80);
    expect(result.byType['episodic']).toBe(50);
  });

  it('MemoryConsolidationRecordSchema includes reason with default', () => {
    const result = MemoryConsolidationRecordSchema.parse({
      id: 'mc-002',
      memoryId: 'mem-003',
      mergedIntoId: 'mem-004',
      createdAt: '2026-03-13T00:00:00Z',
    });
    expect(result.reason).toBe('');

    const withReason = MemoryConsolidationRecordSchema.parse({
      id: 'mc-003',
      memoryId: 'mem-005',
      mergedIntoId: 'mem-006',
      reason: 'exact_dedup',
      createdAt: '2026-03-13T00:00:00Z',
    });
    expect(withReason.reason).toBe('exact_dedup');
  });

  it('MemoryRecordSchema includes new fields with defaults', () => {
    const result = MemoryRecordSchema.parse({
      id: 'mem-new',
      description: 'Test',
      classification: 'internal',
      sourceType: 'receipt',
      content: 'Content',
      confidence: 0.5,
      createdAt: '2026-03-13T00:00:00Z',
    });
    expect(result.memoryType).toBe('episodic');
    expect(result.dedupKey).toBeNull();
    expect(result.lastReinforcedAt).toBeNull();
    expect(result.archivedAt).toBeNull();
  });

  it('MemoryRecordSchema accepts compaction_flush sourceType', () => {
    const result = MemoryRecordSchema.parse({
      id: 'mem-flush',
      description: 'Compaction flush',
      classification: 'internal',
      sourceType: 'compaction_flush',
      content: 'Flushed content',
      confidence: 0.7,
      createdAt: '2026-03-13T00:00:00Z',
    });
    expect(result.sourceType).toBe('compaction_flush');
  });

  it('NormalizedEngineEventSchema accepts compaction type', () => {
    const result = NormalizedEngineEventSchema.parse({
      type: 'compaction',
      payload: { size: 1024 },
    });
    expect(result.type).toBe('compaction');
  });
});
