import type Database from 'better-sqlite3';
import type { DomainKind, MemoryNamespaceKind } from '@popeye/contracts';

export interface ConsumerProfile {
  id: string;
  label: string;
  defaultNamespaceKinds: MemoryNamespaceKind[];
  defaultDomains: DomainKind[];
  excludedDomains: DomainKind[];
  includeGlobal: boolean;
}

export const CONSUMER_PROFILES: Record<string, ConsumerProfile> = {
  assistant: {
    id: 'assistant',
    label: 'Popeye Assistant',
    defaultNamespaceKinds: ['global', 'workspace', 'project', 'communications', 'integration'],
    defaultDomains: [],
    excludedDomains: ['coding'],
    includeGlobal: true,
  },
  coding: {
    id: 'coding',
    label: 'Coding Agent',
    defaultNamespaceKinds: ['coding', 'workspace', 'project', 'global'],
    defaultDomains: ['coding', 'general', 'github'],
    excludedDomains: ['email', 'calendar', 'finance', 'medical', 'people'],
    includeGlobal: true,
  },
};

export interface ProfileResolvedFilters {
  domains?: string[];
  namespaceIds?: string[];
  includeGlobal?: boolean;
}

/**
 * Resolve a consumer profile into query filters. Explicit query params always
 * override profile defaults — profile is a convenience, not enforcement.
 */
export function applyConsumerProfile(
  profileId: string | undefined,
  query: { domains?: string[]; namespaceIds?: string[]; includeGlobal?: boolean },
  db: Database.Database,
): ProfileResolvedFilters {
  if (!profileId) return {};
  const profile = CONSUMER_PROFILES[profileId];
  if (!profile) return {};

  const result: ProfileResolvedFilters = {};

  // Domains: use explicit query domains, or fall back to profile defaults
  if (query.domains && query.domains.length > 0) {
    result.domains = query.domains;
  } else if (profile.defaultDomains.length > 0) {
    result.domains = [...profile.defaultDomains];
  } else if (profile.excludedDomains.length > 0) {
    // No explicit include list, but has exclusions — resolve all domains except excluded.
    // We don't enumerate all domains here; instead, the search layer applies exclusion.
    // Leave result.domains unset (already optional/undefined by default).
  }

  // Namespace IDs: use explicit query namespaceIds, or resolve profile kinds to IDs
  if (!query.namespaceIds || query.namespaceIds.length === 0) {
    const nsIds = resolveNamespaceIdsForKinds(db, profile.defaultNamespaceKinds);
    if (nsIds.length > 0) {
      result.namespaceIds = nsIds;
    }
  }

  // Include global
  if (query.includeGlobal === undefined) {
    result.includeGlobal = profile.includeGlobal;
  }

  return result;
}

/**
 * Look up namespace IDs for a set of namespace kinds. Returns IDs for kinds
 * that exist; kinds with no matching namespace are silently skipped.
 */
function resolveNamespaceIdsForKinds(db: Database.Database, kinds: MemoryNamespaceKind[]): string[] {
  if (kinds.length === 0) return [];
  const placeholders = kinds.map(() => '?').join(', ');
  const rows = db.prepare(
    `SELECT id FROM memory_namespaces WHERE kind IN (${placeholders})`,
  ).all(...kinds) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

/**
 * Get the list of excluded domains for a profile. Used for post-filtering
 * when the profile has exclusions but no explicit include list.
 */
export function getExcludedDomains(profileId: string | undefined): string[] {
  if (!profileId) return [];
  const profile = CONSUMER_PROFILES[profileId];
  return profile?.excludedDomains ?? [];
}
