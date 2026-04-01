import { randomUUID } from 'node:crypto';

import {
  type AppliedPlaybook,
  type CompiledInstructionBundle,
  type InstructionSource,
  type ResolvedPlaybook,
  AppliedPlaybookSchema,
} from '@popeye/contracts';
import { sha256 } from '@popeye/observability';

export { resolveInstructionSources } from './resolver.js';
export type { ResolverDependencies, WorkspaceDescriptor, ProjectDescriptor } from './resolver.js';

interface CompileInstructionBundleInput {
  sources: InstructionSource[];
  playbooks?: AppliedPlaybook[];
}

function isExpectedSharedPrecedenceGroup(group: InstructionSource[]): boolean {
  if (group.length <= 1) return true;
  const precedence = group[0]?.precedence;
  if (precedence === 4) {
    const workspaceCount = group.filter((source) => source.type === 'workspace').length;
    return workspaceCount <= 1
      && group.every((source) => source.type === 'context_compat' || source.type === 'context_native' || source.type === 'workspace');
  }
  if (precedence === 7) {
    const identityCount = group.filter((source) => source.type === 'identity').length;
    const soulCount = group.filter((source) => source.type === 'soul').length;
    return identityCount <= 1
      && soulCount <= 1
      && group.every((source) => source.type === 'identity' || source.type === 'soul');
  }
  return false;
}

function normalizeCompileInput(
  input: InstructionSource[] | CompileInstructionBundleInput,
): CompileInstructionBundleInput {
  if (Array.isArray(input)) {
    return { sources: input, playbooks: [] };
  }
  return {
    sources: input.sources,
    playbooks: (input.playbooks ?? []).map((playbook) => AppliedPlaybookSchema.parse(playbook)),
  };
}

export function buildPlaybookInstructionSource(playbooks: ResolvedPlaybook[]): InstructionSource | null {
  if (playbooks.length === 0) return null;
  const content = playbooks.map((playbook) => playbook.body).join('\n\n');
  return {
    precedence: 6,
    type: 'playbook',
    inlineId: 'playbooks',
    contentHash: sha256(content),
    content,
  };
}

export function compileInstructionBundle(
  input: InstructionSource[] | CompileInstructionBundleInput,
): CompiledInstructionBundle {
  const normalized = normalizeCompileInput(input);
  const orderedSources = [...normalized.sources].sort((left, right) => left.precedence - right.precedence);
  const warnings: string[] = [];

  for (let index = 0; index < orderedSources.length;) {
    const precedence = orderedSources[index]?.precedence;
    if (precedence == null) break;
    const group: InstructionSource[] = [];
    while (orderedSources[index]?.precedence === precedence) {
      group.push(orderedSources[index]!);
      index += 1;
    }
    if (group.length > 1 && !isExpectedSharedPrecedenceGroup(group)) {
      warnings.push(`Multiple sources share precedence ${precedence}`);
    }
  }

  const compiledText = orderedSources.map((source) => source.content).join('\n\n');
  return {
    id: randomUUID(),
    sources: orderedSources,
    playbooks: normalized.playbooks ?? [],
    compiledText,
    bundleHash: sha256(compiledText),
    warnings,
    createdAt: new Date().toISOString(),
  };
}
