import { z } from 'zod';
import { EngineCapabilitiesSchema, EngineKindSchema } from './engine.js';
import { TaskRecordSchema, JobRecordSchema, RunRecordSchema, ProjectRecordSchema, AgentProfileRecordSchema, ExecutionEnvelopeSchema } from './execution.js';
import { MemorySourceTypeSchema, MemoryTypeSchema } from './memory.js';
import { SecurityAuditFindingSchema } from './security.js';
import { WorkspaceRecordSchema, DataClassificationSchema } from './config.js';
import { DomainKindSchema, DomainPolicySchema } from './domain.js';
import {
  ApprovalRecordSchema,
  ApprovalRiskClassSchema,
  ActionPolicyDefaultSchema,
  ApprovalPolicyRuleSchema,
  ApprovalRequestInputSchema,
  StandingApprovalRecordSchema,
  StandingApprovalCreateInputSchema,
  PolicyGrantRevokeInputSchema,
  AutomationGrantRecordSchema,
  AutomationGrantCreateInputSchema,
} from './approval.js';
import { ConnectionRecordSchema, ConnectionResourceRuleSchema, ConnectionResourceRuleCreateInputSchema, ConnectionResourceRuleDeleteInputSchema, ConnectionDiagnosticsResponseSchema, ConnectionReconnectRequestSchema } from './connection.js';
import { ContextReleasePreviewSchema } from './context-release.js';
import { VaultKindSchema, VaultRecordSchema, VaultBackupManifestSchema, VaultRestoreResultSchema, VaultBackupVerifyResultSchema } from './vault.js';
import { OAuthConnectStartRequestSchema, OAuthSessionRecordSchema } from './oauth.js';
import { FileRootRecordSchema, FileDocumentRecordSchema, FileRootRegistrationInputSchema, FileRootUpdateInputSchema, FileSearchQuerySchema, FileSearchResponseSchema, FileIndexResultSchema, FileWriteIntentRecordSchema, FileWriteIntentCreateInputSchema, FileWriteIntentReviewInputSchema } from './file-roots.js';
import { EmailAccountRecordSchema, EmailAccountRegistrationInputSchema, EmailThreadRecordSchema, EmailMessageRecordSchema, EmailDigestRecordSchema, EmailSearchResultSchema, EmailSyncResultSchema, EmailDraftCreateInputSchema, EmailDraftRecordSchema, EmailDraftUpdateInputSchema } from './email.js';
import { GithubAccountRecordSchema, GithubAccountRegistrationInputSchema, GithubRepoRecordSchema, GithubPullRequestRecordSchema, GithubIssueRecordSchema, GithubNotificationRecordSchema, GithubDigestRecordSchema, GithubSearchResultSchema, GithubSyncResultSchema, GithubCommentCreateInputSchema, GithubCommentRecordSchema, GithubNotificationMarkReadInputSchema } from './github.js';
import { CalendarAccountRecordSchema, CalendarAccountRegistrationInputSchema, CalendarEventRecordSchema, CalendarDigestRecordSchema, CalendarSearchResultSchema, CalendarSyncResultSchema, CalendarAvailabilitySlotSchema, CalendarEventCreateInputSchema, CalendarEventUpdateInputSchema } from './calendar.js';
import { TodoAccountRecordSchema, TodoAccountRegistrationInputSchema, TodoItemRecordSchema, TodoProjectRecordSchema, TodoDigestRecordSchema, TodoSearchResultSchema, TodoSyncResultSchema, TodoCreateInputSchema, TodoistConnectInputSchema, TodoistConnectResultSchema, TodoReprioritizeInputSchema, TodoRescheduleInputSchema, TodoMoveInputSchema, TodoReconcileResultSchema } from './todos.js';
import { PersonIdentityAttachInputSchema, PersonIdentityDetachInputSchema, PersonListItemSchema, PersonMergeInputSchema, PersonRecordSchema, PersonSearchQuerySchema, PersonSearchResultSchema, PersonSplitInputSchema, PersonUpdateInputSchema, PersonMergeEventRecordSchema, PersonMergeSuggestionSchema, PersonActivityRollupSchema } from './people.js';

export const TaskCreateInputSchema = z.object({
  workspaceId: z.string().default('default'),
  projectId: z.string().nullable().default(null),
  profileId: z.string().default('default'),
  title: z.string(),
  prompt: z.string(),
  source: z.enum(['manual', 'heartbeat', 'schedule', 'telegram', 'api']).default('manual'),
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
export type AuthExchangeRequest = z.infer<typeof AuthExchangeRequestSchema>;

export const AuthExchangeResponseSchema = z.object({
  ok: z.literal(true),
});
export type AuthExchangeResponse = z.infer<typeof AuthExchangeResponseSchema>;

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

export const RunReplySourceSchema = z.enum(['completed_output', 'assistant_message', 'receipt_fallback']);
export type RunReplySource = z.infer<typeof RunReplySourceSchema>;

export const RunReplySchema = z.object({
  runId: z.string(),
  terminalStatus: z.enum(['succeeded', 'failed', 'cancelled', 'abandoned']),
  source: RunReplySourceSchema,
  text: z.string(),
});
export type RunReply = z.infer<typeof RunReplySchema>;

export const TelegramRelayKeySchema = z.literal('telegram_long_poll');
export type TelegramRelayKey = z.infer<typeof TelegramRelayKeySchema>;

export const TelegramRelayCheckpointSchema = z.object({
  relayKey: TelegramRelayKeySchema,
  workspaceId: z.string(),
  lastAcknowledgedUpdateId: z.number().int(),
  updatedAt: z.string(),
});
export type TelegramRelayCheckpoint = z.infer<typeof TelegramRelayCheckpointSchema>;

export const TelegramRelayCheckpointResponseSchema = TelegramRelayCheckpointSchema.nullable();
export type TelegramRelayCheckpointResponse = z.infer<typeof TelegramRelayCheckpointResponseSchema>;

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
export type TelegramReplyDeliveryMarkSentRequest = z.infer<typeof TelegramReplyDeliveryMarkSentRequestSchema>;

export const TelegramReplyDeliveryStateUpdateRequestSchema = z.object({
  workspaceId: z.string().min(1),
  runId: z.string().min(1).nullable().optional(),
});
export type TelegramReplyDeliveryStateUpdateRequest = z.infer<typeof TelegramReplyDeliveryStateUpdateRequestSchema>;

export const TelegramReplyDeliveryMarkUncertainRequestSchema = TelegramReplyDeliveryStateUpdateRequestSchema.extend({
  reason: z.string().min(1).max(1_000).nullable().optional(),
});
export type TelegramReplyDeliveryMarkUncertainRequest = z.infer<typeof TelegramReplyDeliveryMarkUncertainRequestSchema>;


export const WorkspaceListItemSchema = WorkspaceRecordSchema;
export type WorkspaceListItem = z.infer<typeof WorkspaceListItemSchema>;

export const ProjectListItemSchema = ProjectRecordSchema;
export type ProjectListItem = z.infer<typeof ProjectListItemSchema>;

export const AgentProfileListItemSchema = AgentProfileRecordSchema;
export type AgentProfileListItem = z.infer<typeof AgentProfileListItemSchema>;

/** Simple FTS search result (used by /v1/memory/search-simple). */
export const MemorySearchResultItemSchema = z.object({
  id: z.string(),
  description: z.string(),
  confidence: z.number(),
  scope: z.string(),
  sourceType: z.string(),
  createdAt: z.string(),
  snippet: z.string(),
});
export type MemorySearchResultItem = z.infer<typeof MemorySearchResultItemSchema>;

export const MemorySearchApiResponseSchema = z.object({
  query: z.string(),
  results: z.array(MemorySearchResultItemSchema),
});
export type MemorySearchApiResponse = z.infer<typeof MemorySearchApiResponseSchema>;

export const PathIdParamSchema = z.object({
  id: z.string().min(1).max(100),
});
export type PathIdParam = z.infer<typeof PathIdParamSchema>;

export const MemoryPromotionProposalRequestSchema = z.object({
  targetPath: z.string().min(1),
});
export type MemoryPromotionProposalRequest = z.infer<typeof MemoryPromotionProposalRequestSchema>;

export const MemoryPromotionResponseSchema = z.object({
  memoryId: z.string(),
  targetPath: z.string(),
  diff: z.string(),
  approved: z.boolean(),
  promoted: z.boolean(),
});
export type MemoryPromotionResponse = z.infer<typeof MemoryPromotionResponseSchema>;

export const MemoryPromotionExecuteRequestSchema = MemoryPromotionResponseSchema.omit({
  memoryId: true,
});
export type MemoryPromotionExecuteRequest = z.infer<typeof MemoryPromotionExecuteRequestSchema>;

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
export type MemoryImportInput = z.infer<typeof MemoryImportInputSchema>;

export const MemoryImportResponseSchema = z.object({
  memoryId: z.string(),
  embedded: z.boolean(),
});
export type MemoryImportResponse = z.infer<typeof MemoryImportResponseSchema>;

export const ApprovalListResponseSchema = z.array(ApprovalRecordSchema);
export type ApprovalListResponse = z.infer<typeof ApprovalListResponseSchema>;

export const ApprovalRequestSchema = ApprovalRequestInputSchema;
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const StandingApprovalListResponseSchema = z.array(StandingApprovalRecordSchema);
export type StandingApprovalListResponse = z.infer<typeof StandingApprovalListResponseSchema>;

export const StandingApprovalCreateRequestSchema = StandingApprovalCreateInputSchema;
export type StandingApprovalCreateRequest = z.infer<typeof StandingApprovalCreateRequestSchema>;

export const PolicyGrantRevokeRequestSchema = PolicyGrantRevokeInputSchema;
export type PolicyGrantRevokeRequest = z.infer<typeof PolicyGrantRevokeRequestSchema>;

export const AutomationGrantListResponseSchema = z.array(AutomationGrantRecordSchema);
export type AutomationGrantListResponse = z.infer<typeof AutomationGrantListResponseSchema>;

export const AutomationGrantCreateRequestSchema = AutomationGrantCreateInputSchema;
export type AutomationGrantCreateRequest = z.infer<typeof AutomationGrantCreateRequestSchema>;

export const ConnectionListResponseSchema = z.array(ConnectionRecordSchema);
export type ConnectionListResponse = z.infer<typeof ConnectionListResponseSchema>;

export const ConnectionResourceRuleListResponseSchema = z.array(ConnectionResourceRuleSchema);
export type ConnectionResourceRuleListResponse = z.infer<typeof ConnectionResourceRuleListResponseSchema>;

export const ConnectionResourceRuleCreateRequestSchema = ConnectionResourceRuleCreateInputSchema;
export type ConnectionResourceRuleCreateRequest = z.infer<typeof ConnectionResourceRuleCreateRequestSchema>;

export const ConnectionResourceRuleDeleteRequestSchema = ConnectionResourceRuleDeleteInputSchema;
export type ConnectionResourceRuleDeleteRequest = z.infer<typeof ConnectionResourceRuleDeleteRequestSchema>;

export const ConnectionDiagnosticsApiResponseSchema = ConnectionDiagnosticsResponseSchema;
export type ConnectionDiagnosticsApiResponse = z.infer<typeof ConnectionDiagnosticsApiResponseSchema>;

export const ConnectionReconnectApiRequestSchema = ConnectionReconnectRequestSchema;
export type ConnectionReconnectApiRequest = z.infer<typeof ConnectionReconnectApiRequestSchema>;

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

export const VaultListResponseSchema = z.array(VaultRecordSchema);
export type VaultListResponse = z.infer<typeof VaultListResponseSchema>;

export const VaultCreateRequestSchema = z.object({
  domain: DomainKindSchema,
  name: z.string().min(1),
  kind: VaultKindSchema.optional(),
});
export type VaultCreateRequest = z.infer<typeof VaultCreateRequestSchema>;

export const VaultResponseSchema = VaultRecordSchema;
export type VaultResponse = z.infer<typeof VaultResponseSchema>;

export const VaultOpenRequestSchema = z.object({
  approvalId: z.string().min(1),
});
export type VaultOpenRequest = z.infer<typeof VaultOpenRequestSchema>;

export const VaultBackupResponseSchema = VaultBackupManifestSchema;
export type VaultBackupResponse = z.infer<typeof VaultBackupResponseSchema>;

export const VaultRestoreResponseSchema = VaultRestoreResultSchema;
export type VaultRestoreResponse = z.infer<typeof VaultRestoreResponseSchema>;

export const VaultBackupVerifyResponseSchema = VaultBackupVerifyResultSchema;
export type VaultBackupVerifyResponse = z.infer<typeof VaultBackupVerifyResponseSchema>;

export { VaultBackupManifestSchema, VaultRestoreResultSchema, VaultBackupVerifyResultSchema };

export const ContextReleasePreviewRequestSchema = z.object({
  domain: DomainKindSchema,
  sourceRef: z.string().min(1),
});
export type ContextReleasePreviewRequest = z.infer<typeof ContextReleasePreviewRequestSchema>;

export const ContextReleasePreviewResponseSchema = ContextReleasePreviewSchema;
export type ContextReleasePreviewResponse = z.infer<typeof ContextReleasePreviewResponseSchema>;

export const InstructionResolutionContextSchema = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  identity: z.string().min(1).optional(),
  taskBrief: z.string().optional(),
  triggerOverlay: z.string().optional(),
  runtimeNotes: z.string().optional(),
});
export type InstructionResolutionContext = z.infer<typeof InstructionResolutionContextSchema>;

// --- File roots API schemas ---

export const FileRootListResponseSchema = z.array(FileRootRecordSchema);
export type FileRootListResponse = z.infer<typeof FileRootListResponseSchema>;

export const FileRootCreateRequestSchema = FileRootRegistrationInputSchema;
export type FileRootCreateRequest = z.infer<typeof FileRootCreateRequestSchema>;

export const FileRootUpdateRequestSchema = FileRootUpdateInputSchema;
export type FileRootUpdateRequest = z.infer<typeof FileRootUpdateRequestSchema>;

export const FileRootResponseSchema = FileRootRecordSchema;
export type FileRootResponse = z.infer<typeof FileRootResponseSchema>;

export const FileDocumentResponseSchema = FileDocumentRecordSchema;
export type FileDocumentResponse = z.infer<typeof FileDocumentResponseSchema>;

export const FileSearchRequestSchema = z.object({
  query: z.string().min(1).max(1000),
  rootId: z.string().optional(),
  workspaceId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});
export type FileSearchRequest = z.infer<typeof FileSearchRequestSchema>;

export const FileSearchApiResponseSchema = FileSearchResponseSchema;
export type FileSearchApiResponse = z.infer<typeof FileSearchApiResponseSchema>;

export const FileReindexResponseSchema = FileIndexResultSchema;
export type FileReindexResponse = z.infer<typeof FileReindexResponseSchema>;

// --- File write-intent API schemas ---

export const FileWriteIntentListResponseSchema = z.array(FileWriteIntentRecordSchema);
export type FileWriteIntentListResponse = z.infer<typeof FileWriteIntentListResponseSchema>;

export const FileWriteIntentResponseSchema = FileWriteIntentRecordSchema;
export type FileWriteIntentResponse = z.infer<typeof FileWriteIntentResponseSchema>;

export const FileWriteIntentCreateRequestSchema = FileWriteIntentCreateInputSchema;
export type FileWriteIntentCreateRequest = z.infer<typeof FileWriteIntentCreateRequestSchema>;

export const FileWriteIntentReviewRequestSchema = FileWriteIntentReviewInputSchema;
export type FileWriteIntentReviewRequest = z.infer<typeof FileWriteIntentReviewRequestSchema>;

export { FileRootRegistrationInputSchema, FileRootUpdateInputSchema, FileSearchQuerySchema, FileSearchResponseSchema, FileIndexResultSchema, FileWriteIntentRecordSchema, FileWriteIntentCreateInputSchema, FileWriteIntentReviewInputSchema };

// --- Email API schemas ---

export const EmailAccountListResponseSchema = z.array(EmailAccountRecordSchema);
export type EmailAccountListResponse = z.infer<typeof EmailAccountListResponseSchema>;

export const EmailAccountCreateRequestSchema = EmailAccountRegistrationInputSchema;
export type EmailAccountCreateRequest = z.infer<typeof EmailAccountCreateRequestSchema>;

export const EmailAccountResponseSchema = EmailAccountRecordSchema;
export type EmailAccountResponse = z.infer<typeof EmailAccountResponseSchema>;

export const EmailThreadListResponseSchema = z.array(EmailThreadRecordSchema);
export type EmailThreadListResponse = z.infer<typeof EmailThreadListResponseSchema>;

export const EmailThreadResponseSchema = EmailThreadRecordSchema;
export type EmailThreadResponse = z.infer<typeof EmailThreadResponseSchema>;

export const EmailMessageResponseSchema = EmailMessageRecordSchema;
export type EmailMessageResponse = z.infer<typeof EmailMessageResponseSchema>;

export const EmailDigestResponseSchema = EmailDigestRecordSchema;
export type EmailDigestResponse = z.infer<typeof EmailDigestResponseSchema>;

export const EmailSearchApiResponseSchema = z.object({
  query: z.string(),
  results: z.array(EmailSearchResultSchema),
});
export type EmailSearchApiResponse = z.infer<typeof EmailSearchApiResponseSchema>;

export const EmailSyncResponseSchema = EmailSyncResultSchema;
export type EmailSyncResponse = z.infer<typeof EmailSyncResponseSchema>;

export const EmailDraftCreateRequestSchema = EmailDraftCreateInputSchema;
export type EmailDraftCreateRequest = z.infer<typeof EmailDraftCreateRequestSchema>;

export const EmailDraftUpdateRequestSchema = EmailDraftUpdateInputSchema;
export type EmailDraftUpdateRequest = z.infer<typeof EmailDraftUpdateRequestSchema>;

export const EmailDraftResponseSchema = EmailDraftRecordSchema;
export type EmailDraftResponse = z.infer<typeof EmailDraftResponseSchema>;

export { EmailAccountRegistrationInputSchema, EmailAccountRecordSchema, EmailThreadRecordSchema, EmailMessageRecordSchema, EmailDigestRecordSchema, EmailSearchResultSchema, EmailSyncResultSchema, EmailDraftCreateInputSchema, EmailDraftRecordSchema, EmailDraftUpdateInputSchema };

// --- GitHub API schemas ---

export const GithubAccountListResponseSchema = z.array(GithubAccountRecordSchema);
export type GithubAccountListResponse = z.infer<typeof GithubAccountListResponseSchema>;

export const GithubAccountCreateRequestSchema = GithubAccountRegistrationInputSchema;
export type GithubAccountCreateRequest = z.infer<typeof GithubAccountCreateRequestSchema>;

export const GithubAccountResponseSchema = GithubAccountRecordSchema;
export type GithubAccountResponse = z.infer<typeof GithubAccountResponseSchema>;

export const GithubRepoListResponseSchema = z.array(GithubRepoRecordSchema);
export type GithubRepoListResponse = z.infer<typeof GithubRepoListResponseSchema>;

export const GithubPullRequestListResponseSchema = z.array(GithubPullRequestRecordSchema);
export type GithubPullRequestListResponse = z.infer<typeof GithubPullRequestListResponseSchema>;

export const GithubPullRequestResponseSchema = GithubPullRequestRecordSchema;
export type GithubPullRequestResponse = z.infer<typeof GithubPullRequestResponseSchema>;

export const GithubIssueListResponseSchema = z.array(GithubIssueRecordSchema);
export type GithubIssueListResponse = z.infer<typeof GithubIssueListResponseSchema>;

export const GithubIssueResponseSchema = GithubIssueRecordSchema;
export type GithubIssueResponse = z.infer<typeof GithubIssueResponseSchema>;

export const GithubNotificationListResponseSchema = z.array(GithubNotificationRecordSchema);
export type GithubNotificationListResponse = z.infer<typeof GithubNotificationListResponseSchema>;

export const GithubDigestResponseSchema = GithubDigestRecordSchema;
export type GithubDigestResponse = z.infer<typeof GithubDigestResponseSchema>;

export const GithubSearchApiResponseSchema = z.object({
  query: z.string(),
  results: z.array(GithubSearchResultSchema),
});
export type GithubSearchApiResponse = z.infer<typeof GithubSearchApiResponseSchema>;

export const GithubSyncResponseSchema = GithubSyncResultSchema;
export type GithubSyncResponse = z.infer<typeof GithubSyncResponseSchema>;

export const GithubCommentCreateRequestSchema = GithubCommentCreateInputSchema;
export type GithubCommentCreateRequest = z.infer<typeof GithubCommentCreateRequestSchema>;

export const GithubCommentResponseSchema = GithubCommentRecordSchema;
export type GithubCommentResponse = z.infer<typeof GithubCommentResponseSchema>;

export const GithubNotificationMarkReadRequestSchema = GithubNotificationMarkReadInputSchema;
export type GithubNotificationMarkReadRequest = z.infer<typeof GithubNotificationMarkReadRequestSchema>;

export { GithubAccountRegistrationInputSchema, GithubAccountRecordSchema, GithubRepoRecordSchema, GithubPullRequestRecordSchema, GithubIssueRecordSchema, GithubNotificationRecordSchema, GithubDigestRecordSchema, GithubSearchResultSchema, GithubSyncResultSchema, GithubCommentCreateInputSchema, GithubCommentRecordSchema, GithubNotificationMarkReadInputSchema };

// --- Calendar API schemas ---

export const CalendarAccountListResponseSchema = z.array(CalendarAccountRecordSchema);
export type CalendarAccountListResponse = z.infer<typeof CalendarAccountListResponseSchema>;

export const CalendarAccountCreateRequestSchema = CalendarAccountRegistrationInputSchema;
export type CalendarAccountCreateRequest = z.infer<typeof CalendarAccountCreateRequestSchema>;

export const CalendarAccountResponseSchema = CalendarAccountRecordSchema;
export type CalendarAccountResponse = z.infer<typeof CalendarAccountResponseSchema>;

export const CalendarEventListResponseSchema = z.array(CalendarEventRecordSchema);
export type CalendarEventListResponse = z.infer<typeof CalendarEventListResponseSchema>;

export const CalendarEventResponseSchema = CalendarEventRecordSchema;
export type CalendarEventResponse = z.infer<typeof CalendarEventResponseSchema>;

export const CalendarDigestResponseSchema = CalendarDigestRecordSchema;
export type CalendarDigestResponse = z.infer<typeof CalendarDigestResponseSchema>;

export const CalendarSearchApiResponseSchema = z.object({
  query: z.string(),
  results: z.array(CalendarSearchResultSchema),
});
export type CalendarSearchApiResponse = z.infer<typeof CalendarSearchApiResponseSchema>;

export const CalendarSyncResponseSchema = CalendarSyncResultSchema;
export type CalendarSyncResponse = z.infer<typeof CalendarSyncResponseSchema>;

export const CalendarAvailabilityResponseSchema = z.array(CalendarAvailabilitySlotSchema);
export type CalendarAvailabilityResponse = z.infer<typeof CalendarAvailabilityResponseSchema>;

export const CalendarEventCreateRequestSchema = CalendarEventCreateInputSchema;
export type CalendarEventCreateRequest = z.infer<typeof CalendarEventCreateRequestSchema>;

export const CalendarEventUpdateRequestSchema = CalendarEventUpdateInputSchema;
export type CalendarEventUpdateRequest = z.infer<typeof CalendarEventUpdateRequestSchema>;

export { CalendarAccountRegistrationInputSchema, CalendarAccountRecordSchema, CalendarEventRecordSchema, CalendarDigestRecordSchema, CalendarSearchResultSchema, CalendarSyncResultSchema, CalendarAvailabilitySlotSchema, CalendarEventCreateInputSchema, CalendarEventUpdateInputSchema };

// --- Todos API schemas ---

export const TodoAccountListResponseSchema = z.array(TodoAccountRecordSchema);
export type TodoAccountListResponse = z.infer<typeof TodoAccountListResponseSchema>;

export const TodoAccountCreateRequestSchema = TodoAccountRegistrationInputSchema;
export type TodoAccountCreateRequest = z.infer<typeof TodoAccountCreateRequestSchema>;

export const TodoAccountResponseSchema = TodoAccountRecordSchema;
export type TodoAccountResponse = z.infer<typeof TodoAccountResponseSchema>;

export const TodoItemListResponseSchema = z.array(TodoItemRecordSchema);
export type TodoItemListResponse = z.infer<typeof TodoItemListResponseSchema>;

export const TodoItemResponseSchema = TodoItemRecordSchema;
export type TodoItemResponse = z.infer<typeof TodoItemResponseSchema>;

export const TodoProjectListResponseSchema = z.array(TodoProjectRecordSchema);
export type TodoProjectListResponse = z.infer<typeof TodoProjectListResponseSchema>;

export const TodoDigestResponseSchema = TodoDigestRecordSchema;
export type TodoDigestResponse = z.infer<typeof TodoDigestResponseSchema>;

export const TodoSearchApiResponseSchema = z.object({
  query: z.string(),
  results: z.array(TodoSearchResultSchema),
});
export type TodoSearchApiResponse = z.infer<typeof TodoSearchApiResponseSchema>;

export const TodoSyncResponseSchema = TodoSyncResultSchema;
export type TodoSyncResponse = z.infer<typeof TodoSyncResponseSchema>;

export const TodoCreateRequestSchema = TodoCreateInputSchema;
export type TodoCreateRequest = z.infer<typeof TodoCreateRequestSchema>;

export const TodoistConnectRequestSchema = TodoistConnectInputSchema;
export type TodoistConnectRequest = z.infer<typeof TodoistConnectRequestSchema>;

export const TodoistConnectResponseSchema = TodoistConnectResultSchema;
export type TodoistConnectResponse = z.infer<typeof TodoistConnectResponseSchema>;

export const TodoReprioritizeRequestSchema = TodoReprioritizeInputSchema;
export type TodoReprioritizeRequest = z.infer<typeof TodoReprioritizeRequestSchema>;

export const TodoRescheduleRequestSchema = TodoRescheduleInputSchema;
export type TodoRescheduleRequest = z.infer<typeof TodoRescheduleRequestSchema>;

export const TodoMoveRequestSchema = TodoMoveInputSchema;
export type TodoMoveRequest = z.infer<typeof TodoMoveRequestSchema>;

export const TodoReconcileResponseSchema = TodoReconcileResultSchema;
export type TodoReconcileResponse = z.infer<typeof TodoReconcileResponseSchema>;

export { TodoAccountRegistrationInputSchema, TodoAccountRecordSchema, TodoItemRecordSchema, TodoProjectRecordSchema, TodoDigestRecordSchema, TodoSearchResultSchema, TodoSyncResultSchema, TodoCreateInputSchema, TodoistConnectInputSchema, TodoistConnectResultSchema, TodoReprioritizeInputSchema, TodoRescheduleInputSchema, TodoMoveInputSchema, TodoReconcileResultSchema };

// --- People API schemas ---

export const PersonListResponseSchema = z.array(PersonListItemSchema);
export type PersonListResponse = z.infer<typeof PersonListResponseSchema>;

export const PersonResponseSchema = PersonRecordSchema;
export type PersonResponse = z.infer<typeof PersonResponseSchema>;

export const PersonSearchApiResponseSchema = z.object({
  query: z.string(),
  results: z.array(PersonSearchResultSchema),
});
export type PersonSearchApiResponse = z.infer<typeof PersonSearchApiResponseSchema>;

export const PersonUpdateRequestSchema = PersonUpdateInputSchema;
export type PersonUpdateRequest = z.infer<typeof PersonUpdateRequestSchema>;

export const PersonMergeRequestSchema = PersonMergeInputSchema;
export type PersonMergeRequest = z.infer<typeof PersonMergeRequestSchema>;

export const PersonSplitRequestSchema = PersonSplitInputSchema;
export type PersonSplitRequest = z.infer<typeof PersonSplitRequestSchema>;

export const PersonIdentityAttachRequestSchema = PersonIdentityAttachInputSchema;
export type PersonIdentityAttachRequest = z.infer<typeof PersonIdentityAttachRequestSchema>;

export const PersonIdentityDetachRequestSchema = PersonIdentityDetachInputSchema;
export type PersonIdentityDetachRequest = z.infer<typeof PersonIdentityDetachRequestSchema>;

export const PersonMergeEventListResponseSchema = z.array(PersonMergeEventRecordSchema);
export type PersonMergeEventListResponse = z.infer<typeof PersonMergeEventListResponseSchema>;

export const PersonMergeSuggestionListResponseSchema = z.array(PersonMergeSuggestionSchema);
export type PersonMergeSuggestionListResponse = z.infer<typeof PersonMergeSuggestionListResponseSchema>;

export const PersonActivityRollupListResponseSchema = z.array(PersonActivityRollupSchema);
export type PersonActivityRollupListResponse = z.infer<typeof PersonActivityRollupListResponseSchema>;

export { PersonListItemSchema, PersonRecordSchema, PersonSearchQuerySchema, PersonSearchResultSchema, PersonUpdateInputSchema, PersonMergeInputSchema, PersonSplitInputSchema, PersonIdentityAttachInputSchema, PersonIdentityDetachInputSchema, PersonMergeEventRecordSchema, PersonMergeSuggestionSchema, PersonActivityRollupSchema };

// --- Finance API schemas ---

import { FinanceImportRecordSchema, FinanceTransactionRecordSchema, FinanceDocumentRecordSchema, FinanceDigestRecordSchema, FinanceSearchResultSchema, FinanceAnomalyFlagSchema, FinanceReminderCandidateSchema } from './finance.js';

export const FinanceImportListResponseSchema = z.array(FinanceImportRecordSchema);
export type FinanceImportListResponse = z.infer<typeof FinanceImportListResponseSchema>;

export const FinanceTransactionListResponseSchema = z.array(FinanceTransactionRecordSchema);
export type FinanceTransactionListResponse = z.infer<typeof FinanceTransactionListResponseSchema>;

export const FinanceDocumentListResponseSchema = z.array(FinanceDocumentRecordSchema);
export type FinanceDocumentListResponse = z.infer<typeof FinanceDocumentListResponseSchema>;

export const FinanceDigestResponseSchema = FinanceDigestRecordSchema;
export type FinanceDigestResponse = z.infer<typeof FinanceDigestResponseSchema>;

export const FinanceSearchApiResponseSchema = z.object({
  query: z.string(),
  results: z.array(FinanceSearchResultSchema),
});
export type FinanceSearchApiResponse = z.infer<typeof FinanceSearchApiResponseSchema>;

export const FinanceAnomalyListResponseSchema = z.array(FinanceAnomalyFlagSchema);
export type FinanceAnomalyListResponse = z.infer<typeof FinanceAnomalyListResponseSchema>;

export const FinanceReminderListResponseSchema = z.array(FinanceReminderCandidateSchema);
export type FinanceReminderListResponse = z.infer<typeof FinanceReminderListResponseSchema>;

export { FinanceImportRecordSchema, FinanceTransactionRecordSchema, FinanceDocumentRecordSchema, FinanceDigestRecordSchema, FinanceSearchResultSchema, FinanceAnomalyFlagSchema, FinanceReminderCandidateSchema };

// --- Medical API schemas ---

import { MedicalImportRecordSchema, MedicalAppointmentRecordSchema, MedicalMedicationRecordSchema, MedicalDocumentRecordSchema, MedicalDigestRecordSchema, MedicalSearchResultSchema, MedicalReminderCandidateSchema } from './medical.js';

export const MedicalImportListResponseSchema = z.array(MedicalImportRecordSchema);
export type MedicalImportListResponse = z.infer<typeof MedicalImportListResponseSchema>;

export const MedicalAppointmentListResponseSchema = z.array(MedicalAppointmentRecordSchema);
export type MedicalAppointmentListResponse = z.infer<typeof MedicalAppointmentListResponseSchema>;

export const MedicalMedicationListResponseSchema = z.array(MedicalMedicationRecordSchema);
export type MedicalMedicationListResponse = z.infer<typeof MedicalMedicationListResponseSchema>;

export const MedicalDocumentListResponseSchema = z.array(MedicalDocumentRecordSchema);
export type MedicalDocumentListResponse = z.infer<typeof MedicalDocumentListResponseSchema>;

export const MedicalDigestResponseSchema = MedicalDigestRecordSchema;
export type MedicalDigestResponse = z.infer<typeof MedicalDigestResponseSchema>;

export const MedicalSearchApiResponseSchema = z.object({
  query: z.string(),
  results: z.array(MedicalSearchResultSchema),
});
export type MedicalSearchApiResponse = z.infer<typeof MedicalSearchApiResponseSchema>;

export const MedicalReminderListResponseSchema = z.array(MedicalReminderCandidateSchema);
export type MedicalReminderListResponse = z.infer<typeof MedicalReminderListResponseSchema>;

export { MedicalImportRecordSchema, MedicalAppointmentRecordSchema, MedicalMedicationRecordSchema, MedicalDocumentRecordSchema, MedicalDigestRecordSchema, MedicalSearchResultSchema, MedicalReminderCandidateSchema };
