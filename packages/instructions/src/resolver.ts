import { readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

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

function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const relativePath = relative(rootPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function collectCompatContextPaths(workspaceRoot: string, effectiveCwd?: string): string[] {
  const resolvedWorkspaceRoot = resolve(workspaceRoot);
  const requestedCwd = effectiveCwd ? resolve(effectiveCwd) : resolvedWorkspaceRoot;
  const startPath = isPathWithinRoot(requestedCwd, resolvedWorkspaceRoot) ? requestedCwd : resolvedWorkspaceRoot;
  const discovered: string[] = [];

  let current = startPath;
  while (isPathWithinRoot(current, resolvedWorkspaceRoot)) {
    discovered.push(join(current, 'AGENTS.md'));
    if (current === resolvedWorkspaceRoot) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return discovered.reverse();
}

function walkMarkdownFiles(dirPath: string): string[] {
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        files.push(...walkMarkdownFiles(fullPath));
        continue;
      }
      if (entry.isFile() && fullPath.endsWith('.md')) {
        files.push(fullPath);
      }
    }
    return files.sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

function collectNativeContextPaths(workspaceRoot: string): string[] {
  return walkMarkdownFiles(join(workspaceRoot, '.popeye', 'context'));
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
    for (const compatPath of collectCompatContextPaths(workspace.rootPath, context.cwd)) {
      const compatContent = tryReadFile(compatPath);
      if (compatContent) {
        sources.push(makeSource(4, 'context_compat', compatContent, compatPath));
      }
    }

    for (const nativePath of collectNativeContextPaths(workspace.rootPath)) {
      const nativeContent = tryReadFile(nativePath);
      if (nativeContent) {
        sources.push(makeSource(4, 'context_native', nativeContent, nativePath));
      }
    }

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

  if (workspace?.rootPath) {
    const soulPath = join(workspace.rootPath, 'SOUL.md');
    const soulContent = tryReadFile(soulPath);
    if (soulContent) {
      sources.push(makeSource(7, 'soul', soulContent, soulPath));
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
