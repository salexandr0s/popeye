import Foundation

public struct ApprovalDTO: Codable, Sendable, Identifiable {
    public let id: String
    public let scope: String // secret_access|vault_open|context_release|data_source_connect|external_write
    public let domain: String
    public let riskClass: String // auto|ask|deny
    public let actionKind: String
    public let resourceScope: String
    public let resourceType: String
    public let resourceId: String
    public let requestedBy: String
    public let runId: String?
    public let standingApprovalEligible: Bool
    public let automationGrantEligible: Bool
    public let interventionId: String?
    public let payloadPreview: String
    public let idempotencyKey: String?
    public let status: String // pending|approved|denied|expired
    public let resolvedBy: String?
    public let resolvedByGrantId: String?
    public let decisionReason: String?
    public let expiresAt: String?
    public let createdAt: String
    public let resolvedAt: String?
}
