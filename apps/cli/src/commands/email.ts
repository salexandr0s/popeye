import { execFile, spawn } from 'node:child_process';

import type { PopeyeApiClient } from '@popeye/api-client';

import { type CommandContext, getFlagValue, sleep } from '../formatters.js';

async function openBrowserUrl(url: string): Promise<boolean> {
  const platform = process.platform;
  const command = platform === 'darwin'
    ? 'open'
    : platform === 'win32'
      ? 'cmd'
      : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];

  return await new Promise<boolean>((resolve) => {
    const child = spawn(command, args, {
      stdio: 'ignore',
      detached: platform !== 'win32',
    });
    child.once('error', () => resolve(false));
    child.once('spawn', () => {
      child.unref();
      resolve(true);
    });
  });
}

function buildLoopbackTunnelHint(authorizationUrl: string): string | null {
  try {
    const redirectUri = new URL(new URL(authorizationUrl).searchParams.get('redirect_uri') ?? '');
    if (!['127.0.0.1', 'localhost'].includes(redirectUri.hostname)) {
      return null;
    }
    const port = redirectUri.port || (redirectUri.protocol === 'https:' ? '443' : '80');
    return `If you're approving from another machine over SSH, forward the callback port first:\n  ssh -L ${port}:127.0.0.1:${port} <remote-host>`;
  } catch {
    return null;
  }
}

async function runOAuthConnectFlow(
  client: PopeyeApiClient,
  input: {
    providerKind: 'gmail' | 'google_calendar' | 'github';
    mode: 'read_only' | 'read_write';
    syncIntervalSeconds?: number;
    connectionId?: string;
    openBrowser?: boolean;
  },
): Promise<void> {
  const session = await client.startOAuthConnection({
    providerKind: input.providerKind,
    mode: input.mode,
    syncIntervalSeconds: input.syncIntervalSeconds ?? 900,
    ...(input.connectionId ? { connectionId: input.connectionId } : {}),
  });

  const shouldOpenBrowser = input.openBrowser ?? true;
  const opened = shouldOpenBrowser ? await openBrowserUrl(session.authorizationUrl) : false;
  console.info(`Starting ${input.providerKind} connection...`);
  if (opened) {
    console.info('Opened browser for OAuth approval.');
  }
  console.info('Open this URL in your browser:');
  console.info(`  ${session.authorizationUrl}`);
  const tunnelHint = buildLoopbackTunnelHint(session.authorizationUrl);
  if (tunnelHint) {
    console.info(tunnelHint);
  }

  for (let attempt = 0; attempt < 150; attempt += 1) {
    await sleep(2000);
    const latest = await client.getOAuthConnectionSession(session.id);
    if (latest.status === 'pending') {
      continue;
    }
    if (latest.status === 'completed') {
      console.info(input.connectionId ? `${input.providerKind} reconnected.` : `${input.providerKind} connected.`);
      if (latest.connectionId) console.info(`  Connection: ${latest.connectionId}`);
      if (latest.accountId) console.info(`  Account:    ${latest.accountId}`);
      return;
    }
    console.error(`${input.providerKind} connection failed: ${latest.error ?? latest.status}`);
    process.exit(1);
  }

  console.error('OAuth connection timed out while waiting for callback completion.');
  process.exit(1);
}

export { runOAuthConnectFlow };

export async function handleEmail(ctx: CommandContext): Promise<void> {
  const { client, subcommand, arg1, jsonFlag } = ctx;

  if (subcommand === 'accounts') {
    const accounts = await client.listEmailAccounts();
    if (jsonFlag) {
      console.info(JSON.stringify(accounts, null, 2));
    } else {
      if (accounts.length === 0) {
        console.info('No email accounts registered.');
      } else {
        for (const acct of accounts) {
          console.info(`  ${acct.id}  ${acct.emailAddress.padEnd(30)} ${acct.displayName}  messages: ${acct.messageCount}  last sync: ${acct.lastSyncAt ?? 'never'}`);
        }
      }
    }
    return;
  }

  if (subcommand === 'threads') {
    const limitIdx = process.argv.indexOf('--limit');
    const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1] ?? '20', 10) : 20;
    const unreadOnly = process.argv.includes('--unread');
    const accounts = await client.listEmailAccounts();
    if (accounts.length === 0) {
      console.info('No email accounts registered.');
      return;
    }
    const threads = await client.listEmailThreads(accounts[0]!.id, { limit, unreadOnly });
    if (jsonFlag) {
      console.info(JSON.stringify(threads, null, 2));
    } else {
      if (threads.length === 0) {
        console.info('No email threads found.');
      } else {
        for (const t of threads) {
          const flags = [t.isUnread ? 'unread' : '', t.isStarred ? 'starred' : ''].filter(Boolean).join(' ');
          console.info(`  ${t.lastMessageAt.slice(0, 10)}  ${t.subject.slice(0, 60).padEnd(62)} ${flags}`);
        }
      }
    }
    return;
  }

  if (subcommand === 'search' && arg1) {
    const limitIdx = process.argv.indexOf('--limit');
    const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1] ?? '20', 10) : 20;
    const response = await client.searchEmail(arg1, { limit });
    if (jsonFlag) {
      console.info(JSON.stringify(response, null, 2));
    } else {
      if (response.results.length === 0) {
        console.info('No matching emails found.');
      } else {
        for (const r of response.results) {
          console.info(`  ${r.lastMessageAt.slice(0, 10)}  ${r.subject.slice(0, 60).padEnd(62)} from: ${r.from}`);
        }
      }
    }
    return;
  }

  if (subcommand === 'digest') {
    const generateFlag = process.argv.includes('--generate');
    if (generateFlag) {
      const digest = await client.generateEmailDigest();
      if (jsonFlag) {
        console.info(JSON.stringify(digest, null, 2));
      } else if (!digest) {
        console.info('No accounts registered. Connect an email provider first.');
      } else {
        console.info('Digest generated:');
        console.info(digest.summaryMarkdown);
      }
    } else {
      const digest = await client.getEmailDigest();
      if (jsonFlag) {
        console.info(JSON.stringify(digest, null, 2));
      } else if (!digest) {
        console.info('No email digest available. Run sync first, or use --generate.');
      } else {
        console.info(digest.summaryMarkdown);
      }
    }
    return;
  }

  if (subcommand === 'connect') {
    const isGmail = process.argv.includes('--gmail');
    const isGmailExperimental = process.argv.includes('--gmail-experimental');
    const isProton = process.argv.includes('--proton');
    const mode = process.argv.includes('--read-write') ? 'read_write' : 'read_only';
    const reconnectId = getFlagValue('--reconnect');
    if (!isGmail && !isGmailExperimental && !isProton) {
      console.error('Usage: pop email connect --gmail [--read-write] | --proton | --gmail-experimental');
      process.exit(1);
    }

    if (isGmail) {
      await runOAuthConnectFlow(client, {
        providerKind: 'gmail',
        mode,
        syncIntervalSeconds: 900,
        ...(reconnectId ? { connectionId: reconnectId } : {}),
        openBrowser: !process.argv.includes('--no-open'),
      });
      console.info('Run "pop email sync" to fetch your inbox.');
    } else if (isGmailExperimental) {
      // Check gws is available
      const providers = await client.detectEmailProviders();
      if (!providers.gws.available) {
        console.error('gws CLI not found. Install with: npm install -g @googleworkspace/cli');
        process.exit(1);
      }

      // Resolve real email address from gws profile
      let emailAddress: string;
      try {
        const profileJson = await new Promise<string>((resolveExec, rejectExec) => {
          execFile('gws', ['gmail', 'users', 'getProfile'], { timeout: 30_000 }, (error, stdout) => {
            if (error) {
              rejectExec(error);
              return;
            }
            resolveExec(stdout);
          });
        });
        const profile = JSON.parse(profileJson) as { emailAddress?: string };
        if (!profile.emailAddress) {
          console.error('gws getProfile did not return an email address. Is gws authenticated?');
          process.exit(1);
        }
        emailAddress = profile.emailAddress;
      } catch (err) {
        console.error(`Failed to resolve Gmail profile via gws: ${err instanceof Error ? err.message : String(err)}`);
        console.error('Ensure gws is authenticated: gws auth login');
        process.exit(1);
      }

      // Create connection
      const connection = await client.createConnection({
        domain: 'email',
        providerKind: 'gmail',
        label: `Gmail (${emailAddress})`,
        mode: 'read_only',
        secretRefId: null,
        syncIntervalSeconds: 900,
        allowedScopes: ['gmail.readonly'],
        allowedResources: [],
      });
      // Register account with the resolved email
      const account = await client.registerEmailAccount({
        connectionId: connection.id,
        emailAddress,
        displayName: emailAddress.split('@')[0] ?? emailAddress,
      });
      console.info('Connected Gmail via experimental gws CLI flow.');
      console.info(`  Connection: ${connection.id}`);
      console.info(`  Account:    ${account.id} (${emailAddress})`);
      console.info('Run "pop email sync" to fetch your inbox.');
    } else {
      // Proton -- prompt for bridge password
      const readline = await import('node:readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ask = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, resolve));
      const email = await ask('Proton email address: ');
      const password = await ask('Bridge-generated password: ');
      rl.close();

      if (!email || !password) {
        console.error('Both email and bridge password are required.');
        process.exit(1);
      }

      // Store the bridge password in the daemon's secret store
      const secretRef = await client.storeSecret({
        key: `proton-bridge-password`,
        value: password,
        description: `Proton Bridge IMAP password for ${email}`,
      });

      // Create connection with the secret reference
      const connection = await client.createConnection({
        domain: 'email',
        providerKind: 'proton',
        label: `Proton (${email})`,
        mode: 'read_only',
        secretRefId: secretRef.id,
        syncIntervalSeconds: 900,
        allowedScopes: [],
        allowedResources: [],
      });

      // Update the secret to link it to the connection
      await client.updateConnection(connection.id, { secretRefId: secretRef.id });

      // Register account
      const account = await client.registerEmailAccount({
        connectionId: connection.id,
        emailAddress: email,
        displayName: email.split('@')[0] ?? email,
      });
      console.info(`Connected Proton Mail via Bridge.`);
      console.info(`  Connection: ${connection.id}`);
      console.info(`  Account:    ${account.id}`);
      console.info('  Password stored securely in daemon secret store.');
      console.info('Run "pop email sync" to fetch your inbox.');
    }
    return;
  }

  if (subcommand === 'sync') {
    const accounts = await client.listEmailAccounts();
    if (accounts.length === 0) {
      console.error('No email accounts registered. Run "pop email connect" first.');
      process.exit(1);
    }
    const targetId = arg1 ?? accounts[0]!.id;
    console.info(`Syncing account ${targetId}...`);
    const result = await client.syncEmailAccount(targetId);
    if (jsonFlag) {
      console.info(JSON.stringify(result, null, 2));
    } else {
      console.info(`  Synced: ${result.synced} new, ${result.updated} updated`);
      if (result.errors.length > 0) {
        console.info(`  Errors: ${result.errors.length}`);
        for (const err of result.errors.slice(0, 5)) console.info(`    - ${err}`);
      }
    }
    return;
  }

  if (subcommand === 'providers') {
    const providers = await client.detectEmailProviders();
    if (jsonFlag) {
      console.info(JSON.stringify(providers, null, 2));
    } else {
      console.info('Email providers:');
      console.info(`  Gmail (gws CLI, experimental): ${providers.gws.available ? 'available' : 'not found'}`);
      console.info(`  Proton (Bridge):     ${providers.protonBridge.available ? 'running' : 'not detected'}`);
    }
    return;
  }
}
