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
} from '@popeye/contracts';

export interface PopeyeApiClientOptions {
  baseUrl: string;
  token: string;
}

export interface MemorySearchOptions {
  query: string;
  scope?: string;
  memoryTypes?: MemoryType[];
  limit?: number;
  includeContent?: boolean;
}

export interface MemoryListOptions {
  type?: string;
  scope?: string;
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
      `/v1/memory${this.buildQuery({ type: options.type, scope: options.scope, limit: options.limit })}`,
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
