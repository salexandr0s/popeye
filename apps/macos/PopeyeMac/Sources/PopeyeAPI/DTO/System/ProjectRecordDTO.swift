import Foundation

public struct ProjectRecordDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let workspaceId: String
    public let name: String
    public let path: String?
    public let createdAt: String

    public init(id: String, workspaceId: String, name: String, path: String?, createdAt: String) {
        self.id = id
        self.workspaceId = workspaceId
        self.name = name
        self.path = path
        self.createdAt = createdAt
    }
}
