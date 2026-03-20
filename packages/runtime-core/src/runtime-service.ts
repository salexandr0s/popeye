import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';

import type {
  ActionApprovalRequestInput,
  AgentProfileRecord,
  AppConfig,
  ApprovalRecord,
  ApprovalResolveInput,
  CompiledInstructionBundle,
  ConnectionCreateInput,
  ConnectionDiagnosticsResponse,
  ConnectionHealthSummary,
  ConnectionRecord,
  ConnectionRemediationAction,
  ConnectionResourceRule,
  ConnectionSyncSummary,
  ConnectionUpdateInput,
  ContextReleaseDecision,
  ContextReleasePreview,
  DaemonStateRecord,
  DaemonStatusResponse,
  DomainKind,
  EngineCapabilities,
  ExecutionEnvelope,
  IntegrityReport,
  InterventionRecord,
  JobLeaseRecord,
  JobRecord,
  MemoryAuditResponse,
  MemoryRecord,
  MemorySearchQuery,
  MemorySearchResponse,
  MemoryType,
  MessageIngressResponse,
  MessageRecord,
  NormalizedEngineEvent,
  ProjectRecord,
  ProjectRegistrationInput,
  ReceiptRecord,
  ReceiptTimelineEvent,
  RunEventRecord,
  RunReply,
  RunRecord,
  SchedulerStatusResponse,
  SecretRefRecord,
  SecurityAuditEvent,
  SecurityPolicyResponse,
  TaskCreateInput,
  TaskRecord,
  TelegramDeliveryState,
  TelegramDeliveryRecord,
  TelegramDeliveryResolutionRecord,
  TelegramDeliveryResolutionRequest,
  TelegramRelayCheckpoint,
  TelegramRelayCheckpointCommitRequest,
  TelegramSendAttemptRecord,
  UsageSummary,
  VaultRecord,
  WorkspaceRecord,
  WorkspaceRegistrationInput,
  OAuthConnectStartRequest,
  OAuthSessionRecord,
} from '@popeye/contracts';
import type {
  CapabilityContext,
  CapabilityModule,
  CapabilityDescriptor,
  FileRootRecord,
  FileRootRegistrationInput,
  FileRootUpdateInput,
  FileDocumentRecord,
  FileSearchQuery,
  FileSearchResponse,
  FileIndexResult,
  FileWriteIntentCreateInput,
  FileWriteIntentRecord,
  FileWriteIntentReviewInput,
  EmailAccountRecord,
  EmailThreadRecord,
  EmailMessageRecord,
  EmailDigestRecord,
  EmailSearchQuery,
  EmailSearchResult,
  EmailAccountRegistrationInput,
  EmailDraftCreateInput,
  EmailDraftRecord,
  EmailDraftUpdateInput,
  EmailSyncResult,
  GithubAccountRecord,
  GithubCommentCreateInput,
  GithubCommentRecord,
  GithubRepoRecord,
  GithubPullRequestRecord,
  GithubIssueRecord,
  GithubNotificationMarkReadInput,
  GithubNotificationRecord,
  GithubDigestRecord,
  GithubSearchQuery,
  GithubSearchResult,
  GithubSyncResult,
  CalendarAccountRecord,
  CalendarEventCreateInput,
  CalendarEventRecord,
  CalendarDigestRecord,
  CalendarSearchQuery,
  CalendarSearchResult,
  CalendarAccountRegistrationInput,
  CalendarEventUpdateInput,
  CalendarSyncResult,
  CalendarAvailabilitySlot,
  TodoAccountRecord,
  TodoAccountRegistrationInput,
  TodoItemRecord,
  TodoDigestRecord,
  TodoSearchQuery,
  TodoSearchResult,
  TodoProjectRecord,
  TodoReconcileResult,
  TodoSyncResult,
  TodoCreateInput,
  TodoistConnectInput,
  TodoistConnectResult,
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
} from '@popeye/contracts';
import {
  buildCanonicalRunReply,
  ConnectionHealthSummarySchema,
  ConnectionResourceRuleSchema,
  ConnectionSyncSummarySchema,
  MemoryRecordSchema,
  RunEventRecordSchema,
  RunRecordSchema,
  RunReplySchema,
  TaskCreateInputSchema,
  TelegramDeliveryRecordSchema,
  TelegramDeliveryResolutionRecordSchema,
  TelegramDeliveryStateSchema,
  TelegramRelayCheckpointSchema,
  TelegramSendAttemptRecordSchema,
} from '@popeye/contracts';
import {
  createEngineAdapter,
  type EngineAdapter,
  type EngineFailureClassification,
  type EngineRunCompletion,
  type EngineRunHandle,
  type EngineRunRequest,
  type RuntimeToolDescriptor,
} from '@popeye/engine-pi';
import {
  buildLocationCondition,
  formatMemoryScope,
  MemorySearchService,
  resolveMemoryLocationFilter,
  createDisabledEmbeddingClient,
  createOpenAIEmbeddingClient,
  createOpenAISummarizationClient,
  createDisabledSummarizationClient,
  loadSqliteVec,
} from '@popeye/memory';
import { createLogger, redactText, type PopeyeLogger } from '@popeye/observability';
import { calculateRetryDelaySeconds, TaskManager } from '@popeye/scheduler';
import { selectSessionRoot, SessionService } from '@popeye/sessions';

import { ReceiptManager } from '@popeye/receipts';

import { WorkspaceRegistry } from '@popeye/workspace';

import { openRuntimeDatabases, type RuntimeDatabases } from './database.js';
import { MemoryLifecycleService, type MemoryInsertInput } from './memory-lifecycle.js';
import { MessageIngestionService, MessageIngressError } from './message-ingestion.js';
import { QueryService } from './query-service.js';
import { SecretStore } from './secret-store.js';
import { OAuthSessionService } from './oauth-session-service.js';
import { ApprovalService } from './approval-service.js';
import { ActionPolicyEvaluator } from './action-policy-evaluator.js';
import { type VaultHandle, VaultManager } from './vault-manager.js';
import { ContextReleaseService } from './context-release-service.js';
import { CapabilityRegistry } from './capability-registry.js';
import { createFilesCapability, FileRootService, FileIndexer, FileSearchService } from '@popeye/cap-files';
import { createEmailCapability, EmailService, EmailSearchService, EmailSyncService, EmailDigestService, createAdapter, GmailAdapter, type EmailProviderAdapter } from '@popeye/cap-email';
import { createGithubCapability, GithubService, GithubSearchService, GithubSyncService, GithubDigestService, GithubApiAdapter } from '@popeye/cap-github';
import { createCalendarCapability, CalendarService, CalendarSearchService, CalendarSyncService, CalendarDigestService, GoogleCalendarAdapter } from '@popeye/cap-calendar';
import { createTodosCapability, TodoService, TodoSearchService, TodoSyncService, TodoDigestService, LocalTodoAdapter, TodoistAdapter } from '@popeye/cap-todos';
import { createPeopleCapability, PeopleService, type PersonProjectionSeed } from '@popeye/cap-people';
import BetterSqlite3 from 'better-sqlite3';
import {
  clearBrowserSessions,
  createBrowserSession as createRuntimeBrowserSession,
  type BrowserSessionValidationResult,
  validateBrowserSession as validateRuntimeBrowserSession,
} from './browser-sessions.js';
import {
  buildExecutionEnvelope,
  computeEffectiveContextReleaseLevel,
  resolveAgentMemoryScopeFilter,
  validateProfileTaskContext,
} from './execution-envelopes.js';
import {
  buildPkceChallenge,
  buildPkceVerifier,
  buildProviderAuthorizationUrl,
  exchangeProviderAuthorizationCode,
  getProviderScopes,
  mapProviderToDomain,
  type OAuthTokenPayload,
} from './provider-oauth.js';

import { nowIso, DOMAIN_POLICY_DEFAULTS } from '@popeye/contracts';
import { z } from 'zod';
import safe from 'safe-regex2';
import { initAuthStore, readAuthStore, readRoleAuthStore, rotateAuthStore } from './auth.js';

function isTerminalJobStatus(status: JobRecord['status']): boolean {
  return ['succeeded', 'failed_final', 'cancelled'].includes(status);
}

function isTerminalRunState(state: RunRecord['state']): boolean {
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

function selectSessionKind(source: TaskRecord['source']): Parameters<typeof selectSessionRoot>[0]['kind'] {
  if (source === 'telegram') return 'telegram_user';
  if (source === 'heartbeat') return 'system_heartbeat';
  if (source === 'schedule') return 'scheduled_task';
  return 'interactive_main';
}

export { MessageIngressError };

export class RuntimeNotFoundError extends Error {
  readonly errorCode = 'not_found';

  constructor(message: string) {
    super(message);
    this.name = 'RuntimeNotFoundError';
  }
}

export class RuntimeConflictError extends Error {
  readonly errorCode = 'conflict';

  constructor(message: string) {
    super(message);
    this.name = 'RuntimeConflictError';
  }
}

export class RuntimeValidationError extends Error {
  readonly errorCode = 'invalid_input';

  constructor(message: string) {
    super(message);
    this.name = 'RuntimeValidationError';
  }
}

export interface RuntimeEvent {
  event: string;
  data: string;
}

interface ActiveRunContext {
  runId: string;
  jobId: string;
  task: TaskRecord;
  workspaceLockId: string;
  handle: EngineRunHandle;
  finalizing: boolean;
}

interface SchedulerInternals {
  running: boolean;
  tickTimer: ReturnType<typeof setInterval> | null;
  leaseTimer: ReturnType<typeof setInterval> | null;
  tickIntervalMs: number;
  leaseRefreshIntervalMs: number;
  leaseTtlMs: number;
  shutdownGraceMs: number;
  lastSchedulerTickAt: string | null;
  lastLeaseSweepAt: string | null;
}

const ProjectPathRowSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  path: z.string(),
});

const WorkspacePathRowSchema = z.object({
  id: z.string(),
  root_path: z.string(),
});

const RunRowSchema = z.object({
  id: z.string(),
  job_id: z.string(),
  task_id: z.string(),
  workspace_id: z.string(),
  profile_id: z.string().nullable().default('default'),
  session_root_id: z.string(),
  engine_session_ref: z.string().nullable(),
  state: z.string(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  error: z.string().nullable(),
});

const RunEventRowSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  type: z.string(),
  payload: z.string(),
  created_at: z.string(),
});

const ExecutionEnvelopeRowSchema = z.object({
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

const MemoryListRowSchema = z.object({
  id: z.string(),
  description: z.string(),
  classification: z.enum(['secret', 'sensitive', 'internal', 'embeddable']),
  source_type: z.enum(['receipt', 'telegram', 'daily_summary', 'curated_memory', 'workspace_doc', 'compaction_flush', 'capability_sync', 'context_release', 'file_doc']),
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

const IdRowSchema = z.object({
  id: z.string(),
});

const JobIdRowSchema = z.object({
  job_id: z.string(),
});

const CountRowSchema = z.object({
  count: z.coerce.number().int().nonnegative(),
});

const CreatedAtRowSchema = z.object({
  created_at: z.string(),
});

const ScheduleRowSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  interval_seconds: z.coerce.number().nonnegative(),
  created_at: z.string(),
});

const TelegramRelayCheckpointRowSchema = z.object({
  relay_key: z.literal('telegram_long_poll'),
  workspace_id: z.string(),
  last_acknowledged_update_id: z.coerce.number().int().nonnegative(),
  updated_at: z.string(),
});

const TelegramReplyDeliveryRowSchema = z.object({
  chat_id: z.string(),
  telegram_message_id: z.coerce.number().int(),
  status: z.enum(['pending', 'sending', 'sent', 'uncertain', 'abandoned']),
  sent_telegram_message_id: z.coerce.number().int().nullable().optional(),
  sent_at: z.string().nullable().optional(),
  run_id: z.string().nullable().optional(),
});

const TelegramReplyDeliveryFullRowSchema = z.object({
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

const TelegramDeliveryResolutionRowSchema = z.object({
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

const TelegramSendAttemptRowSchema = z.object({
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

const RuntimeMemorySearchToolInputSchema = z.object({
  query: z.string().min(1),
  scope: z.string().optional(),
  limit: z.number().int().positive().max(10).optional(),
  includeContent: z.boolean().optional(),
});

function mapRunRow(row: unknown): RunRecord {
  const parsed = RunRowSchema.parse(row);
  return RunRecordSchema.parse({
    id: parsed.id,
    jobId: parsed.job_id,
    taskId: parsed.task_id,
    workspaceId: parsed.workspace_id,
    profileId: parsed.profile_id ?? 'default',
    sessionRootId: parsed.session_root_id,
    engineSessionRef: parsed.engine_session_ref,
    state: parsed.state,
    startedAt: parsed.started_at,
    finishedAt: parsed.finished_at,
    error: parsed.error,
  });
}

function mapRunEventRow(row: unknown): RunEventRecord {
  const parsed = RunEventRowSchema.parse(row);
  return RunEventRecordSchema.parse({
    id: parsed.id,
    runId: parsed.run_id,
    type: parsed.type,
    payload: parsed.payload,
    createdAt: parsed.created_at,
  });
}

function mapExecutionEnvelopeRow(row: unknown): ExecutionEnvelope {
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

function mapTelegramDeliveryRow(row: unknown): TelegramDeliveryState {
  const parsed = TelegramReplyDeliveryRowSchema.parse(row);
  return TelegramDeliveryStateSchema.parse({
    chatId: parsed.chat_id,
    telegramMessageId: parsed.telegram_message_id,
    status: parsed.status,
  });
}

function parseCountRow(row: unknown): number {
  return CountRowSchema.parse(row).count;
}

function parseCreatedAt(row: unknown): string | null {
  const parsed = CreatedAtRowSchema.safeParse(row);
  return parsed.success ? parsed.data.created_at : null;
}

const ALLOWED_CONNECTION_PROVIDERS: Record<DomainKind, Array<ConnectionRecord['providerKind']>> = {
  general: ['local'],
  email: ['gmail', 'proton'],
  calendar: ['google_calendar'],
  todos: ['todoist', 'local'],
  github: ['github'],
  files: ['local_fs', 'local'],
  people: ['local'],
  finance: ['local'],
  medical: ['local'],
};

const SECRET_REQUIRED_CONNECTION_PROVIDERS = new Set<ConnectionRecord['providerKind']>([
  'gmail',
  'google_calendar',
  'github',
  'proton',
  'todoist',
]);

function providerRequiresSecret(providerKind: ConnectionRecord['providerKind']): boolean {
  return SECRET_REQUIRED_CONNECTION_PROVIDERS.has(providerKind);
}

function isProviderAllowedForDomain(domain: DomainKind, providerKind: ConnectionRecord['providerKind']): boolean {
  return (ALLOWED_CONNECTION_PROVIDERS[domain] ?? []).includes(providerKind);
}

function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  const rel = relative(rootPath, candidatePath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function canonicalizeLocalPath(inputPath: string): string {
  try {
    return realpathSync(inputPath);
  } catch {
    return resolve(inputPath);
  }
}

function buildReceiptFallbackReplyText(receipt: ReceiptRecord): string {
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

function stringifyTimelineMetadata(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function buildTimelineMetadata(details: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(details)
      .map(([key, value]) => [key, stringifyTimelineMetadata(value)] as const)
      .filter(([, value]) => value.length > 0),
  );
}

function parseRunEventPayload(payload: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function mapRunEventTitle(type: RunEventRecord['type']): string {
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
    default:
      return titleCase(type);
  }
}

function mapRunEventDetail(record: RunEventRecord): string {
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
    case 'compaction':
      return typeof payload.content === 'string' ? 'Compaction flush captured before context loss.' : '';
    default:
      return '';
  }
}

function mapSecurityAuditKind(code: string): ReceiptTimelineEvent['kind'] {
  if (code.startsWith('approval_')) return 'approval';
  if (code.startsWith('context_')) return 'context_release';
  if (code.includes('warning')) return 'warning';
  return 'policy';
}

function parseStringArrayColumn(value: unknown): string[] {
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

function parseJsonArrayColumn<T>(value: unknown, schema: z.ZodType<T[]>): T[] {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return schema.parse([]);
  }
  try {
    return schema.parse(JSON.parse(value));
  } catch {
    return schema.parse([]);
  }
}

function matchesConnectionResourceId(left: string, right: string): boolean {
  return left === right || left.toLowerCase() === right.toLowerCase();
}

function buildLegacyConnectionResourceRules(
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

function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0]!.toLowerCase() : null;
}

function mapConnectionRow(row: Record<string, unknown>): ConnectionRecord {
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
    resourceRules: resourceRules.length > 0 ? resourceRules : buildLegacyConnectionResourceRules(allowedResources, timestamp),
    lastSyncAt: (row['last_sync_at'] as string) ?? null,
    lastSyncStatus: (row['last_sync_status'] as ConnectionRecord['lastSyncStatus']) ?? null,
    policy: undefined,
    health: parseJsonColumn(row['health_json'], ConnectionHealthSummarySchema),
    sync: parseJsonColumn(row['sync_json'], ConnectionSyncSummarySchema),
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}

interface StoredOAuthSecret {
  accessToken: string;
  refreshToken?: string | undefined;
  tokenType?: string | undefined;
  scopes: string[];
  expiresAt?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

function parseJsonColumn<T>(value: unknown, schema: z.ZodType<T>): T {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return schema.parse({});
  }
  try {
    return schema.parse(JSON.parse(value));
  } catch {
    return schema.parse({});
  }
}

function parseStoredOAuthSecret(value: string | null | undefined): StoredOAuthSecret | null {
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

function serializeStoredOAuthSecret(input: OAuthTokenPayload): string {
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

function canRefreshStoredOAuthSecret(
  providerKind: ConnectionRecord['providerKind'],
  secret: StoredOAuthSecret | null,
  config: AppConfig,
): boolean {
  if (!secret?.refreshToken) return false;
  switch (providerKind) {
    case 'gmail':
    case 'google_calendar':
      return Boolean(config.providerAuth.google.clientId && config.providerAuth.google.clientSecret);
    default:
      return false;
  }
}

function connectionCursorKindForProvider(providerKind: ConnectionRecord['providerKind']): ConnectionSyncSummary['cursorKind'] {
  switch (providerKind) {
    case 'gmail':
      return 'history_id';
    case 'google_calendar':
      return 'sync_token';
    case 'github':
      return 'since';
    default:
      return 'none';
  }
}

function isExpiredIso(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.length > 0 && Date.parse(value) <= Date.now();
}

export class PopeyeRuntimeService {
  readonly events = new EventEmitter();
  readonly databases: RuntimeDatabases;
  readonly engine: EngineAdapter;
  readonly startedAt: string;
  readonly config: AppConfig;
  private closed = false;

  private readonly memorySearch: MemorySearchService;
  private readonly memoryLifecycle: MemoryLifecycleService;
  private memoryMaintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private docIndexTimer: ReturnType<typeof setInterval> | null = null;
  private tokenRotationTimer: ReturnType<typeof setInterval> | null = null;
  private vecAvailable = false;
  private readonly vecInitPromise: Promise<void>;

  private readonly log: PopeyeLogger;
  private readonly activeRuns = new Map<string, ActiveRunContext>();
  private readonly scheduler: SchedulerInternals = {
    running: false,
    tickTimer: null,
    leaseTimer: null,
    tickIntervalMs: 250,
    leaseRefreshIntervalMs: 15_000,
    leaseTtlMs: 60_000,
    shutdownGraceMs: 30_000,
    lastSchedulerTickAt: null,
    lastLeaseSweepAt: null,
  };

  readonly startupProfile: { dbReadyMs: number; reconcileMs: number; schedulerReadyMs: number };

  // --- Delegate modules ---
  private readonly workspaceRegistry: WorkspaceRegistry;
  private readonly sessionService: SessionService;
  private readonly receiptManager: ReceiptManager;
  private readonly messageIngestion: MessageIngestionService;
  private readonly taskManager: TaskManager;
  private readonly queryService: QueryService;
  private readonly secretStore: SecretStore;
  private readonly oauthSessionService: OAuthSessionService;
  private readonly approvalService: ApprovalService;
  private readonly actionPolicyEvaluator: ActionPolicyEvaluator;
  private readonly vaultManager: VaultManager;
  private readonly contextReleaseService: ContextReleaseService;
  private readonly capabilityRegistry: CapabilityRegistry;
  private capabilityInitPromise: Promise<void> | null = null;
  private approvalExpiryTimer: ReturnType<typeof setInterval> | null = null;

  private static validateRegexPatterns(config: AppConfig): void {
    const fields: Array<{ name: string; patterns: string[] }> = [
      { name: 'redactionPatterns', patterns: config.security.redactionPatterns ?? [] },
      { name: 'promptScanQuarantinePatterns', patterns: config.security.promptScanQuarantinePatterns ?? [] },
      { name: 'promptScanSanitizePatterns', patterns: (config.security.promptScanSanitizePatterns ?? []).map((p) => p.pattern) },
    ];
    for (const field of fields) {
      for (const pattern of field.patterns) {
        let regex: RegExp;
        try {
          regex = new RegExp(pattern, 'g');
        } catch (err: unknown) {
          const msg = err instanceof SyntaxError ? err.message : String(err);
          throw new Error(`Invalid regex in security.${field.name}: pattern "${pattern}" — ${msg}`);
        }
        if (!safe(regex)) {
          throw new Error(`ReDoS-vulnerable regex in security.${field.name}: pattern "${pattern}"`);
        }
      }
    }
  }

  constructor(config: AppConfig, engineOverride?: EngineAdapter, loggerOverride?: PopeyeLogger) {
    const startupStart = performance.now();
    if (config.security.bindHost !== '127.0.0.1') {
      throw new Error(`Popeye requires config.security.bindHost to be 127.0.0.1, received ${config.security.bindHost}`);
    }
    PopeyeRuntimeService.validateRegexPatterns(config);
    this.config = config;
    this.log = loggerOverride ?? createLogger('runtime', config.security.redactionPatterns);
    initAuthStore(config.authFile);
    this.startedAt = nowIso();
    this.databases = openRuntimeDatabases(config);
    this.engine = engineOverride ?? createEngineAdapter(config);
    const dbReadyMs = Math.round(performance.now() - startupStart);

    // Initialize memory services
    const embeddingClient = config.embeddings.provider === 'openai'
      ? createOpenAIEmbeddingClient({ model: config.embeddings.model, dimensions: config.embeddings.dimensions })
      : createDisabledEmbeddingClient();
    this.memorySearch = new MemorySearchService({
      db: this.databases.memory,
      embeddingClient,
      vecAvailable: () => this.vecAvailable,
      halfLifeDays: config.memory.confidenceHalfLifeDays,
      budgetConfig: config.memory.budgetAllocation,
      redactionPatterns: config.security.redactionPatterns,
    });
    const summarizationClient = config.embeddings.provider === 'openai'
      ? createOpenAISummarizationClient({})
      : createDisabledSummarizationClient();
    this.memoryLifecycle = new MemoryLifecycleService(this.databases, config, this.memorySearch, summarizationClient);

    // Try loading sqlite-vec (non-blocking)
    this.vecInitPromise = loadSqliteVec(this.databases.memory, config.embeddings.dimensions).then((loaded) => {
      this.vecAvailable = loaded;
    });

    // Initialize delegate modules
    this.workspaceRegistry = new WorkspaceRegistry({ app: this.databases.app, paths: this.databases.paths });
    this.sessionService = new SessionService({ app: this.databases.app });

    // Initialize policy substrate services
    const sevMap: Record<string, 'info' | 'warn' | 'error'> = { info: 'info', warning: 'warn', warn: 'warn', error: 'error' };
    const auditCallback = (event: { eventType: string; details: Record<string, unknown>; severity: string }) => {
      this.recordSecurityAudit({
        code: event.eventType,
        severity: sevMap[event.severity] ?? 'info',
        message: event.eventType,
        component: 'policy-substrate',
        timestamp: nowIso(),
        details: Object.fromEntries(Object.entries(event.details).map(([k, v]) => [k, String(v)])),
      });
    };
    this.secretStore = new SecretStore(this.databases.app, this.log, this.databases.paths, auditCallback);
    this.oauthSessionService = new OAuthSessionService(this.databases.app);
    this.approvalService = new ApprovalService(
      this.databases.app,
      this.log,
      auditCallback,
      (event, data) => this.emit(event, data),
      { pendingExpiryMinutes: config.approvalPolicy?.pendingExpiryMinutes ?? 60 },
    );
    this.actionPolicyEvaluator = new ActionPolicyEvaluator(config.approvalPolicy);
    this.vaultManager = new VaultManager(this.databases.app, this.log, this.databases.paths, auditCallback);
    this.contextReleaseService = new ContextReleaseService(this.databases.app, this.log, auditCallback);

    this.receiptManager = new ReceiptManager(this.databases, config, {
      captureMemory: (input) => this.memoryLifecycle.insertMemory(input),
    });
    this.taskManager = new TaskManager(this.databases, {
      emit: (event, payload) => this.emit(event, payload),
      processSchedulerTick: () => this.processSchedulerTick(),
    });
    this.messageIngestion = new MessageIngestionService(this.databases, config, {
      recordSecurityAudit: (event) => this.recordSecurityAudit(event),
      createTask: (input) => this.createTask({ ...input, profileId: 'default' }),
      createIntervention: (code, runId, reason) => this.createIntervention(code, runId, reason),
    });
    const self = this;
    this.queryService = new QueryService(this.databases, config, {
      get schedulerRunning() { return self.scheduler.running; },
      get activeRunsCount() { return self.activeRuns.size; },
      get startedAt() { return self.startedAt; },
      get lastSchedulerTickAt() { return self.scheduler.lastSchedulerTickAt; },
      get lastLeaseSweepAt() { return self.scheduler.lastLeaseSweepAt; },
      getEngineCapabilities: () => this.engine.getCapabilities(),
      computeNextHeartbeatDueAt: () => this.computeNextHeartbeatDueAt(),
    }, this.workspaceRegistry);

    const clearedBrowserSessions = clearBrowserSessions(this.databases.app);
    if (clearedBrowserSessions > 0) {
      this.recordSecurityAudit({
        code: 'browser_sessions_cleared_on_startup',
        severity: 'info',
        message: `Cleared ${clearedBrowserSessions} browser session(s) during startup`,
        component: 'runtime-core',
        timestamp: nowIso(),
        details: { cleared: String(clearedBrowserSessions) },
      });
    }

    // Initialize capability registry
    this.capabilityRegistry = new CapabilityRegistry({
      appDb: this.databases.app,
      memoryDb: this.databases.memory,
      log: this.log,
      buildContext: () => this.buildCapabilityContext(),
    });

    // Register built-in capabilities
    this.capabilityRegistry.register(createFilesCapability());
    this.capabilityRegistry.register(createEmailCapability());
    this.capabilityRegistry.register(createGithubCapability());
    this.capabilityRegistry.register(createCalendarCapability());
    this.capabilityRegistry.register(createTodosCapability());
    this.capabilityRegistry.register(createPeopleCapability());

    // Defer async initialization (similar to vecInitPromise pattern)
    this.capabilityInitPromise = this.capabilityRegistry.initializeAll().catch((err) => {
      this.log.error('capability initialization failed', { error: err instanceof Error ? err.message : String(err) });
    });

    this.seedReferenceData();
    this.reconcileStartupState();
    const reconcileMs = Math.round(performance.now() - startupStart);
    this.seedDaemonState();
    this.startScheduler();
    this.startMemoryMaintenance();
    this.startDocIndexing();
    this.startTokenRotationCheck();
    this.approvalExpiryTimer = setInterval(() => {
      this.approvalService.expireStaleApprovals();
    }, 5 * 60_000);
    const schedulerReadyMs = Math.round(performance.now() - startupStart);
    this.startupProfile = { dbReadyMs, reconcileMs, schedulerReadyMs };
    this.log.info('runtime started', { dbReadyMs, reconcileMs, schedulerReadyMs });
    this.events.emit('startup_profile', this.startupProfile);
  }

  async close(): Promise<void> {
    this.log.info('runtime closing');
    this.closed = true;
    if (this.memoryMaintenanceTimer) {
      clearInterval(this.memoryMaintenanceTimer);
      this.memoryMaintenanceTimer = null;
    }
    if (this.docIndexTimer) {
      clearInterval(this.docIndexTimer);
      this.docIndexTimer = null;
    }
    if (this.tokenRotationTimer) {
      clearInterval(this.tokenRotationTimer);
      this.tokenRotationTimer = null;
    }
    if (this.approvalExpiryTimer) {
      clearInterval(this.approvalExpiryTimer);
      this.approvalExpiryTimer = null;
    }
    this.vaultManager.closeAllVaults();
    // Close email read-only DB before capability shutdown
    if (this.emailReadDb) {
      this.emailReadDb.close();
      this.emailReadDb = null;
      this.emailServiceCache = null;
      this.emailSearchCache = null;
    }
    // Close github read-only DB before capability shutdown
    if (this.githubReadDb) {
      this.githubReadDb.close();
      this.githubReadDb = null;
      this.githubServiceCache = null;
      this.githubSearchCache = null;
    }
    // Close calendar read-only DB before capability shutdown
    if (this.calendarReadDb) {
      this.calendarReadDb.close();
      this.calendarReadDb = null;
      this.calendarServiceCache = null;
      this.calendarSearchCache = null;
    }
    // Close todos read-only DB before capability shutdown
    if (this.todosReadDb) {
      this.todosReadDb.close();
      this.todosReadDb = null;
      this.todosServiceCache = null;
      this.todosSearchCache = null;
    }
    if (this.peopleReadDb) {
      this.peopleReadDb.close();
      this.peopleReadDb = null;
      this.peopleServiceCache = null;
    }
    if (this.capabilityInitPromise) await this.capabilityInitPromise;
    await this.capabilityRegistry.shutdownAll();
    await this.stopScheduler();
    await this.vecInitPromise;
    this.databases.app.prepare('UPDATE daemon_state SET last_shutdown_at = ? WHERE id = 1').run(nowIso());
    this.databases.app.close();
    this.databases.memory.close();
  }

  async shutdown(): Promise<void> {
    await this.close();
  }

  // --- Delegated: TaskManager ---

  createTask(input: TaskCreateInput): { task: TaskRecord; job: JobRecord | null; run: RunRecord | null } {
    const parsed = TaskCreateInputSchema.parse(input);
    const profile = this.getAgentProfile(parsed.profileId);
    if (!profile) {
      throw new RuntimeValidationError(`Execution profile not found: ${parsed.profileId}`);
    }
    const workspace = this.getWorkspace(parsed.workspaceId);
    if (!workspace) {
      throw new RuntimeValidationError(`Workspace not found: ${parsed.workspaceId}`);
    }
    if (parsed.projectId) {
      const project = this.getProject(parsed.projectId);
      if (!project) {
        throw new RuntimeValidationError(`Project not found: ${parsed.projectId}`);
      }
      if (project.workspaceId !== parsed.workspaceId) {
        throw new RuntimeValidationError(`Project ${parsed.projectId} does not belong to workspace ${parsed.workspaceId}`);
      }
    }
    const contextError = validateProfileTaskContext(profile, {
      workspaceId: parsed.workspaceId,
      projectId: parsed.projectId,
    });
    if (contextError) {
      throw new RuntimeValidationError(contextError);
    }
    return this.taskManager.createTask(parsed);
  }

  enqueueTask(taskId: string, options?: { availableAt?: string; retryCount?: number }): JobRecord | null {
    return this.taskManager.enqueueTask(taskId, options);
  }

  enqueueJob(jobId: string): JobRecord | null {
    return this.taskManager.enqueueJob(jobId);
  }

  requeueJob(jobId: string): JobRecord | null {
    return this.taskManager.requeueJob(jobId);
  }

  executeJob(jobId: string): JobRecord | null {
    return this.taskManager.executeJob(jobId);
  }

  listTasks(): TaskRecord[] {
    return this.taskManager.listTasks();
  }

  getTask(taskId: string): TaskRecord | null {
    return this.taskManager.getTask(taskId);
  }

  listJobs(): JobRecord[] {
    return this.taskManager.listJobs();
  }

  getJob(jobId: string): JobRecord | null {
    return this.taskManager.getJob(jobId);
  }

  getJobLease(jobId: string): JobLeaseRecord | null {
    return this.taskManager.getJobLease(jobId);
  }

  pauseJob(jobId: string): JobRecord | null {
    return this.taskManager.pauseJob(jobId);
  }

  resumeJob(jobId: string): JobRecord | null {
    return this.taskManager.resumeJob(jobId);
  }

  // --- Delegated: ReceiptManager ---

  private listSecurityAuditEventsForRun(runId: string): SecurityAuditEvent[] {
    const rows = this.databases.app
      .prepare('SELECT code, severity, message, component, timestamp, details_json FROM security_audit ORDER BY timestamp ASC')
      .all() as Array<{
        code: string;
        severity: SecurityAuditEvent['severity'];
        message: string;
        component: string;
        timestamp: string;
        details_json: string;
      }>;

    return rows
      .map((row) => {
        const details = JSON.parse(row.details_json || '{}') as Record<string, string>;
        return {
          code: row.code,
          severity: row.severity,
          message: row.message,
          component: row.component,
          timestamp: row.timestamp,
          details,
        } satisfies SecurityAuditEvent;
      })
      .filter((event) => event.details.runId === runId);
  }

  private buildReceiptTimeline(runId: string, status?: ReceiptRecord['status']): ReceiptTimelineEvent[] {
    const timeline: ReceiptTimelineEvent[] = [];

    for (const event of this.listRunEvents(runId)) {
      timeline.push({
        id: `run_event:${event.id}`,
        at: event.createdAt,
        kind: 'run',
        severity: event.type === 'failed' ? 'error' : 'info',
        code: `engine_${event.type}`,
        title: mapRunEventTitle(event.type),
        detail: mapRunEventDetail(event),
        source: 'run_event',
        metadata: buildTimelineMetadata(parseRunEventPayload(event.payload)),
      });
    }

    for (const event of this.listSecurityAuditEventsForRun(runId)) {
      if (event.code === 'context_released') continue;
      timeline.push({
        id: `security_audit:${event.timestamp}:${event.code}`,
        at: event.timestamp,
        kind: mapSecurityAuditKind(event.code),
        severity: event.severity,
        code: event.code,
        title: titleCase(event.code),
        detail: event.message,
        source: 'security_audit',
        metadata: buildTimelineMetadata(event.details),
      });
    }

    const releases = this.contextReleaseService.listReleasesForRun(runId);
    const approvalsById = new Map<string, ApprovalRecord>();
    for (const approval of this.approvalService.listApprovals({ runId })) {
      approvalsById.set(approval.id, approval);
    }
    for (const release of releases) {
      if (!release.approvalId) continue;
      const approval = this.approvalService.getApproval(release.approvalId);
      if (approval) approvalsById.set(approval.id, approval);
    }

    for (const approval of approvalsById.values()) {
      timeline.push({
        id: `approval:${approval.id}:requested`,
        at: approval.createdAt,
        kind: 'approval',
        severity: approval.riskClass === 'deny' ? 'error' : 'info',
        code: 'approval_requested',
        title: 'Approval requested',
        detail: `${approval.scope} · ${approval.actionKind} · ${approval.resourceType}/${approval.resourceId}`,
        source: 'approval',
        metadata: buildTimelineMetadata({
          approvalId: approval.id,
          domain: approval.domain,
          riskClass: approval.riskClass,
          actionKind: approval.actionKind,
          resourceScope: approval.resourceScope,
          runId: approval.runId ?? '',
          standingApprovalEligible: approval.standingApprovalEligible,
          automationGrantEligible: approval.automationGrantEligible,
          status: approval.status,
        }),
      });
      if (approval.resolvedAt) {
        timeline.push({
          id: `approval:${approval.id}:resolved`,
          at: approval.resolvedAt,
          kind: 'approval',
          severity: approval.status === 'approved' ? 'info' : approval.status === 'expired' ? 'warn' : 'error',
          code: `approval_${approval.status}`,
          title: `Approval ${approval.status}`,
        detail: approval.decisionReason ?? `${approval.scope} decision recorded.`,
        source: 'approval',
        metadata: buildTimelineMetadata({
          approvalId: approval.id,
          resolvedBy: approval.resolvedBy ?? '',
          resolvedByGrantId: approval.resolvedByGrantId ?? '',
          domain: approval.domain,
          actionKind: approval.actionKind,
        }),
      });
    }
    }

    for (const release of releases) {
      timeline.push({
        id: `context_release:${release.id}`,
        at: release.createdAt,
        kind: 'context_release',
        severity: 'info',
        code: 'context_released',
        title: `Context released to ${release.domain}`,
        detail: `${release.releaseLevel}${release.redacted ? ' · redacted' : ''}`,
        source: 'context_release',
        metadata: buildTimelineMetadata({
          releaseId: release.id,
          sourceRef: release.sourceRef,
          tokenEstimate: release.tokenEstimate,
          ...(release.approvalId ? { approvalId: release.approvalId } : {}),
        }),
      });
    }

    if (status) {
      const run = this.getRun(runId);
      timeline.push({
        id: `receipt:${runId}:${status}`,
        at: run?.finishedAt ?? nowIso(),
        kind: status === 'succeeded' ? 'run' : 'warning',
        severity: status === 'succeeded' ? 'info' : status === 'cancelled' || status === 'abandoned' ? 'warn' : 'error',
        code: `receipt_${status}`,
        title: `Receipt ${status}`,
        detail: `Run finished with status ${status}.`,
        source: 'receipt',
        metadata: {},
      });
    }

    return timeline.sort((left, right) => {
      const byTime = Date.parse(left.at) - Date.parse(right.at);
      return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
    });
  }

  private buildReceiptRuntimeSummary(
    runId: string,
    taskId: string,
    status?: ReceiptRecord['status'],
  ): NonNullable<ReceiptRecord['runtime']> | undefined {
    const run = this.getRun(runId);
    const task = this.getTask(taskId);
    const envelope = this.getExecutionEnvelope(runId);
    const contextReleases = this.summarizeRunReleases(runId);
    const timeline = this.buildReceiptTimeline(runId, status);

    const runtimeSummary: NonNullable<ReceiptRecord['runtime']> = {
      projectId: task?.projectId ?? null,
      profileId: run?.profileId ?? null,
      execution: envelope
        ? {
            mode: envelope.mode,
            memoryScope: envelope.memoryScope,
            recallScope: envelope.recallScope,
            filesystemPolicyClass: envelope.filesystemPolicyClass,
            contextReleasePolicy: envelope.contextReleasePolicy,
            sessionPolicy: envelope.provenance.sessionPolicy,
            warnings: envelope.provenance.warnings,
          }
        : null,
      contextReleases: contextReleases.totalReleases > 0
        ? contextReleases
        : null,
      timeline,
    };

    if (!runtimeSummary.projectId && !runtimeSummary.profileId && !runtimeSummary.execution && !runtimeSummary.contextReleases && runtimeSummary.timeline.length === 0) {
      return undefined;
    }
    return runtimeSummary;
  }

  private mergeReceiptRuntimeSummary(receipt: ReceiptRecord): ReceiptRecord['runtime'] | undefined {
    const derived = this.buildReceiptRuntimeSummary(receipt.runId, receipt.taskId, receipt.status);
    if (!receipt.runtime) {
      return derived;
    }
    if (!derived) {
      return receipt.runtime;
    }
    const timelineById = new Map<string, ReceiptTimelineEvent>();
    for (const event of receipt.runtime.timeline) {
      timelineById.set(event.id, event);
    }
    for (const event of derived.timeline) {
      timelineById.set(event.id, event);
    }
    const mergedTimeline = Array.from(timelineById.values()).sort((left, right) => {
      const byTime = Date.parse(left.at) - Date.parse(right.at);
      return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
    });
    return {
      projectId: receipt.runtime.projectId ?? derived.projectId ?? null,
      profileId: receipt.runtime.profileId ?? derived.profileId ?? null,
      execution: receipt.runtime.execution ?? derived.execution ?? null,
      contextReleases: receipt.runtime.contextReleases ?? derived.contextReleases ?? null,
      timeline: mergedTimeline,
    };
  }

  private enrichReceipt(receipt: ReceiptRecord | null): ReceiptRecord | null {
    if (!receipt) return null;
    const runtime = this.mergeReceiptRuntimeSummary(receipt);
    return {
      ...receipt,
      ...(runtime !== undefined ? { runtime } : {}),
    };
  }

  private writeRuntimeReceipt(input: Omit<ReceiptRecord, 'id' | 'createdAt'>): ReceiptRecord {
    const runtime = input.runtime ?? this.buildReceiptRuntimeSummary(input.runId, input.taskId, input.status);
    const receipt = this.receiptManager.writeReceipt({
      ...input,
      ...(runtime !== undefined ? { runtime } : {}),
    });
    const enriched = this.enrichReceipt(receipt) ?? receipt;
    this.receiptManager.captureMemoryFromReceipt(enriched);
    return enriched;
  }

  listReceipts(): ReceiptRecord[] {
    return this.receiptManager.listReceipts().map((receipt) => this.enrichReceipt(receipt) ?? receipt);
  }

  getReceipt(receiptId: string): ReceiptRecord | null {
    return this.enrichReceipt(this.receiptManager.getReceipt(receiptId));
  }

  getReceiptByRunId(runId: string): ReceiptRecord | null {
    return this.enrichReceipt(this.receiptManager.getReceiptByRunId(runId));
  }

  getUsageSummary(): UsageSummary {
    return this.receiptManager.getUsageSummary();
  }

  // --- Delegated: QueryService ---

  getStatus(): DaemonStatusResponse {
    return this.queryService.getStatus();
  }

  getEngineCapabilities(): EngineCapabilities {
    return this.queryService.getEngineCapabilities();
  }

  getDaemonState(): DaemonStateRecord {
    return this.queryService.getDaemonState();
  }

  getSchedulerStatus(): SchedulerStatusResponse {
    return this.queryService.getSchedulerStatus();
  }

  listWorkspaces(): WorkspaceRecord[] {
    return this.workspaceRegistry.listWorkspaces();
  }

  getWorkspace(id: string): WorkspaceRecord | null {
    return this.workspaceRegistry.getWorkspace(id);
  }

  listProjects(): ProjectRecord[] {
    return this.workspaceRegistry.listProjects();
  }

  getProject(id: string): ProjectRecord | null {
    return this.workspaceRegistry.getProject(id);
  }

  registerWorkspace(input: WorkspaceRegistrationInput): WorkspaceRecord {
    return this.workspaceRegistry.registerWorkspace(input);
  }

  registerProject(input: ProjectRegistrationInput): ProjectRecord {
    return this.workspaceRegistry.registerProject(input);
  }

  resolveWorkspaceFromCwd(cwd: string): { workspaceId: string; projectId: string | null } | null {
    const projects = z.array(ProjectPathRowSchema).parse(
      this.databases.app.prepare('SELECT id, workspace_id, path FROM projects WHERE path IS NOT NULL ORDER BY LENGTH(path) DESC').all(),
    );
    for (const project of projects) {
      if (cwd.startsWith(project.path)) {
        return { workspaceId: project.workspace_id, projectId: project.id };
      }
    }
    const workspaces = z.array(WorkspacePathRowSchema).parse(
      this.databases.app.prepare('SELECT id, root_path FROM workspaces WHERE root_path IS NOT NULL ORDER BY LENGTH(root_path) DESC').all(),
    );
    for (const workspace of workspaces) {
      if (cwd.startsWith(workspace.root_path)) {
        return { workspaceId: workspace.id, projectId: null };
      }
    }
    return null;
  }

  listAgentProfiles(): AgentProfileRecord[] {
    return this.queryService.listAgentProfiles();
  }

  getAgentProfile(profileId: string): AgentProfileRecord | null {
    return this.queryService.getAgentProfile(profileId);
  }

  getExecutionEnvelope(runId: string): ExecutionEnvelope | null {
    const row = this.databases.app.prepare('SELECT * FROM execution_envelopes WHERE run_id = ?').get(runId);
    return row ? mapExecutionEnvelopeRow(row) : null;
  }

  private persistExecutionEnvelope(envelope: ExecutionEnvelope): void {
    this.databases.app.prepare(`
      INSERT OR REPLACE INTO execution_envelopes (
        run_id, task_id, profile_id, workspace_id, project_id, mode, model_policy,
        allowed_runtime_tools_json, allowed_capability_ids_json, memory_scope, recall_scope,
        filesystem_policy_class, context_release_policy, read_roots_json, write_roots_json,
        protected_paths_json, scratch_root, cwd, provenance_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      envelope.runId,
      envelope.taskId,
      envelope.profileId,
      envelope.workspaceId,
      envelope.projectId,
      envelope.mode,
      envelope.modelPolicy,
      JSON.stringify(envelope.allowedRuntimeTools),
      JSON.stringify(envelope.allowedCapabilityIds),
      envelope.memoryScope,
      envelope.recallScope,
      envelope.filesystemPolicyClass,
      envelope.contextReleasePolicy,
      JSON.stringify(envelope.readRoots),
      JSON.stringify(envelope.writeRoots),
      JSON.stringify(envelope.protectedPaths),
      envelope.scratchRoot,
      envelope.cwd,
      JSON.stringify(envelope.provenance),
      envelope.provenance.derivedAt,
    );
  }

  authorizeContextRelease(input: {
    runId: string;
    domain: ContextReleasePreview['domain'];
    sourceRef: string;
    requestedLevel: ContextReleasePreview['releaseLevel'];
    tokenEstimate?: number;
    resourceType?: string;
    resourceId?: string;
    requestedBy?: string;
    payloadPreview?: string;
  }): {
    outcome: 'allow' | 'deny' | 'approval_required';
    approvedLevel: ContextReleasePreview['releaseLevel'] | null;
    approvalId: string | null;
    reason: string;
    redactionApplied: boolean;
  } {
    const envelope = this.getExecutionEnvelope(input.runId);
    if (!envelope) {
      return {
        outcome: 'deny',
        approvedLevel: null,
        approvalId: null,
        reason: 'Execution envelope not found for this run.',
        redactionApplied: false,
      };
    }

    const effectiveLevel = computeEffectiveContextReleaseLevel(
      envelope.contextReleasePolicy,
      input.requestedLevel,
    );
    const policy = this.actionPolicyEvaluator.evaluateContextRelease({
      domain: input.domain,
      requestedLevel: input.requestedLevel,
      profileLimit: envelope.contextReleasePolicy,
      resourceScope: 'resource',
    });

    if (policy.riskClass === 'deny') {
      return {
        outcome: 'deny',
        approvedLevel: null,
        approvalId: null,
        reason: policy.reason,
        redactionApplied: false,
      };
    }

    const approval = this.requestApproval({
      scope: 'context_release',
      domain: input.domain,
      riskClass: policy.riskClass,
      actionKind: 'release_context',
      resourceScope: 'resource',
      resourceType: input.resourceType ?? 'context_release',
      resourceId: input.resourceId ?? input.sourceRef,
      requestedBy: input.requestedBy ?? 'context_release_gate',
      runId: input.runId,
      standingApprovalEligible: policy.standingApprovalEligible,
      automationGrantEligible: policy.automationGrantEligible,
      payloadPreview: input.payloadPreview ?? input.sourceRef,
    });

    if (approval.status === 'approved') {
      return {
        outcome: 'allow',
        approvedLevel: input.requestedLevel,
        approvalId: approval.id,
        reason: approval.decisionReason ?? policy.reason,
        redactionApplied: false,
      };
    }

    return {
      outcome: 'approval_required',
      approvedLevel: effectiveLevel,
      approvalId: approval.id,
      reason: policy.reason,
      redactionApplied: false,
    };
  }

  listSessionRoots(): Array<{ id: string; kind: string; scope: string; createdAt: string }> {
    return this.sessionService.listSessionRoots();
  }

  getInstructionPreview(scope: string, projectId?: string): CompiledInstructionBundle {
    return this.queryService.getInstructionPreview(scope, projectId);
  }

  listInterventions(): InterventionRecord[] {
    return this.sessionService.listInterventions();
  }

  resolveIntervention(interventionId: string, resolutionNote?: string): InterventionRecord | null {
    return this.sessionService.resolveIntervention(interventionId, resolutionNote);
  }

  getSecurityAuditFindings() {
    return this.queryService.getSecurityAuditFindings();
  }

  recordSecurityAuditEvent(event: SecurityAuditEvent): void {
    this.recordSecurityAudit(event);
  }

  loadAuthStore() {
    return readAuthStore(this.config.authFile);
  }

  loadRoleAuthStore() {
    return readRoleAuthStore(this.config.authFile);
  }

  issueCsrfToken(): string {
    return this.queryService.issueCsrfToken();
  }

  createBrowserSession() {
    return createRuntimeBrowserSession(this.databases.app);
  }

  validateBrowserSession(sessionId: string): BrowserSessionValidationResult {
    return validateRuntimeBrowserSession(this.databases.app, sessionId);
  }

  startOAuthConnectSession(input: OAuthConnectStartRequest): OAuthSessionRecord {
    this.oauthSessionService.expirePendingSessions();

    const domain = mapProviderToDomain(input.providerKind);
    if (input.connectionId) {
      const existing = this.getConnection(input.connectionId);
      if (!existing) {
        throw new RuntimeNotFoundError(`Connection ${input.connectionId} not found`);
      }
      if (existing.providerKind !== input.providerKind || existing.domain !== domain) {
        throw new RuntimeValidationError(`Connection ${input.connectionId} does not match ${input.providerKind}`);
      }
    }

    const id = randomUUID();
    const stateToken = `oauth_${id}_${buildPkceVerifier()}`;
    const pkceVerifier = buildPkceVerifier();
    const redirectUri = this.getOAuthRedirectUri();
    const authorizationUrl = buildProviderAuthorizationUrl({
      providerKind: input.providerKind,
      config: this.config,
      redirectUri,
      state: stateToken,
      codeChallenge: buildPkceChallenge(pkceVerifier),
    });

    return this.oauthSessionService.createSession({
      id,
      providerKind: input.providerKind,
      domain,
      connectionMode: input.mode,
      syncIntervalSeconds: input.syncIntervalSeconds,
      connectionId: input.connectionId ?? null,
      stateToken,
      pkceVerifier,
      redirectUri,
      authorizationUrl,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
  }

  getOAuthSession(id: string): OAuthSessionRecord | null {
    this.oauthSessionService.expirePendingSessions();
    return this.oauthSessionService.getSession(id);
  }

  async completeOAuthConnectCallback(input: {
    code?: string | undefined;
    state?: string | undefined;
    error?: string | undefined;
    errorDescription?: string | undefined;
  }): Promise<OAuthSessionRecord> {
    this.oauthSessionService.expirePendingSessions();

    if (!input.state) {
      throw new RuntimeValidationError('Missing OAuth state');
    }
    const session = this.oauthSessionService.getByStateToken(input.state);
    if (!session) {
      throw new RuntimeNotFoundError('OAuth session not found');
    }
    if (session.status !== 'pending') {
      return this.oauthSessionService.getSession(session.id)!;
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
      return this.oauthSessionService.failSession(session.id, 'OAuth session expired', 'expired')!;
    }
    if (input.error) {
      return this.oauthSessionService.failSession(
        session.id,
        input.errorDescription ? `${input.error}: ${input.errorDescription}` : input.error,
      )!;
    }
    if (!input.code) {
      return this.oauthSessionService.failSession(session.id, 'OAuth callback did not include an authorization code')!;
    }

    try {
      const tokenPayload = await exchangeProviderAuthorizationCode({
        providerKind: session.providerKind,
        config: this.config,
        code: input.code,
        redirectUri: session.redirectUri,
        codeVerifier: session.pkceVerifier,
      });
      const completed = await this.completeProviderSession(session, tokenPayload);
      return completed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.oauthSessionService.failSession(session.id, message);
      if (session.connectionId) {
        this.updateConnectionRollups({
          connectionId: session.connectionId,
          health: {
            status: 'reauth_required',
            authState: 'stale',
            checkedAt: nowIso(),
            lastError: message,
          },
        });
      }
      throw error;
    }
  }

  private async completeProviderSession(
    session: ReturnType<OAuthSessionService['getSessionInternal']> extends infer T ? NonNullable<T> : never,
    tokenPayload: OAuthTokenPayload,
  ): Promise<OAuthSessionRecord> {
    switch (session.providerKind) {
      case 'gmail':
        return this.completeGmailSession(session, tokenPayload);
      case 'google_calendar':
        return this.completeGoogleCalendarSession(session, tokenPayload);
      case 'github':
        return this.completeGithubSession(session, tokenPayload);
    }
  }

  private createOrUpdateConnectedConnection(input: {
    session: ReturnType<OAuthSessionService['getSessionInternal']> extends infer T ? NonNullable<T> : never;
    providerKind: ConnectionRecord['providerKind'];
    domain: DomainKind;
    label: string;
    allowedResources: string[];
    resourceRules: Array<Pick<ConnectionResourceRule, 'resourceType' | 'resourceId' | 'displayName' | 'writeAllowed'>>;
    scopes: string[];
  }): ConnectionRecord {
    if (input.session.connectionId) {
      const updated = this.updateConnection(input.session.connectionId, {
        label: input.label,
        mode: input.session.connectionMode,
        syncIntervalSeconds: input.session.syncIntervalSeconds,
        allowedScopes: input.scopes,
        allowedResources: input.allowedResources,
        resourceRules: input.resourceRules,
      });
      if (!updated) {
        throw new RuntimeNotFoundError(`Connection ${input.session.connectionId} not found`);
      }
      return updated;
    }

    return this.createConnection({
      domain: input.domain,
      providerKind: input.providerKind,
      label: input.label,
      mode: input.session.connectionMode,
      secretRefId: null,
      syncIntervalSeconds: input.session.syncIntervalSeconds,
      allowedScopes: input.scopes,
      allowedResources: input.allowedResources,
      resourceRules: input.resourceRules,
    });
  }

  private async completeGmailSession(
    session: NonNullable<ReturnType<OAuthSessionService['getSessionInternal']>>,
    tokenPayload: OAuthTokenPayload,
  ): Promise<OAuthSessionRecord> {
    const adapter = new GmailAdapter({
      accessToken: tokenPayload.accessToken,
      refreshToken: tokenPayload.refreshToken,
      clientId: this.config.providerAuth.google.clientId,
      clientSecret: this.config.providerAuth.google.clientSecret,
    });
    const profile = await adapter.getProfile();
    const connection = this.createOrUpdateConnectedConnection({
      session,
      providerKind: 'gmail',
      domain: 'email',
      label: `Gmail (${profile.emailAddress})`,
      allowedResources: [profile.emailAddress],
      resourceRules: [{
        resourceType: 'mailbox',
        resourceId: profile.emailAddress,
        displayName: profile.emailAddress,
        writeAllowed: true,
      }],
      scopes: tokenPayload.scopes.length > 0 ? tokenPayload.scopes : getProviderScopes('gmail'),
    });
    const secretRef = this.storeOAuthSecret(connection.id, 'gmail', tokenPayload, connection.secretRefId);
    const connected = this.updateConnection(connection.id, { secretRefId: secretRef.id }) ?? connection;

    const dbPath = `${this.databases.paths.capabilityStoresDir}/email.db`;
    const writeDb = new BetterSqlite3(dbPath);
    let accountId: string;
    try {
      const svc = new EmailService(writeDb as unknown as CapabilityContext['appDb']);
      accountId = svc.getAccountByConnection(connection.id)?.id
        ?? svc.registerAccount({
          connectionId: connection.id,
          emailAddress: profile.emailAddress,
          displayName: profile.emailAddress.split('@')[0] ?? profile.emailAddress,
        }).id;
    } finally {
      writeDb.close();
    }

    this.updateConnectionRollups({
      connectionId: connected.id,
      health: {
        status: 'healthy',
        authState: 'configured',
        checkedAt: nowIso(),
        lastError: null,
        diagnostics: [],
      },
      sync: {
        status: 'idle',
        cursorKind: connectionCursorKindForProvider(connected.providerKind),
        cursorPresent: false,
        lagSummary: 'Awaiting first sync',
      },
    });

    return this.oauthSessionService.completeSession(session.id, {
      connectionId: connected.id,
      accountId,
    })!;
  }

  private async completeGoogleCalendarSession(
    session: NonNullable<ReturnType<OAuthSessionService['getSessionInternal']>>,
    tokenPayload: OAuthTokenPayload,
  ): Promise<OAuthSessionRecord> {
    const adapter = new GoogleCalendarAdapter({
      accessToken: tokenPayload.accessToken,
      refreshToken: tokenPayload.refreshToken,
      clientId: this.config.providerAuth.google.clientId,
      clientSecret: this.config.providerAuth.google.clientSecret,
    });
    const profile = await adapter.getProfile();
    const connection = this.createOrUpdateConnectedConnection({
      session,
      providerKind: 'google_calendar',
      domain: 'calendar',
      label: `Google Calendar (${profile.email})`,
      allowedResources: [profile.email],
      resourceRules: [{
        resourceType: 'calendar',
        resourceId: profile.email,
        displayName: profile.email,
        writeAllowed: true,
      }],
      scopes: tokenPayload.scopes.length > 0 ? tokenPayload.scopes : getProviderScopes('google_calendar'),
    });
    const secretRef = this.storeOAuthSecret(connection.id, 'google_calendar', tokenPayload, connection.secretRefId);
    const connected = this.updateConnection(connection.id, { secretRefId: secretRef.id }) ?? connection;

    const dbPath = `${this.databases.paths.capabilityStoresDir}/calendar.db`;
    const writeDb = new BetterSqlite3(dbPath);
    let accountId: string;
    try {
      const svc = new CalendarService(writeDb as unknown as CapabilityContext['appDb']);
      accountId = svc.getAccountByConnection(connection.id)?.id
        ?? svc.registerAccount({
          connectionId: connection.id,
          calendarEmail: profile.email,
          displayName: profile.email.split('@')[0] ?? profile.email,
          timeZone: profile.timeZone,
        }).id;
    } finally {
      writeDb.close();
    }

    this.updateConnectionRollups({
      connectionId: connected.id,
      health: {
        status: 'healthy',
        authState: 'configured',
        checkedAt: nowIso(),
        lastError: null,
        diagnostics: [],
      },
      sync: {
        status: 'idle',
        cursorKind: connectionCursorKindForProvider(connected.providerKind),
        cursorPresent: false,
        lagSummary: 'Awaiting first sync',
      },
    });

    return this.oauthSessionService.completeSession(session.id, {
      connectionId: connected.id,
      accountId,
    })!;
  }

  private async completeGithubSession(
    session: NonNullable<ReturnType<OAuthSessionService['getSessionInternal']>>,
    tokenPayload: OAuthTokenPayload,
  ): Promise<OAuthSessionRecord> {
    const adapter = new GithubApiAdapter({ accessToken: tokenPayload.accessToken });
    const profile = await adapter.getProfile();
    const connection = this.createOrUpdateConnectedConnection({
      session,
      providerKind: 'github',
      domain: 'github',
      label: `GitHub (${profile.username})`,
      allowedResources: [],
      resourceRules: [],
      scopes: tokenPayload.scopes.length > 0 ? tokenPayload.scopes : getProviderScopes('github'),
    });
    const secretRef = this.storeOAuthSecret(connection.id, 'github', tokenPayload, connection.secretRefId);
    const connected = this.updateConnection(connection.id, { secretRefId: secretRef.id }) ?? connection;

    const dbPath = `${this.databases.paths.capabilityStoresDir}/github.db`;
    const writeDb = new BetterSqlite3(dbPath);
    let accountId: string;
    try {
      const svc = new GithubService(writeDb as unknown as CapabilityContext['appDb']);
      accountId = svc.getAccountByConnection(connection.id)?.id
        ?? svc.registerAccount({
          connectionId: connection.id,
          githubUsername: profile.username,
          displayName: profile.name,
        }).id;
    } finally {
      writeDb.close();
    }

    this.updateConnectionRollups({
      connectionId: connected.id,
      health: {
        status: 'healthy',
        authState: 'configured',
        checkedAt: nowIso(),
        lastError: null,
        diagnostics: [],
      },
      sync: {
        status: 'idle',
        cursorKind: connectionCursorKindForProvider(connected.providerKind),
        cursorPresent: false,
        lagSummary: 'Awaiting first sync',
      },
    });

    return this.oauthSessionService.completeSession(session.id, {
      connectionId: connected.id,
      accountId,
    })!;
  }

  // --- Delegated: MessageIngestion ---

  ingestMessage(input: unknown): MessageIngressResponse {
    return this.messageIngestion.ingestMessage(input);
  }

  getMessage(messageId: string): MessageRecord | null {
    return this.messageIngestion.getMessage(messageId);
  }

  getTelegramRelayCheckpoint(workspaceId: string, relayKey: 'telegram_long_poll' = 'telegram_long_poll'): TelegramRelayCheckpoint | null {
    const row = this.databases.app
      .prepare('SELECT relay_key, workspace_id, last_acknowledged_update_id, updated_at FROM telegram_relay_checkpoints WHERE relay_key = ? AND workspace_id = ?')
      .get(relayKey, workspaceId);
    if (!row) return null;
    const parsed = TelegramRelayCheckpointRowSchema.parse(row);
    return TelegramRelayCheckpointSchema.parse({
      relayKey: parsed.relay_key,
      workspaceId: parsed.workspace_id,
      lastAcknowledgedUpdateId: parsed.last_acknowledged_update_id,
      updatedAt: parsed.updated_at,
    });
  }

  commitTelegramRelayCheckpoint(input: TelegramRelayCheckpointCommitRequest): TelegramRelayCheckpoint {
    if (!this.getWorkspace(input.workspaceId)) {
      throw new RuntimeNotFoundError(`Workspace ${input.workspaceId} not found`);
    }
    const relayKey = input.relayKey ?? 'telegram_long_poll';
    const updatedAt = nowIso();
    this.databases.app.prepare(`
      INSERT INTO telegram_relay_checkpoints (relay_key, workspace_id, last_acknowledged_update_id, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(relay_key, workspace_id) DO UPDATE SET
        last_acknowledged_update_id = MAX(telegram_relay_checkpoints.last_acknowledged_update_id, excluded.last_acknowledged_update_id),
        updated_at = excluded.updated_at
    `).run(relayKey, input.workspaceId, input.lastAcknowledgedUpdateId, updatedAt);
    const checkpoint = this.getTelegramRelayCheckpoint(input.workspaceId, relayKey);
    if (!checkpoint) {
      throw new Error(`Failed to persist Telegram relay checkpoint for workspace ${input.workspaceId}`);
    }
    return checkpoint;
  }

  markTelegramReplySending(
    chatId: string,
    telegramMessageId: number,
    input: { workspaceId: string; runId?: string | null },
  ): TelegramDeliveryState | null {
    const updatedAt = nowIso();
    this.databases.app.prepare(`
      UPDATE telegram_reply_deliveries
      SET status = CASE
            WHEN status = 'pending' THEN 'sending'
            ELSE status
          END,
          run_id = COALESCE(?, run_id),
          updated_at = ?
      WHERE workspace_id = ?
        AND chat_id = ?
        AND telegram_message_id = ?
    `).run(
      input.runId ?? null,
      updatedAt,
      input.workspaceId,
      chatId,
      telegramMessageId,
    );
    const row = this.databases.app
      .prepare('SELECT chat_id, telegram_message_id, status, sent_telegram_message_id, sent_at, run_id FROM telegram_reply_deliveries WHERE workspace_id = ? AND chat_id = ? AND telegram_message_id = ?')
      .get(input.workspaceId, chatId, telegramMessageId);
    return row ? mapTelegramDeliveryRow(row) : null;
  }

  markTelegramReplyPending(
    chatId: string,
    telegramMessageId: number,
    input: { workspaceId: string; runId?: string | null },
  ): TelegramDeliveryState | null {
    const updatedAt = nowIso();
    this.databases.app.prepare(`
      UPDATE telegram_reply_deliveries
      SET status = 'pending',
          run_id = COALESCE(?, run_id),
          updated_at = ?
      WHERE workspace_id = ?
        AND chat_id = ?
        AND telegram_message_id = ?
    `).run(
      input.runId ?? null,
      updatedAt,
      input.workspaceId,
      chatId,
      telegramMessageId,
    );
    const row = this.databases.app
      .prepare('SELECT chat_id, telegram_message_id, status, sent_telegram_message_id, sent_at, run_id FROM telegram_reply_deliveries WHERE workspace_id = ? AND chat_id = ? AND telegram_message_id = ?')
      .get(input.workspaceId, chatId, telegramMessageId);
    return row ? mapTelegramDeliveryRow(row) : null;
  }

  markTelegramReplyUncertain(
    chatId: string,
    telegramMessageId: number,
    input: { workspaceId: string; runId?: string | null; reason?: string | null },
  ): TelegramDeliveryState | null {
    const updatedAt = nowIso();
    const row = this.databases.app
      .prepare('SELECT chat_id, telegram_message_id, status, sent_telegram_message_id, sent_at, run_id FROM telegram_reply_deliveries WHERE workspace_id = ? AND chat_id = ? AND telegram_message_id = ?')
      .get(input.workspaceId, chatId, telegramMessageId);
    if (!row) return null;

    const previous = TelegramReplyDeliveryRowSchema.parse(row);
    this.databases.app.prepare(`
      UPDATE telegram_reply_deliveries
      SET status = 'uncertain',
          run_id = COALESCE(?, run_id),
          updated_at = ?
      WHERE workspace_id = ?
        AND chat_id = ?
        AND telegram_message_id = ?
    `).run(
      input.runId ?? null,
      updatedAt,
      input.workspaceId,
      chatId,
      telegramMessageId,
    );
    if (previous.status !== 'uncertain') {
      this.createIntervention(
        'needs_operator_input',
        input.runId ?? previous.run_id ?? null,
        input.reason ?? `Telegram delivery for chat ${chatId} message ${telegramMessageId} became uncertain and needs operator confirmation.`,
      );
    }

    const updatedRow = this.databases.app
      .prepare('SELECT chat_id, telegram_message_id, status, sent_telegram_message_id, sent_at, run_id FROM telegram_reply_deliveries WHERE workspace_id = ? AND chat_id = ? AND telegram_message_id = ?')
      .get(input.workspaceId, chatId, telegramMessageId);
    return updatedRow ? mapTelegramDeliveryRow(updatedRow) : null;
  }

  markTelegramReplySent(
    chatId: string,
    telegramMessageId: number,
    input: { workspaceId: string; runId?: string | null; sentTelegramMessageId?: number | null },
  ): TelegramDeliveryState | null {
    const updatedAt = nowIso();
    this.databases.app.prepare(`
      UPDATE telegram_reply_deliveries
      SET status = 'sent',
          sent_telegram_message_id = COALESCE(?, sent_telegram_message_id),
          sent_at = COALESCE(sent_at, ?),
          run_id = COALESCE(?, run_id),
          updated_at = ?
      WHERE workspace_id = ?
        AND chat_id = ?
        AND telegram_message_id = ?
    `).run(
      input.sentTelegramMessageId ?? null,
      updatedAt,
      input.runId ?? null,
      updatedAt,
      input.workspaceId,
      chatId,
      telegramMessageId,
    );
    const row = this.databases.app
      .prepare('SELECT chat_id, telegram_message_id, status, sent_telegram_message_id, sent_at, run_id FROM telegram_reply_deliveries WHERE workspace_id = ? AND chat_id = ? AND telegram_message_id = ?')
      .get(input.workspaceId, chatId, telegramMessageId);
    return row ? mapTelegramDeliveryRow(row) : null;
  }

  // --- Telegram delivery resolution (Step 1) ---

  private mapFullDeliveryRow(row: unknown): TelegramDeliveryRecord {
    const parsed = TelegramReplyDeliveryFullRowSchema.parse(row);
    return TelegramDeliveryRecordSchema.parse({
      id: parsed.id,
      workspaceId: parsed.workspace_id,
      chatId: parsed.chat_id,
      telegramMessageId: parsed.telegram_message_id,
      messageIngressId: parsed.message_ingress_id,
      taskId: parsed.task_id,
      jobId: parsed.job_id,
      runId: parsed.run_id,
      status: parsed.status,
      sentAt: parsed.sent_at,
      sentTelegramMessageId: parsed.sent_telegram_message_id ?? null,
      createdAt: parsed.created_at,
      updatedAt: parsed.updated_at,
    });
  }

  private mapResolutionRow(row: unknown): TelegramDeliveryResolutionRecord {
    const parsed = TelegramDeliveryResolutionRowSchema.parse(row);
    return TelegramDeliveryResolutionRecordSchema.parse({
      id: parsed.id,
      deliveryId: parsed.delivery_id,
      workspaceId: parsed.workspace_id,
      action: parsed.action,
      interventionId: parsed.intervention_id,
      operatorNote: parsed.operator_note,
      sentTelegramMessageId: parsed.sent_telegram_message_id ?? null,
      previousStatus: parsed.previous_status,
      newStatus: parsed.new_status,
      createdAt: parsed.created_at,
    });
  }

  private mapSendAttemptRow(row: unknown): TelegramSendAttemptRecord {
    const parsed = TelegramSendAttemptRowSchema.parse(row);
    return TelegramSendAttemptRecordSchema.parse({
      id: parsed.id,
      deliveryId: parsed.delivery_id,
      workspaceId: parsed.workspace_id,
      attemptNumber: parsed.attempt_number,
      startedAt: parsed.started_at,
      finishedAt: parsed.finished_at,
      runId: parsed.run_id,
      contentHash: parsed.content_hash,
      outcome: parsed.outcome,
      sentTelegramMessageId: parsed.sent_telegram_message_id ?? null,
      errorSummary: parsed.error_summary,
      source: parsed.source,
      createdAt: parsed.created_at,
    });
  }

  listUncertainDeliveries(workspaceId?: string): TelegramDeliveryRecord[] {
    const sql = workspaceId
      ? "SELECT * FROM telegram_reply_deliveries WHERE status = 'uncertain' AND workspace_id = ?"
      : "SELECT * FROM telegram_reply_deliveries WHERE status = 'uncertain'";
    const rows = workspaceId
      ? this.databases.app.prepare(sql).all(workspaceId)
      : this.databases.app.prepare(sql).all();
    return rows.map((row) => this.mapFullDeliveryRow(row));
  }

  getDeliveryById(id: string): TelegramDeliveryRecord | null {
    const row = this.databases.app.prepare('SELECT * FROM telegram_reply_deliveries WHERE id = ?').get(id);
    return row ? this.mapFullDeliveryRow(row) : null;
  }

  resolveTelegramDelivery(deliveryId: string, input: TelegramDeliveryResolutionRequest): TelegramDeliveryResolutionRecord {
    const delivery = this.getDeliveryById(deliveryId);
    if (!delivery) {
      throw new RuntimeNotFoundError(`Delivery ${deliveryId} not found`);
    }
    if (delivery.status !== 'uncertain') {
      throw new RuntimeConflictError(`Delivery ${deliveryId} status is '${delivery.status}', expected 'uncertain'`);
    }

    const actionToStatus: Record<string, string> = {
      confirm_sent: 'sent',
      resend: 'pending',
      abandon: 'abandoned',
    };
    const newStatus = actionToStatus[input.action]!;
    const now = nowIso();

    // Find linked open intervention
    const interventionRow = this.databases.app
      .prepare("SELECT id FROM interventions WHERE run_id = ? AND code = 'needs_operator_input' AND status = 'open' ORDER BY created_at DESC LIMIT 1")
      .get(delivery.runId);
    const interventionId = interventionRow ? z.object({ id: z.string() }).parse(interventionRow).id : null;

    // Update delivery status
    const updateSql = newStatus === 'sent'
      ? `UPDATE telegram_reply_deliveries SET status = ?, sent_telegram_message_id = COALESCE(?, sent_telegram_message_id), sent_at = COALESCE(sent_at, ?), updated_at = ? WHERE id = ?`
      : 'UPDATE telegram_reply_deliveries SET status = ?, updated_at = ? WHERE id = ?';
    if (newStatus === 'sent') {
      this.databases.app.prepare(updateSql).run(newStatus, input.sentTelegramMessageId ?? null, now, now, deliveryId);
    } else {
      this.databases.app.prepare(updateSql).run(newStatus, now, deliveryId);
    }

    // Insert resolution record
    const resolutionId = randomUUID();
    this.databases.app.prepare(`
      INSERT INTO telegram_delivery_resolutions (id, delivery_id, workspace_id, action, intervention_id, operator_note, sent_telegram_message_id, previous_status, new_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      resolutionId,
      deliveryId,
      input.workspaceId,
      input.action,
      interventionId,
      input.operatorNote ?? null,
      input.sentTelegramMessageId ?? null,
      delivery.status,
      newStatus,
      now,
    );

    // Resolve linked intervention
    if (interventionId) {
      this.resolveIntervention(interventionId, input.operatorNote);
    }

    this.emit('telegram_delivery_resolved', { deliveryId, action: input.action, newStatus });

    const resolutionRow = this.databases.app
      .prepare('SELECT * FROM telegram_delivery_resolutions WHERE id = ?')
      .get(resolutionId);
    return this.mapResolutionRow(resolutionRow);
  }

  listDeliveryResolutions(deliveryId: string): TelegramDeliveryResolutionRecord[] {
    const rows = this.databases.app
      .prepare('SELECT * FROM telegram_delivery_resolutions WHERE delivery_id = ? ORDER BY created_at ASC')
      .all(deliveryId);
    return rows.map((row) => this.mapResolutionRow(row));
  }

  getResendableDeliveries(workspaceId: string): TelegramDeliveryRecord[] {
    const rows = this.databases.app
      .prepare("SELECT * FROM telegram_reply_deliveries WHERE status = 'pending' AND updated_at > created_at AND workspace_id = ?")
      .all(workspaceId);
    return rows.map((row) => this.mapFullDeliveryRow(row));
  }

  // --- Telegram send-attempt audit (Step 2) ---

  recordTelegramSendAttempt(input: {
    deliveryId?: string;
    chatId?: string;
    telegramMessageId?: number;
    workspaceId: string;
    startedAt: string;
    finishedAt?: string;
    runId?: string;
    contentHash: string;
    outcome: string;
    sentTelegramMessageId?: number;
    errorSummary?: string;
    source?: string;
  }): TelegramSendAttemptRecord {
    let deliveryId = input.deliveryId;
    if (!deliveryId && input.chatId !== undefined && input.telegramMessageId !== undefined) {
      const row = this.databases.app
        .prepare('SELECT id FROM telegram_reply_deliveries WHERE workspace_id = ? AND chat_id = ? AND telegram_message_id = ?')
        .get(input.workspaceId, input.chatId, input.telegramMessageId);
      if (row) {
        deliveryId = z.object({ id: z.string() }).parse(row).id;
      }
    }
    if (!deliveryId) {
      throw new RuntimeNotFoundError('Cannot resolve delivery for send-attempt recording');
    }
    const id = randomUUID();
    const now = nowIso();
    const countRow = this.databases.app
      .prepare('SELECT COALESCE(MAX(attempt_number), 0) as max_attempt FROM telegram_send_attempts WHERE delivery_id = ?')
      .get(deliveryId);
    const attemptNumber = z.object({ max_attempt: z.coerce.number().int() }).parse(countRow).max_attempt + 1;
    const errorSummary = input.errorSummary ? input.errorSummary.slice(0, 500) : null;

    this.databases.app.prepare(`
      INSERT INTO telegram_send_attempts (id, delivery_id, workspace_id, attempt_number, started_at, finished_at, run_id, content_hash, outcome, sent_telegram_message_id, error_summary, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      deliveryId,
      input.workspaceId,
      attemptNumber,
      input.startedAt,
      input.finishedAt ?? null,
      input.runId ?? null,
      input.contentHash,
      input.outcome,
      input.sentTelegramMessageId ?? null,
      errorSummary,
      input.source ?? 'relay',
      now,
    );

    const row = this.databases.app.prepare('SELECT * FROM telegram_send_attempts WHERE id = ?').get(id);
    return this.mapSendAttemptRow(row);
  }

  listTelegramSendAttempts(deliveryId: string): TelegramSendAttemptRecord[] {
    const rows = this.databases.app
      .prepare('SELECT * FROM telegram_send_attempts WHERE delivery_id = ? ORDER BY created_at ASC')
      .all(deliveryId);
    return rows.map((row) => this.mapSendAttemptRow(row));
  }

  // --- Run lifecycle (stays in facade -- tightly coupled to event loop) ---

  getRun(runId: string): RunRecord | null {
    const row = this.databases.app.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
    if (!row) return null;
    return mapRunRow(row);
  }

  listRuns(): RunRecord[] {
    return z.array(RunRowSchema)
      .parse(this.databases.app.prepare('SELECT * FROM runs ORDER BY started_at DESC').all())
      .map(mapRunRow);
  }

  listFailedRuns(): RunRecord[] {
    return z.array(RunRowSchema)
      .parse(this.databases.app.prepare("SELECT * FROM runs WHERE state IN ('failed_retryable', 'failed_final', 'abandoned') ORDER BY started_at DESC").all())
      .map(mapRunRow);
  }

  listRunEvents(runId: string): RunEventRecord[] {
    return z.array(RunEventRowSchema)
      .parse(this.databases.app.prepare('SELECT * FROM run_events WHERE run_id = ? ORDER BY created_at ASC').all(runId))
      .map(mapRunEventRow);
  }

  getRunReply(runId: string): RunReply | null {
    const run = this.getRun(runId);
    if (!run) return null;
    const receipt = this.getReceiptByRunId(runId);
    if (!receipt) return null;
    const reply = buildCanonicalRunReply(this.listRunEvents(runId), receipt, buildReceiptFallbackReplyText);
    if (!reply) return null;
    return RunReplySchema.parse({
      runId,
      terminalStatus: receipt.status,
      source: reply.source,
      text: reply.text,
    });
  }

  retryRun(runId: string): JobRecord | null {
    const run = this.getRun(runId);
    if (!run) return null;
    return this.enqueueTask(run.taskId);
  }

  async cancelRun(runId: string): Promise<RunRecord | null> {
    const run = this.getRun(runId);
    if (!run) return null;
    if (isTerminalRunState(run.state)) return run;
    const activeRun = this.activeRuns.get(runId);
    if (activeRun) {
      await activeRun.handle.cancel();
      return this.getRun(runId);
    }
    this.databases.app.prepare('UPDATE runs SET state = ?, finished_at = ? WHERE id = ?').run('cancelled', nowIso(), runId);
    this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('cancelled', nowIso(), run.jobId);
    this.databases.app.prepare('DELETE FROM job_leases WHERE job_id = ?').run(run.jobId);
    const receipt = this.writeRuntimeReceipt({
      runId,
      jobId: run.jobId,
      taskId: run.taskId,
      workspaceId: run.workspaceId,
      status: 'cancelled',
      summary: 'Run cancelled',
      details: '',
      usage: { provider: this.config.engine.kind, model: 'n/a', tokensIn: 0, tokensOut: 0, estimatedCostUsd: 0 },
    });
    this.emit('run_completed', receipt);
    return this.getRun(runId);
  }

  async waitForJobTerminalState(jobId: string, timeoutMs = 10_000): Promise<{ job: JobRecord; run: RunRecord | null; receipt: ReceiptRecord | null } | null> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const job = this.getJob(jobId);
      if (job && isTerminalJobStatus(job.status)) {
        const run = job.lastRunId ? this.getRun(job.lastRunId) : null;
        const receipt = run ? this.getReceiptByRunId(run.id) : null;
        return { job, run, receipt };
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  }

  async waitForTaskTerminalReceipt(taskId: string, timeoutMs = 10_000): Promise<ReceiptRecord | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const receipt = this.enrichReceipt(this.receiptManager.getReceiptByTaskId(taskId));
      if (receipt) return receipt;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  }

  // --- Scheduler (stays in facade -- tightly coupled to run lifecycle) ---

  startScheduler(): void {
    if (this.scheduler.running) return;
    this.scheduler.running = true;
    this.ensureConfiguredHeartbeatSchedules();
    this.scheduler.tickTimer = setInterval(() => void this.processSchedulerTick(), this.scheduler.tickIntervalMs);
    this.scheduler.leaseTimer = setInterval(() => void this.processLeaseSweep(), this.scheduler.leaseRefreshIntervalMs);
    void this.processSchedulerTick();
    void this.processLeaseSweep();
    this.log.info('scheduler started');
  }

  async runSchedulerCycle(): Promise<void> {
    await this.processSchedulerTick();
    await this.processLeaseSweep();
  }

  async stopScheduler(): Promise<void> {
    this.log.info('scheduler stopping', { activeRuns: this.activeRuns.size });
    if (this.scheduler.tickTimer) clearInterval(this.scheduler.tickTimer);
    if (this.scheduler.leaseTimer) clearInterval(this.scheduler.leaseTimer);
    this.scheduler.tickTimer = null;
    this.scheduler.leaseTimer = null;
    this.scheduler.running = false;

    if (this.activeRuns.size === 0) return;

    for (const activeRun of this.activeRuns.values()) {
      await activeRun.handle.cancel();
    }

    const waiters = Array.from(this.activeRuns.values()).map((activeRun) =>
      Promise.race([
        activeRun.handle.wait(),
        new Promise<EngineRunCompletion>((resolve) => {
          setTimeout(() => resolve({ engineSessionRef: null, usage: { provider: this.config.engine.kind, model: 'unknown', tokensIn: 0, tokensOut: 0, estimatedCostUsd: 0 }, failureClassification: 'cancelled' }), this.scheduler.shutdownGraceMs);
        }),
      ]).then(async () => {
        if (activeRun.finalizing) return;
        await this.abandonRun(activeRun.runId, 'Scheduler shutdown interrupted an in-flight run');
      }),
    );
    await Promise.all(waiters);
  }

  // --- Memory public API ---

  async searchMemory(query: MemorySearchQuery): Promise<MemorySearchResponse> {
    return this.memorySearch.search({
      query: query.query,
      ...(query.scope !== undefined && { scope: query.scope }),
      ...(query.workspaceId !== undefined && { workspaceId: query.workspaceId }),
      ...(query.projectId !== undefined && { projectId: query.projectId }),
      ...(query.includeGlobal !== undefined && { includeGlobal: query.includeGlobal }),
      ...(query.memoryTypes !== undefined && { memoryTypes: query.memoryTypes }),
      ...(query.layers !== undefined && { layers: query.layers }),
      ...(query.namespaceIds !== undefined && { namespaceIds: query.namespaceIds }),
      ...(query.tags !== undefined && { tags: query.tags }),
      ...(query.minConfidence !== undefined && { minConfidence: query.minConfidence }),
      ...(query.limit !== undefined && { limit: query.limit }),
      ...(query.includeContent !== undefined && { includeContent: query.includeContent }),
      ...(query.includeSuperseded !== undefined && { includeSuperseded: query.includeSuperseded }),
      ...(query.occurredAfter !== undefined && { occurredAfter: query.occurredAfter }),
      ...(query.occurredBefore !== undefined && { occurredBefore: query.occurredBefore }),
    });
  }

  async explainMemoryRecall(input: {
    query: string;
    memoryId: string;
    scope?: string;
    workspaceId?: string | null;
    projectId?: string | null;
    includeGlobal?: boolean;
    memoryTypes?: MemoryType[];
    layers?: Array<'artifact' | 'fact' | 'synthesis' | 'curated'>;
    namespaceIds?: string[];
    tags?: string[];
    includeSuperseded?: boolean;
  }, locationFilter?: { workspaceId: string | null; projectId: string | null; includeGlobal?: boolean }) {
    return this.memorySearch.explainRecall(input, locationFilter);
  }

  getMemoryContent(memoryId: string, locationFilter?: { workspaceId: string | null; projectId: string | null; includeGlobal?: boolean }): MemoryRecord | null {
    const record = this.memorySearch.getMemoryContent(memoryId, locationFilter);
    return record ? MemoryRecordSchema.parse(record) : null;
  }

  getMemoryAudit(): MemoryAuditResponse {
    return this.memoryLifecycle.getMemoryAudit();
  }

  checkMemoryIntegrity(options?: { fix?: boolean }): IntegrityReport {
    return this.memoryLifecycle.runIntegrityCheck(options);
  }

  insertMemory(input: MemoryInsertInput): MemoryRecord {
    const result = this.memoryLifecycle.insertMemory(input);
    const memory = this.getMemory(result.memoryId);
    if (!memory) {
      throw new Error(`Inserted memory ${result.memoryId} could not be loaded`);
    }
    return memory;
  }

  listMemories(options?: {
    type?: string;
    scope?: string;
    workspaceId?: string | null;
    projectId?: string | null;
    includeGlobal?: boolean;
    limit?: number;
  }): MemoryRecord[] {
    const conditions: string[] = ['archived_at IS NULL'];
    const params: unknown[] = [];
    const locationFilter = resolveMemoryLocationFilter({
      scope: options?.scope,
      workspaceId: options?.workspaceId,
      projectId: options?.projectId,
      includeGlobal: options?.includeGlobal,
    });
    const scopeAliasOnly = options?.scope !== undefined && options?.workspaceId === undefined && options?.projectId === undefined;
    if (options?.type) { conditions.push('memory_type = ?'); params.push(options.type); }
    if (scopeAliasOnly && options?.scope) {
      conditions.push('scope = ?');
      params.push(options.scope);
    } else if (locationFilter) {
      const location = buildLocationCondition('', {
        workspaceId: locationFilter.workspaceId,
        projectId: locationFilter.projectId,
        includeGlobal: locationFilter.includeGlobal,
      });
      if (location.sql) {
        conditions.push(location.sql);
        params.push(...location.params);
      }
    }
    const limit = options?.limit ?? 50;
    params.push(limit);
    const sql = `SELECT id, description, classification, source_type, content, confidence, scope, workspace_id, project_id, memory_type, dedup_key, last_reinforced_at, archived_at, created_at, source_run_id, source_timestamp FROM memories WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ?`;
    return z.array(MemoryListRowSchema)
      .parse(this.databases.memory.prepare(sql).all(...params))
      .map((row) =>
        MemoryRecordSchema.parse({
          id: row.id,
          description: row.description,
          classification: row.classification,
          sourceType: row.source_type,
          content: row.content,
          confidence: row.confidence,
          scope: row.scope,
          workspaceId: row.workspace_id,
          projectId: row.project_id,
          sourceRunId: row.source_run_id,
          sourceTimestamp: row.source_timestamp,
          memoryType: row.memory_type ?? 'episodic',
          dedupKey: row.dedup_key,
          lastReinforcedAt: row.last_reinforced_at,
          archivedAt: row.archived_at,
          createdAt: row.created_at,
        }),
      );
  }

  getMemory(memoryId: string, locationFilter?: { workspaceId: string | null; projectId: string | null; includeGlobal?: boolean }): MemoryRecord | null {
    return this.getMemoryContent(memoryId, locationFilter);
  }

  async budgetFitMemory(query: {
    query: string;
    scope?: string;
    workspaceId?: string | null;
    projectId?: string | null;
    includeGlobal?: boolean;
    memoryTypes?: Array<'episodic' | 'semantic' | 'procedural'>;
    minConfidence?: number;
    maxTokens: number;
    limit?: number;
  }) {
    return this.memorySearch.budgetFit(query);
  }

  describeMemory(memoryId: string, locationFilter?: { workspaceId: string | null; projectId: string | null; includeGlobal?: boolean }) {
    return this.memorySearch.describeMemory(memoryId, locationFilter);
  }

  expandMemory(memoryId: string, maxTokens?: number, locationFilter?: { workspaceId: string | null; projectId: string | null; includeGlobal?: boolean }) {
    const cap = maxTokens ?? this.config.memory.expandTokenCap;
    return this.memorySearch.expandMemory(memoryId, cap, locationFilter);
  }

  triggerMemoryMaintenance(): { decayed: number; archived: number; merged: number; deduped: number } {
    const decay = this.memoryLifecycle.runConfidenceDecay();
    const consolidation = this.memoryLifecycle.runConsolidation();
    return { decayed: decay.decayed, archived: decay.archived, merged: consolidation.merged, deduped: consolidation.deduped };
  }

  importMemory(input: {
    description: string;
    content: string;
    sourceType?: MemoryInsertInput['sourceType'];
    memoryType?: 'episodic' | 'semantic' | 'procedural';
    scope?: string;
    workspaceId?: string | null;
    projectId?: string | null;
    confidence?: number;
    classification?: 'secret' | 'sensitive' | 'internal' | 'embeddable';
  }): { memoryId: string; embedded: boolean } {
    const redactedContent = redactText(input.content, this.config.security.redactionPatterns).text;
    const redactedDesc = redactText(input.description, this.config.security.redactionPatterns).text;
    const scope = input.scope
      ?? (input.workspaceId !== undefined || input.projectId !== undefined
        ? formatMemoryScope({
            workspaceId: input.workspaceId ?? null,
            projectId: input.projectId ?? null,
          })
        : 'workspace');
    return this.memoryLifecycle.insertMemory({
      description: redactedDesc,
      content: redactedContent,
      sourceType: input.sourceType ?? 'curated_memory',
      ...(input.memoryType !== undefined && { memoryType: input.memoryType }),
      scope,
      ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      confidence: input.confidence ?? 0.8,
      classification: input.classification ?? 'embeddable',
    });
  }

  proposeMemoryPromotion(memoryId: string, targetPath: string) {
    return this.memoryLifecycle.proposePromotion(memoryId, targetPath);
  }

  executeMemoryPromotion(request: { memoryId: string; targetPath: string; diff: string; approved: boolean; promoted: boolean }) {
    return this.memoryLifecycle.executePromotion(request);
  }

  // --- Delegated: SecretStore ---

  setSecret(input: Parameters<SecretStore['setSecret']>[0]): SecretRefRecord {
    return this.secretStore.setSecret(input);
  }

  getSecretValue(id: string): string | null {
    return this.secretStore.getSecretValue(id);
  }

  hasSecret(id: string): boolean {
    return this.secretStore.hasSecret(id);
  }

  listSecrets(connectionId?: string): SecretRefRecord[] {
    return this.secretStore.listSecrets(connectionId);
  }

  deleteSecret(id: string): boolean {
    return this.secretStore.deleteSecret(id);
  }

  rotateSecret(id: string, newValue: string): SecretRefRecord | null {
    return this.secretStore.rotateSecret(id, newValue);
  }

  // --- Delegated: ApprovalService ---

  requestApproval(input: Parameters<ApprovalService['requestApproval']>[0]): ApprovalRecord {
    return this.approvalService.requestApproval(input);
  }

  requestActionApproval(input: ActionApprovalRequestInput): ApprovalRecord {
    const policy = this.actionPolicyEvaluator.evaluateAction(input);
    return this.approvalService.requestApproval({
      ...input,
      riskClass: policy.riskClass,
      standingApprovalEligible: policy.standingApprovalEligible,
      automationGrantEligible: policy.automationGrantEligible,
    });
  }

  resolveApproval(id: string, input: ApprovalResolveInput): ApprovalRecord {
    return this.approvalService.resolveApproval(id, input);
  }

  getApproval(id: string): ApprovalRecord | null {
    return this.approvalService.getApproval(id);
  }

  listApprovals(filter?: { scope?: string; status?: string; domain?: string; actionKind?: string; runId?: string; resolvedBy?: string }): ApprovalRecord[] {
    return this.approvalService.listApprovals(filter);
  }

  createStandingApproval(input: Parameters<ApprovalService['createStandingApproval']>[0]) {
    return this.approvalService.createStandingApproval(input);
  }

  listStandingApprovals(filter?: Parameters<ApprovalService['listStandingApprovals']>[0]) {
    return this.approvalService.listStandingApprovals(filter);
  }

  revokeStandingApproval(id: string, input: Parameters<ApprovalService['revokeStandingApproval']>[1]) {
    return this.approvalService.revokeStandingApproval(id, input);
  }

  createAutomationGrant(input: Parameters<ApprovalService['createAutomationGrant']>[0]) {
    return this.approvalService.createAutomationGrant(input);
  }

  listAutomationGrants(filter?: Parameters<ApprovalService['listAutomationGrants']>[0]) {
    return this.approvalService.listAutomationGrants(filter);
  }

  revokeAutomationGrant(id: string, input: Parameters<ApprovalService['revokeAutomationGrant']>[1]) {
    return this.approvalService.revokeAutomationGrant(id, input);
  }

  // --- Delegated: VaultManager ---

  createVault(input: { domain: DomainKind; name: string; kind?: 'capability' | 'restricted' }): VaultRecord {
    return this.vaultManager.createVault(input);
  }

  openVault(vaultId: string, approvalId: string): VaultHandle | null {
    const approval = this.approvalService.getApproval(approvalId);
    if (!approval || approval.status !== 'approved') {
      this.log.warn('vault open denied: approval not found or not approved', { vaultId, approvalId });
      return null;
    }
    return this.vaultManager.openVault(vaultId, approvalId);
  }

  closeVault(vaultId: string): boolean {
    return this.vaultManager.closeVault(vaultId);
  }

  sealVault(vaultId: string): boolean {
    return this.vaultManager.sealVault(vaultId);
  }

  listVaults(domain?: DomainKind): VaultRecord[] {
    return this.vaultManager.listVaults(domain);
  }

  getVault(vaultId: string): VaultRecord | null {
    return this.vaultManager.getVault(vaultId);
  }

  // --- Delegated: ContextReleaseService ---

  recordContextRelease(input: Parameters<ContextReleaseService['recordRelease']>[0]): ContextReleaseDecision {
    return this.contextReleaseService.recordRelease(input);
  }

  listContextReleases(runId: string): ContextReleaseDecision[] {
    return this.contextReleaseService.listReleasesForRun(runId);
  }

  summarizeRunReleases(runId: string): {
    totalReleases: number;
    totalTokenEstimate: number;
    byDomain: Record<string, { count: number; tokens: number }>;
  } {
    return this.contextReleaseService.summarizeRunReleases(runId);
  }

  previewContextRelease(input: { domain: DomainKind; sourceRef: string }): ContextReleasePreview {
    return this.contextReleaseService.previewRelease(input);
  }

  // --- Policy: domain policy + connections ---

  getSecurityPolicy(): SecurityPolicyResponse {
    const domainPolicies = Object.values(DOMAIN_POLICY_DEFAULTS);
    return {
      domainPolicies,
      approvalRules: this.actionPolicyEvaluator.listRules(),
      defaultRiskClass: this.actionPolicyEvaluator.getDefaultRiskClass(),
      actionDefaults: this.actionPolicyEvaluator.listActionDefaults(),
    };
  }

  private buildConnectionRemediation(connection: ConnectionRecord, input: {
    authState: ConnectionHealthSummary['authState'];
    healthStatus: ConnectionHealthSummary['status'];
    secretStatus: NonNullable<ConnectionRecord['policy']>['secretStatus'];
    diagnostics: NonNullable<ConnectionRecord['policy']>['diagnostics'];
  }): ConnectionHealthSummary['remediation'] {
    const now = nowIso();
    if (input.authState === 'invalid_scopes') {
      return {
        action: 'scope_fix',
        message: 'Reconnect this provider and approve the required scopes.',
        updatedAt: now,
      };
    }
    if (['expired', 'revoked', 'stale'].includes(input.authState)) {
      return {
        action: 'reauthorize',
        message: 'Reauthorize this provider to refresh credentials.',
        updatedAt: now,
      };
    }
    if (input.secretStatus === 'missing' || input.secretStatus === 'stale') {
      const oauthProvider = ['gmail', 'google_calendar', 'github'].includes(connection.providerKind);
      return {
        action: oauthProvider ? 'reconnect' : 'secret_fix',
        message: oauthProvider
          ? 'Reconnect this provider to restore a usable secret.'
          : 'Update the configured secret for this connection.',
        updatedAt: now,
      };
    }
    if (input.healthStatus === 'error' || input.healthStatus === 'degraded') {
      return {
        action: ['gmail', 'google_calendar', 'github'].includes(connection.providerKind) ? 'reconnect' : 'secret_fix',
        message: input.diagnostics[0]?.message ?? 'Connection needs operator remediation before it can recover.',
        updatedAt: now,
      };
    }
    return null;
  }

  private buildConnectionPolicySummary(connection: ConnectionRecord): {
    policy: NonNullable<ConnectionRecord['policy']>;
    health: ConnectionHealthSummary;
    sync: ConnectionSyncSummary;
  } {
    const diagnostics: NonNullable<ConnectionRecord['policy']>['diagnostics'] = [];
    const storedHealth = ConnectionHealthSummarySchema.parse(connection.health ?? {});
    const storedSync = ConnectionSyncSummarySchema.parse(connection.sync ?? {});

    if (!isProviderAllowedForDomain(connection.domain, connection.providerKind)) {
      diagnostics.push({
        code: 'provider_domain_mismatch',
        severity: 'error',
        message: `Provider ${connection.providerKind} is not allowed for ${connection.domain} connections.`,
      });
    }

    let secretStatus: NonNullable<ConnectionRecord['policy']>['secretStatus'] = 'not_required';
    if (providerRequiresSecret(connection.providerKind)) {
      if (!connection.secretRefId) {
        secretStatus = 'missing';
        diagnostics.push({
          code: 'secret_required',
          severity: 'error',
          message: `Provider ${connection.providerKind} requires a configured secret reference.`,
        });
      } else if (!this.secretStore.hasSecret(connection.secretRefId)) {
        secretStatus = 'stale';
        diagnostics.push({
          code: 'secret_unavailable',
          severity: 'error',
          message: `Referenced secret ${connection.secretRefId} is missing or unavailable.`,
        });
      } else {
        secretStatus = 'configured';
      }
    } else if (connection.secretRefId) {
      secretStatus = this.secretStore.hasSecret(connection.secretRefId) ? 'configured' : 'stale';
      if (secretStatus === 'stale') {
        diagnostics.push({
          code: 'secret_unavailable',
          severity: 'error',
          message: `Referenced secret ${connection.secretRefId} is missing or unavailable.`,
        });
      }
    }

    if (!connection.enabled) {
      diagnostics.push({
        code: 'connection_disabled',
        severity: 'warn',
        message: 'Connection is disabled and cannot be used until re-enabled.',
      });
    }

    let authState: ConnectionHealthSummary['authState'] = providerRequiresSecret(connection.providerKind) ? 'configured' : 'not_required';
    if (providerRequiresSecret(connection.providerKind)) {
      if (!connection.secretRefId) {
        authState = 'missing';
      } else if (!this.secretStore.hasSecret(connection.secretRefId)) {
        authState = 'stale';
      } else {
        const secret = parseStoredOAuthSecret(this.secretStore.getSecretValue(connection.secretRefId));
        if (secret?.expiresAt && isExpiredIso(secret.expiresAt) && !canRefreshStoredOAuthSecret(connection.providerKind, secret, this.config)) {
          authState = 'expired';
        } else if (storedHealth.authState === 'revoked') {
          authState = 'revoked';
        } else if (storedHealth.authState === 'invalid_scopes') {
          authState = 'invalid_scopes';
        }
      }
    }

    const mergedHealthDiagnostics = [...storedHealth.diagnostics, ...diagnostics];
    const healthStatus: ConnectionHealthSummary['status'] =
      ['expired', 'revoked', 'invalid_scopes'].includes(authState)
        ? 'reauth_required'
        : authState === 'missing' || authState === 'stale'
          ? 'error'
          : storedHealth.lastError
            ? 'degraded'
            : 'healthy';
    const remediation = this.buildConnectionRemediation(connection, {
      authState,
      healthStatus,
      secretStatus,
      diagnostics: mergedHealthDiagnostics,
    });

    return {
      policy: {
      status: !connection.enabled
        ? 'disabled'
        : diagnostics.some((diagnostic) => diagnostic.severity === 'error')
          ? 'incomplete'
          : 'ready',
      secretStatus,
      mutatingRequiresApproval: connection.mode === 'read_write',
      diagnostics,
      },
      health: {
        status: healthStatus,
        authState,
        checkedAt: storedHealth.checkedAt,
        lastError: storedHealth.lastError,
        diagnostics: mergedHealthDiagnostics,
        remediation,
      },
      sync: storedSync,
    };
  }

  private withConnectionPolicy(connection: ConnectionRecord): ConnectionRecord {
    const summary = this.buildConnectionPolicySummary(connection);
    return {
      ...connection,
      policy: summary.policy,
      health: summary.health,
      sync: summary.sync,
    };
  }

  private getConnectionRow(id: string): ConnectionRecord | null {
    const row = this.databases.app.prepare('SELECT * FROM connections WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? mapConnectionRow(row) : null;
  }

  private updateConnectionRollups(input: {
    connectionId: string;
    health?: Partial<ConnectionHealthSummary> | undefined;
    sync?: Partial<ConnectionSyncSummary> | undefined;
  }): ConnectionRecord | null {
    const existing = this.getConnectionRow(input.connectionId);
    if (!existing) return null;

    const nextHealth = ConnectionHealthSummarySchema.parse({
      ...(existing.health ?? {}),
      ...(input.health ?? {}),
    });
    const nextSync = ConnectionSyncSummarySchema.parse({
      ...(existing.sync ?? {}),
      ...(input.sync ?? {}),
    });

    const lastSyncAt = nextSync.lastSuccessAt ?? existing.lastSyncAt;
    const lastSyncStatus = nextSync.status === 'idle' ? existing.lastSyncStatus : nextSync.status;

    this.databases.app.prepare(
      `UPDATE connections
       SET health_json = ?, sync_json = ?, last_sync_at = ?, last_sync_status = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      JSON.stringify(nextHealth),
      JSON.stringify(nextSync),
      lastSyncAt,
      lastSyncStatus === 'idle' ? null : lastSyncStatus,
      nowIso(),
      input.connectionId,
    );
    return this.getConnection(input.connectionId);
  }

  private getOAuthRedirectUri(): string {
    return `http://${this.config.security.bindHost}:${this.config.security.bindPort}/v1/connections/oauth/callback`;
  }

  private getConnectionOAuthSecret(connection: ConnectionRecord): StoredOAuthSecret | null {
    if (!connection.secretRefId) return null;
    return parseStoredOAuthSecret(this.secretStore.getSecretValue(connection.secretRefId));
  }

  private storeOAuthSecret(connectionId: string | null, providerKind: ConnectionRecord['providerKind'], payload: OAuthTokenPayload, existingSecretRefId?: string | null): SecretRefRecord {
    const serialized = serializeStoredOAuthSecret(payload);
    if (existingSecretRefId) {
      const rotated = this.secretStore.rotateSecret(existingSecretRefId, serialized);
      if (rotated) {
        return rotated;
      }
    }
    return this.secretStore.setSecret({
      provider: 'keychain',
      key: `${providerKind}-oauth`,
      value: serialized,
      ...(connectionId ? { connectionId } : {}),
      description: `${providerKind} OAuth credentials`,
      ...(payload.expiresAt ? { expiresAt: payload.expiresAt } : {}),
    });
  }

  private async resolveEmailAdapterForConnection(connectionId: string): Promise<{
    adapter: EmailProviderAdapter;
    account: { id: string; connectionId: string; emailAddress: string };
  } | null> {
    let connection: ConnectionRecord;
    try {
      connection = this.requireConnectionForOperation({
        connectionId,
        purpose: 'email_adapter_resolve',
        expectedDomain: 'email',
        allowedProviderKinds: ['gmail', 'proton'],
        requireSecret: false,
      });
    } catch {
      return null;
    }

    const dbPath = `${this.databases.paths.capabilityStoresDir}/email.db`;
    const readDb = new BetterSqlite3(dbPath, { readonly: true });
    try {
      const svc = new EmailService(readDb as unknown as CapabilityContext['appDb']);
      const account = svc.getAccountByConnection(connectionId);
      if (!account) return null;

      let adapter: EmailProviderAdapter;
      if (connection.providerKind === 'gmail') {
        const secret = this.getConnectionOAuthSecret(connection);
        if (!secret) return null;
        adapter = new GmailAdapter({
          accessToken: secret.accessToken,
          refreshToken: secret.refreshToken,
          clientId: this.config.providerAuth.google.clientId,
          clientSecret: this.config.providerAuth.google.clientSecret,
        });
      } else {
        if (this.requireConnectionForOperation({
          connectionId,
          purpose: 'email_adapter_resolve',
          expectedDomain: 'email',
          allowedProviderKinds: ['proton'],
          requireSecret: true,
        }).policy?.secretStatus !== 'configured') {
          return null;
        }
        const password = this.secretStore.getSecretValue(connection.secretRefId!);
        if (!password) return null;
        adapter = createAdapter('proton', { username: account.emailAddress, password });
      }

      return { adapter, account: { id: account.id, connectionId, emailAddress: account.emailAddress } };
    } finally {
      readDb.close();
    }
  }

  private async resolveCalendarAdapterForConnection(connectionId: string): Promise<{
    adapter: GoogleCalendarAdapter;
    account: { id: string; connectionId: string; calendarEmail: string };
  } | null> {
    try {
      this.requireConnectionForOperation({
        connectionId,
        purpose: 'calendar_adapter_resolve',
        expectedDomain: 'calendar',
        allowedProviderKinds: ['google_calendar'],
        requireSecret: true,
      });
    } catch {
      return null;
    }

    const dbPath = `${this.databases.paths.capabilityStoresDir}/calendar.db`;
    const readDb = new BetterSqlite3(dbPath, { readonly: true });
    try {
      const svc = new CalendarService(readDb as unknown as CapabilityContext['appDb']);
      const account = svc.getAccountByConnection(connectionId);
      if (!account) return null;
      const connection = this.getConnection(connectionId);
      if (!connection) return null;
      const secret = this.getConnectionOAuthSecret(connection);
      if (!secret) return null;
      const adapter = new GoogleCalendarAdapter({
        accessToken: secret.accessToken,
        refreshToken: secret.refreshToken,
        clientId: this.config.providerAuth.google.clientId,
        clientSecret: this.config.providerAuth.google.clientSecret,
      });
      return { adapter, account: { id: account.id, connectionId, calendarEmail: account.calendarEmail } };
    } finally {
      readDb.close();
    }
  }

  private async resolveGithubAdapterForConnection(connectionId: string): Promise<{
    adapter: GithubApiAdapter;
    account: { id: string; connectionId: string; githubUsername: string };
  } | null> {
    try {
      this.requireConnectionForOperation({
        connectionId,
        purpose: 'github_adapter_resolve',
        expectedDomain: 'github',
        allowedProviderKinds: ['github'],
        requireSecret: true,
      });
    } catch {
      return null;
    }

    const dbPath = `${this.databases.paths.capabilityStoresDir}/github.db`;
    const readDb = new BetterSqlite3(dbPath, { readonly: true });
    try {
      const svc = new GithubService(readDb as unknown as CapabilityContext['appDb']);
      const account = svc.getAccountByConnection(connectionId);
      if (!account) return null;
      const connection = this.getConnection(connectionId);
      if (!connection) return null;
      const secret = this.getConnectionOAuthSecret(connection);
      if (!secret) return null;
      const adapter = new GithubApiAdapter({ accessToken: secret.accessToken });
      return { adapter, account: { id: account.id, connectionId, githubUsername: account.githubUsername } };
    } finally {
      readDb.close();
    }
  }

  private validateConnectionMutation(input: {
    domain: DomainKind;
    providerKind: ConnectionRecord['providerKind'];
    secretRefId: string | null;
  }): void {
    if (!isProviderAllowedForDomain(input.domain, input.providerKind)) {
      throw new RuntimeValidationError(`Provider ${input.providerKind} is not allowed for ${input.domain} connections`);
    }
    if (input.secretRefId && !this.secretStore.hasSecret(input.secretRefId)) {
      throw new RuntimeValidationError(`Secret reference ${input.secretRefId} is missing or unavailable`);
    }
  }

  private denyConnectionOperation(input: {
    reasonCode: string;
    message: string;
    connectionId: string;
    purpose: string;
    domain?: string | undefined;
    providerKind?: string | undefined;
    runId?: string | undefined;
    jobId?: string | undefined;
    taskId?: string | undefined;
  }): never {
    const details = {
      connectionId: input.connectionId,
      purpose: input.purpose,
      reasonCode: input.reasonCode,
      ...(input.domain !== undefined ? { domain: input.domain } : {}),
      ...(input.providerKind !== undefined ? { providerKind: input.providerKind } : {}),
      ...(input.runId !== undefined ? { runId: input.runId } : {}),
      ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
      ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
    };
    this.log.warn('connection policy denied', details);
    this.recordSecurityAudit({
      code: 'connection_policy_denied',
      severity: 'warn',
      message: input.message,
      component: 'runtime-core',
      timestamp: nowIso(),
      details: Object.fromEntries(Object.entries(details).map(([key, value]) => [key, String(value)])),
    });
    throw new RuntimeValidationError(input.message);
  }

  private requireConnectionForOperation(input: {
    connectionId: string;
    purpose: string;
    expectedDomain: DomainKind;
    allowedProviderKinds?: Array<ConnectionRecord['providerKind']>;
    requireSecret?: boolean | undefined;
    runId?: string | undefined;
    jobId?: string | undefined;
    taskId?: string | undefined;
  }): ConnectionRecord {
    const connection = this.getConnection(input.connectionId);
    if (!connection) {
      return this.denyConnectionOperation({
        connectionId: input.connectionId,
        purpose: input.purpose,
        reasonCode: 'connection_not_found',
        message: `Connection ${input.connectionId} not found`,
        domain: input.expectedDomain,
        ...(input.runId !== undefined ? { runId: input.runId } : {}),
        ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
        ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
      });
    }
    if (connection.domain !== input.expectedDomain) {
      return this.denyConnectionOperation({
        connectionId: connection.id,
        purpose: input.purpose,
        reasonCode: 'wrong_domain',
        message: `Connection ${connection.id} is not a ${input.expectedDomain} connection`,
        domain: connection.domain,
        providerKind: connection.providerKind,
        ...(input.runId !== undefined ? { runId: input.runId } : {}),
        ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
        ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
      });
    }
    if (input.allowedProviderKinds && !input.allowedProviderKinds.includes(connection.providerKind)) {
      return this.denyConnectionOperation({
        connectionId: connection.id,
        purpose: input.purpose,
        reasonCode: 'wrong_provider',
        message: `Provider ${connection.providerKind} is not allowed for ${input.purpose}`,
        domain: connection.domain,
        providerKind: connection.providerKind,
        ...(input.runId !== undefined ? { runId: input.runId } : {}),
        ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
        ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
      });
    }
    if (connection.policy?.status === 'disabled') {
      return this.denyConnectionOperation({
        connectionId: connection.id,
        purpose: input.purpose,
        reasonCode: 'connection_disabled',
        message: `Connection ${connection.id} is disabled`,
        domain: connection.domain,
        providerKind: connection.providerKind,
        ...(input.runId !== undefined ? { runId: input.runId } : {}),
        ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
        ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
      });
    }
    const requiresSecret = input.requireSecret ?? providerRequiresSecret(connection.providerKind);
    if (requiresSecret && connection.policy?.secretStatus !== 'configured') {
      return this.denyConnectionOperation({
        connectionId: connection.id,
        purpose: input.purpose,
        reasonCode: connection.policy?.secretStatus === 'stale' ? 'secret_unavailable' : 'secret_required',
        message: `Connection ${connection.id} does not have a usable secret reference`,
        domain: connection.domain,
        providerKind: connection.providerKind,
        ...(input.runId !== undefined ? { runId: input.runId } : {}),
        ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
        ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
      });
    }
    if (['expired', 'revoked', 'invalid_scopes'].includes(connection.health?.authState ?? '')) {
      return this.denyConnectionOperation({
        connectionId: connection.id,
        purpose: input.purpose,
        reasonCode: 'reauth_required',
        message: `Connection ${connection.id} requires credential reauthorization`,
        domain: connection.domain,
        providerKind: connection.providerKind,
        ...(input.runId !== undefined ? { runId: input.runId } : {}),
        ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
        ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
      });
    }
    return connection;
  }

  private requireEmailAccountForOperation(
    service: EmailService,
    accountId: string,
    purpose: string,
  ): { account: EmailAccountRecord; connection: ConnectionRecord } {
    const account = service.getAccount(accountId);
    if (!account) {
      throw new RuntimeValidationError(`Email account ${accountId} not found`);
    }
    const connection = this.requireConnectionForOperation({
      connectionId: account.connectionId,
      purpose,
      expectedDomain: 'email',
      allowedProviderKinds: ['gmail', 'proton'],
      requireSecret: false,
    });
    return { account, connection };
  }

  private requireGithubAccountForOperation(
    service: GithubService,
    accountId: string,
    purpose: string,
  ): { account: GithubAccountRecord; connection: ConnectionRecord } {
    const account = service.getAccount(accountId);
    if (!account) {
      throw new RuntimeValidationError(`GitHub account ${accountId} not found`);
    }
    const connection = this.requireConnectionForOperation({
      connectionId: account.connectionId,
      purpose,
      expectedDomain: 'github',
      allowedProviderKinds: ['github'],
      requireSecret: false,
    });
    return { account, connection };
  }

  private requireCalendarAccountForOperation(
    service: CalendarService,
    accountId: string,
    purpose: string,
  ): { account: CalendarAccountRecord; connection: ConnectionRecord } {
    const account = service.getAccount(accountId);
    if (!account) {
      throw new RuntimeValidationError(`Calendar account ${accountId} not found`);
    }
    const connection = this.requireConnectionForOperation({
      connectionId: account.connectionId,
      purpose,
      expectedDomain: 'calendar',
      allowedProviderKinds: ['google_calendar'],
      requireSecret: false,
    });
    return { account, connection };
  }

  private invalidateEmailFacade(): void {
    if (this.emailReadDb) {
      this.emailReadDb.close();
      this.emailReadDb = null;
    }
    this.emailServiceCache = null;
    this.emailSearchCache = null;
  }

  private invalidateCalendarFacade(): void {
    if (this.calendarReadDb) {
      this.calendarReadDb.close();
      this.calendarReadDb = null;
    }
    this.calendarServiceCache = null;
    this.calendarSearchCache = null;
  }

  private invalidateGithubFacade(): void {
    if (this.githubReadDb) {
      this.githubReadDb.close();
      this.githubReadDb = null;
    }
    this.githubServiceCache = null;
    this.githubSearchCache = null;
  }

  private classifyConnectionFailure(message: string): Pick<ConnectionHealthSummary, 'status' | 'authState'> {
    const lowered = message.toLowerCase();
    if (
      lowered.includes('invalid scope')
      || lowered.includes('insufficient')
      || lowered.includes('scope')
    ) {
      return { status: 'reauth_required', authState: 'invalid_scopes' };
    }
    if (lowered.includes('revoked')) {
      return { status: 'reauth_required', authState: 'revoked' };
    }
    if (
      lowered.includes('401')
      || lowered.includes('unauthorized')
      || lowered.includes('invalid_grant')
      || lowered.includes('expired')
      || lowered.includes('token refresh failed')
    ) {
      return { status: 'reauth_required', authState: 'expired' };
    }
    return { status: 'error', authState: 'configured' };
  }

  private requireReadWriteConnection(connection: ConnectionRecord, purpose: string): void {
    if (connection.mode !== 'read_write') {
      this.denyConnectionOperation({
        connectionId: connection.id,
        purpose,
        reasonCode: 'connection_read_only',
        message: `Connection ${connection.id} is read-only and cannot perform ${purpose}`,
        domain: connection.domain,
        providerKind: connection.providerKind,
      });
    }
  }

  private materializeConnectionResourceRules(
    rules: Array<Pick<ConnectionResourceRule, 'resourceType' | 'resourceId' | 'displayName' | 'writeAllowed'>>,
    timestamp = nowIso(),
  ): ConnectionRecord['resourceRules'] {
    return rules.map((rule) => ({
      resourceType: rule.resourceType,
      resourceId: rule.resourceId,
      displayName: rule.displayName,
      writeAllowed: rule.writeAllowed,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
  }

  private connectionAllowsResourceWrite(connection: ConnectionRecord, resourceType: string, resourceId: string): boolean {
    const typedRule = connection.resourceRules.find((rule) =>
      rule.writeAllowed
      && (rule.resourceType === resourceType || rule.resourceType === 'resource')
      && matchesConnectionResourceId(rule.resourceId, resourceId),
    );
    if (typedRule) {
      return true;
    }
    return connection.allowedResources.some((allowed) => matchesConnectionResourceId(allowed, resourceId));
  }

  private requireAllowlistedConnectionResource(connection: ConnectionRecord, purpose: string, resourceType: string, resourceId: string): void {
    if (!this.connectionAllowsResourceWrite(connection, resourceType, resourceId)) {
      this.denyConnectionOperation({
        connectionId: connection.id,
        purpose,
        reasonCode: 'resource_not_allowlisted',
        message: `Connection ${connection.id} is not allowlisted for ${resourceType} ${resourceId}`,
        domain: connection.domain,
        providerKind: connection.providerKind,
      });
    }
  }

  private requireApprovedExternalWrite(input: ActionApprovalRequestInput): ApprovalRecord {
    const approval = this.requestActionApproval(input);
    if (approval.status === 'approved') {
      return approval;
    }
    if (approval.status === 'denied') {
      throw new RuntimeValidationError(
        `External write denied for ${input.resourceType} ${input.resourceId}. Approval ${approval.id} is denied.`,
      );
    }
    throw new RuntimeConflictError(
      `External write requires approval for ${input.resourceType} ${input.resourceId}. Approval ${approval.id} is ${approval.status}.`,
    );
  }

  private requireTodoAccountForOperation(
    service: TodoService,
    accountId: string,
    purpose: string,
    options: { requireSecret?: boolean | undefined } = {},
  ): { account: TodoAccountRecord; connection: ConnectionRecord | null } {
    const account = service.getAccount(accountId);
    if (!account) {
      throw new RuntimeValidationError(`Todo account ${accountId} not found`);
    }
    if (!account.connectionId) {
      return { account, connection: null };
    }
    const allowedProviderKinds: Array<ConnectionRecord['providerKind']> =
      account.providerKind === 'todoist' ? ['todoist'] : ['local'];
    const connection = this.requireConnectionForOperation({
      connectionId: account.connectionId,
      purpose,
      expectedDomain: 'todos',
      allowedProviderKinds,
      requireSecret: options.requireSecret ?? account.providerKind === 'todoist',
    });
    return { account, connection };
  }

  listConnections(domain?: string): ConnectionRecord[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (domain) { conditions.push('domain = ?'); params.push(domain); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.databases.app.prepare(`SELECT * FROM connections ${where} ORDER BY created_at DESC`).all(...params) as Record<string, unknown>[];
    return rows.map((row) => this.withConnectionPolicy(mapConnectionRow(row)));
  }

  createConnection(input: ConnectionCreateInput): ConnectionRecord {
    this.validateConnectionMutation({
      domain: input.domain,
      providerKind: input.providerKind,
      secretRefId: input.secretRefId ?? null,
    });
    const id = randomUUID();
    const now = nowIso();
    const resourceRules = this.materializeConnectionResourceRules(input.resourceRules ?? [], now);
    this.databases.app
      .prepare(
        `INSERT INTO connections (
           id, domain, provider_kind, label, mode, secret_ref_id, enabled, sync_interval_seconds,
           allowed_scopes, allowed_resources, resource_rules_json, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.domain,
        input.providerKind,
        input.label,
        input.mode,
        input.secretRefId ?? null,
        input.syncIntervalSeconds,
        JSON.stringify(input.allowedScopes),
        JSON.stringify(input.allowedResources),
        JSON.stringify(resourceRules),
        now,
        now,
      );
    return this.getConnection(id)!;
  }

  updateConnection(id: string, input: ConnectionUpdateInput): ConnectionRecord | null {
    const existing = this.getConnectionRow(id);
    if (!existing) return null;
    this.validateConnectionMutation({
      domain: existing.domain,
      providerKind: existing.providerKind,
      secretRefId: input.secretRefId !== undefined ? input.secretRefId : existing.secretRefId,
    });
    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.label !== undefined) { sets.push('label = ?'); params.push(input.label); }
    if (input.mode !== undefined) { sets.push('mode = ?'); params.push(input.mode); }
    if (input.secretRefId !== undefined) { sets.push('secret_ref_id = ?'); params.push(input.secretRefId); }
    if (input.enabled !== undefined) { sets.push('enabled = ?'); params.push(input.enabled ? 1 : 0); }
    if (input.syncIntervalSeconds !== undefined) { sets.push('sync_interval_seconds = ?'); params.push(input.syncIntervalSeconds); }
    if (input.allowedScopes !== undefined) { sets.push('allowed_scopes = ?'); params.push(JSON.stringify(input.allowedScopes)); }
    if (input.allowedResources !== undefined) { sets.push('allowed_resources = ?'); params.push(JSON.stringify(input.allowedResources)); }
    if (input.resourceRules !== undefined) {
      sets.push('resource_rules_json = ?');
      params.push(JSON.stringify(this.materializeConnectionResourceRules(input.resourceRules)));
    }
    if (sets.length === 0) return this.withConnectionPolicy(existing);
    sets.push('updated_at = ?');
    params.push(nowIso());
    params.push(id);
    this.databases.app.prepare(`UPDATE connections SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.getConnection(id);
  }

  deleteConnection(id: string): boolean {
    const result = this.databases.app.prepare('DELETE FROM connections WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // --- Connection resource-rule CRUD ---

  addConnectionResourceRule(connectionId: string, rule: { resourceType: string; resourceId: string; displayName: string; writeAllowed?: boolean }): ConnectionRecord | null {
    const existing = this.getConnectionRow(connectionId);
    if (!existing) return null;
    const now = nowIso();
    const rules = [...existing.resourceRules];
    const idx = rules.findIndex((r) => r.resourceType === rule.resourceType && r.resourceId === rule.resourceId);
    const newRule: ConnectionResourceRule = {
      resourceType: rule.resourceType as ConnectionResourceRule['resourceType'],
      resourceId: rule.resourceId,
      displayName: rule.displayName,
      writeAllowed: rule.writeAllowed ?? false,
      createdAt: idx >= 0 ? rules[idx]!.createdAt : now,
      updatedAt: now,
    };
    if (idx >= 0) { rules[idx] = newRule; } else { rules.push(newRule); }
    this.databases.app.prepare('UPDATE connections SET resource_rules_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(rules), now, connectionId);
    return this.getConnection(connectionId);
  }

  removeConnectionResourceRule(connectionId: string, resourceType: string, resourceId: string): ConnectionRecord | null {
    const existing = this.getConnectionRow(connectionId);
    if (!existing) return null;
    const rules = existing.resourceRules.filter(
      (r) => !(r.resourceType === resourceType && r.resourceId === resourceId),
    );
    const now = nowIso();
    this.databases.app.prepare('UPDATE connections SET resource_rules_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(rules), now, connectionId);
    return this.getConnection(connectionId);
  }

  listConnectionResourceRules(connectionId: string): ConnectionResourceRule[] {
    const connection = this.getConnectionRow(connectionId);
    return connection?.resourceRules ?? [];
  }

  // --- Connection diagnostics & reconnect ---

  getConnectionDiagnostics(connectionId: string): ConnectionDiagnosticsResponse | null {
    const connection = this.getConnection(connectionId);
    if (!connection) return null;

    const health = connection.health ?? { status: 'unknown', authState: 'not_required', checkedAt: null, lastError: null, diagnostics: [], remediation: null };
    const sync = connection.sync ?? { lastAttemptAt: null, lastSuccessAt: null, status: 'idle', cursorKind: 'none', cursorPresent: false, lagSummary: '' };
    const policy = connection.policy ?? { status: 'ready', secretStatus: 'not_required', mutatingRequiresApproval: false, diagnostics: [] };
    const remediation = health.remediation ?? null;

    const summaryParts: string[] = [];
    summaryParts.push(`${connection.label} (${connection.providerKind})`);
    summaryParts.push(`Health: ${health.status}`);
    if (sync.lastSuccessAt) summaryParts.push(`Last sync: ${sync.lastSuccessAt}`);
    else summaryParts.push('Never synced');
    if (health.lastError) summaryParts.push(`Error: ${health.lastError}`);
    if (remediation) summaryParts.push(`Remediation: ${remediation.action} — ${remediation.message}`);

    return {
      connectionId,
      label: connection.label,
      providerKind: connection.providerKind,
      domain: connection.domain,
      enabled: connection.enabled,
      health,
      sync,
      policy,
      remediation,
      humanSummary: summaryParts.join('. '),
    };
  }

  reconnectConnection(connectionId: string, action: ConnectionRemediationAction): ConnectionRecord | null {
    const connection = this.getConnectionRow(connectionId);
    if (!connection) return null;

    const now = nowIso();
    switch (action) {
      case 'reauthorize':
      case 'secret_fix':
        if (connection.secretRefId) {
          this.secretStore.deleteSecret(connection.secretRefId);
        }
        this.updateConnectionRollups({
          connectionId,
          health: {
            status: 'degraded',
            authState: 'missing',
            checkedAt: now,
            lastError: null,
            diagnostics: [{ code: `${action}_pending`, severity: 'warn', message: `${action} initiated — re-authenticate to restore` }],
            remediation: { action, message: `${action} initiated`, updatedAt: now },
          },
        });
        break;
      case 'reconnect':
        this.updateConnectionRollups({
          connectionId,
          health: {
            status: 'degraded',
            authState: 'missing',
            checkedAt: now,
            lastError: null,
            diagnostics: [{ code: 'reconnect_pending', severity: 'warn', message: 'Reconnect initiated — start new OAuth flow' }],
            remediation: { action: 'reconnect', message: 'Reconnect initiated', updatedAt: now },
          },
        });
        break;
      case 'scope_fix':
        this.updateConnectionRollups({
          connectionId,
          health: {
            status: 'degraded',
            authState: 'invalid_scopes',
            checkedAt: now,
            lastError: 'Scope mismatch flagged',
            diagnostics: [{ code: 'scope_fix_pending', severity: 'warn', message: 'Scope fix initiated — re-authorize with correct scopes' }],
            remediation: { action: 'scope_fix', message: 'Scope fix initiated', updatedAt: now },
          },
        });
        break;
    }
    return this.getConnection(connectionId);
  }

  private getConnection(id: string): ConnectionRecord | null {
    const connection = this.getConnectionRow(id);
    return connection ? this.withConnectionPolicy(connection) : null;
  }

  // --- Internal: event emission ---

  private emit(event: string, payload: unknown): void {
    this.events.emit('event', { event, data: JSON.stringify(payload) } satisfies RuntimeEvent);
  }

  private createRuntimeTools(task: TaskRecord, runId: string, envelope: ExecutionEnvelope): RuntimeToolDescriptor[] {
    const capabilityTools = this.capabilityRegistry
      .getRuntimeTools({ workspaceId: task.workspaceId, runId })
      .filter((entry) =>
        envelope.allowedCapabilityIds.includes(entry.capabilityId)
        && envelope.allowedRuntimeTools.includes(entry.tool.name),
      )
      .map((entry) => ({
        ...entry.tool,
        execute: async (params: unknown) => {
          const result = await entry.tool.execute(params);
          return {
            ...result,
            content: result.content.map((c) => ({ ...c, type: c.type as 'text' })),
          };
        },
      }));

    return [
      ...this.createCoreRuntimeTools(task, runId).filter((tool) => envelope.allowedRuntimeTools.includes(tool.name)),
      ...capabilityTools,
    ];
  }

  private createCoreRuntimeTools(_task: TaskRecord, runId: string): RuntimeToolDescriptor[] {
    const requireEnvelope = (): ExecutionEnvelope | null => this.getExecutionEnvelope(runId);

    return [
      {
        name: 'popeye_memory_search',
        label: 'Popeye Memory Search',
        description: 'Search Popeye memory for prior facts, receipts, and procedures. Returns IDs you can pass to popeye_memory_describe or popeye_memory_expand for details.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            scope: { type: 'string', description: 'Optional memory scope override' },
            limit: { type: 'number', description: 'Maximum results to return (1-10)' },
            includeContent: { type: 'boolean', description: 'Include full memory content snippets' },
          },
          required: ['query'],
          additionalProperties: false,
        },
        execute: async (params) => {
          const parsed = RuntimeMemorySearchToolInputSchema.parse(params ?? {});
          const envelope = requireEnvelope();
          if (!envelope) {
            return { content: [{ type: 'text', text: 'Execution envelope not found for this run.' }] };
          }
          const scopeResolution = resolveAgentMemoryScopeFilter(envelope);
          const response = await this.searchMemory({
            query: parsed.query,
            ...(parsed.scope !== undefined && envelope.recallScope === 'global' ? { scope: parsed.scope } : {}),
            workspaceId: scopeResolution.workspaceId,
            projectId: scopeResolution.projectId,
            includeGlobal: scopeResolution.includeGlobal,
            limit: parsed.limit ?? 5,
            includeContent: parsed.includeContent ?? false,
          });
          const lines = response.results.length === 0
            ? ['No matching Popeye memories found.']
            : response.results.map((result, index) => {
                const snippet = result.content ? ` — ${result.content.slice(0, 100)}` : '';
                const layer = result.layer ? `/${result.layer}` : '';
                return `${index + 1}. [id:${result.id}] ${result.description} [${result.scope}/${result.sourceType}${layer}] score:${result.score.toFixed(2)}${snippet}`;
              });
          return {
            content: [{ type: 'text', text: lines.join('\n') }],
            details: {
              query: response.query,
              totalCandidates: response.totalCandidates,
              latencyMs: response.latencyMs,
              searchMode: response.searchMode,
              results: response.results,
            },
          };
        },
      },
      {
        name: 'popeye_memory_describe',
        label: 'Popeye Memory Describe',
        description: 'Get metadata about a specific memory (type, confidence, entities, sources, events) without loading full content. Use after search to decide if expand is needed.',
        inputSchema: {
          type: 'object',
          properties: {
            memoryId: { type: 'string', description: 'Memory ID from search results' },
          },
          required: ['memoryId'],
          additionalProperties: false,
        },
        execute: async (params) => {
          const parsed = z.object({ memoryId: z.string().min(1) }).parse(params ?? {});
          const envelope = requireEnvelope();
          if (!envelope) {
            return { content: [{ type: 'text', text: 'Execution envelope not found for this run.' }] };
          }
          const scopeResolution = resolveAgentMemoryScopeFilter(envelope);
          const desc = this.describeMemory(parsed.memoryId, scopeResolution);
          if (!desc) {
            if (this.describeMemory(parsed.memoryId)) {
              return { content: [{ type: 'text', text: `Memory ${parsed.memoryId} is outside the allowed recall scope.` }] };
            }
            return { content: [{ type: 'text', text: `Memory ${parsed.memoryId} not found.` }] };
          }
          const lines = [
            `ID: ${desc.id}`,
            `Description: ${desc.description}`,
            `Type: ${desc.type} | Source: ${desc.sourceType}${desc.layer ? ` | Layer: ${desc.layer}` : ''} | Scope: ${desc.scope}`,
            `Confidence: ${desc.confidence.toFixed(2)} | Durable: ${desc.durable}`,
            `Content length: ${desc.contentLength} chars (~${Math.ceil(desc.contentLength / 4)} tokens)`,
            `Entities: ${desc.entityCount} | Sources: ${desc.sourceCount} | Events: ${desc.eventCount}`,
            `Created: ${desc.createdAt}${desc.lastReinforcedAt ? ` | Last reinforced: ${desc.lastReinforcedAt}` : ''}`,
          ];
          return { content: [{ type: 'text', text: lines.join('\n') }], details: desc };
        },
      },
      {
        name: 'popeye_memory_explain',
        label: 'Popeye Memory Explain',
        description: 'Explain why a specific memory matched a query, including score breakdown and evidence links when available.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Original search query' },
            memoryId: { type: 'string', description: 'Memory ID returned from popeye_memory_search' },
          },
          required: ['query', 'memoryId'],
          additionalProperties: false,
        },
        execute: async (params) => {
          const parsed = z.object({ query: z.string().min(1), memoryId: z.string().min(1) }).parse(params ?? {});
          const envelope = requireEnvelope();
          if (!envelope) {
            return { content: [{ type: 'text', text: 'Execution envelope not found for this run.' }] };
          }
          const scopeResolution = resolveAgentMemoryScopeFilter(envelope);
          const desc = this.describeMemory(parsed.memoryId, scopeResolution);
          if (!desc) {
            if (this.describeMemory(parsed.memoryId)) {
              return { content: [{ type: 'text', text: `Memory ${parsed.memoryId} is outside the allowed recall scope.` }] };
            }
            return { content: [{ type: 'text', text: `Memory ${parsed.memoryId} not found.` }] };
          }
          const explanation = await this.explainMemoryRecall({
            query: parsed.query,
            memoryId: parsed.memoryId,
            workspaceId: scopeResolution.workspaceId,
            projectId: scopeResolution.projectId,
            includeGlobal: scopeResolution.includeGlobal,
          }, scopeResolution);

          if (!explanation) {
            return { content: [{ type: 'text', text: `Memory ${parsed.memoryId} was not recalled for that query.` }] };
          }

          const evidenceLine = explanation.evidence.length > 0
            ? `Evidence: ${explanation.evidence.map((link) => `${link.targetKind}:${link.targetId}`).join(', ')}`
            : 'Evidence: none';
          const lines = [
            `ID: ${explanation.memoryId}`,
            `Strategy: ${explanation.strategy} | Search mode: ${explanation.searchMode}${explanation.layer ? ` | Layer: ${explanation.layer}` : ''}`,
            `Score: ${explanation.score.toFixed(3)}`,
            `Breakdown: relevance=${explanation.scoreBreakdown.relevance.toFixed(3)}, recency=${explanation.scoreBreakdown.recency.toFixed(3)}, confidence=${explanation.scoreBreakdown.confidence.toFixed(3)}, scope=${explanation.scoreBreakdown.scopeMatch.toFixed(3)}`,
            explanation.scoreBreakdown.temporalFit !== undefined ? `Temporal fit: ${explanation.scoreBreakdown.temporalFit.toFixed(3)}` : null,
            evidenceLine,
          ].filter((line): line is string => line !== null);

          return { content: [{ type: 'text', text: lines.join('\n') }], details: explanation };
        },
      },
      {
        name: 'popeye_memory_expand',
        label: 'Popeye Memory Expand',
        description: 'Load full content of a specific memory. Use after describe to get the actual content when needed.',
        inputSchema: {
          type: 'object',
          properties: {
            memoryId: { type: 'string', description: 'Memory ID to expand' },
            maxTokens: { type: 'number', description: 'Maximum tokens to return (default 8000)' },
          },
          required: ['memoryId'],
          additionalProperties: false,
        },
        execute: async (params) => {
          const parsed = z.object({ memoryId: z.string().min(1), maxTokens: z.number().int().positive().optional() }).parse(params ?? {});
          const envelope = requireEnvelope();
          if (!envelope) {
            return { content: [{ type: 'text', text: 'Execution envelope not found for this run.' }] };
          }
          const scopeResolution = resolveAgentMemoryScopeFilter(envelope);
          const desc = this.describeMemory(parsed.memoryId, scopeResolution);
          if (!desc) {
            if (this.describeMemory(parsed.memoryId)) {
              return { content: [{ type: 'text', text: `Memory ${parsed.memoryId} is outside the allowed recall scope.` }] };
            }
            return { content: [{ type: 'text', text: `Memory ${parsed.memoryId} not found.` }] };
          }
          const expanded = this.expandMemory(parsed.memoryId, parsed.maxTokens, scopeResolution);
          if (!expanded) {
            return { content: [{ type: 'text', text: `Memory ${parsed.memoryId} not found.` }] };
          }
          const header = expanded.truncated ? `[Truncated to ~${expanded.tokenEstimate} tokens]\n\n` : '';
          return { content: [{ type: 'text', text: `${header}${expanded.content}` }], details: expanded };
        },
      },
    ];
  }

  // --- Internal: startup & seeding ---

  private seedDaemonState(): void {
    this.databases.app
      .prepare(`
        INSERT INTO daemon_state (id, started_at, last_shutdown_at, engine_kind, schema_version)
        VALUES (1, ?, NULL, ?, ?)
        ON CONFLICT(id) DO UPDATE SET started_at = excluded.started_at, engine_kind = excluded.engine_kind, schema_version = excluded.schema_version
      `)
      .run(this.startedAt, this.config.engine.kind, '1');
  }

  private seedReferenceData(): void {
    this.databases.app.prepare(
      `INSERT OR IGNORE INTO agent_profiles (
        id, name, description, mode, model_policy, allowed_runtime_tools_json,
        allowed_capability_ids_json, memory_scope, recall_scope,
        filesystem_policy_class, context_release_policy, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'default',
      'Default agent profile',
      'Default interactive profile',
      'interactive',
      'inherit',
      '[]',
      '[]',
      'workspace',
      'workspace',
      'workspace',
      'summary_only',
      this.startedAt,
      this.startedAt,
    );
    for (const workspace of this.config.workspaces) {
      this.databases.app.prepare('INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES (?, ?, ?)').run(workspace.id, workspace.name, this.startedAt);
      if (workspace.rootPath) {
        this.databases.app.prepare('UPDATE workspaces SET root_path = ? WHERE id = ?').run(workspace.rootPath, workspace.id);
      }
      for (const project of workspace.projects ?? []) {
        this.databases.app.prepare('INSERT OR IGNORE INTO projects (id, workspace_id, name, created_at) VALUES (?, ?, ?, ?)').run(project.id, workspace.id, project.name, this.startedAt);
        this.databases.app.prepare('UPDATE projects SET path = ? WHERE id = ?').run(project.path, project.id);
      }
    }
  }

  private ensureConfiguredHeartbeatSchedules(): void {
    for (const workspace of this.config.workspaces) {
      const heartbeatTaskId = `task:heartbeat:${workspace.id}`;
      const scheduleId = `schedule:heartbeat:${workspace.id}`;
      const heartbeatTitle = `heartbeat:${workspace.id}`;
      const heartbeatPrompt = `Heartbeat check for workspace ${workspace.name}`;
      const heartbeatStatus = workspace.heartbeatEnabled ? 'active' : 'paused';
      const retryPolicy = JSON.stringify({ maxAttempts: 3, baseDelaySeconds: 5, multiplier: 2, maxDelaySeconds: 900 });

      this.databases.app
        .prepare('INSERT OR IGNORE INTO tasks (id, workspace_id, project_id, profile_id, title, prompt, source, status, retry_policy_json, side_effect_profile, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(
          heartbeatTaskId,
          workspace.id,
          null,
          'default',
          heartbeatTitle,
          heartbeatPrompt,
          'heartbeat',
          heartbeatStatus,
          retryPolicy,
          'read_only',
          this.startedAt,
        );
      this.databases.app
        .prepare('UPDATE tasks SET title = ?, prompt = ?, profile_id = ?, status = ?, retry_policy_json = ?, side_effect_profile = ? WHERE id = ?')
        .run(heartbeatTitle, heartbeatPrompt, 'default', heartbeatStatus, retryPolicy, 'read_only', heartbeatTaskId);

      if (workspace.heartbeatEnabled) {
        this.databases.app
          .prepare('INSERT OR IGNORE INTO schedules (id, task_id, interval_seconds, created_at) VALUES (?, ?, ?, ?)')
          .run(scheduleId, heartbeatTaskId, workspace.heartbeatIntervalSeconds, this.startedAt);
        this.databases.app.prepare('UPDATE schedules SET interval_seconds = ? WHERE id = ?').run(workspace.heartbeatIntervalSeconds, scheduleId);
      } else {
        this.databases.app.prepare('DELETE FROM schedules WHERE id = ?').run(scheduleId);
      }
    }
  }

  private redactError(error: string | null): string | null {
    if (!error) return null;
    const result = redactText(error, this.config.security.redactionPatterns);
    for (const event of result.events) this.recordSecurityAudit(event);
    return result.text;
  }

  // --- Internal: reconciliation ---

  private reconcileStartupState(): void {
    const reconciledAt = nowIso();
    const staleRuns = z.array(RunRowSchema).parse(this.databases.app
      .prepare("SELECT * FROM runs WHERE state IN ('starting', 'running') AND finished_at IS NULL")
      .all());

    for (const row of staleRuns) {
      const run = mapRunRow(row);
      this.receiptManager.writeAbandonedReceiptIfMissing(
        run.id,
        run.jobId,
        run.taskId,
        run.workspaceId,
        'Run abandoned during daemon startup reconciliation',
        'Daemon restarted before the run reached a terminal state',
      );
      this.databases.app.prepare('UPDATE runs SET state = ?, finished_at = ?, error = ? WHERE id = ?').run('abandoned', reconciledAt, this.redactError('Daemon restarted before the run reached a terminal state'), run.id);
      void this.applyRecoveryDecision(run.jobId, run.id, 'Daemon restarted before the run reached a terminal state');
    }

    const staleLeasedJobs = z.array(IdRowSchema).parse(this.databases.app
      .prepare("SELECT j.id FROM jobs j LEFT JOIN job_leases l ON l.job_id = j.id WHERE j.status = 'leased' AND (l.job_id IS NULL OR l.lease_expires_at <= ?)")
      .all(reconciledAt));
    for (const job of staleLeasedJobs) {
      this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('queued', reconciledAt, job.id);
      this.databases.app.prepare('DELETE FROM job_leases WHERE job_id = ?').run(job.id);
    }

    if (staleRuns.length > 0 || staleLeasedJobs.length > 0) {
      this.recordSecurityAudit({
        code: 'startup_reconciliation',
        severity: 'warn',
        message: `Reconciled ${staleRuns.length} stale runs and ${staleLeasedJobs.length} leased jobs on startup`,
        component: 'runtime-core',
        timestamp: reconciledAt,
        details: {
          staleRuns: String(staleRuns.length),
          staleLeasedJobs: String(staleLeasedJobs.length),
        },
      });
    }
  }

  private recordSecurityAudit(event: SecurityAuditEvent): void {
    this.databases.app
      .prepare('INSERT INTO security_audit (id, code, severity, message, component, timestamp, details_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), event.code, event.severity, event.message, event.component, event.timestamp, JSON.stringify(event.details));
    this.emit('security_audit', event);
  }

  private createIntervention(code: InterventionRecord['code'], runId: string | null, reason: string): void {
    const intervention = this.sessionService.createIntervention(code, runId, reason);
    this.emit('intervention_created', intervention);
  }

  // --- Internal: scheduler tick & lease sweep ---

  private async processSchedulerTick(): Promise<void> {
    if (this.closed) return;
    try {
      this.scheduler.lastSchedulerTickAt = nowIso();
      this.ensureHeartbeatJobs();
      this.databases.app.prepare("UPDATE jobs SET status = 'queued', updated_at = ? WHERE status = 'waiting_retry' AND available_at <= ?").run(nowIso(), nowIso());
      const dueJobs = z.array(IdRowSchema).parse(this.databases.app
        .prepare("SELECT id FROM jobs WHERE status = 'queued' AND available_at <= ? ORDER BY available_at ASC, created_at ASC")
        .all(nowIso()));

      if (dueJobs.length > 0) {
        this.log.debug('scheduler tick', { dueJobs: dueJobs.length });
      }
      for (const row of dueJobs) {
        const job = this.getJob(row.id);
        if (!job) continue;
        const workspaceId = job.workspaceId;
        if (this.workspaceHasActiveExecution(workspaceId)) continue;
        await this.startJobExecution(job.id);
      }
    } catch (error) {
      if (!this.closed) throw error;
    }
  }

  private async processLeaseSweep(): Promise<void> {
    if (this.closed) return;
    try {
      this.scheduler.lastLeaseSweepAt = nowIso();

      for (const activeRun of Array.from(this.activeRuns.values())) {
        if (activeRun.handle.isAlive && !activeRun.handle.isAlive()) {
          await this.abandonRun(activeRun.runId, 'Worker liveness check failed during lease sweep');
          continue;
        }
        this.refreshLease(activeRun.jobId, activeRun.handle.pid ? `worker:${activeRun.handle.pid}` : `popeyed:${process.pid}`);
      }

      const expiredLeases = z.array(JobIdRowSchema).parse(this.databases.app
        .prepare('SELECT job_id FROM job_leases WHERE lease_expires_at <= ?')
        .all(nowIso()));
      if (expiredLeases.length > 0) {
        this.log.debug('lease sweep', { expired: expiredLeases.length });
      }
      for (const lease of expiredLeases) {
        const job = this.getJob(lease.job_id);
        if (!job) continue;
        if (job.status === 'leased') {
          this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('queued', nowIso(), job.id);
          this.databases.app.prepare('DELETE FROM job_leases WHERE job_id = ?').run(job.id);
          this.releaseWorkspaceLock(job.workspaceId);
        }
      }
    } catch (error) {
      if (!this.closed) throw error;
    }
  }

  // --- Internal: workspace locks & leases ---

  private workspaceHasActiveExecution(workspaceId: string): boolean {
    const rawLock = this.databases.app.prepare('SELECT id FROM locks WHERE scope = ?').get(`workspace:${workspaceId}`);
    const lock = rawLock ? IdRowSchema.parse(rawLock) : null;
    if (lock) return true;
    const active = parseCountRow(this.databases.app
      .prepare("SELECT COUNT(*) AS count FROM jobs WHERE workspace_id = ? AND status IN ('leased', 'running')")
      .get(workspaceId));
    return active > 0;
  }

  private acquireWorkspaceLock(workspaceId: string, owner: string): string | null {
    const lockId = `workspace:${workspaceId}`;
    const rawExisting = this.databases.app.prepare('SELECT id FROM locks WHERE id = ?').get(lockId);
    const existing = rawExisting ? IdRowSchema.parse(rawExisting) : null;
    if (existing) return null;
    this.databases.app.prepare('INSERT INTO locks (id, scope, owner, created_at) VALUES (?, ?, ?, ?)').run(lockId, lockId, owner, nowIso());
    return lockId;
  }

  private releaseWorkspaceLock(workspaceId: string): void {
    this.databases.app.prepare('DELETE FROM locks WHERE id = ?').run(`workspace:${workspaceId}`);
  }

  private refreshLease(jobId: string, owner: string): void {
    this.databases.app
      .prepare('INSERT OR REPLACE INTO job_leases (job_id, lease_owner, lease_expires_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(jobId, owner, new Date(Date.now() + this.scheduler.leaseTtlMs).toISOString(), nowIso());
  }

  // --- Internal: run execution ---

  private async startJobExecution(jobId: string): Promise<RunRecord | null> {
    const job = this.getJob(jobId);
    if (!job || job.status !== 'queued') return null;
    const task = this.getTask(job.taskId);
    if (!task) return null;
    const workspaceLockId = this.acquireWorkspaceLock(job.workspaceId, `popeyed:${process.pid}`);
    if (!workspaceLockId) return null;

    this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('leased', nowIso(), job.id);
    this.refreshLease(job.id, `popeyed:${process.pid}`);

    const sessionRoot = selectSessionRoot({ kind: selectSessionKind(task.source), scope: job.workspaceId });
    this.sessionService.ensureSessionRoot(sessionRoot);

    const run: RunRecord = {
      id: randomUUID(),
      jobId: job.id,
      taskId: task.id,
      workspaceId: job.workspaceId,
      profileId: task.profileId,
      sessionRootId: sessionRoot.id,
      engineSessionRef: null,
      state: 'starting',
      startedAt: nowIso(),
      finishedAt: null,
      error: null,
    };

    this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ?, last_run_id = ? WHERE id = ?').run('running', nowIso(), run.id, job.id);
    this.databases.app.prepare('INSERT INTO runs (id, job_id, task_id, workspace_id, profile_id, session_root_id, engine_session_ref, state, started_at, finished_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      run.id,
      run.jobId,
      run.taskId,
      run.workspaceId,
      run.profileId,
      run.sessionRootId,
      run.engineSessionRef,
      run.state,
      run.startedAt,
      run.finishedAt,
      run.error,
    );

    const instructionBundle = this.queryService.resolveInstructionsForRun(task);
    const redactedPrompt = redactText(task.prompt, this.config.security.redactionPatterns);
    for (const event of redactedPrompt.events) this.recordSecurityAudit(event);
    const fullPrompt = instructionBundle.compiledText
      ? `${instructionBundle.compiledText}\n\n---\n\n${redactedPrompt.text}`
      : redactedPrompt.text;

    this.messageIngestion.linkAcceptedIngressToRun(task.id, job.id, run.id);
    this.emit('run_started', run);

    const runLog = this.log.child({
      workspaceId: task.workspaceId,
      ...(task.projectId != null && { projectId: task.projectId }),
      taskId: task.id,
      jobId: job.id,
      runId: run.id,
      sessionRootId: sessionRoot.id,
    });

    try {
      const profile = this.getAgentProfile(task.profileId);
      if (!profile) {
        throw new RuntimeValidationError(`Execution profile not found: ${task.profileId}`);
      }
      const workspace = this.getWorkspace(task.workspaceId);
      if (!workspace) {
        throw new RuntimeValidationError(`Workspace not found: ${task.workspaceId}`);
      }
      const project = task.projectId ? this.getProject(task.projectId) : null;
      if (task.projectId && !project) {
        throw new RuntimeValidationError(`Project not found: ${task.projectId}`);
      }
      if (project && project.workspaceId !== task.workspaceId) {
        throw new RuntimeValidationError(`Project ${task.projectId} does not belong to workspace ${task.workspaceId}`);
      }
      const profileContextError = validateProfileTaskContext(profile, task);
      if (profileContextError) {
        throw new RuntimeValidationError(profileContextError);
      }

      const capabilityToolEntries = this.capabilityRegistry.getRuntimeTools({
        workspaceId: task.workspaceId,
        runId: run.id,
      });
      const invalidCapabilityToolEntry = capabilityToolEntries.find((entry) => entry == null || typeof entry !== 'object' || !('tool' in entry) || !entry.tool);
      if (invalidCapabilityToolEntry) {
        runLog.error('invalid capability tool entry', {
          entry: invalidCapabilityToolEntry as unknown as Record<string, unknown>,
        });
      }
      const coreToolNames = this.createCoreRuntimeTools(task, run.id).map((tool) => tool.name);
      const capabilityToolNames = capabilityToolEntries.map((entry) => entry.tool.name);
      const allRuntimeToolNames = Array.from(new Set([...coreToolNames, ...capabilityToolNames])).sort();
      const allCapabilityIds = this.capabilityRegistry.listCapabilities().map((capability) => capability.id).sort();
      const allowedCapabilityIds = profile.allowedCapabilityIds.length > 0 ? profile.allowedCapabilityIds : allCapabilityIds;
      const allowedRuntimeTools = profile.allowedRuntimeTools.length > 0 ? profile.allowedRuntimeTools : allRuntimeToolNames;
      const warnings: string[] = [];
      const envelope = buildExecutionEnvelope({
        runId: run.id,
        task,
        profile,
        engineKind: this.config.engine.kind,
        allowedRuntimeTools,
        allowedCapabilityIds,
        workspaceRootPath: workspace.rootPath,
        projectPath: project?.path ?? null,
        sessionPolicy: 'dedicated',
        warnings,
        scratchRoot: `${this.databases.paths.stateDir}/scratch/${run.id}`,
      });
      mkdirSync(envelope.scratchRoot, { recursive: true });
      this.persistExecutionEnvelope(envelope);

      const engineRequest: EngineRunRequest = {
        prompt: fullPrompt,
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        instructionSnapshotId: instructionBundle.id,
        ...(envelope.cwd ? { cwd: envelope.cwd } : {}),
        sessionPolicy: { type: 'dedicated', rootId: sessionRoot.id },
        trigger: {
          source: task.source,
          timestamp: run.startedAt,
        },
        runtimeTools: this.createRuntimeTools(task, run.id, envelope),
      };
      const handle = await this.engine.startRun(engineRequest, {
        onEvent: (event) => this.persistEngineEvent(run.id, event),
      });
      const activeRun: ActiveRunContext = {
        runId: run.id,
        jobId: job.id,
        task,
        workspaceLockId,
        handle,
        finalizing: false,
      };
      this.activeRuns.set(run.id, activeRun);
      this.refreshLease(job.id, handle.pid ? `worker:${handle.pid}` : `popeyed:${process.pid}`);
      this.databases.app.prepare('UPDATE runs SET state = ? WHERE id = ?').run('running', run.id);
      runLog.info('run started');
      void this.awaitRunCompletion(activeRun);
      return this.getRun(run.id);
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const safeMessage = this.redactError(rawMessage) ?? rawMessage;
      runLog.error('run startup failed', {
        error: safeMessage,
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      });
      this.releaseWorkspaceLock(job.workspaceId);
      this.databases.app.prepare('DELETE FROM job_leases WHERE job_id = ?').run(job.id);
      this.databases.app.prepare('UPDATE runs SET state = ?, finished_at = ?, error = ? WHERE id = ?').run('failed_final', nowIso(), safeMessage, run.id);
      this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('failed_final', nowIso(), job.id);
      const receipt = this.writeRuntimeReceipt({
        runId: run.id,
        jobId: job.id,
        taskId: task.id,
        workspaceId: task.workspaceId,
        status: 'failed',
        summary: 'Run failed during engine startup',
        details: safeMessage,
        usage: { provider: this.config.engine.kind, model: 'unknown', tokensIn: task.prompt.length, tokensOut: 0, estimatedCostUsd: 0 },
      });
      this.emit('run_completed', receipt);
      this.recordSecurityAudit({ code: 'run_failed', severity: 'error', message: safeMessage, component: 'runtime-core', timestamp: nowIso(), details: { runId: run.id } });
      return this.getRun(run.id);
    }
  }

  private persistEngineEvent(runId: string, event: NormalizedEngineEvent): void {
    const record: RunEventRecord = RunEventRecordSchema.parse({
      id: randomUUID(),
      runId,
      type: event.type,
      payload: JSON.stringify(event.payload ?? {}),
      createdAt: nowIso(),
    });
    this.databases.app.prepare('INSERT INTO run_events (id, run_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)').run(record.id, record.runId, record.type, record.payload, record.createdAt);
    this.log.debug('engine event persisted', { runId, eventType: event.type });
    if (event.type === 'session' && event.payload?.sessionRef) {
      this.databases.app.prepare('UPDATE runs SET engine_session_ref = ? WHERE id = ?').run(event.payload.sessionRef, runId);
    }
    if (event.type === 'compaction' && typeof event.payload?.content === 'string') {
      const activeRun = this.activeRuns.get(runId);
      const workspaceId = activeRun?.task.workspaceId ?? 'default';
      void this.memoryLifecycle.processCompactionFlush(runId, event.payload.content, workspaceId);
    }
    this.emit('run_event', record);
  }

  private async awaitRunCompletion(activeRun: ActiveRunContext): Promise<void> {
    try {
      const completion = await activeRun.handle.wait();
      await this.finalizeRun(activeRun, completion);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.finalizeRun(activeRun, {
        engineSessionRef: null,
        usage: { provider: this.config.engine.kind, model: 'unknown', tokensIn: activeRun.task.prompt.length, tokensOut: 0, estimatedCostUsd: 0 },
        failureClassification: classifyFailureFromMessage(message),
      });
    }
  }

  private async finalizeRun(activeRun: ActiveRunContext, completion: EngineRunCompletion): Promise<void> {
    if (activeRun.finalizing) return;
    activeRun.finalizing = true;
    const run = this.getRun(activeRun.runId);
    if (!run) return;

    const runLog = this.log.child({
      workspaceId: run.workspaceId,
      taskId: run.taskId,
      jobId: run.jobId,
      runId: run.id,
      sessionRootId: run.sessionRootId,
    });

    const failure = completion.failureClassification;
    if (failure === null) {
      this.databases.app.prepare('UPDATE runs SET state = ?, engine_session_ref = ?, finished_at = ?, error = ? WHERE id = ?').run('succeeded', completion.engineSessionRef, nowIso(), null, run.id);
      this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('succeeded', nowIso(), run.jobId);
      const receipt = this.writeRuntimeReceipt({
        runId: run.id,
        jobId: run.jobId,
        taskId: run.taskId,
        workspaceId: run.workspaceId,
        status: 'succeeded',
        summary: 'Run completed successfully',
        details: JSON.stringify(this.listRunEvents(run.id)),
        usage: completion.usage,
      });
      runLog.info('run succeeded', {
        provider: completion.usage.provider,
        model: completion.usage.model,
        tokensIn: completion.usage.tokensIn,
        tokensOut: completion.usage.tokensOut,
        estimatedCostUsd: completion.usage.estimatedCostUsd,
      });
      this.emit('run_completed', receipt);
      this.cleanupActiveRun(activeRun);
      return;
    }

    if (failure === 'cancelled') {
      this.databases.app.prepare('UPDATE runs SET state = ?, finished_at = ?, error = ? WHERE id = ?').run('cancelled', nowIso(), this.redactError('cancelled'), run.id);
      this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('cancelled', nowIso(), run.jobId);
      const receipt = this.writeRuntimeReceipt({
        runId: run.id,
        jobId: run.jobId,
        taskId: run.taskId,
        workspaceId: run.workspaceId,
        status: 'cancelled',
        summary: 'Run cancelled',
        details: 'Cancelled by operator or daemon shutdown',
        usage: completion.usage,
      });
      runLog.info('run cancelled');
      this.emit('run_completed', receipt);
      this.cleanupActiveRun(activeRun);
      return;
    }

    if (failure === 'transient_failure') {
      this.databases.app.prepare('UPDATE runs SET state = ?, finished_at = ?, error = ? WHERE id = ?').run('failed_retryable', nowIso(), this.redactError(failure), run.id);
      runLog.warn('run failed (retryable)', { failure });
      await this.scheduleRetry(activeRun.task, run.jobId, completion, failure);
      this.cleanupActiveRun(activeRun);
      return;
    }

    this.databases.app.prepare('UPDATE runs SET state = ?, finished_at = ?, error = ?, engine_session_ref = ? WHERE id = ?').run('failed_final', nowIso(), this.redactError(failure), completion.engineSessionRef, run.id);
    this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('failed_final', nowIso(), run.jobId);
    const receipt = this.writeRuntimeReceipt({
      runId: run.id,
      jobId: run.jobId,
      taskId: run.taskId,
      workspaceId: run.workspaceId,
      status: 'failed',
      summary: 'Run failed',
      details: failure,
      usage: completion.usage,
    });
    runLog.error('run failed (final)', { failure });
    this.emit('run_completed', receipt);
    this.recordSecurityAudit({ code: 'run_failed', severity: 'error', message: failure, component: 'runtime-core', timestamp: nowIso(), details: { runId: run.id } });
    this.createIntervention('failed_final', run.id, `Run ${run.id} failed with ${failure}`);
    this.cleanupActiveRun(activeRun);
  }

  private async scheduleRetry(task: TaskRecord, jobId: string, completion: EngineRunCompletion, reason: string): Promise<void> {
    const job = this.listJobs().find((candidate) => candidate.id === jobId);
    if (!job) return;
    const nextRetryCount = job.retryCount + 1;
    if (task.source === 'heartbeat') {
      this.databases.app.prepare('UPDATE jobs SET status = ?, retry_count = ?, available_at = ?, updated_at = ? WHERE id = ?').run('queued', nextRetryCount, nowIso(), nowIso(), jobId);
    } else if (nextRetryCount < task.retryPolicy.maxAttempts) {
      const delaySeconds = calculateRetryDelaySeconds(nextRetryCount, task.retryPolicy);
      const availableAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
      this.databases.app.prepare('UPDATE jobs SET status = ?, retry_count = ?, available_at = ?, updated_at = ? WHERE id = ?').run('waiting_retry', nextRetryCount, availableAt, nowIso(), jobId);
    } else {
      this.databases.app.prepare('UPDATE jobs SET status = ?, retry_count = ?, updated_at = ? WHERE id = ?').run('failed_final', nextRetryCount, nowIso(), jobId);
      this.createIntervention('retry_budget_exhausted', job.lastRunId, `Retry budget exhausted for job ${jobId}`);
    }

    const receipt = this.writeRuntimeReceipt({
      runId: job.lastRunId ?? 'unknown',
      jobId,
      taskId: task.id,
      workspaceId: task.workspaceId,
      status: 'failed',
      summary: 'Run failed and was scheduled for retry',
      details: reason,
      usage: completion.usage,
    });
    this.emit('run_completed', receipt);
  }

  private cleanupActiveRun(activeRun: ActiveRunContext): void {
    this.activeRuns.delete(activeRun.runId);
    this.databases.app.prepare('DELETE FROM job_leases WHERE job_id = ?').run(activeRun.jobId);
    this.releaseWorkspaceLock(activeRun.task.workspaceId);
  }

  private async abandonRun(runId: string, reason: string): Promise<void> {
    const run = this.getRun(runId);
    if (!run || isTerminalRunState(run.state)) return;
    this.log.warn('run abandoned', { runId, reason });
    this.receiptManager.writeAbandonedReceiptIfMissing(run.id, run.jobId, run.taskId, run.workspaceId, 'Run abandoned', reason);
    this.databases.app.prepare('UPDATE runs SET state = ?, finished_at = ?, error = ? WHERE id = ?').run('abandoned', nowIso(), this.redactError(reason), run.id);
    const receipt = this.getReceiptByRunId(run.id);
    if (receipt) {
      this.emit('run_completed', receipt);
    }
    await this.applyRecoveryDecision(run.jobId, run.id, reason);
    const activeRun = this.activeRuns.get(runId);
    if (activeRun) this.cleanupActiveRun(activeRun);
  }

  private async applyRecoveryDecision(jobId: string, runId: string, reason: string): Promise<void> {
    const job = this.listJobs().find((candidate) => candidate.id === jobId);
    if (!job) return;
    const task = this.getTask(job.taskId);
    if (!task) return;
    this.databases.app.prepare('DELETE FROM job_leases WHERE job_id = ?').run(jobId);
    this.releaseWorkspaceLock(job.workspaceId);
    const lowered = reason.toLowerCase();

    if (task.source === 'heartbeat') {
      this.databases.app.prepare('UPDATE jobs SET status = ?, available_at = ?, updated_at = ? WHERE id = ?').run('queued', nowIso(), nowIso(), jobId);
      return;
    }
    if (lowered.includes('auth') || lowered.includes('credential')) {
      this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('blocked_operator', nowIso(), jobId);
      this.createIntervention('needs_credentials', runId, `Credentials required after abandoned run ${runId}`);
      return;
    }
    if (lowered.includes('policy')) {
      this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('blocked_operator', nowIso(), jobId);
      this.createIntervention('needs_policy_decision', runId, `Policy decision required after abandoned run ${runId}`);
      return;
    }

    const nextRetryCount = job.retryCount + 1;
    if (nextRetryCount < task.retryPolicy.maxAttempts) {
      const delaySeconds = calculateRetryDelaySeconds(nextRetryCount, task.retryPolicy);
      const availableAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
      this.databases.app.prepare('UPDATE jobs SET status = ?, retry_count = ?, available_at = ?, updated_at = ? WHERE id = ?').run('waiting_retry', nextRetryCount, availableAt, nowIso(), jobId);
      return;
    }

    this.databases.app.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run('failed_final', nowIso(), jobId);
    this.createIntervention('retry_budget_exhausted', runId, `Retry budget exhausted for abandoned run ${runId}`);
  }

  // --- Internal: heartbeat scheduling ---

  private ensureHeartbeatJobs(): void {
    const schedules = z.array(ScheduleRowSchema).parse(this.databases.app.prepare('SELECT * FROM schedules ORDER BY created_at ASC').all());
    for (const schedule of schedules) {
      const task = this.getTask(schedule.task_id);
      if (!task || task.source !== 'heartbeat') continue;
      const existing = parseCountRow(this.databases.app
        .prepare("SELECT COUNT(*) AS count FROM jobs WHERE task_id = ? AND status IN ('queued', 'leased', 'running', 'waiting_retry')")
        .get(task.id));
      if (existing > 0) continue;
      const lastTime = parseCreatedAt(this.databases.app.prepare('SELECT created_at FROM jobs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(task.id)) ?? schedule.created_at;
      const dueAt = new Date(new Date(lastTime).getTime() + schedule.interval_seconds * 1000);
      if (Date.now() >= dueAt.getTime()) {
        this.enqueueTask(task.id, { availableAt: nowIso() });
      }
    }
  }

  private computeNextHeartbeatDueAt(): string | null {
    const schedules = z.array(ScheduleRowSchema).parse(this.databases.app.prepare('SELECT * FROM schedules ORDER BY created_at ASC').all());
    if (schedules.length === 0) return null;
    let nextDueAt: string | null = null;
    for (const schedule of schedules) {
      const lastTime = parseCreatedAt(this.databases.app.prepare('SELECT created_at FROM jobs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(schedule.task_id)) ?? schedule.created_at;
      const dueAt = new Date(new Date(lastTime).getTime() + schedule.interval_seconds * 1000).toISOString();
      if (!nextDueAt || dueAt < nextDueAt) nextDueAt = dueAt;
    }
    return nextDueAt;
  }

  // --- Internal: auth token rotation ---

  private startTokenRotationCheck(): void {
    const checkIntervalMs = 24 * 60 * 60 * 1000; // Check daily
    const check = () => {
      try {
        const store = readAuthStore(this.config.authFile);
        const createdAt = new Date(store.current.createdAt);
        const ageDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
        if (ageDays >= this.config.security.tokenRotationDays) {
          rotateAuthStore(this.config.authFile);
          this.recordSecurityAuditEvent({
            code: 'auth_token_rotated',
            severity: 'info',
            message: `Auth token auto-rotated after ${Math.floor(ageDays)} days`,
            component: 'runtime-core',
            timestamp: nowIso(),
            details: {},
          });
        }
      } catch (err) {
        this.recordSecurityAuditEvent({
          code: 'auth_token_rotation_failed',
          severity: 'warn',
          message: `Auth token rotation failed: ${err instanceof Error ? err.message : String(err)}`,
          component: 'runtime-core',
          timestamp: nowIso(),
          details: {},
        });
      }
    };
    check(); // Run immediately on startup
    this.tokenRotationTimer = setInterval(check, checkIntervalMs);
  }

  // --- Internal: memory maintenance ---

  private startDocIndexing(): void {
    if (!this.config.memory.docIndexEnabled) return;

    // If cap-files is registered, skip legacy doc indexing — cap-files handles it
    if (this.capabilityRegistry.getCapability('files')) {
      this.log.debug('doc indexing delegated to cap-files capability');
      return;
    }

    this.log.debug('doc indexing started (legacy)', { workspaces: this.config.workspaces.length });

    const runIndex = () => {
      if (this.closed) return;
      for (const ws of this.config.workspaces) {
        if (!ws.rootPath) continue;
        this.memoryLifecycle.indexWorkspaceDocs(ws.id, ws.rootPath);
      }
    };

    runIndex(); // Run immediately on startup
    const intervalMs = this.config.memory.docIndexIntervalHours * 3600_000;
    this.docIndexTimer = setInterval(runIndex, intervalMs);
  }

  private startMemoryMaintenance(): void {
    this.log.debug('memory maintenance started');
    // Check hourly for maintenance tasks
    this.memoryMaintenanceTimer = setInterval(() => {
      if (this.closed) return;
      const now = new Date();
      const hour = now.getUTCHours();

      // Run daily maintenance at configured hour
      if (hour === this.config.memory.dailySummaryHour) {
        const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
        for (const ws of this.config.workspaces) {
          this.memoryLifecycle.generateDailySummary(yesterday, ws.id);
        }
        this.memoryLifecycle.runConfidenceDecay();
        this.memoryLifecycle.runConsolidation();
      }
    }, 3600_000); // 1 hour
  }

  // --- Capability registry ---

  registerCapability(cap: CapabilityModule): void {
    this.capabilityRegistry.register(cap);
  }

  listCapabilities(): CapabilityDescriptor[] {
    return this.capabilityRegistry.listCapabilities();
  }

  getCapabilityHealth(): Record<string, { healthy: boolean; details?: Record<string, unknown> }> {
    return this.capabilityRegistry.healthCheck();
  }

  getCapabilityRegistry(): CapabilityRegistry {
    return this.capabilityRegistry;
  }

  async initializeCapabilities(): Promise<void> {
    if (!this.capabilityInitPromise) {
      this.capabilityInitPromise = this.capabilityRegistry.initializeAll();
    }
    await this.capabilityInitPromise;
  }

  // --- File roots facade ---

  private getFilesRootService(): FileRootService | null {
    const cap = this.capabilityRegistry.getCapability('files');
    if (!cap) return null;
    // Access the internal service via a fresh context — actually, the capability
    // stores its own state. Use the DB directly.
    return new FileRootService(this.databases.app);
  }

  private getFilesIndexer(): FileIndexer | null {
    const cap = this.capabilityRegistry.getCapability('files');
    if (!cap) return null;
    const ctx = this.capabilityRegistry['deps'].buildContext();
    return new FileIndexer(this.databases.app, ctx);
  }

  private getFilesSearchService(): FileSearchService | null {
    const cap = this.capabilityRegistry.getCapability('files');
    if (!cap) return null;
    return new FileSearchService(this.databases.app);
  }

  private denyFileRootRegistration(reasonCode: string, message: string, details: Record<string, string>): never {
    this.log.warn('file root registration denied', { reasonCode, ...details });
    this.recordSecurityAudit({
      code: 'file_root_registration_denied',
      severity: 'warn',
      message,
      component: 'runtime-core',
      timestamp: nowIso(),
      details: {
        reasonCode,
        ...details,
      },
    });
    throw new RuntimeValidationError(message);
  }

  private denyFileRootOperation(reasonCode: string, message: string, details: Record<string, string>): never {
    this.log.warn('file root policy denied', { reasonCode, ...details });
    this.recordSecurityAudit({
      code: 'file_root_policy_denied',
      severity: 'warn',
      message,
      component: 'runtime-core',
      timestamp: nowIso(),
      details: {
        reasonCode,
        ...details,
      },
    });
    throw new RuntimeValidationError(message);
  }

  private validateFileRootRegistration(input: FileRootRegistrationInput): void {
    if (!this.getWorkspace(input.workspaceId)) {
      this.denyFileRootRegistration('workspace_not_found', `Workspace ${input.workspaceId} not found`, {
        workspaceId: input.workspaceId,
        rootPath: input.rootPath,
      });
    }

    const canonicalRootPath = canonicalizeLocalPath(input.rootPath);

    const protectedRuntimeRoots = [
      this.config.runtimeDataDir,
      this.databases.paths.stateDir,
      this.databases.paths.logsDir,
      this.databases.paths.receiptsDir,
      this.databases.paths.backupsDir,
      this.databases.paths.capabilityStoresDir,
      resolve(this.databases.paths.memoryDailyDir, '..'),
    ];

    for (const protectedRoot of protectedRuntimeRoots) {
      const resolvedProtectedRoot = canonicalizeLocalPath(protectedRoot);
      if (isPathWithinRoot(resolvedProtectedRoot, canonicalRootPath)) {
        this.denyFileRootRegistration(
          'runtime_directory_forbidden',
          'File roots cannot point at Popeye runtime data directories',
          {
            workspaceId: input.workspaceId,
            rootPath: canonicalRootPath,
            protectedRoot: resolvedProtectedRoot,
          },
        );
      }
    }

    const existingRoot = this.listFileRoots(input.workspaceId).find((root) => {
      return root.enabled && canonicalizeLocalPath(root.rootPath) === canonicalRootPath;
    });
    if (existingRoot) {
      this.denyFileRootRegistration(
        'duplicate_root',
        `File root ${canonicalRootPath} is already registered for workspace ${input.workspaceId}`,
        {
          workspaceId: input.workspaceId,
          rootPath: canonicalRootPath,
          existingRootId: existingRoot.id,
        },
      );
    }
  }

  private requireFileRootForOperation(input: {
    rootId: string;
    purpose: string;
    workspaceId?: string | undefined;
  }): FileRootRecord {
    const root = this.getFileRoot(input.rootId);
    if (!root) {
      return this.denyFileRootOperation('root_not_found', `File root ${input.rootId} not found`, {
        rootId: input.rootId,
        purpose: input.purpose,
        ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
      });
    }
    if (!root.enabled) {
      return this.denyFileRootOperation('root_disabled', `File root ${input.rootId} is disabled`, {
        rootId: input.rootId,
        purpose: input.purpose,
        workspaceId: root.workspaceId,
      });
    }
    if (input.workspaceId !== undefined && root.workspaceId !== input.workspaceId) {
      return this.denyFileRootOperation(
        'workspace_mismatch',
        `File root ${input.rootId} does not belong to workspace ${input.workspaceId}`,
        {
          rootId: input.rootId,
          purpose: input.purpose,
          workspaceId: input.workspaceId,
          rootWorkspaceId: root.workspaceId,
        },
      );
    }
    return root;
  }

  registerFileRoot(input: FileRootRegistrationInput): FileRootRecord {
    const svc = this.getFilesRootService();
    if (!svc) throw new Error('Files capability not available');
    this.validateFileRootRegistration(input);
    return svc.registerRoot(input);
  }

  listFileRoots(workspaceId?: string): FileRootRecord[] {
    const svc = this.getFilesRootService();
    if (!svc) return [];
    return svc.listRoots(workspaceId);
  }

  getFileRoot(id: string): FileRootRecord | null {
    const svc = this.getFilesRootService();
    if (!svc) return null;
    return svc.getRoot(id);
  }

  updateFileRoot(id: string, input: FileRootUpdateInput): FileRootRecord | null {
    const svc = this.getFilesRootService();
    if (!svc) return null;
    return svc.updateRoot(id, input);
  }

  disableFileRoot(id: string): boolean {
    const svc = this.getFilesRootService();
    if (!svc) return false;
    return svc.removeRoot(id);
  }

  searchFiles(query: FileSearchQuery): FileSearchResponse {
    const svc = this.getFilesSearchService();
    if (!svc) return { query: query.query, results: [], totalCandidates: 0 };
    if (query.rootId) {
      this.requireFileRootForOperation({
        rootId: query.rootId,
        purpose: 'file_search',
        ...(query.workspaceId !== undefined ? { workspaceId: query.workspaceId } : {}),
      });
    }
    return svc.search(query);
  }

  reindexFileRoot(rootId: string): FileIndexResult | null {
    const indexer = this.getFilesIndexer();
    const rootService = this.getFilesRootService();
    if (!indexer || !rootService) return null;
    this.requireFileRootForOperation({ rootId, purpose: 'file_reindex' });
    return indexer.reindexRoot(rootId, rootService);
  }

  getFileDocument(id: string): FileDocumentRecord | null {
    const svc = this.getFilesRootService();
    if (!svc) return null;
    const document = svc.getDocument(id);
    if (!document) return null;
    try {
      this.requireFileRootForOperation({
        rootId: document.fileRootId,
        purpose: 'file_document_read',
      });
      return document;
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return null;
      }
      throw error;
    }
  }

  // --- File write-intent facade ---

  private fileWriteIntents: Map<string, FileWriteIntentRecord> = new Map();

  createFileWriteIntent(input: FileWriteIntentCreateInput): FileWriteIntentRecord {
    const root = this.getFileRootRecord(input.fileRootId);
    if (!root) throw new RuntimeNotFoundError(`File root ${input.fileRootId} not found`);

    const writePosture = (root as Record<string, unknown>)['writePosture'] as string ?? 'read_only';
    if (writePosture === 'read_only') {
      throw new RuntimeValidationError(`File root ${input.fileRootId} is read-only`);
    }

    const id = randomUUID();
    const now = nowIso();
    const intent: FileWriteIntentRecord = {
      id,
      fileRootId: input.fileRootId,
      filePath: input.filePath,
      intentType: input.intentType,
      diffPreview: input.diffPreview ?? '',
      status: writePosture === 'agent_owned' ? 'applied' : 'pending',
      runId: input.runId ?? null,
      approvalId: null,
      receiptId: null,
      createdAt: now,
      reviewedAt: writePosture === 'agent_owned' ? now : null,
    };
    this.fileWriteIntents.set(id, intent);
    return intent;
  }

  listFileWriteIntents(rootId?: string, status?: string): FileWriteIntentRecord[] {
    const all = Array.from(this.fileWriteIntents.values());
    return all.filter((intent) => {
      if (rootId && intent.fileRootId !== rootId) return false;
      if (status && intent.status !== status) return false;
      return true;
    });
  }

  getFileWriteIntent(id: string): FileWriteIntentRecord | null {
    return this.fileWriteIntents.get(id) ?? null;
  }

  reviewFileWriteIntent(id: string, input: FileWriteIntentReviewInput): FileWriteIntentRecord | null {
    const intent = this.fileWriteIntents.get(id);
    if (!intent) return null;
    if (intent.status !== 'pending') {
      throw new RuntimeValidationError(`Write intent ${id} is already ${intent.status}`);
    }
    const now = nowIso();
    const updated: FileWriteIntentRecord = {
      ...intent,
      status: input.action === 'apply' ? 'applied' : 'rejected',
      reviewedAt: now,
    };
    this.fileWriteIntents.set(id, updated);
    return updated;
  }

  private getFileRootRecord(id: string): FileRootRecord | null {
    const svc = this.getFilesRootService();
    if (!svc) return null;
    return svc.getRoot(id);
  }

  // --- Email facade ---
  // Uses a cached readonly DB handle opened on first access.
  // Closed when the runtime shuts down.

  private emailReadDb: BetterSqlite3.Database | null = null;
  private emailServiceCache: EmailService | null = null;
  private emailSearchCache: EmailSearchService | null = null;

  private getEmailReadDb(): BetterSqlite3.Database | null {
    if (this.emailReadDb) return this.emailReadDb;
    const cap = this.capabilityRegistry.getCapability('email');
    if (!cap) return null;
    const dbPath = `${this.databases.paths.capabilityStoresDir}/email.db`;
    if (!existsSync(dbPath)) return null;
    this.emailReadDb = new BetterSqlite3(dbPath, { readonly: true });
    return this.emailReadDb;
  }

  private getEmailServiceFacade(): EmailService | null {
    if (this.emailServiceCache) return this.emailServiceCache;
    const db = this.getEmailReadDb();
    if (!db) return null;
    this.emailServiceCache = new EmailService(db as unknown as CapabilityContext['appDb']);
    return this.emailServiceCache;
  }

  private getEmailSearchFacade(): EmailSearchService | null {
    if (this.emailSearchCache) return this.emailSearchCache;
    const db = this.getEmailReadDb();
    if (!db) return null;
    this.emailSearchCache = new EmailSearchService(db as unknown as CapabilityContext['appDb']);
    return this.emailSearchCache;
  }

  listEmailAccounts(): EmailAccountRecord[] {
    return this.getEmailServiceFacade()?.listAccounts() ?? [];
  }

  listEmailThreads(accountId: string, options?: { limit?: number | undefined; unreadOnly?: boolean | undefined }): EmailThreadRecord[] {
    const svc = this.getEmailServiceFacade();
    if (!svc) return [];
    this.requireEmailAccountForOperation(svc, accountId, 'email_thread_list');
    return svc.listThreads(accountId, options);
  }

  getEmailThread(id: string): EmailThreadRecord | null {
    const svc = this.getEmailServiceFacade();
    if (!svc) return null;
    const thread = svc.getThread(id);
    if (!thread) return null;
    try {
      this.requireEmailAccountForOperation(svc, thread.accountId, 'email_thread_read');
      return thread;
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return null;
      }
      throw error;
    }
  }

  searchEmail(query: EmailSearchQuery): { query: string; results: EmailSearchResult[] } {
    const svc = this.getEmailServiceFacade();
    if (query.accountId && svc) {
      this.requireEmailAccountForOperation(svc, query.accountId, 'email_search');
    }
    return this.getEmailSearchFacade()?.search(query) ?? { query: query.query, results: [] };
  }

  getEmailDigest(accountId: string): EmailDigestRecord | null {
    const svc = this.getEmailServiceFacade();
    if (!svc) return null;
    this.requireEmailAccountForOperation(svc, accountId, 'email_digest_read');
    return svc.getLatestDigest(accountId);
  }

  getEmailMessage(id: string): EmailMessageRecord | null {
    const svc = this.getEmailServiceFacade();
    if (!svc) return null;
    const message = svc.getMessage(id);
    if (!message) return null;
    try {
      this.requireEmailAccountForOperation(svc, message.accountId, 'email_message_read');
      return message;
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return null;
      }
      throw error;
    }
  }

  // --- GitHub facade ---
  // Uses a cached readonly DB handle opened on first access.

  private githubReadDb: BetterSqlite3.Database | null = null;
  private githubServiceCache: GithubService | null = null;
  private githubSearchCache: GithubSearchService | null = null;

  private getGithubReadDb(): BetterSqlite3.Database | null {
    if (this.githubReadDb) return this.githubReadDb;
    const cap = this.capabilityRegistry.getCapability('github');
    if (!cap) return null;
    const dbPath = `${this.databases.paths.capabilityStoresDir}/github.db`;
    if (!existsSync(dbPath)) return null;
    this.githubReadDb = new BetterSqlite3(dbPath, { readonly: true });
    return this.githubReadDb;
  }

  private getGithubServiceFacade(): GithubService | null {
    if (this.githubServiceCache) return this.githubServiceCache;
    const db = this.getGithubReadDb();
    if (!db) return null;
    this.githubServiceCache = new GithubService(db as unknown as CapabilityContext['appDb']);
    return this.githubServiceCache;
  }

  private getGithubSearchFacade(): GithubSearchService | null {
    if (this.githubSearchCache) return this.githubSearchCache;
    const db = this.getGithubReadDb();
    if (!db) return null;
    this.githubSearchCache = new GithubSearchService(db as unknown as CapabilityContext['appDb']);
    return this.githubSearchCache;
  }

  listGithubAccounts(): GithubAccountRecord[] {
    return this.getGithubServiceFacade()?.listAccounts() ?? [];
  }

  listGithubRepos(accountId: string, options?: { limit?: number | undefined }): GithubRepoRecord[] {
    const svc = this.getGithubServiceFacade();
    if (!svc) return [];
    this.requireGithubAccountForOperation(svc, accountId, 'github_repo_list');
    return svc.listRepos(accountId, options);
  }

  listGithubPullRequests(accountId: string, options?: { state?: string | undefined; limit?: number | undefined; repoId?: string | undefined }): GithubPullRequestRecord[] {
    const svc = this.getGithubServiceFacade();
    if (!svc) return [];
    this.requireGithubAccountForOperation(svc, accountId, 'github_pr_list');
    return svc.listPullRequests(accountId, options);
  }

  listGithubIssues(accountId: string, options?: { state?: string | undefined; limit?: number | undefined; assignedOnly?: boolean | undefined }): GithubIssueRecord[] {
    const svc = this.getGithubServiceFacade();
    if (!svc) return [];
    this.requireGithubAccountForOperation(svc, accountId, 'github_issue_list');
    return svc.listIssues(accountId, options);
  }

  listGithubNotifications(accountId: string, options?: { unreadOnly?: boolean | undefined; limit?: number | undefined }): GithubNotificationRecord[] {
    const svc = this.getGithubServiceFacade();
    if (!svc) return [];
    this.requireGithubAccountForOperation(svc, accountId, 'github_notification_list');
    return svc.listNotifications(accountId, options);
  }

  getGithubPullRequest(id: string): GithubPullRequestRecord | null {
    const svc = this.getGithubServiceFacade();
    if (!svc) return null;
    const pullRequest = svc.getPullRequest(id);
    if (!pullRequest) return null;
    try {
      this.requireGithubAccountForOperation(svc, pullRequest.accountId, 'github_pr_read');
      return pullRequest;
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return null;
      }
      throw error;
    }
  }

  getGithubIssue(id: string): GithubIssueRecord | null {
    const svc = this.getGithubServiceFacade();
    if (!svc) return null;
    const issue = svc.getIssue(id);
    if (!issue) return null;
    try {
      this.requireGithubAccountForOperation(svc, issue.accountId, 'github_issue_read');
      return issue;
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return null;
      }
      throw error;
    }
  }

  searchGithub(query: GithubSearchQuery): { query: string; results: GithubSearchResult[] } {
    const svc = this.getGithubServiceFacade();
    if (query.accountId && svc) {
      this.requireGithubAccountForOperation(svc, query.accountId, 'github_search');
    }
    return this.getGithubSearchFacade()?.search(query) ?? { query: query.query, results: [] };
  }

  getGithubDigest(accountId: string): GithubDigestRecord | null {
    const svc = this.getGithubServiceFacade();
    if (!svc) return null;
    this.requireGithubAccountForOperation(svc, accountId, 'github_digest_read');
    return svc.getLatestDigest(accountId);
  }

  // --- GitHub mutation methods ---

  async syncGithubAccount(accountId: string): Promise<GithubSyncResult> {
    const githubCap = this.capabilityRegistry.getCapability('github');
    if (!githubCap) throw new Error('GitHub capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/github.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new GithubService(writeDb as unknown as CapabilityContext['appDb']);
      const { account, connection } = this.requireGithubAccountForOperation(svc, accountId, 'github_sync');
      const resolved = await this.resolveGithubAdapterForConnection(connection.id);
      if (!resolved) {
        throw new RuntimeValidationError(`Connection ${connection.id} could not resolve a GitHub adapter`);
      }

      const attemptAt = nowIso();
      this.updateConnectionRollups({
        connectionId: connection.id,
        health: {
          checkedAt: attemptAt,
        },
        sync: {
          lastAttemptAt: attemptAt,
          cursorKind: connectionCursorKindForProvider(connection.providerKind),
        },
      });

      const ctx = this.buildCapabilityContext();
      const syncService = new GithubSyncService(svc, ctx);
      const result = await syncService.syncAccount(account, resolved.adapter);
      const refreshedAccount = svc.getAccount(account.id) ?? account;
      const successCount = result.reposSynced + result.prsSynced + result.issuesSynced + result.notificationsSynced;
      const syncStatus = result.errors.length === 0
        ? 'success'
        : successCount > 0
          ? 'partial'
          : 'failed';
      const failureSummary = result.errors[0] ?? null;
      const failureState = failureSummary ? this.classifyConnectionFailure(failureSummary) : null;
      const successAt = syncStatus === 'failed' ? null : nowIso();

      this.updateConnectionRollups({
        connectionId: connection.id,
        health: failureSummary
          ? {
            status: syncStatus === 'partial' ? 'degraded' : failureState?.status ?? 'error',
            authState: syncStatus === 'partial' ? 'configured' : failureState?.authState ?? 'configured',
            checkedAt: nowIso(),
            lastError: failureSummary,
          }
          : {
            status: 'healthy',
            authState: 'configured',
            checkedAt: nowIso(),
            lastError: null,
          },
        sync: {
          ...(successAt ? { lastSuccessAt: successAt } : {}),
          status: syncStatus,
          cursorKind: connectionCursorKindForProvider(connection.providerKind),
          cursorPresent: Boolean(refreshedAccount.syncCursorSince),
          lagSummary: refreshedAccount.syncCursorSince
            ? `Cursor checkpoint stored at ${refreshedAccount.syncCursorSince}`
            : 'Awaiting first notification checkpoint',
        },
      });

      this.invalidateGithubFacade();
      try {
        this.refreshPeopleProjectionForGithubAccount(svc, account.id);
      } catch (error) {
        this.log.warn('github people projection failed', {
          accountId: account.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return result;
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      const failure = this.classifyConnectionFailure(message);
      const account = this.listGithubAccounts().find((entry) => entry.id === accountId) ?? null;
      if (account) {
        this.updateConnectionRollups({
          connectionId: account.connectionId,
          health: {
            status: failure.status,
            authState: failure.authState,
            checkedAt: nowIso(),
            lastError: message,
          },
          sync: {
            lastAttemptAt: nowIso(),
            status: 'failed',
            cursorKind: 'since',
            lagSummary: 'Sync failed before a checkpoint could be updated',
          },
        });
      }
      throw error;
    } finally {
      writeDb.close();
    }
  }

  triggerGithubDigest(accountId?: string): GithubDigestRecord | null {
    const githubCap = this.capabilityRegistry.getCapability('github');
    if (!githubCap) return null;

    const dbPath = `${this.databases.paths.capabilityStoresDir}/github.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new GithubService(writeDb as unknown as CapabilityContext['appDb']);
      const candidateAccounts = accountId ? [svc.getAccount(accountId)].filter(Boolean) : svc.listAccounts();
      if (candidateAccounts.length === 0) return null;
      const accounts = candidateAccounts.map((account) => {
        if (!account) {
          throw new RuntimeValidationError(`GitHub account ${accountId} not found`);
        }
        return this.requireGithubAccountForOperation(svc, account.id, 'github_digest_generate').account;
      });

      const ctx = this.buildCapabilityContext();
      const digestService = new GithubDigestService(svc, ctx);

      let lastDigest: GithubDigestRecord | null = null;
      for (const account of accounts) {
        if (!account) continue;
        lastDigest = digestService.generateDigest(account);
      }

      this.invalidateGithubFacade();

      return lastDigest;
    } finally {
      writeDb.close();
    }
  }

  async createGithubComment(input: GithubCommentCreateInput): Promise<GithubCommentRecord> {
    const githubCap = this.capabilityRegistry.getCapability('github');
    if (!githubCap) throw new Error('GitHub capability not initialized');

    const repoParts = input.repoFullName.split('/');
    if (repoParts.length !== 2 || !repoParts[0] || !repoParts[1]) {
      throw new RuntimeValidationError(`Invalid GitHub repo full name: ${input.repoFullName}`);
    }
    const [owner, repo] = repoParts;

    const dbPath = `${this.databases.paths.capabilityStoresDir}/github.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new GithubService(writeDb as unknown as CapabilityContext['appDb']);
      const { account, connection } = this.requireGithubAccountForOperation(svc, input.accountId, 'github_comment_create');
      this.requireReadWriteConnection(connection, 'github_comment_create');
      this.requireAllowlistedConnectionResource(connection, 'github_comment_create', 'repo', input.repoFullName);

      const resolved = await this.resolveGithubAdapterForConnection(connection.id);
      if (!resolved?.adapter.createIssueComment) {
        throw new RuntimeValidationError(`Connection ${connection.id} does not support GitHub comments`);
      }

      const approval = this.requireApprovedExternalWrite({
        scope: 'external_write',
        domain: 'github',
        actionKind: 'write',
        resourceScope: 'resource',
        resourceType: 'github_repo',
        resourceId: input.repoFullName,
        requestedBy: 'github_comment_create',
        payloadPreview: `Comment on ${input.repoFullName}#${input.issueNumber}: ${input.body.slice(0, 240)}`,
      });

      const comment = await resolved.adapter.createIssueComment(owner, repo, input.issueNumber, input.body);
      this.recordSecurityAudit({
        code: 'github_comment_created',
        severity: 'info',
        message: 'GitHub comment created',
        component: 'runtime-core',
        timestamp: nowIso(),
        details: {
          connectionId: connection.id,
          accountId: account.id,
          repoFullName: input.repoFullName,
          issueNumber: String(input.issueNumber),
          providerCommentId: comment.id,
          approvalId: approval.id,
          resolvedBy: approval.resolvedBy ?? '',
          resolvedByGrantId: approval.resolvedByGrantId ?? '',
        },
      });

      return {
        id: comment.id,
        accountId: account.id,
        repoFullName: input.repoFullName,
        issueNumber: input.issueNumber,
        bodyPreview: comment.bodyPreview,
        htmlUrl: comment.htmlUrl,
        createdAt: comment.createdAt,
      };
    } finally {
      writeDb.close();
    }
  }

  async markGithubNotificationRead(input: GithubNotificationMarkReadInput): Promise<GithubNotificationRecord> {
    const githubCap = this.capabilityRegistry.getCapability('github');
    if (!githubCap) throw new Error('GitHub capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/github.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new GithubService(writeDb as unknown as CapabilityContext['appDb']);
      const notification = svc.getNotification(input.notificationId);
      if (!notification) {
        throw new RuntimeNotFoundError(`GitHub notification ${input.notificationId} not found`);
      }
      const { account, connection } = this.requireGithubAccountForOperation(
        svc,
        notification.accountId,
        'github_notification_mark_read',
      );
      this.requireReadWriteConnection(connection, 'github_notification_mark_read');
      this.requireAllowlistedConnectionResource(
        connection,
        'github_notification_mark_read',
        'repo',
        notification.repoFullName,
      );

      const resolved = await this.resolveGithubAdapterForConnection(connection.id);
      if (!resolved?.adapter.markNotificationRead) {
        throw new RuntimeValidationError(`Connection ${connection.id} does not support notification mutations`);
      }

      const approval = this.requireApprovedExternalWrite({
        scope: 'external_write',
        domain: 'github',
        actionKind: 'write',
        resourceScope: 'resource',
        resourceType: 'github_notification',
        resourceId: notification.githubNotificationId,
        requestedBy: 'github_notification_mark_read',
        payloadPreview: `Mark GitHub notification as read: ${notification.subjectTitle}`,
      });

      await resolved.adapter.markNotificationRead(notification.githubNotificationId);
      const updated = svc.markNotificationRead(notification.id);
      const record = updated ?? { ...notification, isUnread: false, updatedAt: nowIso() };
      this.invalidateGithubFacade();

      this.recordSecurityAudit({
        code: 'github_notification_marked_read',
        severity: 'info',
        message: 'GitHub notification marked as read',
        component: 'runtime-core',
        timestamp: nowIso(),
        details: {
          connectionId: connection.id,
          accountId: account.id,
          notificationId: notification.id,
          providerNotificationId: notification.githubNotificationId,
          repoFullName: notification.repoFullName,
          approvalId: approval.id,
          resolvedBy: approval.resolvedBy ?? '',
          resolvedByGrantId: approval.resolvedByGrantId ?? '',
        },
      });

      return record;
    } finally {
      writeDb.close();
    }
  }

  // --- Email mutation methods ---

  registerEmailAccount(input: EmailAccountRegistrationInput): EmailAccountRecord {
    this.requireConnectionForOperation({
      connectionId: input.connectionId,
      purpose: 'email_account_register',
      expectedDomain: 'email',
      allowedProviderKinds: ['gmail', 'proton'],
      requireSecret: false,
    });

    // Use the write-capable email service from the capability
    const emailCap = this.capabilityRegistry.getCapability('email');
    if (!emailCap) throw new Error('Email capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/email.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new EmailService(writeDb as unknown as CapabilityContext['appDb']);
      return svc.registerAccount(input);
    } finally {
      writeDb.close();
    }
  }

  async syncEmailAccount(accountId: string): Promise<EmailSyncResult> {
    const emailCap = this.capabilityRegistry.getCapability('email');
    if (!emailCap) throw new Error('Email capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/email.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new EmailService(writeDb as unknown as CapabilityContext['appDb']);
      const { account, connection } = this.requireEmailAccountForOperation(svc, accountId, 'email_sync');
      const resolved = await this.resolveEmailAdapterForConnection(connection.id);
      if (!resolved) {
        throw new RuntimeValidationError(`Connection ${connection.id} could not resolve an email adapter`);
      }

      const attemptAt = nowIso();
      this.updateConnectionRollups({
        connectionId: connection.id,
        health: {
          checkedAt: attemptAt,
        },
        sync: {
          lastAttemptAt: attemptAt,
          cursorKind: connectionCursorKindForProvider(connection.providerKind),
        },
      });

      const ctx = this.buildCapabilityContext();
      const syncService = new EmailSyncService(svc, ctx);
      const result = await syncService.syncAccount(account, resolved.adapter);
      const refreshedAccount = svc.getAccount(account.id) ?? account;
      const successCount = result.synced + result.updated;
      const syncStatus = result.errors.length === 0
        ? 'success'
        : successCount > 0
          ? 'partial'
          : 'failed';
      const failureSummary = result.errors[0] ?? null;
      const failureState = failureSummary ? this.classifyConnectionFailure(failureSummary) : null;
      const successAt = syncStatus === 'failed' ? null : nowIso();

      this.updateConnectionRollups({
        connectionId: connection.id,
        health: failureSummary
          ? {
            status: syncStatus === 'partial' ? 'degraded' : failureState?.status ?? 'error',
            authState: syncStatus === 'partial' ? 'configured' : failureState?.authState ?? 'configured',
            checkedAt: nowIso(),
            lastError: failureSummary,
          }
          : {
            status: 'healthy',
            authState: 'configured',
            checkedAt: nowIso(),
            lastError: null,
          },
        sync: {
          ...(successAt ? { lastSuccessAt: successAt } : {}),
          status: syncStatus,
          cursorKind: connectionCursorKindForProvider(connection.providerKind),
          cursorPresent: Boolean(refreshedAccount.syncCursorHistoryId || refreshedAccount.syncCursorPageToken),
          lagSummary: refreshedAccount.syncCursorHistoryId
            ? `History cursor stored at ${refreshedAccount.syncCursorHistoryId}`
            : refreshedAccount.syncCursorPageToken
              ? 'Pagination cursor stored during mailbox sync'
              : 'Awaiting first sync cursor',
        },
      });

      this.invalidateEmailFacade();
      try {
        this.refreshPeopleProjectionForEmailAccount(svc, account.id);
      } catch (error) {
        this.log.warn('email people projection failed', {
          accountId: account.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return result;
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      const failure = this.classifyConnectionFailure(message);
      const account = this.listEmailAccounts().find((entry) => entry.id === accountId) ?? null;
      if (account) {
        this.updateConnectionRollups({
          connectionId: account.connectionId,
          health: {
            status: failure.status,
            authState: failure.authState,
            checkedAt: nowIso(),
            lastError: message,
          },
          sync: {
            lastAttemptAt: nowIso(),
            status: 'failed',
            cursorKind: 'history_id',
            lagSummary: 'Sync failed before a cursor could be updated',
          },
        });
      }
      throw error;
    } finally {
      writeDb.close();
    }
  }

  triggerEmailDigest(accountId?: string): EmailDigestRecord | null {
    const emailCap = this.capabilityRegistry.getCapability('email');
    if (!emailCap) return null;

    const dbPath = `${this.databases.paths.capabilityStoresDir}/email.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new EmailService(writeDb as unknown as CapabilityContext['appDb']);
      const candidateAccounts = accountId ? [svc.getAccount(accountId)].filter(Boolean) : svc.listAccounts();
      if (candidateAccounts.length === 0) return null;
      const accounts = candidateAccounts.map((account) => {
        if (!account) {
          throw new RuntimeValidationError(`Email account ${accountId} not found`);
        }
        return this.requireEmailAccountForOperation(svc, account.id, 'email_digest_generate').account;
      });

      const ctx = this.buildCapabilityContext();
      const digestService = new EmailDigestService(svc, ctx);

      let lastDigest: EmailDigestRecord | null = null;
      for (const account of accounts) {
        if (!account) continue;
        lastDigest = digestService.generateDigest(account);
      }

      this.invalidateEmailFacade();

      return lastDigest;
    } finally {
      writeDb.close();
    }
  }

  async createEmailDraft(input: EmailDraftCreateInput): Promise<EmailDraftRecord> {
    const emailCap = this.capabilityRegistry.getCapability('email');
    if (!emailCap) throw new Error('Email capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/email.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new EmailService(writeDb as unknown as CapabilityContext['appDb']);
      const { account, connection } = this.requireEmailAccountForOperation(svc, input.accountId, 'email_draft_create');
      this.requireReadWriteConnection(connection, 'email_draft_create');
      this.requireAllowlistedConnectionResource(connection, 'email_draft_create', 'mailbox', account.emailAddress);

      const resolved = await this.resolveEmailAdapterForConnection(connection.id);
      if (!resolved?.adapter.createDraft) {
        throw new RuntimeValidationError(`Connection ${connection.id} does not support draft creation`);
      }

      const approval = this.requireApprovedExternalWrite({
        scope: 'external_write',
        domain: 'email',
        actionKind: 'write',
        resourceScope: 'resource',
        resourceType: 'email_mailbox',
        resourceId: account.emailAddress,
        requestedBy: 'email_draft_create',
        payloadPreview: `Draft email to ${input.to.join(', ')}: ${input.subject}`,
      });

      const draft = await resolved.adapter.createDraft({
        to: input.to,
        cc: input.cc,
        subject: input.subject,
        body: input.body,
      });
      const stored = svc.upsertDraft({
        accountId: account.id,
        connectionId: connection.id,
        providerDraftId: draft.draftId,
        providerMessageId: draft.messageId ?? null,
        to: draft.to,
        cc: draft.cc,
        subject: draft.subject,
        bodyPreview: draft.bodyPreview,
      });
      this.invalidateEmailFacade();

      this.recordSecurityAudit({
        code: 'email_draft_created',
        severity: 'info',
        message: 'Email draft created',
        component: 'runtime-core',
        timestamp: nowIso(),
        details: {
          connectionId: connection.id,
          accountId: account.id,
          mailbox: account.emailAddress,
          providerDraftId: draft.draftId,
          providerMessageId: draft.messageId ?? '',
          approvalId: approval.id,
          resolvedBy: approval.resolvedBy ?? '',
          resolvedByGrantId: approval.resolvedByGrantId ?? '',
        },
      });

      return {
        ...stored,
        updatedAt: draft.updatedAt,
      };
    } finally {
      writeDb.close();
    }
  }

  async updateEmailDraft(id: string, input: EmailDraftUpdateInput): Promise<EmailDraftRecord> {
    const emailCap = this.capabilityRegistry.getCapability('email');
    if (!emailCap) throw new Error('Email capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/email.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new EmailService(writeDb as unknown as CapabilityContext['appDb']);
      const mappedDraft = svc.getDraftByProviderDraftId(id) ?? svc.getDraft(id);
      let accountId = mappedDraft?.accountId ?? input.accountId ?? null;
      if (!accountId) {
        throw new RuntimeValidationError(
          `Email draft ${id} is not mapped to an account. Provide accountId or recreate the draft through Popeye.`,
        );
      }
      const account = svc.getAccount(accountId);
      if (!account) {
        throw new RuntimeValidationError(`Email draft ${id} resolves to unknown account ${accountId}`);
      }
      const { connection } = this.requireEmailAccountForOperation(svc, account.id, 'email_draft_update');
      this.requireReadWriteConnection(connection, 'email_draft_update');
      this.requireAllowlistedConnectionResource(connection, 'email_draft_update', 'mailbox', account.emailAddress);

      const resolved = await this.resolveEmailAdapterForConnection(connection.id);
      if (!resolved?.adapter.updateDraft) {
        throw new RuntimeValidationError(`Connection ${connection.id} does not support draft updates`);
      }

      const approval = this.requireApprovedExternalWrite({
        scope: 'external_write',
        domain: 'email',
        actionKind: 'write',
        resourceScope: 'resource',
        resourceType: 'email_draft',
        resourceId: id,
        requestedBy: 'email_draft_update',
        payloadPreview: `Update email draft ${id}`,
      });

      const draft = await resolved.adapter.updateDraft(id, input);
      const stored = svc.upsertDraft({
        accountId: account.id,
        connectionId: connection.id,
        providerDraftId: draft.draftId,
        providerMessageId: draft.messageId ?? null,
        to: draft.to,
        cc: draft.cc,
        subject: draft.subject,
        bodyPreview: draft.bodyPreview,
      });
      this.invalidateEmailFacade();
      this.recordSecurityAudit({
        code: 'email_draft_updated',
        severity: 'info',
        message: 'Email draft updated',
        component: 'runtime-core',
        timestamp: nowIso(),
        details: {
          connectionId: connection.id,
          accountId: account.id,
          mailbox: account.emailAddress,
          providerDraftId: draft.draftId,
          providerMessageId: draft.messageId ?? '',
          approvalId: approval.id,
          resolvedBy: approval.resolvedBy ?? '',
          resolvedByGrantId: approval.resolvedByGrantId ?? '',
        },
      });

      return {
        ...stored,
        updatedAt: draft.updatedAt,
      };
    } finally {
      writeDb.close();
    }
  }

  // --- Calendar facade ---

  private calendarReadDb: BetterSqlite3.Database | null = null;
  private calendarServiceCache: CalendarService | null = null;
  private calendarSearchCache: CalendarSearchService | null = null;

  private getCalendarReadDb(): BetterSqlite3.Database | null {
    if (this.calendarReadDb) return this.calendarReadDb;
    const cap = this.capabilityRegistry.getCapability('calendar');
    if (!cap) return null;
    const dbPath = `${this.databases.paths.capabilityStoresDir}/calendar.db`;
    if (!existsSync(dbPath)) return null;
    this.calendarReadDb = new BetterSqlite3(dbPath, { readonly: true });
    return this.calendarReadDb;
  }

  private getCalendarServiceFacade(): CalendarService | null {
    if (this.calendarServiceCache) return this.calendarServiceCache;
    const db = this.getCalendarReadDb();
    if (!db) return null;
    this.calendarServiceCache = new CalendarService(db as unknown as CapabilityContext['appDb']);
    return this.calendarServiceCache;
  }

  private getCalendarSearchFacade(): CalendarSearchService | null {
    if (this.calendarSearchCache) return this.calendarSearchCache;
    const db = this.getCalendarReadDb();
    if (!db) return null;
    this.calendarSearchCache = new CalendarSearchService(db as unknown as CapabilityContext['appDb']);
    return this.calendarSearchCache;
  }

  listCalendarAccounts(): CalendarAccountRecord[] {
    return this.getCalendarServiceFacade()?.listAccounts() ?? [];
  }

  listCalendarEvents(accountId: string, options?: { limit?: number | undefined; dateFrom?: string | undefined; dateTo?: string | undefined }): CalendarEventRecord[] {
    const svc = this.getCalendarServiceFacade();
    if (!svc) return [];
    this.requireCalendarAccountForOperation(svc, accountId, 'calendar_event_list');
    return svc.listEvents(accountId, options);
  }

  getCalendarEvent(id: string): CalendarEventRecord | null {
    const svc = this.getCalendarServiceFacade();
    if (!svc) return null;
    const event = svc.getEvent(id);
    if (!event) return null;
    try {
      this.requireCalendarAccountForOperation(svc, event.accountId, 'calendar_event_read');
      return event;
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return null;
      }
      throw error;
    }
  }

  searchCalendar(query: CalendarSearchQuery): { query: string; results: CalendarSearchResult[] } {
    const svc = this.getCalendarServiceFacade();
    if (query.accountId && svc) {
      this.requireCalendarAccountForOperation(svc, query.accountId, 'calendar_search');
    }
    return this.getCalendarSearchFacade()?.search(query) ?? { query: query.query, results: [] };
  }

  getCalendarDigest(accountId: string): CalendarDigestRecord | null {
    const svc = this.getCalendarServiceFacade();
    if (!svc) return null;
    this.requireCalendarAccountForOperation(svc, accountId, 'calendar_digest_read');
    return svc.getLatestDigest(accountId);
  }

  getCalendarAvailability(accountId: string, date: string, startHour = 9, endHour = 17, slotMinutes = 30): CalendarAvailabilitySlot[] {
    const svc = this.getCalendarServiceFacade();
    if (!svc) return [];
    this.requireCalendarAccountForOperation(svc, accountId, 'calendar_availability_read');
    return svc.computeAvailability(accountId, date, startHour, endHour, slotMinutes);
  }

  registerCalendarAccount(input: CalendarAccountRegistrationInput): CalendarAccountRecord {
    this.requireConnectionForOperation({
      connectionId: input.connectionId,
      purpose: 'calendar_account_register',
      expectedDomain: 'calendar',
      allowedProviderKinds: ['google_calendar'],
      requireSecret: false,
    });

    const calCap = this.capabilityRegistry.getCapability('calendar');
    if (!calCap) throw new Error('Calendar capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/calendar.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new CalendarService(writeDb as unknown as CapabilityContext['appDb']);
      return svc.registerAccount(input);
    } finally {
      writeDb.close();
    }
  }

  async syncCalendarAccount(accountId: string): Promise<CalendarSyncResult> {
    const calCap = this.capabilityRegistry.getCapability('calendar');
    if (!calCap) throw new Error('Calendar capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/calendar.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new CalendarService(writeDb as unknown as CapabilityContext['appDb']);
      const { account, connection } = this.requireCalendarAccountForOperation(svc, accountId, 'calendar_sync');
      const resolved = await this.resolveCalendarAdapterForConnection(connection.id);
      if (!resolved) {
        throw new RuntimeValidationError(`Connection ${connection.id} could not resolve a calendar adapter`);
      }

      const attemptAt = nowIso();
      this.updateConnectionRollups({
        connectionId: connection.id,
        health: {
          checkedAt: attemptAt,
        },
        sync: {
          lastAttemptAt: attemptAt,
          cursorKind: connectionCursorKindForProvider(connection.providerKind),
        },
      });

      const ctx = this.buildCapabilityContext();
      const syncService = new CalendarSyncService(svc, ctx);
      const result = await syncService.syncAccount(account, resolved.adapter);
      const refreshedAccount = svc.getAccount(account.id) ?? account;
      const successCount = result.eventsSynced + result.eventsUpdated;
      const syncStatus = result.errors.length === 0
        ? 'success'
        : successCount > 0
          ? 'partial'
          : 'failed';
      const failureSummary = result.errors[0] ?? null;
      const failureState = failureSummary ? this.classifyConnectionFailure(failureSummary) : null;
      const successAt = syncStatus === 'failed' ? null : nowIso();

      this.updateConnectionRollups({
        connectionId: connection.id,
        health: failureSummary
          ? {
            status: syncStatus === 'partial' ? 'degraded' : failureState?.status ?? 'error',
            authState: syncStatus === 'partial' ? 'configured' : failureState?.authState ?? 'configured',
            checkedAt: nowIso(),
            lastError: failureSummary,
          }
          : {
            status: 'healthy',
            authState: 'configured',
            checkedAt: nowIso(),
            lastError: null,
          },
        sync: {
          ...(successAt ? { lastSuccessAt: successAt } : {}),
          status: syncStatus,
          cursorKind: connectionCursorKindForProvider(connection.providerKind),
          cursorPresent: Boolean(refreshedAccount.syncCursorSyncToken),
          lagSummary: refreshedAccount.syncCursorSyncToken
            ? 'Sync token stored for incremental calendar sync'
            : 'Awaiting first calendar sync token',
        },
      });

      this.invalidateCalendarFacade();
      try {
        this.refreshPeopleProjectionForCalendarAccount(svc, account.id);
      } catch (error) {
        this.log.warn('calendar people projection failed', {
          accountId: account.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return result;
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      const failure = this.classifyConnectionFailure(message);
      const account = this.listCalendarAccounts().find((entry) => entry.id === accountId) ?? null;
      if (account) {
        this.updateConnectionRollups({
          connectionId: account.connectionId,
          health: {
            status: failure.status,
            authState: failure.authState,
            checkedAt: nowIso(),
            lastError: message,
          },
          sync: {
            lastAttemptAt: nowIso(),
            status: 'failed',
            cursorKind: 'sync_token',
            lagSummary: 'Sync failed before a sync token could be updated',
          },
        });
      }
      throw error;
    } finally {
      writeDb.close();
    }
  }

  triggerCalendarDigest(accountId?: string): CalendarDigestRecord | null {
    const calCap = this.capabilityRegistry.getCapability('calendar');
    if (!calCap) return null;

    const dbPath = `${this.databases.paths.capabilityStoresDir}/calendar.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new CalendarService(writeDb as unknown as CapabilityContext['appDb']);
      const candidateAccounts = accountId ? [svc.getAccount(accountId)].filter(Boolean) : svc.listAccounts();
      if (candidateAccounts.length === 0) return null;
      const accounts = candidateAccounts.map((account) => {
        if (!account) {
          throw new RuntimeValidationError(`Calendar account ${accountId} not found`);
        }
        return this.requireCalendarAccountForOperation(svc, account.id, 'calendar_digest_generate').account;
      });

      const ctx = this.buildCapabilityContext();
      const digestService = new CalendarDigestService(svc, ctx);

      let lastDigest: CalendarDigestRecord | null = null;
      for (const account of accounts) {
        if (!account) continue;
        lastDigest = digestService.generateDigest(account);
      }

      this.invalidateCalendarFacade();

      return lastDigest;
    } finally {
      writeDb.close();
    }
  }

  async createCalendarEvent(input: CalendarEventCreateInput): Promise<CalendarEventRecord> {
    const calCap = this.capabilityRegistry.getCapability('calendar');
    if (!calCap) throw new Error('Calendar capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/calendar.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new CalendarService(writeDb as unknown as CapabilityContext['appDb']);
      const { account, connection } = this.requireCalendarAccountForOperation(svc, input.accountId, 'calendar_event_create');
      this.requireReadWriteConnection(connection, 'calendar_event_create');
      this.requireAllowlistedConnectionResource(connection, 'calendar_event_create', 'calendar', account.calendarEmail);

      const resolved = await this.resolveCalendarAdapterForConnection(connection.id);
      if (!resolved?.adapter.createEvent) {
        throw new RuntimeValidationError(`Connection ${connection.id} does not support calendar writes`);
      }

      const approval = this.requireApprovedExternalWrite({
        scope: 'external_write',
        domain: 'calendar',
        actionKind: 'write',
        resourceScope: 'resource',
        resourceType: 'calendar',
        resourceId: account.calendarEmail,
        requestedBy: 'calendar_event_create',
        payloadPreview: `Create calendar event: ${input.title}`,
      });

      const event = await resolved.adapter.createEvent({
        title: input.title,
        description: input.description,
        location: input.location,
        startTime: input.startTime,
        endTime: input.endTime,
        attendees: input.attendees,
      });

      const stored = svc.upsertEvent(account.id, {
        googleEventId: event.eventId,
        title: event.title,
        description: event.description,
        location: event.location,
        startTime: event.startTime,
        endTime: event.endTime,
        isAllDay: event.isAllDay,
        status: event.status,
        organizer: event.organizer,
        attendees: event.attendees,
        recurrenceRule: event.recurrenceRule,
        htmlLink: event.htmlLink,
        createdAtGoogle: event.createdAt,
        updatedAtGoogle: event.updatedAt,
      });
      svc.updateEventCount(account.id);
      this.invalidateCalendarFacade();

      this.recordSecurityAudit({
        code: 'calendar_event_created',
        severity: 'info',
        message: 'Calendar event created',
        component: 'runtime-core',
        timestamp: nowIso(),
        details: {
          connectionId: connection.id,
          accountId: account.id,
          calendarEmail: account.calendarEmail,
          providerEventId: event.eventId,
          approvalId: approval.id,
          resolvedBy: approval.resolvedBy ?? '',
          resolvedByGrantId: approval.resolvedByGrantId ?? '',
        },
      });

      return stored;
    } finally {
      writeDb.close();
    }
  }

  async updateCalendarEvent(id: string, input: CalendarEventUpdateInput): Promise<CalendarEventRecord> {
    const calCap = this.capabilityRegistry.getCapability('calendar');
    if (!calCap) throw new Error('Calendar capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/calendar.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new CalendarService(writeDb as unknown as CapabilityContext['appDb']);
      const existing = svc.getEvent(id);
      if (!existing) {
        throw new RuntimeNotFoundError(`Calendar event ${id} not found`);
      }
      const { account, connection } = this.requireCalendarAccountForOperation(svc, existing.accountId, 'calendar_event_update');
      this.requireReadWriteConnection(connection, 'calendar_event_update');
      this.requireAllowlistedConnectionResource(connection, 'calendar_event_update', 'calendar', account.calendarEmail);

      const resolved = await this.resolveCalendarAdapterForConnection(connection.id);
      if (!resolved?.adapter.updateEvent) {
        throw new RuntimeValidationError(`Connection ${connection.id} does not support calendar writes`);
      }

      const approval = this.requireApprovedExternalWrite({
        scope: 'external_write',
        domain: 'calendar',
        actionKind: 'write',
        resourceScope: 'resource',
        resourceType: 'calendar_event',
        resourceId: existing.googleEventId,
        requestedBy: 'calendar_event_update',
        payloadPreview: `Update calendar event: ${existing.title}`,
      });

      const event = await resolved.adapter.updateEvent(existing.googleEventId, input);
      const stored = svc.upsertEvent(account.id, {
        googleEventId: event.eventId,
        title: event.title,
        description: event.description,
        location: event.location,
        startTime: event.startTime,
        endTime: event.endTime,
        isAllDay: event.isAllDay,
        status: event.status,
        organizer: event.organizer,
        attendees: event.attendees,
        recurrenceRule: event.recurrenceRule,
        htmlLink: event.htmlLink,
        createdAtGoogle: event.createdAt,
        updatedAtGoogle: event.updatedAt,
      });
      svc.updateEventCount(account.id);
      this.invalidateCalendarFacade();

      this.recordSecurityAudit({
        code: 'calendar_event_updated',
        severity: 'info',
        message: 'Calendar event updated',
        component: 'runtime-core',
        timestamp: nowIso(),
        details: {
          connectionId: connection.id,
          accountId: account.id,
          calendarEmail: account.calendarEmail,
          providerEventId: event.eventId,
          approvalId: approval.id,
          resolvedBy: approval.resolvedBy ?? '',
          resolvedByGrantId: approval.resolvedByGrantId ?? '',
        },
      });

      return stored;
    } finally {
      writeDb.close();
    }
  }

  // --- Todos facade ---

  private todosReadDb: BetterSqlite3.Database | null = null;
  private todosServiceCache: TodoService | null = null;
  private todosSearchCache: TodoSearchService | null = null;

  private getTodosReadDb(): BetterSqlite3.Database | null {
    if (this.todosReadDb) return this.todosReadDb;
    const cap = this.capabilityRegistry.getCapability('todos');
    if (!cap) return null;
    const dbPath = `${this.databases.paths.capabilityStoresDir}/todos.db`;
    if (!existsSync(dbPath)) return null;
    this.todosReadDb = new BetterSqlite3(dbPath, { readonly: true });
    return this.todosReadDb;
  }

  private getTodosServiceFacade(): TodoService | null {
    if (this.todosServiceCache) return this.todosServiceCache;
    const db = this.getTodosReadDb();
    if (!db) return null;
    this.todosServiceCache = new TodoService(db as unknown as CapabilityContext['appDb']);
    return this.todosServiceCache;
  }

  private getTodosSearchFacade(): TodoSearchService | null {
    if (this.todosSearchCache) return this.todosSearchCache;
    const db = this.getTodosReadDb();
    if (!db) return null;
    this.todosSearchCache = new TodoSearchService(db as unknown as CapabilityContext['appDb']);
    return this.todosSearchCache;
  }

  listTodoAccounts(): TodoAccountRecord[] {
    return this.getTodosServiceFacade()?.listAccounts() ?? [];
  }

  listTodos(accountId: string, options?: { status?: string | undefined; priority?: number | undefined; projectName?: string | undefined; limit?: number | undefined }): TodoItemRecord[] {
    const svc = this.getTodosServiceFacade();
    if (!svc) return [];
    this.requireTodoAccountForOperation(svc, accountId, 'todo_list');
    return svc.listItems(accountId, options);
  }

  getTodo(id: string): TodoItemRecord | null {
    const svc = this.getTodosServiceFacade();
    if (!svc) return null;
    const todo = svc.getItem(id);
    if (!todo) return null;
    try {
      this.requireTodoAccountForOperation(svc, todo.accountId, 'todo_read');
      return todo;
    } catch (error) {
      if (error instanceof RuntimeValidationError) {
        return null;
      }
      throw error;
    }
  }

  searchTodos(query: TodoSearchQuery): { query: string; results: TodoSearchResult[] } {
    const svc = this.getTodosServiceFacade();
    if (query.accountId && svc) {
      this.requireTodoAccountForOperation(svc, query.accountId, 'todo_search');
    }
    return this.getTodosSearchFacade()?.search(query) ?? { query: query.query, results: [] };
  }

  getTodoDigest(accountId: string): TodoDigestRecord | null {
    const svc = this.getTodosServiceFacade();
    if (!svc) return null;
    this.requireTodoAccountForOperation(svc, accountId, 'todo_digest_read');
    return svc.getLatestDigest(accountId);
  }

  connectTodoist(input: TodoistConnectInput): TodoistConnectResult {
    const existingConnection = this
      .listConnections('todos')
      .find((connection) => connection.providerKind === 'todoist') ?? null;

    let connection = existingConnection;
    if (!connection) {
      connection = this.createConnection({
        domain: 'todos',
        providerKind: 'todoist',
        label: input.label,
        mode: input.mode,
        secretRefId: null,
        syncIntervalSeconds: input.syncIntervalSeconds,
        allowedScopes: [],
        allowedResources: [],
        resourceRules: [],
      });
    } else {
      connection = this.updateConnection(connection.id, {
        label: input.label,
        mode: input.mode,
        syncIntervalSeconds: input.syncIntervalSeconds,
      }) ?? connection;
    }

    const secretRef = connection.secretRefId
      ? (this.secretStore.rotateSecret(connection.secretRefId, input.apiToken) ?? this.secretStore.setSecret({
        provider: 'keychain',
        key: 'todoist-api-token',
        value: input.apiToken,
        connectionId: connection.id,
        description: 'Todoist API token',
      }))
      : this.secretStore.setSecret({
        provider: 'keychain',
        key: 'todoist-api-token',
        value: input.apiToken,
        connectionId: connection.id,
        description: 'Todoist API token',
      });

    connection = this.updateConnection(connection.id, { secretRefId: secretRef.id }) ?? connection;

    const todosCap = this.capabilityRegistry.getCapability('todos');
    if (!todosCap) throw new Error('Todos capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/todos.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new TodoService(writeDb as unknown as CapabilityContext['appDb']);
      const account = svc.getAccountByConnection(connection.id)
        ?? svc.registerAccount({
          connectionId: connection.id,
          providerKind: 'todoist',
          displayName: input.displayName,
        });
      this.updateConnectionRollups({
        connectionId: connection.id,
        health: {
          status: 'healthy',
          authState: 'configured',
          checkedAt: nowIso(),
          lastError: null,
          diagnostics: [],
        },
        sync: {
          status: 'idle',
          cursorKind: 'since',
          cursorPresent: false,
          lagSummary: 'Awaiting first sync',
        },
      });
      if (this.todosReadDb) {
        this.todosReadDb.close();
        this.todosReadDb = null;
        this.todosServiceCache = null;
        this.todosSearchCache = null;
      }
      return { connectionId: connection.id, account };
    } finally {
      writeDb.close();
    }
  }

  registerTodoAccount(input: TodoAccountRegistrationInput): TodoAccountRecord {
    // Local accounts don't need a connection
    if (input.connectionId) {
      this.requireConnectionForOperation({
        connectionId: input.connectionId,
        purpose: 'todo_account_register',
        expectedDomain: 'todos',
        allowedProviderKinds: ['todoist', 'local'],
        requireSecret: false,
      });
    }

    const todosCap = this.capabilityRegistry.getCapability('todos');
    if (!todosCap) throw new Error('Todos capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/todos.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new TodoService(writeDb as unknown as CapabilityContext['appDb']);
      return svc.registerAccount(input);
    } finally {
      writeDb.close();
    }
  }

  createTodo(input: TodoCreateInput): TodoItemRecord {
    const todosCap = this.capabilityRegistry.getCapability('todos');
    if (!todosCap) throw new Error('Todos capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/todos.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new TodoService(writeDb as unknown as CapabilityContext['appDb']);
      this.requireTodoAccountForOperation(svc, input.accountId, 'todo_create');
      const data: { title: string; description?: string; priority?: number; dueDate?: string; dueTime?: string; labels?: string[]; projectName?: string } = { title: input.title };
      if (input.description !== undefined) data.description = input.description;
      if (input.priority !== undefined) data.priority = input.priority;
      if (input.dueDate !== undefined) data.dueDate = input.dueDate;
      if (input.dueTime !== undefined) data.dueTime = input.dueTime;
      if (input.labels !== undefined) data.labels = input.labels;
      if (input.projectName !== undefined) data.projectName = input.projectName;
      const result = svc.createItem(input.accountId, data);

      if (this.todosReadDb) {
        this.todosReadDb.close();
        this.todosReadDb = null;
        this.todosServiceCache = null;
        this.todosSearchCache = null;
      }

      return result;
    } finally {
      writeDb.close();
    }
  }

  completeTodo(id: string): TodoItemRecord | null {
    const todosCap = this.capabilityRegistry.getCapability('todos');
    if (!todosCap) throw new Error('Todos capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/todos.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new TodoService(writeDb as unknown as CapabilityContext['appDb']);
      const existing = svc.getItem(id);
      if (!existing) {
        return null;
      }
      this.requireTodoAccountForOperation(svc, existing.accountId, 'todo_complete');
      svc.completeItem(id);
      const result = svc.getItem(id);

      if (this.todosReadDb) {
        this.todosReadDb.close();
        this.todosReadDb = null;
        this.todosServiceCache = null;
        this.todosSearchCache = null;
      }

      return result;
    } finally {
      writeDb.close();
    }
  }

  reprioritizeTodo(todoId: string, priority: number): TodoItemRecord | null {
    const todosCap = this.capabilityRegistry.getCapability('todos');
    if (!todosCap) throw new Error('Todos capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/todos.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new TodoService(writeDb as unknown as CapabilityContext['appDb']);
      const existing = svc.getItem(todoId);
      if (!existing) return null;
      this.requireTodoAccountForOperation(svc, existing.accountId, 'todo_reprioritize');
      const result = svc.reprioritizeItem(todoId, priority);
      if (this.todosReadDb) { this.todosReadDb.close(); this.todosReadDb = null; this.todosServiceCache = null; this.todosSearchCache = null; }
      return result;
    } finally { writeDb.close(); }
  }

  rescheduleTodo(todoId: string, dueDate: string, dueTime?: string | null): TodoItemRecord | null {
    const todosCap = this.capabilityRegistry.getCapability('todos');
    if (!todosCap) throw new Error('Todos capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/todos.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new TodoService(writeDb as unknown as CapabilityContext['appDb']);
      const existing = svc.getItem(todoId);
      if (!existing) return null;
      this.requireTodoAccountForOperation(svc, existing.accountId, 'todo_reschedule');
      const result = svc.rescheduleItem(todoId, dueDate, dueTime);
      if (this.todosReadDb) { this.todosReadDb.close(); this.todosReadDb = null; this.todosServiceCache = null; this.todosSearchCache = null; }
      return result;
    } finally { writeDb.close(); }
  }

  moveTodo(todoId: string, projectName: string): TodoItemRecord | null {
    const todosCap = this.capabilityRegistry.getCapability('todos');
    if (!todosCap) throw new Error('Todos capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/todos.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new TodoService(writeDb as unknown as CapabilityContext['appDb']);
      const existing = svc.getItem(todoId);
      if (!existing) return null;
      this.requireTodoAccountForOperation(svc, existing.accountId, 'todo_move');
      const result = svc.moveItem(todoId, projectName);
      if (this.todosReadDb) { this.todosReadDb.close(); this.todosReadDb = null; this.todosServiceCache = null; this.todosSearchCache = null; }
      return result;
    } finally { writeDb.close(); }
  }

  listTodoProjects(accountId: string): TodoProjectRecord[] {
    const svc = this.getTodosServiceFacade();
    if (!svc) return [];
    this.requireTodoAccountForOperation(svc, accountId, 'todo_projects_list');
    return svc.listProjects(accountId);
  }

  async reconcileTodos(accountId: string): Promise<TodoReconcileResult> {
    const todosCap = this.capabilityRegistry.getCapability('todos');
    if (!todosCap) throw new Error('Todos capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/todos.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new TodoService(writeDb as unknown as CapabilityContext['appDb']);
      const { account, connection } = this.requireTodoAccountForOperation(svc, accountId, 'todo_reconcile', { requireSecret: true });

      let adapter;
      if (account.providerKind === 'local') {
        adapter = new LocalTodoAdapter();
      } else if (account.providerKind === 'todoist') {
        if (!connection?.secretRefId) throw new RuntimeValidationError('Todoist account has no usable connection secret');
        const apiToken = this.secretStore.getSecretValue(connection.secretRefId!);
        if (!apiToken) throw new RuntimeValidationError('Failed to retrieve Todoist API token from SecretStore');
        adapter = new TodoistAdapter({ apiToken });
      } else {
        throw new Error(`Unsupported todo provider: ${account.providerKind}`);
      }

      const ctx = this.buildCapabilityContext();
      const syncService = new TodoSyncService(svc, ctx);
      const syncResult = await syncService.syncAccount(account, adapter);

      if (this.todosReadDb) { this.todosReadDb.close(); this.todosReadDb = null; this.todosServiceCache = null; this.todosSearchCache = null; }

      return {
        accountId,
        added: syncResult.todosSynced,
        updated: syncResult.todosUpdated,
        removed: 0,
        errors: syncResult.errors,
      };
    } finally { writeDb.close(); }
  }

  async syncTodoAccount(accountId: string): Promise<TodoSyncResult> {
    const todosCap = this.capabilityRegistry.getCapability('todos');
    if (!todosCap) throw new Error('Todos capability not initialized');

    const dbPath = `${this.databases.paths.capabilityStoresDir}/todos.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new TodoService(writeDb as unknown as CapabilityContext['appDb']);
      const { account, connection } = this.requireTodoAccountForOperation(svc, accountId, 'todo_sync', {
        requireSecret: true,
      });

      const ctx = this.buildCapabilityContext();
      const syncService = new TodoSyncService(svc, ctx);

      // Resolve adapter based on provider kind
      let adapter;
      if (account.providerKind === 'local') {
        adapter = new LocalTodoAdapter();
      } else if (account.providerKind === 'todoist') {
        if (!connection?.secretRefId) {
          throw new RuntimeValidationError('Todoist account has no usable connection secret');
        }
        const apiToken = this.secretStore.getSecretValue(connection.secretRefId!);
        if (!apiToken) {
          throw new RuntimeValidationError('Failed to retrieve Todoist API token from SecretStore');
        }
        adapter = new TodoistAdapter({ apiToken });
      } else {
        throw new Error(`Unsupported todo provider: ${account.providerKind}`);
      }

      const result = await syncService.syncAccount(account, adapter);

      if (this.todosReadDb) {
        this.todosReadDb.close();
        this.todosReadDb = null;
        this.todosServiceCache = null;
        this.todosSearchCache = null;
      }

      return result;
    } finally {
      writeDb.close();
    }
  }

  triggerTodoDigest(accountId?: string): TodoDigestRecord | null {
    const todosCap = this.capabilityRegistry.getCapability('todos');
    if (!todosCap) return null;

    const dbPath = `${this.databases.paths.capabilityStoresDir}/todos.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new TodoService(writeDb as unknown as CapabilityContext['appDb']);
      const candidateAccounts = accountId ? [svc.getAccount(accountId)].filter(Boolean) : svc.listAccounts();
      if (candidateAccounts.length === 0) return null;
      const accounts = candidateAccounts.map((account) => {
        if (!account) {
          throw new RuntimeValidationError(`Todo account ${accountId} not found`);
        }
        return this.requireTodoAccountForOperation(svc, account.id, 'todo_digest_generate').account;
      });

      const ctx = this.buildCapabilityContext();
      const digestService = new TodoDigestService(svc, ctx);

      let lastDigest: TodoDigestRecord | null = null;
      for (const account of accounts) {
        if (!account) continue;
        lastDigest = digestService.generateDigest(account);
      }

      if (this.todosReadDb) {
        this.todosReadDb.close();
        this.todosReadDb = null;
        this.todosServiceCache = null;
        this.todosSearchCache = null;
      }

      return lastDigest;
    } finally {
      writeDb.close();
    }
  }

  // --- People facade ---

  private peopleReadDb: BetterSqlite3.Database | null = null;
  private peopleServiceCache: PeopleService | null = null;

  private getPeopleReadDb(): BetterSqlite3.Database | null {
    if (this.peopleReadDb) return this.peopleReadDb;
    const cap = this.capabilityRegistry.getCapability('people');
    if (!cap) return null;
    const dbPath = `${this.databases.paths.capabilityStoresDir}/people.db`;
    if (!existsSync(dbPath)) return null;
    this.peopleReadDb = new BetterSqlite3(dbPath, { readonly: true });
    return this.peopleReadDb;
  }

  private getPeopleServiceFacade(): PeopleService | null {
    if (this.peopleServiceCache) return this.peopleServiceCache;
    const db = this.getPeopleReadDb();
    if (!db) return null;
    this.peopleServiceCache = new PeopleService(db as unknown as CapabilityContext['appDb']);
    return this.peopleServiceCache;
  }

  private invalidatePeopleFacade(): void {
    if (this.peopleReadDb) {
      this.peopleReadDb.close();
      this.peopleReadDb = null;
    }
    this.peopleServiceCache = null;
  }

  listPeople(): PersonListItem[] {
    return this.getPeopleServiceFacade()?.listPeople() ?? [];
  }

  getPerson(id: string): PersonRecord | null {
    return this.getPeopleServiceFacade()?.getPerson(id) ?? null;
  }

  searchPeople(query: PersonSearchQuery): { query: string; results: PersonSearchResult[] } {
    const svc = this.getPeopleServiceFacade();
    if (!svc) {
      return { query: query.query, results: [] };
    }
    return svc.searchPeople(query.query, query.limit);
  }

  updatePerson(id: string, input: PersonUpdateInput): PersonRecord | null {
    const peopleCap = this.capabilityRegistry.getCapability('people');
    if (!peopleCap) throw new Error('People capability not initialized');
    const dbPath = `${this.databases.paths.capabilityStoresDir}/people.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new PeopleService(writeDb as unknown as CapabilityContext['appDb']);
      const updated = svc.updatePerson(id, input);
      this.invalidatePeopleFacade();
      return updated;
    } finally {
      writeDb.close();
    }
  }

  mergePeople(input: PersonMergeInput): PersonRecord {
    const peopleCap = this.capabilityRegistry.getCapability('people');
    if (!peopleCap) throw new Error('People capability not initialized');
    const dbPath = `${this.databases.paths.capabilityStoresDir}/people.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new PeopleService(writeDb as unknown as CapabilityContext['appDb']);
      const merged = svc.mergePeople(input);
      this.invalidatePeopleFacade();
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
    } finally {
      writeDb.close();
    }
  }

  splitPerson(personId: string, input: PersonSplitInput): PersonRecord {
    const peopleCap = this.capabilityRegistry.getCapability('people');
    if (!peopleCap) throw new Error('People capability not initialized');
    const dbPath = `${this.databases.paths.capabilityStoresDir}/people.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new PeopleService(writeDb as unknown as CapabilityContext['appDb']);
      const split = svc.splitPerson(personId, input);
      this.invalidatePeopleFacade();
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
    } finally {
      writeDb.close();
    }
  }

  attachPersonIdentity(input: PersonIdentityAttachInput): PersonRecord {
    const peopleCap = this.capabilityRegistry.getCapability('people');
    if (!peopleCap) throw new Error('People capability not initialized');
    const dbPath = `${this.databases.paths.capabilityStoresDir}/people.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new PeopleService(writeDb as unknown as CapabilityContext['appDb']);
      const updated = svc.attachIdentity(input);
      this.invalidatePeopleFacade();
      return updated;
    } finally {
      writeDb.close();
    }
  }

  detachPersonIdentity(identityId: string, input: PersonIdentityDetachInput): PersonRecord {
    const peopleCap = this.capabilityRegistry.getCapability('people');
    if (!peopleCap) throw new Error('People capability not initialized');
    const dbPath = `${this.databases.paths.capabilityStoresDir}/people.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new PeopleService(writeDb as unknown as CapabilityContext['appDb']);
      const detached = svc.detachIdentity(identityId, input.requestedBy);
      this.invalidatePeopleFacade();
      return detached;
    } finally {
      writeDb.close();
    }
  }

  listPersonMergeEvents(personId?: string): PersonMergeEventRecord[] {
    return this.getPeopleServiceFacade()?.listMergeEvents(personId) ?? [];
  }

  getPersonMergeSuggestions(): PersonMergeSuggestion[] {
    return this.getPeopleServiceFacade()?.getMergeSuggestions() ?? [];
  }

  getPersonActivityRollups(personId: string): PersonActivityRollup[] {
    return this.getPeopleServiceFacade()?.getActivityRollups(personId) ?? [];
  }

  private refreshPeopleProjectionForEmailAccount(service: EmailService, accountId: string): void {
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

  private refreshPeopleProjectionForCalendarAccount(service: CalendarService, accountId: string): void {
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

  private refreshPeopleProjectionForGithubAccount(service: GithubService, accountId: string): void {
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
    const dbPath = `${this.databases.paths.capabilityStoresDir}/people.db`;
    const writeDb = new BetterSqlite3(dbPath);
    try {
      const svc = new PeopleService(writeDb as unknown as CapabilityContext['appDb']);
      for (const seed of deduped.values()) {
        svc.projectSeed(seed);
      }
      this.invalidatePeopleFacade();
    } finally {
      writeDb.close();
    }
  }

  private buildCapabilityContext(): CapabilityContext {
    return {
      appDb: this.databases.app as unknown as CapabilityContext['appDb'],
      memoryDb: this.databases.memory as unknown as CapabilityContext['memoryDb'],
      paths: this.databases.paths,
      config: this.config as unknown as Record<string, unknown>,
      log: this.log,
      auditCallback: (event) => {
        this.recordSecurityAuditEvent({
          code: event.eventType,
          severity: event.severity === 'error' ? 'error' : event.severity === 'warning' ? 'warn' : 'info',
          message: event.eventType,
          component: 'cap-email',
          timestamp: nowIso(),
          details: Object.fromEntries(
            Object.entries(event.details).map(([k, v]) => [k, String(v)]),
          ),
        });
      },
      memoryInsert: (input) => {
        const insertInput = {
          description: input.description,
          classification: input.classification,
          sourceType: input.sourceType as MemoryInsertInput['sourceType'],
          content: input.content,
          confidence: input.confidence,
          scope: input.scope,
          ...(input.memoryType ? { memoryType: input.memoryType as MemoryInsertInput['memoryType'] } : {}),
          ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
          ...(input.sourceRefType ? { sourceRefType: input.sourceRefType } : {}),
          ...(input.domain ? { domain: input.domain as MemoryInsertInput['domain'] } : {}),
          ...(input.contextReleasePolicy ? { contextReleasePolicy: input.contextReleasePolicy as MemoryInsertInput['contextReleasePolicy'] } : {}),
          ...(input.dedupKey ? { dedupKey: input.dedupKey } : {}),
        } satisfies MemoryInsertInput;
        const result = this.memoryLifecycle.insertMemory(insertInput);
        return {
          memoryId: result.memoryId,
          embedded: result.embedded,
          ...(result.rejected !== undefined ? { rejected: result.rejected } : {}),
          ...(result.rejectionReason !== undefined ? { rejectionReason: result.rejectionReason } : {}),
        };
      },
      approvalRequest: (input) => this.requestApproval(input),
      actionApprovalRequest: (input) => this.requestActionApproval(input),
      contextReleaseRecord: (input) => this.contextReleaseService.recordRelease(input),
      getExecutionEnvelope: (runId) => this.getExecutionEnvelope(runId),
      authorizeContextRelease: (input) => this.authorizeContextRelease(input),
      events: this.events,
      resolveEmailAdapter: (connectionId) => this.resolveEmailAdapterForConnection(connectionId),
      resolveCalendarAdapter: (connectionId) => this.resolveCalendarAdapterForConnection(connectionId),
      resolveGithubAdapter: (connectionId) => this.resolveGithubAdapterForConnection(connectionId),
    };
  }
}

export function createRuntimeService(config: AppConfig, engineOverride?: EngineAdapter, loggerOverride?: PopeyeLogger): PopeyeRuntimeService {
  return new PopeyeRuntimeService(config, engineOverride, loggerOverride);
}
