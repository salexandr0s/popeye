import { z } from 'zod';
import { EngineCapabilitiesSchema, EngineKindSchema } from './engine.js';
import { TaskRecordSchema, JobRecordSchema, RunRecordSchema, ProjectRecordSchema, AgentProfileRecordSchema, ExecutionEnvelopeSchema } from './execution.js';
import { CompiledInstructionBundleSchema, InstructionSourceSchema } from './instructions.js';
import { MemorySourceTypeSchema, MemoryTypeSchema } from './memory.js';
import { SecurityAuditFindingSchema } from './security.js';
import { WorkspaceRecordSchema, DataClassificationSchema } from './config.js';
import { DomainKindSchema, DomainPolicySchema } from './domain.js';
import {
  ApprovalRiskClassSchema,
  ActionPolicyDefaultSchema,
  ApprovalPolicyRuleSchema,
  ApprovalRequestInputSchema,
  StandingApprovalCreateInputSchema,
  PolicyGrantRevokeInputSchema,
  AutomationGrantCreateInputSchema,
} from './approval.js';
import { ConnectionResourceRuleSchema, ConnectionResourceRuleCreateInputSchema, ConnectionResourceRuleDeleteInputSchema, ConnectionDiagnosticsResponseSchema, ConnectionReconnectRequestSchema } from './connection.js';
import { ContextReleasePreviewSchema } from './context-release.js';
import { VaultKindSchema } from './vault.js';
import { OAuthConnectStartRequestSchema, OAuthSessionRecordSchema } from './oauth.js';
import { FileRootRecordSchema, FileDocumentRecordSchema, FileRootRegistrationInputSchema, FileRootUpdateInputSchema, FileSearchResponseSchema, FileIndexResultSchema, FileWriteIntentRecordSchema, FileWriteIntentCreateInputSchema, FileWriteIntentReviewInputSchema } from './file-roots.js';
import { EmailAccountRecordSchema, EmailAccountRegistrationInputSchema, EmailThreadRecordSchema, EmailMessageRecordSchema, EmailDigestRecordSchema, EmailSearchResultSchema, EmailSyncResultSchema, EmailDraftCreateInputSchema, EmailDraftRecordSchema, EmailDraftUpdateInputSchema } from './email.js';
import { GithubAccountRecordSchema, GithubRepoRecordSchema, GithubPullRequestRecordSchema, GithubIssueRecordSchema, GithubNotificationRecordSchema, GithubDigestRecordSchema, GithubSearchResultSchema, GithubSyncResultSchema, GithubCommentCreateInputSchema, GithubCommentRecordSchema, GithubNotificationMarkReadInputSchema } from './github.js';
import { CalendarAccountRecordSchema, CalendarAccountRegistrationInputSchema, CalendarEventRecordSchema, CalendarDigestRecordSchema, CalendarSearchResultSchema, CalendarSyncResultSchema, CalendarAvailabilitySlotSchema, CalendarEventCreateInputSchema, CalendarEventUpdateInputSchema } from './calendar.js';
import { TodoAccountRecordSchema, TodoAccountRegistrationInputSchema, TodoItemRecordSchema, TodoProjectRecordSchema, TodoDigestRecordSchema, TodoSearchResultSchema, TodoCreateInputSchema, TodoistConnectInputSchema, TodoReconcileResultSchema } from './todos.js';
import { PersonIdentityAttachInputSchema, PersonIdentityDetachInputSchema, PersonMergeInputSchema, PersonRecordSchema, PersonSplitInputSchema, PersonUpdateInputSchema, PersonMergeEventRecordSchema, PersonMergeSuggestionSchema, PersonActivityRollupSchema } from './people.js';
import { RecallDetailSchema, RecallSearchResponseSchema, RecallSourceKindSchema } from './recall.js';
import {
  PlaybookDetailSchema,
  PlaybookProposalKindSchema,
  PlaybookProposalRecordSchema,
  PlaybookRecommendationSchema,
  PlaybookProposalStatusSchema,
  PlaybookRecordSchema,
  PlaybookSearchResultSchema,
  PlaybookRevisionRecordSchema,
  PlaybookScopeSchema,
  PlaybookStaleCandidateSchema,
  PlaybookStatusSchema,
  PlaybookUsageRunRecordSchema,
} from './playbooks.js';

export const TaskCreateInputSchema = z.object({
  workspaceId: z.string().default('default'),
  projectId: z.string().nullable().default(null),
  profileId: z.string().default('default'),
  identityId: z.string().nullable().default(null),
  title: z.string(),
  prompt: z.string(),
  source: z.enum(['manual', 'heartbeat', 'schedule', 'telegram', 'api', 'delegation']).default('manual'),
  coalesceKey: z.string().nullable().default(null),
  autoEnqueue: z.boolean().default(true),
});
export type TaskCreateInput = z.infer<typeof TaskCreateInputSchema>;

export const SseEventEnvelopeSchema = z.object({
  event: z.string(),
  data: z.string(),
});
export type SseEventEnvelope = z.infer<typeof SseEventEnvelopeSchema>;

export const CsrfTokenResponseSchema = z.object({
  token: z.string(),
});
export type CsrfTokenResponse = z.infer<typeof CsrfTokenResponseSchema>;

export const AuthExchangeRequestSchema = z.object({
  nonce: z.string().min(1),
});

export const AuthExchangeResponseSchema = z.object({
  ok: z.literal(true),
});

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

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  startedAt: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const EngineCapabilitiesResponseSchema = EngineCapabilitiesSchema;
export type EngineCapabilitiesResponse = z.infer<typeof EngineCapabilitiesResponseSchema>;

export const ExecutionEnvelopeResponseSchema = ExecutionEnvelopeSchema;
export type ExecutionEnvelopeResponse = z.infer<typeof ExecutionEnvelopeResponseSchema>;

export const TaskCreateResponseSchema = z.object({
  task: TaskRecordSchema,
  job: JobRecordSchema.nullable(),
  run: RunRecordSchema.nullable(),
});
export type TaskCreateResponse = z.infer<typeof TaskCreateResponseSchema>;

export const SecurityAuditResponseSchema = z.object({
  findings: z.array(SecurityAuditFindingSchema),
});
export type SecurityAuditResponse = z.infer<typeof SecurityAuditResponseSchema>;

export const ErrorResponseSchema = z.object({
  error: z.string(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

const RunReplySourceSchema = z.enum(['completed_output', 'assistant_message', 'receipt_fallback']);

export const RunReplySchema = z.object({
  runId: z.string(),
  terminalStatus: z.enum(['succeeded', 'failed', 'cancelled', 'abandoned']),
  source: RunReplySourceSchema,
  text: z.string(),
});
export type RunReply = z.infer<typeof RunReplySchema>;

const TelegramRelayKeySchema = z.literal('telegram_long_poll');

export const TelegramRelayCheckpointSchema = z.object({
  relayKey: TelegramRelayKeySchema,
  workspaceId: z.string(),
  lastAcknowledgedUpdateId: z.number().int(),
  updatedAt: z.string(),
});
export type TelegramRelayCheckpoint = z.infer<typeof TelegramRelayCheckpointSchema>;

export const TelegramRelayCheckpointResponseSchema = TelegramRelayCheckpointSchema.nullable();

export const TelegramRelayCheckpointCommitRequestSchema = z.object({
  relayKey: TelegramRelayKeySchema.default('telegram_long_poll'),
  workspaceId: z.string().min(1),
  lastAcknowledgedUpdateId: z.number().int().nonnegative(),
});
export type TelegramRelayCheckpointCommitRequest = z.infer<typeof TelegramRelayCheckpointCommitRequestSchema>;

export const TelegramReplyDeliveryMarkSentRequestSchema = z.object({
  workspaceId: z.string().min(1),
  runId: z.string().min(1).nullable().optional(),
  sentTelegramMessageId: z.number().int().nonnegative().nullable().optional(),
});

export const TelegramReplyDeliveryStateUpdateRequestSchema = z.object({
  workspaceId: z.string().min(1),
  runId: z.string().min(1).nullable().optional(),
});

export const TelegramReplyDeliveryMarkUncertainRequestSchema = TelegramReplyDeliveryStateUpdateRequestSchema.extend({
  reason: z.string().min(1).max(1_000).nullable().optional(),
});


export const WorkspaceListItemSchema = WorkspaceRecordSchema;
export type WorkspaceListItem = z.infer<typeof WorkspaceListItemSchema>;

export const ProjectListItemSchema = ProjectRecordSchema;
export type ProjectListItem = z.infer<typeof ProjectListItemSchema>;

export const AgentProfileListItemSchema = AgentProfileRecordSchema;
export type AgentProfileListItem = z.infer<typeof AgentProfileListItemSchema>;

export const PathIdParamSchema = z.object({
  id: z.string().min(1).max(100),
});

export const MemoryPromotionProposalRequestSchema = z.object({
  targetPath: z.string().min(1),
});

export const MemoryPromotionResponseSchema = z.object({
  memoryId: z.string(),
  targetPath: z.string(),
  diff: z.string(),
  approved: z.boolean(),
  promoted: z.boolean(),
});

export const MemoryPromotionExecuteRequestSchema = MemoryPromotionResponseSchema.omit({
  memoryId: true,
});

export const PlaybookListQueryParamsSchema = z.object({
  q: z.string().optional(),
  scope: PlaybookScopeSchema.optional(),
  workspaceId: z.string().optional(),
  projectId: z.string().optional(),
  status: PlaybookStatusSchema.optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});
export type PlaybookListQueryParams = z.infer<typeof PlaybookListQueryParamsSchema>;

export const PlaybookRecommendQueryParamsSchema = z.object({
  q: z.string().min(1),
  workspaceId: z.string().min(1),
  projectId: z.string().optional(),
  profileId: z.string().optional(),
  identityId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(25).optional(),
});
export type PlaybookRecommendQueryParams = z.infer<typeof PlaybookRecommendQueryParamsSchema>;

export const PlaybookRecommendationListResponseSchema = z.array(PlaybookRecommendationSchema);
export type PlaybookRecommendationListResponse = z.infer<typeof PlaybookRecommendationListResponseSchema>;

export const PlaybookProposalListQueryParamsSchema = z.object({
  q: z.string().optional(),
  status: PlaybookProposalStatusSchema.optional(),
  kind: PlaybookProposalKindSchema.optional(),
  scope: PlaybookScopeSchema.optional(),
  sourceRunId: z.string().optional(),
  targetRecordId: z.string().optional(),
  sort: z.enum(['created_desc', 'created_asc', 'updated_desc', 'updated_asc', 'title_asc', 'title_desc']).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});
export type PlaybookProposalListQueryParams = z.infer<typeof PlaybookProposalListQueryParamsSchema>;

export const PlaybookUsageListQueryParamsSchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});
export type PlaybookUsageListQueryParams = z.infer<typeof PlaybookUsageListQueryParamsSchema>;

export const PlaybookProposalCreateRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('draft'),
    playbookId: z.string().min(1),
    scope: PlaybookScopeSchema,
    workspaceId: z.string().nullable().optional(),
    projectId: z.string().nullable().optional(),
    title: z.string().min(1),
    allowedProfileIds: z.array(z.string().min(1)).default([]),
    body: z.string().min(1),
    summary: z.string().default(''),
  }),
  z.object({
    kind: z.literal('patch'),
    targetRecordId: z.string().min(1),
    baseRevisionHash: z.string().min(1).optional(),
    title: z.string().min(1),
    allowedProfileIds: z.array(z.string().min(1)).default([]),
    body: z.string().min(1),
    summary: z.string().default(''),
  }),
]);
export type PlaybookProposalCreateRequest = z.infer<typeof PlaybookProposalCreateRequestSchema>;

export const PlaybookProposalReviewRequestSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reviewedBy: z.string().min(1).default('operator'),
  note: z.string().default(''),
});
export type PlaybookProposalReviewRequest = z.infer<typeof PlaybookProposalReviewRequestSchema>;

export const PlaybookProposalApplyRequestSchema = z.object({
  appliedBy: z.string().min(1).default('operator'),
});
export type PlaybookProposalApplyRequest = z.infer<typeof PlaybookProposalApplyRequestSchema>;

export const PlaybookProposalUpdateRequestSchema = z.object({
  title: z.string().min(1),
  allowedProfileIds: z.array(z.string().min(1)).default([]),
  summary: z.string().default(''),
  body: z.string().min(1),
  updatedBy: z.string().min(1).default('operator'),
});
export type PlaybookProposalUpdateRequest = z.infer<typeof PlaybookProposalUpdateRequestSchema>;

export const PlaybookProposalSubmitReviewRequestSchema = z.object({
  submittedBy: z.string().min(1).default('operator'),
});
export type PlaybookProposalSubmitReviewRequest = z.infer<typeof PlaybookProposalSubmitReviewRequestSchema>;

export const PlaybookLifecycleActionRequestSchema = z.object({
  updatedBy: z.string().min(1).default('operator'),
});
export type PlaybookLifecycleActionRequest = z.infer<typeof PlaybookLifecycleActionRequestSchema>;

export const PlaybookSuggestPatchRequestSchema = z.object({
  proposedBy: z.string().min(1).default('operator'),
});
export type PlaybookSuggestPatchRequest = z.infer<typeof PlaybookSuggestPatchRequestSchema>;

export const PlaybookRecordResponseSchema = PlaybookRecordSchema;
export type PlaybookRecordResponse = z.infer<typeof PlaybookRecordResponseSchema>;

export const PlaybookDetailResponseSchema = PlaybookDetailSchema;
export type PlaybookDetailResponse = z.infer<typeof PlaybookDetailResponseSchema>;

export const PlaybookSearchResultResponseSchema = PlaybookSearchResultSchema;
export type PlaybookSearchResultResponse = z.infer<typeof PlaybookSearchResultResponseSchema>;

export const PlaybookRevisionListResponseSchema = z.array(PlaybookRevisionRecordSchema);
export type PlaybookRevisionListResponse = z.infer<typeof PlaybookRevisionListResponseSchema>;

export const PlaybookProposalRecordResponseSchema = PlaybookProposalRecordSchema;
export type PlaybookProposalRecordResponse = z.infer<typeof PlaybookProposalRecordResponseSchema>;

export const PlaybookStaleCandidateListResponseSchema = z.array(PlaybookStaleCandidateSchema);
export type PlaybookStaleCandidateListResponse = z.infer<typeof PlaybookStaleCandidateListResponseSchema>;

export const PlaybookUsageRunListResponseSchema = z.array(PlaybookUsageRunRecordSchema);
export type PlaybookUsageRunListResponse = z.infer<typeof PlaybookUsageRunListResponseSchema>;

export const RecallSearchQueryParamsSchema = z.object({
  q: z.string().max(1_000).optional(),
  query: z.string().max(1_000).optional(),
  workspaceId: z.string().optional(),
  projectId: z.string().optional(),
  includeGlobal: z.enum(['true', 'false']).optional(),
  kinds: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const RecallDetailParamsSchema = z.object({
  kind: RecallSourceKindSchema,
  id: z.string().min(1),
});

export const RecallSearchResponseApiSchema = RecallSearchResponseSchema;
export type RecallSearchResponseApi = z.infer<typeof RecallSearchResponseApiSchema>;

export const RecallDetailResponseSchema = RecallDetailSchema;
export type RecallDetailResponse = z.infer<typeof RecallDetailResponseSchema>;

export const WorkspaceRegistrationInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rootPath: z.string().nullable().default(null),
});
export type WorkspaceRegistrationInput = z.infer<typeof WorkspaceRegistrationInputSchema>;

export const ProjectRegistrationInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().nullable().default(null),
  workspaceId: z.string().min(1),
});
export type ProjectRegistrationInput = z.infer<typeof ProjectRegistrationInputSchema>;

export const MemoryImportInputSchema = z.object({
  description: z.string().min(1),
  content: z.string().min(1),
  sourceType: MemorySourceTypeSchema.default('curated_memory'),
  memoryType: MemoryTypeSchema.optional(),
  scope: z.string().default('workspace'),
  workspaceId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).default(0.8),
  classification: DataClassificationSchema.default('embeddable'),
  domain: DomainKindSchema.optional(),
  tags: z.array(z.string()).optional(),
  durable: z.boolean().optional(),
  dedupKey: z.string().optional(),
  sourceRunId: z.string().optional(),
  sourceTimestamp: z.string().optional(),
});

export const MemoryImportResponseSchema = z.object({
  memoryId: z.string(),
  embedded: z.boolean(),
});
export type MemoryImportResponse = z.infer<typeof MemoryImportResponseSchema>;

export const ApprovalRequestSchema = ApprovalRequestInputSchema;
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const StandingApprovalCreateRequestSchema = StandingApprovalCreateInputSchema;
export type StandingApprovalCreateRequest = z.infer<typeof StandingApprovalCreateRequestSchema>;

export const PolicyGrantRevokeRequestSchema = PolicyGrantRevokeInputSchema;
export type PolicyGrantRevokeRequest = z.infer<typeof PolicyGrantRevokeRequestSchema>;

export const AutomationGrantCreateRequestSchema = AutomationGrantCreateInputSchema;
export type AutomationGrantCreateRequest = z.infer<typeof AutomationGrantCreateRequestSchema>;

export { ConnectionResourceRuleSchema, ConnectionResourceRuleCreateInputSchema, ConnectionResourceRuleDeleteInputSchema, ConnectionDiagnosticsResponseSchema, ConnectionReconnectRequestSchema };

export const OAuthConnectStartRequestApiSchema = OAuthConnectStartRequestSchema;
export type OAuthConnectStartRequestApi = z.infer<typeof OAuthConnectStartRequestApiSchema>;

export const OAuthSessionResponseSchema = OAuthSessionRecordSchema;
export type OAuthSessionResponse = z.infer<typeof OAuthSessionResponseSchema>;

export const SecurityPolicyResponseSchema = z.object({
  domainPolicies: z.array(DomainPolicySchema),
  approvalRules: z.array(ApprovalPolicyRuleSchema),
  defaultRiskClass: ApprovalRiskClassSchema,
  actionDefaults: z.array(ActionPolicyDefaultSchema),
});
export type SecurityPolicyResponse = z.infer<typeof SecurityPolicyResponseSchema>;

export const VaultCreateRequestSchema = z.object({
  domain: DomainKindSchema,
  name: z.string().min(1),
  kind: VaultKindSchema.optional(),
});
export type VaultCreateRequest = z.infer<typeof VaultCreateRequestSchema>;

export const VaultOpenRequestSchema = z.object({
  approvalId: z.string().min(1),
});
export type VaultOpenRequest = z.infer<typeof VaultOpenRequestSchema>;

export const ContextReleasePreviewRequestSchema = z.object({
  domain: DomainKindSchema,
  sourceRef: z.string().min(1),
});

export const ContextReleasePreviewResponseSchema = ContextReleasePreviewSchema;

export const InstructionResolutionContextSchema = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  profileId: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
  identity: z.string().min(1).optional(),
  taskBrief: z.string().optional(),
  triggerOverlay: z.string().optional(),
  runtimeNotes: z.string().optional(),
});
export type InstructionResolutionContext = z.infer<typeof InstructionResolutionContextSchema>;

export const InstructionPreviewSourceMetadataSchema = InstructionSourceSchema.pick({
  precedence: true,
  type: true,
  path: true,
  inlineId: true,
  contentHash: true,
}).extend({
  bandOrder: z.number().int().nonnegative(),
});
export type InstructionPreviewSourceMetadata = z.infer<typeof InstructionPreviewSourceMetadataSchema>;

export const InstructionPreviewExplainResponseSchema = z.object({
  bundle: CompiledInstructionBundleSchema,
  context: InstructionResolutionContextSchema,
  sources: z.array(InstructionPreviewSourceMetadataSchema),
});
export type InstructionPreviewExplainResponse = z.infer<typeof InstructionPreviewExplainResponseSchema>;

export const InstructionPreviewDiffRequestSchema = z.object({
  left: InstructionResolutionContextSchema,
  right: InstructionResolutionContextSchema,
});
export type InstructionPreviewDiffRequest = z.infer<typeof InstructionPreviewDiffRequestSchema>;

export const InstructionPreviewSourceReorderSchema = z.object({
  source: InstructionPreviewSourceMetadataSchema,
  leftIndex: z.number().int().nonnegative(),
  rightIndex: z.number().int().nonnegative(),
});
export type InstructionPreviewSourceReorder = z.infer<typeof InstructionPreviewSourceReorderSchema>;

export const InstructionPreviewDiffResponseSchema = z.object({
  leftContext: InstructionResolutionContextSchema,
  rightContext: InstructionResolutionContextSchema,
  leftBundleHash: z.string(),
  rightBundleHash: z.string(),
  compiledTextChanged: z.boolean(),
  addedSources: z.array(InstructionPreviewSourceMetadataSchema),
  removedSources: z.array(InstructionPreviewSourceMetadataSchema),
  reorderedSources: z.array(InstructionPreviewSourceReorderSchema),
});
export type InstructionPreviewDiffResponse = z.infer<typeof InstructionPreviewDiffResponseSchema>;

export const IdentityRecordSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  path: z.string().min(1),
  exists: z.boolean(),
  selected: z.boolean().default(false),
});
export type IdentityRecord = z.infer<typeof IdentityRecordSchema>;

export const WorkspaceIdentityDefaultSchema = z.object({
  workspaceId: z.string().min(1),
  identityId: z.string().min(1),
  updatedAt: z.string().nullable().default(null),
});
export type WorkspaceIdentityDefault = z.infer<typeof WorkspaceIdentityDefaultSchema>;

// --- File roots API schemas ---

export const FileRootResponseSchema = FileRootRecordSchema;

export const FileDocumentResponseSchema = FileDocumentRecordSchema;

export const FileSearchApiResponseSchema = FileSearchResponseSchema;

export { FileRootRegistrationInputSchema, FileRootUpdateInputSchema, FileSearchResponseSchema, FileIndexResultSchema, FileWriteIntentRecordSchema, FileWriteIntentCreateInputSchema, FileWriteIntentReviewInputSchema };

// --- Email API schemas ---

export const EmailAccountResponseSchema = EmailAccountRecordSchema;

export const EmailThreadResponseSchema = EmailThreadRecordSchema;

export const EmailMessageResponseSchema = EmailMessageRecordSchema;

export const EmailDigestResponseSchema = EmailDigestRecordSchema;

export { EmailAccountRegistrationInputSchema, EmailAccountRecordSchema, EmailThreadRecordSchema, EmailMessageRecordSchema, EmailDigestRecordSchema, EmailSearchResultSchema, EmailSyncResultSchema, EmailDraftCreateInputSchema, EmailDraftRecordSchema, EmailDraftUpdateInputSchema };

// --- GitHub API schemas ---

export const GithubAccountResponseSchema = GithubAccountRecordSchema;

export const GithubPullRequestResponseSchema = GithubPullRequestRecordSchema;

export const GithubIssueResponseSchema = GithubIssueRecordSchema;

export const GithubDigestResponseSchema = GithubDigestRecordSchema;

export { GithubAccountRecordSchema, GithubRepoRecordSchema, GithubPullRequestRecordSchema, GithubIssueRecordSchema, GithubNotificationRecordSchema, GithubDigestRecordSchema, GithubSearchResultSchema, GithubSyncResultSchema, GithubCommentCreateInputSchema, GithubCommentRecordSchema, GithubNotificationMarkReadInputSchema };

// --- Calendar API schemas ---

export const CalendarAccountResponseSchema = CalendarAccountRecordSchema;

export const CalendarEventResponseSchema = CalendarEventRecordSchema;

export const CalendarDigestResponseSchema = CalendarDigestRecordSchema;

export { CalendarAccountRegistrationInputSchema, CalendarAccountRecordSchema, CalendarEventRecordSchema, CalendarDigestRecordSchema, CalendarSearchResultSchema, CalendarSyncResultSchema, CalendarAvailabilitySlotSchema, CalendarEventCreateInputSchema, CalendarEventUpdateInputSchema };

// --- Todos API schemas ---

export const TodoAccountResponseSchema = TodoAccountRecordSchema;
export const TodoItemResponseSchema = TodoItemRecordSchema;

export const TodoDigestResponseSchema = TodoDigestRecordSchema;

export { TodoAccountRegistrationInputSchema, TodoAccountRecordSchema, TodoItemRecordSchema, TodoProjectRecordSchema, TodoDigestRecordSchema, TodoSearchResultSchema, TodoCreateInputSchema, TodoistConnectInputSchema, TodoReconcileResultSchema };

// --- People API schemas ---

export { PersonRecordSchema, PersonUpdateInputSchema, PersonMergeInputSchema, PersonSplitInputSchema, PersonIdentityAttachInputSchema, PersonIdentityDetachInputSchema, PersonMergeEventRecordSchema, PersonMergeSuggestionSchema, PersonActivityRollupSchema };

// --- Finance API schemas ---

import { FinanceImportRecordSchema, FinanceTransactionRecordSchema, FinanceDocumentRecordSchema, FinanceDigestRecordSchema, FinanceSearchResultSchema } from './finance.js';

export { FinanceImportRecordSchema, FinanceTransactionRecordSchema, FinanceDocumentRecordSchema, FinanceDigestRecordSchema, FinanceSearchResultSchema };

// --- Medical API schemas ---

import { MedicalImportRecordSchema, MedicalAppointmentRecordSchema, MedicalMedicationRecordSchema, MedicalDocumentRecordSchema, MedicalDigestRecordSchema, MedicalSearchResultSchema } from './medical.js';

export { MedicalImportRecordSchema, MedicalAppointmentRecordSchema, MedicalMedicationRecordSchema, MedicalDocumentRecordSchema, MedicalDigestRecordSchema, MedicalSearchResultSchema };
