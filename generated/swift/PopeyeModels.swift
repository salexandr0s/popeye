// Auto-generated from @popeye/contracts — do not edit
// Generated: 2026-04-01
import Foundation

// MARK: - Enums

public enum JobState: String, Codable, Sendable {
    case queued = "queued"
    case leased = "leased"
    case running = "running"
    case waitingRetry = "waiting_retry"
    case paused = "paused"
    case blockedOperator = "blocked_operator"
    case succeeded = "succeeded"
    case failedFinal = "failed_final"
    case cancelled = "cancelled"
}

public enum RunState: String, Codable, Sendable {
    case starting = "starting"
    case running = "running"
    case succeeded = "succeeded"
    case failedRetryable = "failed_retryable"
    case failedFinal = "failed_final"
    case cancelled = "cancelled"
    case abandoned = "abandoned"
}

public enum InterventionCode: String, Codable, Sendable {
    case needsCredentials = "needs_credentials"
    case needsPolicyDecision = "needs_policy_decision"
    case needsInstructionFix = "needs_instruction_fix"
    case needsWorkspaceFix = "needs_workspace_fix"
    case needsOperatorInput = "needs_operator_input"
    case retryBudgetExhausted = "retry_budget_exhausted"
    case iterationBudgetExhausted = "iteration_budget_exhausted"
    case authFailure = "auth_failure"
    case promptInjectionQuarantined = "prompt_injection_quarantined"
    case failedFinal = "failed_final"
    case delegationBudgetExhausted = "delegation_budget_exhausted"
}

public enum TaskSideEffectProfile: String, Codable, Sendable {
    case readOnly = "read_only"
    case externalSideEffect = "external_side_effect"
}

public enum MessageIngressDecisionCode: String, Codable, Sendable {
    case accepted = "accepted"
    case duplicateReplayed = "duplicate_replayed"
    case telegramDisabled = "telegram_disabled"
    case telegramPrivateChatRequired = "telegram_private_chat_required"
    case telegramNotAllowlisted = "telegram_not_allowlisted"
    case telegramRateLimited = "telegram_rate_limited"
    case telegramPromptInjection = "telegram_prompt_injection"
    case telegramInvalidMessage = "telegram_invalid_message"
    case promptInjectionQuarantined = "prompt_injection_quarantined"
}

public enum RecallSourceKind: String, Codable, Sendable {
    case receipt = "receipt"
    case runEvent = "run_event"
    case message = "message"
    case messageIngress = "message_ingress"
    case intervention = "intervention"
    case memory = "memory"
}

// MARK: - Models

public struct TaskRecord: Codable, Sendable {
    public let id: String
    public let workspaceId: String
    public let projectId: String
    public let profileId: String
    public let title: String
    public let prompt: String
    public let source: String
    public let status: String
    public let retryPolicy: String
    public let sideEffectProfile: String
    public let coalesceKey: String
    public let createdAt: String
}

public struct JobRecord: Codable, Sendable {
    public let id: String
    public let taskId: String
    public let workspaceId: String
    public let status: String
    public let retryCount: String
    public let availableAt: String
    public let lastRunId: String
    public let createdAt: String
    public let updatedAt: String
}

public struct RunRecord: Codable, Sendable {
    public let id: String
    public let jobId: String
    public let taskId: String
    public let workspaceId: String
    public let profileId: String
    public let sessionRootId: String
    public let engineSessionRef: String
    public let state: String
    public let startedAt: String
    public let finishedAt: String
    public let error: String
    public let iterationsUsed: String
    public let parentRunId: String
    public let delegationDepth: String
}

public struct RunEventRecord: Codable, Sendable {
    public let id: String
    public let runId: String
    public let type: String
    public let payload: String
    public let createdAt: String
}

public struct ReceiptRecord: Codable, Sendable {
    public let id: String
    public let runId: String
    public let jobId: String
    public let taskId: String
    public let workspaceId: String
    public let status: String
    public let summary: String
    public let details: String
    public let usage: String
    public let runtime: String
    public let createdAt: String
}

public struct RecallSearchResponse: Codable, Sendable {
    public let query: String
    public let results: String
    public let totalMatches: String
}

public struct RecallDetail: Codable, Sendable {
    public let sourceKind: String
    public let sourceId: String
    public let title: String
    public let snippet: String
    public let score: String
    public let createdAt: String
    public let workspaceId: String
    public let projectId: String
    public let runId: String
    public let taskId: String
    public let sessionRootId: String
    public let subtype: String
    public let status: String
    public let memoryLayer: String
    public let memorySourceType: String
    public let content: String
    public let metadata: String
}

public struct InterventionRecord: Codable, Sendable {
    public let id: String
    public let code: String
    public let runId: String
    public let status: String
    public let reason: String
    public let createdAt: String
    public let resolvedAt: String
    public let updatedAt: String
    public let resolutionNote: String
}

public struct MessageRecord: Codable, Sendable {
    public let id: String
    public let source: String
    public let senderId: String
    public let body: String
    public let accepted: String
    public let relatedRunId: String
    public let createdAt: String
}

public struct MessageIngressResponse: Codable, Sendable {
    public let accepted: String
    public let duplicate: String
    public let httpStatus: String
    public let decisionCode: String
    public let decisionReason: String
    public let message: String
    public let taskId: String
    public let jobId: String
    public let runId: String
    public let telegramDelivery: String
}

public struct JobLeaseRecord: Codable, Sendable {
    public let jobId: String
    public let leaseOwner: String
    public let leaseExpiresAt: String
    public let updatedAt: String
}

public struct UsageMetrics: Codable, Sendable {
    public let provider: String
    public let model: String
    public let tokensIn: String
    public let tokensOut: String
    public let estimatedCostUsd: String
}

public struct UsageSummary: Codable, Sendable {
    public let runs: String
    public let tokensIn: String
    public let tokensOut: String
    public let estimatedCostUsd: String
}

public struct SecurityAuditFinding: Codable, Sendable {
    public let code: String
    public let severity: String
    public let message: String
    public let component: String
    public let timestamp: String
    public let details: String
}

public struct DaemonStatusResponse: Codable, Sendable {
    public let ok: String
    public let runningJobs: String
    public let queuedJobs: String
    public let openInterventions: String
    public let activeLeases: String
    public let engineKind: String
    public let schedulerRunning: String
    public let startedAt: String
    public let lastShutdownAt: String
}

public struct SchedulerStatusResponse: Codable, Sendable {
    public let running: String
    public let activeLeases: String
    public let activeRuns: String
    public let nextHeartbeatDueAt: String
}

public struct DaemonStateRecord: Codable, Sendable {
    public let schedulerRunning: String
    public let activeWorkers: String
    public let lastSchedulerTickAt: String
    public let lastLeaseSweepAt: String
    public let lastShutdownAt: String
}

public struct SseEventEnvelope: Codable, Sendable {
    public let event: String
    public let data: String
}

public struct TaskCreateInput: Codable, Sendable {
    public let workspaceId: String
    public let projectId: String
    public let profileId: String
    public let title: String
    public let prompt: String
    public let source: String
    public let coalesceKey: String
    public let autoEnqueue: String
}

public struct ApprovalRecord: Codable, Sendable {
    public let id: String
    public let scope: String
    public let domain: String
    public let riskClass: String
    public let actionKind: String
    public let resourceScope: String
    public let resourceType: String
    public let resourceId: String
    public let requestedBy: String
    public let runId: String
    public let standingApprovalEligible: String
    public let automationGrantEligible: String
    public let interventionId: String
    public let payloadPreview: String
    public let idempotencyKey: String
    public let status: String
    public let resolvedBy: String
    public let resolvedByGrantId: String
    public let decisionReason: String
    public let expiresAt: String
    public let createdAt: String
    public let resolvedAt: String
}

public struct SecurityPolicyResponse: Codable, Sendable {
    public let domainPolicies: String
    public let approvalRules: String
    public let defaultRiskClass: String
    public let actionDefaults: String
}

public struct VaultRecord: Codable, Sendable {
    public let id: String
    public let domain: String
    public let kind: String
    public let dbPath: String
    public let encrypted: String
    public let encryptionKeyRef: String
    public let status: String
    public let createdAt: String
    public let lastAccessedAt: String
}
