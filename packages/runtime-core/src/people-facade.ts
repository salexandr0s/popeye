import type {
  CapabilityContext,
  PersonActivityRollup,
  PersonIdentityAttachInput,
  PersonIdentityDetachInput,
  PersonListItem,
  PersonMergeEventRecord,
  PersonMergeInput,
  PersonMergeSuggestion,
  PersonRecord,
  PersonSearchQuery,
  PersonSearchResult,
  PersonSplitInput,
  PersonUpdateInput,
  SecurityAuditEvent,
} from '@popeye/contracts';
import { nowIso } from '@popeye/contracts';
import { PeopleService, type PersonProjectionSeed } from '@popeye/cap-people';
import type { EmailService } from '@popeye/cap-email';
import type { GithubService } from '@popeye/cap-github';
import type { CalendarService } from '@popeye/cap-calendar';
import BetterSqlite3 from 'better-sqlite3';

import type { CapabilityFacade } from './capability-facade.js';
import type { CapabilityRegistry } from './capability-registry.js';
import { normalizeEmail } from './row-mappers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PeopleFacadeDeps {
  peopleFacade: CapabilityFacade<PeopleService>;
  capabilityRegistry: CapabilityRegistry;
  capabilityStoresDir: string;
  recordSecurityAudit: (event: SecurityAuditEvent) => void;
}

// ---------------------------------------------------------------------------
// PeopleFacade
// ---------------------------------------------------------------------------

export class PeopleFacade {
  private readonly peopleFacade: CapabilityFacade<PeopleService>;
  private readonly capabilityRegistry: CapabilityRegistry;
  private readonly capabilityStoresDir: string;
  private readonly recordSecurityAudit: (event: SecurityAuditEvent) => void;

  constructor(deps: PeopleFacadeDeps) {
    this.peopleFacade = deps.peopleFacade;
    this.capabilityRegistry = deps.capabilityRegistry;
    this.capabilityStoresDir = deps.capabilityStoresDir;
    this.recordSecurityAudit = deps.recordSecurityAudit;
  }

  // --- Helper: open writable people DB ---

  private withWriteDb<T>(fn: (svc: PeopleService) => T): T {
    const peopleCap = this.capabilityRegistry.getCapability('people');
    if (!peopleCap) throw new Error('People capability not initialized');
    const dbPath = `${this.capabilityStoresDir}/people.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new PeopleService(writeDb as unknown as CapabilityContext['appDb']);
      const result = fn(svc);
      this.peopleFacade.invalidate();
      return result;
    } finally {
      writeDb.close();
    }
  }

  // --- Public API ---

  listPeople(): PersonListItem[] {
    return this.peopleFacade.getService()?.listPeople() ?? [];
  }

  getPerson(id: string): PersonRecord | null {
    return this.peopleFacade.getService()?.getPerson(id) ?? null;
  }

  searchPeople(query: PersonSearchQuery): { query: string; results: PersonSearchResult[] } {
    const svc = this.peopleFacade.getService();
    if (!svc) {
      return { query: query.query, results: [] };
    }
    return svc.searchPeople(query.query, query.limit);
  }

  updatePerson(id: string, input: PersonUpdateInput): PersonRecord | null {
    return this.withWriteDb((svc) => svc.updatePerson(id, input));
  }

  mergePeople(input: PersonMergeInput): PersonRecord {
    return this.withWriteDb((svc) => {
      const merged = svc.mergePeople(input);
      this.recordSecurityAudit({
        code: 'people_merged',
        severity: 'info',
        message: 'People graph merge completed',
        component: 'runtime-core',
        timestamp: nowIso(),
        details: {
          sourcePersonId: input.sourcePersonId,
          targetPersonId: input.targetPersonId,
          requestedBy: input.requestedBy,
        },
      });
      return merged;
    });
  }

  splitPerson(personId: string, input: PersonSplitInput): PersonRecord {
    return this.withWriteDb((svc) => {
      const split = svc.splitPerson(personId, input);
      this.recordSecurityAudit({
        code: 'people_split',
        severity: 'info',
        message: 'People graph split completed',
        component: 'runtime-core',
        timestamp: nowIso(),
        details: {
          sourcePersonId: personId,
          targetPersonId: split.id,
          requestedBy: input.requestedBy,
        },
      });
      return split;
    });
  }

  attachPersonIdentity(input: PersonIdentityAttachInput): PersonRecord {
    return this.withWriteDb((svc) => svc.attachIdentity(input));
  }

  detachPersonIdentity(identityId: string, input: PersonIdentityDetachInput): PersonRecord {
    return this.withWriteDb((svc) => svc.detachIdentity(identityId, input.requestedBy));
  }

  listPersonMergeEvents(personId?: string): PersonMergeEventRecord[] {
    return this.peopleFacade.getService()?.listMergeEvents(personId) ?? [];
  }

  getPersonMergeSuggestions(): PersonMergeSuggestion[] {
    return this.peopleFacade.getService()?.getMergeSuggestions() ?? [];
  }

  getPersonActivityRollups(personId: string): PersonActivityRollup[] {
    return this.peopleFacade.getService()?.getActivityRollups(personId) ?? [];
  }

  // --- Projection helpers (public so sync methods can call them) ---

  refreshPeopleProjectionForEmailAccount(service: EmailService, accountId: string): void {
    const account = service.getAccount(accountId);
    if (!account) return;
    const seeds: PersonProjectionSeed[] = [{
      provider: 'email',
      externalId: account.emailAddress,
      displayName: account.displayName,
      email: account.emailAddress,
      activitySummary: 'email',
    }];
    for (const sender of service.getTopSenders(accountId, 50)) {
      const email = normalizeEmail(sender.fromAddress);
      if (!email) continue;
      seeds.push({
        provider: 'email',
        externalId: email,
        displayName: sender.fromAddress,
        email,
        activitySummary: 'email',
      });
    }
    this.projectPeopleSeeds(seeds);
  }

  refreshPeopleProjectionForCalendarAccount(service: CalendarService, accountId: string): void {
    const account = service.getAccount(accountId);
    if (!account) return;
    const seeds: PersonProjectionSeed[] = [{
      provider: 'calendar',
      externalId: account.calendarEmail,
      displayName: account.displayName,
      email: account.calendarEmail,
      activitySummary: 'calendar',
    }];
    for (const event of service.listEvents(accountId, { limit: 200 })) {
      const organizer = normalizeEmail(event.organizer);
      if (organizer) {
        seeds.push({
          provider: 'calendar',
          externalId: organizer,
          displayName: organizer,
          email: organizer,
          activitySummary: 'calendar',
        });
      }
      for (const attendee of event.attendees) {
        const email = normalizeEmail(attendee);
        if (!email) continue;
        seeds.push({
          provider: 'calendar',
          externalId: email,
          displayName: attendee,
          email,
          activitySummary: 'calendar',
        });
      }
    }
    this.projectPeopleSeeds(seeds);
  }

  refreshPeopleProjectionForGithubAccount(service: GithubService, accountId: string): void {
    const account = service.getAccount(accountId);
    if (!account) return;
    const seeds: PersonProjectionSeed[] = [{
      provider: 'github',
      externalId: account.githubUsername,
      displayName: account.displayName,
      handle: account.githubUsername,
      activitySummary: 'github',
    }];
    for (const repo of service.listRepos(accountId, { limit: 200 })) {
      seeds.push({
        provider: 'github',
        externalId: repo.owner,
        displayName: repo.owner,
        handle: repo.owner,
        activitySummary: 'github',
      });
    }
    for (const pr of service.listPullRequests(accountId, { limit: 200 })) {
      seeds.push({
        provider: 'github',
        externalId: pr.author,
        displayName: pr.author,
        handle: pr.author,
        activitySummary: 'github',
      });
      for (const reviewer of pr.requestedReviewers) {
        seeds.push({
          provider: 'github',
          externalId: reviewer,
          displayName: reviewer,
          handle: reviewer,
          activitySummary: 'github',
        });
      }
    }
    for (const issue of service.listIssues(accountId, { limit: 200 })) {
      seeds.push({
        provider: 'github',
        externalId: issue.author,
        displayName: issue.author,
        handle: issue.author,
        activitySummary: 'github',
      });
      for (const assignee of issue.assignees) {
        seeds.push({
          provider: 'github',
          externalId: assignee,
          displayName: assignee,
          handle: assignee,
          activitySummary: 'github',
        });
      }
    }
    this.projectPeopleSeeds(seeds);
  }

  private projectPeopleSeeds(seeds: PersonProjectionSeed[]): void {
    const deduped = new Map<string, PersonProjectionSeed>();
    for (const seed of seeds) {
      const key = `${seed.provider}:${seed.externalId}`;
      if (!deduped.has(key)) {
        deduped.set(key, seed);
      }
    }
    if (deduped.size === 0) return;
    const peopleCap = this.capabilityRegistry.getCapability('people');
    if (!peopleCap) return;
    const dbPath = `${this.capabilityStoresDir}/people.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new PeopleService(writeDb as unknown as CapabilityContext['appDb']);
      for (const seed of deduped.values()) {
        svc.projectSeed(seed);
      }
      this.peopleFacade.invalidate();
    } finally {
      writeDb.close();
    }
  }
}
