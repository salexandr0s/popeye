import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { sha256 } from '@popeye/observability';

import { buildPlaybookInstructionSource, compileInstructionBundle } from './index.js';
import { resolveInstructionSources, type ResolverDependencies } from './resolver.js';

function makeDeps(overrides: Partial<ResolverDependencies> = {}): ResolverDependencies {
  return {
    getWorkspace: () => null,
    getProject: () => null,
    getPopeyeBaseInstructions: () => null,
    getGlobalOperatorInstructions: () => null,
    ...overrides,
  };
}

describe('resolveInstructionSources', () => {
  it('returns only inline sources when workspace has no rootPath', () => {
    const sources = resolveInstructionSources(
      { workspaceId: 'ws', taskBrief: 'do stuff' },
      makeDeps({ getWorkspace: () => ({ id: 'ws', name: 'Test', rootPath: null }) }),
    );
    expect(sources).toHaveLength(1);
    expect(sources[0]!.type).toBe('task_brief');
    expect(sources[0]!.precedence).toBe(8);
  });

  it('resolves WORKSPACE.md at precedence 4 with correct hash', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolver-ws-'));
    writeFileSync(join(dir, 'WORKSPACE.md'), 'workspace instructions');

    const sources = resolveInstructionSources(
      { workspaceId: 'ws' },
      makeDeps({ getWorkspace: () => ({ id: 'ws', name: 'Test', rootPath: dir }) }),
    );

    expect(sources).toHaveLength(1);
    expect(sources[0]!.type).toBe('workspace');
    expect(sources[0]!.precedence).toBe(4);
    expect(sources[0]!.contentHash).toBe(sha256('workspace instructions'));
    expect(sources[0]!.path).toBe(join(dir, 'WORKSPACE.md'));
  });

  it('resolves workspace + project at precedence 4 and 5', () => {
    const wsDir = mkdtempSync(join(tmpdir(), 'resolver-wsp-'));
    const projDir = join(wsDir, 'myproject');
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(wsDir, 'WORKSPACE.md'), 'ws content');
    writeFileSync(join(projDir, 'PROJECT.md'), 'proj content');

    const sources = resolveInstructionSources(
      { workspaceId: 'ws', projectId: 'proj' },
      makeDeps({
        getWorkspace: () => ({ id: 'ws', name: 'Test', rootPath: wsDir }),
        getProject: () => ({ id: 'proj', name: 'My Project', path: projDir, workspaceId: 'ws' }),
      }),
    );

    expect(sources).toHaveLength(2);
    expect(sources[0]!.type).toBe('workspace');
    expect(sources[0]!.precedence).toBe(4);
    expect(sources[1]!.type).toBe('project');
    expect(sources[1]!.precedence).toBe(5);
  });

  it('resolves identity file at precedence 7', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolver-id-'));
    mkdirSync(join(dir, 'identities'), { recursive: true });
    writeFileSync(join(dir, 'identities', 'default.md'), 'identity content');

    const sources = resolveInstructionSources(
      { workspaceId: 'ws', identity: 'default' },
      makeDeps({ getWorkspace: () => ({ id: 'ws', name: 'Test', rootPath: dir }) }),
    );

    expect(sources).toHaveLength(1);
    expect(sources[0]!.type).toBe('identity');
    expect(sources[0]!.precedence).toBe(7);
    expect(sources[0]!.path).toBe(join(dir, 'identities', 'default.md'));
  });

  it('resolves SOUL.md after identity at precedence 7', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolver-soul-'));
    mkdirSync(join(dir, 'identities'), { recursive: true });
    writeFileSync(join(dir, 'identities', 'default.md'), 'identity content');
    writeFileSync(join(dir, 'SOUL.md'), 'soul content');

    const sources = resolveInstructionSources(
      { workspaceId: 'ws', identity: 'default' },
      makeDeps({ getWorkspace: () => ({ id: 'ws', name: 'Test', rootPath: dir }) }),
    );

    expect(sources).toHaveLength(2);
    expect(sources.map((source) => source.type)).toEqual(['identity', 'soul']);
    expect(sources.map((source) => source.precedence)).toEqual([7, 7]);
    expect(sources[1]!.path).toBe(join(dir, 'SOUL.md'));
  });

  it('resolves AGENTS.md files from workspace root to effective cwd before WORKSPACE.md', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolver-agents-'));
    const projDir = join(dir, 'projects', 'alpha');
    const nestedDir = join(projDir, 'worktree', 'feature');
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(join(dir, 'AGENTS.md'), 'workspace compat');
    writeFileSync(join(projDir, 'AGENTS.md'), 'project compat');
    writeFileSync(join(dir, 'WORKSPACE.md'), 'workspace canonical');

    const sources = resolveInstructionSources(
      { workspaceId: 'ws', cwd: nestedDir },
      makeDeps({ getWorkspace: () => ({ id: 'ws', name: 'Test', rootPath: dir }) }),
    );

    expect(sources.map((source) => source.type)).toEqual(['context_compat', 'context_compat', 'workspace']);
    expect(sources.map((source) => source.path)).toEqual([
      join(dir, 'AGENTS.md'),
      join(projDir, 'AGENTS.md'),
      join(dir, 'WORKSPACE.md'),
    ]);
  });

  it('does not read AGENTS.md outside the workspace root', () => {
    const outerDir = mkdtempSync(join(tmpdir(), 'resolver-agents-outer-'));
    const dir = join(outerDir, 'workspace');
    const nestedDir = join(dir, 'subdir');
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(join(outerDir, 'AGENTS.md'), 'outside compat');
    writeFileSync(join(dir, 'AGENTS.md'), 'inside compat');

    const sources = resolveInstructionSources(
      { workspaceId: 'ws', cwd: nestedDir },
      makeDeps({ getWorkspace: () => ({ id: 'ws', name: 'Test', rootPath: dir }) }),
    );

    expect(sources).toHaveLength(1);
    expect(sources[0]!.path).toBe(join(dir, 'AGENTS.md'));
  });

  it('resolves all non-playbook sources in correct precedence order 2-10', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolver-full-'));
    const projDir = join(dir, 'proj');
    mkdirSync(join(dir, 'identities'), { recursive: true });
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(dir, 'AGENTS.md'), 'agents');
    writeFileSync(join(dir, 'WORKSPACE.md'), 'ws');
    writeFileSync(join(projDir, 'PROJECT.md'), 'proj');
    writeFileSync(join(dir, 'identities', 'agent.md'), 'id');
    writeFileSync(join(dir, 'SOUL.md'), 'soul');

    const sources = resolveInstructionSources(
      {
        workspaceId: 'ws',
        projectId: 'proj',
        cwd: projDir,
        identity: 'agent',
        taskBrief: 'brief',
        triggerOverlay: 'overlay',
        runtimeNotes: 'notes',
      },
      makeDeps({
        getWorkspace: () => ({ id: 'ws', name: 'Test', rootPath: dir }),
        getProject: () => ({ id: 'proj', name: 'Proj', path: projDir, workspaceId: 'ws' }),
        getPopeyeBaseInstructions: () => 'base',
        getGlobalOperatorInstructions: () => 'global',
      }),
    );

    const precedences = sources.map((s) => s.precedence);
    expect(precedences).toEqual([2, 3, 4, 4, 5, 7, 7, 8, 9, 10]);
    expect(sources.map((s) => s.type)).toEqual([
      'popeye_base',
      'global_operator',
      'context_compat',
      'workspace',
      'project',
      'identity',
      'soul',
      'task_brief',
      'trigger_overlay',
      'runtime_notes',
    ]);
  });

  it('produces deterministic hashes for same content across calls', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolver-hash-'));
    writeFileSync(join(dir, 'WORKSPACE.md'), 'deterministic');

    const deps = makeDeps({ getWorkspace: () => ({ id: 'ws', name: 'Test', rootPath: dir }) });
    const first = resolveInstructionSources({ workspaceId: 'ws' }, deps);
    const second = resolveInstructionSources({ workspaceId: 'ws' }, deps);

    expect(first[0]!.contentHash).toBe(second[0]!.contentHash);
  });

  it('skips missing files gracefully', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolver-miss-'));

    const sources = resolveInstructionSources(
      { workspaceId: 'ws' },
      makeDeps({ getWorkspace: () => ({ id: 'ws', name: 'Test', rootPath: dir }) }),
    );

    expect(sources).toHaveLength(0);
  });

  it('compile round-trip produces valid bundle from resolved sources', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolver-rt-'));
    writeFileSync(join(dir, 'WORKSPACE.md'), 'workspace content');

    const sources = resolveInstructionSources(
      { workspaceId: 'ws', taskBrief: 'hello' },
      makeDeps({ getWorkspace: () => ({ id: 'ws', name: 'Test', rootPath: dir }) }),
    );

    const bundle = compileInstructionBundle(sources);
    expect(bundle.sources).toHaveLength(2);
    expect(bundle.compiledText).toContain('workspace content');
    expect(bundle.compiledText).toContain('hello');
    expect(bundle.bundleHash).toBeTruthy();
    expect(bundle.warnings).toHaveLength(0);
  });

  it('does not warn for expected same-band compatibility and soul sources', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolver-warning-'));
    const nestedDir = join(dir, 'subdir');
    mkdirSync(join(dir, 'identities'), { recursive: true });
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(join(dir, 'AGENTS.md'), 'compat');
    writeFileSync(join(dir, 'WORKSPACE.md'), 'workspace');
    writeFileSync(join(dir, 'identities', 'default.md'), 'identity');
    writeFileSync(join(dir, 'SOUL.md'), 'soul');

    const bundle = compileInstructionBundle(
      resolveInstructionSources(
        { workspaceId: 'ws', cwd: nestedDir, identity: 'default' },
        makeDeps({ getWorkspace: () => ({ id: 'ws', name: 'Test', rootPath: dir }) }),
      ),
    );

    expect(bundle.warnings).toEqual([]);
  });

  it('identical resolved sources produce identical bundleHash', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolver-snap-'));
    writeFileSync(join(dir, 'WORKSPACE.md'), 'stable');

    const deps = makeDeps({ getWorkspace: () => ({ id: 'ws', name: 'Test', rootPath: dir }) });
    const ctx = { workspaceId: 'ws' };
    const bundle1 = compileInstructionBundle(resolveInstructionSources(ctx, deps));
    const bundle2 = compileInstructionBundle(resolveInstructionSources(ctx, deps));

    expect(bundle1.bundleHash).toBe(bundle2.bundleHash);
  });

  it('builds a deterministic playbook instruction source at precedence 6', () => {
    const source = buildPlaybookInstructionSource([
      {
        recordId: 'global:triage',
        id: 'triage',
        title: 'Triage',
        status: 'active',
        scope: 'global',
        workspaceId: null,
        projectId: null,
        path: '/tmp/playbooks/triage.md',
        body: 'Do triage',
        contentHash: 'body-hash',
        revisionHash: 'rev-1',
        allowedProfileIds: [],
      },
      {
        recordId: 'workspace:ws-1:review',
        id: 'review',
        title: 'Review',
        status: 'active',
        scope: 'workspace',
        workspaceId: 'ws-1',
        projectId: null,
        path: '/tmp/ws/.popeye/playbooks/review.md',
        body: 'Review changes',
        contentHash: 'body-hash-2',
        revisionHash: 'rev-2',
        allowedProfileIds: [],
      },
    ]);

    expect(source).toEqual({
      precedence: 6,
      type: 'playbook',
      inlineId: 'playbooks',
      contentHash: sha256('Do triage\n\nReview changes'),
      content: 'Do triage\n\nReview changes',
    });
  });
});
