import Foundation

public struct RunRecordDTO: Codable, Sendable, Identifiable {
    public let id: String
    public let jobId: String
    public let taskId: String
    public let workspaceId: String
    public let profileId: String
    public let sessionRootId: String
    public let engineSessionRef: String?
    public let state: String // starting|running|succeeded|failed_retryable|failed_final|cancelled|abandoned
    public let startedAt: String
    public let finishedAt: String?
    public let error: String?
}
