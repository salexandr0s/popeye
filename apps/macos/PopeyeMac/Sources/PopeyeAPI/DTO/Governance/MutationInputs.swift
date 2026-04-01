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
