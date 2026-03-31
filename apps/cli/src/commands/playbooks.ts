import type { CommandContext } from '../formatters.js';
import { requireArg } from '../formatters.js';

function readOptionalNote(args: string[], offset: number): string | undefined {
  const value = args[offset];
  return value && value.trim().length > 0 ? value : undefined;
}

export async function handlePlaybook(ctx: CommandContext): Promise<void> {
  const { client, subcommand, arg1, positionalArgs } = ctx;

  if (subcommand === 'list') {
    console.info(JSON.stringify(await client.listPlaybooks(), null, 2));
    return;
  }

  if (subcommand === 'show') {
    requireArg(arg1, 'recordId');
    console.info(JSON.stringify(await client.getPlaybook(arg1), null, 2));
    return;
  }

  if (subcommand === 'revisions') {
    requireArg(arg1, 'recordId');
    console.info(JSON.stringify(await client.listPlaybookRevisions(arg1), null, 2));
    return;
  }

  if (subcommand === 'usage') {
    requireArg(arg1, 'recordId');
    console.info(JSON.stringify(await client.listPlaybookUsage(arg1), null, 2));
    return;
  }

  if (subcommand === 'proposals') {
    console.info(JSON.stringify(await client.listPlaybookProposals(), null, 2));
    return;
  }

  if (subcommand === 'proposal') {
    requireArg(arg1, 'proposalId');
    console.info(JSON.stringify(await client.getPlaybookProposal(arg1), null, 2));
    return;
  }

  if (subcommand === 'approve') {
    requireArg(arg1, 'proposalId');
    const note = readOptionalNote(positionalArgs, 4);
    console.info(JSON.stringify(await client.reviewPlaybookProposal(arg1, {
      decision: 'approved',
      reviewedBy: 'operator',
      note: note ?? '',
    }), null, 2));
    return;
  }

  if (subcommand === 'reject') {
    requireArg(arg1, 'proposalId');
    const note = readOptionalNote(positionalArgs, 4);
    console.info(JSON.stringify(await client.reviewPlaybookProposal(arg1, {
      decision: 'rejected',
      reviewedBy: 'operator',
      note: note ?? '',
    }), null, 2));
    return;
  }

  if (subcommand === 'apply') {
    requireArg(arg1, 'proposalId');
    console.info(JSON.stringify(await client.applyPlaybookProposal(arg1, {
      appliedBy: 'operator',
    }), null, 2));
    return;
  }

  if (subcommand === 'activate') {
    requireArg(arg1, 'recordId');
    console.info(JSON.stringify(await client.activatePlaybook(arg1, {
      updatedBy: 'operator',
    }), null, 2));
    return;
  }

  if (subcommand === 'retire') {
    requireArg(arg1, 'recordId');
    console.info(JSON.stringify(await client.retirePlaybook(arg1, {
      updatedBy: 'operator',
    }), null, 2));
    return;
  }
}
