import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';
import type { DataClassification, DomainKind, MemoryArtifactRecord, MemorySourceType } from '@popeye/contracts';
import { sha256 } from '@popeye/observability';

import { ensureMemoryNamespace, replaceOwnerTags } from './namespace.js';
import { canonicalizeMemoryLocation } from './location.js';

export interface CaptureArtifactInput {
  sourceType: MemorySourceType;
  classification: DataClassification;
  scope: string;
  workspaceId?: string | null | undefined;
  projectId?: string | null | undefined;
  content: string;
  sourceRunId?: string | null | undefined;
  sourceRef?: string | null | undefined;
  sourceRefType?: string | null | undefined;
  occurredAt?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
  tags?: string[] | undefined;
  domain?: DomainKind | undefined;
  sourceStreamId?: string | null | undefined;
}

export function captureArtifact(db: Database.Database, input: CaptureArtifactInput): MemoryArtifactRecord {
  const now = new Date().toISOString();
  const location = canonicalizeMemoryLocation({
    scope: input.scope,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
  });
  const namespace = ensureMemoryNamespace(db, { scope: location.scope, sourceType: input.sourceType, domain: input.domain });
  const contentHash = sha256(input.content);

  const existing = db.prepare(
    `SELECT id, source_type, classification, scope, workspace_id, project_id, namespace_id, source_run_id, source_ref, source_ref_type, captured_at, occurred_at, content, content_hash, metadata_json
     FROM memory_artifacts
     WHERE content_hash = ?
       AND source_type = ?
       AND ((workspace_id IS NULL AND ? IS NULL) OR workspace_id = ?)
       AND ((project_id IS NULL AND ? IS NULL) OR project_id = ?)
     ORDER BY captured_at DESC
     LIMIT 1`,
  ).get(
    contentHash,
    input.sourceType,
    location.workspaceId,
    location.workspaceId,
    location.projectId,
    location.projectId,
  ) as {
    id: string;
    source_type: MemorySourceType;
    classification: DataClassification;
    scope: string;
    workspace_id: string | null;
    project_id: string | null;
    namespace_id: string;
    source_run_id: string | null;
    source_ref: string | null;
    source_ref_type: string | null;
    captured_at: string;
    occurred_at: string | null;
    content: string;
    content_hash: string;
    metadata_json: string | null;
  } | undefined;

  if (existing) {
    replaceOwnerTags(db, { ownerKind: 'artifact', ownerId: existing.id, tags: input.tags });
    return {
      id: existing.id,
      sourceType: existing.source_type,
      classification: existing.classification,
      scope: existing.scope,
      workspaceId: existing.workspace_id,
      projectId: existing.project_id,
      namespaceId: existing.namespace_id,
      sourceRunId: existing.source_run_id,
      sourceRef: existing.source_ref,
      sourceRefType: existing.source_ref_type,
      capturedAt: existing.captured_at,
      occurredAt: existing.occurred_at,
      content: existing.content,
      contentHash: existing.content_hash,
      metadataJson: existing.metadata_json ? JSON.parse(existing.metadata_json) as Record<string, unknown> : {},
      domain: input.domain ?? 'general',
      sourceStreamId: null,
      artifactVersion: 1,
      contextReleasePolicy: 'full',
      trustScore: 0.7,
      invalidatedAt: null,
    };
  }

  // Compute artifact version — count existing artifacts for the same source stream
  let artifactVersion = 1;
  if (input.sourceStreamId) {
    const versionRow = db.prepare(
      'SELECT COUNT(*) as cnt FROM memory_artifacts WHERE source_stream_id = ?',
    ).get(input.sourceStreamId) as { cnt: number };
    artifactVersion = versionRow.cnt + 1;
  }

  const record: MemoryArtifactRecord = {
    id: randomUUID(),
    sourceType: input.sourceType,
    classification: input.classification,
    scope: location.scope,
    workspaceId: location.workspaceId,
    projectId: location.projectId,
    namespaceId: namespace.id,
    sourceRunId: input.sourceRunId ?? null,
    sourceRef: input.sourceRef ?? null,
    sourceRefType: input.sourceRefType ?? null,
    capturedAt: now,
    occurredAt: input.occurredAt ?? null,
    content: input.content,
    contentHash,
    metadataJson: input.metadata ?? {},
    domain: input.domain ?? 'general',
    sourceStreamId: input.sourceStreamId ?? null,
    artifactVersion: artifactVersion,
    contextReleasePolicy: 'full',
    trustScore: 0.7,
    invalidatedAt: null,
  };

  db.prepare(
    'INSERT INTO memory_artifacts (id, source_type, classification, scope, workspace_id, project_id, namespace_id, source_run_id, source_ref, source_ref_type, captured_at, occurred_at, content, content_hash, metadata_json, domain, source_stream_id, artifact_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    record.id,
    record.sourceType,
    record.classification,
    record.scope,
    record.workspaceId,
    record.projectId,
    record.namespaceId,
    record.sourceRunId,
    record.sourceRef,
    record.sourceRefType,
    record.capturedAt,
    record.occurredAt,
    record.content,
    record.contentHash,
    JSON.stringify(record.metadataJson),
    input.domain ?? 'general',
    record.sourceStreamId,
    record.artifactVersion,
  );

  replaceOwnerTags(db, { ownerKind: 'artifact', ownerId: record.id, tags: input.tags });
  return record;
}
