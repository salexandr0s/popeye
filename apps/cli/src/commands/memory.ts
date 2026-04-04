import type { CommandContext } from '../formatters.js';
import { readFlagValue, requireArg } from '../formatters.js';

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

  if (subcommand === 'inspect') {
    requireArg(arg1, 'id');
    const memory = await client.getMemory(arg1);
    const history = await client.getMemoryHistory(arg1);
    console.info(JSON.stringify({ memory, history }, null, 2));
    return;
  }

  if (subcommand === 'history') {
    requireArg(arg1, 'id');
    const history = await client.getMemoryHistory(arg1);
    console.info(JSON.stringify(history, null, 2));
    return;
  }

  if (subcommand === 'pin') {
    requireArg(arg1, 'id');
    const result = await client.pinMemory(arg1, { reason: 'Pinned via CLI' });
    console.info(JSON.stringify(result, null, 2));
    return;
  }

  if (subcommand === 'forget') {
    requireArg(arg1, 'id');
    const result = await client.forgetMemory(arg1, 'Forgotten via CLI');
    console.info(JSON.stringify(result, null, 2));
    return;
  }
}

export async function handleKnowledge(ctx: CommandContext): Promise<void> {
  const { client, subcommand, arg1 } = ctx;
  const workspaceId = readFlagValue('--workspace') ?? 'default';
  const kindFlag = readFlagValue('--kind') as
    | 'source_normalized'
    | 'wiki_article'
    | 'output_note'
    | undefined;

  if (subcommand === 'search') {
    requireArg(arg1, 'query');
    const result = await client.listKnowledgeDocuments({
      workspaceId,
      ...(kindFlag ? { kind: kindFlag } : {}),
      q: arg1,
    });
    console.info(JSON.stringify(result, null, 2));
    return;
  }

  if (subcommand === 'list') {
    const query = readFlagValue('--query');
    const result = await client.listKnowledgeDocuments({
      workspaceId,
      ...(kindFlag ? { kind: kindFlag } : {}),
      ...(query ? { q: query } : {}),
    });
    console.info(JSON.stringify(result, null, 2));
    return;
  }

  if (subcommand === 'show') {
    requireArg(arg1, 'id');
    try {
      console.info(JSON.stringify(await client.getKnowledgeDocument(arg1), null, 2));
      return;
    } catch {
      console.info(JSON.stringify(await client.getKnowledgeSource(arg1), null, 2));
      return;
    }
  }

  if (subcommand === 'import') {
    const sourceType = readFlagValue('--type') ?? 'manual_text';
    const title = readFlagValue('--title') ?? arg1;
    requireArg(title, 'title');
    const result = await client.importKnowledgeSource({
      workspaceId,
      sourceType: sourceType as 'local_file' | 'manual_text' | 'website' | 'pdf' | 'x_post' | 'repo' | 'dataset' | 'image',
      title,
      sourceUri: readFlagValue('--uri') ?? undefined,
      sourcePath: readFlagValue('--path') ?? undefined,
      sourceText: readFlagValue('--text') ?? undefined,
    });
    console.info(JSON.stringify(result, null, 2));
    return;
  }

  if (subcommand === 'reingest') {
    requireArg(arg1, 'sourceId');
    console.info(JSON.stringify(await client.reingestKnowledgeSource(arg1), null, 2));
    return;
  }

  if (subcommand === 'audit') {
    console.info(JSON.stringify(await client.getKnowledgeAudit(workspaceId), null, 2));
    return;
  }

  if (subcommand === 'converters') {
    console.info(JSON.stringify(await client.listKnowledgeConverters(), null, 2));
  }
}
