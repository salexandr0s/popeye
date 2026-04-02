import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import type {
  AuthRole,
  CuratedDocumentApplyResult,
  CuratedDocumentApplySaveInput,
  CuratedDocumentKind,
  CuratedDocumentRecord,
  CuratedDocumentSaveProposal,
  CuratedDocumentSummary,
  MutationReceiptKind,
  MutationReceiptRecord,
  MutationReceiptStatus,
  SecurityAuditEvent,
} from '@popeye/contracts';
import {
  CuratedDocumentApplyResultSchema,
  CuratedDocumentRecordSchema,
  CuratedDocumentSaveProposalSchema,
  CuratedDocumentSummarySchema,
  nowIso,
} from '@popeye/contracts';
import type { ProjectRecord, WorkspaceRecord } from '@popeye/contracts';
import {
  WORKSPACE_LAYOUT,
  canWriteWorkspacePath,
  resolveProjectFilePath,
  resolveWorkspaceFilePath,
  type WorkspaceRegistry,
} from '@popeye/workspace';
import { buildPlaybookDiff } from '@popeye/playbooks';
import { redactText } from '@popeye/observability';

import { RuntimeConflictError, RuntimeNotFoundError, RuntimeValidationError } from './errors.js';

interface CuratedDocumentServiceOptions {
  workspaceRegistry: WorkspaceRegistry;
  redactionPatterns: string[];
  writeMutationReceipt: (input: {
    kind: MutationReceiptKind;
    component: string;
    status: MutationReceiptStatus;
    summary: string;
    details: string;
    actorRole: AuthRole;
    workspaceId?: string | null;
    metadata?: Record<string, string>;
  }) => MutationReceiptRecord;
  recordSecurityAudit: (event: SecurityAuditEvent) => void;
}

interface ResolvedDocument {
  id: string;
  kind: CuratedDocumentKind;
  workspace: WorkspaceRecord;
  project: ProjectRecord | null;
  title: string;
  subtitle: string;
  filePath: string;
  critical: boolean;
}

const DAILY_NOTE_PATTERN = /^\d{4}-\d{2}-\d{2}\.md$/;
const DAILY_NOTE_ID_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

function writeSecureFile(filePath: string, content: string): void {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o600 });
  chmodSync(filePath, 0o600);
}

function normalizeMarkdown(markdownText: string): string {
  const normalized = markdownText.replace(/\r\n?/g, '\n');
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
}

function buildRevisionHash(markdownText: string): string {
  return createHash('sha256').update(markdownText, 'utf8').digest('hex');
}

function todayDailyNoteId(): string {
  return new Date().toISOString().slice(0, 10);
}

function dailyNotePath(workspaceRoot: string, dayId: string): string {
  const base = resolve(workspaceRoot, WORKSPACE_LAYOUT.dailyDir);
  const target = resolve(base, `${dayId}.md`);
  const rel = relative(base, target);
  if (rel.startsWith('..') || target.includes('\0')) {
    throw new RuntimeValidationError('Invalid daily note path.');
  }
  return target;
}

function readDocumentState(filePath: string): {
  exists: boolean;
  markdownText: string;
  revisionHash: string | null;
  updatedAt: string | null;
} {
  if (!existsSync(filePath)) {
    return {
      exists: false,
      markdownText: '',
      revisionHash: null,
      updatedAt: null,
    };
  }

  const markdownText = readFileSync(filePath, 'utf8');
  const stat = statSync(filePath);
  return {
    exists: true,
    markdownText,
    revisionHash: buildRevisionHash(markdownText),
    updatedAt: stat.mtime.toISOString(),
  };
}

function requiresExplicitConfirmation(critical: boolean): boolean {
  return critical;
}

export class CuratedDocumentService {
  private readonly workspaceRegistry: WorkspaceRegistry;
  private readonly redactionPatterns: string[];
  private readonly writeMutationReceipt: CuratedDocumentServiceOptions['writeMutationReceipt'];
  private readonly recordSecurityAudit: CuratedDocumentServiceOptions['recordSecurityAudit'];

  constructor(options: CuratedDocumentServiceOptions) {
    this.workspaceRegistry = options.workspaceRegistry;
    this.redactionPatterns = options.redactionPatterns;
    this.writeMutationReceipt = options.writeMutationReceipt;
    this.recordSecurityAudit = options.recordSecurityAudit;
  }

  listDocuments(workspaceId: string): CuratedDocumentSummary[] {
    const workspace = this.workspaceRegistry.getWorkspace(workspaceId);
    if (!workspace?.rootPath) {
      return [];
    }

    const summaries: CuratedDocumentSummary[] = [
      this.buildSummary({
        id: `workspace:${workspace.id}:instructions`,
        kind: 'workspace_instructions',
        workspace,
        project: null,
        title: 'Workspace Instructions',
        subtitle: workspace.name,
        filePath: resolveWorkspaceFilePath(workspace.rootPath, 'instructions'),
        critical: true,
      }),
      this.buildSummary({
        id: `workspace:${workspace.id}:soul`,
        kind: 'workspace_soul',
        workspace,
        project: null,
        title: 'Soul',
        subtitle: workspace.name,
        filePath: join(workspace.rootPath, 'SOUL.md'),
        critical: true,
      }),
      this.buildSummary({
        id: `workspace:${workspace.id}:identity`,
        kind: 'workspace_identity',
        workspace,
        project: null,
        title: 'Identity',
        subtitle: workspace.name,
        filePath: join(workspace.rootPath, 'IDENTITY.md'),
        critical: true,
      }),
      this.buildSummary({
        id: `workspace:${workspace.id}:memory`,
        kind: 'curated_memory',
        workspace,
        project: null,
        title: 'Curated Memory',
        subtitle: workspace.name,
        filePath: resolveWorkspaceFilePath(workspace.rootPath, 'memory'),
        critical: false,
      }),
    ];

    const projects = this.workspaceRegistry
      .listProjects()
      .filter((project) => project.workspaceId === workspace.id && project.path);
    for (const project of projects) {
      if (!project.path) continue;
      summaries.push(this.buildSummary({
        id: `project:${workspace.id}:${project.id}:instructions`,
        kind: 'project_instructions',
        workspace,
        project,
        title: project.name,
        subtitle: 'Project Instructions',
        filePath: resolveProjectFilePath(project.path, 'instructions'),
        critical: true,
      }));
    }

    for (const dayId of this.listDailyNoteIds(workspace.rootPath)) {
      summaries.push(this.buildSummary({
        id: `daily:${workspace.id}:${dayId}`,
        kind: 'daily_memory_note',
        workspace,
        project: null,
        title: dayId,
        subtitle: 'Daily Memory Note',
        filePath: dailyNotePath(workspace.rootPath, dayId),
        critical: false,
      }));
    }

    return summaries;
  }

  getDocument(id: string): CuratedDocumentRecord | null {
    const resolved = this.resolveDocument(id);
    if (!resolved) return null;
    return this.buildRecord(resolved);
  }

  proposeSave(id: string, input: { markdownText: string; baseRevisionHash?: string | null }): CuratedDocumentSaveProposal {
    const resolved = this.resolveRequiredDocument(id);
    const current = this.buildRecord(resolved);
    const redacted = redactText(normalizeMarkdown(input.markdownText), this.redactionPatterns);
    for (const event of redacted.events) {
      this.recordSecurityAudit(event);
    }

    const status = input.baseRevisionHash !== undefined && (input.baseRevisionHash ?? null) !== current.revisionHash
      ? 'conflict'
      : 'ready';
    const proposal = CuratedDocumentSaveProposalSchema.parse({
      documentId: id,
      status,
      normalizedMarkdown: redacted.text,
      diffPreview: buildPlaybookDiff(current.exists ? current.markdownText : null, redacted.text),
      baseRevisionHash: input.baseRevisionHash ?? null,
      currentRevisionHash: current.revisionHash,
      requiresExplicitConfirmation: requiresExplicitConfirmation(resolved.critical),
      redactionApplied: redacted.events.length > 0,
      conflictMessage: status === 'conflict'
        ? 'This document changed since it was loaded. Reload it before saving.'
        : null,
    });
    return proposal;
  }

  applySave(
    id: string,
    input: CuratedDocumentApplySaveInput,
    actorRole: AuthRole = 'operator',
  ): CuratedDocumentApplyResult {
    const resolved = this.resolveRequiredDocument(id);
    if (!canWriteWorkspacePath(resolved.filePath, input.confirmedCriticalWrite || !resolved.critical)) {
      throw new RuntimeValidationError('Explicit operator confirmation is required before saving this critical document.');
    }

    const current = this.buildRecord(resolved);
    const baseRevisionHash = input.baseRevisionHash ?? null;
    if (baseRevisionHash !== current.revisionHash) {
      throw new RuntimeConflictError('This document changed since it was loaded. Reload it before saving.');
    }

    const redacted = redactText(normalizeMarkdown(input.markdownText), this.redactionPatterns);
    for (const event of redacted.events) {
      this.recordSecurityAudit(event);
    }

    writeSecureFile(resolved.filePath, redacted.text);
    const saved = this.buildRecord(resolved);
    const receipt = this.writeMutationReceipt({
      kind: 'curated_document_save',
      component: 'curated_documents',
      status: 'succeeded',
      summary: `Saved ${resolved.title}`,
      details: `Saved ${resolved.kind} document ${resolved.id} at ${resolved.filePath}.`,
      actorRole,
      workspaceId: resolved.workspace.id,
      metadata: {
        documentId: resolved.id,
        kind: resolved.kind,
        filePath: resolved.filePath,
        critical: String(resolved.critical),
        ...(resolved.project ? { projectId: resolved.project.id } : {}),
      },
    });
    this.recordSecurityAudit({
      code: 'curated_document_saved',
      severity: 'info',
      message: `Saved curated document ${resolved.id}`,
      component: 'curated-document-service',
      timestamp: nowIso(),
      details: {
        documentId: resolved.id,
        kind: resolved.kind,
        workspaceId: resolved.workspace.id,
        ...(resolved.project ? { projectId: resolved.project.id } : {}),
        critical: String(resolved.critical),
        redactionApplied: String(redacted.events.length > 0),
      },
    });
    return CuratedDocumentApplyResultSchema.parse({
      document: saved,
      receipt,
    });
  }

  private listDailyNoteIds(workspaceRoot: string): string[] {
    const directory = resolveWorkspaceFilePath(workspaceRoot, 'dailyDir');
    const ids = existsSync(directory)
      ? readdirSync(directory)
        .filter((entry) => DAILY_NOTE_PATTERN.test(entry))
        .map((entry) => entry.replace(/\.md$/, ''))
      : [];
    const today = todayDailyNoteId();
    if (!ids.includes(today)) {
      ids.push(today);
    }
    return ids.sort((left, right) => right.localeCompare(left)).slice(0, 30);
  }

  private buildSummary(resolved: ResolvedDocument): CuratedDocumentSummary {
    const state = readDocumentState(resolved.filePath);
    return CuratedDocumentSummarySchema.parse({
      id: resolved.id,
      kind: resolved.kind,
      workspaceId: resolved.workspace.id,
      projectId: resolved.project?.id ?? null,
      title: resolved.title,
      subtitle: resolved.subtitle,
      filePath: resolved.filePath,
      writable: true,
      critical: resolved.critical,
      exists: state.exists,
      updatedAt: state.updatedAt,
    });
  }

  private buildRecord(resolved: ResolvedDocument): CuratedDocumentRecord {
    const state = readDocumentState(resolved.filePath);
    return CuratedDocumentRecordSchema.parse({
      id: resolved.id,
      kind: resolved.kind,
      workspaceId: resolved.workspace.id,
      projectId: resolved.project?.id ?? null,
      title: resolved.title,
      subtitle: resolved.subtitle,
      filePath: resolved.filePath,
      writable: true,
      critical: resolved.critical,
      exists: state.exists,
      updatedAt: state.updatedAt,
      markdownText: state.markdownText,
      revisionHash: state.revisionHash,
    });
  }

  private resolveRequiredDocument(id: string): ResolvedDocument {
    const resolved = this.resolveDocument(id);
    if (!resolved) {
      throw new RuntimeNotFoundError(`Curated document ${id} was not found.`);
    }
    return resolved;
  }

  private resolveDocument(id: string): ResolvedDocument | null {
    const segments = id.split(':');
    const kind = segments[0];
    if (kind === 'workspace' && segments.length === 3) {
      const workspaceId = segments[1];
      const variant = segments[2];
      if (!workspaceId || !variant) return null;
      const workspace = this.workspaceRegistry.getWorkspace(workspaceId);
      if (!workspace?.rootPath) return null;
      switch (variant) {
        case 'instructions':
          return {
            id,
            kind: 'workspace_instructions',
            workspace,
            project: null,
            title: 'Workspace Instructions',
            subtitle: workspace.name,
            filePath: resolveWorkspaceFilePath(workspace.rootPath, 'instructions'),
            critical: true,
          };
        case 'soul':
          return {
            id,
            kind: 'workspace_soul',
            workspace,
            project: null,
            title: 'Soul',
            subtitle: workspace.name,
            filePath: join(workspace.rootPath, 'SOUL.md'),
            critical: true,
          };
        case 'identity':
          return {
            id,
            kind: 'workspace_identity',
            workspace,
            project: null,
            title: 'Identity',
            subtitle: workspace.name,
            filePath: join(workspace.rootPath, 'IDENTITY.md'),
            critical: true,
          };
        case 'memory':
          return {
            id,
            kind: 'curated_memory',
            workspace,
            project: null,
            title: 'Curated Memory',
            subtitle: workspace.name,
            filePath: resolveWorkspaceFilePath(workspace.rootPath, 'memory'),
            critical: false,
          };
        default:
          return null;
      }
    }

    if (kind === 'project' && segments.length === 4 && segments[3] === 'instructions') {
      const workspaceId = segments[1];
      const projectId = segments[2];
      if (!workspaceId || !projectId) return null;
      const workspace = this.workspaceRegistry.getWorkspace(workspaceId);
      const project = this.workspaceRegistry.getProject(projectId);
      if (!workspace?.rootPath || !project?.path || project.workspaceId !== workspace.id) return null;
      return {
        id,
        kind: 'project_instructions',
        workspace,
        project,
        title: project.name,
        subtitle: 'Project Instructions',
        filePath: resolveProjectFilePath(project.path, 'instructions'),
        critical: true,
      };
    }

    const dayIdCandidate = segments[2];
    if (kind === 'daily' && segments.length === 3 && dayIdCandidate && DAILY_NOTE_ID_PATTERN.test(dayIdCandidate)) {
      const workspaceId = segments[1];
      const dayId = dayIdCandidate;
      if (!workspaceId || !dayId) return null;
      const workspace = this.workspaceRegistry.getWorkspace(workspaceId);
      if (!workspace?.rootPath) return null;
      return {
        id,
        kind: 'daily_memory_note',
        workspace,
        project: null,
        title: dayId,
        subtitle: 'Daily Memory Note',
        filePath: dailyNotePath(workspace.rootPath, dayId),
        critical: false,
      };
    }

    return null;
  }
}
