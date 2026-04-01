import Foundation

public struct WorkspaceIdentityDefaultDTO: Codable, Sendable {
    public let workspaceId: String
    public let identityId: String
    public let updatedAt: String?
}
