import type { CompiledInstructionBundle } from '@popeye/contracts';
import { CompiledInstructionBundleSchema } from '@popeye/contracts';
import { compileInstructionBundle, resolveInstructionSources, type ResolverDependencies } from '@popeye/instructions';
import type { WorkspaceRegistry } from '@popeye/workspace';

import type { RuntimeDatabases } from './database.js';

function buildResolverDependencies(workspaceRegistry: WorkspaceRegistry): ResolverDependencies {
  return {
    getWorkspace: (id) => {
      const workspace = workspaceRegistry.getWorkspace(id);
      if (!workspace) return null;
      return { id: workspace.id, name: workspace.name, rootPath: workspace.rootPath };
    },
    getProject: (id) => {
      const project = workspaceRegistry.getProject(id);
      if (!project) return null;
      return { id: project.id, name: project.name, path: project.path, workspaceId: project.workspaceId };
    },
    getPopeyeBaseInstructions: () => null,
    getGlobalOperatorInstructions: () => null,
  };
}

export function createInstructionPreview(
  databases: RuntimeDatabases,
  workspaceRegistry: WorkspaceRegistry,
  scope: string,
): CompiledInstructionBundle {
  const bundle = compileInstructionBundle(
    resolveInstructionSources({ workspaceId: scope, identity: 'default' }, buildResolverDependencies(workspaceRegistry)),
  );
  databases.app.prepare('INSERT INTO instruction_snapshots (id, scope, bundle_json, created_at) VALUES (?, ?, ?, ?)').run(
    bundle.id,
    scope,
    JSON.stringify(bundle),
    bundle.createdAt,
  );
  return CompiledInstructionBundleSchema.parse(bundle);
}

export function resolveInstructionBundleForTask(
  databases: RuntimeDatabases,
  workspaceRegistry: WorkspaceRegistry,
  task: { workspaceId: string; projectId: string | null; prompt: string },
): CompiledInstructionBundle {
  const bundle = compileInstructionBundle(
    resolveInstructionSources(
      { workspaceId: task.workspaceId, projectId: task.projectId ?? undefined, taskBrief: task.prompt },
      buildResolverDependencies(workspaceRegistry),
    ),
  );
  databases.app.prepare('INSERT INTO instruction_snapshots (id, scope, bundle_json, created_at) VALUES (?, ?, ?, ?)').run(
    bundle.id,
    task.workspaceId,
    JSON.stringify(bundle),
    bundle.createdAt,
  );
  return CompiledInstructionBundleSchema.parse(bundle);
}
