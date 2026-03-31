import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type BetterSqlite3 from 'better-sqlite3';

import type {
  AppliedPlaybook,
  AppConfig,
  PlaybookDetail,
  PlaybookProposalEvidence,
  PlaybookProposalKind,
  PlaybookProposalRecord,
  PlaybookProposalSource,
  PlaybookProposalStatus,
  PlaybookRecord,
  PlaybookRevisionRecord,
  PlaybookSearchResult,
  PlaybookScope,
  PlaybookUsageRunRecord,
  ResolvedPlaybook,
  RuntimePaths,
  SecurityAuditEvent,
} from '@popeye/contracts';
import {
  AppliedPlaybookSchema,
  PlaybookDetailSchema,
  PlaybookProposalRecordSchema,
  PlaybookRecordSchema,
  PlaybookRevisionRecordSchema,
  PlaybookSearchResultSchema,
  PlaybookUsageRunRecordSchema,
  nowIso,
} from '@popeye/contracts';
import type { WorkspaceRegistry } from '@popeye/workspace';
import {
  buildPlaybookDiff,
  buildPlaybookRecordId,
  discoverScopedPlaybooks,
  GLOBAL_PLAYBOOKS_DIR,
  parsePlaybookMarkdown,
  PROJECT_PLAYBOOKS_DIR,
  renderPlaybookMarkdown,
  WORKSPACE_PLAYBOOKS_DIR,
} from '@popeye/playbooks';
import { buildFts5MatchExpression, normalizeRelevanceScore } from '@popeye/memory';
import { redactText } from '@popeye/observability';

import { RuntimeConflictError, RuntimeNotFoundError, RuntimeValidationError } from './errors.js';
import { scanPrompt, type PromptScanOptions } from './prompt.js';

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (existsSync(path)) {
    chmodSync(path, 0o700);
  }
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== 'string' || value.trim().length === 0) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function normalizeOptionalId(value: string | null | undefined): string | null {
  return value == null || value.trim().length === 0 ? null : value;
}

function writeSecureFile(filePath: string, content: string): void {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, content, 'utf8');
  chmodSync(filePath, 0o600);
}

function scopeRank(scope: PlaybookScope): number {
  switch (scope) {
    case 'global':
      return 0;
    case 'workspace':
      return 1;
    case 'project':
      return 2;
  }
}

function buildSnippet(text: string, query: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return '';
  const lower = normalized.toLowerCase();
  const needle = query.toLowerCase();
  const index = lower.indexOf(needle);
  if (index === -1) {
    return normalized.length <= 160 ? normalized : `${normalized.slice(0, 157)}...`;
  }
  const start = Math.max(0, index - 60);
  const end = Math.min(normalized.length, index + needle.length + 100);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < normalized.length ? '...' : '';
  return `${prefix}${normalized.slice(start, end)}${suffix}`;
}

function comparePlaybookRecords(
  left: Pick<PlaybookRecord, 'scope' | 'title' | 'recordId'>,
  right: Pick<PlaybookRecord, 'scope' | 'title' | 'recordId'>,
): number {
  const byScope = scopeRank(left.scope) - scopeRank(right.scope);
  if (byScope !== 0) return byScope;
  const byTitle = left.title.localeCompare(right.title);
  if (byTitle !== 0) return byTitle;
  return left.recordId.localeCompare(right.recordId);
}

function comparePlaybookProposals(
  left: Pick<PlaybookProposalRecord, 'createdAt' | 'updatedAt' | 'title' | 'id'>,
  right: Pick<PlaybookProposalRecord, 'createdAt' | 'updatedAt' | 'title' | 'id'>,
  sort: NonNullable<PlaybookProposalListFilter['sort']>,
): number {
  switch (sort) {
    case 'created_asc': {
      const byCreated = left.createdAt.localeCompare(right.createdAt);
      if (byCreated !== 0) return byCreated;
      return left.id.localeCompare(right.id);
    }
    case 'updated_desc': {
      const byUpdated = right.updatedAt.localeCompare(left.updatedAt);
      if (byUpdated !== 0) return byUpdated;
      return right.id.localeCompare(left.id);
    }
    case 'updated_asc': {
      const byUpdated = left.updatedAt.localeCompare(right.updatedAt);
      if (byUpdated !== 0) return byUpdated;
      return left.id.localeCompare(right.id);
    }
    case 'title_asc': {
      const byTitle = left.title.localeCompare(right.title);
      if (byTitle !== 0) return byTitle;
      return left.id.localeCompare(right.id);
    }
    case 'title_desc': {
      const byTitle = right.title.localeCompare(left.title);
      if (byTitle !== 0) return byTitle;
      return right.id.localeCompare(left.id);
    }
    case 'created_desc':
    default: {
      const byCreated = right.createdAt.localeCompare(left.createdAt);
      if (byCreated !== 0) return byCreated;
      return right.id.localeCompare(left.id);
    }
  }
}

function renderResolvedPlaybookMarkdown(playbook: ResolvedPlaybook): string {
  return renderPlaybookMarkdown({
    frontMatter: {
      id: playbook.id,
      title: playbook.title,
      status: playbook.status,
      allowedProfileIds: playbook.allowedProfileIds,
    },
    body: playbook.body,
  });
}

function sanitizeSnippet(snippet: string | null | undefined): string {
  if (typeof snippet !== 'string') return '';
  return snippet.replace(/\s+/g, ' ').trim();
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function applyOffsetLimit<T>(items: T[], offset?: number, limit?: number): T[] {
  const safeOffset = Math.max(0, offset ?? 0);
  const sliced = safeOffset > 0 ? items.slice(safeOffset) : items;
  if (limit === undefined) return sliced;
  return sliced.slice(0, Math.max(0, limit));
}

function computeExactMatchBoost(
  candidate: Pick<PlaybookRecord, 'recordId' | 'playbookId' | 'title'>,
  normalizedQuery: string,
): number {
  const recordId = candidate.recordId.toLowerCase();
  const playbookId = candidate.playbookId.toLowerCase();
  const title = candidate.title.toLowerCase();

  let boost = 0;
  if (recordId === normalizedQuery) boost += 8;
  else if (recordId.includes(normalizedQuery)) boost += 4;
  if (playbookId === normalizedQuery) boost += 6;
  else if (playbookId.includes(normalizedQuery)) boost += 3;
  if (title === normalizedQuery) boost += 5;
  else if (title.includes(normalizedQuery)) boost += 2;
  return boost;
}

export interface PlaybookResolutionInput {
  workspaceId: string;
  projectId?: string | null;
  profileId?: string | null;
}

export interface PlaybookListFilter {
  q?: string | null;
  scope?: PlaybookScope;
  workspaceId?: string | null;
  projectId?: string | null;
  status?: 'draft' | 'active' | 'retired';
  limit?: number;
  offset?: number;
}

export interface PlaybookProposalListFilter {
  q?: string | null;
  status?: PlaybookProposalStatus;
  kind?: PlaybookProposalKind;
  scope?: PlaybookScope;
  sourceRunId?: string | null;
  targetRecordId?: string | null;
  sort?: 'created_desc' | 'created_asc' | 'updated_desc' | 'updated_asc' | 'title_asc' | 'title_desc';
  limit?: number;
  offset?: number;
}

export interface SearchPlaybooksInput {
  query: string;
  status?: PlaybookRecord['status'];
}

export type CreatePlaybookProposalInput =
  | {
      kind: 'draft';
      playbookId: string;
      scope: PlaybookScope;
      workspaceId?: string | null;
      projectId?: string | null;
      title: string;
      allowedProfileIds?: string[];
      body: string;
      summary?: string;
      sourceRunId?: string | null;
      proposedBy: PlaybookProposalSource;
      status?: Extract<PlaybookProposalStatus, 'drafting' | 'pending_review'>;
      evidence?: PlaybookProposalEvidence | null;
    }
  | {
      kind: 'patch';
      targetRecordId: string;
      baseRevisionHash?: string | null;
      title: string;
      allowedProfileIds?: string[];
      body: string;
      summary?: string;
      sourceRunId?: string | null;
      proposedBy: PlaybookProposalSource;
      status?: Extract<PlaybookProposalStatus, 'drafting' | 'pending_review'>;
      evidence?: PlaybookProposalEvidence | null;
    };

export interface ReviewPlaybookProposalInput {
  decision: 'approved' | 'rejected';
  reviewedBy: string;
  note?: string;
}

export interface ApplyPlaybookProposalInput {
  appliedBy: string;
}

export interface UpdatePlaybookProposalInput {
  title: string;
  allowedProfileIds?: string[];
  summary?: string;
  body: string;
  updatedBy: string;
}

export interface SubmitPlaybookProposalInput {
  submittedBy: string;
}

export interface UpdatePlaybookStatusInput {
  updatedBy: string;
}

type PlaybookRow = {
  record_id: string;
  playbook_id: string;
  scope: PlaybookScope;
  workspace_id: string | null;
  project_id: string | null;
  title: string;
  status: PlaybookRecord['status'];
  allowed_profile_ids_json: string;
  file_path: string;
  current_revision_hash: string;
  created_at: string;
  updated_at: string;
};

type PlaybookRevisionRow = {
  playbook_record_id: string;
  revision_hash: string;
  title: string;
  status: PlaybookRevisionRecord['status'];
  allowed_profile_ids_json: string;
  file_path: string;
  content_hash: string;
  markdown_text: string;
  created_at: string;
};

type PlaybookProposalRow = {
  id: string;
  kind: PlaybookProposalRecord['kind'];
  status: PlaybookProposalRecord['status'];
  target_record_id: string | null;
  base_revision_hash: string | null;
  playbook_id: string;
  scope: PlaybookScope;
  workspace_id: string | null;
  project_id: string | null;
  title: string;
  proposed_status: PlaybookProposalRecord['proposedStatus'];
  allowed_profile_ids_json: string;
  summary: string;
  body: string;
  markdown_text: string;
  diff_preview: string;
  content_hash: string;
  revision_hash: string;
  scan_verdict: PlaybookProposalRecord['scanVerdict'];
  scan_matched_rules_json: string;
  source_run_id: string | null;
  proposed_by: PlaybookProposalRecord['proposedBy'];
  evidence_json: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  applied_record_id: string | null;
  applied_revision_hash: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
};

type PlaybookSearchRow = {
  record_id: string;
  playbook_id: string;
  title: string;
  scope: PlaybookScope;
  workspace_id: string | null;
  project_id: string | null;
  status: PlaybookRecord['status'];
  current_revision_hash: string;
  allowed_profile_ids_json: string;
  raw_rank: number | null;
  snippet: string | null;
};

type PlaybookUsageRunRow = {
  run_id: string;
  task_id: string;
  job_id: string;
  run_state: string;
  started_at: string;
  finished_at: string | null;
  intervention_count: number;
  receipt_id: string | null;
};

export class PlaybookService {
  constructor(
    private readonly db: BetterSqlite3.Database,
    private readonly paths: RuntimePaths,
    private readonly workspaceRegistry: WorkspaceRegistry,
    private readonly config: AppConfig,
    private readonly recordSecurityAudit: (event: SecurityAuditEvent) => void,
  ) {
    ensureDir(this.globalPlaybooksDir);
  }

  get globalPlaybooksDir(): string {
    return join(this.paths.runtimeDataDir, GLOBAL_PLAYBOOKS_DIR);
  }

  resolveForContext(input: PlaybookResolutionInput) {
    const discovery = discoverScopedPlaybooks({
      directories: this.buildScopedDirectoriesForContext(input.workspaceId, input.projectId ?? null),
      profileId: input.profileId ?? null,
    });

    this.syncMetadata(discovery.all);
    return discovery.selected;
  }

  listPlaybooks(filter?: PlaybookListFilter): PlaybookRecord[] {
    const discovered = this.discoverAllPlaybooks();
    this.syncMetadata(discovered);
    const query = filter?.q?.trim() ?? '';

    if (query.length > 0) {
      return applyOffsetLimit(
        this.searchPlaybooks({
        query,
        ...(filter?.status ? { status: filter.status } : {}),
      })
        .map((result) => this.getPlaybookRow(result.recordId))
        .filter((row): row is PlaybookRow => row !== null)
        .map((row) => this.mapPlaybookRow(row))
        .filter((playbook) => {
          if (filter?.scope && playbook.scope !== filter.scope) return false;
          if (filter?.workspaceId !== undefined && playbook.workspaceId !== normalizeOptionalId(filter.workspaceId)) return false;
          if (filter?.projectId !== undefined && playbook.projectId !== normalizeOptionalId(filter.projectId)) return false;
          return true;
        }),
        filter?.offset,
        filter?.limit,
      );
    }

    return applyOffsetLimit(
      discovered
        .filter((playbook) => {
          if (filter?.scope && playbook.scope !== filter.scope) return false;
          if (filter?.workspaceId !== undefined && playbook.workspaceId !== normalizeOptionalId(filter.workspaceId)) return false;
          if (filter?.projectId !== undefined && playbook.projectId !== normalizeOptionalId(filter.projectId)) return false;
          if (filter?.status && playbook.status !== filter.status) return false;
          return true;
        })
        .map((playbook) => {
          const row = this.getPlaybookRow(playbook.recordId);
          return row ? this.mapPlaybookRow(row) : this.buildPlaybookRecord(playbook, nowIso(), nowIso());
        })
        .sort(comparePlaybookRecords),
      filter?.offset,
      filter?.limit,
    );
  }

  searchPlaybooks(input: SearchPlaybooksInput): PlaybookSearchResult[] {
    const normalizedQuery = input.query.trim();
    if (normalizedQuery.length === 0) return [];

    const discovered = this.discoverAllPlaybooks();
    this.syncMetadata(discovered);
    const matchExpr = buildFts5MatchExpression(normalizedQuery);
    if (matchExpr === '""') return [];

    const ftsParams: unknown[] = [matchExpr];
    const ftsConditions = ['playbooks_fts MATCH ?'];
    if (input.status) {
      ftsConditions.push('p.status = ?');
      ftsParams.push(input.status);
    }
    const ftsRows = this.db.prepare(`
      SELECT
        p.record_id,
        p.playbook_id,
        p.title,
        p.scope,
        p.workspace_id,
        p.project_id,
        p.status,
        p.current_revision_hash,
        p.allowed_profile_ids_json,
        bm25(playbooks_fts) AS raw_rank,
        snippet(playbooks_fts, 8, '', '', '...', 18) AS snippet
      FROM playbooks_fts
      JOIN playbooks p ON p.record_id = playbooks_fts.record_id
      WHERE ${ftsConditions.join(' AND ')}
    `).all(...ftsParams) as PlaybookSearchRow[];

    const recordIdParams: unknown[] = [`%${escapeLikePattern(normalizedQuery.toLowerCase())}%`];
    const recordIdConditions = ["LOWER(p.record_id) LIKE ? ESCAPE '\\'"];
    if (input.status) {
      recordIdConditions.push('p.status = ?');
      recordIdParams.push(input.status);
    }
    const recordIdRows = this.db.prepare(`
      SELECT
        p.record_id,
        p.playbook_id,
        p.title,
        p.scope,
        p.workspace_id,
        p.project_id,
        p.status,
        p.current_revision_hash,
        p.allowed_profile_ids_json,
        NULL AS raw_rank,
        NULL AS snippet
      FROM playbooks p
      JOIN playbooks_fts ON playbooks_fts.record_id = p.record_id
      WHERE ${recordIdConditions.join(' AND ')}
    `).all(...recordIdParams) as PlaybookSearchRow[];

    const mergedRows = new Map<string, PlaybookSearchRow>();
    for (const row of [...ftsRows, ...recordIdRows]) {
      const existing = mergedRows.get(row.record_id);
      if (!existing) {
        mergedRows.set(row.record_id, row);
        continue;
      }
      mergedRows.set(row.record_id, {
        ...existing,
        raw_rank: existing.raw_rank ?? row.raw_rank,
        snippet: sanitizeSnippet(existing.snippet).length > 0 ? existing.snippet : row.snippet,
      });
    }

    return Array.from(mergedRows.values())
      .map((row) =>
        PlaybookSearchResultSchema.parse({
          recordId: row.record_id,
          playbookId: row.playbook_id,
          title: row.title,
          scope: row.scope,
          workspaceId: row.workspace_id,
          projectId: row.project_id,
          status: row.status,
          currentRevisionHash: row.current_revision_hash,
          allowedProfileIds: parseStringArray(row.allowed_profile_ids_json),
          snippet: sanitizeSnippet(row.snippet) || buildSnippet(row.record_id, normalizedQuery),
          score:
            normalizeRelevanceScore(row.raw_rank ?? -9_999)
            + computeExactMatchBoost(
              {
                recordId: row.record_id,
                playbookId: row.playbook_id,
                title: row.title,
              },
              normalizedQuery.toLowerCase(),
            ),
        }),
      )
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => {
        const byScore = right.score - left.score;
        if (byScore !== 0) return byScore;
        return comparePlaybookRecords(left, right);
      });
  }

  getPlaybook(recordId: string): PlaybookDetail | null {
    const discovered = this.discoverAllPlaybooks();
    this.syncMetadata(discovered);
    const resolved = discovered.find((playbook) => playbook.recordId === recordId);
    if (!resolved) return null;
    const row = this.getPlaybookRow(recordId);
    const markdownText = renderPlaybookMarkdown({
      frontMatter: {
        id: resolved.id,
        title: resolved.title,
        status: resolved.status,
        allowedProfileIds: resolved.allowedProfileIds,
      },
      body: resolved.body,
    });
    return PlaybookDetailSchema.parse({
      ...(row ? this.mapPlaybookRow(row) : this.buildPlaybookRecord(resolved, nowIso(), nowIso())),
      body: resolved.body,
      markdownText,
    });
  }

  listRevisions(recordId: string): PlaybookRevisionRecord[] {
    const current = this.getPlaybook(recordId);
    if (!current) return [];
    const rows = this.db.prepare(`
      SELECT playbook_record_id, revision_hash, title, status, allowed_profile_ids_json, file_path, content_hash, markdown_text, created_at
      FROM playbook_revisions
      WHERE playbook_record_id = ?
      ORDER BY created_at DESC, revision_hash DESC
    `).all(recordId) as PlaybookRevisionRow[];
    return rows.map((row) =>
      PlaybookRevisionRecordSchema.parse({
        playbookRecordId: row.playbook_record_id,
        revisionHash: row.revision_hash,
        title: row.title,
        status: row.status,
        allowedProfileIds: parseStringArray(row.allowed_profile_ids_json),
        filePath: row.file_path,
        contentHash: row.content_hash,
        markdownText: row.markdown_text,
        createdAt: row.created_at,
        current: row.revision_hash === current.currentRevisionHash,
      }),
    );
  }

  createProposal(input: CreatePlaybookProposalInput): PlaybookProposalRecord {
    if (input.kind === 'draft' && input.status === 'drafting') {
      throw new RuntimeValidationError('Drafting status is only supported for patch proposals');
    }
    const prepared = this.prepareProposalDocument(input);
    const now = prepared.now;
    const proposalId = randomUUID();
    const status = input.status ?? 'pending_review';
    this.db.prepare(`
      INSERT INTO playbook_proposals (
        id,
        kind,
        status,
        target_record_id,
        base_revision_hash,
        playbook_id,
        scope,
        workspace_id,
        project_id,
        title,
        proposed_status,
        allowed_profile_ids_json,
        summary,
        body,
        markdown_text,
        diff_preview,
        content_hash,
        revision_hash,
        scan_verdict,
        scan_matched_rules_json,
        source_run_id,
        proposed_by,
        evidence_json,
        reviewed_by,
        reviewed_at,
        review_note,
        applied_record_id,
        applied_revision_hash,
        applied_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
    `).run(
      proposalId,
      input.kind,
      status,
      prepared.target?.recordId ?? null,
      prepared.baseRevisionHash,
      prepared.playbookId,
      prepared.scope,
      prepared.workspaceId,
      prepared.projectId,
      prepared.title,
      prepared.proposedStatus,
      JSON.stringify(prepared.allowedProfileIds),
      prepared.summary,
      prepared.body,
      prepared.markdownText,
      prepared.diffPreview,
      prepared.contentHash,
      prepared.revisionHash,
      prepared.scanVerdict,
      JSON.stringify(prepared.scanMatchedRules),
      input.sourceRunId ?? null,
      input.proposedBy,
      JSON.stringify(input.evidence ?? null),
      now,
      now,
    );

    if (prepared.scanVerdict === 'sanitize' && prepared.scanMatchedRules.length > 0) {
      this.recordSecurityAudit({
        code: 'playbook_proposal_sanitized',
        severity: 'warn',
        message: 'Playbook proposal was sanitized before storage',
        component: 'playbook-service',
        timestamp: now,
        details: {
          proposalId,
          ...(input.sourceRunId ? { runId: input.sourceRunId } : {}),
          kind: input.kind,
          proposedBy: input.proposedBy,
          matchedRules: prepared.scanMatchedRules.join(', '),
        },
      });
    }

    this.recordSecurityAudit({
      code: 'playbook_proposal_created',
      severity: 'info',
      message: 'Playbook proposal created',
      component: 'playbook-service',
      timestamp: now,
      details: {
        proposalId,
        ...(input.sourceRunId ? { runId: input.sourceRunId } : {}),
        kind: input.kind,
        proposedBy: input.proposedBy,
        status,
        playbookId: prepared.playbookId,
        scope: prepared.scope,
        ...(prepared.target?.recordId ? { targetRecordId: prepared.target.recordId } : {}),
      },
    });

    return this.getProposal(proposalId)!;
  }

  listProposals(filter?: PlaybookProposalListFilter): PlaybookProposalRecord[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM playbook_proposals
      ORDER BY created_at DESC, id DESC
    `).all() as PlaybookProposalRow[];
    const filtered = rows
      .map((row) => this.mapPlaybookProposalRow(row))
      .filter((proposal) => {
        if (filter?.status && proposal.status !== filter.status) return false;
        if (filter?.kind && proposal.kind !== filter.kind) return false;
        if (filter?.scope && proposal.scope !== filter.scope) return false;
        if (filter?.sourceRunId !== undefined && proposal.sourceRunId !== normalizeOptionalId(filter.sourceRunId)) return false;
        if (filter?.targetRecordId !== undefined && proposal.targetRecordId !== normalizeOptionalId(filter.targetRecordId)) return false;
        if (filter?.q?.trim()) {
          const needle = filter.q.trim().toLowerCase();
          const haystack = [
            proposal.title,
            proposal.summary,
            proposal.playbookId,
            proposal.id,
            proposal.targetRecordId ?? '',
            proposal.sourceRunId ?? '',
          ].join(' ').toLowerCase();
          if (!haystack.includes(needle)) return false;
        }
        return true;
      })
      .sort((left, right) => comparePlaybookProposals(left, right, filter?.sort ?? 'created_desc'));

    return applyOffsetLimit(filtered, filter?.offset, filter?.limit);
  }

  getProposal(id: string): PlaybookProposalRecord | null {
    const row = this.db.prepare('SELECT * FROM playbook_proposals WHERE id = ?').get(id) as PlaybookProposalRow | undefined;
    return row ? this.mapPlaybookProposalRow(row) : null;
  }

  updateProposal(id: string, input: UpdatePlaybookProposalInput): PlaybookProposalRecord {
    const proposal = this.getProposal(id);
    if (!proposal) throw new RuntimeNotFoundError(`Playbook proposal ${id} not found`);
    if (proposal.status !== 'drafting') {
      throw new RuntimeValidationError(`Playbook proposal ${id} is ${proposal.status} and cannot be edited`);
    }

    const prepared =
      proposal.kind === 'draft'
        ? this.prepareProposalDocument({
            kind: 'draft',
            playbookId: proposal.playbookId,
            scope: proposal.scope,
            workspaceId: proposal.workspaceId,
            projectId: proposal.projectId,
            title: input.title,
            body: input.body,
            sourceRunId: proposal.sourceRunId,
            proposedBy: proposal.proposedBy,
            status: 'drafting',
            evidence: proposal.evidence,
            ...(input.allowedProfileIds ? { allowedProfileIds: input.allowedProfileIds } : {}),
            ...(input.summary !== undefined ? { summary: input.summary } : {}),
          })
        : this.prepareProposalDocument({
            kind: 'patch',
            targetRecordId: proposal.targetRecordId ?? '',
            baseRevisionHash: proposal.baseRevisionHash,
            title: input.title,
            body: input.body,
            sourceRunId: proposal.sourceRunId,
            proposedBy: proposal.proposedBy,
            status: 'drafting',
            evidence: proposal.evidence,
            ...(input.allowedProfileIds ? { allowedProfileIds: input.allowedProfileIds } : {}),
            ...(input.summary !== undefined ? { summary: input.summary } : {}),
          });
    const updatedAt = nowIso();
    this.db.prepare(`
      UPDATE playbook_proposals
      SET title = ?,
          allowed_profile_ids_json = ?,
          summary = ?,
          body = ?,
          markdown_text = ?,
          diff_preview = ?,
          content_hash = ?,
          revision_hash = ?,
          scan_verdict = ?,
          scan_matched_rules_json = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      prepared.title,
      JSON.stringify(prepared.allowedProfileIds),
      prepared.summary,
      prepared.body,
      prepared.markdownText,
      prepared.diffPreview,
      prepared.contentHash,
      prepared.revisionHash,
      prepared.scanVerdict,
      JSON.stringify(prepared.scanMatchedRules),
      updatedAt,
      id,
    );
    this.recordSecurityAudit({
      code: 'playbook_proposal_updated',
      severity: 'info',
      message: 'Drafting playbook proposal updated',
      component: 'playbook-service',
      timestamp: updatedAt,
      details: {
        proposalId: id,
        updatedBy: input.updatedBy,
      },
    });
    return this.getProposal(id)!;
  }

  submitProposalForReview(id: string, input: SubmitPlaybookProposalInput): PlaybookProposalRecord {
    const proposal = this.getProposal(id);
    if (!proposal) throw new RuntimeNotFoundError(`Playbook proposal ${id} not found`);
    if (proposal.status !== 'drafting') {
      throw new RuntimeValidationError(`Playbook proposal ${id} is ${proposal.status} and cannot be submitted for review`);
    }
    if (proposal.kind === 'patch') {
      const target = this.requirePlaybook(proposal.targetRecordId ?? '');
      if (proposal.baseRevisionHash !== target.currentRevisionHash) {
        throw new RuntimeConflictError(`Playbook ${target.recordId} has changed since the proposal draft was created`);
      }
      const baseContentHash =
        this.getPlaybookRevisionContentHash(target.recordId, proposal.baseRevisionHash ?? target.currentRevisionHash)
        ?? parsePlaybookMarkdown(target.markdownText).contentHash;
      const hasCanonicalEdit = proposal.diffPreview
        .split('\n')
        .some((line) => line.startsWith('+ ') || line.startsWith('- '));
      if (!hasCanonicalEdit || baseContentHash === proposal.contentHash) {
        throw new RuntimeValidationError('Playbook patch drafts must change canonical content before they can be submitted for review');
      }
    }

    const updatedAt = nowIso();
    this.db.prepare(`
      UPDATE playbook_proposals
      SET status = 'pending_review', updated_at = ?
      WHERE id = ?
    `).run(updatedAt, id);
    this.recordSecurityAudit({
      code: 'playbook_proposal_submitted_for_review',
      severity: 'info',
      message: 'Playbook proposal submitted for review',
      component: 'playbook-service',
      timestamp: updatedAt,
      details: {
        proposalId: id,
        submittedBy: input.submittedBy,
      },
    });
    return this.getProposal(id)!;
  }

  listUsage(recordId: string, options?: { limit?: number; offset?: number }): PlaybookUsageRunRecord[] {
    this.requirePlaybook(recordId);
    const rows = this.db.prepare(`
      SELECT
        pu.run_id,
        pu.title,
        r.task_id,
        r.job_id,
        r.state AS run_state,
        r.started_at,
        r.finished_at,
        (
          SELECT COUNT(*)
          FROM interventions i
          WHERE i.run_id = pu.run_id
        ) AS intervention_count,
        (
          SELECT rc.id
          FROM receipts rc
          WHERE rc.run_id = pu.run_id
          ORDER BY rc.created_at DESC, rc.id DESC
          LIMIT 1
        ) AS receipt_id
      FROM playbook_usage pu
      JOIN runs r ON r.id = pu.run_id
      WHERE pu.playbook_record_id = ?
      ORDER BY pu.created_at DESC, pu.run_id DESC
    `).all(recordId) as PlaybookUsageRunRow[];

    return applyOffsetLimit(
      rows.map((row) => PlaybookUsageRunRecordSchema.parse({
        runId: row.run_id,
        taskId: row.task_id,
        jobId: row.job_id,
        runState: row.run_state,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        interventionCount: row.intervention_count,
        receiptId: row.receipt_id,
      })),
      options?.offset,
      options?.limit,
    );
  }

  reviewProposal(id: string, input: ReviewPlaybookProposalInput): PlaybookProposalRecord {
    const proposal = this.getProposal(id);
    if (!proposal) throw new RuntimeNotFoundError(`Playbook proposal ${id} not found`);
    if (proposal.status !== 'pending_review') {
      throw new RuntimeValidationError(`Playbook proposal ${id} is already ${proposal.status}`);
    }
    const reviewedAt = nowIso();
    const nextStatus = input.decision === 'approved' ? 'approved' : 'rejected';
    this.db.prepare(`
      UPDATE playbook_proposals
      SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, updated_at = ?
      WHERE id = ?
    `).run(nextStatus, input.reviewedBy, reviewedAt, input.note ?? '', reviewedAt, id);
    this.recordSecurityAudit({
      code: `playbook_proposal_${nextStatus}`,
      severity: 'info',
      message: `Playbook proposal ${nextStatus}`,
      component: 'playbook-service',
      timestamp: reviewedAt,
      details: {
        proposalId: id,
        reviewedBy: input.reviewedBy,
        ...(proposal.sourceRunId ? { runId: proposal.sourceRunId } : {}),
      },
    });
    return this.getProposal(id)!;
  }

  applyProposal(id: string, input: ApplyPlaybookProposalInput): PlaybookProposalRecord {
    const proposal = this.getProposal(id);
    if (!proposal) throw new RuntimeNotFoundError(`Playbook proposal ${id} not found`);
    if (proposal.status !== 'approved') {
      throw new RuntimeValidationError(`Playbook proposal ${id} must be approved before apply`);
    }

    let appliedRecordId: string;
    let appliedRevisionHash: string;

    if (proposal.kind === 'draft') {
      appliedRecordId = buildPlaybookRecordId({
        id: proposal.playbookId,
        scope: proposal.scope,
        workspaceId: proposal.workspaceId,
        projectId: proposal.projectId,
      });
      if (this.getPlaybook(appliedRecordId)) {
        throw new RuntimeConflictError(`Playbook ${appliedRecordId} already exists`);
      }
      const filePath = this.buildDraftFilePath(proposal.scope, proposal.workspaceId, proposal.projectId, proposal.playbookId);
      writeSecureFile(filePath, proposal.markdownText);
    } else {
      const target = this.requirePlaybook(proposal.targetRecordId ?? '');
      if (proposal.baseRevisionHash !== target.currentRevisionHash) {
        throw new RuntimeConflictError(`Playbook ${target.recordId} has changed since the proposal was created`);
      }
      writeSecureFile(target.filePath, proposal.markdownText);
      appliedRecordId = target.recordId;
    }

    const refreshed = this.requirePlaybook(appliedRecordId);
    appliedRevisionHash = refreshed.currentRevisionHash;
    const appliedAt = nowIso();
    this.db.prepare(`
      UPDATE playbook_proposals
      SET status = 'applied',
          applied_record_id = ?,
          applied_revision_hash = ?,
          applied_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(appliedRecordId, appliedRevisionHash, appliedAt, appliedAt, id);
    this.recordSecurityAudit({
      code: 'playbook_proposal_applied',
      severity: 'info',
      message: 'Playbook proposal applied',
      component: 'playbook-service',
      timestamp: appliedAt,
      details: {
        proposalId: id,
        appliedBy: input.appliedBy,
        appliedRecordId,
        appliedRevisionHash,
        ...(proposal.sourceRunId ? { runId: proposal.sourceRunId } : {}),
      },
    });
    return this.getProposal(id)!;
  }

  activatePlaybook(recordId: string, input: UpdatePlaybookStatusInput): PlaybookDetail {
    const playbook = this.requirePlaybook(recordId);
    if (playbook.status === 'active') return playbook;
    const updated = this.writePlaybookStatus(playbook, 'active');
    this.recordSecurityAudit({
      code: 'playbook_activated',
      severity: 'info',
      message: 'Playbook activated',
      component: 'playbook-service',
      timestamp: nowIso(),
      details: {
        recordId,
        updatedBy: input.updatedBy,
      },
    });
    return updated;
  }

  retirePlaybook(recordId: string, input: UpdatePlaybookStatusInput): PlaybookDetail {
    const playbook = this.requirePlaybook(recordId);
    if (playbook.status === 'retired') return playbook;
    const updated = this.writePlaybookStatus(playbook, 'retired');
    this.recordSecurityAudit({
      code: 'playbook_retired',
      severity: 'info',
      message: 'Playbook retired',
      component: 'playbook-service',
      timestamp: nowIso(),
      details: {
        recordId,
        updatedBy: input.updatedBy,
      },
    });
    return updated;
  }

  recordUsage(runId: string, playbooks: ResolvedPlaybook[]): void {
    this.db.prepare('DELETE FROM playbook_usage WHERE run_id = ?').run(runId);
    const insert = this.db.prepare(`
      INSERT INTO playbook_usage (
        run_id,
        playbook_record_id,
        playbook_id,
        revision_hash,
        title,
        scope,
        source_order,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    playbooks.forEach((playbook, index) => {
      insert.run(
        runId,
        playbook.recordId,
        playbook.id,
        playbook.revisionHash,
        playbook.title,
        playbook.scope,
        index,
        nowIso(),
      );
    });
  }

  listUsageForRun(runId: string): AppliedPlaybook[] {
    const rows = this.db.prepare(`
      SELECT playbook_id, title, scope, revision_hash
      FROM playbook_usage
      WHERE run_id = ?
      ORDER BY source_order ASC, playbook_id ASC
    `).all(runId) as Array<{
      playbook_id: string;
      title: string;
      scope: AppliedPlaybook['scope'];
      revision_hash: string;
    }>;

    return rows.map((row) =>
      AppliedPlaybookSchema.parse({
        id: row.playbook_id,
        title: row.title,
        scope: row.scope,
        revisionHash: row.revision_hash,
      }),
    );
  }

  private promptScanOptions(): PromptScanOptions | undefined {
    const customQuarantinePatterns = this.config.security.promptScanQuarantinePatterns ?? [];
    const customSanitizePatterns = this.config.security.promptScanSanitizePatterns ?? [];
    if (customQuarantinePatterns.length === 0 && customSanitizePatterns.length === 0) {
      return undefined;
    }
    return {
      customQuarantinePatterns,
      customSanitizePatterns,
    };
  }

  private buildScanInput(input: CreatePlaybookProposalInput): string {
    if (input.kind === 'draft') {
      return `${input.title}\n${input.summary ?? ''}\n${input.body}`;
    }
    return `${input.title}\n${input.summary ?? ''}\n${input.body}`;
  }

  private buildScopedDirectoriesForContext(workspaceId: string, projectId: string | null) {
    const workspace = this.workspaceRegistry.getWorkspace(workspaceId);
    const project = projectId ? this.workspaceRegistry.getProject(projectId) : null;
    return [
      { scope: 'global' as const, dirPath: this.globalPlaybooksDir },
      {
        scope: 'workspace' as const,
        dirPath: workspace?.rootPath ? join(workspace.rootPath, WORKSPACE_PLAYBOOKS_DIR) : null,
        workspaceId,
      },
      {
        scope: 'project' as const,
        dirPath: project?.path ? join(project.path, PROJECT_PLAYBOOKS_DIR) : null,
        workspaceId,
        projectId,
      },
    ];
  }

  private buildAllScopedDirectories() {
    const directories: Array<{
      scope: PlaybookScope;
      dirPath: string | null;
      workspaceId?: string | null;
      projectId?: string | null;
    }> = [{ scope: 'global', dirPath: this.globalPlaybooksDir }];

    for (const workspace of this.workspaceRegistry.listWorkspaces()) {
      directories.push({
        scope: 'workspace',
        dirPath: workspace.rootPath ? join(workspace.rootPath, WORKSPACE_PLAYBOOKS_DIR) : null,
        workspaceId: workspace.id,
      });
    }
    for (const project of this.workspaceRegistry.listProjects()) {
      directories.push({
        scope: 'project',
        dirPath: project.path ? join(project.path, PROJECT_PLAYBOOKS_DIR) : null,
        workspaceId: project.workspaceId,
        projectId: project.id,
      });
    }

    return directories;
  }

  private discoverAllPlaybooks(): ResolvedPlaybook[] {
    return discoverScopedPlaybooks({
      directories: this.buildAllScopedDirectories(),
      profileId: null,
    }).all;
  }

  private buildPlaybookRecord(playbook: ResolvedPlaybook, createdAt: string, updatedAt: string): PlaybookRecord {
    return PlaybookRecordSchema.parse({
      recordId: playbook.recordId,
      playbookId: playbook.id,
      scope: playbook.scope,
      workspaceId: playbook.workspaceId,
      projectId: playbook.projectId,
      title: playbook.title,
      status: playbook.status,
      allowedProfileIds: playbook.allowedProfileIds,
      filePath: playbook.path,
      currentRevisionHash: playbook.revisionHash,
      createdAt,
      updatedAt,
    });
  }

  private getPlaybookRow(recordId: string): PlaybookRow | null {
    const row = this.db.prepare('SELECT * FROM playbooks WHERE record_id = ?').get(recordId) as PlaybookRow | undefined;
    return row ?? null;
  }

  private mapPlaybookRow(row: PlaybookRow): PlaybookRecord {
    return PlaybookRecordSchema.parse({
      recordId: row.record_id,
      playbookId: row.playbook_id,
      scope: row.scope,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      title: row.title,
      status: row.status,
      allowedProfileIds: parseStringArray(row.allowed_profile_ids_json),
      filePath: row.file_path,
      currentRevisionHash: row.current_revision_hash,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private mapPlaybookProposalRow(row: PlaybookProposalRow): PlaybookProposalRecord {
    return PlaybookProposalRecordSchema.parse({
      id: row.id,
      kind: row.kind,
      status: row.status,
      targetRecordId: row.target_record_id,
      baseRevisionHash: row.base_revision_hash,
      playbookId: row.playbook_id,
      scope: row.scope,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      title: row.title,
      proposedStatus: row.proposed_status,
      allowedProfileIds: parseStringArray(row.allowed_profile_ids_json),
      summary: row.summary,
      body: row.body,
      markdownText: row.markdown_text,
      diffPreview: row.diff_preview,
      contentHash: row.content_hash,
      revisionHash: row.revision_hash,
      scanVerdict: row.scan_verdict,
      scanMatchedRules: parseStringArray(row.scan_matched_rules_json),
      sourceRunId: row.source_run_id,
      proposedBy: row.proposed_by,
      evidence: parseJsonRecord(row.evidence_json),
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at,
      reviewNote: row.review_note,
      appliedRecordId: row.applied_record_id,
      appliedRevisionHash: row.applied_revision_hash,
      appliedAt: row.applied_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private prepareProposalDocument(input: CreatePlaybookProposalInput) {
    const now = nowIso();
    const promptScan = scanPrompt(this.buildScanInput(input), this.promptScanOptions());
    if (promptScan.verdict === 'quarantine') {
      this.recordSecurityAudit({
        code: 'playbook_proposal_quarantined',
        severity: 'error',
        message: 'Playbook proposal was blocked by prompt scan',
        component: 'playbook-service',
        timestamp: now,
        details: {
          ...(input.sourceRunId ? { runId: input.sourceRunId } : {}),
          proposedBy: input.proposedBy,
          kind: input.kind,
          matchedRules: promptScan.matchedRules.join(', '),
        },
      });
      throw new RuntimeValidationError('Playbook proposal was blocked by prompt scan');
    }

    let target: PlaybookDetail | null = null;
    let playbookId: string;
    let scope: PlaybookScope;
    let workspaceId: string | null;
    let projectId: string | null;
    let proposedStatus: PlaybookRecord['status'];
    let baseRevisionHash: string | null;

    if (input.kind === 'draft') {
      playbookId = input.playbookId;
      scope = input.scope;
      workspaceId = normalizeOptionalId(input.workspaceId);
      projectId = normalizeOptionalId(input.projectId);
      proposedStatus = 'draft';
      baseRevisionHash = null;
    } else {
      target = this.requirePlaybook(input.targetRecordId);
      const requestedBaseRevisionHash = normalizeOptionalId(input.baseRevisionHash);
      if (requestedBaseRevisionHash && requestedBaseRevisionHash !== target.currentRevisionHash) {
        throw new RuntimeConflictError(`Playbook ${target.recordId} has changed since it was opened for patching`);
      }
      playbookId = target.playbookId;
      scope = target.scope;
      workspaceId = target.workspaceId;
      projectId = target.projectId;
      proposedStatus = target.status;
      baseRevisionHash = requestedBaseRevisionHash ?? target.currentRevisionHash;
    }

    this.assertScopeContext(scope, workspaceId, projectId);

    const titleRedaction = redactText(input.title, this.config.security.redactionPatterns);
    const summaryRedaction = redactText(input.summary ?? '', this.config.security.redactionPatterns);
    const bodyRedaction = redactText(promptScan.sanitizedText, this.config.security.redactionPatterns);
    for (const event of [...titleRedaction.events, ...summaryRedaction.events, ...bodyRedaction.events]) {
      this.recordSecurityAudit(event);
    }

    const allowedProfileIds = Array.from(new Set((input.allowedProfileIds ?? []).filter((value) => value.trim().length > 0))).sort();
    const markdownText = renderPlaybookMarkdown({
      frontMatter: {
        id: playbookId,
        title: titleRedaction.text,
        status: proposedStatus,
        allowedProfileIds,
      },
      body: bodyRedaction.text,
    });
    const parsed = parsePlaybookMarkdown(markdownText);
    const diffBaseMarkdown = target && baseRevisionHash
      ? this.getPlaybookRevisionMarkdown(target.recordId, baseRevisionHash) ?? target.markdownText
      : target?.markdownText ?? null;
    const diffPreview = buildPlaybookDiff(diffBaseMarkdown, markdownText);

    return {
      now,
      target,
      playbookId,
      scope,
      workspaceId,
      projectId,
      proposedStatus,
      baseRevisionHash,
      title: titleRedaction.text,
      summary: summaryRedaction.text,
      body: bodyRedaction.text,
      allowedProfileIds,
      markdownText,
      diffPreview,
      contentHash: parsed.contentHash,
      revisionHash: parsed.revisionHash,
      scanVerdict: promptScan.verdict,
      scanMatchedRules: promptScan.matchedRules,
    };
  }

  private getPlaybookRevisionMarkdown(recordId: string, revisionHash: string): string | null {
    const row = this.db.prepare(`
      SELECT markdown_text
      FROM playbook_revisions
      WHERE playbook_record_id = ? AND revision_hash = ?
      LIMIT 1
    `).get(recordId, revisionHash) as { markdown_text: string } | undefined;
    return row?.markdown_text ?? null;
  }

  private getPlaybookRevisionContentHash(recordId: string, revisionHash: string): string | null {
    const row = this.db.prepare(`
      SELECT content_hash
      FROM playbook_revisions
      WHERE playbook_record_id = ? AND revision_hash = ?
      LIMIT 1
    `).get(recordId, revisionHash) as { content_hash: string } | undefined;
    return row?.content_hash ?? null;
  }

  private requirePlaybook(recordId: string): PlaybookDetail {
    const playbook = this.getPlaybook(recordId);
    if (!playbook) throw new RuntimeNotFoundError(`Playbook ${recordId} not found`);
    return playbook;
  }

  private assertScopeContext(scope: PlaybookScope, workspaceId: string | null, projectId: string | null): void {
    if (scope === 'global') {
      if (workspaceId || projectId) {
        throw new RuntimeValidationError('Global playbooks may not specify workspace or project IDs');
      }
      return;
    }
    if (scope === 'workspace') {
      if (!workspaceId) throw new RuntimeValidationError('Workspace playbooks require workspaceId');
      if (projectId) throw new RuntimeValidationError('Workspace playbooks may not specify projectId');
      const workspace = this.workspaceRegistry.getWorkspace(workspaceId);
      if (!workspace?.rootPath) throw new RuntimeValidationError(`Workspace ${workspaceId} does not have a root path`);
      return;
    }
    if (!workspaceId || !projectId) {
      throw new RuntimeValidationError('Project playbooks require workspaceId and projectId');
    }
    const project = this.workspaceRegistry.getProject(projectId);
    if (!project?.path) throw new RuntimeValidationError(`Project ${projectId} does not have a path`);
    if (project.workspaceId !== workspaceId) {
      throw new RuntimeValidationError(`Project ${projectId} does not belong to workspace ${workspaceId}`);
    }
  }

  private buildDraftFilePath(scope: PlaybookScope, workspaceId: string | null, projectId: string | null, playbookId: string): string {
    if (scope === 'global') {
      return join(this.globalPlaybooksDir, `${playbookId}.md`);
    }
    if (scope === 'workspace') {
      const workspace = this.workspaceRegistry.getWorkspace(workspaceId ?? '');
      if (!workspace?.rootPath) {
        throw new RuntimeValidationError(`Workspace ${workspaceId ?? ''} does not have a root path`);
      }
      return join(workspace.rootPath, WORKSPACE_PLAYBOOKS_DIR, `${playbookId}.md`);
    }
    const project = this.workspaceRegistry.getProject(projectId ?? '');
    if (!project?.path) {
      throw new RuntimeValidationError(`Project ${projectId ?? ''} does not have a path`);
    }
    return join(project.path, PROJECT_PLAYBOOKS_DIR, `${playbookId}.md`);
  }

  private writePlaybookStatus(playbook: PlaybookDetail, status: 'active' | 'retired'): PlaybookDetail {
    writeSecureFile(playbook.filePath, renderPlaybookMarkdown({
      frontMatter: {
        id: playbook.playbookId,
        title: playbook.title,
        status,
        allowedProfileIds: playbook.allowedProfileIds,
      },
      body: playbook.body,
    }));
    return this.requirePlaybook(playbook.recordId);
  }

  private syncMetadata(playbooks: ResolvedPlaybook[]): void {
    const upsertPlaybook = this.db.prepare(`
      INSERT INTO playbooks (
        record_id,
        playbook_id,
        scope,
        workspace_id,
        project_id,
        title,
        status,
        allowed_profile_ids_json,
        file_path,
        current_revision_hash,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(record_id) DO UPDATE SET
        playbook_id = excluded.playbook_id,
        scope = excluded.scope,
        workspace_id = excluded.workspace_id,
        project_id = excluded.project_id,
        title = excluded.title,
        status = excluded.status,
        allowed_profile_ids_json = excluded.allowed_profile_ids_json,
        file_path = excluded.file_path,
        current_revision_hash = excluded.current_revision_hash,
        updated_at = excluded.updated_at
    `);
    const upsertRevision = this.db.prepare(`
      INSERT INTO playbook_revisions (
        playbook_record_id,
        revision_hash,
        title,
        status,
        allowed_profile_ids_json,
        file_path,
        content_hash,
        markdown_text,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(playbook_record_id, revision_hash) DO UPDATE SET
        title = excluded.title,
        status = excluded.status,
        allowed_profile_ids_json = excluded.allowed_profile_ids_json,
        file_path = excluded.file_path,
        content_hash = excluded.content_hash,
        markdown_text = excluded.markdown_text
    `);
    const replaceFts = this.db.prepare(`
      INSERT INTO playbooks_fts (
        record_id,
        playbook_id,
        title,
        scope,
        workspace_id,
        project_id,
        status,
        body,
        markdown_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const deleteFts = this.db.prepare('DELETE FROM playbooks_fts WHERE record_id = ?');
    const existingFtsRows = this.db.prepare('SELECT record_id FROM playbooks_fts').all() as Array<{ record_id: string }>;

    const timestamp = nowIso();
    const seenRecordIds = new Set<string>();
    for (const playbook of playbooks) {
      seenRecordIds.add(playbook.recordId);
      const existingRow = this.getPlaybookRow(playbook.recordId);
      const createdAt = existingRow?.created_at ?? timestamp;
      const markdownText = renderResolvedPlaybookMarkdown(playbook);
      upsertPlaybook.run(
        playbook.recordId,
        playbook.id,
        playbook.scope,
        playbook.workspaceId,
        playbook.projectId,
        playbook.title,
        playbook.status,
        JSON.stringify(playbook.allowedProfileIds),
        playbook.path,
        playbook.revisionHash,
        createdAt,
        timestamp,
      );
      upsertRevision.run(
        playbook.recordId,
        playbook.revisionHash,
        playbook.title,
        playbook.status,
        JSON.stringify(playbook.allowedProfileIds),
        playbook.path,
        playbook.contentHash,
        markdownText,
        timestamp,
      );
      deleteFts.run(playbook.recordId);
      replaceFts.run(
        playbook.recordId,
        playbook.id,
        playbook.title,
        playbook.scope,
        playbook.workspaceId,
        playbook.projectId,
        playbook.status,
        playbook.body,
        markdownText,
      );
    }

    for (const row of existingFtsRows) {
      if (!seenRecordIds.has(row.record_id)) {
        deleteFts.run(row.record_id);
      }
    }
  }
}
