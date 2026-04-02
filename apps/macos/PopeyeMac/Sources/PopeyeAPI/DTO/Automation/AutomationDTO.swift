import Foundation

public struct AutomationControlAvailabilityDTO: Codable, Sendable, Equatable {
    public let runNow: Bool
    public let pause: Bool
    public let resume: Bool
    public let enabledEdit: Bool
    public let cadenceEdit: Bool

    public init(runNow: Bool, pause: Bool, resume: Bool, enabledEdit: Bool, cadenceEdit: Bool) {
        self.runNow = runNow
        self.pause = pause
        self.resume = resume
        self.enabledEdit = enabledEdit
        self.cadenceEdit = cadenceEdit
    }
}

public struct AutomationUpdateInput: Codable, Sendable, Equatable {
    public let enabled: Bool?
    public let intervalSeconds: Int?

    public init(enabled: Bool? = nil, intervalSeconds: Int? = nil) {
        self.enabled = enabled
        self.intervalSeconds = intervalSeconds
    }
}

public struct AutomationRecentRunDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let jobId: String
    public let state: String
    public let startedAt: String
    public let finishedAt: String?
    public let error: String?
    public let receiptId: String?
    public let pendingApprovalCount: Int
    public let openInterventionCount: Int

    public init(
        id: String,
        jobId: String,
        state: String,
        startedAt: String,
        finishedAt: String?,
        error: String?,
        receiptId: String?,
        pendingApprovalCount: Int,
        openInterventionCount: Int
    ) {
        self.id = id
        self.jobId = jobId
        self.state = state
        self.startedAt = startedAt
        self.finishedAt = finishedAt
        self.error = error
        self.receiptId = receiptId
        self.pendingApprovalCount = pendingApprovalCount
        self.openInterventionCount = openInterventionCount
    }
}

public struct AutomationRecordDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let workspaceId: String
    public let taskId: String
    public let source: String
    public let title: String
    public let taskStatus: String
    public let jobId: String?
    public let jobStatus: String?
    public let status: String
    public let enabled: Bool
    public let scheduleSummary: String
    public let intervalSeconds: Int?
    public let lastRunAt: String?
    public let lastSuccessAt: String?
    public let lastFailureAt: String?
    public let nextExpectedAt: String?
    public let blockedReason: String?
    public let attentionReason: String?
    public let openInterventionCount: Int
    public let pendingApprovalCount: Int
    public let controls: AutomationControlAvailabilityDTO

    public init(
        id: String,
        workspaceId: String,
        taskId: String,
        source: String,
        title: String,
        taskStatus: String,
        jobId: String?,
        jobStatus: String?,
        status: String,
        enabled: Bool,
        scheduleSummary: String,
        intervalSeconds: Int?,
        lastRunAt: String?,
        lastSuccessAt: String?,
        lastFailureAt: String?,
        nextExpectedAt: String?,
        blockedReason: String?,
        attentionReason: String?,
        openInterventionCount: Int,
        pendingApprovalCount: Int,
        controls: AutomationControlAvailabilityDTO
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.taskId = taskId
        self.source = source
        self.title = title
        self.taskStatus = taskStatus
        self.jobId = jobId
        self.jobStatus = jobStatus
        self.status = status
        self.enabled = enabled
        self.scheduleSummary = scheduleSummary
        self.intervalSeconds = intervalSeconds
        self.lastRunAt = lastRunAt
        self.lastSuccessAt = lastSuccessAt
        self.lastFailureAt = lastFailureAt
        self.nextExpectedAt = nextExpectedAt
        self.blockedReason = blockedReason
        self.attentionReason = attentionReason
        self.openInterventionCount = openInterventionCount
        self.pendingApprovalCount = pendingApprovalCount
        self.controls = controls
    }
}

public struct AutomationDetailDTO: Codable, Sendable, Equatable {
    public let id: String
    public let workspaceId: String
    public let taskId: String
    public let source: String
    public let title: String
    public let taskStatus: String
    public let jobId: String?
    public let jobStatus: String?
    public let status: String
    public let enabled: Bool
    public let scheduleSummary: String
    public let intervalSeconds: Int?
    public let lastRunAt: String?
    public let lastSuccessAt: String?
    public let lastFailureAt: String?
    public let nextExpectedAt: String?
    public let blockedReason: String?
    public let attentionReason: String?
    public let openInterventionCount: Int
    public let pendingApprovalCount: Int
    public let controls: AutomationControlAvailabilityDTO
    public let recentRuns: [AutomationRecentRunDTO]

    public init(
        id: String,
        workspaceId: String,
        taskId: String,
        source: String,
        title: String,
        taskStatus: String,
        jobId: String?,
        jobStatus: String?,
        status: String,
        enabled: Bool,
        scheduleSummary: String,
        intervalSeconds: Int?,
        lastRunAt: String?,
        lastSuccessAt: String?,
        lastFailureAt: String?,
        nextExpectedAt: String?,
        blockedReason: String?,
        attentionReason: String?,
        openInterventionCount: Int,
        pendingApprovalCount: Int,
        controls: AutomationControlAvailabilityDTO,
        recentRuns: [AutomationRecentRunDTO]
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.taskId = taskId
        self.source = source
        self.title = title
        self.taskStatus = taskStatus
        self.jobId = jobId
        self.jobStatus = jobStatus
        self.status = status
        self.enabled = enabled
        self.scheduleSummary = scheduleSummary
        self.intervalSeconds = intervalSeconds
        self.lastRunAt = lastRunAt
        self.lastSuccessAt = lastSuccessAt
        self.lastFailureAt = lastFailureAt
        self.nextExpectedAt = nextExpectedAt
        self.blockedReason = blockedReason
        self.attentionReason = attentionReason
        self.openInterventionCount = openInterventionCount
        self.pendingApprovalCount = pendingApprovalCount
        self.controls = controls
        self.recentRuns = recentRuns
    }
}
