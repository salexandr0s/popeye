import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  compileInstructionBundle,
  resolveInstructionSources,
  type ResolverDependencies,
} from '@popeye/instructions';

function makeDeps(overrides: Partial<ResolverDependencies> = {}): ResolverDependencies {
  return {
    getWorkspace: () => null,
    getProject: () => null,
    getPopeyeBaseInstructions: () => null,
    getGlobalOperatorInstructions: () => null,
    ...overrides,
  };
}

describe('golden: instruction precedence', () => {
  it('sources are sorted by ascending precedence (2=base through 10=runtime_notes)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'golden-prec-'));
    const projDir = join(dir, 'proj');
    mkdirSync(join(dir, 'identities'), { recursive: true });
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(dir, 'WORKSPACE.md'), 'workspace instructions');
    writeFileSync(join(projDir, 'PROJECT.md'), 'project instructions');
    writeFileSync(join(dir, 'identities', 'agent.md'), 'identity instructions');

    const sources = resolveInstructionSources(
      {
        workspaceId: 'ws',
        projectId: 'proj',
        identity: 'agent',
        taskBrief: 'task brief text',
        triggerOverlay: 'trigger overlay text',
        runtimeNotes: 'runtime notes text',
      },
      makeDeps({
        getWorkspace: () => ({ id: 'ws', name: 'Test', rootPath: dir }),
        getProject: () => ({ id: 'proj', name: 'Proj', path: projDir, workspaceId: 'ws' }),
        getPopeyeBaseInstructions: () => 'popeye base instructions',
        getGlobalOperatorInstructions: () => 'global operator instructions',
      }),
    );

    expect(sources.map((s) => s.precedence)).toEqual([2, 3, 4, 5, 7, 8, 9, 10]);
    expect(sources.map((s) => s.type)).toEqual([
      'popeye_base',
      'global_operator',
      'workspace',
      'project',
      'identity',
      'task_brief',
      'trigger_overlay',
      'runtime_notes',
    ]);
  });

  it('identical inputs produce identical bundleHash', () => {
    const dir = mkdtempSync(join(tmpdir(), 'golden-hash-'));
    writeFileSync(join(dir, 'WORKSPACE.md'), 'stable workspace content');

    const deps = makeDeps({
      getWorkspace: () => ({ id: 'ws', name: 'Test', rootPath: dir }),
      getPopeyeBaseInstructions: () => 'base',
    });
    const ctx = { workspaceId: 'ws', taskBrief: 'do the thing' };

    const bundle1 = compileInstructionBundle(resolveInstructionSources(ctx, deps));
    const bundle2 = compileInstructionBundle(resolveInstructionSources(ctx, deps));

    expect(bundle1.bundleHash).toBe(bundle2.bundleHash);
    expect(bundle1.bundleHash).toBeTruthy();
  });

  it('different inputs produce different bundleHash', () => {
    const dir = mkdtempSync(join(tmpdir(), 'golden-diff-'));
    writeFileSync(join(dir, 'WORKSPACE.md'), 'workspace A');

    const deps = makeDeps({
      getWorkspace: () => ({ id: 'ws', name: 'Test', rootPath: dir }),
    });

    const bundleA = compileInstructionBundle(
      resolveInstructionSources({ workspaceId: 'ws', taskBrief: 'task A' }, deps),
    );
    const bundleB = compileInstructionBundle(
      resolveInstructionSources({ workspaceId: 'ws', taskBrief: 'task B' }, deps),
    );

    expect(bundleA.bundleHash).not.toBe(bundleB.bundleHash);
  });

  it('compiledText concatenates sources with double-newline separators', () => {
    const dir = mkdtempSync(join(tmpdir(), 'golden-concat-'));
    writeFileSync(join(dir, 'WORKSPACE.md'), 'workspace part');

    const deps = makeDeps({
      getWorkspace: () => ({ id: 'ws', name: 'Test', rootPath: dir }),
      getPopeyeBaseInstructions: () => 'base part',
    });

    const bundle = compileInstructionBundle(
      resolveInstructionSources(
        { workspaceId: 'ws', taskBrief: 'brief part' },
        deps,
      ),
    );

    expect(bundle.compiledText).toMatchInlineSnapshot(`"base part

workspace part

brief part"`);
  });
});
