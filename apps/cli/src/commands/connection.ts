import type { CommandContext } from '../formatters.js';
import { getFlagValue, requireArg } from '../formatters.js';

export async function handleConnection(ctx: CommandContext): Promise<void> {
  const { client, subcommand, arg1, jsonFlag } = ctx;

  if (subcommand === 'rules') {
    requireArg(arg1, 'connectionId');
    const rules = await client.listConnectionRules(arg1);
    if (jsonFlag) {
      console.info(JSON.stringify(rules, null, 2));
    } else if (rules.length === 0) {
      console.info('No resource rules configured.');
    } else {
      for (const rule of rules) {
        const writeFlag = rule.writeAccess ? ' [write]' : '';
        console.info(`  ${rule.resourceType}/${rule.resourceId}  ${rule.resourceName}${writeFlag}`);
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
    const writeAccess = process.argv.includes('--write');
    const rule = await client.addConnectionRule(arg1, {
      resourceType: rType,
      resourceId: rId,
      resourceName: rName,
      writeAccess,
    });
    if (jsonFlag) {
      console.info(JSON.stringify(rule, null, 2));
    } else {
      console.info(`Added rule: ${rule.resourceType}/${rule.resourceId} — ${rule.resourceName}`);
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
    await client.removeConnectionRule(arg1, { resourceType: rType, resourceId: rId });
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
      console.info(`  Status:        ${diag.status}`);
      console.info(`  Provider:      ${diag.providerKind}`);
      console.info(`  Last sync:     ${diag.lastSyncAt ?? 'never'}`);
      console.info(`  Last error:    ${diag.lastError ?? '(none)'}`);
      console.info(`  Health:        ${diag.healthScore}/100`);
    }
    return;
  }

  if (subcommand === 'reconnect') {
    requireArg(arg1, 'connectionId');
    const action = getFlagValue('--action') ?? 'reconnect';
    const result = await client.reconnect(arg1, { action: action as 'reauthorize' | 'reconnect' | 'scope_fix' | 'secret_fix' });
    if (jsonFlag) {
      console.info(JSON.stringify(result, null, 2));
    } else {
      console.info(`Reconnection ${result.status}: ${result.message ?? ''}`);
    }
    return;
  }
}
