import { resolve } from 'node:path';

import type { CommandContext } from '../formatters.js';

export async function handleFiles(ctx: CommandContext): Promise<void> {
  const { client, subcommand, arg1, jsonFlag } = ctx;
  const _arg2 = ctx.arg2;

  if (subcommand === 'roots') {
    const roots = await client.listFileRoots();
    if (jsonFlag) {
      console.info(JSON.stringify(roots, null, 2));
    } else {
      if (roots.length === 0) {
        console.info('No file roots registered.');
      } else {
        for (const root of roots) {
          const status = root.enabled ? 'enabled' : 'disabled';
          console.info(`  ${root.id}  ${root.label.padEnd(24)} ${root.rootPath}  [${root.permission}] [${status}]  indexed: ${root.lastIndexedCount}`);
        }
      }
    }
    return;
  }

  if (subcommand === 'add' && arg1) {
    const labelIdx = process.argv.indexOf('--label');
    const permIdx = process.argv.indexOf('--permission');
    const label = labelIdx !== -1 ? process.argv[labelIdx + 1] ?? arg1 : arg1;
    const permission = permIdx !== -1 ? process.argv[permIdx + 1] ?? 'index' : 'index';
    const root = await client.createFileRoot({
      workspaceId: 'default',
      label,
      rootPath: resolve(arg1),
      kind: 'general',
      permission: permission as 'read' | 'index' | 'index_and_derive',
      filePatterns: ['**/*.md', '**/*.txt'],
      excludePatterns: [],
      maxFileSizeBytes: 1_048_576,
    });
    console.info(`Registered file root: ${root.id} — ${root.label} (${root.rootPath})`);
    return;
  }

  if (subcommand === 'add') {
    console.error('Usage: pop files add <path> [--label <name>] [--permission <perm>]');
    process.exit(1);
  }

  if (subcommand === 'remove' && arg1) {
    await client.deleteFileRoot(arg1);
    console.info(`Disabled file root: ${arg1}`);
    return;
  }

  if (subcommand === 'search' && arg1) {
    const limitIdx = process.argv.indexOf('--limit');
    const rootIdIdx = process.argv.indexOf('--root-id');
    const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1] ?? '10', 10) : 10;
    const rootId = rootIdIdx !== -1 ? process.argv[rootIdIdx + 1] : undefined;
    const response = await client.searchFiles(arg1, { rootId, limit });
    if (jsonFlag) {
      console.info(JSON.stringify(response, null, 2));
    } else {
      if (response.results.length === 0) {
        console.info('No files found.');
      } else {
        for (const r of response.results) {
          console.info(`  ${r.relativePath}  [root:${r.fileRootId}]${r.memoryId ? ` [memory:${r.memoryId}]` : ''}`);
        }
      }
    }
    return;
  }

  if (subcommand === 'reindex' && arg1) {
    const result = await client.reindexFileRoot(arg1);
    console.info(`Reindexed: ${result.indexed} new, ${result.updated} updated, ${result.skipped} skipped, ${result.stale} stale`);
    if (result.errors.length > 0) {
      console.info(`Errors: ${result.errors.join(', ')}`);
    }
    return;
  }

  if (subcommand === 'status') {
    const roots = await client.listFileRoots();
    const totalDocs = roots.reduce((sum, r) => sum + r.lastIndexedCount, 0);
    console.info(`File roots: ${roots.length}  Total indexed files: ${totalDocs}`);
    for (const root of roots) {
      const status = root.enabled ? 'enabled' : 'disabled';
      console.info(`  ${root.label.padEnd(20)} ${root.rootPath}  [${root.permission}] [${status}]  files: ${root.lastIndexedCount}  last: ${root.lastIndexedAt ?? 'never'}`);
    }
    return;
  }

  if (subcommand === 'review') {
    const intents = await client.listFileWriteIntents({ status: 'pending' });
    if (jsonFlag) {
      console.info(JSON.stringify(intents, null, 2));
    } else if (intents.length === 0) {
      console.info('No pending write intents.');
    } else {
      for (const intent of intents) {
        console.info(`  ${intent.id.slice(0, 8)}  ${intent.intentType.padEnd(8)} ${intent.filePath}`);
        if (intent.diffPreview) {
          for (const line of intent.diffPreview.split('\n').slice(0, 5)) {
            console.info(`    ${line}`);
          }
        }
      }
    }
    return;
  }

  if (subcommand === 'apply' && arg1) {
    const result = await client.reviewFileWriteIntent(arg1, { action: 'apply' });
    console.info(`Applied write intent ${result.id}: ${result.filePath}`);
    return;
  }

  if (subcommand === 'reject' && arg1) {
    const reviewInput: { action: 'reject'; reason?: string } = { action: 'reject' };
    if (_arg2) reviewInput.reason = _arg2;
    const result = await client.reviewFileWriteIntent(arg1, reviewInput);
    console.info(`Rejected write intent ${result.id}: ${result.filePath}`);
    return;
  }
}
