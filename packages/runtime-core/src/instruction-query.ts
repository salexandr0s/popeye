import type { CompiledInstructionBundle } from '@popeye/contracts';
import { CompiledInstructionBundleSchema } from '@popeye/contracts';
import { compileInstructionBundle, resolveInstructionSources, type ResolverDependencies } from '@popeye/instructions';
import type { WorkspaceRegistry } from '@popeye/workspace';

import type { RuntimeDatabases } from './database.js';

export class InstructionPreviewContextError extends Error {
  readonly errorCode: 'not_found' | 'invalid_context';

  constructor(errorCode: 'not_found' | 'invalid_context', message: string) {
    super(message);
    this.name = 'InstructionPreviewContextError';
    this.errorCode = errorCode;
  }
}

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

function validateInstructionPreviewContext(workspaceRegistry: WorkspaceRegistry, scope: string, projectId?: string): void {
  const workspace = workspaceRegistry.getWorkspace(scope);
  if (!workspace) {
    throw new InstructionPreviewContextError('not_found', `Workspace ${scope} not found`);
  }
  if (!projectId) return;
  const project = workspaceRegistry.getProject(projectId);
  if (!project) {
    throw new InstructionPreviewContextError('not_found', `Project ${projectId} not found`);
  }
  if (project.workspaceId !== scope) {
    throw new InstructionPreviewContextError(
      'invalid_context',
      `Project ${projectId} does not belong to workspace ${scope}`,
    );
  }
}

export function createInstructionPreview(
  databases: RuntimeDatabases,
  workspaceRegistry: WorkspaceRegistry,
  scope: string,
  projectId?: string,
): CompiledInstructionBundle {
  validateInstructionPreviewContext(workspaceRegistry, scope, projectId);
  const bundle = compileInstructionBundle(
    resolveInstructionSources(
      { workspaceId: scope, projectId, identity: 'default' },
      buildResolverDependencies(workspaceRegistry),
    ),
  );
  databases.app.prepare('INSERT INTO instruction_snapshots (id, scope, project_id, bundle_json, created_at) VALUES (?, ?, ?, ?, ?)').run(
    bundle.id,
    scope,
    projectId ?? null,
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
  databases.app.prepare('INSERT INTO instruction_snapshots (id, scope, project_id, bundle_json, created_at) VALUES (?, ?, ?, ?, ?)').run(
    bundle.id,
    task.workspaceId,
    task.projectId ?? null,
    JSON.stringify(bundle),
    bundle.createdAt,
  );
  return CompiledInstructionBundleSchema.parse(bundle);
}
