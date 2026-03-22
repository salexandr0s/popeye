import type { CommandContext } from '../formatters.js';
import { getFlagValue } from '../formatters.js';

export async function handlePeople(ctx: CommandContext): Promise<void> {
  const { client, subcommand, arg1, jsonFlag, positionalArgs } = ctx;
  const _arg2 = ctx.arg2;

  if (subcommand === 'list') {
    const people = await client.listPeople();
    if (jsonFlag) {
      console.info(JSON.stringify(people, null, 2));
    } else if (people.length === 0) {
      console.info('No people projected yet. Sync email, calendar, or GitHub first.');
    } else {
      for (const person of people) {
        console.info(`  ${person.id}  ${person.displayName}  ${person.canonicalEmail ?? person.githubLogin ?? ''}`.trimEnd());
      }
    }
    return;
  }

  if (subcommand === 'search' && arg1) {
    const limit = Number.parseInt(getFlagValue('--limit') ?? '20', 10);
    const response = await client.searchPeople(arg1, { limit });
    if (jsonFlag) {
      console.info(JSON.stringify(response, null, 2));
    } else if (response.results.length === 0) {
      console.info('No matching people found.');
    } else {
      for (const result of response.results) {
        console.info(`  ${result.personId}  ${result.displayName}  ${result.canonicalEmail ?? result.githubLogin ?? ''}`.trimEnd());
      }
    }
    return;
  }

  if (subcommand === 'show' && arg1) {
    const person = await client.getPerson(arg1);
    if (jsonFlag) {
      console.info(JSON.stringify(person, null, 2));
    } else {
      console.info(`Person ${person.id}`);
      console.info(`  Name:          ${person.displayName}`);
      console.info(`  Email:         ${person.canonicalEmail ?? '(none)'}`);
      console.info(`  GitHub:        ${person.githubLogin ?? '(none)'}`);
      console.info(`  Pronouns:      ${person.pronouns ?? '(none)'}`);
      console.info(`  Tags:          ${person.tags.length > 0 ? person.tags.join(', ') : '(none)'}`);
      console.info(`  Identities:    ${person.identityCount}`);
      console.info(`  Contacts:      ${person.contactMethodCount}`);
      console.info(`  Activity:      ${person.activitySummary || '(none)'}`);
    }
    return;
  }

  if (subcommand === 'edit' && arg1) {
    const displayName = getFlagValue('--display-name');
    const pronouns = getFlagValue('--pronouns');
    const tagsFlag = getFlagValue('--tags');
    const notes = getFlagValue('--notes');
    const updated = await client.updatePerson(arg1, {
      ...(displayName ? { displayName } : {}),
      ...(pronouns !== undefined ? { pronouns } : {}),
      ...(tagsFlag !== undefined ? { tags: tagsFlag.split(',').map((value) => value.trim()).filter(Boolean) } : {}),
      ...(notes !== undefined ? { notes } : {}),
    });
    if (jsonFlag) {
      console.info(JSON.stringify(updated, null, 2));
    } else {
      console.info(`Updated ${updated.id}: ${updated.displayName}`);
    }
    return;
  }

  if (subcommand === 'merge' && arg1 && _arg2) {
    const merged = await client.mergePeople({
      sourcePersonId: arg1,
      targetPersonId: _arg2,
      requestedBy: 'cli',
    });
    if (jsonFlag) {
      console.info(JSON.stringify(merged, null, 2));
    } else {
      console.info(`Merged into ${merged.id}: ${merged.displayName}`);
    }
    return;
  }

  if (subcommand === 'attach' && arg1) {
    const provider = getFlagValue('--provider');
    const externalId = getFlagValue('--external-id');
    if (!provider || !externalId || !['email', 'calendar', 'github'].includes(provider)) {
      console.error('Usage: pop people attach <personId> --provider <email|calendar|github> --external-id <value> [--display-name <name>] [--handle <value>]');
      process.exit(1);
    }
    const attached = await client.attachPersonIdentity({
      personId: arg1,
      provider: provider as 'email' | 'calendar' | 'github',
      externalId,
      displayName: getFlagValue('--display-name') ?? null,
      handle: getFlagValue('--handle') ?? null,
      requestedBy: 'cli',
    });
    if (jsonFlag) {
      console.info(JSON.stringify(attached, null, 2));
    } else {
      console.info(`Attached identity to ${attached.id}: ${attached.displayName}`);
    }
    return;
  }

  if (subcommand === 'detach' && arg1) {
    const detached = await client.detachPersonIdentity(arg1, { requestedBy: 'cli' });
    if (jsonFlag) {
      console.info(JSON.stringify(detached, null, 2));
    } else {
      console.info(`Detached into ${detached.id}: ${detached.displayName}`);
    }
    return;
  }

  if (subcommand === 'split' && arg1) {
    const identityIds = positionalArgs.slice(5);
    if (identityIds.length === 0) {
      console.error('Usage: pop people split <personId> <identityId> [identityId...]');
      process.exit(1);
    }
    const split = await client.splitPerson(arg1, {
      identityIds,
      requestedBy: 'cli',
    });
    if (jsonFlag) {
      console.info(JSON.stringify(split, null, 2));
    } else {
      console.info(`Split into ${split.id}: ${split.displayName}`);
    }
    return;
  }

  if (subcommand === 'history' && arg1) {
    const events = await client.listPersonMergeEvents(arg1);
    if (jsonFlag) {
      console.info(JSON.stringify(events, null, 2));
    } else if (events.length === 0) {
      console.info('No merge/split events found.');
    } else {
      for (const event of events) {
        console.info(`  ${event.eventType.padEnd(10)} ${event.sourcePersonId} → ${event.targetPersonId}  ${event.createdAt}`);
      }
    }
    return;
  }

  if (subcommand === 'suggestions') {
    const suggestions = await client.getPersonMergeSuggestions();
    if (jsonFlag) {
      console.info(JSON.stringify(suggestions, null, 2));
    } else if (suggestions.length === 0) {
      console.info('No merge suggestions found.');
    } else {
      for (const sug of suggestions) {
        console.info(`  ${sug.sourceDisplayName} → ${sug.targetDisplayName}  (${sug.reason}, confidence: ${sug.confidence})`);
      }
    }
    return;
  }

  if (subcommand === 'activity' && arg1) {
    const rollups = await client.getPersonActivityRollups(arg1);
    if (jsonFlag) {
      console.info(JSON.stringify(rollups, null, 2));
    } else if (rollups.length === 0) {
      console.info('No activity found.');
    } else {
      for (const rollup of rollups) {
        console.info(`  ${rollup.domain.padEnd(12)} ${rollup.summary.padEnd(30)} count: ${rollup.count}  last: ${rollup.lastSeenAt}`);
      }
    }
    return;
  }
}
