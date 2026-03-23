import Foundation

public struct TaskRecordDTO: Codable, Sendable, Identifiable {
    public let id: String
    public let workspaceId: String
    public let projectId: String?
    public let profileId: String
    public let title: String
    public let prompt: String
    public let source: String // manual|heartbeat|schedule|telegram|api
    public let status: String // active|paused
    public let retryPolicy: RetryPolicyDTO
    public let sideEffectProfile: String // read_only|external_side_effect
    public let coalesceKey: String?
    public let createdAt: String
}

public struct RetryPolicyDTO: Codable, Sendable {
    public let maxAttempts: Int
    public let baseDelaySeconds: Int
    public let multiplier: Double
    public let maxDelaySeconds: Int
}
