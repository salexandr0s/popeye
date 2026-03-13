import { evaluateCriticalFileMutation } from '@popeye/runtime-core';

export const WORKSPACE_CRITICAL_FILES = ['WORKSPACE.md', 'PROJECT.md', 'IDENTITY.md', 'HEARTBEAT.md'] as const;

export function canWriteWorkspacePath(path: string, approved: boolean): boolean {
  return evaluateCriticalFileMutation({ path, approved }).allowed;
}
