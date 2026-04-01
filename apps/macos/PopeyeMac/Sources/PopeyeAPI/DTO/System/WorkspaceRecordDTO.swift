import Foundation

public struct WorkspaceRecordDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let name: String
    public let rootPath: String?
    public let createdAt: String
}
