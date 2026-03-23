import Foundation

public struct JobRecordDTO: Codable, Sendable, Identifiable {
    public let id: String
    public let taskId: String
    public let workspaceId: String
    public let status: String // queued|leased|running|waiting_retry|paused|blocked_operator|succeeded|failed_final|cancelled
    public let retryCount: Int
    public let availableAt: String
    public let lastRunId: String?
    public let createdAt: String
    public let updatedAt: String
}
