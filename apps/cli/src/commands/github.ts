import type { CommandContext } from '../formatters.js';
import { getFlagValue } from '../formatters.js';
import { runOAuthConnectFlow } from './email.js';

export async function handleGithub(ctx: CommandContext): Promise<void> {
  const { client, subcommand, arg1, jsonFlag } = ctx;

  if (subcommand === 'connect') {
    const reconnectId = getFlagValue('--reconnect');
    await runOAuthConnectFlow(client, {
      providerKind: 'github',
      mode: process.argv.includes('--read-write') ? 'read_write' : 'read_only',
      syncIntervalSeconds: 900,
      ...(reconnectId ? { connectionId: reconnectId } : {}),
    });
    console.info('Run "pop github sync" to fetch repos, PRs, issues, and notifications.');
    return;
  }

  if (subcommand === 'sync') {
    const accounts = await client.listGithubAccounts();
    if (accounts.length === 0) {
      console.error('No GitHub accounts registered. Run "pop github connect" first.');
      process.exit(1);
    }
    const targetId = arg1 ?? accounts[0]!.id;
    console.info(`Syncing GitHub account ${targetId}...`);
    const result = await client.syncGithubAccount(targetId);
    if (jsonFlag) {
      console.info(JSON.stringify(result, null, 2));
    } else {
      console.info(`  Repos: ${result.reposSynced}  PRs: ${result.prsSynced}  Issues: ${result.issuesSynced}  Notifications: ${result.notificationsSynced}`);
      if (result.errors.length > 0) {
        console.info(`  Errors: ${result.errors.length}`);
        for (const err of result.errors.slice(0, 5)) console.info(`    - ${err}`);
      }
    }
    return;
  }

  if (subcommand === 'accounts') {
    const accounts = await client.listGithubAccounts();
    if (jsonFlag) {
      console.info(JSON.stringify(accounts, null, 2));
    } else {
      if (accounts.length === 0) {
        console.info('No GitHub accounts registered.');
      } else {
        for (const acct of accounts) {
          console.info(`  ${acct.id}  ${acct.githubUsername.padEnd(25)} ${acct.displayName}  repos: ${acct.repoCount}  last sync: ${acct.lastSyncAt ?? 'never'}`);
        }
      }
    }
    return;
  }

  if (subcommand === 'repos') {
    const limitIdx = process.argv.indexOf('--limit');
    const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1] ?? '100', 10) : 100;
    const repos = await client.listGithubRepos(undefined, { limit });
    if (jsonFlag) {
      console.info(JSON.stringify(repos, null, 2));
    } else {
      if (repos.length === 0) {
        console.info('No repos synced. Run "pop github sync" first.');
      } else {
        for (const r of repos) {
          const lang = r.language ? ` [${r.language}]` : '';
          const visibility = r.isPrivate ? 'private' : 'public';
          console.info(`  ${r.fullName.padEnd(40)} ${visibility.padEnd(8)} ${lang}`);
        }
      }
    }
    return;
  }

  if (subcommand === 'prs') {
    const limitIdx = process.argv.indexOf('--limit');
    const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1] ?? '50', 10) : 50;
    const stateIdx = process.argv.indexOf('--state');
    const state = stateIdx !== -1 ? process.argv[stateIdx + 1] : undefined;
    const prs = await client.listGithubPullRequests(undefined, { state, limit });
    if (jsonFlag) {
      console.info(JSON.stringify(prs, null, 2));
    } else {
      if (prs.length === 0) {
        console.info('No pull requests found.');
      } else {
        for (const pr of prs) {
          const draft = pr.isDraft ? ' [draft]' : '';
          const ci = pr.ciStatus ? ` ci:${pr.ciStatus}` : '';
          console.info(`  #${String(pr.githubPrNumber).padEnd(5)} ${pr.state.padEnd(7)} ${pr.title.slice(0, 50).padEnd(52)} by ${pr.author}${draft}${ci}`);
        }
      }
    }
    return;
  }

  if (subcommand === 'issues') {
    const limitIdx = process.argv.indexOf('--limit');
    const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1] ?? '50', 10) : 50;
    const stateIdx = process.argv.indexOf('--state');
    const state = stateIdx !== -1 ? process.argv[stateIdx + 1] : undefined;
    const assigned = process.argv.includes('--assigned');
    const issues = await client.listGithubIssues(undefined, { state, assigned, limit });
    if (jsonFlag) {
      console.info(JSON.stringify(issues, null, 2));
    } else {
      if (issues.length === 0) {
        console.info('No issues found.');
      } else {
        for (const issue of issues) {
          const labels = issue.labels.length > 0 ? ` [${issue.labels.join(', ')}]` : '';
          console.info(`  #${String(issue.githubIssueNumber).padEnd(5)} ${issue.state.padEnd(7)} ${issue.title.slice(0, 50).padEnd(52)} by ${issue.author}${labels}`);
        }
      }
    }
    return;
  }

  if (subcommand === 'notifications') {
    const limitIdx = process.argv.indexOf('--limit');
    const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1] ?? '50', 10) : 50;
    const notifications = await client.listGithubNotifications(undefined, { limit });
    if (jsonFlag) {
      console.info(JSON.stringify(notifications, null, 2));
    } else {
      if (notifications.length === 0) {
        console.info('No unread notifications.');
      } else {
        for (const n of notifications) {
          console.info(`  [${n.subjectType.padEnd(12)}] ${n.subjectTitle.slice(0, 50).padEnd(52)} ${n.repoFullName}  (${n.reason})`);
        }
      }
    }
    return;
  }

  if (subcommand === 'search' && arg1) {
    const limitIdx = process.argv.indexOf('--limit');
    const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1] ?? '20', 10) : 20;
    const response = await client.searchGithub(arg1, { limit });
    if (jsonFlag) {
      console.info(JSON.stringify(response, null, 2));
    } else {
      if (response.results.length === 0) {
        console.info('No matching PRs or issues found.');
      } else {
        for (const r of response.results) {
          console.info(`  [${r.entityType.toUpperCase().padEnd(5)}] #${String(r.number).padEnd(5)} ${r.title.slice(0, 50).padEnd(52)} ${r.repoFullName}  by ${r.author}`);
        }
      }
    }
    return;
  }

  if (subcommand === 'digest') {
    const digest = await client.getGithubDigest();
    if (jsonFlag) {
      console.info(JSON.stringify(digest, null, 2));
    } else if (!digest) {
      console.info('No GitHub digest available. Sync first with the daemon running.');
    } else {
      console.info(digest.summaryMarkdown);
    }
    return;
  }
}
