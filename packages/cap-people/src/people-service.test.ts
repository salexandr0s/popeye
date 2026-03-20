import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CapabilityContext } from '@popeye/contracts';

import { getPeopleMigrations } from './migrations.js';
import { PeopleService } from './people-service.js';

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'popeye-cappeople-'));
  const db = new Database(join(dir, 'people.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);');
  const getMigration = db.prepare('SELECT id FROM schema_migrations WHERE id = ?');
  const addMigration = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');
  for (const migration of getPeopleMigrations()) {
    if (getMigration.get(migration.id)) continue;
    const tx = db.transaction(() => {
      for (const statement of migration.statements) db.exec(statement);
      addMigration.run(migration.id, new Date().toISOString());
    });
    tx();
  }

  return { db, cleanup: () => db.close() };
}

describe('PeopleService', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let svc: PeopleService;

  beforeEach(() => {
    const setup = setupDb();
    db = setup.db;
    cleanup = setup.cleanup;
    svc = new PeopleService(db as unknown as CapabilityContext['appDb']);
  });

  afterEach(() => {
    cleanup();
  });

  it('projects email and calendar identities into one person by normalized email', () => {
    const first = svc.projectSeed({
      provider: 'email',
      externalId: 'Operator <operator@example.com>',
      displayName: 'Operator Example',
      email: 'operator@example.com',
    });
    const second = svc.projectSeed({
      provider: 'calendar',
      externalId: 'operator@example.com',
      displayName: 'Operator Calendar',
      email: 'operator@example.com',
    });

    expect(second.id).toBe(first.id);
    expect(svc.listPeople()).toHaveLength(1);
    expect(svc.getPerson(first.id)).toMatchObject({
      canonicalEmail: 'operator@example.com',
      identityCount: 2,
    });
  });

  it('projects github identities into one person by normalized handle', () => {
    const first = svc.projectSeed({
      provider: 'github',
      externalId: 'octocat',
      displayName: 'The Octocat',
      handle: 'octocat',
    });
    const second = svc.projectSeed({
      provider: 'github',
      externalId: 'octocat-secondary',
      displayName: 'Octocat Secondary',
      handle: '@octocat',
    });

    expect(second.id).toBe(first.id);
    expect(svc.listPeople()).toHaveLength(1);
    expect(svc.getPerson(first.id)).toMatchObject({
      githubLogin: 'octocat',
      identityCount: 2,
    });
  });

  it('applies manual updates and supports merge, split, attach, and detach flows', () => {
    const alpha = svc.projectSeed({
      provider: 'email',
      externalId: 'alpha@example.com',
      displayName: 'Alpha',
      email: 'alpha@example.com',
    });
    const beta = svc.projectSeed({
      provider: 'github',
      externalId: 'beta',
      displayName: 'Beta',
      handle: 'beta',
    });

    const updated = svc.updatePerson(alpha.id, {
      displayName: 'Alpha Prime',
      pronouns: 'she/her',
      tags: ['vip'],
      notes: 'Primary operator contact',
      relationshipLabel: 'teammate',
      reminderRouting: 'email',
      approvalNotes: 'Allow calendar writes',
      addContactMethods: [{ type: 'github', value: 'alpha' }],
    });
    expect(updated).toMatchObject({
      displayName: 'Alpha Prime',
      pronouns: 'she/her',
      tags: ['vip'],
      notes: 'Primary operator contact',
      githubLogin: 'alpha',
      policy: {
        relationshipLabel: 'teammate',
        reminderRouting: 'email',
        approvalNotes: 'Allow calendar writes',
      },
    });

    const merged = svc.mergePeople({
      sourcePersonId: beta.id,
      targetPersonId: alpha.id,
      requestedBy: 'test',
    });
    expect(merged.identityCount).toBe(2);
    expect(svc.getPerson(beta.id)).toBeNull();

    const betaIdentity = merged.identities.find((identity) => identity.externalId === 'beta');
    expect(betaIdentity).toBeTruthy();
    const split = svc.splitPerson(merged.id, {
      identityIds: [betaIdentity!.id],
      displayName: 'Beta Restored',
      requestedBy: 'test',
    });
    expect(split.displayName).toBe('Beta Restored');
    expect(split.githubLogin).toBe('beta');

    const attached = svc.attachIdentity({
      personId: split.id,
      provider: 'calendar',
      externalId: 'beta@example.com',
      displayName: 'Beta Calendar',
      requestedBy: 'test',
    });
    expect(attached.identityCount).toBe(2);
    expect(attached.canonicalEmail).toBe('beta@example.com');

    const calendarIdentity = attached.identities.find((identity) => identity.provider === 'calendar');
    expect(calendarIdentity).toBeTruthy();
    const detached = svc.detachIdentity(calendarIdentity!.id, 'test');
    expect(detached.displayName).toBe('Beta Calendar');
    expect(detached.identityCount).toBe(1);

    const mergeEvents = db.prepare('SELECT event_type FROM person_merge_events ORDER BY created_at').all() as Array<{ event_type: string }>;
    expect(mergeEvents.map((row) => row.event_type)).toEqual(expect.arrayContaining(['merge', 'split', 'detach']));
  });
});
