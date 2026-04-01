import type { InstructionResolutionContext } from '@popeye/contracts';

import type { CommandContext } from '../formatters.js';
import { readFlagValue, requireArg } from '../formatters.js';

function buildPreviewContext(workspaceFlag = '--workspace', projectFlag = '--project'): InstructionResolutionContext {
  const workspaceId = readFlagValue(workspaceFlag) ?? 'default';
  const projectId = readFlagValue(projectFlag);
  const profileId = readFlagValue('--profile');
  const cwd = readFlagValue('--cwd');
  const identity = readFlagValue('--identity');
  return {
    workspaceId,
    ...(projectId ? { projectId } : {}),
    ...(profileId ? { profileId } : {}),
    ...(cwd ? { cwd } : {}),
    ...(identity ? { identity } : {}),
  };
}

function toPreviewOptions(context: InstructionResolutionContext): {
  projectId?: string;
  profileId?: string;
  cwd?: string;
  identity?: string;
} {
  return {
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(context.profileId ? { profileId: context.profileId } : {}),
    ...(context.cwd ? { cwd: context.cwd } : {}),
    ...(context.identity ? { identity: context.identity } : {}),
  };
}

export async function handleInstructions(ctx: CommandContext): Promise<void> {
  const { client, subcommand, jsonFlag } = ctx;

  if (subcommand === 'preview') {
    const context = buildPreviewContext();
    const explain = process.argv.includes('--explain');
    const previewOptions = toPreviewOptions(context);
    if (explain) {
      const result = await client.explainInstructionPreview(context.workspaceId, previewOptions);
      console.info(JSON.stringify(result, null, 2));
      return;
    }
    const result = await client.getInstructionPreview(context.workspaceId, previewOptions);
    if (jsonFlag) {
      console.info(JSON.stringify(result, null, 2));
    } else {
      console.info(`Bundle ${result.id}`);
      console.info(`  Sources: ${result.sources.length}`);
      console.info(`  Hash:    ${result.bundleHash}`);
    }
    return;
  }

  if (subcommand === 'diff') {
    const left = buildPreviewContext('--left-workspace', '--left-project');
    const right = buildPreviewContext('--right-workspace', '--right-project');
    const leftProfile = readFlagValue('--left-profile');
    const rightProfile = readFlagValue('--right-profile');
    const leftCwd = readFlagValue('--left-cwd');
    const rightCwd = readFlagValue('--right-cwd');
    const leftIdentity = readFlagValue('--left-identity');
    const rightIdentity = readFlagValue('--right-identity');
    const result = await client.diffInstructionPreviews({
      left: {
        ...left,
        ...(leftProfile ? { profileId: leftProfile } : {}),
        ...(leftCwd ? { cwd: leftCwd } : {}),
        ...(leftIdentity ? { identity: leftIdentity } : {}),
      },
      right: {
        ...right,
        ...(rightProfile ? { profileId: rightProfile } : {}),
        ...(rightCwd ? { cwd: rightCwd } : {}),
        ...(rightIdentity ? { identity: rightIdentity } : {}),
      },
    });
    console.info(JSON.stringify(result, null, 2));
    return;
  }
}

export async function handleIdentity(ctx: CommandContext): Promise<void> {
  const { client, subcommand, arg1, jsonFlag } = ctx;
  const workspaceId = readFlagValue('--workspace') ?? 'default';

  if (subcommand === 'list') {
    const identities = await client.listIdentities(workspaceId);
    if (jsonFlag) {
      console.info(JSON.stringify(identities, null, 2));
    } else if (identities.length === 0) {
      console.info(`No identities found for workspace ${workspaceId}.`);
    } else {
      for (const identity of identities) {
        console.info(`${identity.selected ? '*' : ' '} ${identity.id}  ${identity.path}`);
      }
    }
    return;
  }

  if (subcommand === 'current') {
    const current = await client.getDefaultIdentity(workspaceId);
    console.info(JSON.stringify(current, null, 2));
    return;
  }

  if (subcommand === 'show') {
    requireArg(arg1, 'identityId');
    const identities = await client.listIdentities(workspaceId);
    const identity = identities.find((entry) => entry.id === arg1);
    if (!identity) {
      console.error(`Identity not found: ${arg1}`);
      process.exit(1);
    }
    console.info(JSON.stringify(identity, null, 2));
    return;
  }

  if (subcommand === 'use') {
    requireArg(arg1, 'identityId');
    const current = await client.setDefaultIdentity(workspaceId, arg1);
    console.info(JSON.stringify(current, null, 2));
    return;
  }
}
