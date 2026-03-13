import { join } from 'node:path';

import { evaluateCriticalFileMutation } from '@popeye/runtime-core';

export const WORKSPACE_CRITICAL_FILES = ['WORKSPACE.md', 'PROJECT.md', 'IDENTITY.md', 'HEARTBEAT.md'] as const;

export const WORKSPACE_LAYOUT = {
  instructions: 'WORKSPACE.md',
  heartbeat: 'HEARTBEAT.md',
  memory: 'MEMORY.md',
  memoryDir: 'memory',
  dailyDir: 'memory/daily',
  identitiesDir: 'identities',
  projectsDir: 'projects',
} as const;

export const PROJECT_LAYOUT = {
  instructions: 'PROJECT.md',
  knowledgeDir: 'knowledge',
  worktreeDir: 'worktree',
} as const;

export function resolveWorkspaceFilePath(rootPath: string, file: keyof typeof WORKSPACE_LAYOUT): string {
  return join(rootPath, WORKSPACE_LAYOUT[file]);
}

export function resolveProjectFilePath(projectPath: string, file: keyof typeof PROJECT_LAYOUT): string {
  return join(projectPath, PROJECT_LAYOUT[file]);
}

export function resolveIdentityFilePath(rootPath: string, identityName: string): string {
  return join(rootPath, WORKSPACE_LAYOUT.identitiesDir, `${identityName}.md`);
}

export function canWriteWorkspacePath(path: string, approved: boolean): boolean {
  return evaluateCriticalFileMutation({ path, approved }).allowed;
}
