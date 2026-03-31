import type { CompiledInstructionBundle, ResolvedPlaybook } from '@popeye/contracts';
import { CompiledInstructionBundleSchema } from '@popeye/contracts';
import {
  buildPlaybookInstructionSource,
  compileInstructionBundle,
  resolveInstructionSources,
  type ResolverDependencies,
} from '@popeye/instructions';
import { toAppliedPlaybook } from '@popeye/playbooks';
import type { WorkspaceRegistry } from '@popeye/workspace';

import type { RuntimeDatabases } from './database.js';
import type { PlaybookService } from './playbook-service.js';

export class InstructionPreviewContextError extends Error {
  readonly errorCode: 'not_found' | 'invalid_context';

  constructor(errorCode: 'not_found' | 'invalid_context', message: string) {
    super(message);
    this.name = 'InstructionPreviewContextError';
    this.errorCode = errorCode;
  }
}

export interface ResolvedInstructionRunBundle {
  bundle: CompiledInstructionBundle;
  resolvedPlaybooks: ResolvedPlaybook[];
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
  playbookService: PlaybookService,
  scope: string,
  projectId?: string,
): CompiledInstructionBundle {
  validateInstructionPreviewContext(workspaceRegistry, scope, projectId);
  const resolvedPlaybooks = playbookService.resolveForContext({
    workspaceId: scope,
    ...(projectId ? { projectId } : {}),
    profileId: null,
  });
  const playbookSource = buildPlaybookInstructionSource(resolvedPlaybooks);
  const bundle = compileInstructionBundle({
    sources: [
      ...resolveInstructionSources(
        {
          workspaceId: scope,
          ...(projectId ? { projectId } : {}),
          identity: 'default',
        },
        buildResolverDependencies(workspaceRegistry),
      ),
      ...(playbookSource ? [playbookSource] : []),
    ],
    playbooks: resolvedPlaybooks.map((playbook) => toAppliedPlaybook(playbook)),
  });
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
  playbookService: PlaybookService,
  task: { workspaceId: string; projectId: string | null; profileId: string | null; prompt: string },
): ResolvedInstructionRunBundle {
  const resolvedPlaybooks = playbookService.resolveForContext({
    workspaceId: task.workspaceId,
    ...(task.projectId ? { projectId: task.projectId } : {}),
    profileId: task.profileId ?? null,
  });
  const playbookSource = buildPlaybookInstructionSource(resolvedPlaybooks);
  const bundle = compileInstructionBundle({
    sources: [
      ...resolveInstructionSources(
        {
          workspaceId: task.workspaceId,
          ...(task.projectId ? { projectId: task.projectId } : {}),
          ...(task.profileId ? { profileId: task.profileId } : {}),
          taskBrief: task.prompt,
        },
        buildResolverDependencies(workspaceRegistry),
      ),
      ...(playbookSource ? [playbookSource] : []),
    ],
    playbooks: resolvedPlaybooks.map((playbook) => toAppliedPlaybook(playbook)),
  });
  databases.app.prepare('INSERT INTO instruction_snapshots (id, scope, project_id, bundle_json, created_at) VALUES (?, ?, ?, ?, ?)').run(
    bundle.id,
    task.workspaceId,
    task.projectId ?? null,
    JSON.stringify(bundle),
    bundle.createdAt,
  );
  return {
    bundle: CompiledInstructionBundleSchema.parse(bundle),
    resolvedPlaybooks,
  };
}
