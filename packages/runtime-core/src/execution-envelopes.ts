import { resolve } from 'node:path';

import type {
  AgentProfileRecord,
  ContextReleasePolicy,
  ExecutionEnvelope,
  ProfileContextReleasePolicy,
  TaskRecord,
} from '@popeye/contracts';
import { ExecutionEnvelopeSchema } from '@popeye/contracts';
import { PROJECT_LAYOUT, WORKSPACE_CRITICAL_FILES, WORKSPACE_LAYOUT } from '@popeye/workspace';

const PROFILE_RELEASE_ORDER: ProfileContextReleasePolicy[] = ['none', 'summary_only', 'excerpt', 'full'];
const DOMAIN_RELEASE_ORDER: ContextReleasePolicy[] = ['none', 'summary', 'excerpt', 'full'];

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0))).sort();
}

function normalizeProfileReleaseLimit(policy: ProfileContextReleasePolicy): ContextReleasePolicy {
  if (policy === 'summary_only') {
    return 'summary';
  }
  return policy;
}

export function computeEffectiveContextReleaseLevel(
  profileLimit: ProfileContextReleasePolicy,
  requestedLevel: ContextReleasePolicy,
): ContextReleasePolicy {
  const normalizedProfileLimit = normalizeProfileReleaseLimit(profileLimit);
  const profileRank = DOMAIN_RELEASE_ORDER.indexOf(normalizedProfileLimit);
  const requestedRank = DOMAIN_RELEASE_ORDER.indexOf(requestedLevel);
  return DOMAIN_RELEASE_ORDER[Math.min(profileRank, requestedRank)] ?? 'none';
}

export function isRequestedContextReleaseAllowed(
  profileLimit: ProfileContextReleasePolicy,
  requestedLevel: ContextReleasePolicy,
): boolean {
  const normalizedProfileLimit = normalizeProfileReleaseLimit(profileLimit);
  return DOMAIN_RELEASE_ORDER.indexOf(requestedLevel) <= DOMAIN_RELEASE_ORDER.indexOf(normalizedProfileLimit);
}

export function validateProfileTaskContext(profile: AgentProfileRecord, task: Pick<TaskRecord, 'workspaceId' | 'projectId'>): string | null {
  const requiresProject =
    profile.filesystemPolicyClass === 'project'
    || profile.memoryScope === 'project'
    || profile.recallScope === 'project';
  if (requiresProject && !task.projectId) {
    return `Profile ${profile.id} requires a project context`;
  }
  return null;
}

export function buildExecutionEnvelope(input: {
  runId: string;
  task: TaskRecord;
  profile: AgentProfileRecord;
  engineKind: string;
  allowedRuntimeTools: string[];
  allowedCapabilityIds: string[];
  workspaceRootPath?: string | null;
  projectPath?: string | null;
  sessionPolicy: ExecutionEnvelope['provenance']['sessionPolicy'];
  warnings?: string[];
  scratchRoot: string;
}): ExecutionEnvelope {
  const workspaceRoot = input.workspaceRootPath ? resolve(input.workspaceRootPath) : null;
  const projectRoot = input.projectPath ? resolve(input.projectPath) : null;

  const baseReadRoots = uniqueSorted([
    ...(workspaceRoot ? [workspaceRoot] : []),
    ...(projectRoot ? [projectRoot] : []),
  ]);

  let readRoots: string[] = [];
  let writeRoots: string[] = [];
  let cwd: string | null = null;

  switch (input.profile.filesystemPolicyClass) {
    case 'workspace':
      readRoots = baseReadRoots;
      writeRoots = baseReadRoots;
      cwd = projectRoot ?? workspaceRoot ?? null;
      break;
    case 'project':
      readRoots = uniqueSorted(projectRoot ? [projectRoot] : []);
      writeRoots = uniqueSorted(projectRoot ? [projectRoot] : []);
      cwd = projectRoot ?? null;
      break;
    case 'read_only_workspace':
      readRoots = baseReadRoots;
      writeRoots = [];
      cwd = projectRoot ?? workspaceRoot ?? null;
      break;
    case 'memory_only':
      readRoots = [];
      writeRoots = [];
      cwd = null;
      break;
  }

  const protectedPaths = uniqueSorted([
    ...(workspaceRoot
      ? [
          ...WORKSPACE_CRITICAL_FILES.map((fileName) => resolve(workspaceRoot, fileName)),
          resolve(workspaceRoot, WORKSPACE_LAYOUT.contextDir),
          resolve(workspaceRoot, WORKSPACE_LAYOUT.playbooksDir),
          resolve(workspaceRoot, WORKSPACE_LAYOUT.memory),
          resolve(workspaceRoot, WORKSPACE_LAYOUT.dailyDir),
        ]
      : []),
    ...(projectRoot
      ? [
          resolve(projectRoot, PROJECT_LAYOUT.instructions),
          resolve(projectRoot, PROJECT_LAYOUT.playbooksDir),
          resolve(projectRoot, PROJECT_LAYOUT.knowledgeDir),
        ]
      : []),
  ]);

  return ExecutionEnvelopeSchema.parse({
    runId: input.runId,
    taskId: input.task.id,
    profileId: input.profile.id,
    workspaceId: input.task.workspaceId,
    projectId: input.task.projectId,
    mode: input.profile.mode,
    modelPolicy: input.profile.modelPolicy,
    allowedRuntimeTools: uniqueSorted(input.allowedRuntimeTools),
    allowedCapabilityIds: uniqueSorted(input.allowedCapabilityIds),
    memoryScope: input.profile.memoryScope,
    recallScope: input.profile.recallScope,
    filesystemPolicyClass: input.profile.filesystemPolicyClass,
    contextReleasePolicy: input.profile.contextReleasePolicy,
    readRoots,
    writeRoots,
    protectedPaths,
    scratchRoot: resolve(input.scratchRoot),
    cwd,
    provenance: {
      derivedAt: new Date().toISOString(),
      engineKind: input.engineKind,
      sessionPolicy: input.sessionPolicy,
      identityId: input.task.identityId,
      warnings: input.warnings ?? [],
    },
  });
}

export function resolveAgentMemoryScopeFilter(envelope: ExecutionEnvelope): {
  workspaceId: string | null;
  projectId: string | null;
  includeGlobal: boolean;
} {
  switch (envelope.recallScope) {
    case 'global':
      return {
        workspaceId: envelope.workspaceId,
        projectId: null,
        includeGlobal: true,
      };
    case 'project':
      return {
        workspaceId: envelope.workspaceId,
        projectId: envelope.projectId,
        includeGlobal: false,
      };
    case 'workspace':
    default:
      return {
        workspaceId: envelope.workspaceId,
        projectId: null,
        includeGlobal: false,
      };
  }
}

export function canAccessMemoryLocation(
  envelope: ExecutionEnvelope,
  location: { workspaceId: string | null; projectId: string | null },
): boolean {
  if (envelope.recallScope === 'global') {
    return location.workspaceId === null || location.workspaceId === envelope.workspaceId;
  }
  if (envelope.recallScope === 'project') {
    return (
      location.workspaceId === envelope.workspaceId
      && (location.projectId === null || location.projectId === envelope.projectId)
    );
  }
  return location.workspaceId === envelope.workspaceId;
}

export function canAccessPlaybookLocation(
  envelope: ExecutionEnvelope,
  location: { scope: 'global' | 'workspace' | 'project'; workspaceId: string | null; projectId: string | null },
): boolean {
  if (location.scope === 'global') {
    return true;
  }
  if (location.workspaceId !== envelope.workspaceId) {
    return false;
  }
  if (location.scope === 'workspace') {
    return true;
  }
  return location.projectId === envelope.projectId;
}

export function isPathAllowedByEnvelope(path: string, allowedRoots: string[]): boolean {
  const resolvedPath = resolve(path);
  return allowedRoots.some((root) => {
    const resolvedRoot = resolve(root);
    return resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}/`);
  });
}

export function isProtectedPath(path: string, protectedPaths: string[]): boolean {
  const resolvedPath = resolve(path);
  return protectedPaths.some((protectedPath) => {
    const resolvedProtectedPath = resolve(protectedPath);
    return resolvedPath === resolvedProtectedPath || resolvedPath.startsWith(`${resolvedProtectedPath}/`);
  });
}

export function shouldInheritRuntimeToolAllowlist(profile: AgentProfileRecord): boolean {
  return profile.allowedRuntimeTools.length === 0;
}

export function shouldInheritCapabilityAllowlist(profile: AgentProfileRecord): boolean {
  return profile.allowedCapabilityIds.length === 0;
}

export function isProfileContextReleaseKnown(policy: string): policy is ProfileContextReleasePolicy {
  return PROFILE_RELEASE_ORDER.includes(policy as ProfileContextReleasePolicy);
}
