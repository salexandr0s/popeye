import Foundation

public struct IdentityRecordDTO: Codable, Sendable, Identifiable {
    public let id: String
    public let workspaceId: String
    public let path: String
    public let exists: Bool
    public let selected: Bool
}
