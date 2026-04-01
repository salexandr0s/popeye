import Foundation

public struct MutationReceiptDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let kind: String
    public let component: String
    public let status: String
    public let summary: String
    public let details: String
    public let actorRole: String
    public let workspaceId: String?
    public let usage: ReceiptUsageDTO
    public let metadata: [String: String]
    public let createdAt: String
}
