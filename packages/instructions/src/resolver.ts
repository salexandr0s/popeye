import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { InstructionResolutionContext, InstructionSource } from '@popeye/contracts';
import { sha256 } from '@popeye/observability';

export interface WorkspaceDescriptor {
  id: string;
  name: string;
  rootPath: string | null;
}

export interface ProjectDescriptor {
  id: string;
  name: string;
  path: string | null;
  workspaceId: string;
}

export interface ResolverDependencies {
  getWorkspace(id: string): WorkspaceDescriptor | null;
  getProject(id: string): ProjectDescriptor | null;
  getPopeyeBaseInstructions(): string | null;
  getGlobalOperatorInstructions(): string | null;
}

function tryReadFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function makeSource(
  precedence: number,
  type: InstructionSource['type'],
  content: string,
  filePath?: string,
  inlineId?: string,
): InstructionSource {
  return {
    precedence,
    type,
    path: filePath,
    inlineId,
    contentHash: sha256(content),
    content,
  };
}

export function resolveInstructionSources(
  context: InstructionResolutionContext,
  deps: ResolverDependencies,
): InstructionSource[] {
  const sources: InstructionSource[] = [];

  const popeyeBase = deps.getPopeyeBaseInstructions();
  if (popeyeBase) {
    sources.push(makeSource(2, 'popeye_base', popeyeBase, undefined, 'popeye_base'));
  }

  const globalOperator = deps.getGlobalOperatorInstructions();
  if (globalOperator) {
    sources.push(makeSource(3, 'global_operator', globalOperator, undefined, 'global_operator'));
  }

  const workspace = deps.getWorkspace(context.workspaceId);

  if (workspace?.rootPath) {
    const workspacePath = join(workspace.rootPath, 'WORKSPACE.md');
    const workspaceContent = tryReadFile(workspacePath);
    if (workspaceContent) {
      sources.push(makeSource(4, 'workspace', workspaceContent, workspacePath));
    }
  }

  if (context.projectId) {
    const project = deps.getProject(context.projectId);
    if (project?.path) {
      const projectPath = join(project.path, 'PROJECT.md');
      const projectContent = tryReadFile(projectPath);
      if (projectContent) {
        sources.push(makeSource(5, 'project', projectContent, projectPath));
      }
    }
  }

  if (context.identity && workspace?.rootPath) {
    const identityPath = join(workspace.rootPath, 'identities', `${context.identity}.md`);
    const identityContent = tryReadFile(identityPath);
    if (identityContent) {
      sources.push(makeSource(7, 'identity', identityContent, identityPath));
    }
  }

  if (context.taskBrief) {
    sources.push(makeSource(8, 'task_brief', context.taskBrief, undefined, 'task_brief'));
  }

  if (context.triggerOverlay) {
    sources.push(makeSource(9, 'trigger_overlay', context.triggerOverlay, undefined, 'trigger_overlay'));
  }

  if (context.runtimeNotes) {
    sources.push(makeSource(10, 'runtime_notes', context.runtimeNotes, undefined, 'runtime_notes'));
  }

  return sources;
}
