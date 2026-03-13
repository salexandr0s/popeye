// Auto-generated from @popeye/contracts — do not edit
// Generated: 2026-03-13
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
    case authFailure = "auth_failure"
    case promptInjectionQuarantined = "prompt_injection_quarantined"
    case failedFinal = "failed_final"
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
}

// MARK: - Models

public struct TaskRecord: Codable, Sendable {
    public let id: String
    public let workspaceId: String
    public let projectId: String?
    public let title: String
    public let prompt: String
    public let source: String
    public let status: String?
    public let retryPolicy: JSONObject
    public let sideEffectProfile: String
    public let coalesceKey: String?
    public let createdAt: String
}

public struct JobRecord: Codable, Sendable {
    public let id: String
    public let taskId: String
    public let workspaceId: String
    public let status: String
    public let retryCount: Int
    public let availableAt: String
    public let lastRunId: String?
    public let createdAt: String
    public let updatedAt: String
}

public struct RunRecord: Codable, Sendable {
    public let id: String
    public let jobId: String
    public let taskId: String
    public let workspaceId: String
    public let sessionRootId: String
    public let engineSessionRef: String?
    public let state: String
    public let startedAt: String
    public let finishedAt: String?
    public let error: String?
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
    public let usage: JSONObject
    public let createdAt: String
}

public struct InterventionRecord: Codable, Sendable {
    public let id: String
    public let code: String
    public let runId: String?
    public let status: String
    public let reason: String
    public let createdAt: String
    public let resolvedAt: String?
}

public struct MessageRecord: Codable, Sendable {
    public let id: String
    public let source: String
    public let senderId: String
    public let body: String
    public let accepted: Bool
    public let relatedRunId: String?
    public let createdAt: String
}

public struct MessageIngressResponse: Codable, Sendable {
    public let accepted: Bool
    public let duplicate: Bool
    public let httpStatus: Int
    public let decisionCode: String
    public let decisionReason: String
    public let message: JSONObject?
    public let taskId: String?
    public let jobId: String?
    public let runId: String?
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
    public let tokensIn: Int
    public let tokensOut: Int
    public let estimatedCostUsd: Double
}

public struct UsageSummary: Codable, Sendable {
    public let runs: Int
    public let tokensIn: Int
    public let tokensOut: Int
    public let estimatedCostUsd: Double
}

public struct SecurityAuditFinding: Codable, Sendable {
    public let code: String
    public let severity: String
    public let message: String
}

public struct DaemonStatusResponse: Codable, Sendable {
    public let ok: Bool
    public let runningJobs: Int
    public let queuedJobs: Int
    public let openInterventions: Int
    public let activeLeases: Int
    public let engineKind: String
    public let schedulerRunning: Bool
    public let startedAt: String
    public let lastShutdownAt: String?
}

public struct SchedulerStatusResponse: Codable, Sendable {
    public let running: Bool
    public let activeLeases: Int
    public let activeRuns: Int
    public let nextHeartbeatDueAt: String?
}

public struct DaemonStateRecord: Codable, Sendable {
    public let schedulerRunning: Bool
    public let activeWorkers: Int
    public let lastSchedulerTickAt: String?
    public let lastLeaseSweepAt: String?
    public let lastShutdownAt: String?
}

public struct SseEventEnvelope: Codable, Sendable {
    public let event: String
    public let data: String
}

public struct TaskCreateInput: Codable, Sendable {
    public let workspaceId: String?
    public let projectId: String?
    public let title: String
    public let prompt: String
    public let source: String?
    public let coalesceKey: String?
    public let autoEnqueue: Bool?
}
