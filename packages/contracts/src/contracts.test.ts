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
  MemorySearchResultSchema,
  MemorySearchResponseSchema,
  MemoryAuditResponseSchema,
  MemorySearchQuerySchema,
  MemorySourceTypeSchema,
  MemoryNamespaceKindSchema,
  DomainKindSchema,
  MemoryImportInputSchema,

  // Config domain
  AppConfigSchema,
  EngineConfigSchema,
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
  PlaybookFrontMatterSchema,
  AppliedPlaybookSchema,
  PlaybookDetailSchema,
  PlaybookProposalRecordSchema,
  PlaybookRecordSchema,
  PlaybookSearchResultSchema,
  PlaybookStaleCandidateSchema,
  PlaybookRevisionRecordSchema,

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
  BootstrapStatusResponseSchema,
  NativeAppSessionCreateRequestSchema,
  NativeAppSessionCreateResponseSchema,
  NativeAppSessionRevokeResponseSchema,
  UsageSummarySchema,
  ErrorResponseSchema,
  SseEventEnvelopeSchema,
  InstructionSourceSchema,
  InstructionResolutionContextSchema,
  ConnectionProviderKindSchema,
  OAuthProviderAvailabilityRecordSchema,
  OAuthProviderKindSchema,
  ProviderAuthConfigRecordSchema,
  ProviderAuthConfigUpdateInputSchema,
  TodoProviderKindSchema,
  TodoItemRecordSchema,
  FileRootRecordSchema,
  KnowledgeAuditReportSchema,
  KnowledgeBetaRunCreateInputSchema,
  KnowledgeBetaRunDetailSchema,
  KnowledgeConverterAvailabilitySchema,
  KnowledgeImportInputSchema,
  KnowledgeImportResultSchema,
  KnowledgeRevisionApplyResultSchema,
  KnowledgeRevisionRejectResultSchema,
  KnowledgeSourceRecordSchema,
  KnowledgeSourceSnapshotRecordSchema,
  MutationReceiptKindSchema,
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

  describe('Native app session schemas', () => {
    it('parses revoke responses', () => {
      const result = NativeAppSessionRevokeResponseSchema.parse({ revoked: true });
      expect(result.revoked).toBe(true);
    });
  });

  describe('Knowledge schemas', () => {
    it('parses website knowledge imports', () => {
      const result = KnowledgeImportInputSchema.parse({
        workspaceId: 'default',
        sourceType: 'website',
        title: 'Karpathy Notes',
        sourceUri: 'https://example.com/post',
      });

      expect(result.sourceType).toBe('website');
      expect(result.sourceUri).toBe('https://example.com/post');
    });

    it('parses knowledge source records and knowledge-base file roots', () => {
      const source = KnowledgeSourceRecordSchema.parse({
        id: 'source-1',
        workspaceId: 'default',
        knowledgeRootId: 'root-1',
        sourceType: 'manual_text',
        title: 'Compiler Notes',
        originalUri: null,
        originalPath: null,
        originalFileName: null,
        originalMediaType: 'text/plain',
        adapter: 'native',
        fallbackUsed: false,
        status: 'compiled',
        contentHash: 'hash-1',
        assetStatus: 'none',
        latestOutcome: 'created',
        conversionWarnings: [],
        createdAt: '2026-04-04T10:00:00Z',
        updatedAt: '2026-04-04T10:00:00Z',
      });
      const root = FileRootRecordSchema.parse({
        id: 'root-1',
        workspaceId: 'default',
        label: 'Knowledge Base',
        rootPath: '/tmp/workspace/knowledge',
        kind: 'knowledge_base',
        permission: 'index_and_derive',
        filePatterns: ['**/*.md'],
        excludePatterns: [],
        maxFileSizeBytes: 10_485_760,
        enabled: true,
        lastIndexedAt: null,
        lastIndexedCount: 0,
        createdAt: '2026-04-04T10:00:00Z',
        updatedAt: '2026-04-04T10:00:00Z',
      });

      expect(source.status).toBe('compiled');
      expect(root.kind).toBe('knowledge_base');
      expect(MutationReceiptKindSchema.parse('knowledge_import')).toBe('knowledge_import');
      expect(MutationReceiptKindSchema.parse('knowledge_revision_apply')).toBe('knowledge_revision_apply');
      expect(MutationReceiptKindSchema.parse('knowledge_revision_reject')).toBe('knowledge_revision_reject');
      expect(MutationReceiptKindSchema.parse('provider_auth_update')).toBe('provider_auth_update');
    });

    it('parses knowledge revision apply results', () => {
      const result = KnowledgeRevisionApplyResultSchema.parse({
        revision: {
          id: 'rev-1',
          documentId: 'doc-1',
          workspaceId: 'default',
          status: 'applied',
          sourceKind: 'manual',
          sourceId: null,
          proposedTitle: 'Compiler Notes',
          proposedMarkdown: '# Compiler Notes',
          diffPreview: '+ Applied',
          baseRevisionHash: 'hash-1',
          createdAt: '2026-04-04T10:00:00Z',
          appliedAt: '2026-04-04T10:01:00Z',
        },
        document: {
          id: 'doc-1',
          workspaceId: 'default',
          knowledgeRootId: 'root-1',
          sourceId: 'source-1',
          kind: 'wiki_article',
          title: 'Compiler Notes',
          slug: 'compiler-notes',
          relativePath: 'wiki/compiler-notes.md',
          revisionHash: 'hash-2',
          status: 'active',
          createdAt: '2026-04-04T10:00:00Z',
          updatedAt: '2026-04-04T10:01:00Z',
          markdownText: '# Compiler Notes',
          exists: true,
          sourceIds: ['source-1'],
        },
        receipt: {
          id: 'rcpt-1',
          kind: 'knowledge_revision_apply',
          component: 'knowledge',
          status: 'succeeded',
          summary: 'Applied knowledge revision',
          details: 'Applied knowledge revision rev-1.',
          actorRole: 'operator',
          workspaceId: 'default',
          usage: {
            provider: 'internal',
            model: 'none',
            tokensIn: 0,
            tokensOut: 0,
            estimatedCostUsd: 0,
          },
          metadata: {
            documentId: 'doc-1',
            revisionId: 'rev-1',
          },
          createdAt: '2026-04-04T10:01:00Z',
        },
      });

      expect(result.document.id).toBe('doc-1');
      expect(result.receipt.kind).toBe('knowledge_revision_apply');
    });

    it('parses knowledge converter availability and import outcomes', () => {
      const converter = KnowledgeConverterAvailabilitySchema.parse({
        id: 'markitdown',
        status: 'ready',
        provenance: 'bundled',
        details: 'MarkItDown is available.',
        version: '0.1.0',
        lastCheckedAt: '2026-04-04T10:02:00Z',
        installHint: null,
        usedFor: ['local_file', 'pdf', 'image'],
        fallbackRank: 1,
      });
      const result = KnowledgeImportResultSchema.parse({
        source: {
          id: 'source-1',
          workspaceId: 'default',
          knowledgeRootId: 'root-1',
          sourceType: 'website',
          title: 'Karpathy Notes',
          originalUri: 'https://example.com/post',
          originalPath: null,
          originalFileName: 'source.url',
          originalMediaType: 'text/uri-list',
          adapter: 'jina_reader',
          fallbackUsed: false,
          status: 'compiled_with_warnings',
          contentHash: 'hash-1',
          assetStatus: 'localized',
          latestOutcome: 'updated',
          conversionWarnings: ['downloaded 2 assets'],
          createdAt: '2026-04-04T10:00:00Z',
          updatedAt: '2026-04-04T10:02:00Z',
        },
        normalizedDocument: {
          id: 'doc-1',
          workspaceId: 'default',
          knowledgeRootId: 'root-1',
          sourceId: 'source-1',
          kind: 'source_normalized',
          title: 'Karpathy Notes',
          slug: 'karpathy-notes-source-1',
          relativePath: 'raw/source-1/normalized/source.md',
          revisionHash: 'hash-1',
          status: 'active',
          createdAt: '2026-04-04T10:00:00Z',
          updatedAt: '2026-04-04T10:02:00Z',
        },
        compileJob: {
          id: 'job-1',
          workspaceId: 'default',
          sourceId: 'source-1',
          targetDocumentId: 'doc-2',
          status: 'succeeded',
          summary: 'Source unchanged for Karpathy Notes',
          warnings: [],
          createdAt: '2026-04-04T10:02:00Z',
          updatedAt: '2026-04-04T10:02:00Z',
        },
        draftRevision: null,
        outcome: 'updated',
      });

      expect(converter.id).toBe('markitdown');
      expect(result.outcome).toBe('updated');
      expect(result.source.assetStatus).toBe('localized');
    });

    it('parses knowledge snapshot, reject results, and expanded audit fields', () => {
      const snapshot = KnowledgeSourceSnapshotRecordSchema.parse({
        id: 'snap-1',
        sourceId: 'source-1',
        workspaceId: 'default',
        contentHash: 'hash-1',
        adapter: 'jina_reader',
        fallbackUsed: false,
        status: 'compiled',
        assetStatus: 'localized',
        outcome: 'updated',
        conversionWarnings: ['localized 1 asset'],
        createdAt: '2026-04-04T10:05:00Z',
      });
      const rejectResult = KnowledgeRevisionRejectResultSchema.parse({
        revision: {
          id: 'rev-2',
          documentId: 'doc-1',
          workspaceId: 'default',
          status: 'rejected',
          sourceKind: 'manual',
          sourceId: null,
          proposedTitle: 'Compiler Notes',
          proposedMarkdown: '# Compiler Notes',
          diffPreview: '- Rejected',
          baseRevisionHash: 'hash-2',
          createdAt: '2026-04-04T10:05:00Z',
          appliedAt: null,
        },
        document: {
          id: 'doc-1',
          workspaceId: 'default',
          knowledgeRootId: 'root-1',
          sourceId: 'source-1',
          kind: 'wiki_article',
          title: 'Compiler Notes',
          slug: 'compiler-notes',
          relativePath: 'wiki/compiler-notes.md',
          revisionHash: 'hash-2',
          status: 'active',
          createdAt: '2026-04-04T10:00:00Z',
          updatedAt: '2026-04-04T10:01:00Z',
          markdownText: '# Compiler Notes',
          exists: true,
          sourceIds: ['source-1'],
        },
        receipt: {
          id: 'rcpt-2',
          kind: 'knowledge_revision_reject',
          component: 'knowledge',
          status: 'succeeded',
          summary: 'Rejected knowledge revision',
          details: 'Rejected knowledge revision rev-2.',
          actorRole: 'operator',
          workspaceId: 'default',
          usage: {
            provider: 'internal',
            model: 'none',
            tokensIn: 0,
            tokensOut: 0,
            estimatedCostUsd: 0,
          },
          metadata: {
            documentId: 'doc-1',
            revisionId: 'rev-2',
          },
          createdAt: '2026-04-04T10:05:00Z',
        },
      });
      const audit = KnowledgeAuditReportSchema.parse({
        totalSources: 3,
        totalDocuments: 4,
        totalDraftRevisions: 1,
        unresolvedLinks: 2,
        brokenLinks: 0,
        failedConversions: 1,
        degradedSources: 1,
        warningSources: 1,
        assetLocalizationFailures: 2,
        lastCompileAt: '2026-04-04T10:05:00Z',
      });

      expect(snapshot.outcome).toBe('updated');
      expect(rejectResult.receipt.kind).toBe('knowledge_revision_reject');
      expect(audit.degradedSources).toBe(1);
    });

    it('parses knowledge beta run payloads', () => {
      const createInput = KnowledgeBetaRunCreateInputSchema.parse({
        workspaceId: 'default',
        manifestPath: '/tmp/knowledge-beta-manifest.json',
        reportMarkdown: '# Knowledge beta corpus report\n',
        imports: [
          {
            label: 'article-1',
            title: 'Compiler Article',
            sourceType: 'website',
            outcome: 'created',
          },
        ],
        reingests: [],
        converters: [],
        audit: {
          totalSources: 1,
          totalDocuments: 1,
          totalDraftRevisions: 1,
          unresolvedLinks: 0,
          brokenLinks: 0,
          failedConversions: 0,
          degradedSources: 0,
          warningSources: 0,
          assetLocalizationFailures: 0,
          lastCompileAt: '2026-04-04T10:05:00Z',
        },
        gate: {
          status: 'passed',
          minImportSuccessRate: 0.9,
          actualImportSuccessRate: 1,
          maxHardFailures: 0,
          actualHardFailures: 0,
          expectedReingestChecks: 0,
          failedExpectedReingestChecks: 0,
          checks: [],
        },
      });
      const detail = KnowledgeBetaRunDetailSchema.parse({
        id: 'beta-1',
        workspaceId: 'default',
        manifestPath: '/tmp/knowledge-beta-manifest.json',
        importCount: 1,
        reingestCount: 0,
        hardFailureCount: 0,
        importSuccessRate: 1,
        gateStatus: 'passed',
        createdAt: '2026-04-04T10:06:00Z',
        reportMarkdown: '# Knowledge beta corpus report\n',
        imports: createInput.imports,
        reingests: [],
        converters: [],
        audit: createInput.audit,
        gate: createInput.gate,
      });

      expect(createInput.gate.status).toBe('passed');
      expect(detail.importCount).toBe(1);
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
          playbooks: [
            {
              id: 'workspace-triage',
              title: 'Workspace Triage',
              scope: 'workspace',
              revisionHash: 'playbook-revision-1',
            },
          ],
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
      expect(result.runtime?.playbooks).toEqual([
        {
          id: 'workspace-triage',
          title: 'Workspace Triage',
          scope: 'workspace',
          revisionHash: 'playbook-revision-1',
        },
      ]);
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

  describe('Playbook schemas', () => {
    it('parses canonical playbook records including draft status', () => {
      const record = PlaybookRecordSchema.parse({
        recordId: 'workspace:ws-1:triage',
        playbookId: 'triage',
        scope: 'workspace',
        workspaceId: 'ws-1',
        projectId: null,
        title: 'Triage',
        status: 'draft',
        allowedProfileIds: ['default'],
        filePath: '/tmp/ws/.popeye/playbooks/triage.md',
        currentRevisionHash: 'rev-1',
        effectiveness: {
          useCount30d: 4,
          succeededRuns30d: 3,
          failedRuns30d: 1,
          intervenedRuns30d: 1,
          successRate30d: 0.75,
          failureRate30d: 0.25,
          interventionRate30d: 0.25,
          lastUsedAt: '2026-03-30T00:00:00Z',
          lastUpdatedAt: '2026-03-30T00:00:00Z',
        },
        createdAt: '2026-03-30T00:00:00Z',
        updatedAt: '2026-03-30T00:00:00Z',
      });

      expect(record.status).toBe('draft');
      expect(record.allowedProfileIds).toEqual(['default']);
      expect(record.effectiveness?.successRate30d).toBe(0.75);
    });

    it('parses playbook detail and revision records', () => {
      const detail = PlaybookDetailSchema.parse({
        recordId: 'workspace:ws-1:triage',
        playbookId: 'triage',
        scope: 'workspace',
        workspaceId: 'ws-1',
        projectId: null,
        title: 'Triage',
        status: 'active',
        allowedProfileIds: [],
        filePath: '/tmp/ws/.popeye/playbooks/triage.md',
        currentRevisionHash: 'rev-2',
        body: 'Do the triage',
        markdownText: '---\nid: "triage"\n---\nDo the triage\n',
        indexedMemoryId: 'artifact-1',
        createdAt: '2026-03-30T00:00:00Z',
        updatedAt: '2026-03-30T00:00:00Z',
      });
      const revision = PlaybookRevisionRecordSchema.parse({
        playbookRecordId: detail.recordId,
        revisionHash: 'rev-1',
        title: 'Triage',
        status: 'draft',
        allowedProfileIds: [],
        filePath: detail.filePath,
        contentHash: 'content-1',
        markdownText: detail.markdownText,
        createdAt: '2026-03-29T00:00:00Z',
        current: false,
      });

      expect(detail.body).toContain('triage');
      expect(detail.indexedMemoryId).toBe('artifact-1');
      expect(revision.status).toBe('draft');
    });

    it('parses playbook search results and stale diagnostics', () => {
      const searchResult = PlaybookSearchResultSchema.parse({
        recordId: 'workspace:ws-1:triage',
        playbookId: 'triage',
        title: 'Triage',
        scope: 'workspace',
        workspaceId: 'ws-1',
        projectId: null,
        status: 'active',
        currentRevisionHash: 'rev-2',
        allowedProfileIds: ['default'],
        snippet: 'Use the triage flow',
        score: 18.5,
      });
      const staleCandidate = PlaybookStaleCandidateSchema.parse({
        recordId: 'workspace:ws-1:triage',
        title: 'Triage',
        scope: 'workspace',
        currentRevisionHash: 'rev-2',
        lastUsedAt: '2026-03-30T00:00:00Z',
        useCount30d: 4,
        failedRuns30d: 2,
        interventions30d: 1,
        lastProposalAt: null,
        indexedMemoryId: 'artifact-1',
        reasons: ['Repeated failed runs in the last 30 days'],
      });

      expect(searchResult.score).toBeGreaterThan(0);
      expect(staleCandidate.indexedMemoryId).toBe('artifact-1');
    });

    it('parses proposal records with audit fields', () => {
      const proposal = PlaybookProposalRecordSchema.parse({
        id: 'proposal-1',
        kind: 'patch',
        status: 'approved',
        targetRecordId: 'workspace:ws-1:triage',
        baseRevisionHash: 'rev-1',
        playbookId: 'triage',
        scope: 'workspace',
        workspaceId: 'ws-1',
        projectId: null,
        title: 'Triage',
        proposedStatus: 'active',
        allowedProfileIds: ['default'],
        summary: 'Tighten triage steps',
        body: 'Updated body',
        markdownText: '---\nid: "triage"\n---\nUpdated body\n',
        diffPreview: '- old\n+ new',
        contentHash: 'content-2',
        revisionHash: 'rev-2',
        scanVerdict: 'sanitize',
        scanMatchedRules: ['strip-test'],
        sourceRunId: 'run-1',
        proposedBy: 'maintenance_job',
        evidence: {
          runIds: ['run-1', 'run-2'],
          interventionIds: ['intervention-1'],
          lastProblemAt: '2026-03-30T00:00:30Z',
          metrics30d: {
            useCount30d: 4,
            failedRuns30d: 2,
            interventions30d: 1,
          },
          suggestedPatchNote: 'Stale follow-up: 4 uses / 2 failed runs / 1 intervention in trailing 30 days.',
        },
        reviewedBy: 'operator',
        reviewedAt: '2026-03-30T00:01:00Z',
        reviewNote: 'Looks good',
        appliedRecordId: null,
        appliedRevisionHash: null,
        appliedAt: null,
        createdAt: '2026-03-30T00:00:00Z',
        updatedAt: '2026-03-30T00:01:00Z',
      });

      expect(proposal.kind).toBe('patch');
      expect(proposal.scanVerdict).toBe('sanitize');
      expect(proposal.reviewedBy).toBe('operator');
      expect(proposal.proposedBy).toBe('maintenance_job');
      expect(proposal.evidence?.runIds).toEqual(['run-1', 'run-2']);
    });
  });

  describe('Playbook schemas', () => {
    it('parses playbook front matter with defaults', () => {
      const result = PlaybookFrontMatterSchema.parse({
        id: 'triage',
        title: 'Triage',
      });

      expect(result).toEqual({
        id: 'triage',
        title: 'Triage',
        status: 'active',
        allowedProfileIds: [],
      });
    });

    it('parses applied playbook summaries', () => {
      const result = AppliedPlaybookSchema.parse({
        id: 'triage',
        title: 'Triage',
        scope: 'workspace',
        revisionHash: 'rev-123',
      });

      expect(result.scope).toBe('workspace');
      expect(result.revisionHash).toBe('rev-123');
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
      'iteration_budget_exhausted',
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

  describe('Todo/connection provider schemas', () => {
    it('accepts google_tasks as a first-class provider kind', () => {
      expect(TodoProviderKindSchema.parse('google_tasks')).toBe('google_tasks');
      expect(ConnectionProviderKindSchema.parse('google_tasks')).toBe('google_tasks');
      expect(OAuthProviderKindSchema.parse('google_tasks')).toBe('google_tasks');
    });

    it('rejects removed todoist provider kinds', () => {
      expect(() => TodoProviderKindSchema.parse('todoist')).toThrow();
      expect(() => ConnectionProviderKindSchema.parse('todoist')).toThrow();
      expect(() => OAuthProviderKindSchema.parse('todoist')).toThrow();
    });

    it('parses todo items with a stable projectId field', () => {
      const item = TodoItemRecordSchema.parse({
        id: 'todo-1',
        accountId: 'acct-1',
        externalId: 'gtask-1',
        title: 'Ship Google Tasks',
        description: '',
        priority: 4,
        status: 'pending',
        dueDate: '2026-04-01',
        dueTime: null,
        labels: [],
        projectId: '@default',
        projectName: 'My Tasks',
        parentId: null,
        completedAt: null,
        createdAtExternal: null,
        updatedAtExternal: '2026-04-01T09:00:00.000Z',
        createdAt: '2026-04-01T09:00:00.000Z',
        updatedAt: '2026-04-01T09:00:00.000Z',
      });

      expect(item.projectId).toBe('@default');
      expect(item.projectName).toBe('My Tasks');
    });

    it('parses OAuth provider availability records', () => {
      const record = OAuthProviderAvailabilityRecordSchema.parse({
        providerKind: 'gmail',
        domain: 'email',
        status: 'missing_client_credentials',
        details: 'Google OAuth is not configured. Add providerAuth.google.clientId and save the Google OAuth client secret in Popeye so providerAuth.google.clientSecretRefId points to an available secret.',
      });

      expect(record.status).toBe('missing_client_credentials');
      expect(record.details).toContain('providerAuth.google.clientId');
    });

    it('parses provider auth config records and update inputs', () => {
      const record = ProviderAuthConfigRecordSchema.parse({
        provider: 'google',
        clientId: 'google-client-id',
        clientSecretRefId: 'secret-google-client',
        secretAvailability: 'available',
        status: 'ready',
        details: 'Google OAuth is configured.',
      });
      const update = ProviderAuthConfigUpdateInputSchema.parse({
        clientId: 'google-client-id',
        clientSecret: 'super-secret',
        clearStoredSecret: false,
      });

      expect(record.clientSecretRefId).toBe('secret-google-client');
      expect(update.clientSecret).toBe('super-secret');
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
    expect(result.workspaces[0]).toMatchObject({
      id: 'default',
      name: 'Default workspace',
      rootPath: null,
      projects: [],
      heartbeatEnabled: true,
      heartbeatIntervalSeconds: 3600,
      fileRoots: [],
    });
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

  it('fills full nested defaults when optional sections are omitted', () => {
    const result = AppConfigSchema.parse({
      runtimeDataDir: '/tmp/popeye-test',
      authFile: '/tmp/popeye-test/config/auth.json',
      security: { bindHost: '127.0.0.1' as const },
      telegram: { enabled: false },
      embeddings: {},
    });

    expect(result.engine).toMatchObject({
      kind: 'fake',
      command: 'node',
      args: [],
      timeoutMs: 300_000,
      runtimeToolTimeoutMs: 30_000,
      allowRuntimeToolBridgeFallback: true,
    });
    expect(result.memory).toMatchObject({
      confidenceHalfLifeDays: 30,
      archiveThreshold: 0.1,
      consolidationEnabled: true,
      compactionFlushConfidence: 0.7,
      dailySummaryHour: 2,
      docIndexEnabled: true,
      docIndexIntervalHours: 6,
      qualitySweepEnabled: false,
      compactionFanout: 8,
      compactionFreshTailCount: 4,
      compactionMaxLeafTokens: 2000,
      compactionMaxCondensedTokens: 4000,
      compactionMaxRetries: 1,
      expandTokenCap: 8000,
    });
    expect(result.memory.budgetAllocation).toEqual({
      enabled: false,
      minPerType: 1,
      maxPerType: 10,
    });
    expect(result.workspaces[0]).toMatchObject({
      id: 'default',
      name: 'Default workspace',
      rootPath: null,
      projects: [],
      heartbeatEnabled: true,
      heartbeatIntervalSeconds: 3600,
      fileRoots: [],
    });
    expect(result.approvalPolicy).toEqual({
      rules: [],
      defaultRiskClass: 'ask',
      pendingExpiryMinutes: 60,
    });
    expect(result.vaults).toEqual({
      restrictedVaultDir: 'vaults',
      capabilityStoreDir: 'capabilities',
      backupEncryptedVaults: true,
    });
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

    it('accepts enabled=true with allowedUserId and secretRefId', () => {
      const result = AppConfigSchema.parse({
        ...completeConfig,
        telegram: { enabled: true, allowedUserId: '123', secretRefId: 'telegram-bot-secret' },
      });
      expect(result.telegram.secretRefId).toBe('telegram-bot-secret');
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
      identityId: 'default',
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

  it('InstructionResolutionContextSchema accepts an optional profileId', () => {
    const result = InstructionResolutionContextSchema.parse({
      workspaceId: 'ws-1',
      projectId: 'proj-1',
      profileId: 'default',
      cwd: '/tmp/ws/projects/proj-1',
      taskBrief: 'Do the thing',
    });

    expect(result.profileId).toBe('default');
    expect(result.cwd).toBe('/tmp/ws/projects/proj-1');
  });

  it('InstructionSourceSchema accepts compatibility and soul source types', () => {
    const compat = InstructionSourceSchema.parse({
      precedence: 4,
      type: 'context_compat',
      path: '/tmp/ws/AGENTS.md',
      contentHash: 'hash-compat',
      content: 'compat',
    });
    const soul = InstructionSourceSchema.parse({
      precedence: 7,
      type: 'soul',
      path: '/tmp/ws/SOUL.md',
      contentHash: 'hash-soul',
      content: 'voice',
    });

    expect(compat.type).toBe('context_compat');
    expect(soul.type).toBe('soul');
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
      pluginsDir: '/tmp/popeye/plugins',
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

  it('BootstrapStatusResponseSchema parses valid data', () => {
    const result = BootstrapStatusResponseSchema.parse({
      mode: 'local',
      daemonReady: true,
      authStoreReady: true,
      nativeAppSessionsSupported: true,
      requiresLocalApproval: true,
      startedAt: '2026-04-02T00:00:00Z',
    });
    expect(result.mode).toBe('local');
  });

  it('NativeAppSessionCreateRequestSchema applies defaults', () => {
    const result = NativeAppSessionCreateRequestSchema.parse({});
    expect(result.clientName).toBe('PopeyeMac');
  });

  it('NativeAppSessionCreateResponseSchema parses valid data', () => {
    const result = NativeAppSessionCreateResponseSchema.parse({
      sessionToken: 'native-session-token',
      expiresAt: '2026-05-02T00:00:00Z',
    });
    expect(result.sessionToken).toBe('native-session-token');
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

  it('EngineConfigSchema applies model failover defaults', () => {
    const result = EngineConfigSchema.parse({ kind: 'pi' });
    expect(result.defaultModel).toBeUndefined();
    expect(result.fallbackModels).toEqual([]);
    expect(result.autoFailoverEnabled).toBe(false);
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

  it('NormalizedEngineEventSchema accepts model failover event types', () => {
    const attempt = NormalizedEngineEventSchema.parse({
      type: 'model_attempt',
      payload: { attempt: 1, totalAttempts: 3, model: 'anthropic/claude-sonnet-4-5', source: 'primary' },
    });
    const fallback = NormalizedEngineEventSchema.parse({
      type: 'model_fallback',
      payload: {
        attempt: 1,
        totalAttempts: 3,
        fromModel: 'anthropic/claude-sonnet-4-5',
        toModel: 'openai-codex/gpt-5.4',
        exhausted: false,
        classification: 'transient_failure',
      },
    });
    expect(attempt.type).toBe('model_attempt');
    expect(fallback.type).toBe('model_fallback');
  });

  describe('Coding agent memory extension', () => {
    it('DomainKindSchema accepts coding', () => {
      expect(DomainKindSchema.parse('coding')).toBe('coding');
    });

    it('MemoryNamespaceKindSchema accepts coding', () => {
      expect(MemoryNamespaceKindSchema.parse('coding')).toBe('coding');
    });

    it('MemorySourceTypeSchema accepts coding source types', () => {
      expect(MemorySourceTypeSchema.parse('coding_session')).toBe('coding_session');
      expect(MemorySourceTypeSchema.parse('code_review')).toBe('code_review');
      expect(MemorySourceTypeSchema.parse('debug_session')).toBe('debug_session');
      expect(MemorySourceTypeSchema.parse('playbook')).toBe('playbook');
    });

    it('MemoryImportInputSchema accepts domain, tags, durable, dedupKey', () => {
      const result = MemoryImportInputSchema.parse({
        description: 'Vitest mock pattern',
        content: 'Use in-memory SQLite',
        domain: 'coding',
        tags: ['testing', 'vitest'],
        durable: true,
        dedupKey: 'pattern:vitest-mock',
        sourceRunId: 'run-123',
        sourceTimestamp: '2026-03-21T00:00:00Z',
      });
      expect(result.domain).toBe('coding');
      expect(result.tags).toEqual(['testing', 'vitest']);
      expect(result.durable).toBe(true);
      expect(result.dedupKey).toBe('pattern:vitest-mock');
    });

    it('MemorySearchQuerySchema accepts domains and consumerProfile', () => {
      const result = MemorySearchQuerySchema.parse({
        query: 'vitest mock pattern',
        domains: ['coding', 'general'],
        consumerProfile: 'coding',
      });
      expect(result.domains).toEqual(['coding', 'general']);
      expect(result.consumerProfile).toBe('coding');
    });

    it('MemorySearchResultSchema accepts domain field', () => {
      const result = MemorySearchResultSchema.parse({
        id: 'mem-1',
        description: 'Test',
        content: null,
        type: 'procedural',
        confidence: 0.8,
        effectiveConfidence: 0.75,
        scope: 'workspace',
        sourceType: 'coding_session',
        createdAt: '2026-03-21T00:00:00Z',
        lastReinforcedAt: null,
        score: 0.9,
        domain: 'coding',
        scoreBreakdown: { relevance: 0.4, recency: 0.2, confidence: 0.2, scopeMatch: 0.1 },
      });
      expect(result.domain).toBe('coding');
    });

    it('MemoryRecordSchema accepts coding domain', () => {
      const result = MemoryRecordSchema.parse({
        id: 'mem-coding',
        description: 'Coding pattern',
        classification: 'internal',
        sourceType: 'coding_session',
        content: 'Pattern content',
        confidence: 0.8,
        createdAt: '2026-03-21T00:00:00Z',
        domain: 'coding',
      });
      expect(result.domain).toBe('coding');
      expect(result.sourceType).toBe('coding_session');
    });
  });
});
