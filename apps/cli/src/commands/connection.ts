import type { CommandContext } from '../formatters.js';
import { getFlagValue, requireArg } from '../formatters.js';

export async function handleConnection(ctx: CommandContext): Promise<void> {
  const { client, subcommand, arg1, jsonFlag } = ctx;

  if (subcommand === 'rules') {
    requireArg(arg1, 'connectionId');
    const rules = await client.listConnectionResourceRules(arg1);
    if (jsonFlag) {
      console.info(JSON.stringify(rules, null, 2));
    } else if (rules.length === 0) {
      console.info('No resource rules configured.');
    } else {
      for (const rule of rules) {
        const writeFlag = rule.writeAllowed ? ' [write]' : '';
        console.info(`  ${rule.resourceType}/${rule.resourceId}  ${rule.displayName}${writeFlag}`);
      }
    }
    return;
  }

  if (subcommand === 'add-rule') {
    requireArg(arg1, 'connectionId');
    const rType = getFlagValue('--type');
    const rId = getFlagValue('--id');
    const rName = getFlagValue('--name');
    if (!rType || !rId || !rName) {
      console.error('Usage: pop connection add-rule <id> --type <type> --id <resourceId> --name <name> [--write]');
      process.exit(1);
    }
    const writeAllowed = process.argv.includes('--write');
    const result = await client.addConnectionResourceRule(arg1, {
      resourceType: rType as 'mailbox' | 'repo' | 'calendar' | 'project' | 'resource',
      resourceId: rId,
      displayName: rName,
      writeAllowed,
    });
    if (jsonFlag) {
      console.info(JSON.stringify(result, null, 2));
    } else {
      console.info(`Added rule: ${rType}/${rId} — ${rName}`);
    }
    return;
  }

  if (subcommand === 'remove-rule') {
    requireArg(arg1, 'connectionId');
    const rType = getFlagValue('--type');
    const rId = getFlagValue('--id');
    if (!rType || !rId) {
      console.error('Usage: pop connection remove-rule <id> --type <type> --id <resourceId>');
      process.exit(1);
    }
    await client.removeConnectionResourceRule(arg1, rType, rId);
    console.info(`Removed rule: ${rType}/${rId}`);
    return;
  }

  if (subcommand === 'diagnostics') {
    requireArg(arg1, 'connectionId');
    const diag = await client.getConnectionDiagnostics(arg1);
    if (jsonFlag) {
      console.info(JSON.stringify(diag, null, 2));
    } else {
      console.info(`Connection ${arg1}`);
      console.info(`  Provider:      ${diag.providerKind}`);
      console.info(`  Domain:        ${diag.domain}`);
      console.info(`  Enabled:       ${diag.enabled}`);
      console.info(`  Health:        ${diag.health.status}`);
      console.info(`  Sync:          ${diag.sync.status}`);
      console.info(`  Summary:       ${diag.humanSummary}`);
    }
    return;
  }

  if (subcommand === 'reconnect') {
    requireArg(arg1, 'connectionId');
    const action = getFlagValue('--action') ?? 'reconnect';
    const result = await client.reconnectConnection(arg1, action as 'reauthorize' | 'reconnect' | 'scope_fix' | 'secret_fix');
    if (jsonFlag) {
      console.info(JSON.stringify(result, null, 2));
    } else {
      console.info(`Reconnection initiated for connection ${arg1}`);
    }
    return;
  }
}
