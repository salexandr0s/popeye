import { describe, expect, it } from 'vitest';

import type {
  ExecutionEnvelope,
  MemorySearchResponse,
  PlaybookDetail,
  PlaybookProposalRecord,
  PlaybookRevisionRecord,
  PlaybookSearchResult,
  RecallSearchResponse,
} from '@popeye/contracts';

import { buildCoreRuntimeTools, type RuntimeToolsDeps } from './runtime-tools.js';

function makeEnvelope(): ExecutionEnvelope {
  return {
    runId: 'run-1',
    taskId: 'task-1',
    profileId: 'default',
    workspaceId: 'ws-1',
    projectId: 'proj-1',
    mode: 'interactive',
    modelPolicy: 'inherit',
    allowedRuntimeTools: [],
    allowedCapabilityIds: [],
    memoryScope: 'workspace',
    recallScope: 'project',
    filesystemPolicyClass: 'workspace',
    contextReleasePolicy: 'summary_only',
    readRoots: [],
    writeRoots: [],
    protectedPaths: [],
    scratchRoot: '/tmp',
    cwd: '/tmp/project',
    provenance: {
      derivedAt: '2026-03-30T00:00:00Z',
      engineKind: 'fake',
      sessionPolicy: 'dedicated',
      warnings: [],
    },
  };
}

function emptyRecall(): RecallSearchResponse {
  return {
    query: '',
    results: [],
    totalMatches: 0,
  };
}

function emptyMemory(): MemorySearchResponse {
  return {
    query: '',
    results: [],
    totalCandidates: 0,
    latencyMs: 0,
    searchMode: 'hybrid',
  };
}

function makeProposal(): PlaybookProposalRecord {
  return {
    id: 'proposal-1',
    kind: 'draft',
    status: 'pending_review',
    targetRecordId: null,
    baseRevisionHash: null,
    playbookId: 'triage',
    scope: 'project',
    workspaceId: 'ws-1',
    projectId: 'proj-1',
    title: 'Triage',
    proposedStatus: 'draft',
    allowedProfileIds: [],
    summary: '',
    body: 'Body',
    markdownText: '---\nid: "triage"\n---\nBody\n',
    diffPreview: '+ Body',
    contentHash: 'content-1',
    revisionHash: 'revision-1',
    scanVerdict: 'allow',
    scanMatchedRules: [],
    sourceRunId: 'run-1',
    proposedBy: 'runtime_tool',
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    appliedRecordId: null,
    appliedRevisionHash: null,
    appliedAt: null,
    createdAt: '2026-03-30T00:00:00Z',
    updatedAt: '2026-03-30T00:00:00Z',
  };
}

function makePlaybookDetail(overrides: Partial<PlaybookDetail> = {}): PlaybookDetail {
  return {
    recordId: 'project:proj-1:triage',
    playbookId: 'triage',
    scope: 'project',
    workspaceId: 'ws-1',
    projectId: 'proj-1',
    title: 'Triage',
    status: 'active',
    allowedProfileIds: [],
    filePath: '/tmp/project/.popeye/playbooks/triage.md',
    currentRevisionHash: 'rev-1',
    body: 'Step one',
    markdownText: '---\nid: "triage"\ntitle: "Triage"\nstatus: active\nallowedProfileIds: []\n---\nStep one\n',
    indexedMemoryId: null,
    createdAt: '2026-03-30T00:00:00Z',
    updatedAt: '2026-03-30T00:00:00Z',
    ...overrides,
  };
}

function makeRevision(overrides: Partial<PlaybookRevisionRecord> = {}): PlaybookRevisionRecord {
  return {
    playbookRecordId: 'project:proj-1:triage',
    revisionHash: 'rev-1',
    title: 'Triage',
    status: 'active',
    allowedProfileIds: [],
    filePath: '/tmp/project/.popeye/playbooks/triage.md',
    contentHash: 'content-1',
    markdownText: '---\nid: "triage"\n---\nStep one\n',
    createdAt: '2026-03-30T00:00:00Z',
    current: true,
    ...overrides,
  };
}

function makeSearchResult(overrides: Partial<PlaybookSearchResult> = {}): PlaybookSearchResult {
  return {
    recordId: 'workspace:ws-1:triage',
    playbookId: 'triage',
    title: 'Triage',
    scope: 'workspace',
    workspaceId: 'ws-1',
    projectId: null,
    status: 'active',
    currentRevisionHash: 'rev-1',
    allowedProfileIds: [],
    snippet: 'Use the triage flow',
    score: 10,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<RuntimeToolsDeps> = {}): RuntimeToolsDeps {
  return {
    getExecutionEnvelope: () => makeEnvelope(),
    searchRecall: async () => emptyRecall(),
    searchMemory: async () => emptyMemory(),
    describeMemory: () => null,
    expandMemory: () => null,
    explainMemoryRecall: async () => null,
    searchPlaybooks: () => [],
    getPlaybook: () => null,
    listPlaybookRevisions: () => [],
    createPlaybookProposal: () => makeProposal(),
    ...overrides,
  };
}

describe('buildCoreRuntimeTools', () => {
  it('scopes popeye_playbook_propose draft proposals to the current execution envelope', async () => {
    let capturedInput: unknown = null;
    const proposal = makeProposal();
    const tools = buildCoreRuntimeTools(makeDeps({
      createPlaybookProposal: (input) => {
        capturedInput = input;
        return proposal;
      },
    }), 'run-1');

    const tool = tools.find((entry) => entry.name === 'popeye_playbook_propose');
    expect(tool).toBeDefined();

    const result = await tool!.execute({
      kind: 'draft',
      playbookId: 'triage',
      scope: 'project',
      title: 'Triage',
      body: 'Body',
    });

    expect(capturedInput).toEqual({
      kind: 'draft',
      playbookId: 'triage',
      scope: 'project',
      title: 'Triage',
      body: 'Body',
      proposedBy: 'runtime_tool',
      sourceRunId: 'run-1',
      workspaceId: 'ws-1',
      projectId: 'proj-1',
    });
    expect(result.details).toEqual(proposal);
  });

  it('searches canonical playbooks, defaults to active status, and filters results to the run scope', async () => {
    let capturedInput: unknown = null;
    const tools = buildCoreRuntimeTools(makeDeps({
      searchPlaybooks: (input) => {
        capturedInput = input;
        return [
          makeSearchResult({ recordId: 'global:baseline', playbookId: 'baseline', title: 'Baseline', scope: 'global', workspaceId: null, score: 20 }),
          makeSearchResult({ recordId: 'workspace:ws-1:triage', scope: 'workspace', workspaceId: 'ws-1', projectId: null, score: 18 }),
          makeSearchResult({ recordId: 'project:proj-1:triage', scope: 'project', workspaceId: 'ws-1', projectId: 'proj-1', score: 16 }),
          makeSearchResult({ recordId: 'project:proj-2:triage', scope: 'project', workspaceId: 'ws-1', projectId: 'proj-2', score: 14 }),
          makeSearchResult({ recordId: 'workspace:ws-2:triage', scope: 'workspace', workspaceId: 'ws-2', score: 12 }),
        ];
      },
    }), 'run-1');

    const tool = tools.find((entry) => entry.name === 'popeye_playbook_search');
    expect(tool).toBeDefined();

    const result = await tool!.execute({ query: 'triage' });

    expect(capturedInput).toEqual({ query: 'triage', status: 'active' });
    expect(result.details).toEqual([
      expect.objectContaining({ recordId: 'global:baseline' }),
      expect.objectContaining({ recordId: 'workspace:ws-1:triage' }),
      expect.objectContaining({ recordId: 'project:proj-1:triage' }),
    ]);
    expect((result.content?.[0] as { text: string }).text).toContain('global:baseline');
    expect((result.content?.[0] as { text: string }).text).not.toContain('project:proj-2:triage');
    expect((result.content?.[0] as { text: string }).text).not.toContain('workspace:ws-2:triage');
  });

  it('views canonical playbooks inside scope, includes revisions when requested, and blocks out-of-scope reads', async () => {
    const tools = buildCoreRuntimeTools(makeDeps({
      getPlaybook: (recordId) => recordId === 'project:proj-1:triage'
        ? makePlaybookDetail()
        : makePlaybookDetail({
            recordId,
            scope: 'workspace',
            workspaceId: 'ws-2',
            projectId: null,
          }),
      listPlaybookRevisions: () => [makeRevision()],
    }), 'run-1');

    const tool = tools.find((entry) => entry.name === 'popeye_playbook_view');
    expect(tool).toBeDefined();

    const allowed = await tool!.execute({ recordId: 'project:proj-1:triage', includeRevisions: true });
    expect((allowed.details as { playbook: PlaybookDetail; revisions: PlaybookRevisionRecord[] }).revisions).toHaveLength(1);
    expect((allowed.content?.[0] as { text: string }).text).toContain('Step one');
    expect((allowed.content?.[0] as { text: string }).text).toContain('Revisions: 1');

    const blocked = await tool!.execute({ recordId: 'workspace:ws-2:triage' });
    expect((blocked.content?.[0] as { text: string }).text).toContain('outside the allowed execution scope');
  });
});
