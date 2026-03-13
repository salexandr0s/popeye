import { randomUUID } from 'node:crypto';

import {
  type CompiledInstructionBundle,
  type InstructionSource,
} from '@popeye/contracts';
import { sha256 } from '@popeye/observability';

export { resolveInstructionSources } from './resolver.js';
export type { ResolverDependencies, WorkspaceDescriptor, ProjectDescriptor } from './resolver.js';

export function compileInstructionBundle(sources: InstructionSource[]): CompiledInstructionBundle {
  const orderedSources = [...sources].sort((left, right) => left.precedence - right.precedence);
  const warnings: string[] = [];

  for (let index = 1; index < orderedSources.length; index += 1) {
    if (orderedSources[index - 1]?.precedence === orderedSources[index]?.precedence) {
      warnings.push(`Multiple sources share precedence ${orderedSources[index].precedence}`);
    }
  }

  const compiledText = orderedSources.map((source) => source.content).join('\n\n');
  return {
    id: randomUUID(),
    sources: orderedSources,
    compiledText,
    bundleHash: sha256(compiledText),
    warnings,
    createdAt: new Date().toISOString(),
  };
}
