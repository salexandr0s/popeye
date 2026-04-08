import Foundation

public struct EmailAccountDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let connectionId: String
    public let emailAddress: String
    public let displayName: String
    public let syncCursorPageToken: String?
    public let syncCursorHistoryId: String?
    public let lastSyncAt: String?
    public let messageCount: Int
    public let createdAt: String
    public let updatedAt: String
}

public struct EmailThreadDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let accountId: String
    public let gmailThreadId: String
    public let subject: String
    public let snippet: String
    public let lastMessageAt: String
    public let messageCount: Int
    public let labelIds: [String]
    public let isUnread: Bool
    public let isStarred: Bool
    public let importance: String
    public let createdAt: String
    public let updatedAt: String
}

public struct EmailMessageDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let threadId: String
    public let accountId: String
    public let gmailMessageId: String
    public let from: String
    public let to: [String]
    public let cc: [String]
    public let subject: String
    public let snippet: String
    public let bodyPreview: String
    public let receivedAt: String
    public let sizeEstimate: Int
    public let labelIds: [String]
    public let createdAt: String
    public let updatedAt: String
}

public struct EmailDigestDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let accountId: String
    public let workspaceId: String
    public let date: String
    public let unreadCount: Int
    public let highSignalCount: Int
    public let summaryMarkdown: String
    public let generatedAt: String
}

public struct EmailSyncResultDTO: Codable, Sendable, Equatable {
    public let accountId: String
    public let synced: Int
    public let updated: Int
    public let errors: [String]
}
