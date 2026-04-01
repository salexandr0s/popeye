import { ApiError } from '@popeye/api-client';
import { renderReceipt } from '@popeye/receipts';

import type { CommandContext } from '../formatters.js';
import { formatEnvelope, formatRun, requireArg } from '../formatters.js';

export async function handleRun(ctx: CommandContext): Promise<void> {
  const { client, subcommand, arg1, jsonFlag } = ctx;

  if (subcommand === 'show') {
    requireArg(arg1, 'runId');
    try {
      const run = await client.getRun(arg1);
      const envelope = await client.getRunEnvelope(arg1).catch((error: unknown) => {
        if (error instanceof ApiError && error.statusCode === 404) {
          return null;
        }
        throw error;
      });
      if (jsonFlag) {
        console.info(JSON.stringify(run, null, 2));
      } else {
        console.info(formatRun(run, envelope));
      }
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 404) {
        console.info(`Run not found: ${arg1}`);
        return;
      }
      throw error;
    }
    return;
  }

  if (subcommand === 'envelope') {
    requireArg(arg1, 'runId');
    try {
      const envelope = await client.getRunEnvelope(arg1);
      if (jsonFlag) {
        console.info(JSON.stringify(envelope, null, 2));
      } else {
        console.info(formatEnvelope(envelope));
      }
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 404) {
        console.info(`Execution envelope not found for run: ${arg1}`);
        return;
      }
      throw error;
    }
    return;
  }
}

export async function handleRuns(ctx: CommandContext): Promise<void> {
  const { client, subcommand } = ctx;

  if (subcommand === 'tail') {
    console.info(JSON.stringify((await client.listRuns()).slice(0, 20), null, 2));
    return;
  }

  if (subcommand === 'failures') {
    console.info(
      JSON.stringify(
        await client.listRuns({ state: ['failed_retryable', 'failed_final', 'abandoned'] }),
        null,
        2,
      ),
    );
    return;
  }
}

export async function handleReceipt(ctx: CommandContext): Promise<void> {
  const { client, subcommand, arg1, jsonFlag } = ctx;

  if (subcommand === 'show') {
    requireArg(arg1, 'receiptId');
    try {
      const receipt = await client.getReceipt(arg1);
      if (jsonFlag) {
        console.info(JSON.stringify(receipt, null, 2));
      } else {
        console.info(renderReceipt(receipt));
      }
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 404) {
        console.info(`Receipt not found: ${arg1}`);
        return;
      }
      throw error;
    }
    return;
  }

  if (subcommand === 'search') {
    requireArg(arg1, 'query');
    const result = await client.searchMemory({
      query: arg1,
      memoryTypes: ['episodic'],
      limit: 20,
      includeContent: process.argv.includes('--full'),
    });
    console.info(JSON.stringify(result, null, 2));
    return;
  }
}

export async function handleInterventions(ctx: CommandContext): Promise<void> {
  const { client, subcommand } = ctx;

  if (subcommand === 'list') {
    console.info(JSON.stringify(await client.listInterventions(), null, 2));
    return;
  }
}

export async function handleRecovery(ctx: CommandContext): Promise<void> {
  const { client, subcommand, arg1 } = ctx;

  if (subcommand === 'retry') {
    requireArg(arg1, 'runId');
    console.info(JSON.stringify(await client.retryRun(arg1), null, 2));
    return;
  }
}

export async function handleJobs(ctx: CommandContext): Promise<void> {
  const { client, subcommand, arg1 } = ctx;

  if (subcommand === 'list') {
    console.info(JSON.stringify(await client.listJobs(), null, 2));
    return;
  }

  if (subcommand === 'pause') {
    requireArg(arg1, 'jobId');
    const result = await client.pauseJob(arg1);
    console.info(result ? JSON.stringify(result, null, 2) : 'No-op: job not in pauseable state');
    return;
  }

  if (subcommand === 'resume') {
    requireArg(arg1, 'jobId');
    const result = await client.resumeJob(arg1);
    console.info(result ? JSON.stringify(result, null, 2) : 'No-op: job not paused');
    return;
  }
}

export async function handleSessions(ctx: CommandContext): Promise<void> {
  const { client, subcommand } = ctx;

  if (subcommand === 'list') {
    console.info(JSON.stringify(await client.listSessionRoots(), null, 2));
    return;
  }
}

export async function handleTask(ctx: CommandContext): Promise<void> {
  const { client, subcommand, jsonFlag, positionalArgs } = ctx;

  if (subcommand === 'run') {
    const profileIdx = process.argv.indexOf('--profile');
    const profileId = profileIdx !== -1 ? process.argv[profileIdx + 1] ?? 'default' : 'default';
    const identityIdx = process.argv.indexOf('--identity');
    const identityId = identityIdx !== -1 ? process.argv[identityIdx + 1] ?? 'default' : undefined;
    const taskArgs = positionalArgs.slice(4);
    const flagNames = new Set(['--profile', '--identity']);
    const nonFlagTaskArgs = taskArgs.filter((value, index) => !flagNames.has(value) && !flagNames.has(taskArgs[index - 1] ?? ''));
    const title = nonFlagTaskArgs[0] ?? 'cli-task';
    const prompt = nonFlagTaskArgs[1] ?? nonFlagTaskArgs[0] ?? 'hello from pop';
    const result = await client.createTask({
      workspaceId: 'default',
      projectId: null,
      profileId,
      ...(identityId ? { identityId } : {}),
      title,
      prompt,
      source: 'manual',
      autoEnqueue: true,
    });
    if (jsonFlag) {
      console.info(JSON.stringify(result, null, 2));
    } else {
      const lines = [
        `Task: ${result.task.title} (${result.task.id})`,
        `  Status: ${result.task.status}`,
        `  Profile: ${result.task.profileId}`,
        `  Identity: ${result.task.identityId}`,
      ];
      if (result.job) lines.push(`  Job:    ${result.job.status} (${result.job.id})`);
      if (result.run) lines.push(`  Run:    ${result.run.state} (${result.run.id})`);
      console.info(lines.join('\n'));
    }
    return;
  }
}

export async function handleProfile(ctx: CommandContext): Promise<void> {
  const { client, subcommand, arg1, jsonFlag } = ctx;

  if (subcommand === 'list') {
    const profiles = await client.listProfiles();
    if (jsonFlag) {
      console.info(JSON.stringify(profiles, null, 2));
    } else if (profiles.length === 0) {
      console.info('No execution profiles found.');
    } else {
      for (const profile of profiles) {
        console.info(`  ${profile.id.padEnd(18)} ${profile.mode.padEnd(12)} ${profile.name}`);
      }
    }
    return;
  }

  if (subcommand === 'show') {
    requireArg(arg1, 'id');
    try {
      const { formatProfile } = await import('../formatters.js');
      const profile = await client.getProfile(arg1);
      if (jsonFlag) {
        console.info(JSON.stringify(profile, null, 2));
      } else {
        console.info(formatProfile(profile));
      }
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 404) {
        console.info(`Profile not found: ${arg1}`);
        return;
      }
      throw error;
    }
    return;
  }
}
