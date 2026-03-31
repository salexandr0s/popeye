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

  for (let index = 1; index < orderedSources.length; index += 1) {
    const previousSource = orderedSources[index - 1];
    const currentSource = orderedSources[index];
    if (previousSource && currentSource && previousSource.precedence === currentSource.precedence) {
      warnings.push(`Multiple sources share precedence ${currentSource.precedence}`);
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
