import { isAbsolute, relative, resolve } from 'node:path';

import type {
  CompiledInstructionBundle,
  InstructionPreviewDiffResponse,
  InstructionPreviewExplainResponse,
  InstructionPreviewSourceMetadata,
  InstructionResolutionContext,
  ResolvedPlaybook,
} from '@popeye/contracts';
import {
  CompiledInstructionBundleSchema,
  InstructionPreviewDiffResponseSchema,
  InstructionPreviewExplainResponseSchema,
  InstructionPreviewSourceMetadataSchema,
} from '@popeye/contracts';
import {
  buildPlaybookInstructionSource,
  compileInstructionBundle,
  resolveInstructionSources,
  type ResolverDependencies,
} from '@popeye/instructions';
import { toAppliedPlaybook } from '@popeye/playbooks';
import type { WorkspaceRegistry } from '@popeye/workspace';

import type { RuntimeDatabases } from './database.js';
import type { PlaybookService } from './playbook-service.js';

export class InstructionPreviewContextError extends Error {
  readonly errorCode: 'not_found' | 'invalid_context';

  constructor(errorCode: 'not_found' | 'invalid_context', message: string) {
    super(message);
    this.name = 'InstructionPreviewContextError';
    this.errorCode = errorCode;
  }
}

export interface ResolvedInstructionRunBundle {
  bundle: CompiledInstructionBundle;
  resolvedPlaybooks: ResolvedPlaybook[];
}

function buildResolverDependencies(workspaceRegistry: WorkspaceRegistry): ResolverDependencies {
  return {
    getWorkspace: (id) => {
      const workspace = workspaceRegistry.getWorkspace(id);
      if (!workspace) return null;
      return { id: workspace.id, name: workspace.name, rootPath: workspace.rootPath };
    },
    getProject: (id) => {
      const project = workspaceRegistry.getProject(id);
      if (!project) return null;
      return { id: project.id, name: project.name, path: project.path, workspaceId: project.workspaceId };
    },
    getPopeyeBaseInstructions: () => null,
    getGlobalOperatorInstructions: () => null,
  };
}

function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const relativePath = relative(resolve(rootPath), resolve(candidatePath));
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function deriveInstructionCwd(
  workspaceRegistry: WorkspaceRegistry,
  workspaceId: string,
  projectId?: string | null,
  cwd?: string | null,
): string | undefined {
  if (cwd) return cwd;
  if (projectId) {
    const project = workspaceRegistry.getProject(projectId);
    if (project?.path) return project.path;
  }
  const workspace = workspaceRegistry.getWorkspace(workspaceId);
  return workspace?.rootPath ?? undefined;
}

function validateInstructionContext(
  workspaceRegistry: WorkspaceRegistry,
  context: Pick<InstructionResolutionContext, 'workspaceId' | 'projectId' | 'cwd'>,
): void {
  const workspace = workspaceRegistry.getWorkspace(context.workspaceId);
  if (!workspace) {
    throw new InstructionPreviewContextError('not_found', `Workspace ${context.workspaceId} not found`);
  }

  if (context.projectId) {
    const project = workspaceRegistry.getProject(context.projectId);
    if (!project) {
      throw new InstructionPreviewContextError('not_found', `Project ${context.projectId} not found`);
    }
    if (project.workspaceId !== context.workspaceId) {
      throw new InstructionPreviewContextError(
        'invalid_context',
        `Project ${context.projectId} does not belong to workspace ${context.workspaceId}`,
      );
    }
  }

  if (context.cwd && workspace.rootPath && !isPathWithinRoot(context.cwd, workspace.rootPath)) {
    throw new InstructionPreviewContextError(
      'invalid_context',
      `cwd ${context.cwd} is outside workspace ${context.workspaceId}`,
    );
  }
}

function normalizeInstructionContext(
  databases: RuntimeDatabases,
  workspaceRegistry: WorkspaceRegistry,
  context: InstructionResolutionContext,
): InstructionResolutionContext {
  validateInstructionContext(workspaceRegistry, context);
  const instructionCwd = deriveInstructionCwd(workspaceRegistry, context.workspaceId, context.projectId, context.cwd);
  const storedDefaultIdentity = databases.app
    .prepare('SELECT identity_id FROM workspace_identity_defaults WHERE workspace_id = ?')
    .get(context.workspaceId) as { identity_id: string } | undefined;
  return {
    workspaceId: context.workspaceId,
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(context.profileId ? { profileId: context.profileId } : {}),
    ...(instructionCwd ? { cwd: instructionCwd } : {}),
    identity: context.identity ?? storedDefaultIdentity?.identity_id ?? 'default',
    ...(context.taskBrief ? { taskBrief: context.taskBrief } : {}),
    ...(context.triggerOverlay ? { triggerOverlay: context.triggerOverlay } : {}),
    ...(context.runtimeNotes ? { runtimeNotes: context.runtimeNotes } : {}),
  };
}

function buildSourceMetadata(bundle: CompiledInstructionBundle): InstructionPreviewSourceMetadata[] {
  const perPrecedenceCount = new Map<number, number>();
  return bundle.sources.map((source) => {
    const bandOrder = perPrecedenceCount.get(source.precedence) ?? 0;
    perPrecedenceCount.set(source.precedence, bandOrder + 1);
    return InstructionPreviewSourceMetadataSchema.parse({
      precedence: source.precedence,
      type: source.type,
      ...(source.path ? { path: source.path } : {}),
      ...(source.inlineId ? { inlineId: source.inlineId } : {}),
      contentHash: source.contentHash,
      bandOrder,
    });
  });
}

function recordInstructionSnapshot(
  databases: RuntimeDatabases,
  bundle: CompiledInstructionBundle,
  context: InstructionResolutionContext,
): void {
  databases.app.prepare('INSERT INTO instruction_snapshots (id, scope, project_id, bundle_json, created_at) VALUES (?, ?, ?, ?, ?)').run(
    bundle.id,
    context.workspaceId,
    context.projectId ?? null,
    JSON.stringify(bundle),
    bundle.createdAt,
  );
}

function buildInstructionBundleForContext(
  databases: RuntimeDatabases,
  workspaceRegistry: WorkspaceRegistry,
  playbookService: PlaybookService,
  rawContext: InstructionResolutionContext,
  options: { captureSnapshot?: boolean } = {},
): { bundle: CompiledInstructionBundle; resolvedPlaybooks: ResolvedPlaybook[]; context: InstructionResolutionContext } {
  const context = normalizeInstructionContext(databases, workspaceRegistry, rawContext);
  const resolvedPlaybooks = playbookService.resolveForContext({
    workspaceId: context.workspaceId,
    ...(context.projectId ? { projectId: context.projectId } : {}),
    profileId: context.profileId ?? null,
  });
  const playbookSource = buildPlaybookInstructionSource(resolvedPlaybooks);
  const bundle = CompiledInstructionBundleSchema.parse(compileInstructionBundle({
    sources: [
      ...resolveInstructionSources(context, buildResolverDependencies(workspaceRegistry)),
      ...(playbookSource ? [playbookSource] : []),
    ],
    playbooks: resolvedPlaybooks.map((playbook) => toAppliedPlaybook(playbook)),
  }));

  if (options.captureSnapshot !== false) {
    recordInstructionSnapshot(databases, bundle, context);
  }

  return { bundle, resolvedPlaybooks, context };
}

function buildMetadataCounts(entries: InstructionPreviewSourceMetadata[]): Map<string, InstructionPreviewSourceMetadata[]> {
  const grouped = new Map<string, InstructionPreviewSourceMetadata[]>();
  for (const entry of entries) {
    const key = `${entry.precedence}:${entry.type}:${entry.path ?? ''}:${entry.inlineId ?? ''}:${entry.contentHash}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(entry);
    grouped.set(key, bucket);
  }
  return grouped;
}

export function createInstructionPreview(
  databases: RuntimeDatabases,
  workspaceRegistry: WorkspaceRegistry,
  playbookService: PlaybookService,
  context: InstructionResolutionContext,
): CompiledInstructionBundle {
  return buildInstructionBundleForContext(databases, workspaceRegistry, playbookService, context).bundle;
}

export function explainInstructionPreview(
  databases: RuntimeDatabases,
  workspaceRegistry: WorkspaceRegistry,
  playbookService: PlaybookService,
  context: InstructionResolutionContext,
): InstructionPreviewExplainResponse {
  const resolved = buildInstructionBundleForContext(databases, workspaceRegistry, playbookService, context);
  return InstructionPreviewExplainResponseSchema.parse({
    bundle: resolved.bundle,
    context: resolved.context,
    sources: buildSourceMetadata(resolved.bundle),
  });
}

export function diffInstructionPreviews(
  databases: RuntimeDatabases,
  workspaceRegistry: WorkspaceRegistry,
  playbookService: PlaybookService,
  input: { left: InstructionResolutionContext; right: InstructionResolutionContext },
): InstructionPreviewDiffResponse {
  const left = buildInstructionBundleForContext(databases, workspaceRegistry, playbookService, input.left, { captureSnapshot: false });
  const right = buildInstructionBundleForContext(databases, workspaceRegistry, playbookService, input.right, { captureSnapshot: false });
  const leftSources = buildSourceMetadata(left.bundle);
  const rightSources = buildSourceMetadata(right.bundle);
  const leftGroups = buildMetadataCounts(leftSources);
  const rightGroups = buildMetadataCounts(rightSources);
  const allKeys = new Set([...leftGroups.keys(), ...rightGroups.keys()]);

  const addedSources: InstructionPreviewSourceMetadata[] = [];
  const removedSources: InstructionPreviewSourceMetadata[] = [];
  const reorderedSources: Array<{ source: InstructionPreviewSourceMetadata; leftIndex: number; rightIndex: number }> = [];

  for (const key of allKeys) {
    const leftBucket = leftGroups.get(key) ?? [];
    const rightBucket = rightGroups.get(key) ?? [];
    const sharedCount = Math.min(leftBucket.length, rightBucket.length);

    if (rightBucket.length > sharedCount) {
      addedSources.push(...rightBucket.slice(sharedCount));
    }
    if (leftBucket.length > sharedCount) {
      removedSources.push(...leftBucket.slice(sharedCount));
    }

    for (let index = 0; index < sharedCount; index += 1) {
      const leftSource = leftBucket[index]!;
      const rightSource = rightBucket[index]!;
      const leftIndex = leftSources.findIndex((entry) => entry === leftSource);
      const rightIndex = rightSources.findIndex((entry) => entry === rightSource);
      if (leftIndex !== rightIndex) {
        reorderedSources.push({ source: rightSource, leftIndex, rightIndex });
      }
    }
  }

  return InstructionPreviewDiffResponseSchema.parse({
    leftContext: left.context,
    rightContext: right.context,
    leftBundleHash: left.bundle.bundleHash,
    rightBundleHash: right.bundle.bundleHash,
    compiledTextChanged: left.bundle.compiledText !== right.bundle.compiledText,
    addedSources,
    removedSources,
    reorderedSources,
  });
}

export function resolveInstructionBundleForTask(
  databases: RuntimeDatabases,
  workspaceRegistry: WorkspaceRegistry,
  playbookService: PlaybookService,
  task: {
    workspaceId: string;
    projectId: string | null;
    profileId: string | null;
    identityId: string | null;
    prompt: string;
    cwd?: string | null;
  },
): ResolvedInstructionRunBundle {
  const resolved = buildInstructionBundleForContext(databases, workspaceRegistry, playbookService, {
    workspaceId: task.workspaceId,
    ...(task.projectId ? { projectId: task.projectId } : {}),
    ...(task.profileId ? { profileId: task.profileId } : {}),
    ...(task.identityId ? { identity: task.identityId } : {}),
    ...(task.cwd ? { cwd: task.cwd } : {}),
    taskBrief: task.prompt,
  });
  return {
    bundle: resolved.bundle,
    resolvedPlaybooks: resolved.resolvedPlaybooks,
  };
}
