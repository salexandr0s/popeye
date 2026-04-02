import Foundation

public struct TodoAccountDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let connectionId: String?
    public let providerKind: String
    public let displayName: String
    public let syncCursorSince: String?
    public let lastSyncAt: String?
    public let todoCount: Int
    public let createdAt: String
    public let updatedAt: String
}

public struct TodoItemDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let accountId: String
    public let externalId: String?
    public let title: String
    public let description: String
    public let priority: Int
    public let status: String
    public let dueDate: String?
    public let dueTime: String?
    public let labels: [String]
    public let projectId: String?
    public let projectName: String?
    public let parentId: String?
    public let completedAt: String?
    public let createdAtExternal: String?
    public let updatedAtExternal: String?
    public let createdAt: String
    public let updatedAt: String
}

public struct TodoProjectDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let accountId: String
    public let externalId: String?
    public let name: String
    public let color: String?
    public let todoCount: Int
    public let createdAt: String
    public let updatedAt: String
}

public struct TodoDigestDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let accountId: String
    public let workspaceId: String
    public let date: String
    public let pendingCount: Int
    public let overdueCount: Int
    public let completedTodayCount: Int
    public let summaryMarkdown: String
    public let generatedAt: String
}
