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
  type ApprovalRecord,
  ApprovalRecordSchema,
  type ApprovalResolveInput,
  type ConnectionRecord,
  ConnectionRecordSchema,
  type ConnectionCreateInput,
  type ConnectionUpdateInput,
  type ContextReleasePreview,
  ContextReleasePreviewSchema,
  type SecurityPolicyResponse,
  SecurityPolicyResponseSchema,
  type DomainKind,
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
  type EmailSearchResult,
  EmailSearchResultSchema,
  type EmailAccountRegistrationInput,
  type EmailSyncResult,
  EmailSyncResultSchema,
  type SecretRefRecord,
  SecretRefRecordSchema,
  type GithubAccountRecord,
  GithubAccountRecordSchema,
  type GithubRepoRecord,
  GithubRepoRecordSchema,
  type GithubPullRequestRecord,
  GithubPullRequestRecordSchema,
  type GithubIssueRecord,
  GithubIssueRecordSchema,
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
  type CalendarEventRecord,
  CalendarEventRecordSchema,
  type CalendarDigestRecord,
  CalendarDigestRecordSchema,
  CalendarSearchResultSchema,
  type CalendarSearchResult,
  CalendarAvailabilitySlotSchema,
  type CalendarAvailabilitySlot,
  type TodoAccountRecord,
  TodoAccountRecordSchema,
  type TodoAccountRegistrationInput,
  type TodoItemRecord,
  TodoItemRecordSchema,
  type TodoDigestRecord,
  TodoDigestRecordSchema,
  TodoSearchResultSchema,
  type TodoSearchResult,
  type TodoCreateInput,
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
  decayed: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
  merged: z.number().int().nonnegative(),
  deduped: z.number().int().nonnegative(),
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

  private buildQuery(params: Record<string, string | number | boolean | undefined>): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
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

  async listApprovals(filter?: { scope?: string; status?: string; domain?: string }): Promise<ApprovalRecord[]> {
    return this.getArray(`/v1/approvals${this.buildQuery(filter ?? {})}`, ApprovalRecordSchema);
  }

  async getApproval(id: string): Promise<ApprovalRecord> {
    return this.get(`/v1/approvals/${encodeURIComponent(id)}`, ApprovalRecordSchema);
  }

  async requestApproval(input: { scope: string; domain: DomainKind; riskClass: string; resourceType: string; resourceId: string; requestedBy: string; payloadPreview?: string; idempotencyKey?: string }): Promise<ApprovalRecord> {
    return this.post('/v1/approvals', input, ApprovalRecordSchema);
  }

  async resolveApproval(id: string, input: ApprovalResolveInput): Promise<ApprovalRecord> {
    return this.post(`/v1/approvals/${encodeURIComponent(id)}/resolve`, input, ApprovalRecordSchema);
  }

  async getSecurityPolicy(): Promise<SecurityPolicyResponse> {
    return this.get('/v1/security/policy', SecurityPolicyResponseSchema);
  }

  async listConnections(domain?: string): Promise<ConnectionRecord[]> {
    return this.getArray(`/v1/connections${this.buildQuery({ domain })}`, ConnectionRecordSchema);
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

  async createTodo(input: TodoCreateInput): Promise<TodoItemRecord> {
    return this.post('/v1/todos/items', input, TodoItemRecordSchema);
  }

  async completeTodo(id: string): Promise<TodoItemRecord> {
    return this.post(`/v1/todos/items/${encodeURIComponent(id)}/complete`, {}, TodoItemRecordSchema);
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
