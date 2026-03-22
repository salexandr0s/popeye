import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { DataClassification, ContextReleasePolicy, MemorySourceType } from '@popeye/contracts';
import { sha256 } from '@popeye/observability';

import { ensureMemoryNamespace } from './namespace.js';
import { canonicalizeMemoryLocation } from './location.js';

export interface ResolveSourceStreamInput {
  stableKey: string;
  providerKind: string;
  sourceType: MemorySourceType;
  scope: string;
  workspaceId?: string | null | undefined;
  projectId?: string | null | undefined;
  title?: string | null | undefined;
  canonicalUri?: string | null | undefined;
  classification: DataClassification;
  contextReleasePolicy?: ContextReleasePolicy | undefined;
  trustTier?: number | undefined;
  trustScore?: number | undefined;
  externalId?: string | null | undefined;
  domain?: string | undefined;
}

export interface SourceStreamRecord {
  id: string;
  stableKey: string;
  providerKind: string;
  sourceType: string;
  namespaceId: string;
  workspaceId: string | null;
  projectId: string | null;
  classification: string;
  contextReleasePolicy: string;
  trustTier: number;
  trustScore: number;
  ingestionStatus: string;
  lastProcessedHash: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SourceStreamRow {
  id: string;
  stable_key: string;
  provider_kind: string;
  source_type: string;
  namespace_id: string;
  workspace_id: string | null;
  project_id: string | null;
  classification: string;
  context_release_policy: string;
  trust_tier: number;
  trust_score: number;
  ingestion_status: string;
  last_processed_hash: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: SourceStreamRow): SourceStreamRecord {
  return {
    id: row.id,
    stableKey: row.stable_key,
    providerKind: row.provider_kind,
    sourceType: row.source_type,
    namespaceId: row.namespace_id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    classification: row.classification,
    contextReleasePolicy: row.context_release_policy,
    trustTier: row.trust_tier,
    trustScore: row.trust_score,
    ingestionStatus: row.ingestion_status,
    lastProcessedHash: row.last_processed_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Resolve or create a source stream by stable key.
 * Returns the existing record if found, or creates a new one.
 */
export function resolveOrCreateSourceStream(db: Database.Database, input: ResolveSourceStreamInput): SourceStreamRecord {
  const existing = db.prepare(
    'SELECT id, stable_key, provider_kind, source_type, namespace_id, workspace_id, project_id, classification, context_release_policy, trust_tier, trust_score, ingestion_status, last_processed_hash, created_at, updated_at FROM memory_source_streams WHERE stable_key = ? AND deleted_at IS NULL',
  ).get(input.stableKey) as SourceStreamRow | undefined;

  if (existing) return rowToRecord(existing);

  const now = new Date().toISOString();
  const location = canonicalizeMemoryLocation({
    scope: input.scope,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
  });
  const namespace = ensureMemoryNamespace(db, { scope: location.scope, sourceType: input.sourceType, domain: input.domain });
  const id = randomUUID();

  db.prepare(
    `INSERT INTO memory_source_streams
      (id, stable_key, provider_kind, source_type, external_id, namespace_id, workspace_id, project_id, title, canonical_uri, classification, context_release_policy, trust_tier, trust_score, ingestion_status, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', '{}', ?, ?)`,
  ).run(
    id,
    input.stableKey,
    input.providerKind,
    input.sourceType,
    input.externalId ?? null,
    namespace.id,
    location.workspaceId,
    location.projectId,
    input.title ?? null,
    input.canonicalUri ?? null,
    input.classification,
    input.contextReleasePolicy ?? 'full',
    input.trustTier ?? 3,
    input.trustScore ?? 0.7,
    now,
    now,
  );

  return {
    id,
    stableKey: input.stableKey,
    providerKind: input.providerKind,
    sourceType: input.sourceType,
    namespaceId: namespace.id,
    workspaceId: location.workspaceId,
    projectId: location.projectId,
    classification: input.classification,
    contextReleasePolicy: input.contextReleasePolicy ?? 'full',
    trustTier: input.trustTier ?? 3,
    trustScore: input.trustScore ?? 0.7,
    ingestionStatus: 'ready',
    lastProcessedHash: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Check if content has changed since last processing.
 * Returns true if the content is new or changed (should be re-processed).
 * Returns false if the content hash matches (no-op).
 */
export function hasContentChanged(db: Database.Database, sourceStreamId: string, content: string): boolean {
  const hash = sha256(content);
  const row = db.prepare(
    'SELECT last_processed_hash FROM memory_source_streams WHERE id = ?',
  ).get(sourceStreamId) as { last_processed_hash: string | null } | undefined;
  return !row || row.last_processed_hash !== hash;
}

/**
 * Update the source stream status and hash after processing.
 */
export function updateSourceStreamStatus(
  db: Database.Database,
  sourceStreamId: string,
  status: 'ready' | 'processing' | 'done' | 'failed',
  contentHash?: string,
): void {
  const now = new Date().toISOString();
  if (contentHash) {
    db.prepare(
      'UPDATE memory_source_streams SET ingestion_status = ?, last_processed_hash = ?, updated_at = ? WHERE id = ?',
    ).run(status, contentHash, now, sourceStreamId);
  } else {
    db.prepare(
      'UPDATE memory_source_streams SET ingestion_status = ?, updated_at = ? WHERE id = ?',
    ).run(status, now, sourceStreamId);
  }
}

/**
 * Soft-delete a source stream.
 */
export function markSourceStreamDeleted(db: Database.Database, sourceStreamId: string): void {
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE memory_source_streams SET deleted_at = ?, ingestion_status = 'deleted', updated_at = ? WHERE id = ?",
  ).run(now, now, sourceStreamId);
}

/**
 * Build a stable key for a source based on its type and identifying attributes.
 */
export function buildStableKey(sourceType: string, parts: Record<string, string | null | undefined>): string {
  const segments = Object.entries(parts)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}:${v}`)
    .join(':');
  return `${sourceType}:${segments}`;
}
