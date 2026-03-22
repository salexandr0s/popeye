import type { CommandContext } from '../formatters.js';
import { getFlagValue } from '../formatters.js';

export async function handleTodo(ctx: CommandContext): Promise<void> {
  const { client, subcommand, arg1, jsonFlag } = ctx;

  if (subcommand === 'connect') {
    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (prompt: string): Promise<string> => new Promise((resolveQuestion) => rl.question(prompt, resolveQuestion));
    const displayName = getFlagValue('--display-name') ?? 'Todoist';
    const label = getFlagValue('--label') ?? 'Todoist';
    const mode = process.argv.includes('--read-only') ? 'read_only' : 'read_write';
    const apiToken = (await ask('Todoist API token: ')).trim();
    rl.close();
    if (!apiToken) {
      console.error('A Todoist API token is required.');
      process.exit(1);
    }
    const result = await client.connectTodoist({
      apiToken,
      displayName,
      label,
      mode,
      syncIntervalSeconds: 900,
    });
    if (jsonFlag) {
      console.info(JSON.stringify(result, null, 2));
    } else {
      console.info('Connected Todoist.');
      console.info(`  Connection: ${result.connectionId}`);
      console.info(`  Account:    ${result.account.id} (${result.account.displayName})`);
      console.info('Run "pop todo sync" to fetch projects and tasks.');
    }
    return;
  }

  if (subcommand === 'accounts') {
    const accounts = await client.listTodoAccounts();
    if (jsonFlag) {
      console.info(JSON.stringify(accounts, null, 2));
    } else {
      if (accounts.length === 0) {
        console.info('No todo accounts registered.');
      } else {
        for (const acct of accounts) {
          console.info(`  ${acct.id}  ${acct.displayName.padEnd(25)} ${acct.providerKind.padEnd(10)} todos: ${acct.todoCount}  last sync: ${acct.lastSyncAt ?? 'never'}`);
        }
      }
    }
    return;
  }

  if (subcommand === 'sync') {
    const accounts = await client.listTodoAccounts();
    if (accounts.length === 0) {
      console.error('No todo accounts registered. Run "pop todo connect" first.');
      process.exit(1);
    }
    const targetId = arg1 ?? accounts[0]!.id;
    const result = await client.syncTodoAccount(targetId);
    if (jsonFlag) {
      console.info(JSON.stringify(result, null, 2));
    } else {
      console.info(`  Synced: ${result.todosSynced} new, ${result.todosUpdated} updated`);
      if (result.errors.length > 0) {
        console.info(`  Errors: ${result.errors.length}`);
        for (const error of result.errors.slice(0, 5)) console.info(`    - ${error}`);
      }
    }
    return;
  }

  if (subcommand === 'list') {
    const limitIdx = process.argv.indexOf('--limit');
    const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1] ?? '50', 10) : 50;
    const priorityIdx = process.argv.indexOf('--priority');
    const priority = priorityIdx !== -1 ? parseInt(process.argv[priorityIdx + 1] ?? '0', 10) : undefined;
    const projectIdx = process.argv.indexOf('--project');
    const project = projectIdx !== -1 ? process.argv[projectIdx + 1] : undefined;
    const overdue = process.argv.includes('--overdue');
    const status = overdue ? 'pending' : undefined;
    const todos = await client.listTodos(undefined, { ...(status !== undefined ? { status } : {}), ...(priority !== undefined ? { priority } : {}), ...(project !== undefined ? { project } : {}), limit });
    let filteredTodos = todos;
    if (overdue) {
      const todayStr = new Date().toISOString().slice(0, 10);
      filteredTodos = todos.filter((t) => t.dueDate !== null && t.dueDate < todayStr);
    }
    if (jsonFlag) {
      console.info(JSON.stringify(filteredTodos, null, 2));
    } else {
      if (filteredTodos.length === 0) {
        console.info('No todos found.');
      } else {
        for (const t of filteredTodos) {
          const due = t.dueDate ? ` due:${t.dueDate}` : '';
          const proj = t.projectName ? ` [${t.projectName}]` : '';
          const pri = t.priority <= 2 ? ` !!!` : t.priority === 3 ? ' !!' : '';
          console.info(`  ${t.id.slice(0, 8)}  ${t.status.padEnd(10)} P${t.priority} ${t.title.slice(0, 50)}${due}${proj}${pri}`);
        }
      }
    }
    return;
  }

  if (subcommand === 'add' && arg1) {
    const accounts = await client.listTodoAccounts();
    if (accounts.length === 0) {
      console.error('No todo accounts registered. Create one first.');
      process.exit(1);
    }
    const priorityIdx = process.argv.indexOf('--priority');
    const priority = priorityIdx !== -1 ? parseInt(process.argv[priorityIdx + 1] ?? '4', 10) : undefined;
    const dueIdx = process.argv.indexOf('--due');
    const dueDate = dueIdx !== -1 ? process.argv[dueIdx + 1] : undefined;
    const projectIdx = process.argv.indexOf('--project');
    const projectName = projectIdx !== -1 ? process.argv[projectIdx + 1] : undefined;
    const todo = await client.createTodo({
      accountId: accounts[0]!.id,
      title: arg1,
      priority,
      dueDate,
      projectName,
    });
    if (jsonFlag) {
      console.info(JSON.stringify(todo, null, 2));
    } else {
      console.info(`Created todo: ${todo.id.slice(0, 8)} — ${todo.title}`);
    }
    return;
  }

  if (subcommand === 'complete' && arg1) {
    const todo = await client.completeTodo(arg1);
    if (jsonFlag) {
      console.info(JSON.stringify(todo, null, 2));
    } else {
      console.info(`Completed: ${todo.title}`);
    }
    return;
  }

  if (subcommand === 'reprioritize' && arg1 && ctx.arg2) {
    const todo = await client.reprioritizeTodo(arg1, parseInt(ctx.arg2, 10));
    if (jsonFlag) {
      console.info(JSON.stringify(todo, null, 2));
    } else {
      console.info(`Reprioritized: ${todo.title} → P${todo.priority}`);
    }
    return;
  }

  if (subcommand === 'reschedule' && arg1 && ctx.arg2) {
    const todo = await client.rescheduleTodo(arg1, ctx.arg2);
    if (jsonFlag) {
      console.info(JSON.stringify(todo, null, 2));
    } else {
      console.info(`Rescheduled: ${todo.title} → ${todo.dueDate}`);
    }
    return;
  }

  if (subcommand === 'move' && arg1 && ctx.arg2) {
    const todo = await client.moveTodo(arg1, ctx.arg2);
    if (jsonFlag) {
      console.info(JSON.stringify(todo, null, 2));
    } else {
      console.info(`Moved: ${todo.title} → ${todo.projectName}`);
    }
    return;
  }

  if (subcommand === 'reconcile') {
    const accounts = await client.listTodoAccounts();
    if (accounts.length === 0) {
      console.error('No todo accounts registered.');
      process.exit(1);
    }
    const targetId = arg1 ?? accounts[0]!.id;
    const result = await client.reconcileTodos(targetId);
    if (jsonFlag) {
      console.info(JSON.stringify(result, null, 2));
    } else {
      console.info(`Reconciled: ${result.added} added, ${result.updated} updated, ${result.removed} removed`);
    }
    return;
  }

  if (subcommand === 'projects') {
    const accounts = await client.listTodoAccounts();
    if (accounts.length === 0) {
      console.error('No todo accounts registered.');
      process.exit(1);
    }
    const targetId = arg1 ?? accounts[0]!.id;
    const projects = await client.listTodoProjects(targetId);
    if (jsonFlag) {
      console.info(JSON.stringify(projects, null, 2));
    } else if (projects.length === 0) {
      console.info('No projects found.');
    } else {
      for (const p of projects) {
        console.info(`  ${p.name.padEnd(30)} todos: ${p.todoCount}`);
      }
    }
    return;
  }

  if (subcommand === 'search' && arg1) {
    const limitIdx = process.argv.indexOf('--limit');
    const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1] ?? '20', 10) : 20;
    const response = await client.searchTodos(arg1, { limit });
    if (jsonFlag) {
      console.info(JSON.stringify(response, null, 2));
    } else {
      if (response.results.length === 0) {
        console.info('No matching todos found.');
      } else {
        for (const r of response.results) {
          const due = r.dueDate ? ` due:${r.dueDate}` : '';
          const proj = r.projectName ? ` [${r.projectName}]` : '';
          console.info(`  P${r.priority} ${r.status.padEnd(10)} ${r.title.slice(0, 50)}${due}${proj}`);
        }
      }
    }
    return;
  }

  if (subcommand === 'digest') {
    const digest = await client.getTodoDigest();
    if (jsonFlag) {
      console.info(JSON.stringify(digest, null, 2));
    } else if (!digest) {
      console.info('No todo digest available. Sync first with the daemon running.');
    } else {
      console.info(digest.summaryMarkdown);
    }
    return;
  }
}
