// Auto-generated from @popeye/contracts — do not edit
// Generated: 2026-04-08
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

public enum PlaybookScope: String, Codable, Sendable {
    case global = "global"
    case workspace = "workspace"
    case project = "project"
}

public enum PlaybookStatus: String, Codable, Sendable {
    case draft = "draft"
    case active = "active"
    case retired = "retired"
}

public enum PlaybookProposalKind: String, Codable, Sendable {
    case draft = "draft"
    case patch = "patch"
}

public enum PlaybookProposalStatus: String, Codable, Sendable {
    case drafting = "drafting"
    case pendingReview = "pending_review"
    case approved = "approved"
    case rejected = "rejected"
    case applied = "applied"
}

public enum PlaybookProposalSource: String, Codable, Sendable {
    case operatorApi = "operator_api"
    case runtimeTool = "runtime_tool"
    case maintenanceJob = "maintenance_job"
}

public enum KnowledgeSourceType: String, Codable, Sendable {
    case localFile = "local_file"
    case manualText = "manual_text"
    case website = "website"
    case pdf = "pdf"
    case xPost = "x_post"
    case repo = "repo"
    case dataset = "dataset"
    case image = "image"
}

public enum KnowledgeConversionAdapter: String, Codable, Sendable {
    case native = "native"
    case jinaReader = "jina_reader"
    case trafilatura = "trafilatura"
    case markitdown = "markitdown"
    case docling = "docling"
}

public enum KnowledgeConverterStatus: String, Codable, Sendable {
    case ready = "ready"
    case missing = "missing"
    case degraded = "degraded"
}

public enum KnowledgeConverterId: String, Codable, Sendable {
    case jinaReader = "jina_reader"
    case trafilatura = "trafilatura"
    case markitdown = "markitdown"
    case docling = "docling"
}

public enum KnowledgeAssetStatus: String, Codable, Sendable {
    case none = "none"
    case localized = "localized"
    case partialFailure = "partial_failure"
    case failed = "failed"
}

public enum KnowledgeImportOutcome: String, Codable, Sendable {
    case created = "created"
    case updated = "updated"
    case unchanged = "unchanged"
}

public enum KnowledgeSourceStatus: String, Codable, Sendable {
    case pending = "pending"
    case imported = "imported"
    case converted = "converted"
    case conversionFailed = "conversion_failed"
    case compiled = "compiled"
    case compiledWithWarnings = "compiled_with_warnings"
    case degraded = "degraded"
}

public enum KnowledgeDocumentKind: String, Codable, Sendable {
    case sourceNormalized = "source_normalized"
    case wikiArticle = "wiki_article"
    case outputNote = "output_note"
}

public enum KnowledgeDocumentStatus: String, Codable, Sendable {
    case active = "active"
    case draftOnly = "draft_only"
    case archived = "archived"
}

public enum KnowledgeRevisionStatus: String, Codable, Sendable {
    case draft = "draft"
    case applied = "applied"
    case rejected = "rejected"
}

public enum KnowledgeLinkKind: String, Codable, Sendable {
    case markdown = "markdown"
    case wikilink = "wikilink"
    case compiledFrom = "compiled_from"
    case citation = "citation"
    case related = "related"
}

public enum KnowledgeLinkStatus: String, Codable, Sendable {
    case active = "active"
    case broken = "broken"
    case unresolved = "unresolved"
}

public enum KnowledgeCompileJobStatus: String, Codable, Sendable {
    case queued = "queued"
    case succeeded = "succeeded"
    case failed = "failed"
}

public enum KnowledgeBetaGateStatus: String, Codable, Sendable {
    case passed = "passed"
    case failed = "failed"
}

// MARK: - Models

public struct TaskRecord: Codable, Sendable {
    public let id: String
    public let workspaceId: String
    public let projectId: String
    public let profileId: String
    public let identityId: String
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
    public let identityId: String
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
    public let identityId: String
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

public struct GithubAccountRecord: Codable, Sendable {
    public let id: String
    public let connectionId: String
    public let githubUsername: String
    public let displayName: String
    public let syncCursorSince: String
    public let lastSyncAt: String
    public let repoCount: String
    public let createdAt: String
    public let updatedAt: String
}

public struct GithubRepoRecord: Codable, Sendable {
    public let id: String
    public let accountId: String
    public let githubRepoId: String
    public let owner: String
    public let name: String
    public let fullName: String
    public let description: String
    public let isPrivate: String
    public let isFork: String
    public let defaultBranch: String
    public let language: String
    public let starsCount: String
    public let openIssuesCount: String
    public let lastPushedAt: String
    public let createdAt: String
    public let updatedAt: String
}

public struct GithubPullRequestRecord: Codable, Sendable {
    public let id: String
    public let accountId: String
    public let repoId: String
    public let githubPrNumber: String
    public let title: String
    public let bodyPreview: String
    public let author: String
    public let state: String
    public let isDraft: String
    public let reviewDecision: String
    public let ciStatus: String
    public let headBranch: String
    public let baseBranch: String
    public let additions: String
    public let deletions: String
    public let changedFiles: String
    public let labels: String
    public let requestedReviewers: String
    public let createdAtGh: String
    public let updatedAtGh: String
    public let mergedAt: String
    public let createdAt: String
    public let updatedAt: String
}

public struct GithubIssueRecord: Codable, Sendable {
    public let id: String
    public let accountId: String
    public let repoId: String
    public let githubIssueNumber: String
    public let title: String
    public let bodyPreview: String
    public let author: String
    public let state: String
    public let labels: String
    public let assignees: String
    public let milestone: String
    public let isAssignedToMe: String
    public let isMentioned: String
    public let createdAtGh: String
    public let updatedAtGh: String
    public let closedAt: String
    public let createdAt: String
    public let updatedAt: String
}

public struct GithubNotificationRecord: Codable, Sendable {
    public let id: String
    public let accountId: String
    public let githubNotificationId: String
    public let repoFullName: String
    public let subjectTitle: String
    public let subjectType: String
    public let reason: String
    public let isUnread: String
    public let updatedAtGh: String
    public let createdAt: String
    public let updatedAt: String
}

public struct GithubDigestRecord: Codable, Sendable {
    public let id: String
    public let accountId: String
    public let workspaceId: String
    public let date: String
    public let openPrsCount: String
    public let reviewRequestsCount: String
    public let assignedIssuesCount: String
    public let unreadNotificationsCount: String
    public let summaryMarkdown: String
    public let generatedAt: String
}

public struct GithubSearchQuery: Codable, Sendable {
    public let query: String
    public let accountId: String
    public let limit: String
    public let entityType: String
}

public struct GithubSearchResult: Codable, Sendable {
    public let entityType: String
    public let entityId: String
    public let repoFullName: String
    public let number: String
    public let title: String
    public let author: String
    public let state: String
    public let updatedAt: String
    public let score: String
}

public struct GithubSyncResult: Codable, Sendable {
    public let accountId: String
    public let reposSynced: String
    public let prsSynced: String
    public let issuesSynced: String
    public let notificationsSynced: String
    public let errors: String
}

public struct GithubCommentRecord: Codable, Sendable {
    public let id: String
    public let accountId: String
    public let repoFullName: String
    public let issueNumber: String
    public let bodyPreview: String
    public let htmlUrl: String
    public let createdAt: String
}

public struct GithubCommentCreateInput: Codable, Sendable {
    public let accountId: String
    public let repoFullName: String
    public let issueNumber: String
    public let body: String
}

public struct GithubNotificationMarkReadInput: Codable, Sendable {
    public let notificationId: String
}

public struct PlaybookEffectiveness: Codable, Sendable {
    public let useCount30d: String
    public let succeededRuns30d: String
    public let failedRuns30d: String
    public let intervenedRuns30d: String
    public let successRate30d: String
    public let failureRate30d: String
    public let interventionRate30d: String
    public let lastUsedAt: String
    public let lastUpdatedAt: String
}

public struct PlaybookProposalEvidenceMetrics: Codable, Sendable {
    public let useCount30d: String
    public let failedRuns30d: String
    public let interventions30d: String
}

public struct PlaybookProposalEvidence: Codable, Sendable {
    public let runIds: String
    public let interventionIds: String
    public let lastProblemAt: String
    public let metrics30d: String
    public let suggestedPatchNote: String
}

public struct PlaybookFrontMatter: Codable, Sendable {
    public let id: String
    public let title: String
    public let status: String
    public let allowedProfileIds: String
}

public struct ResolvedPlaybook: Codable, Sendable {
    public let recordId: String
    public let id: String
    public let title: String
    public let status: String
    public let scope: String
    public let workspaceId: String
    public let projectId: String
    public let path: String
    public let body: String
    public let contentHash: String
    public let revisionHash: String
    public let allowedProfileIds: String
}

public struct AppliedPlaybook: Codable, Sendable {
    public let id: String
    public let title: String
    public let scope: String
    public let revisionHash: String
}

public struct PlaybookRecord: Codable, Sendable {
    public let recordId: String
    public let playbookId: String
    public let scope: String
    public let workspaceId: String
    public let projectId: String
    public let title: String
    public let status: String
    public let allowedProfileIds: String
    public let filePath: String
    public let currentRevisionHash: String
    public let createdAt: String
    public let updatedAt: String
    public let effectiveness: String
}

public struct PlaybookSearchResult: Codable, Sendable {
    public let recordId: String
    public let playbookId: String
    public let title: String
    public let scope: String
    public let workspaceId: String
    public let projectId: String
    public let status: String
    public let currentRevisionHash: String
    public let allowedProfileIds: String
    public let snippet: String
    public let score: String
}

public struct PlaybookRecommendation: Codable, Sendable {
    public let recordId: String
    public let playbookId: String
    public let title: String
    public let scope: String
    public let workspaceId: String
    public let projectId: String
    public let currentRevisionHash: String
    public let allowedProfileIds: String
    public let snippet: String
    public let score: String
    public let reason: String
}

public struct PlaybookRevisionRecord: Codable, Sendable {
    public let playbookRecordId: String
    public let revisionHash: String
    public let title: String
    public let status: String
    public let allowedProfileIds: String
    public let filePath: String
    public let contentHash: String
    public let markdownText: String
    public let createdAt: String
    public let current: String
}

public struct PlaybookDetail: Codable, Sendable {
    public let recordId: String
    public let playbookId: String
    public let scope: String
    public let workspaceId: String
    public let projectId: String
    public let title: String
    public let status: String
    public let allowedProfileIds: String
    public let filePath: String
    public let currentRevisionHash: String
    public let createdAt: String
    public let updatedAt: String
    public let effectiveness: String
    public let body: String
    public let markdownText: String
    public let indexedMemoryId: String
}

public struct PlaybookUsageRunRecord: Codable, Sendable {
    public let runId: String
    public let taskId: String
    public let jobId: String
    public let runState: String
    public let startedAt: String
    public let finishedAt: String
    public let interventionCount: String
    public let receiptId: String
}

public struct PlaybookStaleCandidate: Codable, Sendable {
    public let recordId: String
    public let title: String
    public let scope: String
    public let currentRevisionHash: String
    public let lastUsedAt: String
    public let useCount30d: String
    public let failedRuns30d: String
    public let interventions30d: String
    public let lastProposalAt: String
    public let indexedMemoryId: String
    public let reasons: String
}

public struct PlaybookProposalRecord: Codable, Sendable {
    public let id: String
    public let kind: String
    public let status: String
    public let targetRecordId: String
    public let baseRevisionHash: String
    public let playbookId: String
    public let scope: String
    public let workspaceId: String
    public let projectId: String
    public let title: String
    public let proposedStatus: String
    public let allowedProfileIds: String
    public let summary: String
    public let body: String
    public let markdownText: String
    public let diffPreview: String
    public let contentHash: String
    public let revisionHash: String
    public let scanVerdict: String
    public let scanMatchedRules: String
    public let sourceRunId: String
    public let proposedBy: String
    public let evidence: String
    public let reviewedBy: String
    public let reviewedAt: String
    public let reviewNote: String
    public let appliedRecordId: String
    public let appliedRevisionHash: String
    public let appliedAt: String
    public let createdAt: String
    public let updatedAt: String
}

public struct KnowledgeConverterAvailability: Codable, Sendable {
    public let id: String
    public let status: String
    public let provenance: String
    public let details: String
    public let version: String
    public let lastCheckedAt: String
    public let installHint: String
    public let usedFor: String
    public let fallbackRank: String
}

public struct KnowledgeSourceRecord: Codable, Sendable {
    public let id: String
    public let workspaceId: String
    public let knowledgeRootId: String
    public let sourceType: String
    public let title: String
    public let originalUri: String
    public let originalPath: String
    public let originalFileName: String
    public let originalMediaType: String
    public let adapter: String
    public let fallbackUsed: String
    public let status: String
    public let contentHash: String
    public let assetStatus: String
    public let latestOutcome: String
    public let conversionWarnings: String
    public let createdAt: String
    public let updatedAt: String
}

public struct KnowledgeDocumentRecord: Codable, Sendable {
    public let id: String
    public let workspaceId: String
    public let knowledgeRootId: String
    public let sourceId: String
    public let kind: String
    public let title: String
    public let slug: String
    public let relativePath: String
    public let revisionHash: String
    public let status: String
    public let createdAt: String
    public let updatedAt: String
}

public struct KnowledgeDocumentDetail: Codable, Sendable {
    public let id: String
    public let workspaceId: String
    public let knowledgeRootId: String
    public let sourceId: String
    public let kind: String
    public let title: String
    public let slug: String
    public let relativePath: String
    public let revisionHash: String
    public let status: String
    public let createdAt: String
    public let updatedAt: String
    public let markdownText: String
    public let exists: String
    public let sourceIds: String
}

public struct KnowledgeSourceSnapshotRecord: Codable, Sendable {
    public let id: String
    public let sourceId: String
    public let workspaceId: String
    public let contentHash: String
    public let adapter: String
    public let fallbackUsed: String
    public let status: String
    public let assetStatus: String
    public let outcome: String
    public let conversionWarnings: String
    public let createdAt: String
}

public struct KnowledgeBetaReportRow: Codable, Sendable {
    public let label: String
    public let title: String
    public let sourceType: String
    public let outcome: String
    public let sourceId: String
    public let adapter: String
    public let status: String
    public let assetStatus: String
    public let draftRevisionId: String
    public let error: String
}

public struct KnowledgeBetaGateCheck: Codable, Sendable {
    public let id: String
    public let label: String
    public let passed: String
    public let details: String
}

public struct KnowledgeBetaGate: Codable, Sendable {
    public let status: String
    public let minImportSuccessRate: String
    public let actualImportSuccessRate: String
    public let maxHardFailures: String
    public let actualHardFailures: String
    public let expectedReingestChecks: String
    public let failedExpectedReingestChecks: String
    public let checks: String
}

public struct KnowledgeBetaRunRecord: Codable, Sendable {
    public let id: String
    public let workspaceId: String
    public let manifestPath: String
    public let importCount: String
    public let reingestCount: String
    public let hardFailureCount: String
    public let importSuccessRate: String
    public let gateStatus: String
    public let createdAt: String
}

public struct KnowledgeBetaRunDetail: Codable, Sendable {
    public let id: String
    public let workspaceId: String
    public let manifestPath: String
    public let importCount: String
    public let reingestCount: String
    public let hardFailureCount: String
    public let importSuccessRate: String
    public let gateStatus: String
    public let createdAt: String
    public let reportMarkdown: String
    public let imports: String
    public let reingests: String
    public let converters: String
    public let audit: String
    public let gate: String
}

public struct KnowledgeBetaRunCreateInput: Codable, Sendable {
    public let workspaceId: String
    public let manifestPath: String
    public let reportMarkdown: String
    public let imports: String
    public let reingests: String
    public let converters: String
    public let audit: String
    public let gate: String
}

public struct KnowledgeBetaRunListQuery: Codable, Sendable {
    public let workspaceId: String
    public let limit: String
}

public struct KnowledgeDocumentRevisionRecord: Codable, Sendable {
    public let id: String
    public let documentId: String
    public let workspaceId: String
    public let status: String
    public let sourceKind: String
    public let sourceId: String
    public let proposedTitle: String
    public let proposedMarkdown: String
    public let diffPreview: String
    public let baseRevisionHash: String
    public let createdAt: String
    public let appliedAt: String
}

public struct KnowledgeRevisionRejectResult: Codable, Sendable {
    public let revision: String
    public let document: String
    public let receipt: String
}

public struct KnowledgeLinkRecord: Codable, Sendable {
    public let id: String
    public let workspaceId: String
    public let sourceDocumentId: String
    public let targetDocumentId: String
    public let targetSlug: String
    public let targetLabel: String
    public let linkKind: String
    public let linkStatus: String
    public let confidence: String
    public let createdAt: String
    public let updatedAt: String
}

public struct KnowledgeCompileJobRecord: Codable, Sendable {
    public let id: String
    public let workspaceId: String
    public let sourceId: String
    public let targetDocumentId: String
    public let status: String
    public let summary: String
    public let warnings: String
    public let createdAt: String
    public let updatedAt: String
}

public struct KnowledgeAuditReport: Codable, Sendable {
    public let totalSources: String
    public let totalDocuments: String
    public let totalDraftRevisions: String
    public let unresolvedLinks: String
    public let brokenLinks: String
    public let failedConversions: String
    public let degradedSources: String
    public let warningSources: String
    public let assetLocalizationFailures: String
    public let lastCompileAt: String
}

public struct KnowledgeNeighborhood: Codable, Sendable {
    public let document: String
    public let incoming: String
    public let outgoing: String
    public let relatedDocuments: String
}

public struct KnowledgeImportInput: Codable, Sendable {
    public let workspaceId: String
    public let sourceType: String
    public let title: String
    public let sourceUri: String
    public let sourcePath: String
    public let sourceText: String
}

public struct KnowledgeImportResult: Codable, Sendable {
    public let source: String
    public let normalizedDocument: String
    public let compileJob: String
    public let draftRevision: String
    public let outcome: String
}

public struct KnowledgeDocumentRevisionProposalInput: Codable, Sendable {
    public let title: String
    public let markdownText: String
    public let baseRevisionHash: String
}

public struct KnowledgeDocumentRevisionApplyInput: Codable, Sendable {
    public let approved: String
}

public struct KnowledgeRevisionApplyResult: Codable, Sendable {
    public let revision: String
    public let document: String
    public let receipt: String
}

public struct KnowledgeLinkCreateInput: Codable, Sendable {
    public let sourceDocumentId: String
    public let targetDocumentId: String
    public let targetSlug: String
    public let targetLabel: String
    public let linkKind: String
}

public struct KnowledgeDocumentQuery: Codable, Sendable {
    public let workspaceId: String
    public let kind: String
    public let q: String
}

public struct MutationReceiptRecord: Codable, Sendable {
    public let id: String
    public let kind: String
    public let component: String
    public let status: String
    public let summary: String
    public let details: String
    public let actorRole: String
    public let workspaceId: String
    public let usage: String
    public let metadata: String
    public let createdAt: String
}
