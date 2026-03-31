import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { sha256 } from '@popeye/observability';

import {
  buildPlaybookDiff,
  buildPlaybookRecordId,
  discoverScopedPlaybooks,
  parsePlaybookMarkdown,
  renderPlaybookMarkdown,
  toAppliedPlaybook,
} from './index.js';

describe('@popeye/playbooks', () => {
  it('parses front matter, normalizes body text, and computes canonical hashes', () => {
    const parsed = parsePlaybookMarkdown(`---\nid: inbox-triage\ntitle: Inbox Triage\nstatus: active\nallowedProfileIds:\n  - default\n  - batch\n---\n\nStep one.\r\nStep two.\r\n`);

    expect(parsed.frontMatter).toEqual({
      id: 'inbox-triage',
      title: 'Inbox Triage',
      status: 'active',
      allowedProfileIds: ['batch', 'default'],
    });
    expect(parsed.body).toBe('Step one.\nStep two.');
    expect(parsed.contentHash).toBe(sha256('Step one.\nStep two.'));
    expect(parsed.revisionHash).toBeTruthy();
  });

  it('loads playbooks deterministically by scope and id and filters by profile id', () => {
    const dir = mkdtempSync(join(tmpdir(), 'popeye-playbooks-'));
    chmodSync(dir, 0o700);

    const globalDir = join(dir, 'runtime-playbooks');
    const workspaceDir = join(dir, 'workspace-playbooks');
    const projectDir = join(dir, 'project-playbooks');
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(workspaceDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(join(projectDir, 'project.md'), `---\nid: project-runbook\ntitle: Project Runbook\nstatus: active\nallowedProfileIds:\n  - default\n---\nProject body`);
    writeFileSync(join(globalDir, 'global.md'), `---\nid: global-baseline\ntitle: Global Baseline\nstatus: active\n---\nGlobal body`);
    writeFileSync(join(workspaceDir, 'workspace.md'), `---\nid: workspace-flow\ntitle: Workspace Flow\nstatus: active\n---\nWorkspace body`);
    writeFileSync(join(workspaceDir, 'excluded.md'), `---\nid: excluded\ntitle: Excluded\nstatus: active\nallowedProfileIds:\n  - restricted\n---\nExcluded body`);
    writeFileSync(join(globalDir, 'retired.md'), `---\nid: retired\ntitle: Retired\nstatus: retired\n---\nRetired body`);

    const result = discoverScopedPlaybooks({
      directories: [
        { scope: 'global', dirPath: globalDir },
        { scope: 'workspace', dirPath: workspaceDir, workspaceId: 'ws-1' },
        { scope: 'project', dirPath: projectDir, workspaceId: 'ws-1', projectId: 'proj-1' },
      ],
      profileId: 'default',
    });

    expect(result.all.map((playbook) => playbook.id)).toEqual([
      'global-baseline',
      'retired',
      'excluded',
      'workspace-flow',
      'project-runbook',
    ]);
    expect(result.selected.map((playbook) => playbook.id)).toEqual([
      'global-baseline',
      'workspace-flow',
      'project-runbook',
    ]);
    expect(result.selected.map((playbook) => playbook.recordId)).toEqual([
      'global:global-baseline',
      'workspace:ws-1:workspace-flow',
      'project:proj-1:project-runbook',
    ]);
  });

  it('produces an applied-playbook summary for receipts and instruction bundles', () => {
    const result = toAppliedPlaybook({
      recordId: 'workspace:ws-1:triage',
      id: 'triage',
      title: 'Triage',
      status: 'active',
      scope: 'workspace',
      workspaceId: 'ws-1',
      projectId: null,
      path: '/tmp/ws/.popeye/playbooks/triage.md',
      body: 'Do the triage',
      contentHash: 'body-hash',
      revisionHash: 'revision-hash',
      allowedProfileIds: [],
    });

    expect(result).toEqual({
      id: 'triage',
      title: 'Triage',
      scope: 'workspace',
      revisionHash: 'revision-hash',
    });
  });

  it('renders canonical markdown and round-trips draft status deterministically', () => {
    const markdown = renderPlaybookMarkdown({
      frontMatter: {
        id: 'draft-triage',
        title: 'Draft Triage',
        status: 'draft',
        allowedProfileIds: ['default', 'default', 'batch'],
      },
      body: 'Step one.\n\nStep two.',
    });

    expect(markdown).toMatchInlineSnapshot(`
      "---
      id: "draft-triage"
      title: "Draft Triage"
      status: draft
      allowedProfileIds:
        - "batch"
        - "default"
      ---
      Step one.

      Step two.
      "
    `);

    expect(parsePlaybookMarkdown(markdown).frontMatter).toEqual({
      id: 'draft-triage',
      title: 'Draft Triage',
      status: 'draft',
      allowedProfileIds: ['batch', 'default'],
    });
  });

  it('builds a readable diff preview for new and updated markdown', () => {
    const original = renderPlaybookMarkdown({
      frontMatter: {
        id: 'triage',
        title: 'Triage',
        status: 'active',
        allowedProfileIds: [],
      },
      body: 'Original body',
    });
    const updated = renderPlaybookMarkdown({
      frontMatter: {
        id: 'triage',
        title: 'Triage Revised',
        status: 'active',
        allowedProfileIds: ['default'],
      },
      body: 'Updated body',
    });

    expect(buildPlaybookDiff(null, updated)).toContain('+ id: "triage"');
    expect(buildPlaybookDiff(original, updated)).toContain('- title: "Triage"');
    expect(buildPlaybookDiff(original, updated)).toContain('+ title: "Triage Revised"');
    expect(buildPlaybookDiff(original, updated)).toContain('+ Updated body');
  });

  it('builds stable record ids for each scope', () => {
    expect(buildPlaybookRecordId({ id: 'global-triage', scope: 'global' })).toBe('global:global-triage');
    expect(buildPlaybookRecordId({ id: 'workspace-triage', scope: 'workspace', workspaceId: 'ws-1' })).toBe('workspace:ws-1:workspace-triage');
    expect(buildPlaybookRecordId({ id: 'project-triage', scope: 'project', projectId: 'proj-1' })).toBe('project:proj-1:project-triage');
  });
});
