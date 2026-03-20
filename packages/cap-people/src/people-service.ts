import { randomUUID } from 'node:crypto';

import type {
  PersonActivityRollup,
  PersonContactMethodRecord,
  PersonIdentityAttachInput,
  PersonIdentityRecord,
  PersonListItem,
  PersonMergeEventRecord,
  PersonMergeInput,
  PersonMergeSuggestion,
  PersonPolicyRecord,
  PersonRecord,
  PersonSearchResult,
  PersonSplitInput,
  PersonUpdateInput,
} from '@popeye/contracts';
import { nowIso } from '@popeye/contracts';

import type {
  PeopleCapabilityDb,
  PersonActivityRollupRow,
  PersonContactMethodRow,
  PersonIdentityRow,
  PersonPolicyRow,
  PersonRow,
} from './types.js';
import { prepareAll, prepareGet, prepareRun } from './types.js';

function parseJsonArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0]!.toLowerCase() : null;
}

function normalizeHandle(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/^@/, '');
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
}

function mapIdentityRow(row: PersonIdentityRow): PersonIdentityRecord {
  return {
    id: row.id,
    personId: row.person_id,
    provider: row.provider as PersonIdentityRecord['provider'],
    externalId: row.external_id,
    displayName: row.display_name,
    handle: row.handle,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapContactMethodRow(row: PersonContactMethodRow): PersonContactMethodRecord {
  return {
    id: row.id,
    personId: row.person_id,
    type: row.type as PersonContactMethodRecord['type'],
    value: row.value,
    label: row.label,
    source: row.source as PersonContactMethodRecord['source'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPolicyRow(row: PersonPolicyRow): PersonPolicyRecord {
  return {
    personId: row.person_id,
    relationshipLabel: row.relationship_label,
    reminderRouting: row.reminder_routing,
    approvalNotes: row.approval_notes,
    updatedAt: row.updated_at,
  };
}

export interface PersonProjectionSeed {
  provider: PersonIdentityRecord['provider'];
  externalId: string;
  displayName?: string | null;
  handle?: string | null;
  email?: string | null;
  activitySummary?: string | null;
}

export class PeopleService {
  constructor(private readonly db: PeopleCapabilityDb) {}

  listPeople(): PersonListItem[] {
    const rows = prepareAll<PersonRow>(this.db, 'SELECT * FROM people ORDER BY display_name COLLATE NOCASE ASC')();
    return rows.map((row) => this.mapPersonRow(row));
  }

  getPerson(id: string): PersonRecord | null {
    const row = prepareGet<PersonRow>(this.db, 'SELECT * FROM people WHERE id = ?')(id);
    return row ? this.mapPersonRow(row) : null;
  }

  searchPeople(query: string, limit = 20): { query: string; results: PersonSearchResult[] } {
    const lowered = query.trim().toLowerCase();
    const rows = prepareAll<PersonRow>(this.db,
      `SELECT * FROM people
       WHERE lower(display_name) LIKE ? OR lower(COALESCE(canonical_email, '')) LIKE ? OR lower(COALESCE(github_login, '')) LIKE ?
       ORDER BY display_name COLLATE NOCASE ASC
       LIMIT ?`,
    )(`%${lowered}%`, `%${lowered}%`, `%${lowered}%`, limit);
    const results = rows.map((row) => ({
      personId: row.id,
      displayName: row.display_name,
      canonicalEmail: row.canonical_email,
      githubLogin: row.github_login,
      score: this.scorePersonMatch(row, lowered),
    })).sort((left, right) => right.score - left.score);
    return { query, results };
  }

  updatePerson(id: string, input: PersonUpdateInput): PersonRecord | null {
    const existing = this.getPerson(id);
    if (!existing) return null;
    const now = nowIso();

    prepareRun(this.db,
      `UPDATE people
       SET display_name = ?, pronouns = ?, tags_json = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
    )(
      input.displayName ?? existing.displayName,
      input.pronouns !== undefined ? input.pronouns : existing.pronouns,
      JSON.stringify(input.tags ?? existing.tags),
      input.notes ?? existing.notes,
      now,
      id,
    );

    if (
      input.relationshipLabel !== undefined
      || input.reminderRouting !== undefined
      || input.approvalNotes !== undefined
    ) {
      this.upsertPolicy({
        personId: id,
        relationshipLabel: input.relationshipLabel !== undefined ? input.relationshipLabel : existing.policy?.relationshipLabel ?? null,
        reminderRouting: input.reminderRouting !== undefined ? input.reminderRouting : existing.policy?.reminderRouting ?? null,
        approvalNotes: input.approvalNotes !== undefined ? input.approvalNotes : existing.policy?.approvalNotes ?? null,
      });
    }

    for (const method of input.addContactMethods ?? []) {
      this.upsertContactMethod({
        personId: id,
        type: method.type,
        value: method.type === 'email' ? normalizeEmail(method.value) ?? method.value : normalizeHandle(method.value) ?? method.value,
        label: method.label ?? null,
        source: 'manual',
      });
    }

    this.refreshPersonDerivedState(id);
    return this.getPerson(id);
  }

  projectSeed(seed: PersonProjectionSeed): PersonRecord {
    const normalizedEmail = normalizeEmail(seed.email ?? seed.externalId);
    const normalizedHandle = normalizeHandle(seed.handle ?? (seed.provider === 'github' ? seed.externalId : null));
    const existingIdentity = this.getIdentityByProviderExternal(seed.provider, seed.externalId);
    if (existingIdentity) {
      this.updateIdentity(existingIdentity.id, {
        displayName: seed.displayName ?? existingIdentity.displayName,
        handle: normalizedHandle ?? existingIdentity.handle,
      });
      if (normalizedEmail) {
        this.upsertContactMethod({
          personId: existingIdentity.personId,
          type: 'email',
          value: normalizedEmail,
          label: 'derived',
          source: 'derived',
        });
      }
      if (normalizedHandle) {
        this.upsertContactMethod({
          personId: existingIdentity.personId,
          type: 'github',
          value: normalizedHandle,
          label: 'derived',
          source: 'derived',
        });
      }
      this.refreshPersonDerivedState(existingIdentity.personId, seed.activitySummary ?? null);
      return this.getPerson(existingIdentity.personId)!;
    }

    const existingPerson = normalizedEmail
      ? this.getPersonByCanonicalEmail(normalizedEmail)
      : normalizedHandle
        ? this.getPersonByGithubLogin(normalizedHandle)
        : null;
    const person = existingPerson ?? this.createPerson(seed.displayName ?? normalizedEmail ?? normalizedHandle ?? seed.externalId);
    this.insertIdentity({
      personId: person.id,
      provider: seed.provider,
      externalId: seed.externalId,
      displayName: seed.displayName ?? null,
      handle: normalizedHandle,
    });
    if (normalizedEmail) {
      this.upsertContactMethod({
        personId: person.id,
        type: 'email',
        value: normalizedEmail,
        label: 'derived',
        source: 'derived',
      });
    }
    if (normalizedHandle) {
      this.upsertContactMethod({
        personId: person.id,
        type: 'github',
        value: normalizedHandle,
        label: 'derived',
        source: 'derived',
      });
    }
    this.refreshPersonDerivedState(person.id, seed.activitySummary ?? null);
    return this.getPerson(person.id)!;
  }

  mergePeople(input: PersonMergeInput): PersonRecord {
    const source = this.getPerson(input.sourcePersonId);
    const target = this.getPerson(input.targetPersonId);
    if (!source || !target) {
      throw new Error('Source or target person not found');
    }
    if (source.id === target.id) {
      throw new Error('Cannot merge a person into itself');
    }
    if (source.policy && !target.policy) {
      this.upsertPolicy({
        personId: target.id,
        relationshipLabel: source.policy.relationshipLabel,
        reminderRouting: source.policy.reminderRouting,
        approvalNotes: source.policy.approvalNotes,
      });
    }

    const sourceIdentities = prepareAll<PersonIdentityRow>(this.db, 'SELECT * FROM person_identities WHERE person_id = ?')(source.id);
    for (const identity of sourceIdentities) {
      const duplicate = this.getIdentityByProviderExternal(identity.provider as PersonIdentityRecord['provider'], identity.external_id);
      if (duplicate && duplicate.personId === target.id) {
        prepareRun(this.db, 'DELETE FROM person_identities WHERE id = ?')(identity.id);
        continue;
      }
      prepareRun(this.db, 'UPDATE person_identities SET person_id = ?, updated_at = ? WHERE id = ?')(
        target.id,
        nowIso(),
        identity.id,
      );
    }
    const sourceContacts = prepareAll<PersonContactMethodRow>(this.db, 'SELECT * FROM person_contact_methods WHERE person_id = ?')(source.id);
    for (const contact of sourceContacts) {
      const duplicate = prepareGet<PersonContactMethodRow>(this.db,
        'SELECT * FROM person_contact_methods WHERE person_id = ? AND type = ? AND value = ?',
      )(target.id, contact.type, contact.value);
      if (duplicate) {
        prepareRun(this.db, 'DELETE FROM person_contact_methods WHERE id = ?')(contact.id);
        continue;
      }
      prepareRun(this.db, 'UPDATE person_contact_methods SET person_id = ?, updated_at = ? WHERE id = ?')(
        target.id,
        nowIso(),
        contact.id,
      );
    }
    prepareRun(this.db, 'DELETE FROM person_policy WHERE person_id = ?')(source.id);
    prepareRun(this.db, 'DELETE FROM person_activity_rollups WHERE person_id = ?')(source.id);
    prepareRun(this.db, 'DELETE FROM people WHERE id = ?')(source.id);
    this.recordMergeEvent({
      eventType: 'merge',
      sourcePersonId: source.id,
      targetPersonId: target.id,
      requestedBy: input.requestedBy,
    });
    this.refreshPersonDerivedState(target.id);
    return this.getPerson(target.id)!;
  }

  splitPerson(personId: string, input: PersonSplitInput): PersonRecord {
    const existing = this.getPerson(personId);
    if (!existing) {
      throw new Error(`Person ${personId} not found`);
    }
    const identities = input.identityIds
      .map((identityId: string) => this.getIdentity(identityId))
      .filter((identity): identity is PersonIdentityRecord => Boolean(identity));
    if (identities.length === 0) {
      throw new Error('No identities found for split');
    }
    const newPerson = this.createPerson(input.displayName ?? identities[0]!.displayName ?? identities[0]!.externalId);
    prepareRun(this.db,
      `UPDATE person_identities
       SET person_id = ?, updated_at = ?
       WHERE id IN (${identities.map(() => '?').join(', ')})`,
    )(newPerson.id, nowIso(), ...identities.map((identity: PersonIdentityRecord) => identity.id));
    for (const identity of identities) {
      this.recordMergeEvent({
        eventType: 'split',
        sourcePersonId: personId,
        targetPersonId: newPerson.id,
        identityId: identity.id,
        requestedBy: input.requestedBy,
      });
    }
    this.rebuildDerivedContacts(personId);
    this.rebuildDerivedContacts(newPerson.id);
    this.refreshPersonDerivedState(personId);
    this.refreshPersonDerivedState(newPerson.id);
    return this.getPerson(newPerson.id)!;
  }

  attachIdentity(input: PersonIdentityAttachInput): PersonRecord {
    const existing = this.getPerson(input.personId);
    if (!existing) {
      throw new Error(`Person ${input.personId} not found`);
    }
    const already = this.getIdentityByProviderExternal(input.provider, input.externalId);
    if (already && already.personId !== input.personId) {
      throw new Error(`Identity ${input.provider}:${input.externalId} already belongs to another person`);
    }
    if (!already) {
      this.insertIdentity({
        personId: input.personId,
        provider: input.provider,
        externalId: input.externalId,
        displayName: input.displayName ?? null,
        handle: normalizeHandle(input.handle),
      });
    }
    if (input.provider === 'github') {
      const normalized = normalizeHandle(input.handle ?? input.externalId);
      if (normalized) {
        this.upsertContactMethod({
          personId: input.personId,
          type: 'github',
          value: normalized,
          label: 'manual',
          source: 'manual',
        });
      }
    } else {
      const normalized = normalizeEmail(input.externalId);
      if (normalized) {
        this.upsertContactMethod({
          personId: input.personId,
          type: 'email',
          value: normalized,
          label: 'manual',
          source: 'manual',
        });
      }
    }
    this.refreshPersonDerivedState(input.personId);
    return this.getPerson(input.personId)!;
  }

  detachIdentity(identityId: string, requestedBy: string): PersonRecord {
    const identity = this.getIdentity(identityId);
    if (!identity) {
      throw new Error(`Identity ${identityId} not found`);
    }
    const newPerson = this.createPerson(identity.displayName ?? identity.externalId);
    prepareRun(this.db, 'UPDATE person_identities SET person_id = ?, updated_at = ? WHERE id = ?')(
      newPerson.id,
      nowIso(),
      identity.id,
    );
    this.recordMergeEvent({
      eventType: 'detach',
      sourcePersonId: identity.personId,
      targetPersonId: newPerson.id,
      identityId: identity.id,
      requestedBy,
    });
    this.rebuildDerivedContacts(identity.personId);
    this.rebuildDerivedContacts(newPerson.id);
    this.refreshPersonDerivedState(identity.personId);
    this.refreshPersonDerivedState(newPerson.id);
    return this.getPerson(newPerson.id)!;
  }

  // --- Merge events ---

  listMergeEvents(personId?: string): PersonMergeEventRecord[] {
    interface MergeEventRow {
      id: string;
      event_type: string;
      source_person_id: string | null;
      target_person_id: string | null;
      identity_id: string | null;
      requested_by: string;
      created_at: string;
    }
    const rows = personId
      ? prepareAll<MergeEventRow>(this.db,
        'SELECT * FROM person_merge_events WHERE source_person_id = ? OR target_person_id = ? ORDER BY created_at DESC',
      )(personId, personId)
      : prepareAll<MergeEventRow>(this.db, 'SELECT * FROM person_merge_events ORDER BY created_at DESC LIMIT 100')();
    return rows.map((row) => ({
      id: row.id,
      eventType: row.event_type as PersonMergeEventRecord['eventType'],
      sourcePersonId: row.source_person_id,
      targetPersonId: row.target_person_id,
      identityId: row.identity_id,
      requestedBy: row.requested_by,
      createdAt: row.created_at,
    }));
  }

  // --- Merge suggestions ---

  getMergeSuggestions(): PersonMergeSuggestion[] {
    const suggestions: PersonMergeSuggestion[] = [];
    const people = this.listPeople();
    const byEmail = new Map<string, PersonRecord[]>();
    const byGithub = new Map<string, PersonRecord[]>();

    for (const person of people) {
      if (person.canonicalEmail) {
        const bucket = byEmail.get(person.canonicalEmail) ?? [];
        bucket.push(person);
        byEmail.set(person.canonicalEmail, bucket);
      }
      if (person.githubLogin) {
        const bucket = byGithub.get(person.githubLogin) ?? [];
        bucket.push(person);
        byGithub.set(person.githubLogin, bucket);
      }
    }

    for (const [email, bucket] of byEmail) {
      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          suggestions.push({
            sourcePersonId: bucket[i]!.id,
            targetPersonId: bucket[j]!.id,
            sourceDisplayName: bucket[i]!.displayName,
            targetDisplayName: bucket[j]!.displayName,
            reason: `Shared email: ${email}`,
            confidence: 0.9,
          });
        }
      }
    }

    for (const [login, bucket] of byGithub) {
      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          const alreadySuggested = suggestions.some(
            (s) => (s.sourcePersonId === bucket[i]!.id && s.targetPersonId === bucket[j]!.id)
              || (s.sourcePersonId === bucket[j]!.id && s.targetPersonId === bucket[i]!.id),
          );
          if (!alreadySuggested) {
            suggestions.push({
              sourcePersonId: bucket[i]!.id,
              targetPersonId: bucket[j]!.id,
              sourceDisplayName: bucket[i]!.displayName,
              targetDisplayName: bucket[j]!.displayName,
              reason: `Shared GitHub: ${login}`,
              confidence: 0.85,
            });
          }
        }
      }
    }

    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }

  // --- Activity rollups ---

  getActivityRollups(personId: string): PersonActivityRollup[] {
    const rows = prepareAll<PersonActivityRollupRow>(this.db,
      'SELECT * FROM person_activity_rollups WHERE person_id = ?',
    )(personId);
    return rows.map((row) => ({
      personId: row.person_id,
      domain: (row as unknown as Record<string, unknown>)['domain'] as string ?? '',
      summary: row.summary,
      count: ((row as unknown as Record<string, unknown>)['count'] as number) ?? 0,
      lastSeenAt: ((row as unknown as Record<string, unknown>)['last_seen_at'] as string) ?? row.updated_at,
    }));
  }

  updateActivityRollup(personId: string, domain: string, summary: string, count: number): void {
    const now = nowIso();
    const existing = prepareGet<PersonActivityRollupRow>(this.db,
      'SELECT * FROM person_activity_rollups WHERE person_id = ?',
    )(personId);
    if (existing) {
      prepareRun(this.db,
        'UPDATE person_activity_rollups SET domain = ?, summary = ?, count = ?, last_seen_at = ?, updated_at = ? WHERE person_id = ?',
      )(domain, summary, count, now, now, personId);
    } else {
      prepareRun(this.db,
        'INSERT INTO person_activity_rollups (person_id, domain, summary, count, last_seen_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )(personId, domain, summary, count, now, now);
    }
  }

  private mapPersonRow(row: PersonRow): PersonRecord {
    const identities = prepareAll<PersonIdentityRow>(this.db, 'SELECT * FROM person_identities WHERE person_id = ? ORDER BY provider, external_id')(row.id)
      .map(mapIdentityRow);
    const contactMethods = prepareAll<PersonContactMethodRow>(this.db, 'SELECT * FROM person_contact_methods WHERE person_id = ? ORDER BY type, value')(row.id)
      .map(mapContactMethodRow);
    const policyRow = prepareGet<PersonPolicyRow>(this.db, 'SELECT * FROM person_policy WHERE person_id = ?')(row.id);
    const rollup = prepareGet<PersonActivityRollupRow>(this.db, 'SELECT * FROM person_activity_rollups WHERE person_id = ?')(row.id);
    return {
      id: row.id,
      displayName: row.display_name,
      pronouns: row.pronouns,
      tags: parseJsonArray(row.tags_json),
      notes: row.notes,
      canonicalEmail: row.canonical_email,
      githubLogin: row.github_login,
      activitySummary: rollup?.summary ?? row.activity_summary,
      identityCount: identities.length,
      contactMethodCount: contactMethods.length,
      policy: policyRow ? mapPolicyRow(policyRow) : null,
      identities,
      contactMethods,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private createPerson(displayName: string): PersonRecord {
    const id = randomUUID();
    const now = nowIso();
    prepareRun(this.db,
      `INSERT INTO people (
         id, display_name, pronouns, tags_json, notes, canonical_email, github_login, activity_summary, created_at, updated_at
       ) VALUES (?, ?, NULL, '[]', '', NULL, NULL, '', ?, ?)`,
    )(id, displayName, now, now);
    return this.getPerson(id)!;
  }

  private getPersonByCanonicalEmail(email: string): PersonRecord | null {
    const row = prepareGet<PersonRow>(this.db, 'SELECT * FROM people WHERE canonical_email = ?')(email);
    return row ? this.mapPersonRow(row) : null;
  }

  private getPersonByGithubLogin(login: string): PersonRecord | null {
    const row = prepareGet<PersonRow>(this.db, 'SELECT * FROM people WHERE github_login = ?')(login);
    return row ? this.mapPersonRow(row) : null;
  }

  private getIdentity(id: string): PersonIdentityRecord | null {
    const row = prepareGet<PersonIdentityRow>(this.db, 'SELECT * FROM person_identities WHERE id = ?')(id);
    return row ? mapIdentityRow(row) : null;
  }

  private getIdentityByProviderExternal(provider: PersonIdentityRecord['provider'], externalId: string): PersonIdentityRecord | null {
    const row = prepareGet<PersonIdentityRow>(this.db, 'SELECT * FROM person_identities WHERE provider = ? AND external_id = ?')(provider, externalId);
    return row ? mapIdentityRow(row) : null;
  }

  private insertIdentity(input: {
    personId: string;
    provider: PersonIdentityRecord['provider'];
    externalId: string;
    displayName: string | null;
    handle: string | null;
  }): PersonIdentityRecord {
    const id = randomUUID();
    const now = nowIso();
    prepareRun(this.db,
      `INSERT INTO person_identities (id, person_id, provider, external_id, display_name, handle, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )(id, input.personId, input.provider, input.externalId, input.displayName, input.handle, now, now);
    return this.getIdentity(id)!;
  }

  private updateIdentity(id: string, input: { displayName: string | null; handle: string | null }): void {
    prepareRun(this.db,
      'UPDATE person_identities SET display_name = ?, handle = ?, updated_at = ? WHERE id = ?',
    )(input.displayName, input.handle, nowIso(), id);
  }

  private upsertContactMethod(input: {
    personId: string;
    type: PersonContactMethodRecord['type'];
    value: string;
    label: string | null;
    source: PersonContactMethodRecord['source'];
  }): void {
    const existing = prepareGet<PersonContactMethodRow>(this.db,
      'SELECT * FROM person_contact_methods WHERE person_id = ? AND type = ? AND value = ?',
    )(input.personId, input.type, input.value);
    if (existing) {
      prepareRun(this.db,
        'UPDATE person_contact_methods SET label = ?, source = ?, updated_at = ? WHERE id = ?',
      )(input.label, input.source, nowIso(), existing.id);
      return;
    }
    prepareRun(this.db,
      `INSERT INTO person_contact_methods (id, person_id, type, value, label, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )(randomUUID(), input.personId, input.type, input.value, input.label, input.source, nowIso(), nowIso());
  }

  private upsertPolicy(input: {
    personId: string;
    relationshipLabel: string | null;
    reminderRouting: string | null;
    approvalNotes: string | null;
  }): void {
    const existing = prepareGet<PersonPolicyRow>(this.db, 'SELECT * FROM person_policy WHERE person_id = ?')(input.personId);
    if (existing) {
      prepareRun(this.db,
        `UPDATE person_policy
         SET relationship_label = ?, reminder_routing = ?, approval_notes = ?, updated_at = ?
         WHERE person_id = ?`,
      )(input.relationshipLabel, input.reminderRouting, input.approvalNotes, nowIso(), input.personId);
      return;
    }
    prepareRun(this.db,
      `INSERT INTO person_policy (person_id, relationship_label, reminder_routing, approval_notes, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )(input.personId, input.relationshipLabel, input.reminderRouting, input.approvalNotes, nowIso());
  }

  private refreshPersonDerivedState(personId: string, activitySummary: string | null = null): void {
    const identities = prepareAll<PersonIdentityRow>(this.db, 'SELECT * FROM person_identities WHERE person_id = ?')(personId);
    const contacts = prepareAll<PersonContactMethodRow>(this.db, 'SELECT * FROM person_contact_methods WHERE person_id = ?')(personId);
    const canonicalEmail = contacts.find((contact) => contact.type === 'email')?.value ?? null;
    const githubLogin = contacts.find((contact) => contact.type === 'github')?.value ?? null;
    const summary = activitySummary ?? unique(identities.map((identity) => identity.provider)).join(', ');
    prepareRun(this.db,
      `UPDATE people
       SET canonical_email = ?, github_login = ?, activity_summary = ?, updated_at = ?
       WHERE id = ?`,
    )(canonicalEmail, githubLogin, summary, nowIso(), personId);

    const existingRollup = prepareGet<PersonActivityRollupRow>(this.db, 'SELECT * FROM person_activity_rollups WHERE person_id = ?')(personId);
    if (existingRollup) {
      prepareRun(this.db,
        'UPDATE person_activity_rollups SET summary = ?, updated_at = ? WHERE person_id = ?',
      )(summary, nowIso(), personId);
    } else {
      prepareRun(this.db,
        'INSERT INTO person_activity_rollups (person_id, summary, updated_at) VALUES (?, ?, ?)',
      )(personId, summary, nowIso());
    }
  }

  private rebuildDerivedContacts(personId: string): void {
    prepareRun(this.db, "DELETE FROM person_contact_methods WHERE person_id = ? AND source = 'derived'")(personId);
    const identities = prepareAll<PersonIdentityRow>(this.db, 'SELECT * FROM person_identities WHERE person_id = ?')(personId);
    for (const identity of identities) {
      if (identity.provider === 'github') {
        const handle = normalizeHandle(identity.handle ?? identity.external_id);
        if (handle) {
          this.upsertContactMethod({
            personId,
            type: 'github',
            value: handle,
            label: 'derived',
            source: 'derived',
          });
        }
      } else {
        const email = normalizeEmail(identity.external_id);
        if (email) {
          this.upsertContactMethod({
            personId,
            type: 'email',
            value: email,
            label: 'derived',
            source: 'derived',
          });
        }
      }
    }
  }

  private scorePersonMatch(row: PersonRow, query: string): number {
    if (row.display_name.toLowerCase() === query) return 100;
    if ((row.canonical_email ?? '').toLowerCase() === query) return 95;
    if ((row.github_login ?? '').toLowerCase() === query) return 90;
    if (row.display_name.toLowerCase().includes(query)) return 80;
    if ((row.canonical_email ?? '').toLowerCase().includes(query)) return 70;
    if ((row.github_login ?? '').toLowerCase().includes(query)) return 65;
    return 50;
  }

  private recordMergeEvent(input: {
    eventType: string;
    sourcePersonId: string;
    targetPersonId: string;
    identityId?: string;
    requestedBy: string;
  }): void {
    prepareRun(this.db,
      `INSERT INTO person_merge_events (
         id, event_type, source_person_id, target_person_id, identity_id, requested_by, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )(
      randomUUID(),
      input.eventType,
      input.sourcePersonId,
      input.targetPersonId,
      input.identityId ?? null,
      input.requestedBy,
      nowIso(),
    );
  }
}
