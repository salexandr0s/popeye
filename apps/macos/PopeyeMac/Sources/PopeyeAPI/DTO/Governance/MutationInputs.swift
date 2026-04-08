import Foundation

public struct InterventionResolveInput: Encodable, Sendable {
    public let resolutionNote: String?

    public init(resolutionNote: String? = nil) {
        self.resolutionNote = resolutionNote
    }
}

public struct ApprovalResolveInput: Encodable, Sendable {
    public let decision: String // "approved" | "denied"
    public let decisionReason: String?

    public init(decision: String, decisionReason: String? = nil) {
        self.decision = decision
        self.decisionReason = decisionReason
    }
}

public struct ApprovalRequestInput: Encodable, Sendable {
    public let scope: String
    public let domain: String
    public let riskClass: String
    public let actionKind: String
    public let resourceScope: String
    public let resourceType: String
    public let resourceId: String
    public let requestedBy: String
    public let runId: String?
    public let standingApprovalEligible: Bool?
    public let automationGrantEligible: Bool?
    public let payloadPreview: String?
    public let idempotencyKey: String?
    public let expiresAt: String?

    public init(
        scope: String,
        domain: String,
        riskClass: String,
        actionKind: String,
        resourceScope: String,
        resourceType: String,
        resourceId: String,
        requestedBy: String,
        runId: String? = nil,
        standingApprovalEligible: Bool? = nil,
        automationGrantEligible: Bool? = nil,
        payloadPreview: String? = nil,
        idempotencyKey: String? = nil,
        expiresAt: String? = nil
    ) {
        self.scope = scope
        self.domain = domain
        self.riskClass = riskClass
        self.actionKind = actionKind
        self.resourceScope = resourceScope
        self.resourceType = resourceType
        self.resourceId = resourceId
        self.requestedBy = requestedBy
        self.runId = runId
        self.standingApprovalEligible = standingApprovalEligible
        self.automationGrantEligible = automationGrantEligible
        self.payloadPreview = payloadPreview
        self.idempotencyKey = idempotencyKey
        self.expiresAt = expiresAt
    }
}

public struct TelegramConfigUpdateInput: Encodable, Sendable {
    public let enabled: Bool
    public let allowedUserId: String?
    public let secretRefId: String?

    public init(enabled: Bool, allowedUserId: String?, secretRefId: String?) {
        self.enabled = enabled
        self.allowedUserId = allowedUserId
        self.secretRefId = secretRefId
    }
}

public struct VaultOpenInput: Encodable, Sendable {
    public let approvalId: String

    public init(approvalId: String) {
        self.approvalId = approvalId
    }
}


public struct StandingApprovalCreateInput: Encodable, Sendable {
    public let scope: String
    public let domain: String
    public let actionKind: String
    public let resourceScope: String?
    public let resourceType: String
    public let resourceId: String?
    public let requestedBy: String?
    public let workspaceId: String?
    public let projectId: String?
    public let note: String?
    public let expiresAt: String?
    public let createdBy: String

    public init(
        scope: String,
        domain: String,
        actionKind: String,
        resourceScope: String? = "resource",
        resourceType: String,
        resourceId: String? = nil,
        requestedBy: String? = nil,
        workspaceId: String? = nil,
        projectId: String? = nil,
        note: String? = nil,
        expiresAt: String? = nil,
        createdBy: String
    ) {
        self.scope = scope
        self.domain = domain
        self.actionKind = actionKind
        self.resourceScope = resourceScope
        self.resourceType = resourceType
        self.resourceId = resourceId
        self.requestedBy = requestedBy
        self.workspaceId = workspaceId
        self.projectId = projectId
        self.note = note
        self.expiresAt = expiresAt
        self.createdBy = createdBy
    }
}

public struct AutomationGrantCreateInput: Encodable, Sendable {
    public let scope: String
    public let domain: String
    public let actionKind: String
    public let resourceScope: String?
    public let resourceType: String
    public let resourceId: String?
    public let requestedBy: String?
    public let workspaceId: String?
    public let projectId: String?
    public let note: String?
    public let expiresAt: String?
    public let createdBy: String
    public let taskSources: [String]?

    public init(
        scope: String,
        domain: String,
        actionKind: String,
        resourceScope: String? = "resource",
        resourceType: String,
        resourceId: String? = nil,
        requestedBy: String? = nil,
        workspaceId: String? = nil,
        projectId: String? = nil,
        note: String? = nil,
        expiresAt: String? = nil,
        createdBy: String,
        taskSources: [String]? = nil
    ) {
        self.scope = scope
        self.domain = domain
        self.actionKind = actionKind
        self.resourceScope = resourceScope
        self.resourceType = resourceType
        self.resourceId = resourceId
        self.requestedBy = requestedBy
        self.workspaceId = workspaceId
        self.projectId = projectId
        self.note = note
        self.expiresAt = expiresAt
        self.createdBy = createdBy
        self.taskSources = taskSources
    }
}

public struct PolicyGrantRevokeInput: Encodable, Sendable {
    public let revokedBy: String

    public init(revokedBy: String) {
        self.revokedBy = revokedBy
    }
}
