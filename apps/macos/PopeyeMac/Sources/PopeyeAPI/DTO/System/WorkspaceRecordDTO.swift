import Foundation

public struct WorkspaceRecordDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let name: String
    public let rootPath: String?
    public let createdAt: String

    public init(id: String, name: String, rootPath: String?, createdAt: String) {
        self.id = id
        self.name = name
        self.rootPath = rootPath
        self.createdAt = createdAt
    }
}
