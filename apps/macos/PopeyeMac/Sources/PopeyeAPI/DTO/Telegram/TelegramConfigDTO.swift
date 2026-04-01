import Foundation

public struct TelegramConfigRecordDTO: Codable, Sendable, Equatable {
    public let enabled: Bool
    public let allowedUserId: String?
    public let secretRefId: String?
}

public struct TelegramConfigSnapshotDTO: Codable, Sendable, Equatable {
    public let persisted: TelegramConfigRecordDTO
    public let applied: TelegramConfigRecordDTO
    public let effectiveWorkspaceId: String
    public let secretAvailability: String
    public let staleComparedToApplied: Bool
    public let warnings: [String]
    public let managementMode: String
    public let restartSupported: Bool
}

public struct TelegramApplyResponseDTO: Codable, Sendable, Equatable {
    public let status: String
    public let summary: String
    public let snapshot: TelegramConfigSnapshotDTO
}

public struct DaemonRestartResponseDTO: Codable, Sendable, Equatable {
    public let status: String
    public let summary: String
    public let managementMode: String
    public let restartSupported: Bool
}
