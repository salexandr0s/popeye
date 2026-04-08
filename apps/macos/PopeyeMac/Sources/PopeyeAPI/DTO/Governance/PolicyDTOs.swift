import Foundation

public struct StandingApprovalRecordDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let scope: String
    public let domain: String
    public let actionKind: String
    public let resourceScope: String
    public let resourceType: String
    public let resourceId: String?
    public let requestedBy: String?
    public let workspaceId: String?
    public let projectId: String?
    public let note: String
    public let expiresAt: String?
    public let createdBy: String
    public let status: String
    public let createdAt: String
    public let revokedAt: String?
    public let revokedBy: String?
}

public struct AutomationGrantRecordDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let scope: String
    public let domain: String
    public let actionKind: String
    public let resourceScope: String
    public let resourceType: String
    public let resourceId: String?
    public let requestedBy: String?
    public let workspaceId: String?
    public let projectId: String?
    public let note: String
    public let expiresAt: String?
    public let createdBy: String
    public let taskSources: [String]
    public let status: String
    public let createdAt: String
    public let revokedAt: String?
    public let revokedBy: String?
}

public struct DomainPolicyDTO: Codable, Sendable, Equatable {
    public let domain: String
    public let sensitivity: String
    public let embeddingPolicy: String
    public let contextReleasePolicy: String
}

public struct ApprovalPolicyRuleDTO: Codable, Sendable, Equatable {
    public let scope: String
    public let domain: String
    public let riskClass: String
    public let actionKinds: [String]
    public let resourceScopes: [String]
}

public struct ActionPolicyDefaultDTO: Codable, Sendable, Equatable {
    public let scope: String
    public let domain: String?
    public let actionKind: String
    public let riskClass: String
    public let standingApprovalEligible: Bool
    public let automationGrantEligible: Bool
    public let reason: String
}

public struct SecurityPolicyResponseDTO: Codable, Sendable, Equatable {
    public let domainPolicies: [DomainPolicyDTO]
    public let approvalRules: [ApprovalPolicyRuleDTO]
    public let defaultRiskClass: String
    public let actionDefaults: [ActionPolicyDefaultDTO]
}
