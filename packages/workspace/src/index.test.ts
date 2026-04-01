import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  resolveWorkspaceFilePath,
  resolveProjectFilePath,
  resolveIdentityFilePath,
  canWriteWorkspacePath,
  WORKSPACE_LAYOUT,
  PROJECT_LAYOUT,
} from './index.js';

describe('resolveWorkspaceFilePath', () => {
  const root = '/tmp/workspace';

  it('resolves instructions to WORKSPACE.md', () => {
    expect(resolveWorkspaceFilePath(root, 'instructions')).toBe(join(root, 'WORKSPACE.md'));
  });

  it('resolves heartbeat to HEARTBEAT.md', () => {
    expect(resolveWorkspaceFilePath(root, 'heartbeat')).toBe(join(root, 'HEARTBEAT.md'));
  });

  it('resolves dailyDir to memory/daily', () => {
    expect(resolveWorkspaceFilePath(root, 'dailyDir')).toBe(join(root, 'memory/daily'));
  });

  it('layout keys all resolve without error', () => {
    for (const key of Object.keys(WORKSPACE_LAYOUT) as Array<keyof typeof WORKSPACE_LAYOUT>) {
      const result = resolveWorkspaceFilePath(root, key);
      expect(result).toBe(join(root, WORKSPACE_LAYOUT[key]));
    }
  });
});

describe('resolveProjectFilePath', () => {
  const projectPath = '/tmp/workspace/projects/myproject';

  it('resolves instructions to PROJECT.md', () => {
    expect(resolveProjectFilePath(projectPath, 'instructions')).toBe(join(projectPath, 'PROJECT.md'));
  });

  it('resolves knowledgeDir to knowledge', () => {
    expect(resolveProjectFilePath(projectPath, 'knowledgeDir')).toBe(join(projectPath, 'knowledge'));
  });

  it('layout keys all resolve without error', () => {
    for (const key of Object.keys(PROJECT_LAYOUT) as Array<keyof typeof PROJECT_LAYOUT>) {
      const result = resolveProjectFilePath(projectPath, key);
      expect(result).toBe(join(projectPath, PROJECT_LAYOUT[key]));
    }
  });
});

describe('resolveIdentityFilePath', () => {
  const root = '/tmp/workspace';

  it('resolves to identities/{name}.md', () => {
    const result = resolveIdentityFilePath(root, 'popeye');
    expect(result).toBe(join(root, 'identities', 'popeye.md'));
  });

  it('returns null for path traversal attempt', () => {
    const result = resolveIdentityFilePath(root, '../escape');
    expect(result).toBeNull();
  });

  it('returns null for null byte in name', () => {
    const result = resolveIdentityFilePath(root, 'bad\0name');
    expect(result).toBeNull();
  });
});

describe('canWriteWorkspacePath', () => {
  it('blocks unapproved write to WORKSPACE.md', () => {
    expect(canWriteWorkspacePath('/ws/WORKSPACE.md', false)).toBe(false);
  });

  it('blocks unapproved write to PROJECT.md', () => {
    expect(canWriteWorkspacePath('/ws/projects/foo/PROJECT.md', false)).toBe(false);
  });

  it('blocks unapproved write to SOUL.md', () => {
    expect(canWriteWorkspacePath('/ws/SOUL.md', false)).toBe(false);
  });

  it('blocks unapproved write to AGENTS.md', () => {
    expect(canWriteWorkspacePath('/ws/AGENTS.md', false)).toBe(false);
  });

  it('allows approved write to WORKSPACE.md', () => {
    expect(canWriteWorkspacePath('/ws/WORKSPACE.md', true)).toBe(true);
  });

  it('allows write to non-critical file', () => {
    expect(canWriteWorkspacePath('/ws/notes.md', false)).toBe(true);
  });
});
