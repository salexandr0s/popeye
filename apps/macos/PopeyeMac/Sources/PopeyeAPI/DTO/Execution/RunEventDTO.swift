import Foundation

public struct RunEventDTO: Codable, Sendable, Identifiable {
    public let id: String
    public let runId: String
    public let type: String
    public let payload: String // JSON string
    public let createdAt: String
}
