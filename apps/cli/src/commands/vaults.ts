import type { DomainKind } from '@popeye/contracts';

import type { CommandContext } from '../formatters.js';
import { formatVault, requireArg } from '../formatters.js';

export async function handleVaults(ctx: CommandContext): Promise<void> {
  const { client, subcommand, arg1, jsonFlag } = ctx;
  const _arg2 = ctx.arg2;

  if (subcommand === 'list') {
    const domainIndex = process.argv.indexOf('--domain');
    const vaults = await client.listVaults(domainIndex !== -1 ? process.argv[domainIndex + 1] as DomainKind : undefined);
    if (jsonFlag) {
      console.info(JSON.stringify(vaults, null, 2));
    } else if (vaults.length === 0) {
      console.info('No vaults');
    } else {
      console.info(vaults.map(formatVault).join('\n\n'));
    }
    return;
  }

  if (subcommand === 'show' || subcommand === 'close' || subcommand === 'seal') {
    requireArg(arg1, 'vaultId');
  }

  if (subcommand === 'show' && arg1) {
    const vault = await client.getVault(arg1);
    console.info(jsonFlag ? JSON.stringify(vault, null, 2) : formatVault(vault));
    return;
  }

  if (subcommand === 'create') {
    requireArg(arg1, 'domain');
    requireArg(_arg2, 'name');
  }

  if (subcommand === 'create' && arg1 && _arg2) {
    const vault = await client.createVault({
      domain: arg1 as DomainKind,
      name: _arg2,
      ...(process.argv.includes('--restricted') ? { kind: 'restricted' } : {}),
    });
    console.info(jsonFlag ? JSON.stringify(vault, null, 2) : formatVault(vault));
    return;
  }

  if (subcommand === 'open') {
    requireArg(arg1, 'vaultId');
    requireArg(_arg2, 'approvalId');
  }

  if (subcommand === 'open' && arg1 && _arg2) {
    const vault = await client.openVault(arg1, { approvalId: _arg2 });
    console.info(jsonFlag ? JSON.stringify(vault, null, 2) : formatVault(vault));
    return;
  }

  if (subcommand === 'close' && arg1) {
    const vault = await client.closeVault(arg1);
    console.info(jsonFlag ? JSON.stringify(vault, null, 2) : formatVault(vault));
    return;
  }

  if (subcommand === 'seal' && arg1) {
    const vault = await client.sealVault(arg1);
    console.info(jsonFlag ? JSON.stringify(vault, null, 2) : formatVault(vault));
    return;
  }

  if (subcommand === 'set-kek') {
    const { randomBytes: rb } = await import('node:crypto');
    const { keychainSet } = await import('@popeye/runtime-core');
    const generateFlag = process.argv.includes('--generate');
    let kekValue: string;
    if (generateFlag) {
      kekValue = rb(32).toString('hex');
    } else {
      const { createInterface } = await import('node:readline');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      kekValue = await new Promise<string>((resolveValue) => {
        rl.question('Enter KEK (64-char hex string): ', (answer) => {
          rl.close();
          resolveValue(answer.trim());
        });
      });
    }
    if (kekValue.length !== 64 || !/^[0-9a-f]+$/i.test(kekValue)) {
      console.error('KEK must be a 64-character hex string (256 bits).');
      process.exitCode = 1;
      return;
    }
    const result = keychainSet('vault-kek', kekValue);
    if (result.ok) {
      console.info('Vault KEK stored in macOS Keychain.');
    } else {
      console.error(`Failed to store KEK: ${result.error}`);
      process.exitCode = 1;
    }
    return;
  }
}
