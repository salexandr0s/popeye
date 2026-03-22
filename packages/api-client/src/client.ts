import { z } from 'zod';
import {
  type AgentProfileListItem,
  AgentProfileListItemSchema,
  type CompiledInstructionBundle,
  type MemoryImportInputSchema,
  type MemoryImportResponse,
  MemoryImportResponseSchema,
  CompiledInstructionBundleSchema,
  type CsrfTokenResponse,
  CsrfTokenResponseSchema,
  type DaemonStateRecord,
  DaemonStateRecordSchema,
  type DaemonStatusResponse,
  DaemonStatusResponseSchema,
  type EngineCapabilitiesResponse,
  EngineCapabilitiesResponseSchema,
  type ExecutionEnvelopeResponse,
  ExecutionEnvelopeResponseSchema,
  type HealthResponse,
  HealthResponseSchema,
  type InterventionRecord,
  InterventionRecordSchema,
  type JobLeaseRecord,
  JobLeaseRecordSchema,
  type JobRecord,
  JobRecordSchema,
  type MemoryAuditResponse,
  MemoryAuditResponseSchema,
  type MemoryRecord,
  MemoryRecordSchema,
  type MemorySearchResponse,
  MemorySearchResponseSchema,
  type MemoryType,
  type MessageIngressResponse,
  MessageIngressResponseSchema,
  type MessageRecord,
  MessageRecordSchema,
  type ProjectListItem,
  ProjectListItemSchema,
  type ReceiptRecord,
  ReceiptRecordSchema,
  type RunEventRecord,
  RunEventRecordSchema,
  type RunReply,
  RunReplySchema,
  type RunRecord,
  type RunState,
  RunRecordSchema,
  type SchedulerStatusResponse,
  SchedulerStatusResponseSchema,
  type SecurityAuditResponse,
  SecurityAuditResponseSchema,
  type SessionRootRecord,
  SessionRootRecordSchema,
  type TaskCreateInputSchema,
  type TaskCreateResponse,
  TaskCreateResponseSchema,
  type TaskRecord,
  TaskRecordSchema,
  type TelegramDeliveryRecord,
  TelegramDeliveryRecordSchema,
  type TelegramDeliveryResolutionRecord,
  TelegramDeliveryResolutionRecordSchema,
  type TelegramDeliveryResolutionRequest,
  type TelegramDeliveryState,
  TelegramDeliveryStateSchema,
  type TelegramRelayCheckpoint,
  type TelegramRelayCheckpointCommitRequest,
  TelegramRelayCheckpointSchema,
  TelegramRelayCheckpointResponseSchema,
  type TelegramSendAttemptRecord,
  TelegramSendAttemptRecordSchema,
  type UsageSummary,
  UsageSummarySchema,
  type WorkspaceListItem,
  WorkspaceListItemSchema,
  type IngestMessageInput,
  type ApprovalRequest,
  type ApprovalRecord,
  ApprovalRecordSchema,
  type ApprovalResolveInput,
  type StandingApprovalRecord,
  StandingApprovalRecordSchema,
  type StandingApprovalCreateRequest,
  type PolicyGrantRevokeRequest,
  type AutomationGrantRecord,
  AutomationGrantRecordSchema,
  type AutomationGrantCreateRequest,
  type ConnectionRecord,
  ConnectionRecordSchema,
  type ConnectionResourceRule,
  ConnectionResourceRuleSchema,
  ConnectionDiagnosticsResponseSchema,
  type ConnectionDiagnosticsResponse,
  type ConnectionResourceRuleCreateInput,
  type ConnectionRemediationAction,
  type ConnectionCreateInput,
  type ConnectionUpdateInput,
  type OAuthConnectStartRequestApi,
  type OAuthSessionResponse,
  OAuthSessionResponseSchema,
  type ContextReleasePreview,
  ContextReleasePreviewSchema,
  type SecurityPolicyResponse,
  SecurityPolicyResponseSchema,
  type DomainKind,
  type VaultCreateRequest,
  VaultRecordSchema,
  type VaultRecord,
  type VaultOpenRequest,
  type FileRootRecord,
  FileRootRecordSchema,
  type FileRootRegistrationInput,
  type FileRootUpdateInput,
  type FileDocumentRecord,
  FileDocumentRecordSchema,
  type FileSearchResponse,
  FileSearchResponseSchema,
  type FileIndexResult,
  FileIndexResultSchema,
  type EmailAccountRecord,
  EmailAccountRecordSchema,
  type EmailThreadRecord,
  EmailThreadRecordSchema,
  type EmailMessageRecord,
  EmailMessageRecordSchema,
  type EmailDigestRecord,
  EmailDigestRecordSchema,
  type EmailDraftCreateInput,
  type EmailDraftRecord,
  EmailDraftRecordSchema,
  type EmailDraftUpdateInput,
  type EmailSearchResult,
  EmailSearchResultSchema,
  type EmailAccountRegistrationInput,
  type EmailSyncResult,
  EmailSyncResultSchema,
  type SecretRefRecord,
  SecretRefRecordSchema,
  type GithubAccountRecord,
  GithubAccountRecordSchema,
  type GithubCommentCreateInput,
  type GithubCommentRecord,
  GithubCommentRecordSchema,
  type GithubRepoRecord,
  GithubRepoRecordSchema,
  type GithubPullRequestRecord,
  GithubPullRequestRecordSchema,
  type GithubIssueRecord,
  GithubIssueRecordSchema,
  type GithubNotificationMarkReadInput,
  type GithubNotificationRecord,
  GithubNotificationRecordSchema,
  type GithubDigestRecord,
  GithubDigestRecordSchema,
  type GithubSearchResult,
  GithubSearchResultSchema,
  type GithubSyncResult,
  GithubSyncResultSchema,
  type CalendarAccountRecord,
  CalendarAccountRecordSchema,
  type CalendarAccountRegistrationInput,
  type CalendarSyncResult,
  CalendarSyncResultSchema,
  type CalendarEventCreateInput,
  type CalendarEventRecord,
  CalendarEventRecordSchema,
  type CalendarDigestRecord,
  CalendarDigestRecordSchema,
  CalendarSearchResultSchema,
  type CalendarSearchResult,
  CalendarAvailabilitySlotSchema,
  type CalendarAvailabilitySlot,
  type CalendarEventUpdateInput,
  type TodoAccountRecord,
  TodoAccountRecordSchema,
  type TodoAccountRegistrationInput,
  type TodoItemRecord,
  TodoItemRecordSchema,
  type TodoProjectRecord,
  TodoProjectRecordSchema,
  type TodoDigestRecord,
  TodoDigestRecordSchema,
  TodoSearchResultSchema,
  type TodoSearchResult,
  type TodoCreateInput,
  type TodoistConnectInput,
  type TodoistConnectResult,
  TodoReconcileResultSchema,
  type TodoReconcileResult,
  type PersonActivityRollup,
  PersonActivityRollupSchema,
  type PersonListItem,
  type PersonMergeEventRecord,
  PersonMergeEventRecordSchema,
  type PersonMergeSuggestion,
  PersonMergeSuggestionSchema,
  type PersonRecord,
  type PersonSearchResult,
  type PersonUpdateInput,
  type PersonMergeInput,
  type PersonSplitInput,
  type PersonIdentityAttachInput,
  type PersonIdentityDetachInput,
  PersonRecordSchema,
  type FileWriteIntentCreateInput,
  type FileWriteIntentRecord,
  FileWriteIntentRecordSchema,
  type FinanceImportRecord,
  FinanceImportRecordSchema,
  type FinanceTransactionRecord,
  FinanceTransactionRecordSchema,
  type FinanceDocumentRecord,
  FinanceDocumentRecordSchema,
  type FinanceDigestRecord,
  FinanceDigestRecordSchema,
  FinanceSearchResultSchema,
  type FinanceSearchResult,
  type MedicalImportRecord,
  MedicalImportRecordSchema,
  type MedicalAppointmentRecord,
  MedicalAppointmentRecordSchema,
  type MedicalMedicationRecord,
  MedicalMedicationRecordSchema,
  type MedicalDocumentRecord,
  MedicalDocumentRecordSchema,
  type MedicalDigestRecord,
  MedicalDigestRecordSchema,
  MedicalSearchResultSchema,
  type MedicalSearchResult,
  type ContextAssemblyResult,
  ContextAssemblyResultSchema,
  type MemoryOperatorActionRecord,
  MemoryOperatorActionRecordSchema,
  type MemoryHistoryResult,
  MemoryHistoryResultSchema,
} from '@popeye/contracts';

export interface PopeyeApiClientOptions {
  baseUrl: string;
  token: string;
}

export interface MemorySearchOptions {
  query: string;
  scope?: string;
  workspaceId?: string | null;
  projectId?: string | null;
  includeGlobal?: boolean;
  memoryTypes?: MemoryType[];
  limit?: number;
  includeContent?: boolean;
  domains?: string[];
  consumerProfile?: 'assistant' | 'coding';
}

export interface MemoryListOptions {
  type?: string;
  scope?: string;
  workspaceId?: string | null;
  projectId?: string | null;
  includeGlobal?: boolean;
  limit?: number;
}

export interface ListRunsOptions {
  state?: RunState | RunState[];
}

const MemoryMaintenanceResultSchema = z.object({
  ttlExpired: z.number().int().nonnegative(),
  staleMarked: z.number().int().nonnegative(),
});
export type MemoryMaintenanceResult = z.infer<typeof MemoryMaintenanceResultSchema>;

export class PopeyeApiClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private csrfToken: string | null = null;

  constructor(options: PopeyeApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  private mutationHeaders(): Record<string, string> {
    const headers = this.headers();
    if (this.csrfToken) {
      headers['x-popeye-csrf'] = this.csrfToken;
    }
    headers['sec-fetch-site'] = 'same-origin';
    return headers;
  }

  private async get<T>(path: string, schema: { parse: (data: unknown) => T }): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() });
    if (!response.ok) {
      throw new ApiError(response.status, await response.text());
    }
    const data: unknown = await response.json();
    return schema.parse(data);
  }

  private async getArray<T>(path: string, schema: { parse: (data: unknown) => T }): Promise<T[]> {
    const response = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() });
    if (!response.ok) {
      throw new ApiError(response.status, await response.text());
    }
    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw new Error('Expected array response');
    return data.map((item) => schema.parse(item));
  }

  private async post<T>(path: string, body: unknown, schema: { parse: (data: unknown) => T }): Promise<T> {
    await this.ensureCsrfToken();
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.mutationHeaders(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new ApiError(response.status, await response.text());
    }
    const data: unknown = await response.json();
    return schema.parse(data);
  }

  private async postRaw(path: string, body?: unknown): Promise<Response> {
    await this.ensureCsrfToken();
    return fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.mutationHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  private async patch<T>(path: string, body: unknown, schema: { parse: (data: unknown) => T }): Promise<T> {
    await this.ensureCsrfToken();
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'PATCH',
      headers: this.mutationHeaders(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new ApiError(response.status, await response.text());
    }
    const data: unknown = await response.json();
    return schema.parse(data);
  }

  private async del(path: string): Promise<void> {
    await this.ensureCsrfToken();
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: this.mutationHeaders(),
    });
    if (!response.ok) {
      throw new ApiError(response.status, await response.text());
    }
  }

  private async ensureCsrfToken(): Promise<void> {
    if (this.csrfToken) return;
    const result: CsrfTokenResponse = await this.get('/v1/security/csrf-token', CsrfTokenResponseSchema);
    this.csrfToken = result.token;
  }

  private buildQuery(params: Record<string, string | number | boolean | null | undefined>): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        query.set(key, String(value));
      }
    }
    const encoded = query.toString();
    return encoded ? `?${encoded}` : '';
  }

  async health(): Promise<HealthResponse> {
    return this.get('/v1/health', HealthResponseSchema);
  }

  async status(): Promise<DaemonStatusResponse> {
    return this.get('/v1/status', DaemonStatusResponseSchema);
  }

  async engineCapabilities(): Promise<EngineCapabilitiesResponse> {
    return this.get('/v1/engine/capabilities', EngineCapabilitiesResponseSchema);
  }

  async daemonState(): Promise<DaemonStateRecord> {
    return this.get('/v1/daemon/state', DaemonStateRecordSchema);
  }

  async schedulerStatus(): Promise<SchedulerStatusResponse> {
    return this.get('/v1/daemon/scheduler', SchedulerStatusResponseSchema);
  }

  async listWorkspaces(): Promise<WorkspaceListItem[]> {
    return this.getArray('/v1/workspaces', WorkspaceListItemSchema);
  }

  async listProjects(): Promise<ProjectListItem[]> {
    return this.getArray('/v1/projects', ProjectListItemSchema);
  }

  async listAgentProfiles(): Promise<AgentProfileListItem[]> {
    return this.getArray('/v1/agent-profiles', AgentProfileListItemSchema);
  }

  async listProfiles(): Promise<AgentProfileListItem[]> {
    return this.getArray('/v1/profiles', AgentProfileListItemSchema);
  }

  async getProfile(id: string): Promise<AgentProfileListItem> {
    return this.get(`/v1/profiles/${encodeURIComponent(id)}`, AgentProfileListItemSchema);
  }

  async getRunEnvelope(runId: string): Promise<ExecutionEnvelopeResponse> {
    return this.get(`/v1/runs/${encodeURIComponent(runId)}/envelope`, ExecutionEnvelopeResponseSchema);
  }

  async listTasks(): Promise<TaskRecord[]> {
    return this.getArray('/v1/tasks', TaskRecordSchema);
  }

  async getTask(id: string): Promise<TaskRecord> {
    return this.get(`/v1/tasks/${encodeURIComponent(id)}`, TaskRecordSchema);
  }

  async createTask(input: z.input<typeof TaskCreateInputSchema>): Promise<TaskCreateResponse> {
    return this.post('/v1/tasks', input, TaskCreateResponseSchema);
  }

  async listJobs(): Promise<JobRecord[]> {
    return this.getArray('/v1/jobs', JobRecordSchema);
  }

  async getJobLease(jobId: string): Promise<JobLeaseRecord> {
    return this.get(`/v1/jobs/${encodeURIComponent(jobId)}/lease`, JobLeaseRecordSchema);
  }

  async getJob(jobId: string): Promise<JobRecord> {
    return this.get(`/v1/jobs/${encodeURIComponent(jobId)}`, JobRecordSchema);
  }

  async pauseJob(jobId: string): Promise<JobRecord | null> {
    const response = await this.postRaw(`/v1/jobs/${encodeURIComponent(jobId)}/pause`);
    if (!response.ok) throw new ApiError(response.status, await response.text());
    const data: unknown = await response.json();
    return data ? JobRecordSchema.parse(data) : null;
  }

  async resumeJob(jobId: string): Promise<JobRecord | null> {
    const response = await this.postRaw(`/v1/jobs/${encodeURIComponent(jobId)}/resume`);
    if (!response.ok) throw new ApiError(response.status, await response.text());
    const data: unknown = await response.json();
    return data ? JobRecordSchema.parse(data) : null;
  }

  async enqueueJob(jobId: string): Promise<JobRecord | null> {
    const response = await this.postRaw(`/v1/jobs/${encodeURIComponent(jobId)}/enqueue`);
    if (!response.ok) throw new ApiError(response.status, await response.text());
    const data: unknown = await response.json();
    return data ? JobRecordSchema.parse(data) : null;
  }

  async listRuns(options: ListRunsOptions = {}): Promise<RunRecord[]> {
    const state = Array.isArray(options.state) ? options.state.join(',') : options.state;
    return this.getArray(`/v1/runs${this.buildQuery({ state })}`, RunRecordSchema);
  }

  async getRun(id: string): Promise<RunRecord> {
    return this.get(`/v1/runs/${encodeURIComponent(id)}`, RunRecordSchema);
  }

  async getRunReceipt(runId: string): Promise<ReceiptRecord | null> {
    try {
      return await this.get(`/v1/runs/${encodeURIComponent(runId)}/receipt`, ReceiptRecordSchema);
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async getRunReply(runId: string): Promise<RunReply> {
    return this.get(`/v1/runs/${encodeURIComponent(runId)}/reply`, RunReplySchema);
  }

  async listRunEvents(runId: string): Promise<RunEventRecord[]> {
    return this.getArray(`/v1/runs/${encodeURIComponent(runId)}/events`, RunEventRecordSchema);
  }

  async retryRun(runId: string): Promise<JobRecord | null> {
    const response = await this.postRaw(`/v1/runs/${encodeURIComponent(runId)}/retry`);
    if (!response.ok) throw new ApiError(response.status, await response.text());
    const data: unknown = await response.json();
    return data ? JobRecordSchema.parse(data) : null;
  }

  async cancelRun(runId: string): Promise<RunRecord | null> {
    const response = await this.postRaw(`/v1/runs/${encodeURIComponent(runId)}/cancel`);
    if (!response.ok) throw new ApiError(response.status, await response.text());
    const data: unknown = await response.json();
    return data ? RunRecordSchema.parse(data) : null;
  }

  async listReceipts(): Promise<ReceiptRecord[]> {
    return this.getArray('/v1/receipts', ReceiptRecordSchema);
  }

  async getReceipt(id: string): Promise<ReceiptRecord> {
    return this.get(`/v1/receipts/${encodeURIComponent(id)}`, ReceiptRecordSchema);
  }

  async ingestMessage(input: IngestMessageInput): Promise<MessageIngressResponse> {
    await this.ensureCsrfToken();
    const response = await fetch(`${this.baseUrl}/v1/messages/ingest`, {
      method: 'POST',
      headers: this.mutationHeaders(),
      body: JSON.stringify(input),
    });
    const data: unknown = await response.json();
    if (!response.ok) {
      return MessageIngressResponseSchema.parse(data);
    }
    return MessageIngressResponseSchema.parse(data);
  }

  async getMessage(id: string): Promise<MessageRecord> {
    return this.get(`/v1/messages/${encodeURIComponent(id)}`, MessageRecordSchema);
  }

  async getTelegramRelayCheckpoint(workspaceId: string): Promise<TelegramRelayCheckpoint | null> {
    return this.get(
      `/v1/telegram/relay/checkpoint${this.buildQuery({ workspaceId })}`,
      TelegramRelayCheckpointResponseSchema,
    );
  }

  async commitTelegramRelayCheckpoint(input: TelegramRelayCheckpointCommitRequest): Promise<TelegramRelayCheckpoint> {
    return this.post('/v1/telegram/relay/checkpoint', input, TelegramRelayCheckpointSchema);
  }

  async markTelegramReplySent(
    chatId: string,
    telegramMessageId: number,
    input: { workspaceId: string; runId?: string | null; sentTelegramMessageId?: number | null },
  ): Promise<TelegramDeliveryState> {
    return this.post(
      `/v1/telegram/replies/${encodeURIComponent(chatId)}/${encodeURIComponent(String(telegramMessageId))}/mark-sent`,
      input,
      TelegramDeliveryStateSchema,
    );
  }

  async markTelegramReplySending(
    chatId: string,
    telegramMessageId: number,
    input: { workspaceId: string; runId?: string | null },
  ): Promise<TelegramDeliveryState> {
    return this.post(
      `/v1/telegram/replies/${encodeURIComponent(chatId)}/${encodeURIComponent(String(telegramMessageId))}/mark-sending`,
      input,
      TelegramDeliveryStateSchema,
    );
  }

  async markTelegramReplyPending(
    chatId: string,
    telegramMessageId: number,
    input: { workspaceId: string; runId?: string | null },
  ): Promise<TelegramDeliveryState> {
    return this.post(
      `/v1/telegram/replies/${encodeURIComponent(chatId)}/${encodeURIComponent(String(telegramMessageId))}/mark-pending`,
      input,
      TelegramDeliveryStateSchema,
    );
  }

  async markTelegramReplyUncertain(
    chatId: string,
    telegramMessageId: number,
    input: { workspaceId: string; runId?: string | null; reason?: string | null },
  ): Promise<TelegramDeliveryState> {
    return this.post(
      `/v1/telegram/replies/${encodeURIComponent(chatId)}/${encodeURIComponent(String(telegramMessageId))}/mark-uncertain`,
      input,
      TelegramDeliveryStateSchema,
    );
  }

  async getInstructionPreview(scope: string, projectId?: string): Promise<CompiledInstructionBundle> {
    return this.get(
      `/v1/instruction-previews/${encodeURIComponent(scope)}${this.buildQuery({ projectId })}`,
      CompiledInstructionBundleSchema,
    );
  }

  async listInterventions(): Promise<InterventionRecord[]> {
    return this.getArray('/v1/interventions', InterventionRecordSchema);
  }

  async resolveIntervention(id: string): Promise<InterventionRecord | null> {
    const response = await this.postRaw(`/v1/interventions/${encodeURIComponent(id)}/resolve`);
    if (!response.ok) throw new ApiError(response.status, await response.text());
    const data: unknown = await response.json();
    return data ? InterventionRecordSchema.parse(data) : null;
  }

  async searchMemory(queryOrOptions: string | MemorySearchOptions): Promise<MemorySearchResponse> {
    const options = typeof queryOrOptions === 'string' ? { query: queryOrOptions } : queryOrOptions;
    return this.get(
      `/v1/memory/search${this.buildQuery({
        q: options.query,
        scope: options.scope,
        workspaceId: options.workspaceId,
        projectId: options.projectId,
        includeGlobal: options.includeGlobal,
        types: options.memoryTypes?.join(','),
        limit: options.limit,
        full: options.includeContent,
        domains: options.domains?.join(','),
        consumerProfile: options.consumerProfile,
      })}`,
      MemorySearchResponseSchema,
    );
  }

  async memoryAudit(): Promise<MemoryAuditResponse> {
    return this.get('/v1/memory/audit', MemoryAuditResponseSchema);
  }

  async listMemories(options: MemoryListOptions = {}): Promise<MemoryRecord[]> {
    return this.getArray(
      `/v1/memory${this.buildQuery({
        type: options.type,
        scope: options.scope,
        workspaceId: options.workspaceId,
        projectId: options.projectId,
        includeGlobal: options.includeGlobal,
        limit: options.limit,
      })}`,
      MemoryRecordSchema,
    );
  }

  async getMemory(id: string): Promise<MemoryRecord | null> {
    try {
      return await this.get(`/v1/memory/${encodeURIComponent(id)}`, MemoryRecordSchema);
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async triggerMemoryMaintenance(): Promise<MemoryMaintenanceResult> {
    return this.post('/v1/memory/maintenance', {}, MemoryMaintenanceResultSchema);
  }

  async importMemory(input: z.input<typeof MemoryImportInputSchema>): Promise<MemoryImportResponse> {
    return this.post('/v1/memory/import', input, MemoryImportResponseSchema);
  }

  async assembleMemoryContext(opts: {
    q: string;
    scope?: string;
    workspaceId?: string;
    projectId?: string;
    maxTokens?: number;
    consumerProfile?: string;
    includeProvenance?: boolean;
  }): Promise<ContextAssemblyResult> {
    const params = new URLSearchParams({ q: opts.q });
    if (opts.scope) params.set('scope', opts.scope);
    if (opts.workspaceId) params.set('workspaceId', opts.workspaceId);
    if (opts.projectId) params.set('projectId', opts.projectId);
    if (opts.maxTokens) params.set('maxTokens', String(opts.maxTokens));
    if (opts.consumerProfile) params.set('consumerProfile', opts.consumerProfile);
    if (opts.includeProvenance !== undefined) params.set('includeProvenance', String(opts.includeProvenance));
    return this.get(`/v1/memory/context?${params.toString()}`, ContextAssemblyResultSchema);
  }

  async pinMemory(id: string, opts?: { targetKind?: 'fact' | 'synthesis'; reason?: string }): Promise<MemoryOperatorActionRecord> {
    return this.post(`/v1/memory/${encodeURIComponent(id)}/pin`, { targetKind: opts?.targetKind ?? 'fact', reason: opts?.reason ?? '' }, MemoryOperatorActionRecordSchema);
  }

  async forgetMemory(id: string, reason?: string): Promise<MemoryOperatorActionRecord> {
    return this.post(`/v1/memory/${encodeURIComponent(id)}/forget`, { reason: reason ?? '' }, MemoryOperatorActionRecordSchema);
  }

  async getMemoryHistory(id: string): Promise<MemoryHistoryResult> {
    return this.get(`/v1/memory/${encodeURIComponent(id)}/history`, MemoryHistoryResultSchema);
  }

  async listSessionRoots(): Promise<SessionRootRecord[]> {
    return this.getArray('/v1/sessions', SessionRootRecordSchema);
  }

  async usageSummary(): Promise<UsageSummary> {
    return this.get('/v1/usage/summary', UsageSummarySchema);
  }

  async securityAudit(): Promise<SecurityAuditResponse> {
    return this.get('/v1/security/audit', SecurityAuditResponseSchema);
  }

  // --- Policy substrate client methods ---

  async listApprovals(filter?: { scope?: string; status?: string; domain?: string; actionKind?: string; runId?: string; resolvedBy?: string }): Promise<ApprovalRecord[]> {
    return this.getArray(`/v1/approvals${this.buildQuery(filter ?? {})}`, ApprovalRecordSchema);
  }

  async getApproval(id: string): Promise<ApprovalRecord> {
    return this.get(`/v1/approvals/${encodeURIComponent(id)}`, ApprovalRecordSchema);
  }

  async requestApproval(input: ApprovalRequest): Promise<ApprovalRecord> {
    return this.post('/v1/approvals', input, ApprovalRecordSchema);
  }

  async resolveApproval(id: string, input: ApprovalResolveInput): Promise<ApprovalRecord> {
    return this.post(`/v1/approvals/${encodeURIComponent(id)}/resolve`, input, ApprovalRecordSchema);
  }

  async listStandingApprovals(filter?: { status?: string; domain?: string; actionKind?: string }): Promise<StandingApprovalRecord[]> {
    return this.getArray(`/v1/policies/standing-approvals${this.buildQuery(filter ?? {})}`, StandingApprovalRecordSchema);
  }

  async createStandingApproval(input: StandingApprovalCreateRequest): Promise<StandingApprovalRecord> {
    return this.post('/v1/policies/standing-approvals', input, StandingApprovalRecordSchema);
  }

  async revokeStandingApproval(id: string, input: PolicyGrantRevokeRequest): Promise<StandingApprovalRecord> {
    return this.post(`/v1/policies/standing-approvals/${encodeURIComponent(id)}/revoke`, input, StandingApprovalRecordSchema);
  }

  async listAutomationGrants(filter?: { status?: string; domain?: string; actionKind?: string }): Promise<AutomationGrantRecord[]> {
    return this.getArray(`/v1/policies/automation-grants${this.buildQuery(filter ?? {})}`, AutomationGrantRecordSchema);
  }

  async createAutomationGrant(input: AutomationGrantCreateRequest): Promise<AutomationGrantRecord> {
    return this.post('/v1/policies/automation-grants', input, AutomationGrantRecordSchema);
  }

  async revokeAutomationGrant(id: string, input: PolicyGrantRevokeRequest): Promise<AutomationGrantRecord> {
    return this.post(`/v1/policies/automation-grants/${encodeURIComponent(id)}/revoke`, input, AutomationGrantRecordSchema);
  }

  async getSecurityPolicy(): Promise<SecurityPolicyResponse> {
    return this.get('/v1/security/policy', SecurityPolicyResponseSchema);
  }

  async listVaults(domain?: DomainKind): Promise<VaultRecord[]> {
    return this.getArray(`/v1/vaults${this.buildQuery({ domain })}`, VaultRecordSchema);
  }

  async getVault(id: string): Promise<VaultRecord> {
    return this.get(`/v1/vaults/${encodeURIComponent(id)}`, VaultRecordSchema);
  }

  async createVault(input: VaultCreateRequest): Promise<VaultRecord> {
    return this.post('/v1/vaults', input, VaultRecordSchema);
  }

  async openVault(id: string, input: VaultOpenRequest): Promise<VaultRecord> {
    return this.post(`/v1/vaults/${encodeURIComponent(id)}/open`, input, VaultRecordSchema);
  }

  async closeVault(id: string): Promise<VaultRecord> {
    return this.post(`/v1/vaults/${encodeURIComponent(id)}/close`, {}, VaultRecordSchema);
  }

  async sealVault(id: string): Promise<VaultRecord> {
    return this.post(`/v1/vaults/${encodeURIComponent(id)}/seal`, {}, VaultRecordSchema);
  }

  async listConnections(domain?: string): Promise<ConnectionRecord[]> {
    return this.getArray(`/v1/connections${this.buildQuery({ domain })}`, ConnectionRecordSchema);
  }

  async startOAuthConnection(input: OAuthConnectStartRequestApi): Promise<OAuthSessionResponse> {
    return this.post('/v1/connections/oauth/start', input, OAuthSessionResponseSchema);
  }

  async getOAuthConnectionSession(id: string): Promise<OAuthSessionResponse> {
    return this.get(`/v1/connections/oauth/sessions/${encodeURIComponent(id)}`, OAuthSessionResponseSchema);
  }

  async createConnection(input: ConnectionCreateInput): Promise<ConnectionRecord> {
    return this.post('/v1/connections', input, ConnectionRecordSchema);
  }

  async updateConnection(id: string, input: ConnectionUpdateInput): Promise<ConnectionRecord> {
    return this.patch(`/v1/connections/${encodeURIComponent(id)}`, input, ConnectionRecordSchema);
  }

  async deleteConnection(id: string): Promise<void> {
    return this.del(`/v1/connections/${encodeURIComponent(id)}`);
  }

  async storeSecret(input: { key: string; value: string; connectionId?: string; description?: string }): Promise<SecretRefRecord> {
    return this.post('/v1/secrets', input, SecretRefRecordSchema);
  }

  async previewContextRelease(input: { domain: DomainKind; sourceRef: string }): Promise<ContextReleasePreview> {
    return this.post('/v1/context-release/preview', input, ContextReleasePreviewSchema);
  }

  // --- Telegram delivery resolution & send-attempt client methods ---

  async listUncertainDeliveries(workspaceId?: string): Promise<TelegramDeliveryRecord[]> {
    return this.getArray(
      `/v1/telegram/deliveries/uncertain${this.buildQuery({ workspaceId })}`,
      TelegramDeliveryRecordSchema,
    );
  }

  async getDelivery(id: string): Promise<TelegramDeliveryRecord> {
    return this.get(`/v1/telegram/deliveries/${encodeURIComponent(id)}`, TelegramDeliveryRecordSchema);
  }

  async resolveTelegramDelivery(id: string, input: TelegramDeliveryResolutionRequest): Promise<TelegramDeliveryResolutionRecord> {
    return this.post(
      `/v1/telegram/deliveries/${encodeURIComponent(id)}/resolve`,
      input,
      TelegramDeliveryResolutionRecordSchema,
    );
  }

  async listDeliveryResolutions(deliveryId: string): Promise<TelegramDeliveryResolutionRecord[]> {
    return this.getArray(
      `/v1/telegram/deliveries/${encodeURIComponent(deliveryId)}/resolutions`,
      TelegramDeliveryResolutionRecordSchema,
    );
  }

  async getResendableDeliveries(workspaceId: string): Promise<TelegramDeliveryRecord[]> {
    return this.getArray(
      `/v1/telegram/deliveries/uncertain${this.buildQuery({ workspaceId })}`,
      TelegramDeliveryRecordSchema,
    );
  }

  async listTelegramSendAttempts(deliveryId: string): Promise<TelegramSendAttemptRecord[]> {
    return this.getArray(
      `/v1/telegram/deliveries/${encodeURIComponent(deliveryId)}/attempts`,
      TelegramSendAttemptRecordSchema,
    );
  }

  async recordSendAttempt(input: {
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
  }): Promise<TelegramSendAttemptRecord> {
    return this.post('/v1/telegram/send-attempts', input, TelegramSendAttemptRecordSchema);
  }

  // --- File roots ---

  async listFileRoots(workspaceId?: string): Promise<FileRootRecord[]> {
    const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
    return this.getArray(`/v1/files/roots${query}`, FileRootRecordSchema);
  }

  async createFileRoot(input: FileRootRegistrationInput): Promise<FileRootRecord> {
    return this.post('/v1/files/roots', input, FileRootRecordSchema);
  }

  async getFileRoot(id: string): Promise<FileRootRecord> {
    return this.get(`/v1/files/roots/${encodeURIComponent(id)}`, FileRootRecordSchema);
  }

  async updateFileRoot(id: string, input: FileRootUpdateInput): Promise<FileRootRecord> {
    return this.patch(`/v1/files/roots/${encodeURIComponent(id)}`, input, FileRootRecordSchema);
  }

  async deleteFileRoot(id: string): Promise<void> {
    return this.del(`/v1/files/roots/${encodeURIComponent(id)}`);
  }

  async searchFiles(query: string, options?: { rootId?: string | undefined; workspaceId?: string | undefined; limit?: number | undefined }): Promise<FileSearchResponse> {
    const params = this.buildQuery({ query, rootId: options?.rootId, workspaceId: options?.workspaceId, limit: options?.limit });
    return this.get(`/v1/files/search${params}`, FileSearchResponseSchema);
  }

  async getFileDocument(id: string): Promise<FileDocumentRecord> {
    return this.get(`/v1/files/documents/${encodeURIComponent(id)}`, FileDocumentRecordSchema);
  }

  async reindexFileRoot(id: string): Promise<FileIndexResult> {
    return this.post(`/v1/files/roots/${encodeURIComponent(id)}/reindex`, {}, FileIndexResultSchema);
  }

  // --- Email ---

  async listEmailAccounts(): Promise<EmailAccountRecord[]> {
    return this.getArray('/v1/email/accounts', EmailAccountRecordSchema);
  }

  async listEmailThreads(accountId?: string, options?: { limit?: number | undefined; unreadOnly?: boolean | undefined }): Promise<EmailThreadRecord[]> {
    const params = this.buildQuery({
      accountId,
      limit: options?.limit,
      unreadOnly: options?.unreadOnly ? 'true' : undefined,
    });
    return this.getArray(`/v1/email/threads${params}`, EmailThreadRecordSchema);
  }

  async getEmailThread(id: string): Promise<EmailThreadRecord> {
    return this.get(`/v1/email/threads/${encodeURIComponent(id)}`, EmailThreadRecordSchema);
  }

  async getEmailMessage(id: string): Promise<EmailMessageRecord> {
    return this.get(`/v1/email/messages/${encodeURIComponent(id)}`, EmailMessageRecordSchema);
  }

  async getEmailDigest(accountId?: string): Promise<EmailDigestRecord | null> {
    const query = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
    try {
      return await this.get(`/v1/email/digest${query}`, EmailDigestRecordSchema);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 404) return null;
      // API returns null for no digest — handle JSON null
      return null;
    }
  }

  async searchEmail(query: string, options?: { accountId?: string | undefined; limit?: number | undefined }): Promise<{ query: string; results: EmailSearchResult[] }> {
    const params = this.buildQuery({ query, accountId: options?.accountId, limit: options?.limit });
    const responseSchema = z.object({
      query: z.string(),
      results: z.array(EmailSearchResultSchema),
    });
    return this.get(`/v1/email/search${params}`, responseSchema);
  }

  async registerEmailAccount(input: EmailAccountRegistrationInput): Promise<EmailAccountRecord> {
    return this.post('/v1/email/accounts', input, EmailAccountRecordSchema);
  }

  async syncEmailAccount(accountId: string): Promise<EmailSyncResult> {
    return this.post('/v1/email/sync', { accountId }, EmailSyncResultSchema);
  }

  async generateEmailDigest(accountId?: string): Promise<EmailDigestRecord | null> {
    try {
      return await this.post('/v1/email/digest', accountId ? { accountId } : {}, EmailDigestRecordSchema);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 404) return null;
      return null;
    }
  }

  async createEmailDraft(input: EmailDraftCreateInput): Promise<EmailDraftRecord> {
    return this.post('/v1/email/drafts', input, EmailDraftRecordSchema);
  }

  async updateEmailDraft(id: string, input: EmailDraftUpdateInput): Promise<EmailDraftRecord> {
    return this.patch(`/v1/email/drafts/${encodeURIComponent(id)}`, input, EmailDraftRecordSchema);
  }

  async detectEmailProviders(): Promise<{ gws: { available: boolean }; protonBridge: { available: boolean } }> {
    const schema = z.object({
      gws: z.object({ available: z.boolean() }).passthrough(),
      protonBridge: z.object({ available: z.boolean() }).passthrough(),
    });
    return this.get('/v1/email/providers', schema);
  }

  // --- GitHub ---

  async listGithubAccounts(): Promise<GithubAccountRecord[]> {
    return this.getArray('/v1/github/accounts', GithubAccountRecordSchema);
  }

  async listGithubRepos(accountId?: string, options?: { limit?: number | undefined }): Promise<GithubRepoRecord[]> {
    const params = this.buildQuery({ accountId, limit: options?.limit });
    return this.getArray(`/v1/github/repos${params}`, GithubRepoRecordSchema);
  }

  async listGithubPullRequests(accountId?: string, options?: { state?: string | undefined; limit?: number | undefined }): Promise<GithubPullRequestRecord[]> {
    const params = this.buildQuery({ accountId, state: options?.state, limit: options?.limit });
    return this.getArray(`/v1/github/prs${params}`, GithubPullRequestRecordSchema);
  }

  async getGithubPullRequest(id: string): Promise<GithubPullRequestRecord> {
    return this.get(`/v1/github/prs/${encodeURIComponent(id)}`, GithubPullRequestRecordSchema);
  }

  async listGithubIssues(accountId?: string, options?: { state?: string | undefined; assigned?: boolean | undefined; limit?: number | undefined }): Promise<GithubIssueRecord[]> {
    const params = this.buildQuery({
      accountId,
      state: options?.state,
      assigned: options?.assigned ? 'true' : undefined,
      limit: options?.limit,
    });
    return this.getArray(`/v1/github/issues${params}`, GithubIssueRecordSchema);
  }

  async getGithubIssue(id: string): Promise<GithubIssueRecord> {
    return this.get(`/v1/github/issues/${encodeURIComponent(id)}`, GithubIssueRecordSchema);
  }

  async listGithubNotifications(accountId?: string, options?: { limit?: number | undefined }): Promise<GithubNotificationRecord[]> {
    const params = this.buildQuery({ accountId, limit: options?.limit });
    return this.getArray(`/v1/github/notifications${params}`, GithubNotificationRecordSchema);
  }

  async getGithubDigest(accountId?: string): Promise<GithubDigestRecord | null> {
    const query = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
    try {
      return await this.get(`/v1/github/digest${query}`, GithubDigestRecordSchema);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 404) return null;
      return null;
    }
  }

  async searchGithub(query: string, options?: { accountId?: string | undefined; entityType?: string | undefined; limit?: number | undefined }): Promise<{ query: string; results: GithubSearchResult[] }> {
    const params = this.buildQuery({ query, accountId: options?.accountId, entityType: options?.entityType, limit: options?.limit });
    const responseSchema = z.object({
      query: z.string(),
      results: z.array(GithubSearchResultSchema),
    });
    return this.get(`/v1/github/search${params}`, responseSchema);
  }

  async syncGithubAccount(accountId: string): Promise<GithubSyncResult> {
    return this.post('/v1/github/sync', { accountId }, GithubSyncResultSchema);
  }

  async createGithubComment(input: GithubCommentCreateInput): Promise<GithubCommentRecord> {
    return this.post('/v1/github/comments', input, GithubCommentRecordSchema);
  }

  async markGithubNotificationRead(input: GithubNotificationMarkReadInput): Promise<GithubNotificationRecord> {
    return this.post('/v1/github/notifications/mark-read', input, GithubNotificationRecordSchema);
  }

  // --- Calendar ---

  async listCalendarAccounts(): Promise<CalendarAccountRecord[]> {
    return this.getArray('/v1/calendar/accounts', CalendarAccountRecordSchema);
  }

  async listCalendarEvents(accountId?: string, options?: { dateFrom?: string; dateTo?: string; limit?: number }): Promise<CalendarEventRecord[]> {
    const params = this.buildQuery({ accountId, dateFrom: options?.dateFrom, dateTo: options?.dateTo, limit: options?.limit });
    return this.getArray(`/v1/calendar/events${params}`, CalendarEventRecordSchema);
  }

  async getCalendarEvent(id: string): Promise<CalendarEventRecord> {
    return this.get(`/v1/calendar/events/${encodeURIComponent(id)}`, CalendarEventRecordSchema);
  }

  async searchCalendar(query: string, options?: { accountId?: string; dateFrom?: string; dateTo?: string; limit?: number }): Promise<{ query: string; results: CalendarSearchResult[] }> {
    const params = this.buildQuery({ query, accountId: options?.accountId, dateFrom: options?.dateFrom, dateTo: options?.dateTo, limit: options?.limit });
    const responseSchema = z.object({
      query: z.string(),
      results: z.array(CalendarSearchResultSchema),
    });
    return this.get(`/v1/calendar/search${params}`, responseSchema);
  }

  async getCalendarDigest(accountId?: string): Promise<CalendarDigestRecord | null> {
    const query = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
    try {
      return await this.get(`/v1/calendar/digest${query}`, CalendarDigestRecordSchema);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 404) return null;
      return null;
    }
  }

  async getCalendarAvailability(options: { accountId?: string; date: string; startHour?: number; endHour?: number; slotMinutes?: number }): Promise<CalendarAvailabilitySlot[]> {
    const params = this.buildQuery({
      accountId: options.accountId,
      date: options.date,
      startHour: options.startHour,
      endHour: options.endHour,
      slotMinutes: options.slotMinutes,
    });
    return this.getArray(`/v1/calendar/availability${params}`, CalendarAvailabilitySlotSchema);
  }

  async registerCalendarAccount(input: CalendarAccountRegistrationInput): Promise<CalendarAccountRecord> {
    return this.post('/v1/calendar/accounts', input, CalendarAccountRecordSchema);
  }

  async syncCalendarAccount(accountId: string): Promise<CalendarSyncResult> {
    return this.post('/v1/calendar/sync', { accountId }, CalendarSyncResultSchema);
  }

  async createCalendarEvent(input: CalendarEventCreateInput): Promise<CalendarEventRecord> {
    return this.post('/v1/calendar/events', input, CalendarEventRecordSchema);
  }

  async updateCalendarEvent(id: string, input: CalendarEventUpdateInput): Promise<CalendarEventRecord> {
    return this.patch(`/v1/calendar/events/${encodeURIComponent(id)}`, input, CalendarEventRecordSchema);
  }

  // --- Todos ---

  async listTodoAccounts(): Promise<TodoAccountRecord[]> {
    return this.getArray('/v1/todos/accounts', TodoAccountRecordSchema);
  }

  async listTodos(accountId?: string, options?: { status?: string; priority?: number; project?: string; limit?: number }): Promise<TodoItemRecord[]> {
    const params = this.buildQuery({
      accountId,
      status: options?.status,
      priority: options?.priority,
      project: options?.project,
      limit: options?.limit,
    });
    return this.getArray(`/v1/todos/items${params}`, TodoItemRecordSchema);
  }

  async getTodo(id: string): Promise<TodoItemRecord> {
    return this.get(`/v1/todos/items/${encodeURIComponent(id)}`, TodoItemRecordSchema);
  }

  async searchTodos(query: string, options?: { accountId?: string; status?: string; limit?: number }): Promise<{ query: string; results: TodoSearchResult[] }> {
    const params = this.buildQuery({ query, accountId: options?.accountId, status: options?.status, limit: options?.limit });
    const responseSchema = z.object({
      query: z.string(),
      results: z.array(TodoSearchResultSchema),
    });
    return this.get(`/v1/todos/search${params}`, responseSchema);
  }

  async getTodoDigest(accountId?: string): Promise<TodoDigestRecord | null> {
    const query = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
    try {
      return await this.get(`/v1/todos/digest${query}`, TodoDigestRecordSchema);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 404) return null;
      return null;
    }
  }

  async registerTodoAccount(input: TodoAccountRegistrationInput): Promise<TodoAccountRecord> {
    return this.post('/v1/todos/accounts', input, TodoAccountRecordSchema);
  }

  async connectTodoist(input: TodoistConnectInput): Promise<TodoistConnectResult> {
    const schema = z.object({
      connectionId: z.string(),
      account: TodoAccountRecordSchema,
    });
    return this.post('/v1/todos/connect', input, schema);
  }

  async createTodo(input: TodoCreateInput): Promise<TodoItemRecord> {
    return this.post('/v1/todos/items', input, TodoItemRecordSchema);
  }

  async syncTodoAccount(accountId: string): Promise<{ accountId: string; todosSynced: number; todosUpdated: number; errors: string[] }> {
    const schema = z.object({
      accountId: z.string(),
      todosSynced: z.number().int(),
      todosUpdated: z.number().int(),
      errors: z.array(z.string()),
    });
    return this.post('/v1/todos/sync', { accountId }, schema);
  }

  async completeTodo(id: string): Promise<TodoItemRecord> {
    return this.post(`/v1/todos/items/${encodeURIComponent(id)}/complete`, {}, TodoItemRecordSchema);
  }

  async reprioritizeTodo(id: string, priority: number): Promise<TodoItemRecord> {
    return this.post(`/v1/todos/items/${encodeURIComponent(id)}/reprioritize`, { priority }, TodoItemRecordSchema);
  }

  async rescheduleTodo(id: string, dueDate: string, dueTime?: string | null): Promise<TodoItemRecord> {
    return this.post(`/v1/todos/items/${encodeURIComponent(id)}/reschedule`, { dueDate, dueTime }, TodoItemRecordSchema);
  }

  async moveTodo(id: string, projectName: string): Promise<TodoItemRecord> {
    return this.post(`/v1/todos/items/${encodeURIComponent(id)}/move`, { projectName }, TodoItemRecordSchema);
  }

  async reconcileTodos(accountId: string): Promise<TodoReconcileResult> {
    return this.post('/v1/todos/reconcile', { accountId }, TodoReconcileResultSchema);
  }

  async listTodoProjects(accountId: string): Promise<TodoProjectRecord[]> {
    return this.getArray(`/v1/todos/projects${this.buildQuery({ accountId })}`, TodoProjectRecordSchema);
  }

  // --- Connection resource-rules, diagnostics, reconnect ---

  async listConnectionResourceRules(connectionId: string): Promise<ConnectionResourceRule[]> {
    return this.getArray(`/v1/connections/${encodeURIComponent(connectionId)}/resource-rules`, ConnectionResourceRuleSchema);
  }

  async addConnectionResourceRule(connectionId: string, rule: ConnectionResourceRuleCreateInput): Promise<ConnectionRecord> {
    return this.post(`/v1/connections/${encodeURIComponent(connectionId)}/resource-rules`, rule, ConnectionRecordSchema);
  }

  async removeConnectionResourceRule(connectionId: string, resourceType: string, resourceId: string): Promise<ConnectionRecord> {
    await this.ensureCsrfToken();
    const response = await fetch(`${this.baseUrl}/v1/connections/${encodeURIComponent(connectionId)}/resource-rules`, {
      method: 'DELETE',
      headers: this.mutationHeaders(),
      body: JSON.stringify({ resourceType, resourceId }),
    });
    if (!response.ok) throw new ApiError(response.status, await response.text());
    const data: unknown = await response.json();
    return ConnectionRecordSchema.parse(data);
  }

  async getConnectionDiagnostics(connectionId: string): Promise<ConnectionDiagnosticsResponse> {
    return this.get(`/v1/connections/${encodeURIComponent(connectionId)}/diagnostics`, ConnectionDiagnosticsResponseSchema);
  }

  async reconnectConnection(connectionId: string, action: ConnectionRemediationAction): Promise<ConnectionRecord> {
    return this.post(`/v1/connections/${encodeURIComponent(connectionId)}/reconnect`, { action }, ConnectionRecordSchema);
  }

  async listPeople(): Promise<PersonListItem[]> {
    return this.getArray('/v1/people', PersonRecordSchema);
  }

  async getPerson(id: string): Promise<PersonRecord> {
    return this.get(`/v1/people/${encodeURIComponent(id)}`, PersonRecordSchema);
  }

  async searchPeople(query: string, options?: { limit?: number }): Promise<{ query: string; results: PersonSearchResult[] }> {
    const params = this.buildQuery({ query, limit: options?.limit });
    const schema = z.object({
      query: z.string(),
      results: z.array(z.object({
        personId: z.string(),
        displayName: z.string(),
        canonicalEmail: z.string().nullable(),
        githubLogin: z.string().nullable(),
        score: z.number(),
      })),
    });
    return this.get(`/v1/people/search${params}`, schema);
  }

  async updatePerson(id: string, input: PersonUpdateInput): Promise<PersonRecord> {
    return this.patch(`/v1/people/${encodeURIComponent(id)}`, input, PersonRecordSchema);
  }

  async mergePeople(input: PersonMergeInput): Promise<PersonRecord> {
    return this.post('/v1/people/merge', input, PersonRecordSchema);
  }

  async splitPerson(id: string, input: PersonSplitInput): Promise<PersonRecord> {
    return this.post(`/v1/people/${encodeURIComponent(id)}/split`, input, PersonRecordSchema);
  }

  async attachPersonIdentity(input: PersonIdentityAttachInput): Promise<PersonRecord> {
    return this.post('/v1/people/identities/attach', input, PersonRecordSchema);
  }

  async detachPersonIdentity(identityId: string, input: PersonIdentityDetachInput): Promise<PersonRecord> {
    return this.post(`/v1/people/identities/${encodeURIComponent(identityId)}/detach`, input, PersonRecordSchema);
  }

  async listPersonMergeEvents(personId: string): Promise<PersonMergeEventRecord[]> {
    return this.getArray(`/v1/people/${encodeURIComponent(personId)}/merge-events`, PersonMergeEventRecordSchema);
  }

  async getPersonMergeSuggestions(): Promise<PersonMergeSuggestion[]> {
    return this.getArray('/v1/people/merge-suggestions', PersonMergeSuggestionSchema);
  }

  async getPersonActivityRollups(personId: string): Promise<PersonActivityRollup[]> {
    return this.getArray(`/v1/people/${encodeURIComponent(personId)}/activity`, PersonActivityRollupSchema);
  }

  // --- Finance ---

  async listFinanceImports(): Promise<FinanceImportRecord[]> {
    return this.getArray('/v1/finance/imports', FinanceImportRecordSchema);
  }

  async getFinanceImport(id: string): Promise<FinanceImportRecord> {
    return this.get(`/v1/finance/imports/${encodeURIComponent(id)}`, FinanceImportRecordSchema);
  }

  async listFinanceTransactions(options?: { importId?: string; category?: string; dateFrom?: string; dateTo?: string; limit?: number }): Promise<FinanceTransactionRecord[]> {
    return this.getArray(`/v1/finance/transactions${this.buildQuery(options ?? {})}`, FinanceTransactionRecordSchema);
  }

  async listFinanceDocuments(importId?: string): Promise<FinanceDocumentRecord[]> {
    return this.getArray(`/v1/finance/documents${this.buildQuery({ importId })}`, FinanceDocumentRecordSchema);
  }

  async searchFinance(query: string, options?: { category?: string; dateFrom?: string; dateTo?: string; limit?: number }): Promise<{ query: string; results: FinanceSearchResult[] }> {
    const params = this.buildQuery({ query, ...options });
    const schema = z.object({
      query: z.string(),
      results: z.array(FinanceSearchResultSchema),
    });
    return this.get(`/v1/finance/search${params}`, schema);
  }

  async getFinanceDigest(period?: string): Promise<FinanceDigestRecord | null> {
    return this.get(`/v1/finance/digest${this.buildQuery({ period })}`, FinanceDigestRecordSchema.nullable());
  }

  async createFinanceImport(data: { vaultId: string; importType?: string; fileName: string }): Promise<FinanceImportRecord> {
    return this.post('/v1/finance/imports', data, FinanceImportRecordSchema);
  }

  async insertFinanceTransaction(data: {
    importId: string;
    date: string;
    description: string;
    amount: number;
    currency?: string;
    category?: string | null;
    merchantName?: string | null;
    accountLabel?: string | null;
    redactedSummary?: string;
  }): Promise<FinanceTransactionRecord> {
    return this.post('/v1/finance/transactions', data, FinanceTransactionRecordSchema);
  }

  async insertFinanceTransactionBatch(data: {
    importId: string;
    transactions: Array<{
      date: string;
      description: string;
      amount: number;
      currency?: string;
      category?: string | null;
      merchantName?: string | null;
      accountLabel?: string | null;
      redactedSummary?: string;
    }>;
  }): Promise<FinanceTransactionRecord[]> {
    await this.ensureCsrfToken();
    const response = await fetch(`${this.baseUrl}/v1/finance/transactions/batch`, {
      method: 'POST',
      headers: this.mutationHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      throw new ApiError(response.status, await response.text());
    }
    const result: unknown = await response.json();
    if (!Array.isArray(result)) throw new Error('Expected array response');
    return result.map((item) => FinanceTransactionRecordSchema.parse(item));
  }

  async updateFinanceImportStatus(id: string, status: string, recordCount?: number): Promise<void> {
    const response = await this.postRaw(`/v1/finance/imports/${encodeURIComponent(id)}/status`, { status, recordCount });
    if (!response.ok) throw new ApiError(response.status, await response.text());
  }

  // --- Medical ---

  async listMedicalImports(): Promise<MedicalImportRecord[]> {
    return this.getArray('/v1/medical/imports', MedicalImportRecordSchema);
  }

  async getMedicalImport(id: string): Promise<MedicalImportRecord> {
    return this.get(`/v1/medical/imports/${encodeURIComponent(id)}`, MedicalImportRecordSchema);
  }

  async listMedicalAppointments(options?: { importId?: string; limit?: number }): Promise<MedicalAppointmentRecord[]> {
    return this.getArray(`/v1/medical/appointments${this.buildQuery(options ?? {})}`, MedicalAppointmentRecordSchema);
  }

  async listMedicalMedications(importId?: string): Promise<MedicalMedicationRecord[]> {
    return this.getArray(`/v1/medical/medications${this.buildQuery({ importId })}`, MedicalMedicationRecordSchema);
  }

  async listMedicalDocuments(importId?: string): Promise<MedicalDocumentRecord[]> {
    return this.getArray(`/v1/medical/documents${this.buildQuery({ importId })}`, MedicalDocumentRecordSchema);
  }

  async searchMedical(query: string, options?: { limit?: number }): Promise<{ query: string; results: MedicalSearchResult[] }> {
    const params = this.buildQuery({ query, ...options });
    const schema = z.object({
      query: z.string(),
      results: z.array(MedicalSearchResultSchema),
    });
    return this.get(`/v1/medical/search${params}`, schema);
  }

  async getMedicalDigest(period?: string): Promise<MedicalDigestRecord | null> {
    return this.get(`/v1/medical/digest${this.buildQuery({ period })}`, MedicalDigestRecordSchema.nullable());
  }

  async createMedicalImport(data: { vaultId: string; importType?: string; fileName: string }): Promise<MedicalImportRecord> {
    return this.post('/v1/medical/imports', data, MedicalImportRecordSchema);
  }

  async insertMedicalAppointment(data: {
    importId: string;
    date: string;
    provider: string;
    specialty?: string | null;
    location?: string | null;
    redactedSummary?: string;
  }): Promise<MedicalAppointmentRecord> {
    return this.post('/v1/medical/appointments', data, MedicalAppointmentRecordSchema);
  }

  async insertMedicalMedication(data: {
    importId: string;
    name: string;
    dosage?: string | null;
    frequency?: string | null;
    prescriber?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    redactedSummary?: string;
  }): Promise<MedicalMedicationRecord> {
    return this.post('/v1/medical/medications', data, MedicalMedicationRecordSchema);
  }

  async updateMedicalImportStatus(id: string, status: string): Promise<void> {
    const response = await this.postRaw(`/v1/medical/imports/${encodeURIComponent(id)}/status`, { status });
    if (!response.ok) throw new ApiError(response.status, await response.text());
  }

  // --- File write-intents ---

  async createFileWriteIntent(input: FileWriteIntentCreateInput): Promise<FileWriteIntentRecord> {
    return this.post('/v1/files/write-intents', input, FileWriteIntentRecordSchema);
  }

  async listFileWriteIntents(options?: { rootId?: string; status?: string }): Promise<FileWriteIntentRecord[]> {
    return this.getArray(`/v1/files/write-intents${this.buildQuery(options ?? {})}`, FileWriteIntentRecordSchema);
  }

  async getFileWriteIntent(id: string): Promise<FileWriteIntentRecord> {
    return this.get(`/v1/files/write-intents/${encodeURIComponent(id)}`, FileWriteIntentRecordSchema);
  }

  async reviewFileWriteIntent(id: string, input: { action: 'apply' | 'reject'; reason?: string }): Promise<FileWriteIntentRecord> {
    return this.post(`/v1/files/write-intents/${encodeURIComponent(id)}/review`, input, FileWriteIntentRecordSchema);
  }

  subscribeEvents(callback: (event: { event: string; data: string }) => void): () => void {
    const controller = new AbortController();
    const url = `${this.baseUrl}/v1/events/stream`;

    const connect = () => {
      fetch(url, {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok || !response.body) return;
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let currentEvent = '';
          let currentData = '';

          const processLine = (line: string) => {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7);
            } else if (line.startsWith('data: ')) {
              currentData = line.slice(6);
            } else if (line === '') {
              if (currentEvent && currentData) {
                callback({ event: currentEvent, data: currentData });
              }
              currentEvent = '';
              currentData = '';
            }
          };

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) processLine(line);
          }
        })
        .catch(() => {
          /* connection closed */
        });
    };

    connect();
    return () => controller.abort();
  }
}

export class ApiError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, body: string) {
    super(`API error ${statusCode}: ${body}`);
    this.name = 'ApiError';
    this.statusCode = statusCode;
  }
}
