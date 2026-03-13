import { z } from 'zod';

export const DataClassificationSchema = z.enum(['secret', 'sensitive', 'internal', 'embeddable']);
export type DataClassification = z.infer<typeof DataClassificationSchema>;

export const EmbeddingEligibilitySchema = z.enum(['allow', 'deny']);
export type EmbeddingEligibility = z.infer<typeof EmbeddingEligibilitySchema>;

export const PromptScanVerdictSchema = z.enum(['allow', 'sanitize', 'quarantine']);
export type PromptScanVerdict = z.infer<typeof PromptScanVerdictSchema>;

export const EngineKindSchema = z.enum(['fake', 'pi']);
export type EngineKind = z.infer<typeof EngineKindSchema>;

export const EngineFailureClassificationSchema = z.enum([
  'none',
  'startup_failure',
  'transient_failure',
  'permanent_failure',
  'auth_failure',
  'policy_failure',
  'cancelled',
  'protocol_error',
]);
export type EngineFailureClassification = z.infer<typeof EngineFailureClassificationSchema>;

export const SecurityAuditEventSchema = z.object({
  code: z.string(),
  severity: z.enum(['info', 'warn', 'error']),
  message: z.string(),
  component: z.string(),
  timestamp: z.string(),
  details: z.record(z.string(), z.string()).default({}),
});
export type SecurityAuditEvent = z.infer<typeof SecurityAuditEventSchema>;

export const AuthTokenRecordSchema = z.object({
  token: z.string().min(32),
  createdAt: z.string(),
  expiresAt: z.string().optional(),
});
export type AuthTokenRecord = z.infer<typeof AuthTokenRecordSchema>;

export const AuthRotationRecordSchema = z.object({
  current: AuthTokenRecordSchema,
  next: AuthTokenRecordSchema.optional(),
  overlapEndsAt: z.string().optional(),
});
export type AuthRotationRecord = z.infer<typeof AuthRotationRecordSchema>;

export const SecurityConfigSchema = z.object({
  bindHost: z.literal('127.0.0.1'),
  bindPort: z.number().int().min(1).max(65535).default(3210),
  redactionPatterns: z.array(z.string()).default([]),
});
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;

export const TelegramConfigSchema = z.object({
  enabled: z.boolean().default(false),
  allowedUserId: z.string().min(1).optional(),
  maxMessagesPerMinute: z.number().int().positive().default(10),
  rateLimitWindowSeconds: z.number().int().positive().default(60),
});
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;

export const EmbeddingConfigSchema = z.object({
  provider: z.enum(['disabled', 'openai']).default('disabled'),
  allowedClassifications: z.array(DataClassificationSchema).default(['embeddable']),
});
export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;

export const EngineConfigSchema = z.object({
  kind: EngineKindSchema.default('fake'),
  piPath: z.string().optional(),
  command: z.string().default('node'),
  args: z.array(z.string()).default([]),
});
export type EngineConfig = z.infer<typeof EngineConfigSchema>;

export const WorkspaceConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  heartbeatEnabled: z.boolean().default(true),
  heartbeatIntervalSeconds: z.number().int().positive().default(3600),
});
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

export const AppConfigSchema = z.object({
  runtimeDataDir: z.string().min(1),
  authFile: z.string().min(1),
  security: SecurityConfigSchema,
  telegram: TelegramConfigSchema,
  embeddings: EmbeddingConfigSchema,
  engine: EngineConfigSchema.default({ kind: 'fake', command: 'node', args: [] }),
  workspaces: z.array(WorkspaceConfigSchema).default([
    {
      id: 'default',
      name: 'Default workspace',
      heartbeatEnabled: true,
      heartbeatIntervalSeconds: 3600,
    },
  ]),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

export const RuntimePathsSchema = z.object({
  runtimeDataDir: z.string(),
  configDir: z.string(),
  stateDir: z.string(),
  appDbPath: z.string(),
  memoryDbPath: z.string(),
  logsDir: z.string(),
  runLogsDir: z.string(),
  receiptsDir: z.string(),
  receiptsByRunDir: z.string(),
  receiptsByDayDir: z.string(),
  backupsDir: z.string(),
});
export type RuntimePaths = z.infer<typeof RuntimePathsSchema>;

export const PromptScanResultSchema = z.object({
  verdict: PromptScanVerdictSchema,
  sanitizedText: z.string(),
  matchedRules: z.array(z.string()).default([]),
});
export type PromptScanResult = z.infer<typeof PromptScanResultSchema>;

export const CriticalFileMutationRequestSchema = z.object({
  path: z.string(),
  approved: z.boolean().default(false),
});
export type CriticalFileMutationRequest = z.infer<typeof CriticalFileMutationRequestSchema>;

export const CriticalFilePolicyDecisionSchema = z.object({
  allowed: z.boolean(),
  reason: z.string(),
  requiresReceipt: z.boolean(),
});
export type CriticalFilePolicyDecision = z.infer<typeof CriticalFilePolicyDecisionSchema>;

export const InstructionSourceSchema = z.object({
  precedence: z.number().int().min(1).max(9),
  type: z.enum([
    'pi_base',
    'popeye_base',
    'global_operator',
    'workspace',
    'project',
    'identity',
    'task_brief',
    'trigger_overlay',
    'runtime_notes',
  ]),
  path: z.string().optional(),
  inlineId: z.string().optional(),
  contentHash: z.string(),
  content: z.string(),
});
export type InstructionSource = z.infer<typeof InstructionSourceSchema>;

export const CompiledInstructionBundleSchema = z.object({
  id: z.string(),
  sources: z.array(InstructionSourceSchema),
  compiledText: z.string(),
  bundleHash: z.string(),
  warnings: z.array(z.string()),
  createdAt: z.string(),
});
export type CompiledInstructionBundle = z.infer<typeof CompiledInstructionBundleSchema>;

export const SessionRootKindSchema = z.enum([
  'interactive_main',
  'system_heartbeat',
  'scheduled_task',
  'recovery',
  'telegram_user',
]);
export type SessionRootKind = z.infer<typeof SessionRootKindSchema>;

export const SessionRootRecordSchema = z.object({
  id: z.string(),
  kind: SessionRootKindSchema,
  scope: z.string(),
  createdAt: z.string(),
});
export type SessionRootRecord = z.infer<typeof SessionRootRecordSchema>;

export const RetryPolicySchema = z.object({
  maxAttempts: z.number().int().positive().default(3),
  baseDelaySeconds: z.number().int().positive().default(5),
  multiplier: z.number().positive().default(2),
  maxDelaySeconds: z.number().int().positive().default(900),
});
export type RetryPolicy = z.infer<typeof RetryPolicySchema>;

export const TaskSideEffectProfileSchema = z.enum(['read_only', 'external_side_effect']);
export type TaskSideEffectProfile = z.infer<typeof TaskSideEffectProfileSchema>;

export const InterventionCodeSchema = z.enum([
  'needs_credentials',
  'needs_policy_decision',
  'needs_instruction_fix',
  'needs_workspace_fix',
  'needs_operator_input',
  'retry_budget_exhausted',
  'auth_failure',
  'prompt_injection_quarantined',
  'failed_final',
]);
export type InterventionCode = z.infer<typeof InterventionCodeSchema>;

export const JobStateSchema = z.enum([
  'queued',
  'leased',
  'running',
  'waiting_retry',
  'paused',
  'blocked_operator',
  'succeeded',
  'failed_final',
  'cancelled',
]);
export type JobState = z.infer<typeof JobStateSchema>;

export const RunStateSchema = z.enum([
  'starting',
  'running',
  'succeeded',
  'failed_retryable',
  'failed_final',
  'cancelled',
  'abandoned',
]);
export type RunState = z.infer<typeof RunStateSchema>;

export const TaskRecordSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string().nullable(),
  title: z.string(),
  prompt: z.string(),
  source: z.enum(['manual', 'heartbeat', 'schedule', 'telegram', 'api']),
  status: z.enum(['active', 'paused']).default('active'),
  retryPolicy: RetryPolicySchema,
  sideEffectProfile: TaskSideEffectProfileSchema,
  createdAt: z.string(),
});
export type TaskRecord = z.infer<typeof TaskRecordSchema>;

export const JobRecordSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  workspaceId: z.string(),
  status: JobStateSchema,
  retryCount: z.number().int().nonnegative(),
  availableAt: z.string(),
  lastRunId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type JobRecord = z.infer<typeof JobRecordSchema>;

export const RunRecordSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  taskId: z.string(),
  workspaceId: z.string(),
  sessionRootId: z.string(),
  engineSessionRef: z.string().nullable(),
  state: RunStateSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  error: z.string().nullable(),
});
export type RunRecord = z.infer<typeof RunRecordSchema>;

export const RunEventRecordSchema = z.object({
  id: z.string(),
  runId: z.string(),
  type: z.string(),
  payload: z.string(),
  createdAt: z.string(),
});
export type RunEventRecord = z.infer<typeof RunEventRecordSchema>;

export const NormalizedEngineEventSchema = z.object({
  type: z.enum(['started', 'session', 'message', 'tool_call', 'tool_result', 'completed', 'failed', 'usage']),
  payload: z.record(z.string(), z.string()).default({}),
  raw: z.string().optional(),
});
export type NormalizedEngineEvent = z.infer<typeof NormalizedEngineEventSchema>;

export const UsageMetricsSchema = z.object({
  provider: z.string(),
  model: z.string(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
});
export type UsageMetrics = z.infer<typeof UsageMetricsSchema>;

export const ReceiptRecordSchema = z.object({
  id: z.string(),
  runId: z.string(),
  jobId: z.string(),
  taskId: z.string(),
  workspaceId: z.string(),
  status: z.enum(['succeeded', 'failed', 'cancelled', 'abandoned']),
  summary: z.string(),
  details: z.string(),
  usage: UsageMetricsSchema,
  createdAt: z.string(),
});
export type ReceiptRecord = z.infer<typeof ReceiptRecordSchema>;

export const InterventionRecordSchema = z.object({
  id: z.string(),
  code: InterventionCodeSchema,
  runId: z.string().nullable(),
  status: z.enum(['open', 'resolved']),
  reason: z.string(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});
export type InterventionRecord = z.infer<typeof InterventionRecordSchema>;

export const MessageRecordSchema = z.object({
  id: z.string(),
  source: z.enum(['telegram', 'manual', 'api']),
  senderId: z.string(),
  body: z.string(),
  accepted: z.boolean(),
  relatedRunId: z.string().nullable(),
  createdAt: z.string(),
});
export type MessageRecord = z.infer<typeof MessageRecordSchema>;

export const TelegramChatTypeSchema = z.enum(['private', 'group', 'supergroup', 'channel']);
export type TelegramChatType = z.infer<typeof TelegramChatTypeSchema>;

export const MessageIngressDecisionCodeSchema = z.enum([
  'accepted',
  'duplicate_replayed',
  'telegram_disabled',
  'telegram_private_chat_required',
  'telegram_not_allowlisted',
  'telegram_rate_limited',
  'telegram_prompt_injection',
  'telegram_invalid_message',
]);
export type MessageIngressDecisionCode = z.infer<typeof MessageIngressDecisionCodeSchema>;

export const MessageIngressRecordSchema = z.object({
  id: z.string(),
  source: z.enum(['telegram', 'manual', 'api']),
  senderId: z.string(),
  chatId: z.string().nullable(),
  chatType: TelegramChatTypeSchema.nullable(),
  telegramMessageId: z.number().int().nullable(),
  idempotencyKey: z.string().nullable(),
  workspaceId: z.string(),
  body: z.string(),
  accepted: z.boolean(),
  decisionCode: MessageIngressDecisionCodeSchema,
  decisionReason: z.string(),
  httpStatus: z.number().int(),
  messageId: z.string().nullable(),
  taskId: z.string().nullable(),
  jobId: z.string().nullable(),
  runId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MessageIngressRecord = z.infer<typeof MessageIngressRecordSchema>;

export const MessageIngressResponseSchema = z.object({
  accepted: z.boolean(),
  duplicate: z.boolean(),
  httpStatus: z.number().int(),
  decisionCode: MessageIngressDecisionCodeSchema,
  decisionReason: z.string(),
  message: MessageRecordSchema.nullable(),
  taskId: z.string().nullable(),
  jobId: z.string().nullable(),
  runId: z.string().nullable(),
});
export type MessageIngressResponse = z.infer<typeof MessageIngressResponseSchema>;

export const JobLeaseRecordSchema = z.object({
  jobId: z.string(),
  leaseOwner: z.string(),
  leaseExpiresAt: z.string(),
  updatedAt: z.string(),
});
export type JobLeaseRecord = z.infer<typeof JobLeaseRecordSchema>;

export const MemoryRecordSchema = z.object({
  id: z.string(),
  description: z.string(),
  classification: DataClassificationSchema,
  sourceType: z.enum(['receipt', 'telegram', 'daily_summary', 'curated_memory', 'workspace_doc']),
  content: z.string(),
  confidence: z.number().min(0).max(1),
  scope: z.string().default('workspace'),
  createdAt: z.string().default(''),
});
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;

export const BackupManifestSchema = z.object({
  version: z.string(),
  createdAt: z.string(),
  entries: z.array(
    z.object({
      path: z.string(),
      sha256: z.string(),
      kind: z.enum(['file', 'directory']),
    }),
  ),
});
export type BackupManifest = z.infer<typeof BackupManifestSchema>;

export const SecurityAuditFindingSchema = z.object({
  code: z.string(),
  severity: z.enum(['info', 'warn', 'error']),
  message: z.string(),
});
export type SecurityAuditFinding = z.infer<typeof SecurityAuditFindingSchema>;

export const TaskCreateInputSchema = z.object({
  workspaceId: z.string().default('default'),
  projectId: z.string().nullable().default(null),
  title: z.string(),
  prompt: z.string(),
  source: z.enum(['manual', 'heartbeat', 'schedule', 'telegram', 'api']).default('manual'),
  autoEnqueue: z.boolean().default(true),
});
export type TaskCreateInput = z.infer<typeof TaskCreateInputSchema>;

export const IngestMessageInputSchema = z.object({
  source: z.enum(['telegram', 'manual', 'api']),
  senderId: z.string(),
  text: z.string(),
  chatId: z.string().optional(),
  chatType: TelegramChatTypeSchema.optional(),
  telegramMessageId: z.number().int().optional(),
  workspaceId: z.string().default('default'),
}).superRefine((value, ctx) => {
  if (value.source !== 'telegram') {
    return;
  }

  if (!value.chatId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'chatId is required for telegram ingress',
      path: ['chatId'],
    });
  }

  if (!value.chatType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'chatType is required for telegram ingress',
      path: ['chatType'],
    });
  }

  if (typeof value.telegramMessageId !== 'number') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'telegramMessageId is required for telegram ingress',
      path: ['telegramMessageId'],
    });
  }
});
export type IngestMessageInput = z.infer<typeof IngestMessageInputSchema>;

export const SseEventEnvelopeSchema = z.object({
  event: z.string(),
  data: z.string(),
});
export type SseEventEnvelope = z.infer<typeof SseEventEnvelopeSchema>;

export const CsrfTokenResponseSchema = z.object({
  token: z.string(),
});
export type CsrfTokenResponse = z.infer<typeof CsrfTokenResponseSchema>;

export const UsageSummarySchema = z.object({
  runs: z.number().int().nonnegative(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
});
export type UsageSummary = z.infer<typeof UsageSummarySchema>;

export const DaemonStatusResponseSchema = z.object({
  ok: z.boolean(),
  runningJobs: z.number().int().nonnegative(),
  queuedJobs: z.number().int().nonnegative(),
  openInterventions: z.number().int().nonnegative(),
  activeLeases: z.number().int().nonnegative(),
  engineKind: EngineKindSchema,
  schedulerRunning: z.boolean(),
  startedAt: z.string(),
  lastShutdownAt: z.string().nullable(),
});
export type DaemonStatusResponse = z.infer<typeof DaemonStatusResponseSchema>;

export const SchedulerStatusResponseSchema = z.object({
  running: z.boolean(),
  activeLeases: z.number().int().nonnegative(),
  activeRuns: z.number().int().nonnegative(),
  nextHeartbeatDueAt: z.string().nullable(),
});
export type SchedulerStatusResponse = z.infer<typeof SchedulerStatusResponseSchema>;

export const DaemonStateRecordSchema = z.object({
  schedulerRunning: z.boolean(),
  activeWorkers: z.number().int().nonnegative(),
  lastSchedulerTickAt: z.string().nullable(),
  lastLeaseSweepAt: z.string().nullable(),
  lastShutdownAt: z.string().nullable(),
});
export type DaemonStateRecord = z.infer<typeof DaemonStateRecordSchema>;
