import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';
import type { MemoryNamespaceKind, MemoryNamespaceRecord, MemorySourceType } from '@popeye/contracts';

function inferNamespaceKind(scope: string, sourceType?: MemorySourceType | string | undefined, domain?: string | undefined): MemoryNamespaceKind {
  if (scope === 'global') return 'global';
  if (scope.startsWith('project:')) return 'project';
  if (scope.startsWith('communications:') || scope.startsWith('comms:')) return 'communications';
  if (scope.startsWith('integration:')) return 'integration';
  if (sourceType === 'telegram') return 'communications';
  if (domain === 'coding' || sourceType === 'coding_session' || sourceType === 'code_review' || sourceType === 'debug_session') return 'coding';
  return 'workspace';
}

function buildNamespaceLabel(kind: MemoryNamespaceKind, scope: string): string {
  switch (kind) {
    case 'global':
      return 'Global';
    case 'project':
      return scope.replace(/^project:/, 'Project ');
    case 'communications':
      return scope.replace(/^(communications:|comms:)/, 'Communications ');
    case 'integration':
      return scope.replace(/^integration:/, 'Integration ');
    case 'coding':
      return scope.startsWith('coding:') ? scope.replace(/^coding:/, 'Coding ') : `Coding ${scope}`;
    case 'workspace':
    default:
      return scope.startsWith('workspace:') ? scope.replace(/^workspace:/, 'Workspace ') : `Workspace ${scope}`;
  }
}

export interface EnsureNamespaceInput {
  scope: string;
  sourceType?: MemorySourceType | string | undefined;
  domain?: string | undefined;
}

export function ensureMemoryNamespace(db: Database.Database, input: EnsureNamespaceInput): MemoryNamespaceRecord {
  const kind = inferNamespaceKind(input.scope, input.sourceType, input.domain);
  const externalRef = input.scope === 'global'
    ? null
    : input.scope.includes(':')
      ? input.scope.split(':').slice(1).join(':')
      : input.scope;
  const now = new Date().toISOString();

  const existing = db
    .prepare('SELECT id, kind, external_ref, label, created_at, updated_at FROM memory_namespaces WHERE kind = ? AND ((external_ref IS NULL AND ? IS NULL) OR external_ref = ?) LIMIT 1')
    .get(kind, externalRef, externalRef) as {
      id: string;
      kind: MemoryNamespaceKind;
      external_ref: string | null;
      label: string;
      created_at: string;
      updated_at: string;
    } | undefined;

  if (existing) {
    const label = buildNamespaceLabel(kind, input.scope);
    if (existing.label !== label) {
      db.prepare('UPDATE memory_namespaces SET label = ?, updated_at = ? WHERE id = ?').run(label, now, existing.id);
      return {
        id: existing.id,
        kind,
        externalRef: existing.external_ref,
        label,
        createdAt: existing.created_at,
        updatedAt: now,
      };
    }

    return {
      id: existing.id,
      kind: existing.kind,
      externalRef: existing.external_ref,
      label: existing.label,
      createdAt: existing.created_at,
      updatedAt: existing.updated_at,
    };
  }

  const record: MemoryNamespaceRecord = {
    id: randomUUID(),
    kind,
    externalRef,
    label: buildNamespaceLabel(kind, input.scope),
    createdAt: now,
    updatedAt: now,
  };

  db.prepare(
    'INSERT INTO memory_namespaces (id, kind, external_ref, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(record.id, record.kind, record.externalRef, record.label, record.createdAt, record.updatedAt);

  return record;
}

export function replaceOwnerTags(
  db: Database.Database,
  input: { ownerKind: 'artifact' | 'fact' | 'synthesis'; ownerId: string; tags?: string[] | undefined },
): string[] {
  const tags = [...new Set((input.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
  db.prepare('DELETE FROM memory_tags WHERE owner_kind = ? AND owner_id = ?').run(input.ownerKind, input.ownerId);
  if (tags.length === 0) return [];

  const now = new Date().toISOString();
  const insert = db.prepare('INSERT INTO memory_tags (id, owner_kind, owner_id, tag, created_at) VALUES (?, ?, ?, ?, ?)');
  const tx = db.transaction(() => {
    for (const tag of tags) {
      insert.run(randomUUID(), input.ownerKind, input.ownerId, tag, now);
    }
  });
  tx();
  return tags;
}
