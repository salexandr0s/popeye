import { isAbsolute, relative, resolve } from 'node:path';
import { realpathSync } from 'node:fs';

import type {
  AppConfig,
  ConnectionRecord,
  ConnectionResourceRule,
  ConnectionSyncSummary,
  DomainKind,
  ExecutionEnvelope,
  JobRecord,
  ReceiptRecord,
  ReceiptTimelineEvent,
  RunEventRecord,
  RunRecord,
  TaskRecord,
  TelegramDeliveryState,
} from '@popeye/contracts';
import {
  ConnectionHealthSummarySchema,
  ConnectionResourceRuleSchema,
  ConnectionSyncSummarySchema,
  nowIso,
  RunEventRecordSchema,
  RunRecordSchema,
  TelegramDeliveryStateSchema,
} from '@popeye/contracts';
import type { EngineFailureClassification } from '@popeye/engine-pi';
import type { selectSessionRoot } from '@popeye/sessions';
import { z } from 'zod';

import type { OAuthTokenPayload } from './provider-oauth.js';

// ---------------------------------------------------------------------------
// Zod row-parsing schemas
// ---------------------------------------------------------------------------

export const ProjectPathRowSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  path: z.string(),
});

export const WorkspacePathRowSchema = z.object({
  id: z.string(),
  root_path: z.string(),
});

export const RunRowSchema = z.object({
  id: z.string(),
  job_id: z.string(),
  task_id: z.string(),
  workspace_id: z.string(),
  profile_id: z.string().nullable().default('default'),
  identity_id: z.string().nullable().default('default'),
  session_root_id: z.string(),
  engine_session_ref: z.string().nullable(),
  state: z.string(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  error: z.string().nullable(),
  iterations_used: z.number().int().nonnegative().nullable().default(null),
  parent_run_id: z.string().nullable().default(null),
  delegation_depth: z.number().int().nonnegative().default(0),
});

export const RunEventRowSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  type: z.string(),
  payload: z.string(),
  created_at: z.string(),
});

export const ExecutionEnvelopeRowSchema = z.object({
  run_id: z.string(),
  task_id: z.string(),
  profile_id: z.string(),
  workspace_id: z.string(),
  project_id: z.string().nullable(),
  mode: z.string(),
  model_policy: z.string(),
  allowed_runtime_tools_json: z.string(),
  allowed_capability_ids_json: z.string(),
  memory_scope: z.string(),
  recall_scope: z.string(),
  filesystem_policy_class: z.string(),
  context_release_policy: z.string(),
  read_roots_json: z.string(),
  write_roots_json: z.string(),
  protected_paths_json: z.string(),
  scratch_root: z.string(),
  cwd: z.string().nullable(),
  provenance_json: z.string(),
  created_at: z.string(),
});

export const MemoryListRowSchema = z.object({
  id: z.string(),
  description: z.string(),
  classification: z.enum(['secret', 'sensitive', 'internal', 'embeddable']),
  source_type: z.enum(['receipt', 'telegram', 'daily_summary', 'curated_memory', 'workspace_doc', 'compaction_flush', 'capability_sync', 'context_release', 'file_doc', 'coding_session', 'code_review', 'debug_session']),
  content: z.string(),
  confidence: z.number(),
  scope: z.string(),
  workspace_id: z.string().nullable().default(null),
  project_id: z.string().nullable().default(null),
  memory_type: z.enum(['episodic', 'semantic', 'procedural']).nullable(),
  dedup_key: z.string().nullable(),
  last_reinforced_at: z.string().nullable(),
  archived_at: z.string().nullable(),
  created_at: z.string(),
  source_run_id: z.string().nullable(),
  source_timestamp: z.string().nullable(),
});

export const IdRowSchema = z.object({
  id: z.string(),
});

export const JobIdRowSchema = z.object({
  job_id: z.string(),
});

export const CountRowSchema = z.object({
  count: z.coerce.number().int().nonnegative(),
});

export const CreatedAtRowSchema = z.object({
  created_at: z.string(),
});

export const ScheduleRowSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  interval_seconds: z.coerce.number().nonnegative(),
  created_at: z.string(),
});

export const TelegramRelayCheckpointRowSchema = z.object({
  relay_key: z.literal('telegram_long_poll'),
  workspace_id: z.string(),
  last_acknowledged_update_id: z.coerce.number().int().nonnegative(),
  updated_at: z.string(),
});

export const TelegramReplyDeliveryRowSchema = z.object({
  chat_id: z.string(),
  telegram_message_id: z.coerce.number().int(),
  status: z.enum(['pending', 'sending', 'sent', 'uncertain', 'abandoned']),
  sent_telegram_message_id: z.coerce.number().int().nullable().optional(),
  sent_at: z.string().nullable().optional(),
  run_id: z.string().nullable().optional(),
});

export const TelegramReplyDeliveryFullRowSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  chat_id: z.string(),
  telegram_message_id: z.coerce.number().int(),
  message_ingress_id: z.string(),
  task_id: z.string().nullable(),
  job_id: z.string().nullable(),
  run_id: z.string().nullable(),
  status: z.enum(['pending', 'sending', 'sent', 'uncertain', 'abandoned']),
  sent_at: z.string().nullable(),
  sent_telegram_message_id: z.coerce.number().int().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const TelegramDeliveryResolutionRowSchema = z.object({
  id: z.string(),
  delivery_id: z.string(),
  workspace_id: z.string(),
  action: z.enum(['confirm_sent', 'resend', 'abandon']),
  intervention_id: z.string().nullable(),
  operator_note: z.string().nullable(),
  sent_telegram_message_id: z.coerce.number().int().nullable().optional(),
  previous_status: z.string(),
  new_status: z.string(),
  created_at: z.string(),
});

export const TelegramSendAttemptRowSchema = z.object({
  id: z.string(),
  delivery_id: z.string(),
  workspace_id: z.string(),
  attempt_number: z.coerce.number().int(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  run_id: z.string().nullable(),
  content_hash: z.string(),
  outcome: z.enum(['sent', 'retryable_failure', 'permanent_failure', 'ambiguous']),
  sent_telegram_message_id: z.coerce.number().int().nullable().optional(),
  error_summary: z.string().nullable(),
  source: z.string(),
  created_at: z.string(),
});

export const RuntimeMemorySearchToolInputSchema = z.object({
  query: z.string().min(1),
  scope: z.string().optional(),
  limit: z.number().int().positive().max(10).optional(),
  includeContent: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// StoredOAuthSecret interface (used by OAuth helper functions)
// ---------------------------------------------------------------------------

export interface StoredOAuthSecret {
  accessToken: string;
  refreshToken?: string | undefined;
  tokenType?: string | undefined;
  scopes: string[];
  expiresAt?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ALLOWED_CONNECTION_PROVIDERS: Record<DomainKind, Array<ConnectionRecord['providerKind']>> = {
  general: ['local'],
  email: ['gmail', 'proton'],
  calendar: ['google_calendar'],
  todos: ['google_tasks', 'local'],
  github: ['github'],
  files: ['local_fs', 'local'],
  people: ['local'],
  finance: ['local'],
  medical: ['local'],
  coding: ['local'],
};

export const SECRET_REQUIRED_CONNECTION_PROVIDERS = new Set<ConnectionRecord['providerKind']>([
  'gmail',
  'google_calendar',
  'google_tasks',
  'github',
  'proton',
]);

// ---------------------------------------------------------------------------
// Row-mapper functions
// ---------------------------------------------------------------------------

export function mapRunRow(row: unknown): RunRecord {
  const parsed = RunRowSchema.parse(row);
  return RunRecordSchema.parse({
    id: parsed.id,
    jobId: parsed.job_id,
    taskId: parsed.task_id,
    workspaceId: parsed.workspace_id,
    profileId: parsed.profile_id ?? 'default',
    identityId: parsed.identity_id ?? 'default',
    sessionRootId: parsed.session_root_id,
    engineSessionRef: parsed.engine_session_ref,
    state: parsed.state,
    startedAt: parsed.started_at,
    finishedAt: parsed.finished_at,
    error: parsed.error,
    iterationsUsed: parsed.iterations_used,
    parentRunId: parsed.parent_run_id,
    delegationDepth: parsed.delegation_depth,
  });
}

export function mapRunEventRow(row: unknown): RunEventRecord {
  const parsed = RunEventRowSchema.parse(row);
  return RunEventRecordSchema.parse({
    id: parsed.id,
    runId: parsed.run_id,
    type: parsed.type,
    payload: parsed.payload,
    createdAt: parsed.created_at,
  });
}

export function mapExecutionEnvelopeRow(row: unknown): ExecutionEnvelope {
  const parsed = ExecutionEnvelopeRowSchema.parse(row);
  return {
    runId: parsed.run_id,
    taskId: parsed.task_id,
    profileId: parsed.profile_id,
    workspaceId: parsed.workspace_id,
    projectId: parsed.project_id,
    mode: parsed.mode as ExecutionEnvelope['mode'],
    modelPolicy: parsed.model_policy,
    allowedRuntimeTools: JSON.parse(parsed.allowed_runtime_tools_json) as string[],
    allowedCapabilityIds: JSON.parse(parsed.allowed_capability_ids_json) as string[],
    memoryScope: parsed.memory_scope as ExecutionEnvelope['memoryScope'],
    recallScope: parsed.recall_scope as ExecutionEnvelope['recallScope'],
    filesystemPolicyClass: parsed.filesystem_policy_class as ExecutionEnvelope['filesystemPolicyClass'],
    contextReleasePolicy: parsed.context_release_policy as ExecutionEnvelope['contextReleasePolicy'],
    readRoots: JSON.parse(parsed.read_roots_json) as string[],
    writeRoots: JSON.parse(parsed.write_roots_json) as string[],
    protectedPaths: JSON.parse(parsed.protected_paths_json) as string[],
    scratchRoot: parsed.scratch_root,
    cwd: parsed.cwd,
    provenance: JSON.parse(parsed.provenance_json) as ExecutionEnvelope['provenance'],
  };
}

export function mapTelegramDeliveryRow(row: unknown): TelegramDeliveryState {
  const parsed = TelegramReplyDeliveryRowSchema.parse(row);
  return TelegramDeliveryStateSchema.parse({
    chatId: parsed.chat_id,
    telegramMessageId: parsed.telegram_message_id,
    status: parsed.status,
  });
}

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

export function parseCountRow(row: unknown): number {
  return CountRowSchema.parse(row).count;
}

export function parseCreatedAt(row: unknown): string | null {
  const parsed = CreatedAtRowSchema.safeParse(row);
  return parsed.success ? parsed.data.created_at : null;
}

export function isTerminalJobStatus(status: JobRecord['status']): boolean {
  return ['succeeded', 'failed_final', 'cancelled'].includes(status);
}

export function isTerminalRunState(state: RunRecord['state']): boolean {
  return ['succeeded', 'failed_retryable', 'failed_final', 'cancelled', 'abandoned'].includes(state);
}

export function classifyFailureFromMessage(message: string): EngineFailureClassification {
  const lowered = message.toLowerCase();
  if (lowered.includes('protocol')) return 'protocol_error';
  if (lowered.includes('cancel')) return 'cancelled';
  if (lowered.includes('timeout') || lowered.includes('temporary') || lowered.includes('transient')) return 'transient_failure';
  if (lowered.includes('startup') || lowered.includes('spawn') || lowered.includes('not configured')) return 'startup_failure';
  return 'permanent_failure';
}

export function selectSessionKind(source: TaskRecord['source']): Parameters<typeof selectSessionRoot>[0]['kind'] {
  if (source === 'telegram') return 'telegram_user';
  if (source === 'heartbeat') return 'system_heartbeat';
  if (source === 'schedule') return 'scheduled_task';
  return 'interactive_main';
}

export function providerRequiresSecret(providerKind: ConnectionRecord['providerKind']): boolean {
  return SECRET_REQUIRED_CONNECTION_PROVIDERS.has(providerKind);
}

export function isProviderAllowedForDomain(domain: DomainKind, providerKind: ConnectionRecord['providerKind']): boolean {
  return (ALLOWED_CONNECTION_PROVIDERS[domain] ?? []).includes(providerKind);
}

export function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  const rel = relative(rootPath, candidatePath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function canonicalizeLocalPath(inputPath: string): string {
  try {
    return realpathSync(inputPath);
  } catch {
    return resolve(inputPath);
  }
}

export function buildReceiptFallbackReplyText(receipt: ReceiptRecord): string {
  const parts = [
    receipt.summary,
    `Status: ${receipt.status}`,
    `Model: ${receipt.usage.provider}/${receipt.usage.model}`,
    `Tokens: ${receipt.usage.tokensIn}/${receipt.usage.tokensOut}`,
    `Cost: $${receipt.usage.estimatedCostUsd.toFixed(4)}`,
  ];
  if (receipt.status !== 'succeeded' && receipt.details.trim().length > 0) {
    parts.push(`Details: ${receipt.details}`);
  }
  return parts.join('\n');
}

export function stringifyTimelineMetadata(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function buildTimelineMetadata(details: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(details)
      .map(([key, value]) => [key, stringifyTimelineMetadata(value)] as const)
      .filter(([, value]) => value.length > 0),
  );
}

export function parseRunEventPayload(payload: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function mapRunEventTitle(type: RunEventRecord['type']): string {
  switch (type) {
    case 'started':
      return 'Engine run started';
    case 'session':
      return 'Engine session assigned';
    case 'message':
      return 'Assistant message emitted';
    case 'tool_call':
      return 'Tool call requested';
    case 'tool_result':
      return 'Tool result received';
    case 'completed':
      return 'Engine run completed';
    case 'failed':
      return 'Engine run failed';
    case 'usage':
      return 'Usage reported';
    case 'compaction':
      return 'Compaction captured';
    case 'budget_warning':
      return 'Iteration budget warning';
    case 'budget_exhausted':
      return 'Iteration budget exhausted';
    default:
      return titleCase(type);
  }
}

export function mapRunEventDetail(record: RunEventRecord): string {
  const payload = parseRunEventPayload(record.payload);
  switch (record.type) {
    case 'started':
      return typeof payload.input === 'string' ? `Prompt: ${payload.input}` : '';
    case 'session':
      return typeof payload.sessionRef === 'string' ? `Session ref: ${payload.sessionRef}` : '';
    case 'completed':
      return typeof payload.output === 'string' ? payload.output : '';
    case 'failed':
      return typeof payload.error === 'string' ? payload.error : '';
    case 'usage': {
      const provider = typeof payload.provider === 'string' ? payload.provider : 'unknown';
      const model = typeof payload.model === 'string' ? payload.model : 'unknown';
      const tokensIn = typeof payload.tokensIn === 'number' ? payload.tokensIn : 0;
      const tokensOut = typeof payload.tokensOut === 'number' ? payload.tokensOut : 0;
      return `${provider}/${model} · ${tokensIn}/${tokensOut} tokens`;
    }
    case 'tool_call':
      return typeof payload.toolName === 'string' ? `Tool: ${payload.toolName}` : '';
    case 'tool_result':
      return typeof payload.toolName === 'string' ? `Tool: ${payload.toolName}` : '';
    case 'compaction': {
      const contentLen = typeof payload.content === 'string' ? payload.content.length : 0;
      const tokensBefore = typeof payload.tokensBefore === 'number' ? payload.tokensBefore : null;
      const tokensAfter = typeof payload.tokensAfter === 'number' ? payload.tokensAfter : null;
      if (tokensBefore !== null && tokensAfter !== null) {
        return `Context compacted: ${tokensBefore} \u2192 ${tokensAfter} tokens (${contentLen} chars captured)`;
      }
      return contentLen > 0 ? `Compaction flush captured (${contentLen} chars)` : '';
    }
    case 'budget_warning':
    case 'budget_exhausted': {
      const used = typeof payload.iterationsUsed === 'number' ? payload.iterationsUsed : '?';
      const max = typeof payload.maxIterations === 'number' ? payload.maxIterations : '?';
      return `${used}/${max} iterations`;
    }
    default:
      return '';
  }
}

export function mapSecurityAuditKind(code: string): ReceiptTimelineEvent['kind'] {
  if (code.startsWith('approval_')) return 'approval';
  if (code.startsWith('context_')) return 'context_release';
  if (code.includes('warning')) return 'warning';
  return 'policy';
}

export function parseStringArrayColumn(value: unknown): string[] {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function parseJsonArrayColumn<T>(value: unknown, schema: z.ZodType<T[]>): T[] {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return schema.parse([]);
  }
  try {
    return schema.parse(JSON.parse(value));
  } catch {
    return schema.parse([]);
  }
}

export function matchesConnectionResourceId(left: string, right: string): boolean {
  return left === right || left.toLowerCase() === right.toLowerCase();
}

export function buildLegacyConnectionResourceRules(
  resourceIds: string[],
  timestamp: string,
): ConnectionResourceRule[] {
  return resourceIds.map((resourceId) => ({
    resourceType: 'resource',
    resourceId,
    displayName: resourceId,
    writeAllowed: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
}

export function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0]!.toLowerCase() : null;
}

export function mapConnectionRow(row: Record<string, unknown>): ConnectionRecord {
  const allowedResources = parseStringArrayColumn(row['allowed_resources']);
  const resourceRules = parseJsonArrayColumn(row['resource_rules_json'], z.array(ConnectionResourceRuleSchema));
  const timestamp = (row['updated_at'] as string) ?? (row['created_at'] as string) ?? nowIso();
  return {
    id: row['id'] as string,
    domain: row['domain'] as ConnectionRecord['domain'],
    providerKind: row['provider_kind'] as ConnectionRecord['providerKind'],
    label: row['label'] as string,
    mode: (row['mode'] as ConnectionRecord['mode']) ?? 'read_only',
    secretRefId: (row['secret_ref_id'] as string) ?? null,
    enabled: !!(row['enabled'] as number),
    syncIntervalSeconds: (row['sync_interval_seconds'] as number) ?? 900,
    allowedScopes: parseStringArrayColumn(row['allowed_scopes']),
    allowedResources,
    resourceRules: (resourceRules.length > 0 ? resourceRules : buildLegacyConnectionResourceRules(allowedResources, timestamp)).map((r) => ({ ...r, writeAllowed: r.writeAllowed ?? false })),
    lastSyncAt: (row['last_sync_at'] as string) ?? null,
    lastSyncStatus: (row['last_sync_status'] as ConnectionRecord['lastSyncStatus']) ?? null,
    policy: undefined as unknown as ConnectionRecord['policy'],
    health: (parseJsonColumn(row['health_json'], ConnectionHealthSummarySchema) ?? { status: 'unknown', diagnostics: [], authState: 'unknown', checkedAt: null, lastError: null, remediation: null }) as ConnectionRecord['health'],
    sync: (parseJsonColumn(row['sync_json'], ConnectionSyncSummarySchema) ?? { status: 'idle', lastAttemptAt: null, lastSuccessAt: null, cursorKind: 'none', cursorPresent: false, lagSummary: '' }) as ConnectionRecord['sync'],
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}

export function parseJsonColumn<T>(value: unknown, schema: z.ZodType<T>): T {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return schema.parse({});
  }
  try {
    return schema.parse(JSON.parse(value));
  } catch {
    return schema.parse({});
  }
}

export function parseStoredOAuthSecret(value: string | null | undefined): StoredOAuthSecret | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (typeof parsed['accessToken'] !== 'string' || !Array.isArray(parsed['scopes'])) {
      return null;
    }
    return {
      accessToken: parsed['accessToken'],
      refreshToken: typeof parsed['refreshToken'] === 'string' ? parsed['refreshToken'] : undefined,
      tokenType: typeof parsed['tokenType'] === 'string' ? parsed['tokenType'] : undefined,
      scopes: parsed['scopes'].filter((scope): scope is string => typeof scope === 'string'),
      expiresAt: typeof parsed['expiresAt'] === 'string' ? parsed['expiresAt'] : undefined,
      createdAt: typeof parsed['createdAt'] === 'string' ? parsed['createdAt'] : nowIso(),
      updatedAt: typeof parsed['updatedAt'] === 'string' ? parsed['updatedAt'] : nowIso(),
    };
  } catch {
    return null;
  }
}

export function serializeStoredOAuthSecret(input: OAuthTokenPayload): string {
  return JSON.stringify({
    accessToken: input.accessToken,
    ...(input.refreshToken ? { refreshToken: input.refreshToken } : {}),
    ...(input.tokenType ? { tokenType: input.tokenType } : {}),
    scopes: input.scopes,
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  } satisfies StoredOAuthSecret);
}

export function canRefreshStoredOAuthSecret(
  providerKind: ConnectionRecord['providerKind'],
  secret: StoredOAuthSecret | null,
  config: AppConfig,
): boolean {
  if (!secret?.refreshToken) return false;
  switch (providerKind) {
    case 'gmail':
    case 'google_calendar':
    case 'google_tasks':
      return Boolean(config.providerAuth.google.clientId && config.providerAuth.google.clientSecret);
    default:
      return false;
  }
}

export function connectionCursorKindForProvider(providerKind: ConnectionRecord['providerKind']): ConnectionSyncSummary['cursorKind'] {
  switch (providerKind) {
    case 'gmail':
      return 'history_id';
    case 'google_calendar':
      return 'sync_token';
    case 'google_tasks':
    case 'github':
      return 'since';
    default:
      return 'none';
  }
}

export function isExpiredIso(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.length > 0 && Date.parse(value) <= Date.now();
}
