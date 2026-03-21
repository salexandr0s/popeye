import type { CommandContext } from '../formatters.js';
import { requireArg } from '../formatters.js';

export async function handleMemory(ctx: CommandContext): Promise<void> {
  const { client, subcommand, arg1 } = ctx;

  if (subcommand === 'search') {
    requireArg(arg1, 'query');
    const includeContent = process.argv.includes('--full');
    const result = await client.searchMemory({ query: arg1, limit: 20, includeContent });
    console.info(JSON.stringify(result, null, 2));
    return;
  }

  if (subcommand === 'audit') {
    console.info(JSON.stringify(await client.memoryAudit(), null, 2));
    return;
  }

  if (subcommand === 'list') {
    console.info(
      JSON.stringify(await client.listMemories({ ...(arg1 ? { type: arg1 } : {}), limit: 50 }), null, 2),
    );
    return;
  }

  if (subcommand === 'show') {
    requireArg(arg1, 'id');
    console.info(JSON.stringify(await client.getMemory(arg1), null, 2));
    return;
  }

  if (subcommand === 'maintenance') {
    console.info(JSON.stringify(await client.triggerMemoryMaintenance(), null, 2));
    return;
  }
}

export async function handleKnowledge(ctx: CommandContext): Promise<void> {
  const { client, subcommand, arg1 } = ctx;

  if (subcommand === 'search') {
    requireArg(arg1, 'query');
    const result = await client.searchMemory({
      query: arg1,
      memoryTypes: ['semantic', 'procedural'],
      limit: 20,
      includeContent: process.argv.includes('--full'),
    });
    console.info(JSON.stringify(result, null, 2));
    return;
  }
}
